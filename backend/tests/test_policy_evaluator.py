"""Tests for the policy evaluator."""

from __future__ import annotations

import pytest

from app import stores as stores_mod
from app.detectors import policy_evaluator as pe_mod
from app.detectors.policy_evaluator import run_policy_evaluation
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_gpu_metric, _make_training_metric


@pytest.fixture(autouse=True)
def _patch_policy_store(fresh_stores, monkeypatch):
    """Bind fresh PolicyStore onto app.stores so evaluator picks it up."""
    *_, pls = fresh_stores
    monkeypatch.setattr(stores_mod, "policy_store", pls)
    yield


def _ingest_training(ms, node_id: str, *, count: int, start_ts: int, interval_ms: int = 1000, **kwargs):
    for i in range(count):
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric(node_id, ts=start_ts + i * interval_ms, step=i, **kwargs)
            )
        )


def _make_policy(
    policy_id: str = "p1",
    *,
    source: str = "training",
    field: str = "gradient_norm",
    operator: str = "gt",
    threshold: float = 100.0,
    for_seconds: float = 0.0,
    severity: str = "WARNING",
    cooldown_seconds: float = 60.0,
    scope_node: str | None = None,
    scope_job: str | None = None,
    enabled: bool = True,
) -> dict:
    return {
        "policy_id": policy_id,
        "name": f"policy {policy_id}",
        "enabled": enabled,
        "scope": {"job_id": scope_job, "node_id": scope_node},
        "metric": {"source": source, "field": field},
        "condition": {
            "operator": operator,
            "threshold": threshold,
            "for_seconds": for_seconds,
        },
        "severity": severity,
        "cooldown_seconds": cooldown_seconds,
        "description": "test",
    }


class TestThresholdTrigger:
    def test_no_policies_no_alerts(self, fresh_stores):
        ms, als, *_ = fresh_stores
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert findings == []
        assert als.count == 0

    def test_gt_triggers_alert(self, fresh_stores):
        ms, als, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "policy_violation"
        assert alert.severity == "WARNING"
        assert alert.source == "CENTRAL"
        assert alert.evidence["policy_id"] == "p1"
        assert alert.evidence["field"] == "training.gradient_norm"
        assert alert.evidence["operator"] == "gt"
        assert float(alert.evidence["actual_value"]) == 200.0
        assert als.count == 1

    def test_gt_below_threshold_no_alert(self, fresh_stores):
        ms, als, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=50.0)
        findings = run_policy_evaluation()
        assert findings == []
        assert als.count == 0

    def test_lt_triggers_alert(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(field="throughput_tps", operator="lt", threshold=10.0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, throughput=5.0)
        findings = run_policy_evaluation()
        assert len(findings) == 1
        assert findings[0].alert.evidence["field"] == "training.throughput_tps"

    def test_abs_gt_triggers_alert(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(field="loss", operator="abs_gt", threshold=10.0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, loss=-15.0)
        findings = run_policy_evaluation()
        assert len(findings) == 1

    def test_disabled_policy_skipped(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(enabled=False))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert findings == []


class TestSustainedViolation:
    def test_for_seconds_satisfied(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, for_seconds=5.0, cooldown_seconds=0))
        # 6 samples spanning 6 seconds, all > 100
        _ingest_training(ms, "node-1", count=6, start_ts=1_000_000_000, interval_ms=1200, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert len(findings) == 1

    def test_for_seconds_not_satisfied(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, for_seconds=10.0, cooldown_seconds=0))
        # 3 samples spanning ~2 seconds — not enough
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, interval_ms=1000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert findings == []

    def test_violation_resets_when_below(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, for_seconds=5.0, cooldown_seconds=0))
        # 3 samples below, then 2 above — only the trailing 2 (~1s) count
        for i, gn in enumerate([50.0, 50.0, 50.0, 200.0, 200.0]):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", ts=1_000_000_000 + i * 1000, step=i, grad_norm=gn)
                )
            )
        findings = run_policy_evaluation()
        # Trailing window is only 1 second — under for_seconds=5
        assert findings == []


class TestCooldown:
    def test_repeat_within_cooldown_suppressed(self, fresh_stores):
        ms, als, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, cooldown_seconds=60.0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        first = run_policy_evaluation()
        assert len(first) == 1
        # Re-evaluate immediately — should be suppressed
        second = run_policy_evaluation()
        assert second == []
        assert als.count == 1


class TestScopeFiltering:
    def test_node_scope_only_target(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, scope_node="node-1", cooldown_seconds=0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        _ingest_training(ms, "node-2", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert len(findings) == 1
        assert findings[0].alert.node_id == "node-1"

    def test_job_scope_filters(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, scope_job="other-job", cooldown_seconds=0))
        # All training metrics emitted by _make_training_metric carry job_id="job-1"
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert findings == []

    def test_no_scope_evaluates_all_nodes(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(operator="gt", threshold=100.0, cooldown_seconds=0))
        _ingest_training(ms, "node-1", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        _ingest_training(ms, "node-2", count=3, start_ts=1_000_000_000, grad_norm=200.0)
        findings = run_policy_evaluation()
        assert len(findings) == 2


class TestStaleFor:
    def test_stale_step_triggers(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(
            _make_policy(
                field="step", operator="stale_for", for_seconds=60.0, cooldown_seconds=0,
            )
        )
        # 4 samples at the same step spanning 90 seconds
        for i in range(4):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", ts=1_000_000_000 + i * 30_000, step=42)
                )
            )
        findings = run_policy_evaluation()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "policy_violation"
        assert alert.evidence["operator"] == "stale_for"
        assert float(alert.evidence["duration_seconds"]) >= 60.0

    def test_advancing_step_no_alert(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(
            _make_policy(
                field="step", operator="stale_for", for_seconds=60.0, cooldown_seconds=0,
            )
        )
        # Advancing steps — never stale
        for i in range(4):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", ts=1_000_000_000 + i * 30_000, step=i)
                )
            )
        findings = run_policy_evaluation()
        assert findings == []

    def test_short_stall_no_alert(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(
            _make_policy(
                field="step", operator="stale_for", for_seconds=60.0, cooldown_seconds=0,
            )
        )
        # Same step but only ~3 seconds total
        for i in range(3):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", ts=1_000_000_000 + i * 1000, step=42)
                )
            )
        findings = run_policy_evaluation()
        assert findings == []


class TestGpuSource:
    def test_gpu_field_threshold(self, fresh_stores):
        ms, _, _, _, _, _, pls = fresh_stores
        pls.create(_make_policy(source="gpu", field="fb_used_mb", operator="gt", threshold=14000.0, cooldown_seconds=0))
        # _make_gpu_metric default is fb_used_mb=8000 — below threshold
        ms.ingest_batch(MetricsBatchModel(gpu=[_make_gpu_metric("node-1", ts=1_000_000_000)]))
        findings = run_policy_evaluation()
        assert findings == []
        # Now ingest a high one
        from app.models.metrics import GpuMetricsModel
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[
                    GpuMetricsModel(
                        node_id="node-1",
                        gpu_index=0,
                        gpu_model="T4",
                        timestamp_ms=1_000_000_000 + 1000,
                        fb_used_mb=15000.0,
                        fb_free_mb=1000.0,
                    )
                ]
            )
        )
        findings = run_policy_evaluation()
        assert len(findings) == 1
        assert findings[0].alert.evidence["field"] == "gpu.fb_used_mb"
