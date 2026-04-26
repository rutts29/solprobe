"""Loss plateau detector.

After warmup, fits a simple linear regression of loss vs step over the
last `plateau_window_steps` samples. If the slope magnitude is below
`plateau_threshold` AND throughput in the same window is healthy (median
throughput in window >= median throughput across the longer baseline),
emit a WARNING. The throughput sanity check separates a true plateau —
where training is still humming — from a stall.
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

_WINDOW_STEPS = _cfg.plateau_window_steps
_WARMUP_STEPS = _cfg.plateau_warmup_steps
_THRESHOLD = _cfg.plateau_threshold
_BASELINE_WINDOW_STEPS = _cfg.plateau_baseline_window_steps
_DEDUP_COOLDOWN_SECONDS = _cfg.plateau_dedup_cooldown_seconds

_last_alerted: dict[str, float] = {}


def _linear_slope(steps: np.ndarray, values: np.ndarray) -> float:
    """Closed-form ordinary least squares slope of values vs steps."""
    s_mean = float(np.mean(steps))
    v_mean = float(np.mean(values))
    denom = float(np.sum((steps - s_mean) ** 2))
    if denom < 1e-12:
        return 0.0
    return float(np.sum((steps - s_mean) * (values - v_mean)) / denom)


def run_loss_plateau_detection() -> list[AnomalyModel]:
    """Detect flat-but-not-stalled training loss across the last `_WINDOW_STEPS` samples."""
    findings: list[AnomalyModel] = []
    now = time.time()

    # Pull a wide window so we have both the plateau slice and a baseline slice.
    minutes_needed = max(1, (_BASELINE_WINDOW_STEPS + _WINDOW_STEPS) // 60 + 2)

    for node_id in _stores.metrics_store.get_node_ids():
        history = _stores.metrics_store.get_training_history(node_id, window_minutes=minutes_needed)
        if not history:
            continue
        latest = history[-1]
        if latest.step <= _WARMUP_STEPS:
            continue
        if len(history) < _WINDOW_STEPS:
            continue

        window = history[-_WINDOW_STEPS:]
        steps = np.array([m.step for m in window], dtype=np.float64)
        losses = np.array([m.loss for m in window], dtype=np.float64)
        throughputs_window = np.array([m.throughput_tps for m in window], dtype=np.float64)

        slope = _linear_slope(steps, losses)
        if abs(slope) >= _THRESHOLD:
            continue

        window_tp_median = float(np.median(throughputs_window))
        # Baseline excludes the plateau window so a collapsed window does not
        # drag the comparison value down with it.
        before_window = history[:-_WINDOW_STEPS]
        if before_window:
            baseline_slice = before_window[-_BASELINE_WINDOW_STEPS:]
            baseline_tp_median = float(np.median([m.throughput_tps for m in baseline_slice]))
        else:
            baseline_tp_median = window_tp_median
        # Sanity: training must still be progressing at normal speed.
        if window_tp_median <= 0:
            continue
        if window_tp_median < baseline_tp_median:
            continue

        dedup_key = node_id
        prev = _last_alerted.get(dedup_key)
        if prev is not None and (now - prev) < _DEDUP_COOLDOWN_SECONDS:
            continue
        _last_alerted[dedup_key] = now

        # Confidence scales with how far below the threshold the slope sits.
        # 0.7 at threshold, 0.9 at slope == 0.
        ratio = min(1.0, abs(slope) / max(_THRESHOLD, 1e-12))
        confidence = round(0.9 - 0.2 * ratio, 4)

        alert = AlertModel(
            alert_id=str(uuid.uuid4()),
            node_id=node_id,
            timestamp_ms=int(now * 1000),
            severity="WARNING",
            source="CENTRAL",
            alert_type="loss_plateau",
            description=(
                f"Loss plateau on node {node_id}: slope={slope:.2e} over "
                f"{_WINDOW_STEPS} steps (threshold={_THRESHOLD:.0e})"
            ),
            confidence=confidence,
            evidence={
                "detector": "loss_plateau",
                "slope": f"{slope:.6e}",
                "threshold": f"{_THRESHOLD:.6e}",
                "window_steps": str(_WINDOW_STEPS),
                "warmup_steps": str(_WARMUP_STEPS),
                "throughput_median_window": f"{window_tp_median:.4f}",
                "throughput_median_baseline": f"{baseline_tp_median:.4f}",
                "step_start": str(int(steps[0])),
                "step_end": str(int(steps[-1])),
            },
            job_id=latest.job_id or None,
        )
        anomaly = AnomalyModel(
            alert=alert,
            detector_name="loss_plateau",
            window_minutes=max(1, _WINDOW_STEPS // 60),
            raw_score=slope,
        )
        _stores.alert_store.add(alert)
        _stores.anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
        logger.warning(
            "Loss plateau: node=%s slope=%.2e window_steps=%d", node_id, slope, _WINDOW_STEPS,
        )

    cutoff = now - _DEDUP_COOLDOWN_SECONDS * 2
    for k in [k for k, v in _last_alerted.items() if v < cutoff]:
        del _last_alerted[k]

    return findings
