"""Tests for the throughput regression detector."""

from __future__ import annotations

from app.detectors import throughput_regression as tr_mod
from app.detectors.throughput_regression import run_throughput_regression_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_training_metric


def _ingest_throughputs(ms, node_id: str, throughputs: list[float], start_step: int = 1, start_ts: int = 1_000_000):
    for i, tp in enumerate(throughputs):
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric(
                    node_id, throughput=tp, step=start_step + i, ts=start_ts + i * 1000
                )
            )
        )


class TestThroughputRegressionDetector:
    def test_no_nodes_no_findings(self, fresh_stores):
        tr_mod._last_alerted.clear()
        findings = run_throughput_regression_detection()
        assert findings == []

    def test_too_few_samples_skips(self, fresh_stores):
        ms, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        _ingest_throughputs(ms, "node-1", [100.0] * 50)
        findings = run_throughput_regression_detection()
        # Default needs 200 samples; 50 is far short
        assert findings == []

    def test_steady_throughput_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        _ingest_throughputs(ms, "node-1", [100.0 + (i % 5) * 0.1 for i in range(220)])
        findings = run_throughput_regression_detection()
        assert findings == []
        assert als.count == 0

    def test_sustained_drop_alerts(self, fresh_stores):
        ms, als, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        # 200 baseline samples at 100 tok/s, then 30 recent samples at 50 tok/s
        baseline = [100.0] * 200
        recent = [50.0] * 30
        _ingest_throughputs(ms, "node-1", baseline + recent)
        findings = run_throughput_regression_detection()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "throughput_regression"
        assert alert.severity == "WARNING"
        assert alert.source == "CENTRAL"
        assert alert.job_id == "job-1"
        assert 0.7 <= alert.confidence <= 0.9
        assert float(alert.evidence["recent_median"]) < float(alert.evidence["baseline_median"])
        assert als.count == 1

    def test_drop_just_above_ratio_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        # 200 baseline at 100, 30 recent at 75 (75/100 = 0.75 > default 0.7 ratio)
        _ingest_throughputs(ms, "node-1", [100.0] * 200 + [75.0] * 30)
        findings = run_throughput_regression_detection()
        assert findings == []
        assert als.count == 0

    def test_zero_baseline_skips(self, fresh_stores):
        ms, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        _ingest_throughputs(ms, "node-1", [0.0] * 200 + [0.0] * 30)
        findings = run_throughput_regression_detection()
        assert findings == []

    def test_dedup_suppresses_repeat(self, fresh_stores):
        ms, als, *_ = fresh_stores
        tr_mod._last_alerted.clear()
        _ingest_throughputs(ms, "node-1", [100.0] * 200 + [40.0] * 30)
        first = run_throughput_regression_detection()
        assert len(first) == 1
        second = run_throughput_regression_detection()
        assert second == []
        assert als.count == 1
