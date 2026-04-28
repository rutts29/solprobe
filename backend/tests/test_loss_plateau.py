"""Tests for the loss plateau detector."""

from __future__ import annotations

from app.detectors import loss_plateau as lp_mod
from app.detectors.loss_plateau import run_loss_plateau_detection
from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_training_metric


def _ingest_series(ms, node_id: str, *, losses: list[float], throughputs: list[float] | None = None, start_step: int = 1, start_ts: int = 1_000_000):
    if throughputs is None:
        throughputs = [100.0] * len(losses)
    assert len(losses) == len(throughputs)
    for i, (loss, tp) in enumerate(zip(losses, throughputs)):
        ms.ingest_batch(
            MetricsBatchModel(
                training=_make_training_metric(
                    node_id, loss=loss, throughput=tp, step=start_step + i, ts=start_ts + i * 1000
                )
            )
        )


class TestLossPlateauDetector:
    def test_no_nodes_no_findings(self, fresh_stores):
        lp_mod._last_alerted.clear()
        findings = run_loss_plateau_detection()
        assert findings == []

    def test_warmup_skipped(self, fresh_stores):
        ms, als, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        # Only 15 steps — within warmup window (default 20)
        _ingest_series(ms, "node-1", losses=[2.0] * 15)
        findings = run_loss_plateau_detection()
        assert findings == []
        assert als.count == 0

    def test_too_few_samples_skipped(self, fresh_stores):
        ms, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        # Past warmup but fewer than the plateau window
        _ingest_series(ms, "node-1", losses=[3.0 - 0.01 * i for i in range(30)])
        findings = run_loss_plateau_detection()
        # 30 samples is < default plateau window of 50 — no decision
        assert findings == []

    def test_decreasing_loss_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        # Strongly decreasing loss over 70 steps — slope is large negative
        _ingest_series(ms, "node-1", losses=[5.0 - 0.05 * i for i in range(70)])
        findings = run_loss_plateau_detection()
        assert findings == []
        assert als.count == 0

    def test_flat_loss_with_normal_throughput_alerts(self, fresh_stores):
        ms, als, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        # 70 samples: loss is essentially flat (tiny noise), throughput is normal
        losses = [2.0 + (i % 3) * 1e-6 for i in range(70)]
        _ingest_series(ms, "node-1", losses=losses, throughputs=[100.0] * 70)
        findings = run_loss_plateau_detection()
        assert len(findings) == 1
        alert = findings[0].alert
        assert alert.alert_type == "loss_plateau"
        assert alert.severity == "WARNING"
        assert alert.source == "CENTRAL"
        assert alert.job_id == "job-1"
        assert 0.7 <= alert.confidence <= 0.9
        assert "slope" in alert.evidence
        assert als.count == 1

    def test_flat_loss_with_collapsed_throughput_no_alert(self, fresh_stores):
        ms, als, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        # Flat loss, but throughput dropped to near zero — could be stalled, not plateau
        losses = [2.0 + (i % 3) * 1e-6 for i in range(70)]
        throughputs = [100.0] * 30 + [0.001] * 40  # recent window collapsed
        _ingest_series(ms, "node-1", losses=losses, throughputs=throughputs)
        findings = run_loss_plateau_detection()
        # We do not want to fire plateau when training has effectively stalled.
        assert findings == []
        assert als.count == 0

    def test_dedup_suppresses_repeat(self, fresh_stores):
        ms, als, *_ = fresh_stores
        lp_mod._last_alerted.clear()
        losses = [2.0 + (i % 3) * 1e-6 for i in range(70)]
        _ingest_series(ms, "node-1", losses=losses)
        first = run_loss_plateau_detection()
        assert len(first) == 1
        second = run_loss_plateau_detection()
        assert second == []
        assert als.count == 1
