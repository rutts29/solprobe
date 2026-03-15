"""Tests for cross-node correlation detector."""

from __future__ import annotations

import time

from app.detectors.cross_node import run_cross_node_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_alert, _make_training_metric


class TestStragglerDetection:
    def test_single_node_no_detection(self, fresh_stores):
        ms, *_ = fresh_stores
        # Need at least 2 nodes for straggler detection
        for i in range(30):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", throughput=100.0, step=i, ts=1000 + i)
                )
            )
        findings = run_cross_node_detection()
        assert findings == []

    def test_equal_throughput_no_straggler(self, fresh_stores):
        ms, *_ = fresh_stores
        for nid in ["node-1", "node-2", "node-3"]:
            for i in range(30):
                ms.ingest_batch(
                    MetricsBatchModel(
                        training=_make_training_metric(
                            nid, throughput=100.0, step=i, ts=1000 + i
                        )
                    )
                )
        findings = run_cross_node_detection()
        # No stragglers if all equal; correlated failures also need alerts
        straggler_findings = [
            f for f in findings if f.alert.alert_type == "straggler_detected"
        ]
        assert straggler_findings == []

    def test_straggler_detected(self, fresh_stores):
        ms, als, *_ = fresh_stores
        # node-1 and node-2 at 100 tok/s, node-3 at 50 tok/s (50% of mean ~83)
        for i in range(30):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", throughput=100.0, step=i, ts=1000 + i)
                )
            )
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-2", throughput=100.0, step=i, ts=1000 + i)
                )
            )
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-3", throughput=50.0, step=i, ts=1000 + i)
                )
            )

        findings = run_cross_node_detection()
        straggler_findings = [
            f for f in findings if f.alert.alert_type == "straggler_detected"
        ]
        assert len(straggler_findings) >= 1
        straggler_nodes = {f.alert.node_id for f in straggler_findings}
        assert "node-3" in straggler_nodes

    def test_straggler_alert_fields(self, fresh_stores):
        ms, *_ = fresh_stores
        for i in range(30):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-1", throughput=100.0, step=i, ts=1000 + i)
                )
            )
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric("node-2", throughput=30.0, step=i, ts=1000 + i)
                )
            )

        findings = run_cross_node_detection()
        straggler_findings = [
            f for f in findings if f.alert.alert_type == "straggler_detected"
        ]
        assert len(straggler_findings) >= 1
        anomaly = straggler_findings[0]
        assert anomaly.detector_name == "cross_node"
        assert anomaly.alert.severity == "WARNING"
        assert "ratio" in anomaly.alert.evidence


class TestCorrelatedFailures:
    def test_no_alerts_no_correlation(self, fresh_stores):
        findings = run_cross_node_detection()
        assert findings == []

    def test_correlated_failures_detected(self, fresh_stores):
        _, als, *_ = fresh_stores
        now = int(time.time() * 1000)
        # Alerts from 2 different nodes within 30s window
        als.add(_make_alert(node_id="node-1", ts=now - 5000))
        als.add(_make_alert(node_id="node-2", ts=now - 3000))

        findings = run_cross_node_detection()
        correlation_findings = [
            f for f in findings if f.alert.alert_type == "nccl_timeout"
        ]
        assert len(correlation_findings) >= 1
        assert correlation_findings[0].alert.severity == "CRITICAL"
