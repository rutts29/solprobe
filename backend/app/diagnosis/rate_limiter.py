"""Per-node rate limiter for diagnosis requests."""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

_DEFAULT_COOLDOWN_SECONDS = 30.0


class DiagnosisRateLimiter:
    """Thread-safe per-node cooldown to prevent excessive LLM calls."""

    def __init__(self, cooldown_seconds: float = _DEFAULT_COOLDOWN_SECONDS) -> None:
        self._lock = threading.Lock()
        self._cooldown = cooldown_seconds
        self._last_call: dict[str, float] = {}

    def try_acquire(self, node_id: str) -> bool:
        """Return True if the node is allowed to trigger a diagnosis."""
        now = time.monotonic()
        with self._lock:
            last = self._last_call.get(node_id, 0.0)
            if now - last < self._cooldown:
                return False
            self._last_call[node_id] = now
            return True

    def reset(self, node_id: str) -> None:
        """Reset cooldown for a specific node."""
        with self._lock:
            self._last_call.pop(node_id, None)

    def reset_all(self) -> None:
        """Reset all cooldowns."""
        with self._lock:
            self._last_call.clear()


# Module-level singleton
diagnosis_rate_limiter = DiagnosisRateLimiter()
