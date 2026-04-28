"""Shared fixtures for SolProbe backend tests."""

from __future__ import annotations

import time

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI, WebSocket

from app.api.routes import router as api_router
from app.models.alerts import AlertModel
from app.models.metrics import (
    GpuMetricsModel,
    MetricsBatchModel,
    TrainingMetricsModel,
)
from app.diagnosis.store import DiagnosisStore
from app.stores import (
    AlertLifecycleStore,
    AlertStore,
    MetricsStore,
    AnomalyStore,
    JobStore,
    PolicyStore,
    alert_lifecycle_store,
    alert_store,
    anomaly_store,
    job_store,
    metrics_store,
    policy_store,
)
from app.ws.websocket import ConnectionManager, websocket_endpoint, ws_manager


def _make_gpu_metric(
    node_id: str,
    gpu_index: int = 0,
    temp: float = 55.0,
    util: float = 90.0,
    ts: int | None = None,
) -> GpuMetricsModel:
    return GpuMetricsModel(
        node_id=node_id,
        gpu_index=gpu_index,
        gpu_model="T4",
        timestamp_ms=ts or int(time.time() * 1000),
        gpu_temp_c=temp,
        gpu_utilization_pct=util,
        fb_used_mb=8000.0,
        fb_free_mb=8000.0,
        power_usage_w=70.0,
    )


def _make_training_metric(
    node_id: str,
    throughput: float = 100.0,
    loss: float = 2.5,
    grad_norm: float = 1.0,
    step: int = 1,
    ts: int | None = None,
) -> TrainingMetricsModel:
    return TrainingMetricsModel(
        node_id=node_id,
        job_id="job-1",
        timestamp_ms=ts or int(time.time() * 1000),
        step=step,
        loss=loss,
        gradient_norm=grad_norm,
        throughput_tps=throughput,
        learning_rate=1e-4,
        mfu_pct=40.0,
    )


def _make_alert(
    node_id: str = "node-1",
    severity: str = "WARNING",
    alert_type: str = "thermal_throttle",
    ts: int | None = None,
    source: str = "EDGE",
    job_id: str | None = None,
    alert_id: str | None = None,
) -> AlertModel:
    import uuid

    return AlertModel(
        alert_id=alert_id or str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=ts or int(time.time() * 1000),
        severity=severity,
        source=source,
        alert_type=alert_type,
        description="Test alert",
        confidence=0.9,
        job_id=job_id,
    )


@pytest.fixture()
def fresh_stores(monkeypatch: pytest.MonkeyPatch):
    """Replace global store singletons with fresh instances for test isolation."""
    import app.stores as stores_mod
    import app.detectors.zscore as zscore_mod
    import app.detectors.cross_node as cross_node_mod

    ms = MetricsStore()
    als = AlertStore()
    ans = AnomalyStore()
    js = JobStore()
    ds = DiagnosisStore()
    lcs = AlertLifecycleStore()
    pls = PolicyStore()

    # Patch the module-level singletons everywhere they're imported
    for mod in [stores_mod, zscore_mod, cross_node_mod]:
        monkeypatch.setattr(mod, "metrics_store", ms)
        monkeypatch.setattr(mod, "alert_store", als)
        if hasattr(mod, "anomaly_store"):
            monkeypatch.setattr(mod, "anomaly_store", ans)

    # Reset z-score deduplication state between tests
    zscore_mod._last_alerted.clear()

    return ms, als, ans, js, ds, lcs, pls


@pytest.fixture()
def test_app(fresh_stores):
    """Create a minimal FastAPI app for testing (no gRPC/background tasks)."""
    ms, als, ans, js, ds, lcs, pls = fresh_stores

    # Patch stores used by routes and enrichment
    import app.api.routes as routes_mod
    import app.enrichment as enrichment_mod

    # Use a fresh monkeypatch context — since fresh_stores already patched
    # the detector modules, we just need routes and enrichment
    routes_mod.metrics_store = ms
    routes_mod.alert_store = als
    routes_mod.anomaly_store = ans
    routes_mod.job_store = js
    routes_mod.diagnosis_store = ds
    routes_mod.alert_lifecycle_store = lcs
    routes_mod.policy_store = pls
    enrichment_mod.metrics_store = ms
    enrichment_mod.alert_store = als

    app = FastAPI()
    app.include_router(api_router)

    @app.get("/api/v1/health")
    async def health():
        return {
            "status": "ok",
            "connected_sidecars": ms.node_count,
            "total_alerts": als.count,
            "ws_clients": 0,
        }

    # Wire WS endpoint
    wm = ConnectionManager()

    @app.websocket("/ws/stream")
    async def ws_stream(websocket: WebSocket):
        conn = await wm.connect(websocket)
        try:
            while True:
                data = await websocket.receive_text()
                await wm.set_filter(conn, data)
        except Exception:
            pass
        finally:
            await wm.disconnect(conn)

    return app, ms, als, ans, js, ds, lcs, pls, wm


@pytest_asyncio.fixture()
async def client(test_app):
    """Async HTTP test client."""
    app, *_ = test_app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
