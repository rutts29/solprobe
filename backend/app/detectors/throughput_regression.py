"""Throughput regression detector.

Compares the median throughput of the most recent samples against the
median over an older baseline slice. If recent throughput has fallen
below `regression_ratio` of the baseline, emit a WARNING. This catches
sustained, gradual drops that the per-sample z-score detector ignores
because no single sample is an outlier.
"""

from __future__ import annotations

import logging
import time
import uuid

import numpy as np

from app.detectors.config import detection_config as _cfg
from app.models.alerts import AlertModel, AnomalyModel
from app import stores as _stores

logger = logging.getLogger(__name__)

_BASELINE_SAMPLES = _cfg.regression_baseline_samples
_RECENT_SAMPLES = _cfg.regression_recent_samples
_RATIO = _cfg.regression_ratio
_DEDUP_COOLDOWN_SECONDS = _cfg.regression_dedup_cooldown_seconds

_last_alerted: dict[str, float] = {}


def run_throughput_regression_detection() -> list[AnomalyModel]:
    """Detect sustained throughput drops on each node."""
    findings: list[AnomalyModel] = []
    now = time.time()

    minutes_needed = max(1, (_BASELINE_SAMPLES + _RECENT_SAMPLES) // 60 + 2)

    for node_id in _stores.metrics_store.get_node_ids():
        history = _stores.metrics_store.get_training_history(node_id, window_minutes=minutes_needed)
        # Need enough samples for a baseline (excluding the recent slice)
        if len(history) < _BASELINE_SAMPLES + _RECENT_SAMPLES:
            continue

        recent = history[-_RECENT_SAMPLES:]
        baseline = history[-(_BASELINE_SAMPLES + _RECENT_SAMPLES) : -_RECENT_SAMPLES]

        recent_tps = np.array([m.throughput_tps for m in recent], dtype=np.float64)
        baseline_tps = np.array([m.throughput_tps for m in baseline], dtype=np.float64)

        baseline_median = float(np.median(baseline_tps))
        recent_median = float(np.median(recent_tps))

        if baseline_median <= 0:
            continue
        if recent_median >= baseline_median * _RATIO:
            continue

        dedup_key = node_id
        prev = _last_alerted.get(dedup_key)
        if prev is not None and (now - prev) < _DEDUP_COOLDOWN_SECONDS:
            continue
        _last_alerted[dedup_key] = now

        actual_ratio = recent_median / baseline_median
        # Confidence: 0.7 just below threshold, 0.9 at half-baseline or worse.
        gap = max(0.0, _RATIO - actual_ratio)
        confidence = round(min(0.9, 0.7 + gap * 0.4), 4)

        latest = history[-1]
        alert = AlertModel(
            alert_id=str(uuid.uuid4()),
            node_id=node_id,
            timestamp_ms=int(now * 1000),
            severity="WARNING",
            source="CENTRAL",
            alert_type="throughput_regression",
            description=(
                f"Throughput regression on node {node_id}: recent median "
                f"{recent_median:.1f} tok/s is {actual_ratio:.0%} of baseline "
                f"{baseline_median:.1f} tok/s (threshold={_RATIO:.0%})"
            ),
            confidence=confidence,
            evidence={
                "detector": "throughput_regression",
                "recent_median": f"{recent_median:.4f}",
                "baseline_median": f"{baseline_median:.4f}",
                "ratio": f"{actual_ratio:.4f}",
                "threshold_ratio": f"{_RATIO:.4f}",
                "recent_samples": str(_RECENT_SAMPLES),
                "baseline_samples": str(_BASELINE_SAMPLES),
            },
            job_id=latest.job_id or None,
        )
        anomaly = AnomalyModel(
            alert=alert,
            detector_name="throughput_regression",
            window_minutes=max(1, _BASELINE_SAMPLES // 60),
            raw_score=actual_ratio,
        )
        _stores.alert_store.add(alert)
        _stores.anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
        logger.warning(
            "Throughput regression: node=%s ratio=%.2f recent=%.1f baseline=%.1f",
            node_id, actual_ratio, recent_median, baseline_median,
        )

    cutoff = now - _DEDUP_COOLDOWN_SECONDS * 2
    for k in [k for k, v in _last_alerted.items() if v < cutoff]:
        del _last_alerted[k]

    return findings
