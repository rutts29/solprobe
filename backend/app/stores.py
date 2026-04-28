"""In-memory stores for metrics and alerts.

MetricsStore: per-node ring buffer holding ~30 minutes of 1-second samples.
AlertStore: bounded deque of the last 1000 alerts, queryable by node/severity/type.
JobStore: simple registry for training jobs.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict, deque
from typing import Any

from app.models.alerts import AlertModel
from app.models.metrics import (
    CustomMetricModel,
    DiLoCoMetricsModel,
    GpuMetricsModel,
    MetricsBatchModel,
    NodeStatus,
    TrainingMetricsModel,
)

logger = logging.getLogger(__name__)

# ~30 minutes at 1-second intervals
_RING_BUFFER_SIZE = 1800
_MAX_ALERTS = 1000


class _NodeBuffer:
    """Ring buffer holding metric history for a single node."""

    __slots__ = (
        "node_id",
        "gpu_model",
        "gpu_count",
        "gpu_metrics",
        "training_metrics",
        "diloco_metrics",
        "last_seen_ms",
    )

    def __init__(self, node_id: str) -> None:
        self.node_id = node_id
        self.gpu_model: str = ""
        self.gpu_count: int = 0
        self.gpu_metrics: deque[list[GpuMetricsModel]] = deque(maxlen=_RING_BUFFER_SIZE)
        self.training_metrics: deque[TrainingMetricsModel] = deque(maxlen=_RING_BUFFER_SIZE)
        self.diloco_metrics: deque[DiLoCoMetricsModel] = deque(maxlen=_RING_BUFFER_SIZE)
        self.last_seen_ms: int = 0


class MetricsStore:
    """Thread-safe in-memory store for per-node metric histories."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._nodes: dict[str, _NodeBuffer] = {}

    def ingest_batch(self, batch: MetricsBatchModel) -> None:
        """Store a single MetricsBatch, creating the node buffer if needed."""
        # Determine node_id from the first GPU metric or training/diloco
        node_id: str | None = None
        if batch.gpu:
            node_id = batch.gpu[0].node_id
        elif batch.training:
            node_id = batch.training.node_id
        elif batch.diloco:
            node_id = batch.diloco.node_id

        if node_id is None:
            logger.warning("Received empty MetricsBatch with no identifiable node")
            return

        with self._lock:
            buf = self._nodes.get(node_id)
            if buf is None:
                buf = _NodeBuffer(node_id)
                self._nodes[node_id] = buf
                logger.info("Registered new node: %s", node_id)

            if batch.gpu:
                buf.gpu_metrics.append(batch.gpu)
                buf.gpu_model = batch.gpu[0].gpu_model
                buf.gpu_count = len(batch.gpu)
                ts = max(g.timestamp_ms for g in batch.gpu)
                buf.last_seen_ms = max(buf.last_seen_ms, ts)

            if batch.training:
                buf.training_metrics.append(batch.training)
                buf.last_seen_ms = max(buf.last_seen_ms, batch.training.timestamp_ms)

            if batch.diloco:
                buf.diloco_metrics.append(batch.diloco)
                buf.last_seen_ms = max(buf.last_seen_ms, batch.diloco.timestamp_ms)

    def get_node_ids(self) -> list[str]:
        """Return all known node IDs."""
        with self._lock:
            return list(self._nodes.keys())

    def get_node_status(self, node_id: str) -> NodeStatus | None:
        """Build a NodeStatus snapshot for the given node."""
        with self._lock:
            buf = self._nodes.get(node_id)
            if buf is None:
                return None
            return NodeStatus(
                node_id=buf.node_id,
                gpu_model=buf.gpu_model,
                gpu_count=buf.gpu_count,
                last_seen_ms=buf.last_seen_ms,
                latest_metrics=list(buf.gpu_metrics[-1]) if buf.gpu_metrics else [],
                latest_training=buf.training_metrics[-1] if buf.training_metrics else None,
                latest_diloco=buf.diloco_metrics[-1] if buf.diloco_metrics else None,
            )

    def get_all_node_statuses(self) -> list[NodeStatus]:
        """Return NodeStatus for every known node."""
        with self._lock:
            result: list[NodeStatus] = []
            for buf in self._nodes.values():
                result.append(
                    NodeStatus(
                        node_id=buf.node_id,
                        gpu_model=buf.gpu_model,
                        gpu_count=buf.gpu_count,
                        last_seen_ms=buf.last_seen_ms,
                        latest_metrics=list(buf.gpu_metrics[-1]) if buf.gpu_metrics else [],
                        latest_training=buf.training_metrics[-1] if buf.training_metrics else None,
                        latest_diloco=buf.diloco_metrics[-1] if buf.diloco_metrics else None,
                    )
                )
            return result

    def get_gpu_history(
        self,
        node_id: str,
        window_minutes: int = 5,
        resolution_seconds: int = 1,
    ) -> list[list[GpuMetricsModel]]:
        """Return historical GPU metrics for a node within the given window.

        Args:
            node_id: Target node.
            window_minutes: How many minutes of history to return.
            resolution_seconds: Down-sample factor (1 = every sample, 5 = every 5th).

        Returns:
            List of per-interval GPU metric lists (newest last).
        """
        with self._lock:
            buf = self._nodes.get(node_id)
            if buf is None:
                return []
            max_samples = window_minutes * 60
            data = list(buf.gpu_metrics)[-max_samples:]
            if resolution_seconds > 1:
                data = data[::resolution_seconds]
            return data

    def get_training_history(self, node_id: str, window_minutes: int = 5) -> list[TrainingMetricsModel]:
        """Return recent training metrics for a node."""
        with self._lock:
            buf = self._nodes.get(node_id)
            if buf is None:
                return []
            max_samples = window_minutes * 60
            return list(buf.training_metrics)[-max_samples:]

    def get_diloco_history(self, node_id: str, window_minutes: int = 5) -> list[DiLoCoMetricsModel]:
        """Return recent DiLoCo metrics for a node."""
        with self._lock:
            buf = self._nodes.get(node_id)
            if buf is None:
                return []
            max_samples = window_minutes * 60
            return list(buf.diloco_metrics)[-max_samples:]

    def get_gpu_metric_series(self, node_id: str, field: str, window_minutes: int = 5) -> list[float]:
        """Extract a single scalar field from GPU history across all GPUs (averaged).

        Used by anomaly detectors.
        """
        history = self.get_gpu_history(node_id, window_minutes)
        values: list[float] = []
        for gpu_list in history:
            if gpu_list:
                avg = sum(getattr(g, field, 0.0) for g in gpu_list) / len(gpu_list)
                values.append(avg)
        return values

    def get_training_metric_series(self, node_id: str, field: str, window_minutes: int = 5) -> list[float]:
        """Extract a single scalar field from training history."""
        history = self.get_training_history(node_id, window_minutes)
        return [getattr(m, field, 0.0) for m in history]

    @property
    def node_count(self) -> int:
        with self._lock:
            return len(self._nodes)


