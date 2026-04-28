"""Tests for PolicyStore CRUD and cooldown tracking."""

from __future__ import annotations

import pytest


def _sample_policy(policy_id: str = "p1") -> dict:
    return {
        "policy_id": policy_id,
        "name": "test policy",
        "enabled": True,
        "scope": {"job_id": None, "node_id": None},
        "metric": {"source": "training", "field": "gradient_norm"},
        "condition": {"operator": "gt", "threshold": 100.0, "for_seconds": 0.0},
        "severity": "WARNING",
        "cooldown_seconds": 60.0,
        "description": "",
    }


class TestPolicyStoreCRUD:
    def test_create_and_get(self, fresh_stores):
        *_, pls = fresh_stores
        created = pls.create(_sample_policy("p1"))
        assert created["policy_id"] == "p1"
        assert created["created_at_ms"] > 0
        assert created["updated_at_ms"] > 0
        got = pls.get("p1")
        assert got is not None
        assert got["policy_id"] == "p1"

    def test_create_duplicate_raises(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        with pytest.raises(KeyError):
            pls.create(_sample_policy("p1"))

    def test_list_all(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        pls.create(_sample_policy("p2"))
        all_p = pls.list_all()
        assert len(all_p) == 2
        ids = {p["policy_id"] for p in all_p}
        assert ids == {"p1", "p2"}

    def test_list_enabled_filters_disabled(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        p2 = _sample_policy("p2")
        p2["enabled"] = False
        pls.create(p2)
        enabled = pls.list_enabled()
        assert len(enabled) == 1
        assert enabled[0]["policy_id"] == "p1"

    def test_update(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        updated = pls.update("p1", {"name": "renamed", "severity": "CRITICAL"})
        assert updated is not None
        assert updated["name"] == "renamed"
        assert updated["severity"] == "CRITICAL"

    def test_update_unknown_returns_none(self, fresh_stores):
        *_, pls = fresh_stores
        result = pls.update("missing", {"name": "x"})
        assert result is None

    def test_update_skips_none_values(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        updated = pls.update("p1", {"name": None, "severity": "INFO"})
        assert updated["name"] == "test policy"  # unchanged
        assert updated["severity"] == "INFO"

    def test_toggle(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        toggled = pls.toggle("p1")
        assert toggled["enabled"] is False
        toggled = pls.toggle("p1")
        assert toggled["enabled"] is True

    def test_toggle_unknown_returns_none(self, fresh_stores):
        *_, pls = fresh_stores
        assert pls.toggle("missing") is None

    def test_delete(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        assert pls.delete("p1") is True
        assert pls.get("p1") is None
        assert pls.delete("p1") is False


class TestCooldown:
    def test_no_cooldown_when_zero(self, fresh_stores):
        *_, pls = fresh_stores
        assert pls.in_cooldown("p1", "node-1", "job-1", 0.0, now_ms=1000) is False

    def test_first_call_not_in_cooldown(self, fresh_stores):
        *_, pls = fresh_stores
        assert pls.in_cooldown("p1", "node-1", "job-1", 60.0, now_ms=1000) is False

    def test_within_cooldown_window(self, fresh_stores):
        *_, pls = fresh_stores
        pls.mark_triggered("p1", "node-1", "job-1", now_ms=1000)
        # 30 seconds later, still cooling down with 60s cooldown
        assert pls.in_cooldown("p1", "node-1", "job-1", 60.0, now_ms=31_000) is True

    def test_after_cooldown_window(self, fresh_stores):
        *_, pls = fresh_stores
        pls.mark_triggered("p1", "node-1", "job-1", now_ms=1000)
        # 61 seconds later — out of cooldown
        assert pls.in_cooldown("p1", "node-1", "job-1", 60.0, now_ms=62_000) is False

    def test_cooldown_keys_are_distinct_per_node(self, fresh_stores):
        *_, pls = fresh_stores
        pls.mark_triggered("p1", "node-1", "job-1", now_ms=1000)
        # Different node — independent cooldown
        assert pls.in_cooldown("p1", "node-2", "job-1", 60.0, now_ms=2000) is False

    def test_cooldown_keys_treat_none_consistently(self, fresh_stores):
        *_, pls = fresh_stores
        pls.mark_triggered("p1", None, None, now_ms=1000)
        assert pls.in_cooldown("p1", None, None, 60.0, now_ms=2000) is True
        # None vs concrete node — distinct keys
        assert pls.in_cooldown("p1", "node-1", None, 60.0, now_ms=2000) is False

    def test_mark_triggered_updates_last_triggered(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        pls.mark_triggered("p1", "node-1", "job-1", now_ms=12345)
        got = pls.get("p1")
        assert got["last_triggered_at_ms"] == 12345

    def test_delete_clears_cooldowns(self, fresh_stores):
        *_, pls = fresh_stores
        pls.create(_sample_policy("p1"))
        pls.mark_triggered("p1", "node-1", "job-1", now_ms=1000)
        pls.delete("p1")
        # Re-create policy with same ID — cooldown shouldn't carry over
        pls.create(_sample_policy("p1"))
        assert pls.in_cooldown("p1", "node-1", "job-1", 60.0, now_ms=2000) is False
