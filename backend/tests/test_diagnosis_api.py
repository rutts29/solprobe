"""Tests for diagnosis API endpoints."""

from __future__ import annotations

import time
import uuid
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from app.api.routes import router as api_router
from app.diagnosis.models import (
    DiagnosisResult,
    EvidenceItem,
    RecommendedAction,
)
from app.diagnosis.store import DiagnosisStore
from app.models.alerts import AlertModel
from app.stores import AlertStore, MetricsStore, AnomalyStore, JobStore


def _make_diagnosis(
    diagnosis_id: str = "diag-1",
    alert_id: str = "alert-1",
    alert_type: str = "thermal_throttle",
    node_id: str = "node-1",
    root_cause: str = "thermal_throttle",
    status: str = "completed",
) -> DiagnosisResult:
    kwargs = {
        "diagnosis_id": diagnosis_id,
        "alert_id": alert_id,
        "alert_type": alert_type,
        "node_id": node_id,
        "timestamp_ms": int(time.time() * 1000),
        "root_cause": root_cause,
        "confidence": 0.9,
        "reasoning": "Test reasoning",
        "evidence_chain": [
            EvidenceItem(metric="gpu_temp_c", value="92", context="Above threshold"),
        ],
        "recommended_action": RecommendedAction(
            action="reassign_workload", params={}, urgency="immediate",
        ),
        "similar_incidents": [],
        "llm_model": "claude-sonnet-4-20250514",
        "latency_ms": 1000,
        "status": status,
    }
    if status in ("completed", "cached"):
        kwargs["error"] = None
    else:
        kwargs["error"] = "test error"
    if status == "cached":
        kwargs["cached_from"] = "diag-source"
    return DiagnosisResult(**kwargs)


def _make_alert(
    alert_id: str | None = None,
    node_id: str = "node-1",
    severity: str = "CRITICAL",
    alert_type: str = "thermal_throttle",
) -> AlertModel:
    return AlertModel(
        alert_id=alert_id or str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(time.time() * 1000),
        severity=severity,
        source="EDGE",
        alert_type=alert_type,
        description="Test alert",
        confidence=0.95,
    )


@pytest.fixture()
def diagnosis_app(monkeypatch: pytest.MonkeyPatch):
    """Create a test app with fresh stores including diagnosis store."""
    monkeypatch.setenv("SOLPROBE_API_KEY", "test-secret")
    import app.api.routes as routes_mod
    import app.enrichment as enrichment_mod

    ms = MetricsStore()
    als = AlertStore()
    ans = AnomalyStore()
    js = JobStore()
    ds = DiagnosisStore()

    routes_mod.metrics_store = ms
    routes_mod.alert_store = als
    routes_mod.anomaly_store = ans
    routes_mod.job_store = js
    routes_mod.diagnosis_store = ds
    enrichment_mod.metrics_store = ms
    enrichment_mod.alert_store = als

    app = FastAPI()
    app.include_router(api_router)

    return app, ms, als, ans, js, ds


@pytest_asyncio.fixture()
async def diag_client(diagnosis_app):
    """Async HTTP client for diagnosis tests."""
    app, *_ = diagnosis_app
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-SolProbe-API-Key": "test-secret"},
    ) as ac:
        yield ac


