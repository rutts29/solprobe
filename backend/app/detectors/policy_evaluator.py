"""Policy evaluator — evaluates user-defined monitoring policies over existing metrics.

Runs every 5 seconds. For each enabled policy, walks the matching metric history
for every node (filtered by scope), checks the condition, and emits an
AlertModel with `alert_type="policy_violation"` if violated. Cooldown per
(policy_id, node_id, job_id) prevents spam.

Source readers are dispatched through `_SOURCE_READERS` so Phase 4 can register
a "custom" source from `app/custom_metrics.py` without touching this file.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Callable, Iterable

from app import stores as _stores
from app.models.alerts import AlertModel, AnomalyModel

logger = logging.getLogger(__name__)


# A reader returns a list of (timestamp_ms, value, job_id) for a node, where
# value may be None when the field can't be extracted (skip these samples).
SourceReader = Callable[[str, str, int], list[tuple[int, float | None, str | None]]]


def _gpu_reader(node_id: str, field: str, window_minutes: int) -> list[tuple[int, float | None, str | None]]:
    history = _stores.metrics_store.get_gpu_history(node_id, window_minutes=window_minutes)
    out: list[tuple[int, float | None, str | None]] = []
    for gpu_list in history:
        if not gpu_list:
            continue
        # Per-sample timestamp is the max of the GPU snapshot
        ts = max(g.timestamp_ms for g in gpu_list)
        try:
            avg = sum(getattr(g, field) for g in gpu_list) / len(gpu_list)
        except AttributeError:
            avg = None
        out.append((ts, avg, None))
    return out


def _training_reader(node_id: str, field: str, window_minutes: int) -> list[tuple[int, float | None, str | None]]:
    history = _stores.metrics_store.get_training_history(node_id, window_minutes=window_minutes)
    out: list[tuple[int, float | None, str | None]] = []
    for m in history:
        try:
            v = float(getattr(m, field))
        except (AttributeError, TypeError, ValueError):
            v = None
        out.append((m.timestamp_ms, v, m.job_id or None))
    return out


def _diloco_reader(node_id: str, field: str, window_minutes: int) -> list[tuple[int, float | None, str | None]]:
    history = _stores.metrics_store.get_diloco_history(node_id, window_minutes=window_minutes)
    out: list[tuple[int, float | None, str | None]] = []
    for m in history:
        try:
            v = float(getattr(m, field))
        except (AttributeError, TypeError, ValueError):
            v = None
        out.append((m.timestamp_ms, v, m.job_id or None))
    return out


def _custom_reader(node_id: str, field: str, window_minutes: int) -> list[tuple[int, float | None, str | None]]:
    """Read user-defined metric samples for `node_id`, where `field` is the metric name.

    `CustomMetricsStore.query` returns newest-first; `_sustained_violation` walks
    from `samples[-1]` as the latest sample, so we reverse to oldest-first.
    """
    limit = max(1, window_minutes * 60)
    history = _stores.custom_metrics_store.query(
        name=field, node_id=node_id, limit=limit
    )
    out: list[tuple[int, float | None, str | None]] = []
    for m in reversed(history):
        out.append((m.timestamp_ms, float(m.value), m.job_id or None))
    return out


_SOURCE_READERS: dict[str, SourceReader] = {
    "gpu": _gpu_reader,
    "training": _training_reader,
    "diloco": _diloco_reader,
    "custom": _custom_reader,
}

_DEFAULT_WINDOW_MINUTES = 5


def _compare(operator: str, value: float, threshold: float) -> bool:
    if operator == "gt":
        return value > threshold
    if operator == "gte":
        return value >= threshold
    if operator == "lt":
        return value < threshold
    if operator == "lte":
        return value <= threshold
    if operator == "abs_gt":
        return abs(value) > threshold
    return False


def _sustained_violation(
    samples: list[tuple[int, float | None, str | None]],
    operator: str,
    threshold: float,
    for_seconds: float,
) -> tuple[bool, float, float, float]:
    """Walk the trailing suffix where every sample violates the condition.

    Returns (violated, duration_seconds, latest_value, earliest_violation_ts_ms).
    `violated` is True iff:
      - the most recent sample violates, AND
      - the contiguous trailing-violation window spans >= for_seconds.
    """
    if not samples:
        return (False, 0.0, 0.0, 0.0)
    last_ts, last_val, _ = samples[-1]
    if last_val is None or not _compare(operator, last_val, threshold):
        return (False, 0.0, last_val or 0.0, 0.0)

    # Walk backwards while the condition stays violated.
    earliest_ts = last_ts
    for ts, val, _ in reversed(samples[:-1]):
        if val is None or not _compare(operator, val, threshold):
            break
        earliest_ts = ts

    duration_s = (last_ts - earliest_ts) / 1000.0
    if for_seconds > 0 and duration_s < for_seconds:
        return (False, duration_s, last_val, earliest_ts)
    return (True, duration_s, last_val, earliest_ts)


def _stale_for(
    samples: list[tuple[int, float | None, str | None]],
    for_seconds: float,
) -> tuple[bool, float, float]:
    """Detect that the trailing samples share the same value for >= for_seconds.

    Returns (violated, duration_seconds, latest_value).
    """
    if not samples:
        return (False, 0.0, 0.0)
    last_ts, last_val, _ = samples[-1]
    if last_val is None:
        return (False, 0.0, 0.0)

    earliest_ts = last_ts
    for ts, val, _ in reversed(samples[:-1]):
        if val is None or val != last_val:
            break
        earliest_ts = ts

    duration_s = (last_ts - earliest_ts) / 1000.0
    if duration_s < for_seconds:
        return (False, duration_s, last_val)
    return (True, duration_s, last_val)


def _candidate_node_ids(scope_node_id: str | None) -> Iterable[str]:
    if scope_node_id is not None:
        return [scope_node_id]
    return _stores.metrics_store.get_node_ids()


def _scope_matches_job(scope_job_id: str | None, sample_job_id: str | None) -> bool:
    if scope_job_id is None:
        return True
    return scope_job_id == sample_job_id


def run_policy_evaluation() -> list[AnomalyModel]:
    """Evaluate every enabled policy and emit alerts for violations."""
    findings: list[AnomalyModel] = []
    now_ms = int(time.time() * 1000)

    for policy in _stores.policy_store.list_enabled():
        try:
            findings.extend(_evaluate_one(policy, now_ms))
        except Exception:
            logger.exception("Policy %s evaluation failed", policy.get("policy_id"))

    return findings


def _evaluate_one(policy: dict[str, Any], now_ms: int) -> list[AnomalyModel]:
    policy_id = policy["policy_id"]
    metric = policy["metric"]
    condition = policy["condition"]
    scope = policy.get("scope") or {}
    severity = policy.get("severity", "WARNING")
    cooldown_seconds = float(policy.get("cooldown_seconds", 0.0))
    description = policy.get("description") or policy.get("name") or policy_id

    source = metric["source"]
    field = metric["field"]
    operator = condition["operator"]
    threshold = float(condition.get("threshold", 0.0))
    for_seconds = float(condition.get("for_seconds", 0.0))

    reader = _SOURCE_READERS.get(source)
    if reader is None:
        logger.warning("Unknown policy source %r — skipping policy %s", source, policy_id)
        return []

    scope_node_id = scope.get("node_id")
    scope_job_id = scope.get("job_id")

    # Window length: long enough to span for_seconds plus headroom.
    window_minutes = max(_DEFAULT_WINDOW_MINUTES, int(for_seconds / 60) + 2)

    findings: list[AnomalyModel] = []
    for node_id in _candidate_node_ids(scope_node_id):
        samples = reader(node_id, field, window_minutes)
        if not samples:
            continue

        # Filter to scope_job_id if set. Source readers attach per-sample
        # job_id when known (training/diloco/custom); for GPU the job_id
        # is None and a job-scoped policy on GPU effectively skips.
        if scope_job_id is not None:
            samples = [s for s in samples if _scope_matches_job(scope_job_id, s[2])]
            if not samples:
                continue

        if operator == "stale_for":
            violated, duration_s, value = _stale_for(samples, for_seconds)
        else:
            violated, duration_s, value, _ = _sustained_violation(
                samples, operator, threshold, for_seconds
            )
        if not violated:
            continue

        # Use sample's job_id when scope didn't pin one; needed for
        # cooldown bucketing.
        sample_job_id = samples[-1][2]
        cooldown_job_id = scope_job_id if scope_job_id is not None else sample_job_id

        if _stores.policy_store.in_cooldown(
            policy_id, node_id, cooldown_job_id, cooldown_seconds, now_ms
        ):
            continue
        _stores.policy_store.mark_triggered(policy_id, node_id, cooldown_job_id, now_ms)

        alert = AlertModel(
            alert_id=str(uuid.uuid4()),
            node_id=node_id,
            timestamp_ms=now_ms,
            severity=severity,
            source="CENTRAL",
            alert_type="policy_violation",
            description=f"{description} (node={node_id})",
            confidence=1.0,
            evidence={
                "policy_id": policy_id,
                "field": f"{source}.{field}",
                "operator": operator,
                "threshold": f"{threshold:.6g}",
                "actual_value": f"{value:.6g}",
                "duration_seconds": f"{duration_s:.2f}",
                "for_seconds": f"{for_seconds:.2f}",
            },
            job_id=sample_job_id if sample_job_id else None,
        )
        anomaly = AnomalyModel(
            alert=alert,
            detector_name="policy_evaluator",
            window_minutes=window_minutes,
            raw_score=duration_s,
        )
        _stores.alert_store.add(alert)
        _stores.anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
        logger.info(
            "Policy %s violated on node %s: %s.%s %s %s = %s for %.1fs",
            policy_id, node_id, source, field, operator, threshold, value, duration_s,
        )

    return findings
