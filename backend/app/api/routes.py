"""REST API routes for SolProbe backend.

All endpoints are async and return JSON via Pydantic serialization.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from app.enrichment import enrich_alert
from app.models.alerts import AlertModel, EnrichedAlert, JobRegistration
from app.models.metrics import GpuMetricsModel, NodeStatus
from app.stores import alert_store, anomaly_store, job_store, metrics_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["solprobe"])


# ---------------------------------------------------------------------------
# Node endpoints
# ---------------------------------------------------------------------------


@router.get("/nodes", response_model=list[NodeStatus])
async def list_nodes() -> list[NodeStatus]:
    """List all connected nodes with their latest metrics."""
    return metrics_store.get_all_node_statuses()


@router.get("/nodes/{node_id}/metrics")
async def get_node_metrics(
    node_id: str,
    window_minutes: int = Query(default=5, ge=1, le=60),
    resolution_seconds: int = Query(default=1, ge=1, le=60),
) -> dict:
    """Return historical GPU metrics for a specific node.

    Query params:
        window_minutes: How far back to look (1-60, default 5).
        resolution_seconds: Down-sample interval (1-60, default 1).
    """
    status = metrics_store.get_node_status(node_id)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    gpu_history = metrics_store.get_gpu_history(
        node_id,
        window_minutes=window_minutes,
        resolution_seconds=resolution_seconds,
    )
    training_history = metrics_store.get_training_history(node_id, window_minutes)
    diloco_history = metrics_store.get_diloco_history(node_id, window_minutes)

    # Flatten GPU metrics for the response
    flat_gpu: list[dict] = []
    for gpu_list in gpu_history:
        for gm in gpu_list:
            flat_gpu.append(gm.model_dump())

    return {
        "node_id": node_id,
        "window_minutes": window_minutes,
        "resolution_seconds": resolution_seconds,
        "gpu_metrics": flat_gpu,
        "training_metrics": [t.model_dump() for t in training_history],
        "diloco_metrics": [d.model_dump() for d in diloco_history],
    }


# ---------------------------------------------------------------------------
# Alert endpoints
# ---------------------------------------------------------------------------


@router.get("/alerts", response_model=list[AlertModel])
async def list_alerts(
    severity: str | None = Query(default=None, description="Filter by severity: INFO, WARNING, CRITICAL"),
    alert_type: str | None = Query(default=None, description="Filter by alert type"),
    node_id: str | None = Query(default=None, description="Filter by node ID"),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[AlertModel]:
    """Return recent alerts with optional filters, newest first."""
    return alert_store.query(
        node_id=node_id,
        severity=severity,
        alert_type=alert_type,
        limit=limit,
    )


@router.get("/alerts/{alert_id}/enriched", response_model=EnrichedAlert)
async def get_enriched_alert(alert_id: str) -> EnrichedAlert:
    """Return an alert enriched with contextual data for diagnosis."""
    # Find the alert by ID
    all_alerts = alert_store.query(limit=1000)
    target = None
    for a in all_alerts:
        if a.alert_id == alert_id:
            target = a
            break
    if target is None:
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    return enrich_alert(target)


# ---------------------------------------------------------------------------
# Anomaly endpoints
# ---------------------------------------------------------------------------


@router.get("/anomalies")
async def list_anomalies(
    limit: int = Query(default=50, ge=1, le=500),
) -> list[dict]:
    """Return central detector findings with confidence scores, newest first."""
    return anomaly_store.query(limit=limit)


# ---------------------------------------------------------------------------
# Job endpoints
# ---------------------------------------------------------------------------


@router.post("/jobs", status_code=201)
async def register_job(body: JobRegistration) -> dict:
    """Register a training job.

    Body:
        job_id: Unique job identifier.
        config: Arbitrary key-value configuration.
        node_ids: List of participating node IDs.
    """
    job_store.register(body.job_id, body.config, body.node_ids)
    logger.info("Job registered: %s with nodes %s", body.job_id, body.node_ids)
    return {"job_id": body.job_id, "status": "registered"}


@router.get("/jobs")
async def list_jobs() -> list[dict]:
    """List all registered training jobs."""
    return job_store.list_all()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict:
    """Get details of a specific training job."""
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return job
