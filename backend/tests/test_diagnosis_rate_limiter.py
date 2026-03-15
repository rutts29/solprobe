"""Tests for DiagnosisRateLimiter."""

from __future__ import annotations

import threading
import time

from app.diagnosis.rate_limiter import DiagnosisRateLimiter


class TestDiagnosisRateLimiter:
    def test_first_acquire_succeeds(self):
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        assert rl.try_acquire("node-1") is True

    def test_second_acquire_within_cooldown_fails(self):
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        assert rl.try_acquire("node-1") is True
        assert rl.try_acquire("node-1") is False

    def test_per_node_isolation(self):
        """Different nodes have independent cooldowns."""
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        assert rl.try_acquire("node-1") is True
        assert rl.try_acquire("node-2") is True
        assert rl.try_acquire("node-1") is False
        assert rl.try_acquire("node-2") is False

    def test_cooldown_expiry(self):
        """After cooldown expires, acquire succeeds again."""
        rl = DiagnosisRateLimiter(cooldown_seconds=0.05)
        assert rl.try_acquire("node-1") is True
        assert rl.try_acquire("node-1") is False
        time.sleep(0.06)
        assert rl.try_acquire("node-1") is True

    def test_reset_single_node(self):
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        rl.try_acquire("node-1")
        rl.try_acquire("node-2")

        rl.reset("node-1")
        assert rl.try_acquire("node-1") is True
        assert rl.try_acquire("node-2") is False

    def test_reset_nonexistent_node(self):
        """Resetting a node that was never acquired is a no-op."""
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        rl.reset("nonexistent")  # should not raise

    def test_reset_all(self):
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        rl.try_acquire("node-1")
        rl.try_acquire("node-2")
        rl.try_acquire("node-3")

        rl.reset_all()
        assert rl.try_acquire("node-1") is True
        assert rl.try_acquire("node-2") is True
        assert rl.try_acquire("node-3") is True

    def test_thread_safety(self):
        """Concurrent acquires don't corrupt state."""
        rl = DiagnosisRateLimiter(cooldown_seconds=10.0)
        results: list[bool] = []
        lock = threading.Lock()

        def try_acquire_thread():
            result = rl.try_acquire("contested-node")
            with lock:
                results.append(result)

        threads = [threading.Thread(target=try_acquire_thread) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly one thread should have acquired
        assert results.count(True) == 1
        assert results.count(False) == 9
