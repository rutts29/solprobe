"""REST API routes for SolProbe backend.

All endpoints are async and return JSON via Pydantic serialization.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

import time

from app.auth import require_api_key
from app.diagnosis.agent import get_or_create_agent
from app.diagnosis.models import DiagnosisRequest, DiagnosisResult
from app.diagnosis.store import diagnosis_store
from app.enrichment import enrich_alert
from app.models.alerts import AlertModel, EnrichedAlert, JobRegistration
from app.models.metrics import CustomMetricModel, GpuMetricsModel, MetricsBatchModel, NodeStatus
from app.models.policies import MonitoringPolicy, PolicyCreate, PolicyUpdate
from app.stores import (
    alert_lifecycle_store,
    alert_store,
    anomaly_store,
    custom_metrics_store,
    job_store,
    metrics_store,
    policy_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["solprobe"], dependencies=[Depends(require_api_key)])


# ---------------------------------------------------------------------------
# Lifecycle wrapper models — re-declare AlertModel fields flat so the existing
# wire contract is preserved while adding `lifecycle`.
# ---------------------------------------------------------------------------


class AlertWithLifecycle(BaseModel):
    alert_id: str
    node_id: str
    timestamp_ms: int
    severity: str
    source: str
    alert_type: str
    description: str
    confidence: float
    evidence: dict[str, str] = Field(default_factory=dict)
    gpu_index: int | None = None
    job_id: str | None = None
    lifecycle: dict[str, Any] | None = None


class EnrichedAlertWithLifecycle(BaseModel):
    alert: AlertModel
    recent_metrics: list[dict] = Field(default_factory=list)
    node_history: list[AlertModel] = Field(default_factory=list)
    correlated_events: list[AlertModel] = Field(default_factory=list)
    lifecycle: dict[str, Any] | None = None


class LifecycleStateRequest(BaseModel):
    state: str


class LifecycleNoteRequest(BaseModel):
    text: str
    author: str | None = None


class JobStatusRequest(BaseModel):
    status: str


def _attach_lifecycle(alert: AlertModel) -> AlertWithLifecycle:
    return AlertWithLifecycle(
        **alert.model_dump(),
        lifecycle=alert_lifecycle_store.get(alert.alert_id),
    )


# ---------------------------------------------------------------------------
# Node endpoints
# ---------------------------------------------------------------------------


@router.post("/metrics/batches", status_code=201)
async def post_metrics_batches(
    body: MetricsBatchModel | list[MetricsBatchModel],
) -> dict[str, int]:
    """Ingest metrics batches over REST.

    This mirrors the gRPC sidecar ingest path for clients that cannot run the
    Rust sidecar, such as Google Colab notebooks.
    """
    items = body if isinstance(body, list) else [body]
    if not items:
        raise HTTPException(status_code=400, detail="Empty metrics batch list")
    for batch in items:
        if not batch.gpu and batch.training is None and batch.diloco is None:
            raise HTTPException(status_code=400, detail="Metrics batch has no samples")
        metrics_store.ingest_batch(batch)
    return {"accepted": len(items)}


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


@router.get("/alerts", response_model=list[AlertWithLifecycle])
async def list_alerts(
    severity: str | None = Query(default=None, description="Filter by severity: INFO, WARNING, CRITICAL"),
    alert_type: str | None = Query(default=None, description="Filter by alert type"),
    node_id: str | None = Query(default=None, description="Filter by node ID"),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[AlertWithLifecycle]:
    """Return recent alerts with optional filters, newest first."""
    alerts = alert_store.query(
        node_id=node_id,
        severity=severity,
        alert_type=alert_type,
        limit=limit,
    )
    return [_attach_lifecycle(a) for a in alerts]


@router.get("/alerts/{alert_id}/enriched", response_model=EnrichedAlertWithLifecycle)
async def get_enriched_alert(alert_id: str) -> EnrichedAlertWithLifecycle:
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
    enriched = enrich_alert(target)
    return EnrichedAlertWithLifecycle(
        alert=enriched.alert,
        recent_metrics=enriched.recent_metrics,
        node_history=enriched.node_history,
        correlated_events=enriched.correlated_events,
        lifecycle=alert_lifecycle_store.get(alert_id),
    )


@router.patch("/alerts/{alert_id}/state")
async def patch_alert_state(alert_id: str, body: LifecycleStateRequest) -> dict[str, Any]:
    """Update the lifecycle state of an alert.

    Valid states: acknowledged, investigating, resolved, ignored.
    Returns the updated lifecycle dict.
    """
    if not _alert_exists(alert_id):
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    try:
        return alert_lifecycle_store.set_state(alert_id, body.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/alerts/{alert_id}/notes")
async def post_alert_note(alert_id: str, body: LifecycleNoteRequest) -> dict[str, Any]:
    """Append a free-text note to an alert's lifecycle entry.

    Returns the updated lifecycle dict.
    """
    if not _alert_exists(alert_id):
        raise HTTPException(status_code=404, detail=f"Alert '{alert_id}' not found")
    return alert_lifecycle_store.add_note(alert_id, body.text, author=body.author)


def _alert_exists(alert_id: str) -> bool:
    for a in alert_store.query(limit=1000):
        if a.alert_id == alert_id:
            return True
    return False


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
        name: Optional human-readable run name.
        config: Arbitrary key-value configuration.
        node_ids: List of participating node IDs.
    """
    job_store.register(body.job_id, body.config, body.node_ids, name=body.name)
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


