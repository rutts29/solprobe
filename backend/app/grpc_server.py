"""gRPC service implementation for SolProbe.

Implements SolProbeServiceServicer:
  - StreamMetrics: receives streaming MetricsBatch from sidecars
  - ReportAlert: receives edge alerts from sidecars
  - Subscribe: sends Command stream back to sidecar (placeholder)
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from concurrent import futures

import grpc

# Ensure generated package path is set up before importing stubs
import app.generated  # noqa: F401 — triggers sys.path fix
from app.generated import alerts_pb2, alerts_pb2_grpc, metrics_pb2
from app.models.alerts import AlertModel
from app.models.metrics import (
    DiLoCoMetricsModel,
    GpuMetricsModel,
    MetricsBatchModel,
    TrainingMetricsModel,
)
from app.stores import alert_store, metrics_store

logger = logging.getLogger(__name__)

# Prometheus counters (optional, imported lazily to avoid hard dep)
try:
    from prometheus_client import Counter

    BATCHES_RECEIVED = Counter(
        "solprobe_batches_received_total",
        "Total MetricsBatch messages received via gRPC",
    )
    ALERTS_RECEIVED = Counter(
        "solprobe_alerts_received_total",
        "Total edge alerts received via gRPC",
        ["severity"],
    )
except ImportError:  # pragma: no cover
    logger.warning("prometheus_client not installed; gRPC Prometheus counters disabled")
    BATCHES_RECEIVED = None  # type: ignore[assignment]
    ALERTS_RECEIVED = None  # type: ignore[assignment]

# Reference to the WebSocket hub and asyncio loop — set at startup by main.py
# Use TYPE_CHECKING to get proper type safety without circular import
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.ws.websocket import ConnectionManager

_ws_hub: ConnectionManager | None = None  # type: ignore[assignment]
_event_loop: asyncio.AbstractEventLoop | None = None


def set_ws_hub(hub: ConnectionManager) -> None:  # type: ignore[name-defined]
    """Called by main.py to inject the WebSocket ConnectionManager."""
    global _ws_hub
    _ws_hub = hub


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Store the main asyncio event loop for cross-thread scheduling."""
    global _event_loop
    _event_loop = loop


# ---------------------------------------------------------------------------
# Proto → Pydantic conversion helpers
# ---------------------------------------------------------------------------

def _proto_gpu_to_model(g: metrics_pb2.GpuMetrics) -> GpuMetricsModel:  # type: ignore[name-defined]
    return GpuMetricsModel(
        node_id=g.node_id,
        gpu_index=g.gpu_index,
        gpu_model=g.gpu_model,
        timestamp_ms=g.timestamp_ms,
        gpu_temp_c=g.gpu_temp_c,
        memory_temp_c=g.memory_temp_c,
        gpu_utilization_pct=g.gpu_utilization_pct,
        mem_copy_utilization_pct=g.mem_copy_utilization_pct,
        fb_used_mb=g.fb_used_mb,
        fb_free_mb=g.fb_free_mb,
        power_usage_w=g.power_usage_w,
        xid_errors=g.xid_errors,
        ecc_sbe_count=g.ecc_sbe_count,
        ecc_dbe_count=g.ecc_dbe_count,
        clock_throttle_reasons=g.clock_throttle_reasons,
        pcie_replay_counter=g.pcie_replay_counter,
        pcie_tx_bytes_per_sec=g.pcie_tx_bytes_per_sec,
        pcie_rx_bytes_per_sec=g.pcie_rx_bytes_per_sec,
        sm_active_pct=g.sm_active_pct,
        tensor_active_pct=g.tensor_active_pct,
        retired_pages_sbe=g.retired_pages_sbe,
        retired_pages_dbe=g.retired_pages_dbe,
        remapped_rows_correctable=g.remapped_rows_correctable,
        remapped_rows_uncorrectable=g.remapped_rows_uncorrectable,
        row_remap_failure=g.row_remap_failure,
    )


def _proto_training_to_model(t: metrics_pb2.TrainingMetrics) -> TrainingMetricsModel:  # type: ignore[name-defined]
    return TrainingMetricsModel(
        node_id=t.node_id,
        job_id=t.job_id,
        timestamp_ms=t.timestamp_ms,
        step=t.step,
        loss=t.loss,
        gradient_norm=t.gradient_norm,
        learning_rate=t.learning_rate,
        throughput_tps=t.throughput_tps,
        mfu_pct=t.mfu_pct,
    )


def _proto_diloco_to_model(d: metrics_pb2.DiLoCoMetrics) -> DiLoCoMetricsModel:  # type: ignore[name-defined]
    return DiLoCoMetricsModel(
        node_id=d.node_id,
        job_id=d.job_id,
        timestamp_ms=d.timestamp_ms,
        inner_step=d.inner_step,
        outer_step=d.outer_step,
        inner_loss=d.inner_loss,
        outer_loss=d.outer_loss,
        pseudo_grad_norm=d.pseudo_grad_norm,
        sync_duration_ms=d.sync_duration_ms,
        worker_speed_ratio=d.worker_speed_ratio,
        is_straggler=d.is_straggler,
    )


_SEVERITY_MAP = {
    0: "UNSPECIFIED",
    1: "INFO",
    2: "WARNING",
    3: "CRITICAL",
}

_SOURCE_MAP = {
    0: "UNSPECIFIED",
    1: "EDGE",
    2: "CENTRAL",
}

