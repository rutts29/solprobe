"""Tests for DiagnosisAgent with mocked LLM responses."""

from __future__ import annotations

import time
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.diagnosis.agent import DiagnosisAgent
from app.diagnosis.models import DiagnosisResult
from app.diagnosis.rate_limiter import DiagnosisRateLimiter
from app.diagnosis.store import DiagnosisStore
from app.models.alerts import AlertModel


def _make_alert(
    alert_id: str | None = None,
    node_id: str = "node-1",
    severity: str = "CRITICAL",
    alert_type: str = "thermal_throttle",
) -> AlertModel:
    return AlertModel(
        alert_id=alert_id or str(uuid.uuid4()),
        node_id=node_id,
        timestamp_ms=int(time.time() * 1000),
        severity=severity,
        source="EDGE",
        alert_type=alert_type,
        description="Test alert for diagnosis",
        confidence=0.95,
        evidence={"gpu_temp_c": "92.3"},
    )


def _mock_tool_use_response():
    """Create a mock Anthropic API response with a tool_use block."""
    tool_input = {
        "root_cause": "thermal_throttle",
        "confidence": 0.92,
        "reasoning": "GPU temperature at 92.3°C exceeds the 85°C thermal throttle threshold.",
        "evidence_chain": [
            {
                "metric": "gpu_temp_c",
                "value": "92.3",
                "context": "Above 85°C thermal throttle threshold",
            },
        ],
        "recommended_action": {
            "action": "reassign_workload",
            "params": {"target_node": "node-2"},
            "urgency": "immediate",
        },
    }

    tool_use_block = MagicMock()
    tool_use_block.type = "tool_use"
    tool_use_block.name = "submit_diagnosis"
    tool_use_block.input = tool_input

    response = MagicMock()
    response.content = [tool_use_block]
    response.model = "claude-sonnet-4-20250514"
    return response


