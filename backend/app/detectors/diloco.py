"""DiLoCo-specific anomaly detector.

Monitors DiLoCo distributed training patterns:
  - Inner/outer loss divergence
  - Pseudo-gradient norm drift across workers
  - Sync duration spikes

Runs every time an outer_step increment is detected (checked every 15s).
"""

from __future__ import annotations

import logging
import time
import uuid

import numpy as np

from app.models.alerts import AlertModel, AnomalyModel
from app.stores import alert_store, anomaly_store, metrics_store

logger = logging.getLogger(__name__)

# Thresholds
_DIVERGENCE_OUTER_STEPS = 3  # require 3+ outer steps of divergence
_SYNC_SPIKE_FACTOR = 2.0  # sync_duration > 2x historical mean
_ZSCORE_THRESHOLD = 3.0  # for pseudo-grad norm drift

# Track last-seen outer_step per node to detect increments
_last_outer_step: dict[str, int] = {}


def _detect_inner_outer_divergence(node_id: str, window_minutes: int = 30) -> AnomalyModel | None:
    """Detect when inner_loss decreases but outer_loss increases over 3+ outer steps.

    This suggests the local model is learning patterns that do not generalize
    to the global objective.
    """
    history = metrics_store.get_diloco_history(node_id, window_minutes)
    if len(history) < _DIVERGENCE_OUTER_STEPS + 1:
        return None

    # Group by outer_step and take the latest entry per step
    by_step: dict[int, tuple[float, float]] = {}
    for m in history:
        by_step[m.outer_step] = (m.inner_loss, m.outer_loss)

    steps_sorted = sorted(by_step.keys())
    if len(steps_sorted) < _DIVERGENCE_OUTER_STEPS + 1:
        return None

    # Check the last N+1 outer steps for divergence
    recent = steps_sorted[-(_DIVERGENCE_OUTER_STEPS + 1):]
    divergent_count = 0
    for i in range(1, len(recent)):
        prev_inner, prev_outer = by_step[recent[i - 1]]
        curr_inner, curr_outer = by_step[recent[i]]
        if curr_inner < prev_inner and curr_outer > prev_outer:
            divergent_count += 1

    if divergent_count < _DIVERGENCE_OUTER_STEPS:
        return None

    first_inner, first_outer = by_step[recent[0]]
    last_inner, last_outer = by_step[recent[-1]]

    alert = AlertModel(
        alert_id=str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(time.time() * 1000),
        severity="CRITICAL",
        source="CENTRAL",
        alert_type="inner_outer_divergence",
        description=(
            f"Inner loss decreasing ({first_inner:.4f} -> {last_inner:.4f}) "
            f"while outer loss increasing ({first_outer:.4f} -> {last_outer:.4f}) "
            f"over {divergent_count} outer steps"
        ),
        confidence=min(1.0, divergent_count / 5.0),
        evidence={
            "detector": "diloco",
            "inner_loss_start": f"{first_inner:.6f}",
            "inner_loss_end": f"{last_inner:.6f}",
            "outer_loss_start": f"{first_outer:.6f}",
            "outer_loss_end": f"{last_outer:.6f}",
            "divergent_steps": str(divergent_count),
        },
    )
    anomaly = AnomalyModel(
        alert=alert,
        detector_name="diloco",
        window_minutes=window_minutes,
        raw_score=float(divergent_count),
    )
    alert_store.add(alert)
    anomaly_store.add(anomaly.model_dump())
    logger.warning("Inner/outer divergence on node=%s over %d steps", node_id, divergent_count)
    return anomaly


