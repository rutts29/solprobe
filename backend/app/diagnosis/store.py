"""Thread-safe bounded store for diagnosis results."""

from __future__ import annotations

import logging
import threading
from collections import deque

from app.diagnosis.models import DiagnosisResult

logger = logging.getLogger(__name__)

_MAX_DIAGNOSES = 500


class DiagnosisStore:
    """Thread-safe bounded deque of diagnosis results."""

    def __init__(self, max_size: int = _MAX_DIAGNOSES) -> None:
        self._lock = threading.Lock()
        self._diagnoses: deque[DiagnosisResult] = deque(maxlen=max_size)

    def add(self, diagnosis: DiagnosisResult) -> None:
        with self._lock:
            self._diagnoses.append(diagnosis)

    def get_by_id(self, diagnosis_id: str) -> DiagnosisResult | None:
        with self._lock:
            for d in reversed(self._diagnoses):
                if d.diagnosis_id == diagnosis_id:
                    return d
            return None

    def get_by_alert_id(self, alert_id: str) -> DiagnosisResult | None:
        with self._lock:
            for d in reversed(self._diagnoses):
                if d.alert_id == alert_id:
                    return d
            return None

    def query(
        self,
        *,
        node_id: str | None = None,
        root_cause: str | None = None,
        limit: int = 50,
    ) -> list[DiagnosisResult]:
        """Query diagnoses with optional filters, newest first."""
        with self._lock:
            results: list[DiagnosisResult] = []
            for d in reversed(self._diagnoses):
                if node_id and d.node_id != node_id:
                    continue
                if root_cause and d.root_cause != root_cause:
                    continue
                results.append(d)
                if len(results) >= limit:
                    break
            return results

    def find_similar(
        self,
        alert_type: str,
        limit: int = 3,
    ) -> list[DiagnosisResult]:
        """Return completed diagnoses matching the alert type (for RAG)."""
        with self._lock:
            results: list[DiagnosisResult] = []
            for d in reversed(self._diagnoses):
                if d.status != "completed":
                    continue
                if d.alert_type == alert_type:
                    results.append(d)
                    if len(results) >= limit:
                        break
            return results

    @property
    def count(self) -> int:
        with self._lock:
            return len(self._diagnoses)


# Module-level singleton
diagnosis_store = DiagnosisStore()