class TestDiagnosisAgent:
    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_full_diagnosis_pipeline(self, mock_anthropic_mod, mock_enrich):
        """Test the full pipeline: enrichment → LLM → parsing → storage."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[],
            correlated_events=[],
        )
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter()

        agent = DiagnosisAgent(
            api_key="test-key",
            store=store,
            rate_limiter=rate_limiter,
        )

        result = agent.diagnose(alert)

        assert result.status == "completed"
        assert result.root_cause == "thermal_throttle"
        assert result.confidence == 0.92
        assert result.alert_id == alert.alert_id
        assert result.alert_type == "thermal_throttle"
        assert result.node_id == alert.node_id
        assert len(result.evidence_chain) == 1
        assert result.recommended_action.action == "reassign_workload"
        assert result.recommended_action.urgency == "immediate"
        assert result.llm_model == "claude-sonnet-4-20250514"
        assert result.latency_ms >= 0
        assert result.error is None

        # Verify it was stored
        assert store.count == 1
        stored = store.get_by_id(result.diagnosis_id)
        assert stored is not None

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_rate_limiting(self, mock_anthropic_mod, mock_enrich):
        """Second call within 30s returns rate_limited status."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter(cooldown_seconds=30.0)

        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=rate_limiter)

        # First call should succeed
        result1 = agent.diagnose(alert)
        assert result1.status == "completed"

        # Second call for same node but DIFFERENT alert type should be rate-limited.
        # (Different alert_type → different fingerprint → bypasses result cache,
        # so the rate-limiter path is exercised.)
        alert2 = _make_alert(node_id="node-1", alert_type="memory_pressure")
        result2 = agent.diagnose(alert2)
        assert result2.status == "rate_limited"
        assert result2.error is not None

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_bypass_rate_limit(self, mock_anthropic_mod, mock_enrich):
        """bypass_rate_limit=True skips the cooldown check."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter(cooldown_seconds=30.0)

        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=rate_limiter)

        result1 = agent.diagnose(alert)
        assert result1.status == "completed"

        # Different alert_type → different fingerprint → result cache misses,
        # so bypass_rate_limit path reaches the LLM and returns completed.
        alert2 = _make_alert(node_id="node-1", alert_type="memory_pressure")
        result2 = agent.diagnose(alert2, bypass_rate_limit=True)
        assert result2.status == "completed"

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_api_error_returns_failed(self, mock_anthropic_mod, mock_enrich):
        """API error returns status=failed with sanitized error message."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = Exception("API timeout")
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter()

        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=rate_limiter)
        result = agent.diagnose(alert)

        assert result.status == "failed"
        assert result.error is not None
        # Error should be sanitized (type name, not raw message)
        assert "Exception" in result.error

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_gradient_explosion_llm_error_uses_local_fallback(self, mock_anthropic_mod, mock_enrich):
        """Known training alerts get a deterministic diagnosis if the LLM call fails."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert(alert_type="gradient_explosion")
        alert.description = "Gradient norm 693.6188 exceeds critical threshold 100.0 at step 42"
        alert.evidence = {"step": "42", "threshold": "100.0", "gradient_norm": "693.6188"}
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = TypeError("SDK request construction failed")
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter()

        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=rate_limiter)
        result = agent.diagnose(alert, bypass_rate_limit=True)

        assert result.status == "completed"
        assert result.root_cause == "gradient_instability"
        assert result.recommended_action.action == "rollback_lr"
        assert result.error is None
        assert result.llm_model == "local-fallback"

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_gradient_explosion_rate_limit_uses_local_fallback(self, mock_anthropic_mod, mock_enrich):
        """Rate limiting paid LLM calls should not hide obvious local training diagnoses."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert(alert_type="gradient_explosion")
        alert.evidence = {"step": "42", "threshold": "100.0", "gradient_norm": "693.6188"}
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter(cooldown_seconds=30.0)
        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=rate_limiter)

        assert agent.diagnose(_make_alert(node_id=alert.node_id, alert_type="memory_pressure")).status == "completed"

        result = agent.diagnose(alert)

        assert result.status == "completed"
        assert result.root_cause == "gradient_instability"
        assert result.llm_model == "local-fallback"
        assert mock_client.messages.create.call_count == 1

    @patch("app.diagnosis.agent.anthropic")
    def test_no_api_key_returns_failed(self, mock_anthropic_mod):
        """No API key results in failed diagnosis."""
        mock_anthropic_mod.Anthropic.side_effect = Exception("No API key")

        store = DiagnosisStore()
        rate_limiter = DiagnosisRateLimiter()

        agent = DiagnosisAgent(api_key=None, store=store, rate_limiter=rate_limiter)
        alert = _make_alert()
        result = agent.diagnose(alert)
        assert result.status == "failed"
        assert result.error is not None

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_malformed_response_no_tool_use(self, mock_anthropic_mod, mock_enrich):
        """LLM response without tool_use block returns failed."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        # Response with only a text block, no tool_use
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = "I cannot diagnose this."

        response = MagicMock()
        response.content = [text_block]
        response.model = "claude-sonnet-4-20250514"

        mock_client = MagicMock()
        mock_client.messages.create.return_value = response
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=DiagnosisRateLimiter())
        result = agent.diagnose(alert)

        assert result.status == "failed"
        assert "No submit_diagnosis tool_use block" in result.error

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_malformed_response_missing_fields(self, mock_anthropic_mod, mock_enrich):
        """LLM response with missing required fields returns failed."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        # tool_use block with incomplete data
        tool_use_block = MagicMock()
        tool_use_block.type = "tool_use"
        tool_use_block.name = "submit_diagnosis"
        tool_use_block.input = {"root_cause": "thermal_throttle"}  # missing other fields

        response = MagicMock()
        response.content = [tool_use_block]
        response.model = "claude-sonnet-4-20250514"

        mock_client = MagicMock()
        mock_client.messages.create.return_value = response
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=DiagnosisRateLimiter())
        result = agent.diagnose(alert)

        assert result.status == "failed"
        assert "missing required fields" in result.error

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_context_preparation_failure(self, mock_anthropic_mod, mock_enrich):
        """Enrichment failure is reported separately from LLM errors."""
        mock_enrich.side_effect = RuntimeError("store corrupted")

        mock_client = MagicMock()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=DiagnosisRateLimiter())
        alert = _make_alert()
        result = agent.diagnose(alert)

        assert result.status == "failed"
        assert "Context preparation failed" in result.error
        # LLM should never be called
        mock_client.messages.create.assert_not_called()

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_anthropic_rate_limit_error(self, mock_anthropic_mod, mock_enrich):
        """Anthropic RateLimitError is caught specifically."""
        import anthropic as real_anthropic
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.side_effect = real_anthropic.RateLimitError(
            message="rate limited",
            response=MagicMock(status_code=429),
            body=None,
        )
        mock_anthropic_mod.Anthropic.return_value = mock_client
        # Wire up actual exception classes so isinstance checks work
        mock_anthropic_mod.RateLimitError = real_anthropic.RateLimitError
        mock_anthropic_mod.APITimeoutError = real_anthropic.APITimeoutError
        mock_anthropic_mod.APIError = real_anthropic.APIError

        store = DiagnosisStore()
        agent = DiagnosisAgent(api_key="test-key", store=store, rate_limiter=DiagnosisRateLimiter())
        result = agent.diagnose(alert)

        assert result.status == "failed"
        assert "rate limit" in result.error.lower()

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_result_cache_hit(self, mock_anthropic_mod, mock_enrich):
        """Second alert with matching fingerprint returns cached result, skips LLM."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        agent = DiagnosisAgent(
            api_key="test-key",
            store=store,
            rate_limiter=DiagnosisRateLimiter(cooldown_seconds=0.0),
        )

        # First call: real LLM call, stores completed diagnosis with fingerprint.
        result1 = agent.diagnose(alert)
        assert result1.status == "completed"
        assert mock_client.messages.create.call_count == 1

        # Second call with IDENTICAL alert fields → same fingerprint → cache hit.
        # LLM must NOT be called again.
        alert2 = _make_alert()  # same node, type, severity, description, evidence
        result2 = agent.diagnose(alert2)
        assert result2.status == "cached"
        assert result2.cached_from == result1.diagnosis_id
        assert result2.root_cause == result1.root_cause
        assert mock_client.messages.create.call_count == 1  # still 1, no new LLM call

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_result_cache_miss_different_magnitude(self, mock_anthropic_mod, mock_enrich):
        """Different evidence magnitudes → different fingerprints → no cache hit."""
        from app.models.alerts import EnrichedAlert

        alert = _make_alert()
        alert.evidence = {"gpu_temp_c": "85.1"}  # magnitude bucket 1
        enriched = EnrichedAlert(alert=alert, recent_metrics=[], node_history=[], correlated_events=[])
        mock_enrich.return_value = enriched

        mock_client = MagicMock()
        mock_client.messages.create.return_value = _mock_tool_use_response()
        mock_anthropic_mod.Anthropic.return_value = mock_client

        store = DiagnosisStore()
        agent = DiagnosisAgent(
            api_key="test-key",
            store=store,
            rate_limiter=DiagnosisRateLimiter(cooldown_seconds=0.0),
        )

        result1 = agent.diagnose(alert)
        assert result1.status == "completed"

        # Different magnitude → different fingerprint → cache miss → LLM called again.
        alert2 = _make_alert()
        alert2.evidence = {"gpu_temp_c": "127.4"}  # magnitude bucket 2
        result2 = agent.diagnose(alert2)
        assert result2.status == "completed"  # not cached
        assert mock_client.messages.create.call_count == 2  # LLM called twice
