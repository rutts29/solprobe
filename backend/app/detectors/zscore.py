"""Z-Score anomaly detector.

Computes rolling z-scores over configurable time windows for key metrics.
If abs(z-score) > 3.0 for any metric, generates a CENTRAL alert.

Runs every 10 seconds over MetricsStore data.
"""

from __future__ import annotations

import logging
import time
import uuid

import numpy as np

from app.detectors.config import detection_config as _cfg
from app.models.alerts import AlertModel, AnomalyModel
from app.stores import alert_store, anomaly_store, metrics_store

logger = logging.getLogger(__name__)

_GPU_FIELDS = _cfg.zscore_gpu_fields
_TRAINING_FIELDS = _cfg.zscore_training_fields
_ZSCORE_THRESHOLD = _cfg.zscore_threshold
_WINDOWS = _cfg.zscore_windows_minutes

# Human-readable alert type mapping
_FIELD_TO_ALERT_TYPE: dict[str, str] = {
    "gpu_temp_c": "thermal_throttle",
    "gpu_utilization_pct": "clock_throttle",
    "gradient_norm": "gradient_explosion",
    "loss": "loss_spike",
    "throughput_tps": "straggler_detected",
}

_FIELD_TO_SEVERITY: dict[str, str] = {
    "gpu_temp_c": "WARNING",
    "gradient_norm": "CRITICAL",
    "loss": "CRITICAL",
    "throughput_tps": "WARNING",
}

# Deduplication: suppress repeat alerts for the same (node_id, alert_type) within 60s
_last_alerted: dict[tuple[str, str], float] = {}
_DEDUP_COOLDOWN_SECONDS = _cfg.zscore_dedup_cooldown_seconds


def _compute_zscore(values: list[float]) -> float | None:
    """Compute the z-score of the last value relative to the baseline (all but last).

    Returns None if there are fewer than 30 data points or zero variance.
    """
    if len(values) < _cfg.zscore_min_samples:
        return None
    arr = np.array(values, dtype=np.float64)
    baseline = arr[:-1]
    mean = float(np.mean(baseline))
    std = float(np.std(baseline))
    if std < 1e-9:
        return None
    return (float(arr[-1]) - mean) / std


def _make_alert(
    node_id: str,
    field: str,
    z: float,
    window_minutes: int,
) -> tuple[AlertModel, AnomalyModel]:
    """Create an AlertModel and AnomalyModel from a z-score finding."""
    confidence = min(1.0, abs(z) / 5.0)
    alert = AlertModel(
        alert_id=str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(time.time() * 1000),
        severity=_FIELD_TO_SEVERITY.get(field, "WARNING"),
        source="CENTRAL",
        alert_type=_FIELD_TO_ALERT_TYPE.get(field, "unspecified"),
        description=(
            f"Z-score anomaly on {field}: z={z:.2f} "
            f"(window={window_minutes}min, threshold={_ZSCORE_THRESHOLD})"
        ),
        confidence=confidence,
        evidence={
            "detector": "zscore",
            "field": field,
            "z_score": f"{z:.4f}",
            "window_minutes": str(window_minutes),
        },
    )
    anomaly = AnomalyModel(
        alert=alert,
        detector_name="zscore",
        window_minutes=window_minutes,
        raw_score=z,
    )
    return alert, anomaly


def run_zscore_detection() -> list[AnomalyModel]:
    """Run z-score detection across all nodes and monitored fields.

    Returns a list of generated anomalies (empty if none triggered).
    Called periodically (every 10 seconds) from the main event loop.
    """
    findings: list[AnomalyModel] = []
    node_ids = metrics_store.get_node_ids()

    for node_id in node_ids:
        for window in _WINDOWS:
            # GPU metrics
            for field in _GPU_FIELDS:
                values = metrics_store.get_gpu_metric_series(node_id, field, window)
                z = _compute_zscore(values)
                if z is not None and abs(z) > _ZSCORE_THRESHOLD:
                    alert_type = _FIELD_TO_ALERT_TYPE.get(field, "unspecified")
                    dedup_key = (node_id, alert_type)
                    now = time.time()
                    if dedup_key in _last_alerted and (now - _last_alerted[dedup_key]) < _DEDUP_COOLDOWN_SECONDS:
                        logger.debug(
                            "Z-score alert suppressed (dedup): node=%s type=%s cooldown_remaining=%.1fs",
                            node_id, alert_type, _DEDUP_COOLDOWN_SECONDS - (now - _last_alerted[dedup_key]),
                        )
                        continue
                    _last_alerted[dedup_key] = now
                    alert, anomaly = _make_alert(node_id, field, z, window)
                    alert_store.add(alert)
                    anomaly_store.add(anomaly.model_dump())
                    findings.append(anomaly)
                    logger.warning(
                        "Z-score alert: node=%s field=%s z=%.2f window=%dmin",
                        node_id, field, z, window,
                    )

            # Training metrics
            for field in _TRAINING_FIELDS:
                values = metrics_store.get_training_metric_series(node_id, field, window)
                z = _compute_zscore(values)
                if z is not None and abs(z) > _ZSCORE_THRESHOLD:
                    alert_type = _FIELD_TO_ALERT_TYPE.get(field, "unspecified")
                    dedup_key = (node_id, alert_type)
                    now = time.time()
                    if dedup_key in _last_alerted and (now - _last_alerted[dedup_key]) < _DEDUP_COOLDOWN_SECONDS:
                        logger.debug(
                            "Z-score alert suppressed (dedup): node=%s type=%s cooldown_remaining=%.1fs",
                            node_id, alert_type, _DEDUP_COOLDOWN_SECONDS - (now - _last_alerted[dedup_key]),
                        )
                        continue
                    _last_alerted[dedup_key] = now
                    alert, anomaly = _make_alert(node_id, field, z, window)
                    alert_store.add(alert)
                    anomaly_store.add(anomaly.model_dump())
                    findings.append(anomaly)
                    logger.warning(
                        "Z-score alert: node=%s field=%s z=%.2f window=%dmin",
                        node_id, field, z, window,
                    )

    # Evict stale dedup entries to prevent unbounded growth
    cutoff = time.time() - _DEDUP_COOLDOWN_SECONDS * 2
    expired = [k for k, v in _last_alerted.items() if v < cutoff]
    for k in expired:
        del _last_alerted[k]

    return findings
