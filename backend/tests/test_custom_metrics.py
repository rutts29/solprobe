"""Tests for CustomMetricsStore and custom-metric API endpoints."""

from __future__ import annotations

import time

import pytest

from app.models.metrics import CustomMetricModel
from app.stores import CustomMetricsStore


def _mk(
    name: str = "eval_bpb",
    value: float = 1.0,
    *,
    node_id: str = "node-0",
    job_id: str = "job-1",
    step: int | None = None,
    ts: int | None = None,
    unit: str | None = None,
    tags: dict[str, str] | None = None,
) -> CustomMetricModel:
    return CustomMetricModel(
        node_id=node_id,
        job_id=job_id,
        timestamp_ms=ts if ts is not None else int(time.time() * 1000),
        step=step,
        name=name,
        value=value,
        unit=unit,
        tags=tags or {},
    )


class TestCustomMetricsStore:
    def test_ingest_and_query_by_name(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb", 1.5, ts=1000))
        s.add(_mk("eval_bpb", 1.4, ts=2000))
        s.add(_mk("dataloader_wait_ms", 3.0, ts=2500))

        results = s.query(name="eval_bpb")
        assert len(results) == 2
        assert {m.value for m in results} == {1.5, 1.4}

    def test_query_by_job_id(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb", 1.0, job_id="job-a"))
        s.add(_mk("eval_bpb", 2.0, job_id="job-b"))

        a = s.query(job_id="job-a")
        b = s.query(job_id="job-b")
        assert len(a) == 1 and a[0].value == 1.0
        assert len(b) == 1 and b[0].value == 2.0

    def test_query_by_node_id(self):
        s = CustomMetricsStore()
        s.add(_mk(node_id="node-0"))
        s.add(_mk(node_id="node-1"))
        s.add(_mk(node_id="node-1"))

        assert len(s.query(node_id="node-1")) == 2
        assert len(s.query(node_id="node-0")) == 1

    def test_query_combines_filters(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb", 1.0, job_id="j1", node_id="n0"))
        s.add(_mk("eval_bpb", 2.0, job_id="j1", node_id="n1"))
        s.add(_mk("eval_bpb", 3.0, job_id="j2", node_id="n0"))

        results = s.query(name="eval_bpb", job_id="j1", node_id="n0")
        assert len(results) == 1
        assert results[0].value == 1.0

    def test_query_limit_returns_newest(self):
        s = CustomMetricsStore()
        for i in range(20):
            s.add(_mk("m", float(i), ts=1000 + i))
        results = s.query(name="m", limit=5)
        assert len(results) == 5
        # newest first
        assert [r.value for r in results] == [19.0, 18.0, 17.0, 16.0, 15.0]

    def test_ring_buffer_cap(self):
        s = CustomMetricsStore(max_per_key=1800)
        for i in range(2000):
            s.add(_mk("m", float(i), job_id="j", ts=1000 + i))
        results = s.query(name="m", job_id="j", limit=10_000)
        assert len(results) == 1800
        # Oldest 200 evicted; newest preserved.
        assert results[0].value == 1999.0
        assert results[-1].value == 200.0

    def test_get_names_global(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb"))
        s.add(_mk("dataloader_wait_ms"))
        s.add(_mk("eval_bpb"))
        assert sorted(s.get_names()) == ["dataloader_wait_ms", "eval_bpb"]

    def test_get_names_filtered_by_job(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb", job_id="j1"))
        s.add(_mk("dataloader_wait_ms", job_id="j2"))
        assert s.get_names(job_id="j1") == ["eval_bpb"]
        assert s.get_names(job_id="j2") == ["dataloader_wait_ms"]
        assert s.get_names(job_id="missing") == []

    def test_get_latest_no_filters(self):
        s = CustomMetricsStore()
        s.add(_mk("m", 1.0, ts=1000))
        s.add(_mk("m", 2.0, ts=2000))
        latest = s.get_latest("m")
        assert latest is not None
        assert latest.value == 2.0

    def test_get_latest_returns_none_for_unknown_metric(self):
        s = CustomMetricsStore()
        s.add(_mk("eval_bpb", 1.0))
        assert s.get_latest("does_not_exist") is None

    def test_get_latest_filters_by_job_and_node(self):
        s = CustomMetricsStore()
        s.add(_mk("m", 1.0, job_id="j1", node_id="n0", ts=1000))
        s.add(_mk("m", 2.0, job_id="j2", node_id="n1", ts=2000))
        s.add(_mk("m", 3.0, job_id="j1", node_id="n1", ts=3000))

        latest_j1 = s.get_latest("m", job_id="j1")
        assert latest_j1 is not None and latest_j1.value == 3.0

        latest_j1_n0 = s.get_latest("m", job_id="j1", node_id="n0")
        assert latest_j1_n0 is not None and latest_j1_n0.value == 1.0

        latest_n1 = s.get_latest("m", node_id="n1")
        assert latest_n1 is not None and latest_n1.value == 3.0


pytestmark_async = pytest.mark.asyncio(loop_scope="function")


class TestCustomMetricsAPI:
    pytestmark = pytestmark_async

    async def test_post_single_metric(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]

        body = {
            "node_id": "node-0",
            "job_id": "job-1",
            "timestamp_ms": 1700000000000,
            "step": 42,
            "name": "eval_bpb",
            "value": 1.73,
            "unit": "bpb",
            "tags": {"split": "val"},
        }
        resp = await client.post("/api/v1/custom-metrics", json=body)
        assert resp.status_code == 201
        data = resp.json()
        assert data["accepted"] == 1

        stored = cms.query(name="eval_bpb")
        assert len(stored) == 1
        assert stored[0].value == 1.73

    async def test_post_list_of_metrics(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]

        body = [
            {
                "node_id": "node-0",
                "job_id": "job-1",
                "timestamp_ms": 1700000000000,
                "name": "eval_bpb",
                "value": 1.7,
            },
            {
                "node_id": "node-0",
                "job_id": "job-1",
                "timestamp_ms": 1700000001000,
                "name": "dataloader_wait_ms",
                "value": 12.0,
                "unit": "ms",
            },
        ]
        resp = await client.post("/api/v1/custom-metrics", json=body)
        assert resp.status_code == 201
        assert resp.json()["accepted"] == 2
        assert len(cms.query(limit=10)) == 2

    async def test_post_rejects_empty_list(self, client):
        resp = await client.post("/api/v1/custom-metrics", json=[])
        assert resp.status_code == 400

    async def test_get_filters_by_job_and_name(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]
        cms.add(_mk("eval_bpb", 1.0, job_id="j1"))
        cms.add(_mk("eval_bpb", 2.0, job_id="j2"))
        cms.add(_mk("loss_aux", 0.5, job_id="j1"))

        resp = await client.get("/api/v1/custom-metrics?job_id=j1&name=eval_bpb")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["value"] == 1.0

    async def test_get_filters_by_node(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]
        cms.add(_mk(node_id="node-0"))
        cms.add(_mk(node_id="node-1"))

        resp = await client.get("/api/v1/custom-metrics?node_id=node-1")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_names_endpoint(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]
        cms.add(_mk("eval_bpb"))
        cms.add(_mk("dataloader_wait_ms"))

        resp = await client.get("/api/v1/custom-metrics/names")
        assert resp.status_code == 200
        names = resp.json()
        assert sorted(names) == ["dataloader_wait_ms", "eval_bpb"]

    async def test_names_endpoint_filtered_by_job(self, test_app, client):
        _, _ms, _als, _ans, _js, _ds, _lcs, _wm, *rest = test_app
        cms = rest[0]
        cms.add(_mk("eval_bpb", job_id="j1"))
        cms.add(_mk("loss_aux", job_id="j2"))

        resp = await client.get("/api/v1/custom-metrics/names?job_id=j1")
        assert resp.status_code == 200
        assert resp.json() == ["eval_bpb"]
