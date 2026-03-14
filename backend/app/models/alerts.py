"""Pydantic models for alerts and anomaly findings."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AlertModel(BaseModel):
    """An alert raised by edge sidecar or central detector."""

    alert_id: str
    node_id: str
    timestamp_ms: int
    severity: str = Field(description="INFO, WARNING, or CRITICAL")
    source: str = Field(description="EDGE or CENTRAL")
    alert_type: str = Field(description="e.g. thermal_throttle, gradient_explosion")
    description: str
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    evidence: dict[str, str] = Field(default_factory=dict)
    gpu_index: int | None = None
    job_id: str | None = None


class AnomalyModel(BaseModel):
    """A central-detector anomaly finding with scoring metadata."""

    alert: AlertModel
    detector_name: str = Field(description="zscore, cross_node, or diloco")
    window_minutes: int
    raw_score: float = Field(description="The z-score or correlation value")


class EnrichedAlert(BaseModel):
    """Alert enriched with contextual data for LLM diagnosis."""

    alert: AlertModel
    recent_metrics: list[dict] = Field(
        default_factory=list,
        description="Metrics from +/-2 minute window around the alert",
    )
    node_history: list[AlertModel] = Field(
        default_factory=list,
        description="Last 10 alerts from this node",
    )
    correlated_events: list[AlertModel] = Field(
        default_factory=list,
        description="Alerts from other nodes within +/-30 seconds",
    )


class JobRegistration(BaseModel):
    """Registration payload for a training job."""

    job_id: str
    config: dict[str, str] = Field(default_factory=dict)
    node_ids: list[str] = Field(default_factory=list)