_ALERT_TYPE_MAP = {
    0: "unspecified",
    1: "thermal_throttle",
    2: "memory_pressure",
    3: "xid_error",
    4: "ecc_error",
    5: "clock_throttle",
    6: "pcie_error",
    10: "nccl_timeout",
    11: "gradient_explosion",
    12: "loss_plateau",
    13: "loss_spike",
    20: "diloco_sync_drift",
    21: "straggler_detected",
    22: "pseudo_grad_divergence",
    23: "inner_outer_divergence",
}


def _proto_alert_to_model(a: alerts_pb2.Alert) -> AlertModel:  # type: ignore[name-defined]
    return AlertModel(
        alert_id=a.alert_id or str(uuid.uuid4()),
        node_id=a.node_id,
        timestamp_ms=a.timestamp_ms or int(time.time() * 1000),
        severity=_SEVERITY_MAP.get(a.severity, "UNSPECIFIED"),
        source=_SOURCE_MAP.get(a.source, "UNSPECIFIED"),
        alert_type=_ALERT_TYPE_MAP.get(a.alert_type, "unspecified"),
        description=a.description,
        confidence=a.confidence,
        evidence=dict(a.evidence),
        gpu_index=a.gpu_index if a.HasField("gpu_index") else None,
        job_id=a.job_id if a.HasField("job_id") else None,
    )


# ---------------------------------------------------------------------------
# gRPC Servicer
# ---------------------------------------------------------------------------

class SolProbeServicer(alerts_pb2_grpc.SolProbeServiceServicer):
    """Concrete implementation of the SolProbeService gRPC interface."""

    def StreamMetrics(self, request_iterator, context):
        """Receive a stream of MetricsBatch messages from a sidecar."""
        count = 0
        for batch_proto in request_iterator:
            gpu_models = [_proto_gpu_to_model(g) for g in batch_proto.gpu]

            training_model = None
            if batch_proto.HasField("training"):
                training_model = _proto_training_to_model(batch_proto.training)

            diloco_model = None
            if batch_proto.HasField("diloco"):
                diloco_model = _proto_diloco_to_model(batch_proto.diloco)

            batch = MetricsBatchModel(
                gpu=gpu_models,
                training=training_model,
                diloco=diloco_model,
            )
            metrics_store.ingest_batch(batch)
            count += 1

            if BATCHES_RECEIVED is not None:
                BATCHES_RECEIVED.inc()

        ack = metrics_pb2.StreamAck(ok=True, message=f"Received {count} batches")
        logger.info("StreamMetrics completed: %d batches ingested", count)
        return ack

    def ReportAlert(self, request, context):
        """Receive a single edge-detected alert from a sidecar."""
        alert_model = _proto_alert_to_model(request)
        alert_store.add(alert_model)

        if ALERTS_RECEIVED is not None:
            ALERTS_RECEIVED.labels(severity=alert_model.severity).inc()

        # Push to WebSocket hub if available (cross-thread into asyncio loop)
        if _ws_hub is not None and _event_loop is not None:
            _event_loop.call_soon_threadsafe(_schedule_ws_broadcast, alert_model)

        logger.info(
            "Alert received: %s [%s] from node %s",
            alert_model.alert_type,
            alert_model.severity,
            alert_model.node_id,
        )
        return alerts_pb2.AlertAck(ok=True, alert_id=alert_model.alert_id)

    def Subscribe(self, request, context):
        """Stream commands back to sidecar (placeholder).

        Currently registers the node and keeps the stream open.
        """
        node_id = request.node_id
        logger.info(
            "Node subscribed: %s (model=%s, gpus=%d)",
            node_id,
            request.gpu_model,
            request.gpu_count,
        )
        # Keep the stream alive — in production this would yield Commands
        # based on configuration changes or fault-injection requests.
        while context.is_active():
            time.sleep(1)
        logger.info("Node unsubscribed: %s", node_id)


def _log_task_exception(task: asyncio.Task) -> None:  # type: ignore[type-arg]
    """Log exceptions from fire-and-forget asyncio tasks."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error("Background broadcast task failed: %s", exc, exc_info=exc)


def _schedule_ws_broadcast(alert: AlertModel) -> None:
    """Create an asyncio task to broadcast alert via WS hub.

    Must be called from the asyncio event loop thread
    (via call_soon_threadsafe).
    """
    if _ws_hub is not None and _event_loop is not None:
        task = _event_loop.create_task(_ws_hub.broadcast_alert(alert))
        task.add_done_callback(_log_task_exception)


# ---------------------------------------------------------------------------
# Server lifecycle
# ---------------------------------------------------------------------------

_grpc_server: grpc.Server | None = None


def start_grpc_server(port: int = 50051) -> grpc.Server:
    """Start the gRPC server in a thread pool (non-blocking)."""
    global _grpc_server
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    alerts_pb2_grpc.add_SolProbeServiceServicer_to_server(SolProbeServicer(), server)
    server.add_insecure_port(f"[::]:{port}")
    server.start()
    _grpc_server = server
    logger.info("gRPC server started on port %d", port)
    return server


def stop_grpc_server(grace: float = 5.0) -> None:
    """Gracefully stop the gRPC server."""
    global _grpc_server
    if _grpc_server is not None:
        _grpc_server.stop(grace)
        logger.info("gRPC server stopped")
        _grpc_server = None
