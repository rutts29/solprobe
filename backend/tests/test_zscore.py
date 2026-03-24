"""Tests for z-score anomaly detector."""

from __future__ import annotations

import time
from unittest.mock import patch

from app.detectors.zscore import _compute_zscore, run_zscore_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_gpu_metric, _make_training_metric


class TestComputeZscore:
    def test_too_few_values(self):
        assert _compute_zscore([1.0, 2.0, 3.0]) is None

    def test_zero_variance(self):
        # 35 identical values → std=0 → returns None (not the length check)
        assert _compute_zscore([5.0] * 35) is None

    def test_normal_value(self):
        values = [50.0 + i * 0.1 for i in range(50)]
        z = _compute_zscore(values)
        assert z is not None
        assert abs(z) < 3.0  # last value is not anomalous

    def test_spike_detected(self):
        values = [50.0 + (i % 3) * 0.1 for i in range(49)] + [200.0]  # massive spike at end
        z = _compute_zscore(values)
        assert z is not None
        assert z > 3.0


class TestRunZscoreDetection:
    def test_no_nodes_no_findings(self, fresh_stores):
        findings = run_zscore_detection()
        assert findings == []

    def test_normal_data_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        # Populate with stable temperature data (slight variation so std != 0)
        for i in range(60):
            ms.ingest_batch(
                MetricsBatchModel(
                    gpu=[_make_gpu_metric("node-1", temp=55.0 + (i % 5) * 0.01, ts=1000 + i)]
                )
            )
        findings = run_zscore_detection()
        assert findings == []
        assert als.count == 0

    def test_temperature_spike_generates_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        # 59 normal readings with slight variation, then a huge spike
        for i in range(59):
            ms.ingest_batch(
                MetricsBatchModel(
                    gpu=[_make_gpu_metric("node-1", temp=55.0 + (i % 3) * 0.1, ts=1000 + i)]
                )
            )
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", temp=200.0, ts=1059)]
            )
        )

        findings = run_zscore_detection()
        assert len(findings) > 0
        # Should find thermal_throttle alert
        alert_types = {f.alert.alert_type for f in findings}
        assert "thermal_throttle" in alert_types
        assert als.count > 0

    def test_gradient_explosion(self, fresh_stores):
        ms, als, *_ = fresh_stores
        for i in range(59):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric(
                        "node-1", grad_norm=1.0 + (i % 3) * 0.01, step=i, ts=1000 + i
                    )
                )
            )
        # Gradient explosion
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric(
                    "node-1", grad_norm=500.0, step=59, ts=1059
                )
            )
        )

        findings = run_zscore_detection()
        assert len(findings) > 0
        alert_types = {f.alert.alert_type for f in findings}
        assert "gradient_explosion" in alert_types

    def test_findings_contain_anomaly_metadata(self, fresh_stores):
        ms, *_ = fresh_stores
        for i in range(59):
            ms.ingest_batch(
                MetricsBatchModel(
                    gpu=[_make_gpu_metric("node-1", temp=55.0 + (i % 3) * 0.1, ts=1000 + i)]
                )
            )
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", temp=200.0, ts=1059)]
            )
        )

        findings = run_zscore_detection()
        assert len(findings) > 0
        anomaly = findings[0]
        assert anomaly.detector_name == "zscore"
        assert anomaly.window_minutes in [5, 15, 60]
        assert anomaly.alert.confidence > 0.0
        assert anomaly.alert.source == "CENTRAL"

    def test_boundary_exactly_30_values(self, fresh_stores):
        """Exactly 30 values (minimum) should compute a valid z-score."""
        values = [50.0 + (i % 3) * 0.1 for i in range(29)] + [200.0]
        z = _compute_zscore(values)
        assert z is not None
        assert z > 3.0

    def test_boundary_29_values_returns_none(self, fresh_stores):
        values = [50.0 + (i % 3) * 0.1 for i in range(28)] + [200.0]
        assert _compute_zscore(values) is None

    def test_dedup_suppresses_repeat_alerts(self, fresh_stores):
        ms, als, *_ = fresh_stores
        # Populate with 59 normal + 1 spike
        for i in range(59):
            ms.ingest_batch(
                MetricsBatchModel(
                    gpu=[_make_gpu_metric("node-1", temp=55.0 + (i % 3) * 0.1, ts=1000 + i)]
                )
            )
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", temp=200.0, ts=1059)]
            )
        )

        # First detection should produce alerts
        findings1 = run_zscore_detection()
        assert len(findings1) > 0

        # Second detection immediately after should be suppressed (60s cooldown)
        findings2 = run_zscore_detection()
        thermal_findings2 = [f for f in findings2 if f.alert.alert_type == "thermal_throttle"]
        assert len(thermal_findings2) == 0

        # After advancing past cooldown, alerts should fire again
        from app.detectors import zscore as zscore_mod
        for key in list(zscore_mod._last_alerted):
            zscore_mod._last_alerted[key] = time.time() - 61
        findings3 = run_zscore_detection()
        thermal_findings3 = [f for f in findings3 if f.alert.alert_type == "thermal_throttle"]
        assert len(thermal_findings3) > 0
