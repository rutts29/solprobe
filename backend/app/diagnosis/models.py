"""Pydantic models for LLM diagnosis results."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class EvidenceItem(BaseModel):
    """A single piece of evidence supporting a diagnosis."""

    metric: str = Field(description="Metric name, e.g. gpu_temp_c")
    value: str = Field(description="Observed value")
    context: str = Field(description="Why this value is significant")


class RecommendedAction(BaseModel):
    """A recovery action recommendation from the LLM."""

    action: str = Field(description="Action identifier from the catalog")
    params: dict = Field(default_factory=dict, description="Action parameters")
    urgency: Literal["immediate", "soon", "monitor"] = Field(
        description="How urgently this action should be taken",
    )


class SimilarIncident(BaseModel):
    """Reference to a past diagnosis with similar characteristics."""

    diagnosis_id: str
    root_cause: str
    similarity: float = Field(ge=0.0, le=1.0)


class DiagnosisResult(BaseModel):
    """Complete diagnosis result from the LLM agent."""

    diagnosis_id: str
    alert_id: str
    alert_type: str = Field(default="", description="Original alert type for RAG matching")
    node_id: str
    timestamp_ms: int
    root_cause: str
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    evidence_chain: list[EvidenceItem] = Field(default_factory=list)
    recommended_action: RecommendedAction
    similar_incidents: list[SimilarIncident] = Field(default_factory=list)
    llm_model: str
    latency_ms: int
    status: Literal["completed", "failed", "rate_limited", "cached"]
    error: str | None = None
    cached_from: str | None = Field(
        default=None,
        description="If status='cached', the diagnosis_id this result was cloned from.",
    )

    @model_validator(mode="after")
    def _check_status_error_consistency(self) -> DiagnosisResult:
        """Ensure failed/rate_limited results have an error, completed/cached ones don't."""
        if self.status in ("failed", "rate_limited") and not self.error:
            raise ValueError(f"status='{self.status}' requires a non-empty error field")
        if self.status in ("completed", "cached") and self.error is not None:
            raise ValueError(f"status='{self.status}' must not have an error field")
        if self.status == "cached" and not self.cached_from:
            raise ValueError("status='cached' requires cached_from to be set")
        return self


class DiagnosisRequest(BaseModel):
    """POST body for manual diagnosis triggers."""

    alert_id: str