class AlertStore:
    """Thread-safe bounded store for alerts."""

    def __init__(self, max_size: int = _MAX_ALERTS) -> None:
        self._lock = threading.Lock()
        self._alerts: deque[AlertModel] = deque(maxlen=max_size)

    def add(self, alert: AlertModel) -> None:
        with self._lock:
            self._alerts.append(alert)

    def query(
        self,
        *,
        node_id: str | None = None,
        severity: str | None = None,
        alert_type: str | None = None,
        limit: int = 50,
    ) -> list[AlertModel]:
        """Query alerts with optional filters, newest first."""
        with self._lock:
            results: list[AlertModel] = []
            for alert in reversed(self._alerts):
                if node_id and alert.node_id != node_id:
                    continue
                if severity and alert.severity != severity:
                    continue
                if alert_type and alert.alert_type != alert_type:
                    continue
                results.append(alert)
                if len(results) >= limit:
                    break
            return results

    def get_node_history(self, node_id: str, limit: int = 10) -> list[AlertModel]:
        """Return the last N alerts for a specific node."""
        return self.query(node_id=node_id, limit=limit)

    def get_correlated(self, timestamp_ms: int, exclude_node: str, window_ms: int = 30_000) -> list[AlertModel]:
        """Find alerts from other nodes within a time window."""
        with self._lock:
            results: list[AlertModel] = []
            lo = timestamp_ms - window_ms
            hi = timestamp_ms + window_ms
            for alert in reversed(self._alerts):
                if alert.node_id == exclude_node:
                    continue
                if lo <= alert.timestamp_ms <= hi:
                    results.append(alert)
            return results

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._alerts)


class AnomalyStore:
    """Bounded store for central-detector anomaly findings."""

    def __init__(self, max_size: int = _MAX_ALERTS) -> None:
        self._lock = threading.Lock()
        self._anomalies: deque[dict[str, Any]] = deque(maxlen=max_size)

    def add(self, anomaly: dict[str, Any]) -> None:
        with self._lock:
            self._anomalies.append(anomaly)

    def query(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._anomalies)[-limit:][::-1]


_MAX_JOBS = 1000

_JOB_STATUSES = ("registered", "running", "completed", "failed")


