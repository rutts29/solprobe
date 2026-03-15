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
        assert result.node_id == alert.node_id
        assert len(result.evidence_chain) == 1
        assert result.recommended_action.action == "reassign_workload"
        assert result.recommended_action.urgency == "immediate"
        assert result.llm_model == "claude-sonnet-4-20250514"
        assert result.latency_ms >= 0

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

        # Second call for same node should be rate-limited
        alert2 = _make_alert(node_id="node-1")
        result2 = agent.diagnose(alert2)
        assert result2.status == "rate_limited"

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

        alert2 = _make_alert(node_id="node-1")
        result2 = agent.diagnose(alert2, bypass_rate_limit=True)
        assert result2.status == "completed"

    @patch("app.diagnosis.agent.enrich_alert")
    @patch("app.diagnosis.agent.anthropic")
    def test_api_error_returns_failed(self, mock_anthropic_mod, mock_enrich):
        """API error returns status=failed with error message."""
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
        assert "API timeout" in result.error

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
