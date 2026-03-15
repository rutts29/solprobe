"""Tests for diagnosis Pydantic models."""

from __future__ import annotations

import time

import pytest
from pydantic import ValidationError

from app.diagnosis.models import (
    DiagnosisRequest,
    DiagnosisResult,
    EvidenceItem,
    RecommendedAction,
    SimilarIncident,
)


class TestEvidenceItem:
    def test_round_trip(self):
        item = EvidenceItem(metric="gpu_temp_c", value="92.3", context="Above 85°C threshold")
        data = item.model_dump()
        restored = EvidenceItem.model_validate(data)
        assert restored.metric == "gpu_temp_c"
        assert restored.value == "92.3"
        assert restored.context == "Above 85°C threshold"

    def test_json_round_trip(self):
        item = EvidenceItem(metric="loss", value="15.2", context="Z-score > 3")
        json_str = item.model_dump_json()
        restored = EvidenceItem.model_validate_json(json_str)
        assert restored == item


class TestRecommendedAction:
    def test_valid_urgencies(self):
        for urgency in ("immediate", "soon", "monitor"):
            action = RecommendedAction(
                action="restart_from_checkpoint",
                params={"checkpoint_id": "latest"},
                urgency=urgency,
            )
            assert action.urgency == urgency

    def test_invalid_urgency_rejected(self):
        with pytest.raises(ValidationError):
            RecommendedAction(
                action="restart_from_checkpoint",
                params={},
                urgency="invalid_urgency",
            )

    def test_round_trip(self):
        action = RecommendedAction(
            action="reassign_workload",
            params={"target_node": "node-2"},
            urgency="immediate",
        )
        data = action.model_dump()
        restored = RecommendedAction.model_validate(data)
        assert restored.action == "reassign_workload"
        assert restored.params == {"target_node": "node-2"}


class TestSimilarIncident:
    def test_similarity_bounds(self):
        incident = SimilarIncident(
            diagnosis_id="diag-1",
            root_cause="thermal_throttle",
            similarity=0.85,
        )
        assert 0.0 <= incident.similarity <= 1.0

    def test_similarity_out_of_range(self):
        with pytest.raises(ValidationError):
            SimilarIncident(
                diagnosis_id="diag-1",
                root_cause="thermal_throttle",
                similarity=1.5,
            )


class TestDiagnosisResult:
    def _make_result(self, **overrides) -> DiagnosisResult:
        defaults = {
            "diagnosis_id": "diag-123",
            "alert_id": "alert-456",
            "alert_type": "thermal_throttle",
            "node_id": "node-1",
            "timestamp_ms": int(time.time() * 1000),
            "root_cause": "thermal_throttle",
            "confidence": 0.92,
            "reasoning": "GPU temp exceeded threshold causing throttling",
            "evidence_chain": [
                EvidenceItem(metric="gpu_temp_c", value="92", context="Above 85C"),
            ],
            "recommended_action": RecommendedAction(
                action="reassign_workload",
                params={"target_node": "node-2"},
                urgency="immediate",
            ),
            "similar_incidents": [],
            "llm_model": "claude-sonnet-4-20250514",
            "latency_ms": 1200,
            "status": "completed",
            "error": None,
        }
        defaults.update(overrides)
        return DiagnosisResult(**defaults)

    def test_serialization_round_trip(self):
        result = self._make_result()
        data = result.model_dump()
        restored = DiagnosisResult.model_validate(data)
        assert restored.diagnosis_id == "diag-123"
        assert restored.alert_id == "alert-456"
        assert restored.alert_type == "thermal_throttle"
        assert restored.confidence == 0.92
        assert restored.status == "completed"
        assert len(restored.evidence_chain) == 1
        assert restored.recommended_action.action == "reassign_workload"

    def test_json_round_trip(self):
        result = self._make_result()
        json_str = result.model_dump_json()
        restored = DiagnosisResult.model_validate_json(json_str)
        assert restored == result

    def test_confidence_bounds(self):
        with pytest.raises(ValidationError):
            self._make_result(confidence=1.5)

    def test_status_values(self):
        for status in ("completed", "failed", "rate_limited"):
            kwargs = {"status": status}
            if status != "completed":
                kwargs["error"] = "some error"
            else:
                kwargs["error"] = None
            result = self._make_result(**kwargs)
            assert result.status == status

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            self._make_result(status="invalid")

    def test_failed_with_error(self):
        result = self._make_result(status="failed", error="API timeout")
        assert result.error == "API timeout"

    def test_with_similar_incidents(self):
        similar = [
            SimilarIncident(
                diagnosis_id="diag-old-1",
                root_cause="thermal_throttle",
                similarity=0.9,
            ),
        ]
        result = self._make_result(similar_incidents=similar)
        assert len(result.similar_incidents) == 1
        assert result.similar_incidents[0].similarity == 0.9

    def test_completed_with_error_rejected(self):
        """status='completed' must not have an error."""
        with pytest.raises(ValidationError, match="must not have an error"):
            self._make_result(status="completed", error="should not be here")

    def test_failed_without_error_rejected(self):
        """status='failed' requires an error message."""
        with pytest.raises(ValidationError, match="requires a non-empty error"):
            self._make_result(status="failed", error=None)

    def test_rate_limited_without_error_rejected(self):
        """status='rate_limited' requires an error message."""
        with pytest.raises(ValidationError, match="requires a non-empty error"):
            self._make_result(status="rate_limited", error=None)


class TestDiagnosisRequest:
    def test_basic(self):
        req = DiagnosisRequest(alert_id="alert-123")
        assert req.alert_id == "alert-123"