class JobStore:
    """Bounded in-memory registry for training jobs (evicts oldest when full)."""

    def __init__(self, max_size: int = _MAX_JOBS) -> None:
        self._lock = threading.Lock()
        self._jobs: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._max_size = max_size

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    def register(
        self,
        job_id: str,
        config: dict[str, str],
        node_ids: list[str],
        name: str | None = None,
    ) -> None:
        with self._lock:
            now_ms = self._now_ms()
            existing = self._jobs.get(job_id)
            if existing is not None:
                # Re-registration: preserve created_at, refresh updated_at and merge fields.
                self._jobs.move_to_end(job_id)
                existing["config"] = config
                existing["node_ids"] = node_ids
                if name is not None:
                    existing["name"] = name
                existing["updated_at_ms"] = now_ms
                return

            self._jobs[job_id] = {
                "job_id": job_id,
                "name": name,
                "status": "registered",
                "config": config,
                "node_ids": node_ids,
                "created_at_ms": now_ms,
                "updated_at_ms": now_ms,
            }
            while len(self._jobs) > self._max_size:
                evicted_id, _ = self._jobs.popitem(last=False)
                logger.warning("JobStore evicting oldest job (at capacity %d): job_id=%s", self._max_size, evicted_id)

    def update_status(self, job_id: str, status: str) -> None:
        if status not in _JOB_STATUSES:
            raise ValueError(f"invalid job status: {status!r}")
        with self._lock:
            entry = self._jobs.get(job_id)
            if entry is None:
                return
            entry["status"] = status
            entry["updated_at_ms"] = self._now_ms()

    def touch(self, job_id: str) -> None:
        with self._lock:
            entry = self._jobs.get(job_id)
            if entry is None:
                return
            entry["updated_at_ms"] = self._now_ms()

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._jobs.values())


_VALID_LIFECYCLE_STATES: frozenset[str] = frozenset(
    {"acknowledged", "investigating", "resolved", "ignored"}
)
_CLOSED_LIFECYCLE_STATES: frozenset[str] = frozenset({"resolved", "ignored"})