class TestDiagnosisEndpoints:
    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnoses_empty(self, diag_client):
        resp = await diag_client.get("/api/v1/diagnoses")
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnoses_with_data(self, diagnosis_app, diag_client):
        _, _, _, _, _, ds = diagnosis_app
        ds.add(_make_diagnosis(diagnosis_id="d1", alert_id="a1"))
        ds.add(_make_diagnosis(diagnosis_id="d2", alert_id="a2"))

        resp = await diag_client.get("/api/v1/diagnoses")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnoses_filter_node(self, diagnosis_app, diag_client):
        _, _, _, _, _, ds = diagnosis_app
        ds.add(_make_diagnosis(diagnosis_id="d1", alert_id="a1", node_id="node-1"))
        ds.add(_make_diagnosis(diagnosis_id="d2", alert_id="a2", node_id="node-2"))

        resp = await diag_client.get("/api/v1/diagnoses?node_id=node-1")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["node_id"] == "node-1"

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnoses_filter_root_cause(self, diagnosis_app, diag_client):
        _, _, _, _, _, ds = diagnosis_app
        ds.add(_make_diagnosis(diagnosis_id="d1", alert_id="a1", root_cause="thermal_throttle"))
        ds.add(_make_diagnosis(diagnosis_id="d2", alert_id="a2", root_cause="hardware_fault", alert_type="xid_error"))

        resp = await diag_client.get("/api/v1/diagnoses?root_cause=hardware_fault")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["root_cause"] == "hardware_fault"

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnosis_by_id(self, diagnosis_app, diag_client):
        _, _, _, _, _, ds = diagnosis_app
        ds.add(_make_diagnosis(diagnosis_id="diag-42"))

        resp = await diag_client.get("/api/v1/diagnoses/diag-42")
        assert resp.status_code == 200
        assert resp.json()["diagnosis_id"] == "diag-42"

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_diagnosis_by_id_not_found(self, diag_client):
        resp = await diag_client.get("/api/v1/diagnoses/nonexistent")
        assert resp.status_code == 404

    @pytest.mark.asyncio(loop_scope="function")
    @patch("app.api.routes.get_or_create_agent")
    async def test_post_diagnoses_completed(self, mock_get_agent, diagnosis_app, diag_client):
        """Successful diagnosis returns 201."""
        _, _, als, _, _, ds = diagnosis_app
        alert = _make_alert(alert_id="alert-99")
        als.add(alert)

        mock_agent = MagicMock()
        mock_agent.diagnose.return_value = _make_diagnosis(
            diagnosis_id="diag-new", alert_id="alert-99",
        )
        mock_get_agent.return_value = mock_agent

        resp = await diag_client.post(
            "/api/v1/diagnoses",
            json={"alert_id": "alert-99"},
        )
        assert resp.status_code == 201
        assert resp.json()["diagnosis_id"] == "diag-new"

    @pytest.mark.asyncio(loop_scope="function")
    @patch("app.api.routes.get_or_create_agent")
    async def test_post_diagnoses_cached_returns_201(self, mock_get_agent, diagnosis_app, diag_client):
        """Cached diagnoses are usable results and should not surface as API failures."""
        _, _, als, _, _, ds = diagnosis_app
        alert = _make_alert(alert_id="alert-cached")
        als.add(alert)

        mock_agent = MagicMock()
        mock_agent.diagnose.return_value = _make_diagnosis(
            diagnosis_id="diag-cached", alert_id="alert-cached", status="cached",
        )
        mock_get_agent.return_value = mock_agent

        resp = await diag_client.post(
            "/api/v1/diagnoses",
            json={"alert_id": "alert-cached"},
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "cached"

    @pytest.mark.asyncio(loop_scope="function")
    @patch("app.api.routes.get_or_create_agent")
    async def test_post_diagnoses_failed_returns_502(self, mock_get_agent, diagnosis_app, diag_client):
        """Failed diagnosis returns 502, not 201."""
        _, _, als, _, _, ds = diagnosis_app
        alert = _make_alert(alert_id="alert-fail")
        als.add(alert)

        mock_agent = MagicMock()
        mock_agent.diagnose.return_value = _make_diagnosis(
            diagnosis_id="diag-fail", alert_id="alert-fail", status="failed",
        )
        mock_get_agent.return_value = mock_agent

        resp = await diag_client.post(
            "/api/v1/diagnoses",
            json={"alert_id": "alert-fail"},
        )
        assert resp.status_code == 502
        assert resp.json()["status"] == "failed"

    @pytest.mark.asyncio(loop_scope="function")
    async def test_post_diagnoses_alert_not_found(self, diag_client):
        resp = await diag_client.post(
            "/api/v1/diagnoses",
            json={"alert_id": "nonexistent"},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_alert_diagnosis(self, diagnosis_app, diag_client):
        _, _, _, _, _, ds = diagnosis_app
        ds.add(_make_diagnosis(diagnosis_id="d1", alert_id="alert-77"))

        resp = await diag_client.get("/api/v1/alerts/alert-77/diagnosis")
        assert resp.status_code == 200
        assert resp.json()["alert_id"] == "alert-77"

    @pytest.mark.asyncio(loop_scope="function")
    async def test_get_alert_diagnosis_not_found(self, diag_client):
        resp = await diag_client.get("/api/v1/alerts/nonexistent/diagnosis")
        assert resp.status_code == 404