def _detect_pseudo_grad_divergence(window_minutes: int = 15) -> list[AnomalyModel]:
    """Z-score on pseudo_grad_norm across all workers.

    If one worker's pseudo-gradient norm deviates significantly from the
    cluster, it may indicate data distribution issues or a failing worker.
    """
    node_ids = metrics_store.get_node_ids()
    if len(node_ids) < 2:
        return []

    # Gather latest pseudo_grad_norm per node
    node_norms: dict[str, float] = {}
    for node_id in node_ids:
        history = metrics_store.get_diloco_history(node_id, window_minutes)
        if history:
            norms = [m.pseudo_grad_norm for m in history if m.pseudo_grad_norm > 0]
            if norms:
                node_norms[node_id] = float(np.mean(norms[-30:]))

    if len(node_norms) < 2:
        return []

    values = np.array(list(node_norms.values()), dtype=np.float64)
    mean = float(np.mean(values))
    std = float(np.std(values))
    if std < 1e-9:
        return []

    findings: list[AnomalyModel] = []
    for node_id, norm in node_norms.items():
        z = (norm - mean) / std
        if abs(z) > _ZSCORE_THRESHOLD:
            confidence = min(1.0, abs(z) / 5.0)
            alert = AlertModel(
                alert_id=str(uuid.uuid4()),
                node_id=node_id,
                timestamp_ms=int(time.time() * 1000),
                severity="WARNING",
                source="CENTRAL",
                alert_type="pseudo_grad_divergence",
                description=(
                    f"Pseudo-gradient norm ({norm:.4f}) deviates from cluster "
                    f"(mean={mean:.4f}, std={std:.4f}, z={z:.2f})"
                ),
                confidence=confidence,
                evidence={
                    "detector": "diloco",
                    "pseudo_grad_norm": f"{norm:.6f}",
                    "cluster_mean": f"{mean:.6f}",
                    "cluster_std": f"{std:.6f}",
                    "z_score": f"{z:.4f}",
                },
            )
            anomaly = AnomalyModel(
                alert=alert,
                detector_name="diloco",
                window_minutes=window_minutes,
                raw_score=z,
            )
            alert_store.add(alert)
            anomaly_store.add(anomaly.model_dump())
            findings.append(anomaly)
            logger.warning(
                "Pseudo-grad divergence: node=%s z=%.2f", node_id, z,
            )

    return findings


def _detect_sync_duration_spikes(node_id: str, window_minutes: int = 15) -> AnomalyModel | None:
    """Detect if sync_duration_ms is more than 2x the historical mean."""
    history = metrics_store.get_diloco_history(node_id, window_minutes)
    if len(history) < 5:
        return None

    durations = [m.sync_duration_ms for m in history if m.sync_duration_ms > 0]
    if len(durations) < 5:
        return None

    arr = np.array(durations, dtype=np.float64)
    hist_mean = float(np.mean(arr[:-1]))
    if hist_mean < 1e-9:
        return None

    latest = durations[-1]
    ratio = latest / hist_mean
    if ratio <= _SYNC_SPIKE_FACTOR:
        return None

    alert = AlertModel(
        alert_id=str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(time.time() * 1000),
        severity="WARNING",
        source="CENTRAL",
        alert_type="diloco_sync_drift",
        description=(
            f"Sync duration spike: {latest:.1f}ms is {ratio:.1f}x "
            f"the historical mean ({hist_mean:.1f}ms)"
        ),
        confidence=min(1.0, (ratio - 1.0) / 3.0),
        evidence={
            "detector": "diloco",
            "sync_duration_ms": f"{latest:.2f}",
            "historical_mean_ms": f"{hist_mean:.2f}",
            "spike_ratio": f"{ratio:.4f}",
        },
    )
    anomaly = AnomalyModel(
        alert=alert,
        detector_name="diloco",
        window_minutes=window_minutes,
        raw_score=ratio,
    )
    alert_store.add(alert)
    anomaly_store.add(anomaly.model_dump())
    logger.warning("Sync duration spike: node=%s ratio=%.1fx", node_id, ratio)
    return anomaly


def run_diloco_detection() -> list[AnomalyModel]:
    """Run all DiLoCo-specific detection checks.

    Called every 15 seconds from the main event loop.
    """
    findings: list[AnomalyModel] = []
    node_ids = metrics_store.get_node_ids()

    for node_id in node_ids:
        # Check for outer_step increment (trigger-based detection)
        history = metrics_store.get_diloco_history(node_id, window_minutes=1)
        if not history:
            continue

        current_outer = history[-1].outer_step
        prev_outer = _last_outer_step.get(node_id, -1)

        if current_outer < prev_outer:
            # Node restarted — reset tracking
            _last_outer_step[node_id] = current_outer
            continue

        if current_outer > prev_outer:
            _last_outer_step[node_id] = current_outer

            # Run inner/outer divergence check
            result = _detect_inner_outer_divergence(node_id)
            if result is not None:
                findings.append(result)

            # Run sync duration spike check
            result = _detect_sync_duration_spikes(node_id)
            if result is not None:
                findings.append(result)

    # Cross-worker pseudo-gradient divergence (not per-node)
    findings.extend(_detect_pseudo_grad_divergence())

    return findings
