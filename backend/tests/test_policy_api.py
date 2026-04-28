"""Tests for /api/v1/policies endpoints."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="function")


def _body(policy_id: str = "p1", **overrides) -> dict:
    base = {
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
    base.update(overrides)
    return base


class TestPolicyCRUD:
    async def test_list_empty(self, client):
        resp = await client.get("/api/v1/policies")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_create_then_list(self, client):
        resp = await client.post("/api/v1/policies", json=_body("p1"))
        assert resp.status_code == 201
        body = resp.json()
        assert body["policy_id"] == "p1"
        assert body["created_at_ms"] > 0
        assert body["updated_at_ms"] > 0

        resp = await client.get("/api/v1/policies")
        assert resp.status_code == 200
        listed = resp.json()
        assert len(listed) == 1
        assert listed[0]["policy_id"] == "p1"

    async def test_create_duplicate_409(self, client):
        await client.post("/api/v1/policies", json=_body("p1"))
        resp = await client.post("/api/v1/policies", json=_body("p1"))
        assert resp.status_code == 409

    async def test_create_unknown_field_422(self, client):
        bad = _body("p1")
        bad["metric"]["field"] = "no_such_field"
        resp = await client.post("/api/v1/policies", json=bad)
        assert resp.status_code == 422

    async def test_create_unknown_source_422(self, client):
        bad = _body("p1")
        bad["metric"]["source"] = "bogus"
        resp = await client.post("/api/v1/policies", json=bad)
        assert resp.status_code == 422

    async def test_create_unknown_operator_422(self, client):
        bad = _body("p1")
        bad["condition"]["operator"] = "regex"
        resp = await client.post("/api/v1/policies", json=bad)
        assert resp.status_code == 422

    async def test_patch_updates_fields(self, client):
        await client.post("/api/v1/policies", json=_body("p1"))
        resp = await client.patch(
            "/api/v1/policies/p1",
            json={"name": "renamed", "severity": "CRITICAL"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "renamed"
        assert body["severity"] == "CRITICAL"

    async def test_patch_unknown_404(self, client):
        resp = await client.patch("/api/v1/policies/missing", json={"name": "x"})
        assert resp.status_code == 404

    async def test_toggle_flips_enabled(self, client):
        await client.post("/api/v1/policies", json=_body("p1"))
        resp = await client.post("/api/v1/policies/p1/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False
        resp = await client.post("/api/v1/policies/p1/toggle")
        assert resp.json()["enabled"] is True

    async def test_toggle_unknown_404(self, client):
        resp = await client.post("/api/v1/policies/missing/toggle")
        assert resp.status_code == 404

    async def test_delete(self, client):
        await client.post("/api/v1/policies", json=_body("p1"))
        resp = await client.delete("/api/v1/policies/p1")
        assert resp.status_code == 204
        resp = await client.get("/api/v1/policies")
        assert resp.json() == []

    async def test_delete_unknown_404(self, client):
        resp = await client.delete("/api/v1/policies/missing")
        assert resp.status_code == 404

    async def test_patch_unknown_field_422(self, client):
        await client.post("/api/v1/policies", json=_body("p1"))
        resp = await client.patch(
            "/api/v1/policies/p1",
            json={"metric": {"source": "training", "field": "no_such_field"}},
        )
        assert resp.status_code == 422


class TestPolicyCustomSource:
    async def test_create_custom_source_policy(self, client):
        body = _body(
            "custom-bpb",
            metric={"source": "custom", "field": "eval_bpb"},
            condition={"operator": "gt", "threshold": 2.0, "for_seconds": 5.0},
            severity="CRITICAL",
        )
        resp = await client.post("/api/v1/policies", json=body)
        assert resp.status_code == 201
        data = resp.json()
        assert data["metric"]["source"] == "custom"
        assert data["metric"]["field"] == "eval_bpb"

    async def test_custom_source_accepts_arbitrary_name(self, client):
        # Custom-source field names are user-defined — anything goes.
        body = _body(
            "custom-x",
            metric={"source": "custom", "field": "totally_made_up_name"},
        )
        resp = await client.post("/api/v1/policies", json=body)
        assert resp.status_code == 201

    async def test_custom_source_empty_field_422(self, client):
        body = _body("custom-empty", metric={"source": "custom", "field": "  "})
        resp = await client.post("/api/v1/policies", json=body)
        assert resp.status_code == 422