class AlertLifecycleStore:
    """Per-alert lifecycle state and notes, parallel to AlertStore.

    Alerts without an entry are treated as open. Only `resolved` and `ignored`
    count as closed.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._entries: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _new_entry() -> dict[str, Any]:
        return {"state": None, "notes": []}

    def set_state(self, alert_id: str, state: str) -> dict[str, Any]:
        if state not in _VALID_LIFECYCLE_STATES:
            raise ValueError(
                f"invalid lifecycle state: {state!r} "
                f"(expected one of {sorted(_VALID_LIFECYCLE_STATES)})"
            )
        with self._lock:
            entry = self._entries.get(alert_id)
            if entry is None:
                entry = self._new_entry()
                self._entries[alert_id] = entry
            entry["state"] = state
            return self._snapshot(entry)

    def add_note(
        self, alert_id: str, text: str, author: str | None = None
    ) -> dict[str, Any]:
        note = {
            "text": text,
            "author": author,
            "timestamp_ms": int(time.time() * 1000),
        }
        with self._lock:
            entry = self._entries.get(alert_id)
            if entry is None:
                entry = self._new_entry()
                self._entries[alert_id] = entry
            entry["notes"].append(note)
            return self._snapshot(entry)

    def get(self, alert_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._entries.get(alert_id)
            if entry is None:
                return None
            return self._snapshot(entry)

    def get_open_alert_ids(self) -> set[str]:
        with self._lock:
            return {
                alert_id
                for alert_id, entry in self._entries.items()
                if entry["state"] not in _CLOSED_LIFECYCLE_STATES
            }

    @staticmethod
    def _snapshot(entry: dict[str, Any]) -> dict[str, Any]:
        return {"state": entry["state"], "notes": [dict(n) for n in entry["notes"]]}


class PolicyStore:
    """In-memory store for monitoring policies and per-scope cooldowns."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._policies: dict[str, dict[str, Any]] = {}
        # cooldown key: (policy_id, node_id_or_None, job_id_or_None) -> last_trigger_ms
        self._cooldowns: dict[tuple[str, str | None, str | None], int] = {}

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    def create(self, policy: dict[str, Any]) -> dict[str, Any]:
        policy_id = policy["policy_id"]
        with self._lock:
            if policy_id in self._policies:
                raise KeyError(f"policy {policy_id!r} already exists")
            now_ms = self._now_ms()
            entry = dict(policy)
            entry.setdefault("enabled", True)
            entry["created_at_ms"] = now_ms
            entry["updated_at_ms"] = now_ms
            entry.setdefault("last_triggered_at_ms", None)
            self._policies[policy_id] = entry
            return dict(entry)

    def update(self, policy_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            entry = self._policies.get(policy_id)
            if entry is None:
                return None
            for k, v in patch.items():
                if v is None:
                    continue
                entry[k] = v
            entry["updated_at_ms"] = self._now_ms()
            return dict(entry)

    def toggle(self, policy_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._policies.get(policy_id)
            if entry is None:
                return None
            entry["enabled"] = not entry.get("enabled", True)
            entry["updated_at_ms"] = self._now_ms()
            return dict(entry)

    def delete(self, policy_id: str) -> bool:
        with self._lock:
            if policy_id not in self._policies:
                return False
            del self._policies[policy_id]
            self._cooldowns = {
                k: v for k, v in self._cooldowns.items() if k[0] != policy_id
            }
            return True

    def get(self, policy_id: str) -> dict[str, Any] | None:
        with self._lock:
            entry = self._policies.get(policy_id)
            return dict(entry) if entry else None

    def list_all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(e) for e in self._policies.values()]

    def list_enabled(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(e) for e in self._policies.values() if e.get("enabled", True)]

    def in_cooldown(
        self,
        policy_id: str,
        node_id: str | None,
        job_id: str | None,
        cooldown_seconds: float,
        now_ms: int,
    ) -> bool:
        if cooldown_seconds <= 0:
            return False
        key = (policy_id, node_id, job_id)
        with self._lock:
            last = self._cooldowns.get(key)
            if last is None:
                return False
            return (now_ms - last) < int(cooldown_seconds * 1000)

    def mark_triggered(
        self,
        policy_id: str,
        node_id: str | None,
        job_id: str | None,
        now_ms: int,
    ) -> None:
        key = (policy_id, node_id, job_id)
        with self._lock:
            self._cooldowns[key] = now_ms
            entry = self._policies.get(policy_id)
            if entry is not None:
                entry["last_triggered_at_ms"] = now_ms


_CUSTOM_METRIC_BUFFER_CAP = 1800


class CustomMetricsStore:
    """Thread-safe in-memory store for user-defined custom metrics.

    Storage is partitioned into per-(name, job_id) ring buffers, each holding the
    most recent ``max_per_key`` samples. ``node_id`` is *not* part of the key —
    multiple nodes reporting the same (name, job_id) share a single buffer and
    can be separated with the ``node_id`` query filter.
    """

    def __init__(self, max_per_key: int = _CUSTOM_METRIC_BUFFER_CAP) -> None:
        self._lock = threading.Lock()
        self._buffers: dict[tuple[str, str], deque[CustomMetricModel]] = {}
        self._max_per_key = max_per_key

    def _key(self, metric: CustomMetricModel) -> tuple[str, str]:
        return (metric.name, metric.job_id)

    def add(self, metric: CustomMetricModel) -> None:
        key = self._key(metric)
        with self._lock:
            buf = self._buffers.get(key)
            if buf is None:
                buf = deque(maxlen=self._max_per_key)
                self._buffers[key] = buf
            buf.append(metric)

    def query(
        self,
        *,
        name: str | None = None,
        job_id: str | None = None,
        node_id: str | None = None,
        limit: int = 500,
    ) -> list[CustomMetricModel]:
        """Return matching metrics newest-first, up to ``limit`` items."""
        with self._lock:
            relevant_buffers: list[deque[CustomMetricModel]] = []
            for (n, j), buf in self._buffers.items():
                if name is not None and n != name:
                    continue
                if job_id is not None and j != job_id:
                    continue
                relevant_buffers.append(buf)
            candidates: list[CustomMetricModel] = []
            for buf in relevant_buffers:
                for m in buf:
                    if node_id is not None and m.node_id != node_id:
                        continue
                    candidates.append(m)
        candidates.sort(key=lambda m: m.timestamp_ms, reverse=True)
        return candidates[:limit]

    def get_names(self, job_id: str | None = None) -> list[str]:
        with self._lock:
            names: set[str] = set()
            for (n, j) in self._buffers.keys():
                if job_id is not None and j != job_id:
                    continue
                names.add(n)
            return sorted(names)

    def get_latest(
        self,
        name: str,
        job_id: str | None = None,
        node_id: str | None = None,
    ) -> CustomMetricModel | None:
        """Policy evaluator entrypoint.

        Return the most recent ``CustomMetricModel`` whose ``name`` matches and
        which optionally also matches ``job_id`` and/or ``node_id``. Returns
        ``None`` if no sample has been recorded for the given filters. The
        policy engine (``frank``'s sequential teammate scope) calls this to
        evaluate ``{"metric": {"source": "custom", "name": ...}}`` policies
        against the latest observed value.
        """
        results = self.query(name=name, job_id=job_id, node_id=node_id, limit=1)
        return results[0] if results else None


# ---------------------------------------------------------------------------
# Global singleton instances — imported by gRPC server, detectors, and routes
# ---------------------------------------------------------------------------
metrics_store = MetricsStore()
alert_store = AlertStore()
anomaly_store = AnomalyStore()
job_store = JobStore()
alert_lifecycle_store = AlertLifecycleStore()
custom_metrics_store = CustomMetricsStore()
policy_store = PolicyStore()
