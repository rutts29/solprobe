"""Pydantic models for monitoring policies."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.metrics import (
    DiLoCoMetricsModel,
    GpuMetricsModel,
    TrainingMetricsModel,
)


# `custom` is the user-defined-metric source: `field` carries the custom
# metric name (e.g. "eval_bpb") rather than a model attribute. Field
# validation is skipped for `custom` because names are user-defined and
# unbounded — see `_check_field_known` below.
PolicySource = Literal["gpu", "training", "diloco", "custom"]
PolicyOperator = Literal["gt", "gte", "lt", "lte", "abs_gt", "stale_for"]
PolicySeverity = Literal["INFO", "WARNING", "CRITICAL"]


# Numeric fields each source exposes. Used for POST-time validation so
# users can't create a policy that always silently no-ops because of a
# field typo.
_NUMERIC_FIELD_TYPES = (int, float)


def _numeric_fields(model_cls: type[BaseModel]) -> set[str]:
    fields: set[str] = set()
    for name, info in model_cls.model_fields.items():
        ann = info.annotation
        if ann in _NUMERIC_FIELD_TYPES:
            fields.add(name)
    return fields


_SOURCE_FIELDS: dict[str, set[str]] = {
    "gpu": _numeric_fields(GpuMetricsModel),
    "training": _numeric_fields(TrainingMetricsModel),
    "diloco": _numeric_fields(DiLoCoMetricsModel),
}


class PolicyScope(BaseModel):
    """Optional scope filter for which nodes/jobs the policy applies to."""

    job_id: str | None = None
    node_id: str | None = None


class PolicyMetric(BaseModel):
    """The metric this policy watches."""

    source: PolicySource
    field: str


class PolicyCondition(BaseModel):
    """Trigger condition with optional sustained-violation duration."""

    operator: PolicyOperator
    threshold: float = 0.0
    for_seconds: float = Field(default=0.0, ge=0.0)


class MonitoringPolicy(BaseModel):
    """A user-defined threshold/staleness policy over existing metrics."""

    policy_id: str
    name: str
    enabled: bool = True
    scope: PolicyScope = Field(default_factory=PolicyScope)
    metric: PolicyMetric
    condition: PolicyCondition
    severity: PolicySeverity = "WARNING"
    cooldown_seconds: float = Field(default=60.0, ge=0.0)
    description: str = ""
    created_at_ms: int = 0
    updated_at_ms: int = 0
    last_triggered_at_ms: int | None = None

    @field_validator("metric")
    @classmethod
    def _check_field_known(cls, v: PolicyMetric) -> PolicyMetric:
        valid = _SOURCE_FIELDS.get(v.source)
        if valid is None:
            # Source has no field whitelist (e.g. "custom"). Names are
            # user-defined, but require non-empty so the evaluator
            # doesn't silently no-op on a blank query.
            if not v.field.strip():
                raise ValueError(f"field is required for source {v.source!r}")
            return v
        if v.field not in valid:
            raise ValueError(
                f"unknown field {v.field!r} for source {v.source!r}; "
                f"valid: {sorted(valid)}"
            )
        return v


class PolicyCreate(BaseModel):
    """Body for creating a policy. Server stamps timestamps."""

    policy_id: str
    name: str
    enabled: bool = True
    scope: PolicyScope = Field(default_factory=PolicyScope)
    metric: PolicyMetric
    condition: PolicyCondition
    severity: PolicySeverity = "WARNING"
    cooldown_seconds: float = Field(default=60.0, ge=0.0)
    description: str = ""

    @field_validator("metric")
    @classmethod
    def _check_field_known(cls, v: PolicyMetric) -> PolicyMetric:
        return MonitoringPolicy._check_field_known.__func__(cls, v)  # type: ignore[attr-defined]


class PolicyUpdate(BaseModel):
    """Patch body — every field optional."""

    name: str | None = None
    enabled: bool | None = None
    scope: PolicyScope | None = None
    metric: PolicyMetric | None = None
    condition: PolicyCondition | None = None
    severity: PolicySeverity | None = None
    cooldown_seconds: float | None = Field(default=None, ge=0.0)
    description: str | None = None

    @field_validator("metric")
    @classmethod
    def _check_field_known(cls, v: PolicyMetric | None) -> PolicyMetric | None:
        if v is None:
            return v
        return MonitoringPolicy._check_field_known.__func__(cls, v)  # type: ignore[attr-defined]
