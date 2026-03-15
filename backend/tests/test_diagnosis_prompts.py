"""Tests for prompts module — build_system_prompt, build_user_message, and DIAGNOSIS_TOOL."""

from __future__ import annotations

import time
import uuid

from app.diagnosis.models import DiagnosisResult, EvidenceItem, RecommendedAction
from app.diagnosis.prompts import (
    DIAGNOSIS_TOOL,
    ROOT_CAUSES,
    build_system_prompt,
    build_user_message,
)
from app.models.alerts import AlertModel, EnrichedAlert


def _make_alert(**overrides) -> AlertModel:
    defaults = {
        "alert_id": str(uuid.uuid4()),
        "node_id": "node-1",
        "timestamp_ms": int(time.time() * 1000),
        "severity": "CRITICAL",
        "source": "EDGE",
        "alert_type": "thermal_throttle",
        "description": "GPU temp 92°C",
        "confidence": 0.95,
        "evidence": {"gpu_temp_c": "92.3"},
    }
    defaults.update(overrides)
    return AlertModel(**defaults)


class TestBuildSystemPrompt:
    def test_contains_action_catalog(self):
        prompt = build_system_prompt()
        assert "restart_from_checkpoint" in prompt
        assert "reassign_workload" in prompt
        assert "rollback_lr" in prompt

    def test_contains_domain_knowledge(self):
        prompt = build_system_prompt()
        assert "T4" in prompt
        assert "L4" in prompt
        assert "DiLoCo" in prompt

    def test_contains_alert_types(self):
        prompt = build_system_prompt()
        assert "thermal_throttle" in prompt
        assert "nccl_timeout" in prompt
        assert "inner_outer_divergence" in prompt


class TestBuildUserMessage:
    def test_basic_alert_info(self):
        alert = _make_alert()
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[],
            correlated_events=[],
        )
        msg = build_user_message(enriched, [])
        assert "Triggering Alert" in msg
        assert alert.alert_id in msg
        assert alert.node_id in msg
        assert alert.alert_type in msg

    def test_includes_metrics(self):
        alert = _make_alert()
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[{"gpu_temp_c": 92.3, "timestamp_ms": 12345}],
            node_history=[],
            correlated_events=[],
        )
        msg = build_user_message(enriched, [])
        assert "Recent Metrics" in msg
        assert "92.3" in msg

    def test_downsamples_large_metrics(self):
        alert = _make_alert()
        metrics = [{"gpu_temp_c": float(i)} for i in range(100)]
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=metrics,
            node_history=[],
            correlated_events=[],
        )
        msg = build_user_message(enriched, [])
        # Count only the metric data lines (indented with 2 spaces in the Recent Metrics section)
        in_metrics = False
        metric_count = 0
        for line in msg.split("\n"):
            if "## Recent Metrics" in line:
                in_metrics = True
                continue
            if in_metrics and line.startswith("  {"):
                metric_count += 1
            elif in_metrics and line.startswith("\n##") or (in_metrics and line.startswith("##")):
                break
        assert metric_count <= 20

    def test_includes_node_history(self):
        alert = _make_alert()
        history_alert = _make_alert(alert_type="memory_pressure", severity="WARNING")
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[history_alert],
            correlated_events=[],
        )
        msg = build_user_message(enriched, [])
        assert "Node Alert History" in msg
        assert "memory_pressure" in msg

    def test_includes_correlated_events(self):
        alert = _make_alert()
        correlated = _make_alert(node_id="node-2", alert_type="nccl_timeout")
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[],
            correlated_events=[correlated],
        )
        msg = build_user_message(enriched, [])
        assert "Correlated Events" in msg
        assert "node-2" in msg

    def test_includes_similar_diagnoses(self):
        alert = _make_alert()
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[],
            correlated_events=[],
        )
        similar = DiagnosisResult(
            diagnosis_id="diag-old",
            alert_id="alert-old",
            alert_type="thermal_throttle",
            node_id="node-3",
            timestamp_ms=int(time.time() * 1000),
            root_cause="thermal_throttle",
            confidence=0.88,
            reasoning="Previous thermal issue",
            evidence_chain=[],
            recommended_action=RecommendedAction(
                action="reassign_workload", params={}, urgency="immediate",
            ),
            similar_incidents=[],
            llm_model="claude-sonnet-4-20250514",
            latency_ms=500,
            status="completed",
            error=None,
        )
        msg = build_user_message(enriched, [similar])
        assert "Similar Past Diagnoses" in msg
        assert "diag-old" in msg

    def test_empty_context(self):
        """No metrics/history/correlated → only alert section."""
        alert = _make_alert()
        enriched = EnrichedAlert(
            alert=alert,
            recent_metrics=[],
            node_history=[],
            correlated_events=[],
        )
        msg = build_user_message(enriched, [])
        assert "Triggering Alert" in msg
        assert "Recent Metrics" not in msg
        assert "Node Alert History" not in msg
        assert "Correlated Events" not in msg


class TestDiagnosisTool:
    def test_tool_schema_structure(self):
        assert DIAGNOSIS_TOOL["name"] == "submit_diagnosis"
        schema = DIAGNOSIS_TOOL["input_schema"]
        assert schema["type"] == "object"
        assert "root_cause" in schema["properties"]
        assert "confidence" in schema["properties"]
        assert "reasoning" in schema["properties"]
        assert "evidence_chain" in schema["properties"]
        assert "recommended_action" in schema["properties"]

    def test_root_cause_enum_matches(self):
        schema = DIAGNOSIS_TOOL["input_schema"]
        tool_root_causes = schema["properties"]["root_cause"]["enum"]
        assert tool_root_causes == ROOT_CAUSES
        assert "unknown" in tool_root_causes

    def test_required_fields(self):
        schema = DIAGNOSIS_TOOL["input_schema"]
        required = schema["required"]
        assert "root_cause" in required
        assert "confidence" in required
        assert "reasoning" in required
        assert "evidence_chain" in required
        assert "recommended_action" in required
