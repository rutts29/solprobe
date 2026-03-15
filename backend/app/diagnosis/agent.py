"""LLM Diagnosis Agent — orchestrates enrichment, LLM call, and result storage."""

from __future__ import annotations

import logging
import os
import time
import uuid

import anthropic

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

_DEFAULT_MODEL = "claude-sonnet-4-20250514"


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

        # Check rate limit
        if not bypass_rate_limit and not self._rate_limiter.try_acquire(alert.node_id):
            result = self._make_failed_result(
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

        try:
            # Enrich alert with context
            enriched = enrich_alert(alert)

            # Find similar past diagnoses for RAG
            similar_raw = self._store.find_similar(alert.alert_type, limit=3)

            # Build prompt
            user_message = build_user_message(enriched, similar_raw)

            # Call LLM
            response = self._client.messages.create(
                model=self._model,
                max_tokens=1024,
                system=build_system_prompt(),
                tools=[DIAGNOSIS_TOOL],
                tool_choice={"type": "tool", "name": "submit_diagnosis"},
                messages=[{"role": "user", "content": user_message}],
            )

            # Parse response
            result = self._parse_response(
                response=response,
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
            )

        except Exception as exc:
            logger.exception("Diagnosis failed for alert %s", alert.alert_id)
            result = self._make_failed_result(
                diagnosis_id=diagnosis_id,
                alert=alert,
                start_ms=start_ms,
                status="failed",
                error=str(exc),
            )

        self._store.add(result)
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

        # Build evidence chain
        evidence_chain = [
            EvidenceItem(
                metric=e.get("metric", ""),
                value=e.get("value", ""),
                context=e.get("context", ""),
            )
            for e in tool_input.get("evidence_chain", [])
        ]

        # Build recommended action
        action_data = tool_input.get("recommended_action", {})
        recommended_action = RecommendedAction(
            action=action_data.get("action", "reassign_workload"),
            params=action_data.get("params", {}),
            urgency=action_data.get("urgency", "soon"),
        )

        return DiagnosisResult(
            diagnosis_id=diagnosis_id,
            alert_id=alert.alert_id,
            node_id=alert.node_id,
            timestamp_ms=int(time.time() * 1000),
            root_cause=tool_input.get("root_cause", "unknown"),
            confidence=tool_input.get("confidence", 0.5),
            reasoning=tool_input.get("reasoning", ""),
            evidence_chain=evidence_chain,
            recommended_action=recommended_action,
            similar_incidents=[],
            llm_model=getattr(response, "model", self._model),
            latency_ms=latency_ms,
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


# Lazy singleton
_agent_instance: DiagnosisAgent | None = None


def get_or_create_agent() -> DiagnosisAgent:
    """Get or create the singleton DiagnosisAgent."""
    global _agent_instance
    if _agent_instance is None:
        _agent_instance = DiagnosisAgent()
    return _agent_instance
