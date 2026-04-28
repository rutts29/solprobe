"""Tests for the training stalled detector."""

from __future__ import annotations

import pytest

from app import stores as stores_mod
from app.detectors import training_stalled as ts_mod
from app.detectors.training_stalled import run_training_stalled_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_gpu_metric, _make_training_metric


@pytest.fixture(autouse=True)
def _patch_job_store(fresh_stores, monkeypatch):
    """Bind the fresh JobStore from fresh_stores onto app.stores.job_store
    so the detector picks it up via its `_stores.job_store` lookup."""
    _, _, _, js, *_ = fresh_stores
    monkeypatch.setattr(stores_mod, "job_store", js)
    yield


def _ingest_steps(ms, node_id: str, *, step: int, count: int, start_ts: int, interval_ms: int = 1000):
    """Ingest `count` training samples all at the same `step`, separated by interval_ms."""
    for i in range(count):
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric(node_id, step=step, ts=start_ts + i * interval_ms)
            )
        )


def _register_running(js, job_id: str, node_id: str = "node-1") -> None:
    """Register a job and (best-effort) put it in `running` status."""
    js.register(job_id=job_id, config={}, node_ids=[node_id])
    update = getattr(js, "update_status", None)
    if update is not None:
        update(job_id, "running")
    else:
        # Fallback: hand-write status into the job dict (pre-anna)
        entry = js.get(job_id)
        if entry is not None:
            entry["status"] = "running"


class TestTrainingStalledDetector:
    def test_no_nodes_no_findings(self, fresh_stores):
        ts_mod._last_alerted.clear()
        findings = run_training_stalled_detection()
        assert findings == []

    def test_advancing_step_no_alert(self, fresh_stores):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        _register_running(js, "job-1")
        for step in range(1, 6):
            ms.ingest_batch(
                MetricsBatchModel(training=_make_training_metric("node-1", step=step, ts=1000 + step * 1000))
            )
        findings = run_training_stalled_detection()
        assert findings == []
        assert als.count == 0

    def test_stalled_warning_after_warn_threshold(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        monkeypatch.setattr(ts_mod, "_CRITICAL_SECONDS", 300.0)
        _register_running(js, "job-1")
        # 3 samples spanning 65 seconds, all at step=42
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        findings = run_training_stalled_detection()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "training_stalled"
        assert alert.severity == "WARNING"
        assert alert.source == "CENTRAL"
        assert alert.confidence == 1.0
        assert alert.job_id == "job-1"
        assert alert.evidence["step"] == "42"
        assert float(alert.evidence["stalled_seconds"]) >= 60.0
        assert als.count == 1

    def test_missing_fresh_training_sample_warns_when_node_still_alive(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        monkeypatch.setattr(ts_mod, "_CRITICAL_SECONDS", 300.0)
        monkeypatch.setattr(ts_mod, "_NODE_FRESH_SECONDS", 30.0)
        now_ms = 1_000_000_120_000
        monkeypatch.setattr(ts_mod.time, "time", lambda: now_ms / 1000)
        _register_running(js, "job-1")
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", step=42, ts=now_ms - 70_000)
            )
        )
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", ts=now_ms - 1_000)]
            )
        )

        findings = run_training_stalled_detection()

        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "training_stalled"
        assert alert.severity == "WARNING"
        assert alert.evidence["stalled_mode"] == "no_fresh_training_sample"
        assert float(alert.evidence["stalled_seconds"]) >= 60.0
        assert als.count == 1

    def test_missing_fresh_training_sample_skips_when_node_stale(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        monkeypatch.setattr(ts_mod, "_NODE_FRESH_SECONDS", 30.0)
        now_ms = 1_000_000_120_000
        monkeypatch.setattr(ts_mod.time, "time", lambda: now_ms / 1000)
        _register_running(js, "job-1")
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", step=42, ts=now_ms - 70_000)
            )
        )
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", ts=now_ms - 40_000)]
            )
        )

        findings = run_training_stalled_detection()

        assert findings == []
        assert als.count == 0

    def test_stalled_critical_after_critical_threshold(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        monkeypatch.setattr(ts_mod, "_CRITICAL_SECONDS", 300.0)
        _register_running(js, "job-1")
        # 4 samples spanning 350 seconds at step=99
        _ingest_steps(ms, "node-1", step=99, count=4, start_ts=1_000_000_000_000, interval_ms=120_000)
        findings = run_training_stalled_detection()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.severity == "CRITICAL"
        assert float(alert.evidence["stalled_seconds"]) >= 300.0

    def test_short_stall_no_alert(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        _register_running(js, "job-1")
        # 3 samples spanning only 20 seconds at the same step
        _ingest_steps(ms, "node-1", step=10, count=3, start_ts=1_000_000_000_000, interval_ms=10_000)
        findings = run_training_stalled_detection()
        assert findings == []
        assert als.count == 0

    def test_too_few_samples_skips(self, fresh_stores, monkeypatch):
        ms, _, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_MIN_SAMPLES", 3)
        _register_running(js, "job-1")
        # Only 2 samples — below the minimum needed to declare stall
        _ingest_steps(ms, "node-1", step=10, count=2, start_ts=1_000_000_000_000, interval_ms=120_000)
        findings = run_training_stalled_detection()
        assert findings == []

    def test_job_not_running_skips(self, fresh_stores, monkeypatch):
        ms, _, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        js.register(job_id="job-1", config={}, node_ids=["node-1"])
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        js.update_status("job-1", "completed")
        findings = run_training_stalled_detection()
        assert findings == []

    def test_unknown_job_skips(self, fresh_stores, monkeypatch):
        ms, _, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        # No job registered at all — training metric carries job_id "job-1"
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        findings = run_training_stalled_detection()
        assert findings == []

    def test_missing_status_key_does_not_crash(self, fresh_stores, monkeypatch):
        """If JobStore.get returns a dict without 'status' (pre-anna branch), we skip cleanly."""
        ms, _, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        # Stub get() to return a dict without 'status' to simulate older JobStore shape.
        monkeypatch.setattr(js, "get", lambda jid: {"job_id": jid, "node_ids": ["node-1"]})
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        findings = run_training_stalled_detection()
        assert findings == []

    def test_dedup_suppresses_repeat(self, fresh_stores, monkeypatch):
        ms, als, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        monkeypatch.setattr(ts_mod, "_DEDUP_COOLDOWN_SECONDS", 60.0)
        _register_running(js, "job-1")
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        first = run_training_stalled_detection()
        assert len(first) == 1
        second = run_training_stalled_detection()
        assert second == []
        assert als.count == 1

    def test_step_advance_clears_state(self, fresh_stores, monkeypatch):
        ms, _, _, js, *_ = fresh_stores
        ts_mod._last_alerted.clear()
        monkeypatch.setattr(ts_mod, "_WARN_SECONDS", 60.0)
        _register_running(js, "job-1")
        _ingest_steps(ms, "node-1", step=42, count=3, start_ts=1_000_000_000_000, interval_ms=32_500)
        first = run_training_stalled_detection()
        assert len(first) == 1
        # Step advances — fresh sample should clear the stall and new stalls re-emit
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", step=43, ts=1_000_000_065_001)
            )
        )
        # Now stall again at step=43 for >60s
        _ingest_steps(ms, "node-1", step=43, count=3, start_ts=1_000_000_100_000, interval_ms=32_500)
        ts_mod._last_alerted.clear()  # cooldown skip
        second = run_training_stalled_detection()
        assert len(second) == 1
        assert second[0].alert.evidence["step"] == "43"
