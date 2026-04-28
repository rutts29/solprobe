"""LLM Diagnosis Agent — orchestrates enrichment, LLM call, and result storage."""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid

import anthropic
from anthropic import APIError, APITimeoutError, RateLimitError

from app.diagnosis.fingerprint import alert_fingerprint
from app.diagnosis.models import (
    DiagnosisResult,
    EvidenceItem,
    RecommendedAction,
)
from app.diagnosis.prompts import DIAGNOSIS_TOOL, build_system_prompt, build_user_message
from app.diagnosis.rate_limiter import DiagnosisRateLimiter, diagnosis_rate_limiter
from app.diagnosis.store import DiagnosisStore, diagnosis_store
from app.enrichment import enrich_alert
from app.models.alerts import AlertModel

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "claude-haiku-4-5"

# Result-cache parameters
_RESULT_CACHE_TTL_MS = 300_000  # 5 minutes
_RESULT_CACHE_MIN_CONFIDENCE = 0.7


class DiagnosisAgent:
    """Orchestrates alert enrichment → LLM diagnosis → result storage."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str = _DEFAULT_MODEL,
        store: DiagnosisStore | None = None,
        rate_limiter: DiagnosisRateLimiter | None = None,
    ) -> None:
        self._model = model
        self._store = store or diagnosis_store
        self._rate_limiter = rate_limiter or diagnosis_rate_limiter

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        try:
            self._client = anthropic.Anthropic(api_key=key)
        except Exception as exc:
            logger.warning("Failed to initialize Anthropic client: %s", exc)
            self._client = None

    def diagnose(
        self,
        alert: AlertModel,
        bypass_rate_limit: bool = False,
    ) -> DiagnosisResult:
        """Run a full diagnosis on the given alert.

        Args:
            alert: The alert to diagnose.
            bypass_rate_limit: If True, skip the per-node cooldown check.

        Returns:
            A DiagnosisResult with status completed/failed/rate_limited.
        """
        diagnosis_id = str(uuid.uuid4())
        start_ms = int(time.time() * 1000)

        # Phase 0: Result-cache lookup. If a recent high-confidence diagnosis
        # was made for a semantically-equivalent alert, clone it instead of
        # calling the LLM. Fingerprint includes magnitude buckets + XID codes
        # so different-magnitude spikes never collide.
        fingerprint = alert_fingerprint(alert)
        cached = self._store.find_cached_match(
            fingerprint=fingerprint,
            max_age_ms=_RESULT_CACHE_TTL_MS,
            min_confidence=_RESULT_CACHE_MIN_CONFIDENCE,
        )
        if cached is not None:
            logger.info(
                "Result cache HIT: alert=%s cloned_from=%s fingerprint=%s",
                alert.alert_id, cached.diagnosis_id, fingerprint,
            )
            cloned = DiagnosisResult(
                diagnosis_id=diagnosis_id,
                alert_id=alert.alert_id,
                alert_type=cached.alert_type,
                node_id=alert.node_id,
                timestamp_ms=int(time.time() * 1000),
                root_cause=cached.root_cause,
                confidence=cached.confidence,
                reasoning=cached.reasoning,
                evidence_chain=cached.evidence_chain,
                recommended_action=cached.recommended_action,
                similar_incidents=cached.similar_incidents,
                llm_model=cached.llm_model,
                latency_ms=int(time.time() * 1000) - start_ms,
                status="cached",
                cached_from=cached.diagnosis_id,
            )
            self._store.add(cloned)
            return cloned

        # Check rate limit
        if not bypass_rate_limit and not self._rate_limiter.try_acquire(alert.node_id):
            result = self._make_llm_unavailable_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="rate_limited",
                error="Rate limited: cooldown period active for this node",
            )
            self._store.add(result)
            return result

        # Check client availability
        if self._client is None:
            result = self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error="Anthropic client not initialized (missing API key?)",
            )
            self._store.add(result)
            return result

        # Phase 1: Context preparation (enrichment + RAG + prompt building)
        try:
            enriched = enrich_alert(alert)
            similar_raw = self._store.find_similar(alert.alert_type, limit=3)
            user_message = build_user_message(enriched, similar_raw)
        except Exception as exc:
            logger.exception("Context preparation failed for alert %s", alert.alert_id)
            result = self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=f"Context preparation failed: {type(exc).__name__}",
            )
            self._store.add(result)
            return result

        # Phase 2: LLM call with prompt caching enabled
        # Cache breakpoint on the tool definition caches [system + tool] as a
        # prefix. Subsequent diagnoses in the 5-min window pay ~10% of base
        # input price on this prefix. Requires prefix >= 4096 tokens on Haiku 4.5.
        cached_tool = {**DIAGNOSIS_TOOL, "cache_control": {"type": "ephemeral"}}
        cached_system = [
            {
                "type": "text",
                "text": build_system_prompt(),
                "cache_control": {"type": "ephemeral"},
            }
        ]
        try:
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=cached_system,
                tools=[cached_tool],
                tool_choice={"type": "tool", "name": "submit_diagnosis"},
                messages=[{"role": "user", "content": user_message}],
            )
            # Log cache usage for observability
            usage = getattr(response, "usage", None)
            if usage is not None:
                cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
                cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
                logger.info(
                    "Diagnosis cache: read=%d write=%d fresh_input=%d output=%d alert=%s",
                    cache_read, cache_write, usage.input_tokens, usage.output_tokens,
                    alert.alert_id,
                )
        except RateLimitError:
            logger.warning("Anthropic rate limit hit for alert %s", alert.alert_id)
            result = self._make_llm_unavailable_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error="LLM API rate limit exceeded",
            )
            self._store.add(result)
            return result
        except APITimeoutError:
            logger.warning("Anthropic API timeout for alert %s", alert.alert_id)
            result = self._make_llm_unavailable_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error="LLM API request timed out",
            )
            self._store.add(result)
            return result
        except APIError as exc:
            logger.exception("Anthropic API error for alert %s", alert.alert_id)
            result = self._make_llm_unavailable_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=f"LLM API error: {type(exc).__name__}",
            )
            self._store.add(result)
            return result
        except Exception as exc:
            logger.exception("Unexpected error calling LLM for alert %s", alert.alert_id)
            result = self._make_llm_unavailable_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=f"Unexpected LLM error: {type(exc).__name__}",
            )
            self._store.add(result)
            return result

        # Phase 3: Parse response
        result = self._parse_response(
            response=response,
            diagnosis_id=diagnosis_id,
            alert=alert,
            start_ms=start_ms,
        )

        self._store.add(result)
        # Index completed diagnoses by fingerprint so future equivalent alerts
        # can reuse them. Only index completed results — failed/rate_limited
        # shouldn't be reused, and 'cached' results never reach this line.
        if result.status == "completed":
            self._store.index_fingerprint(result.diagnosis_id, fingerprint)
        return result

    def _parse_response(
        self,
        response: object,
        diagnosis_id: str,
        alert: AlertModel,
        start_ms: int,
    ) -> DiagnosisResult:
        """Extract tool_use block from LLM response and build DiagnosisResult."""
        latency_ms = int(time.time() * 1000) - start_ms

        # Find the tool_use block
        tool_input = None
        for block in response.content:
            if block.type == "tool_use" and block.name == "submit_diagnosis":
                tool_input = block.input
                break

        if tool_input is None:
            return self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error="No submit_diagnosis tool_use block in LLM response",
            )

        # Validate required fields are present — fail rather than fabricating defaults
        missing_fields = []
        for field in ("root_cause", "confidence", "reasoning", "evidence_chain", "recommended_action"):
            if field not in tool_input:
                missing_fields.append(field)
        if missing_fields:
            return self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=f"LLM response missing required fields: {', '.join(missing_fields)}",
            )

        # Validate recommended_action has required sub-fields
        action_data = tool_input["recommended_action"]
        missing_action_fields = []
        for field in ("action", "urgency"):
            if field not in action_data:
                missing_action_fields.append(field)
        if missing_action_fields:
            return self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=f"LLM response recommended_action missing: {', '.join(missing_action_fields)}",
            )

        # Build evidence chain
        evidence_chain = [
            EvidenceItem(
                metric=e.get("metric", ""),
                value=e.get("value", ""),
                context=e.get("context", ""),
            )
            for e in tool_input["evidence_chain"]
        ]

        # Build recommended action
        recommended_action = RecommendedAction(
            action=action_data["action"],
            params=action_data.get("params", {}),
            urgency=action_data["urgency"],
        )

        return DiagnosisResult(
            diagnosis_id=diagnosis_id,
            alert_id=alert.alert_id,
            alert_type=alert.alert_type,
            node_id=alert.node_id,
            timestamp_ms=int(time.time() * 1000),
            root_cause=tool_input["root_cause"],
            confidence=tool_input["confidence"],
            reasoning=tool_input["reasoning"],
            evidence_chain=evidence_chain,
            recommended_action=recommended_action,
            similar_incidents=[],
            llm_model=getattr(response, "model", self._model),
            latency_ms=latency_ms,
            status="completed",
            error=None,
        )

    def _make_llm_unavailable_result(
        self,
        diagnosis_id: str,
        alert: AlertModel,
        start_ms: int,
        status: str,
        error: str,
    ) -> DiagnosisResult:
        """Return a deterministic diagnosis for known alerts when the LLM is unavailable."""
        fallback = self._make_local_fallback_result(
            diagnosis_id=diagnosis_id,
            alert=alert,
            start_ms=start_ms,
        )
        if fallback is not None:
            logger.warning(
                "Using local diagnosis fallback for alert %s after LLM failure: %s",
                alert.alert_id,
                error,
            )
            return fallback
        return self._make_failed_result(
            diagnosis_id=diagnosis_id,
            alert=alert,
            start_ms=start_ms,
            status=status,
            error=error,
        )

    def _make_local_fallback_result(
        self,
        diagnosis_id: str,
        alert: AlertModel,
        start_ms: int,
    ) -> DiagnosisResult | None:
        """Build a rule-based diagnosis for alert types with clear recovery semantics."""
        fallback_types = {
            "gradient_explosion",
            "loss_spike",
            "straggler_detected",
            "numeric_instability",
            "training_stalled",
            "loss_plateau",
            "throughput_regression",
            "policy_violation",
        }
        if alert.alert_type not in fallback_types:
            return None

        evidence = alert.evidence or {}
        evidence_chain: list[EvidenceItem] = []
        if "detector" in evidence:
            evidence_chain.append(
                EvidenceItem(
                    metric="detector",
                    value=str(evidence["detector"]),
                    context="detector that raised this alert",
                ),
            )
        if "gradient_norm" in evidence:
            threshold = evidence.get("threshold", "configured threshold")
            evidence_chain.append(
                EvidenceItem(
                    metric="gradient_norm",
                    value=str(evidence["gradient_norm"]),
                    context=f"exceeds configured threshold {threshold}",
                ),
            )
        if "loss" in evidence:
            evidence_chain.append(
                EvidenceItem(
                    metric="loss",
                    value=str(evidence["loss"]),
                    context="loss spike reported by the training callback",
                ),
            )
        if "step" in evidence:
            evidence_chain.append(
                EvidenceItem(
                    metric="step",
                    value=str(evidence["step"]),
                    context="training step where the instability was observed",
                ),
            )
        if "z_score" in evidence:
            evidence_chain.append(
                EvidenceItem(
                    metric="z_score",
                    value=str(evidence["z_score"]),
                    context="statistical deviation reported by the central detector",
                ),
            )
        if "field" in evidence:
            evidence_chain.append(
                EvidenceItem(
                    metric="field",
                    value=str(evidence["field"]),
                    context="metric that triggered the anomaly detector",
                ),
            )
        if not evidence_chain:
            evidence_chain.append(
                EvidenceItem(
                    metric="alert",
                    value=alert.description,
                    context="edge detector reported training instability",
                ),
            )

        if alert.alert_type == "gradient_explosion":
            root_cause = "gradient_instability"
            action = RecommendedAction(
                action="rollback_lr",
                params={"factor": 0.1},
                urgency="soon" if alert.severity == "WARNING" else "immediate",
            )
            reasoning = (
                "The edge sidecar observed a gradient norm above the configured critical "
                "threshold during training. That is consistent with numerical instability, "
                "an overly aggressive learning rate, or a corrupted batch. Claude diagnosis "
                "was unavailable, so this local fallback recommends reducing the learning "
                "rate and inspecting the triggering batch/checkpoint before continuing."
            )
            confidence = 0.78
        elif alert.alert_type == "loss_spike":
            root_cause = "data_corruption"
            action = RecommendedAction(
                action="skip_corrupted_shard",
                params={},
                urgency="soon",
            )
            reasoning = (
                "The training callback reported a loss spike. Without an LLM response, the "
                "local fallback treats this as a likely bad batch or corrupted data shard and "
                "recommends skipping or inspecting the current shard before resuming."
            )
            confidence = 0.7
        elif alert.alert_type in {"straggler_detected", "throughput_regression"}:
            root_cause = "throughput_regression"
            action = RecommendedAction(
                action="inspect_node_throughput",
                params={"node_id": alert.node_id},
                urgency="soon" if alert.severity == "WARNING" else "immediate",
            )
            reasoning = (
                "The central detector observed a statistically significant throughput drop "
                "for this training node. That is consistent with an overloaded host, thermal "
                "or memory pressure, checkpoint/sample overhead, or another process competing "
                "for GPU resources. Claude diagnosis was unavailable, so this local fallback "
                "recommends checking node load, recent training events, and GPU utilization "
                "around the alert timestamp before rebalancing work."
            )
            confidence = 0.72
        elif alert.alert_type == "numeric_instability":
            root_cause = "numeric_instability"
            action = RecommendedAction(
                action="rollback_lr",
                params={"factor": 0.5, "inspect_non_finite_metric": True},
                urgency="immediate",
            )
            reasoning = (
                "A training metric became NaN or infinite. That usually points to "
                "numerical instability from learning rate, bad input data, mixed "
                "precision overflow, or an unstable optimizer state. Claude diagnosis "
                "was unavailable, so this local fallback recommends reducing the "
                "learning rate and inspecting the latest batch and checkpoint."
            )
            confidence = 0.76
        elif alert.alert_type == "training_stalled":
            root_cause = "training_stalled"
            action = RecommendedAction(
                action="inspect_training_loop",
                params={"node_id": alert.node_id},
                urgency="soon" if alert.severity == "WARNING" else "immediate",
            )
            reasoning = (
                "Training progress stopped while the node was still reporting metrics. "
                "That is consistent with a blocked dataloader, checkpoint save, deadlock, "
                "or training process hang. Claude diagnosis was unavailable, so this "
                "local fallback recommends checking the training logs, dataloader, and "
                "latest checkpoint operation before resuming."
            )
            confidence = 0.74
        elif alert.alert_type == "loss_plateau":
            root_cause = "loss_plateau"
            action = RecommendedAction(
                action="inspect_learning_dynamics",
                params={"check_lr_schedule": True, "check_data_mix": True},
                urgency="monitor",
            )
            reasoning = (
                "Loss flattened while throughput remained healthy. That is consistent "
                "with an exhausted learning-rate schedule, data distribution issue, "
                "under-capacity model, or optimization plateau. Claude diagnosis was "
                "unavailable, so this local fallback recommends checking learning-rate "
                "schedule, batch composition, and validation behavior."
            )
            confidence = 0.68
        else:
            root_cause = "policy_violation"
            action = RecommendedAction(
                action="inspect_policy_trigger",
                params={
                    "policy_id": str(evidence.get("policy_id", "")),
                    "field": str(evidence.get("field", "")),
                },
                urgency="soon" if alert.severity == "WARNING" else "immediate",
            )
            reasoning = (
                "A user-defined monitoring policy fired. Claude diagnosis was unavailable, "
                "so this local fallback recommends inspecting the policy threshold, the "
                "actual metric value, and whether the policy is scoped to the intended "
                "node or job before taking remediation."
            )
            confidence = 0.66

        return DiagnosisResult(
            diagnosis_id=diagnosis_id,
            alert_id=alert.alert_id,
            alert_type=alert.alert_type,
            node_id=alert.node_id,
            timestamp_ms=int(time.time() * 1000),
            root_cause=root_cause,
            confidence=confidence,
            reasoning=reasoning,
            evidence_chain=evidence_chain,
            recommended_action=action,
            similar_incidents=[],
            llm_model="local-fallback",
            latency_ms=int(time.time() * 1000) - start_ms,
            status="completed",
            error=None,
        )

    def _make_failed_result(
        self,
        diagnosis_id: str,
        alert: AlertModel,
        start_ms: int,
        status: str,
        error: str,
    ) -> DiagnosisResult:
        """Build a failed/rate_limited DiagnosisResult."""
        return DiagnosisResult(
            diagnosis_id=diagnosis_id,
            alert_id=alert.alert_id,
            alert_type=alert.alert_type,
            node_id=alert.node_id,
            timestamp_ms=int(time.time() * 1000),
            root_cause="unknown",
            confidence=0.0,
            reasoning="",
            evidence_chain=[],
            recommended_action=RecommendedAction(
                action="reassign_workload",
                params={},
                urgency="monitor",
            ),
            similar_incidents=[],
            llm_model=self._model,
            latency_ms=int(time.time() * 1000) - start_ms,
            status=status,
            error=error,
        )


# Thread-safe lazy singleton
_agent_instance: DiagnosisAgent | None = None
_agent_lock = threading.Lock()


def get_or_create_agent() -> DiagnosisAgent:
    """Get or create the singleton DiagnosisAgent (thread-safe)."""
    global _agent_instance
    if _agent_instance is not None:
        return _agent_instance
    with _agent_lock:
        # Double-checked locking
        if _agent_instance is None:
            _agent_instance = DiagnosisAgent()
        return _agent_instance
