"""Numeric instability detector.

Scans the latest TrainingMetrics for each node. If any monitored field is
NaN, +Inf, or -Inf, emits a CRITICAL alert. Each (node_id, step) pair is
only emitted once to avoid spamming when the same broken sample sits at
the head of the buffer across multiple detector ticks.
"""

from __future__ import annotations

import logging
import math
import time
import uuid

from app.detectors.config import detection_config as _cfg
from app.models.alerts import AlertModel, AnomalyModel
from app import stores as _stores

logger = logging.getLogger(__name__)

_FIELDS = _cfg.numeric_instability_fields

# Bounded set of (node_id, step) pairs we've already emitted for.
# Prevents re-emit for the same broken sample on each detector tick.
_emitted_steps: set[tuple[str, int]] = set()
_MAX_EMITTED_STEPS = 4096


def _evict_if_full() -> None:
    """Drop ~half the dedup set when it fills. Set.pop() removes an arbitrary
    element, which is acceptable here: stale entries are functionally
    equivalent and the goal is just to keep the set bounded."""
    if len(_emitted_steps) > _MAX_EMITTED_STEPS:
        for _ in range(_MAX_EMITTED_STEPS // 2):
            _emitted_steps.pop()


def run_numeric_instability_detection() -> list[AnomalyModel]:
    """Inspect the latest training metric for each node and emit on non-finite values."""
    findings: list[AnomalyModel] = []
    for node_id in _stores.metrics_store.get_node_ids():
        history = _stores.metrics_store.get_training_history(node_id, window_minutes=1)
        if not history:
            continue
        latest = history[-1]

        bad: list[str] = []
        for field in _FIELDS:
            value = getattr(latest, field, 0.0)
            if not math.isfinite(value):
                bad.append(field)
        if not bad:
            continue

        dedup_key = (node_id, latest.step)
        if dedup_key in _emitted_steps:
            continue
        _emitted_steps.add(dedup_key)
        _evict_if_full()

        bad_values = {f: repr(getattr(latest, f)) for f in bad}
        alert = AlertModel(
            alert_id=str(uuid.uuid4()),
            node_id=node_id,
            timestamp_ms=int(time.time() * 1000),
            severity="CRITICAL",
            source="CENTRAL",
            alert_type="numeric_instability",
            description=(
                f"Non-finite training metric on node {node_id} at step {latest.step}: "
                f"{', '.join(f'{f}={bad_values[f]}' for f in bad)}"
            ),
            confidence=1.0,
            evidence={
                "detector": "numeric_instability",
                "non_finite_fields": ",".join(bad),
                "step": str(latest.step),
                **{f"value_{f}": bad_values[f] for f in bad},
            },
            job_id=latest.job_id or None,
        )
        anomaly = AnomalyModel(
            alert=alert,
            detector_name="numeric_instability",
            window_minutes=1,
            raw_score=float(len(bad)),
        )
        _stores.alert_store.add(alert)
        _stores.anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
        logger.error(
            "Numeric instability: node=%s step=%d fields=%s",
            node_id, latest.step, bad,
        )
    return findings
