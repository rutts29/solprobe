"""Tests for DiagnosisStore."""

from __future__ import annotations

import threading
import time

import pytest

from app.diagnosis.models import (
    DiagnosisResult,
    EvidenceItem,
    RecommendedAction,
)
from app.diagnosis.store import DiagnosisStore


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
            action="reassign_workload",
            params={},
            urgency="immediate",
        ),
        "similar_incidents": [],
        "llm_model": "claude-sonnet-4-20250514",
        "latency_ms": 1000,
        "status": status,
    }
    if status != "completed":
        kwargs["error"] = "test error"
    else:
        kwargs["error"] = None
    return DiagnosisResult(**kwargs)


class TestDiagnosisStore:
    def test_add_and_get_by_id(self):
        store = DiagnosisStore()
        diag = _make_diagnosis(diagnosis_id="diag-1")
        store.add(diag)
        result = store.get_by_id("diag-1")
        assert result is not None
        assert result.diagnosis_id == "diag-1"

    def test_get_by_id_not_found(self):
        store = DiagnosisStore()
        assert store.get_by_id("nonexistent") is None

    def test_get_by_alert_id(self):
        store = DiagnosisStore()
        diag = _make_diagnosis(diagnosis_id="diag-1", alert_id="alert-42")
        store.add(diag)
        result = store.get_by_alert_id("alert-42")
        assert result is not None
        assert result.alert_id == "alert-42"

    def test_get_by_alert_id_not_found(self):
        store = DiagnosisStore()
        assert store.get_by_alert_id("nonexistent") is None

    def test_query_no_filters(self):
        store = DiagnosisStore()
        for i in range(5):
            store.add(_make_diagnosis(diagnosis_id=f"diag-{i}", alert_id=f"alert-{i}"))
        results = store.query()
        assert len(results) == 5

    def test_query_by_node_id(self):
        store = DiagnosisStore()
        store.add(_make_diagnosis(diagnosis_id="d1", alert_id="a1", node_id="node-1"))
        store.add(_make_diagnosis(diagnosis_id="d2", alert_id="a2", node_id="node-2"))
        store.add(_make_diagnosis(diagnosis_id="d3", alert_id="a3", node_id="node-1"))
        results = store.query(node_id="node-1")
        assert len(results) == 2
        assert all(r.node_id == "node-1" for r in results)

    def test_query_by_root_cause(self):
        store = DiagnosisStore()
        store.add(_make_diagnosis(diagnosis_id="d1", alert_id="a1", root_cause="thermal_throttle"))
        store.add(_make_diagnosis(diagnosis_id="d2", alert_id="a2", root_cause="hardware_fault", alert_type="xid_error"))
        store.add(_make_diagnosis(diagnosis_id="d3", alert_id="a3", root_cause="thermal_throttle"))
        results = store.query(root_cause="thermal_throttle")
        assert len(results) == 2

    def test_query_limit(self):
        store = DiagnosisStore()
        for i in range(10):
            store.add(_make_diagnosis(diagnosis_id=f"d-{i}", alert_id=f"a-{i}"))
        results = store.query(limit=3)
        assert len(results) == 3

    def test_find_similar_by_alert_type(self):
        """find_similar matches on alert_type, not root_cause."""
        store = DiagnosisStore()
        store.add(_make_diagnosis(
            diagnosis_id="d1", alert_id="a1",
            alert_type="thermal_throttle", root_cause="thermal_throttle",
        ))
        store.add(_make_diagnosis(
            diagnosis_id="d2", alert_id="a2",
            alert_type="xid_error", root_cause="hardware_fault",
        ))
        store.add(_make_diagnosis(
            diagnosis_id="d3", alert_id="a3",
            alert_type="thermal_throttle", root_cause="power_limit",
        ))
        similar = store.find_similar("thermal_throttle", limit=3)
        assert len(similar) == 2
        assert all(s.alert_type == "thermal_throttle" for s in similar)

    def test_find_similar_excludes_failed(self):
        store = DiagnosisStore()
        store.add(_make_diagnosis(
            diagnosis_id="d1", alert_id="a1",
            alert_type="thermal_throttle", status="completed",
        ))
        store.add(_make_diagnosis(
            diagnosis_id="d2", alert_id="a2",
            alert_type="thermal_throttle", status="failed",
        ))
        similar = store.find_similar("thermal_throttle")
        assert len(similar) == 1

    def test_bounded_at_500(self):
        store = DiagnosisStore(max_size=500)
        for i in range(600):
            store.add(_make_diagnosis(diagnosis_id=f"d-{i}", alert_id=f"a-{i}"))
        assert store.count == 500

    def test_count_property(self):
        store = DiagnosisStore()
        assert store.count == 0
        store.add(_make_diagnosis())
        assert store.count == 1

    def test_thread_safety(self):
        store = DiagnosisStore()
        errors = []

        def add_batch(start: int, count: int):
            try:
                for i in range(start, start + count):
                    store.add(_make_diagnosis(diagnosis_id=f"d-{i}", alert_id=f"a-{i}"))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=add_batch, args=(i * 50, 50)) for i in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert store.count == 200