@router.patch("/jobs/{job_id}/status")
async def patch_job_status(job_id: str, body: JobStatusRequest) -> dict:
    """Update a job lifecycle status."""
    if job_store.get(job_id) is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    try:
        job_store.update_status(job_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return job


@router.get("/jobs/{job_id}/summary")
async def get_job_summary(job_id: str) -> dict:
    """Return latest training/hardware metrics, job-scoped alerts, and diagnoses.

    Latest training and hardware are picked from any node listed in the job's
    `node_ids`, by most recent timestamp. Alerts are filtered by `alert.job_id`,
    and diagnoses are joined to those alerts via `alert_id`.
    """
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    latest_training = None
    latest_hardware = None
    latest_training_ts = -1
    latest_hardware_ts = -1
    for node_id in job.get("node_ids", []) or []:
        status = metrics_store.get_node_status(node_id)
        if status is None:
            continue
        if status.latest_training and status.latest_training.timestamp_ms > latest_training_ts:
            latest_training = status.latest_training
            latest_training_ts = status.latest_training.timestamp_ms
        if status.latest_metrics:
            ts = max((g.timestamp_ms for g in status.latest_metrics), default=-1)
            if ts > latest_hardware_ts:
                # Pick the GPU sample with max timestamp inside the latest snapshot.
                latest_hardware = max(status.latest_metrics, key=lambda g: g.timestamp_ms)
                latest_hardware_ts = ts

    job_alerts = [a for a in alert_store.query(limit=1000) if a.job_id == job_id]

    seen_diag_ids: set[str] = set()
    diagnoses: list[DiagnosisResult] = []
    for alert in job_alerts:
        d = diagnosis_store.get_by_alert_id(alert.alert_id)
        if d is not None and d.diagnosis_id not in seen_diag_ids:
            diagnoses.append(d)
            seen_diag_ids.add(d.diagnosis_id)

    created_at = int(job.get("created_at_ms", 0))
    if job.get("status") in ("completed", "failed"):
        end_ms = int(job.get("updated_at_ms", created_at))
    else:
        end_ms = int(time.time() * 1000)
    run_duration_ms = max(0, end_ms - created_at)

    return {
        "job": job,
        "latest_training": latest_training.model_dump() if latest_training else None,
        "latest_hardware": latest_hardware.model_dump() if latest_hardware else None,
        "alerts": [a.model_dump() for a in job_alerts],
        "diagnoses": [d.model_dump() for d in diagnoses],
        "run_duration_ms": run_duration_ms,
    }


# ---------------------------------------------------------------------------
# Diagnosis endpoints
# ---------------------------------------------------------------------------


@router.get("/diagnoses", response_model=list[DiagnosisResult])
async def list_diagnoses(
    node_id: str | None = Query(default=None, description="Filter by node ID"),
    root_cause: str | None = Query(default=None, description="Filter by root cause"),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[DiagnosisResult]:
    """Return recent diagnoses with optional filters, newest first."""
    return diagnosis_store.query(node_id=node_id, root_cause=root_cause, limit=limit)


@router.get("/diagnoses/{diagnosis_id}", response_model=DiagnosisResult)
async def get_diagnosis(diagnosis_id: str) -> DiagnosisResult:
    """Get a single diagnosis by ID."""
    result = diagnosis_store.get_by_id(diagnosis_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Diagnosis '{diagnosis_id}' not found")
    return result


@router.post("/diagnoses", response_model=DiagnosisResult)
async def create_diagnosis(body: DiagnosisRequest) -> Response:
    """Manually trigger a diagnosis for a specific alert (bypasses rate limit)."""
    # Find the alert
    all_alerts = alert_store.query(limit=1000)
    target = None
    for a in all_alerts:
        if a.alert_id == body.alert_id:
            target = a
            break
    if target is None:
        raise HTTPException(status_code=404, detail=f"Alert '{body.alert_id}' not found")

    agent = get_or_create_agent()
    result = await asyncio.to_thread(agent.diagnose, target, True)

    status_code = 201 if result.status in ("completed", "cached") else 502
    return Response(
        content=result.model_dump_json(),
        status_code=status_code,
        media_type="application/json",
    )


@router.get("/alerts/{alert_id}/diagnosis", response_model=DiagnosisResult)
async def get_alert_diagnosis(alert_id: str) -> DiagnosisResult:
    """Get the diagnosis for a specific alert."""
    result = diagnosis_store.get_by_alert_id(alert_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"No diagnosis found for alert '{alert_id}'")
    return result


# ---------------------------------------------------------------------------
# Policy endpoints
# ---------------------------------------------------------------------------


@router.get("/policies", response_model=list[MonitoringPolicy])
async def list_policies() -> list[MonitoringPolicy]:
    """Return all monitoring policies, newest first by update time."""
    raw = policy_store.list_all()
    raw.sort(key=lambda p: p.get("updated_at_ms", 0), reverse=True)
    return [MonitoringPolicy(**p) for p in raw]


@router.post("/policies", response_model=MonitoringPolicy, status_code=201)
async def create_policy(body: PolicyCreate) -> MonitoringPolicy:
    """Create a new monitoring policy. 409 if `policy_id` already exists."""
    try:
        created = policy_store.create(body.model_dump())
    except KeyError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return MonitoringPolicy(**created)


@router.patch("/policies/{policy_id}", response_model=MonitoringPolicy)
async def patch_policy(policy_id: str, body: PolicyUpdate) -> MonitoringPolicy:
    """Patch a policy. Only fields supplied in the body are updated."""
    patch = body.model_dump(exclude_unset=True)
    updated = policy_store.update(policy_id, patch)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Policy '{policy_id}' not found")
    return MonitoringPolicy(**updated)


@router.delete("/policies/{policy_id}", status_code=204)
async def delete_policy(policy_id: str) -> Response:
    if not policy_store.delete(policy_id):
        raise HTTPException(status_code=404, detail=f"Policy '{policy_id}' not found")
    return Response(status_code=204)


@router.post("/policies/{policy_id}/toggle", response_model=MonitoringPolicy)
async def toggle_policy(policy_id: str) -> MonitoringPolicy:
    """Flip the `enabled` flag on a policy."""
    toggled = policy_store.toggle(policy_id)
    if toggled is None:
        raise HTTPException(status_code=404, detail=f"Policy '{policy_id}' not found")
    return MonitoringPolicy(**toggled)


# ---------------------------------------------------------------------------
# Custom-metric endpoints (Phase 4 V0)
# ---------------------------------------------------------------------------


@router.post("/custom-metrics", status_code=201)
async def post_custom_metrics(
    body: CustomMetricModel | list[CustomMetricModel],
) -> dict[str, int]:
    """Ingest a single custom metric or a list of them."""
    items = body if isinstance(body, list) else [body]
    if not items:
        raise HTTPException(status_code=400, detail="Empty metric list")
    for m in items:
        custom_metrics_store.add(m)
    return {"accepted": len(items)}


@router.get("/custom-metrics", response_model=list[CustomMetricModel])
async def list_custom_metrics(
    job_id: str | None = Query(default=None),
    name: str | None = Query(default=None),
    node_id: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[CustomMetricModel]:
    """Return matching custom metrics newest-first."""
    return custom_metrics_store.query(
        name=name, job_id=job_id, node_id=node_id, limit=limit
    )


@router.get("/custom-metrics/names")
async def list_custom_metric_names(
    job_id: str | None = Query(default=None),
) -> list[str]:
    """Return distinct metric names known to the store."""
    return custom_metrics_store.get_names(job_id=job_id)
