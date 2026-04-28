"""Training stalled detector.

For each node with a `running` job, look at the recent training metrics
window. If the most recent N samples all share the same `step`, the job
has stopped advancing. We emit WARNING after `stalled_warn_seconds` and
escalate to CRITICAL after `stalled_critical_seconds`. Duration is
measured between the earliest and latest same-step samples in the run.
"""

from __future__ import annotations

import logging
import time
import uuid

from app.detectors.config import detection_config as _cfg
from app.models.alerts import AlertModel, AnomalyModel
from app import stores as _stores

logger = logging.getLogger(__name__)

_WARN_SECONDS = _cfg.stalled_warn_seconds
_CRITICAL_SECONDS = _cfg.stalled_critical_seconds
_MIN_SAMPLES = _cfg.stalled_min_samples
_DEDUP_COOLDOWN_SECONDS = _cfg.stalled_dedup_cooldown_seconds
_NODE_FRESH_SECONDS = _cfg.stalled_node_fresh_seconds

# Track last emit time per (node_id, step) so a steady stall does not spam.
_last_alerted: dict[tuple[str, int, str], float] = {}


def _job_is_running(job_id: str) -> bool:
    """Return True iff the job exists and its status is 'running'.

    Wrapped in try/except KeyError so older JobStore shapes (without a
    'status' field) gracefully report not-running instead of crashing.
    """
    entry = _stores.job_store.get(job_id)
    if entry is None:
        return False
    try:
        return entry["status"] == "running"
    except KeyError:
        return False


def _trailing_same_step_window(history) -> list:
    """Return the longest suffix of `history` whose entries share the latest step."""
    if not history:
        return []
    latest_step = history[-1].step
    window = []
    for m in reversed(history):
        if m.step != latest_step:
            break
        window.append(m)
    window.reverse()
    return window


def _node_is_fresh(node_id: str, now_ms: int) -> bool:
    """Return true when the node is still sending any fresh metric."""
    status = _stores.metrics_store.get_node_status(node_id)
    if status is None:
        return False
    age_seconds = (now_ms - status.last_seen_ms) / 1000.0
    return age_seconds <= _NODE_FRESH_SECONDS


def _make_alert(
    *,
    node_id: str,
    step: int,
    job_id: str,
    severity: str,
    stalled_seconds: float,
    samples_at_step: int,
    stalled_mode: str,
    now: float,
) -> AnomalyModel:
    alert = AlertModel(
        alert_id=str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(now * 1000),
        severity=severity,
        source="CENTRAL",
        alert_type="training_stalled",
        description=(
            f"Training step {step} on node {node_id} has not advanced "
            f"for {stalled_seconds:.1f}s ({samples_at_step} samples)"
        ),
        confidence=1.0,
        evidence={
            "detector": "training_stalled",
            "stalled_mode": stalled_mode,
            "step": str(step),
            "stalled_seconds": f"{stalled_seconds:.2f}",
            "samples_at_step": str(samples_at_step),
            "warn_seconds": f"{_WARN_SECONDS:.0f}",
            "critical_seconds": f"{_CRITICAL_SECONDS:.0f}",
        },
        job_id=job_id,
    )
    return AnomalyModel(
        alert=alert,
        detector_name="training_stalled",
        window_minutes=max(1, int(stalled_seconds / 60)),
        raw_score=stalled_seconds,
    )


def run_training_stalled_detection() -> list[AnomalyModel]:
    """Emit alerts for nodes whose running job has not advanced its step."""
    findings: list[AnomalyModel] = []
    now = time.time()
    now_ms = int(now * 1000)

    for node_id in _stores.metrics_store.get_node_ids():
        # Pull a generous window — long stalls span minutes.
        history = _stores.metrics_store.get_training_history(node_id, window_minutes=15)
        if not history:
            continue
        latest = history[-1]
        if not latest.job_id:
            continue
        if not _job_is_running(latest.job_id):
            continue

        # Hard stall: the sidecar is still alive, but no fresh training sample
        # has arrived. This catches hangs/exits where the mmap reader stops
        # emitting training after its freshness window expires.
        missing_sample_seconds = (now_ms - latest.timestamp_ms) / 1000.0
        if _node_is_fresh(node_id, now_ms) and missing_sample_seconds >= _WARN_SECONDS:
            severity = "CRITICAL" if missing_sample_seconds >= _CRITICAL_SECONDS else "WARNING"
            dedup_key = (node_id, latest.step, "no_fresh_training_sample")
            prev = _last_alerted.get(dedup_key)
            if prev is None or (now - prev) >= _DEDUP_COOLDOWN_SECONDS:
                _last_alerted[dedup_key] = now
                anomaly = _make_alert(
                    node_id=node_id,
                    step=latest.step,
                    job_id=latest.job_id,
                    severity=severity,
                    stalled_seconds=missing_sample_seconds,
                    samples_at_step=1,
                    stalled_mode="no_fresh_training_sample",
                    now=now,
                )
                _stores.alert_store.add(anomaly.alert)
                _stores.anomaly_store.add(anomaly.model_dump())
                findings.append(anomaly)
                logger.warning(
                    "Training stalled: node=%s no fresh training for %.1fs severity=%s",
                    node_id, missing_sample_seconds, severity,
                )
            continue

        if len(history) < _MIN_SAMPLES:
            continue

        window = _trailing_same_step_window(history)
        if len(window) < _MIN_SAMPLES:
            continue

        stalled_ms = window[-1].timestamp_ms - window[0].timestamp_ms
        stalled_seconds = stalled_ms / 1000.0
        if stalled_seconds < _WARN_SECONDS:
            continue

        severity = "CRITICAL" if stalled_seconds >= _CRITICAL_SECONDS else "WARNING"

        dedup_key = (node_id, latest.step, "repeated_same_step")
        prev = _last_alerted.get(dedup_key)
        if prev is not None and (now - prev) < _DEDUP_COOLDOWN_SECONDS:
            continue
        _last_alerted[dedup_key] = now

        anomaly = _make_alert(
            node_id=node_id,
            step=latest.step,
            job_id=latest.job_id,
            severity=severity,
            stalled_seconds=stalled_seconds,
            samples_at_step=len(window),
            stalled_mode="repeated_same_step",
            now=now,
        )
        _stores.alert_store.add(anomaly.alert)
        _stores.anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
        logger.warning(
            "Training stalled: node=%s step=%d for %.1fs severity=%s",
            node_id, latest.step, stalled_seconds, severity,
        )

    # Evict stale dedup entries
    cutoff = now - _DEDUP_COOLDOWN_SECONDS * 2
    for k in [k for k, v in _last_alerted.items() if v < cutoff]:
        del _last_alerted[k]

    return findings
