"""Tests for the numeric instability detector."""

from __future__ import annotations

import math

from app.detectors import numeric_instability as nim
from app.detectors.numeric_instability import run_numeric_instability_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_training_metric


class TestNumericInstabilityDetector:
    def test_no_nodes_no_findings(self, fresh_stores):
        nim._emitted_steps.clear()
        findings = run_numeric_instability_detection()
        assert findings == []

    def test_finite_metrics_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-1", loss=2.5, step=1, ts=1000))
        )
        findings = run_numeric_instability_detection()
        assert findings == []
        assert als.count == 0

    def test_nan_loss_triggers_critical_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", loss=math.nan, step=5, ts=1000)
            )
        )
        findings = run_numeric_instability_detection()
        assert len(findings) == 1
        anomaly = findings[0]
        assert anomaly.alert.alert_type == "numeric_instability"
        assert anomaly.alert.severity == "CRITICAL"
        assert anomaly.alert.source == "CENTRAL"
        assert anomaly.alert.confidence == 1.0
        assert anomaly.alert.node_id == "node-1"
        assert anomaly.alert.job_id == "job-1"
        assert "loss" in anomaly.alert.evidence.get("non_finite_fields", "")
        assert anomaly.alert.evidence.get("step") == "5"
        assert als.count == 1

    def test_inf_gradient_norm_triggers_alert(self, fresh_stores):
        ms, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", grad_norm=math.inf, step=7, ts=1000)
            )
        )
        findings = run_numeric_instability_detection()
        assert len(findings) == 1
        assert "gradient_norm" in findings[0].alert.evidence["non_finite_fields"]

    def test_negative_inf_throughput_triggers_alert(self, fresh_stores):
        ms, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric("node-1", throughput=-math.inf, step=2, ts=1000)
            )
        )
        findings = run_numeric_instability_detection()
        assert len(findings) == 1
        assert "throughput_tps" in findings[0].alert.evidence["non_finite_fields"]

    def test_multiple_non_finite_fields_listed(self, fresh_stores):
        ms, *_ = fresh_stores
        nim._emitted_steps.clear()
        m = _make_training_metric("node-1", loss=math.nan, grad_norm=math.inf, step=9, ts=1000)
        ms.ingest_batch(MetricsBatchModel(training=m))
        findings = run_numeric_instability_detection()
        assert len(findings) == 1
        fields = findings[0].alert.evidence["non_finite_fields"]
        assert "loss" in fields
        assert "gradient_norm" in fields

    def test_no_double_emit_for_same_node_step(self, fresh_stores):
        ms, als, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-1", loss=math.nan, step=12, ts=1000))
        )
        findings1 = run_numeric_instability_detection()
        assert len(findings1) == 1
        findings2 = run_numeric_instability_detection()
        assert findings2 == []
        assert als.count == 1

    def test_new_step_re_emits(self, fresh_stores):
        ms, als, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-1", loss=math.nan, step=12, ts=1000))
        )
        run_numeric_instability_detection()
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-1", loss=math.nan, step=13, ts=1100))
        )
        findings = run_numeric_instability_detection()
        assert len(findings) == 1
        assert als.count == 2

    def test_per_node_isolation(self, fresh_stores):
        ms, *_ = fresh_stores
        nim._emitted_steps.clear()
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-1", loss=math.nan, step=5, ts=1000))
        )
        ms.ingest_batch(
            MetricsBatchModel(training=_make_training_metric("node-2", loss=math.nan, step=5, ts=1000))
        )
        findings = run_numeric_instability_detection()
        assert len(findings) == 2
        nodes = {f.alert.node_id for f in findings}
        assert nodes == {"node-1", "node-2"}
