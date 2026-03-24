"""SolProbe FastAPI application entry point.

Wires together:
  - REST API routes (/api/v1/*)
  - gRPC server on port 50051 (background)
  - Central anomaly detectors (periodic background tasks)
  - WebSocket hub (/ws/stream)
  - Prometheus metrics endpoint (/metrics)
  - Startup / shutdown lifecycle events
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from app.api.routes import router as api_router
from app.detectors.cross_node import run_cross_node_detection
from app.detectors.diloco import run_diloco_detection
from app.detectors.zscore import run_zscore_detection
from app.diagnosis.agent import get_or_create_agent
from app.diagnosis.store import diagnosis_store
from app.grpc_server import set_event_loop, set_ws_hub, start_grpc_server, stop_grpc_server
from app.stores import alert_store, metrics_store
from app.ws.websocket import metric_summary_loop, websocket_endpoint, ws_manager

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prometheus metrics endpoint
# ---------------------------------------------------------------------------

try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        Gauge,
        generate_latest,
    )

    # Register gauges on the default registry so /metrics picks them up
    CONNECTED_NODES = Gauge(
        "solprobe_connected_nodes",
        "Number of connected sidecar nodes",
    )
    TOTAL_ALERTS = Gauge(
        "solprobe_total_alerts",
        "Total alerts in store",
    )
    WS_CLIENTS = Gauge(
        "solprobe_ws_clients",
        "Active WebSocket clients",
    )
    TOTAL_DIAGNOSES = Gauge(
        "solprobe_total_diagnoses",
        "Total diagnoses in store",
    )
    _PROM_AVAILABLE = True
except ImportError:
    _PROM_AVAILABLE = False
    logger.warning("prometheus_client not available; /metrics endpoint disabled")


def _update_prom_gauges() -> None:
    """Refresh Prometheus gauge values from stores."""
    if not _PROM_AVAILABLE:
        return
    CONNECTED_NODES.set(metrics_store.node_count)
    TOTAL_ALERTS.set(alert_store.count)
    WS_CLIENTS.set(ws_manager.active_count)
    TOTAL_DIAGNOSES.set(diagnosis_store.count)


# ---------------------------------------------------------------------------
# Background detector tasks
# ---------------------------------------------------------------------------

_background_tasks: list[asyncio.Task] = []  # type: ignore[type-arg]


async def _detector_loop(
    name: str,
    base_interval: float,
    run_fn,  # noqa: ANN001
    *,
    broadcast_fn=None,  # noqa: ANN001
) -> None:
    """Generic background detector loop with exponential backoff on failure."""
    consecutive_failures = 0
    while True:
        delay = base_interval * min(2 ** consecutive_failures, 30)  # max ~30x base
        await asyncio.sleep(delay)
        try:
            findings = run_fn()
            consecutive_failures = 0
            if findings and broadcast_fn:
                for anomaly in findings:
                    await broadcast_fn(anomaly.alert)
        except Exception:
            consecutive_failures += 1
            logger.exception(
                "Error in %s loop (failure #%d, next retry in %.0fs)",
                name, consecutive_failures, base_interval * min(2 ** consecutive_failures, 30),
            )


async def _zscore_loop() -> None:
    await _detector_loop("z-score", 10, run_zscore_detection, broadcast_fn=ws_manager.broadcast_alert)


async def _cross_node_loop() -> None:
    await _detector_loop("cross-node", 15, run_cross_node_detection, broadcast_fn=ws_manager.broadcast_alert)


async def _diloco_loop() -> None:
    await _detector_loop("DiLoCo", 15, run_diloco_detection, broadcast_fn=ws_manager.broadcast_alert)


async def _prom_gauge_loop() -> None:
    """Update Prometheus gauges every 5 seconds."""
    consecutive_failures = 0
    while True:
        delay = 5 * min(2 ** consecutive_failures, 30)
        await asyncio.sleep(delay)
        try:
            _update_prom_gauges()
            consecutive_failures = 0
        except Exception:
            consecutive_failures += 1
            logger.exception("Error updating Prometheus gauges (failure #%d)", consecutive_failures)


async def _auto_diagnosis_loop() -> None:
    """Automatically diagnose CRITICAL alerts that lack a successful diagnosis."""
    consecutive_failures = 0
    while True:
        delay = 5 * min(2 ** consecutive_failures, 30)
        await asyncio.sleep(delay)
        try:
            critical_alerts = alert_store.query(severity="CRITICAL", limit=20)
            agent = get_or_create_agent()
            for alert in critical_alerts:
                existing = diagnosis_store.get_by_alert_id(alert.alert_id)
                if existing is not None and existing.status == "completed":
                    continue
                result = await asyncio.to_thread(agent.diagnose, alert)
                if result.status == "completed":
                    await ws_manager.broadcast_diagnosis(result)
            consecutive_failures = 0
        except Exception:
            consecutive_failures += 1
            logger.exception("Error in auto-diagnosis loop (failure #%d)", consecutive_failures)


# ---------------------------------------------------------------------------
# Lifespan (startup + shutdown)
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Manage startup and shutdown of background services."""
    # -- Startup --
    logger.info("SolProbe backend starting up")

    # Inject WebSocket hub and event loop into gRPC server
    set_ws_hub(ws_manager)
    set_event_loop(asyncio.get_running_loop())

    # Start gRPC server (runs in its own thread pool)
    _grpc_port_str = os.environ.get("GRPC_PORT", "50051")
    try:
        _grpc_port = int(_grpc_port_str)
    except ValueError:
        raise ValueError(f"GRPC_PORT must be a valid integer, got: {_grpc_port_str!r}") from None
    start_grpc_server(port=_grpc_port)

    # Launch background detector loops
    _background_tasks.append(asyncio.create_task(_zscore_loop()))
    _background_tasks.append(asyncio.create_task(_cross_node_loop()))
    _background_tasks.append(asyncio.create_task(_diloco_loop()))
    _background_tasks.append(asyncio.create_task(metric_summary_loop()))
    _background_tasks.append(asyncio.create_task(_prom_gauge_loop()))
    _background_tasks.append(asyncio.create_task(_auto_diagnosis_loop()))

    logger.info("All background tasks started")

    yield

    # -- Shutdown --
    logger.info("SolProbe backend shutting down")

    # Cancel background tasks
    for task in _background_tasks:
        task.cancel()
    await asyncio.gather(*_background_tasks, return_exceptions=True)
    _background_tasks.clear()

    # Stop gRPC server
    stop_grpc_server(grace=5.0)

    logger.info("Shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SolProbe API",
    version="0.1.0",
    description="Autonomous fault detection and recovery for distributed GPU training",
    lifespan=lifespan,
)

# CORS — allow dashboard dev server and common local origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include REST routes
app.include_router(api_router)


# Health check
@app.get("/api/v1/health")
async def health() -> dict:
    """Basic health check endpoint."""
    return {
        "status": "ok",
        "connected_sidecars": metrics_store.node_count,
        "total_alerts": alert_store.count,
        "total_diagnoses": diagnosis_store.count,
        "ws_clients": ws_manager.active_count,
    }


# WebSocket endpoint
@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket) -> None:
    """WebSocket endpoint for real-time alert and metric streaming."""
    await websocket_endpoint(websocket)


# Prometheus metrics endpoint
@app.get("/metrics")
async def prometheus_metrics() -> Response:
    """Expose Prometheus metrics."""
    if not _PROM_AVAILABLE:
        return Response(content="prometheus_client not installed", status_code=501)
    _update_prom_gauges()
    # generate_latest() with no args uses the default REGISTRY
    output = generate_latest()
    return Response(content=output, media_type=CONTENT_TYPE_LATEST)
