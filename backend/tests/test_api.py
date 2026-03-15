"""Tests for REST API routes."""

from __future__ import annotations

import pytest

from app.models.metrics import MetricsBatchModel

from tests.conftest import _make_alert, _make_gpu_metric, _make_training_metric

pytestmark = pytest.mark.asyncio(loop_scope="function")


class TestHealthEndpoint:
    async def test_health_returns_200(self, client):
        resp = await client.get("/api/v1/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "connected_sidecars" in data
        assert "total_alerts" in data
        assert "ws_clients" in data


class TestNodesEndpoint:
    async def test_empty_nodes(self, client):
        resp = await client.get("/api/v1/nodes")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_nodes_with_data(self, test_app, client):
        _, ms, *_ = test_app
        ms.ingest_batch(
            MetricsBatchModel(gpu=[_make_gpu_metric("node-1")])
        )
        resp = await client.get("/api/v1/nodes")
        assert resp.status_code == 200
        nodes = resp.json()
        assert len(nodes) == 1
        assert nodes[0]["node_id"] == "node-1"

    async def test_node_metrics_404(self, client):
        resp = await client.get("/api/v1/nodes/nonexistent/metrics")
        assert resp.status_code == 404

    async def test_node_metrics_with_data(self, test_app, client):
        _, ms, *_ = test_app
        for i in range(10):
            ms.ingest_batch(
                MetricsBatchModel(
                    gpu=[_make_gpu_metric("node-1", ts=1000 + i)],
                    training=_make_training_metric("node-1", step=i, ts=1000 + i),
                )
            )
        resp = await client.get("/api/v1/nodes/node-1/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["node_id"] == "node-1"
        assert len(data["gpu_metrics"]) == 10
        assert len(data["training_metrics"]) == 10


class TestAlertsEndpoint:
    async def test_empty_alerts(self, client):
        resp = await client.get("/api/v1/alerts")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_alerts_with_data(self, test_app, client):
        _, _, als, *_ = test_app
        als.add(_make_alert(node_id="node-1", severity="WARNING"))
        als.add(_make_alert(node_id="node-2", severity="CRITICAL"))

        resp = await client.get("/api/v1/alerts")
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 2

    async def test_alerts_filter_severity(self, test_app, client):
        _, _, als, *_ = test_app
        als.add(_make_alert(severity="WARNING"))
        als.add(_make_alert(severity="CRITICAL"))

        resp = await client.get("/api/v1/alerts?severity=CRITICAL")
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["severity"] == "CRITICAL"

    async def test_alerts_filter_node(self, test_app, client):
        _, _, als, *_ = test_app
        als.add(_make_alert(node_id="node-1"))
        als.add(_make_alert(node_id="node-2"))

        resp = await client.get("/api/v1/alerts?node_id=node-1")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_alerts_limit(self, test_app, client):
        _, _, als, *_ = test_app
        for _ in range(10):
            als.add(_make_alert())

        resp = await client.get("/api/v1/alerts?limit=3")
        assert resp.status_code == 200
        assert len(resp.json()) == 3


class TestAnomaliesEndpoint:
    async def test_empty_anomalies(self, client):
        resp = await client.get("/api/v1/anomalies")
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_anomalies_with_data(self, test_app, client):
        _, _, _, ans, *_ = test_app
        ans.add({"detector": "zscore", "field": "gpu_temp_c", "z_score": 4.5})

        resp = await client.get("/api/v1/anomalies")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1


class TestJobsEndpoint:
    async def test_create_job(self, client):
        resp = await client.post(
            "/api/v1/jobs",
            json={
                "job_id": "job-42",
                "config": {"model": "llama-7b"},
                "node_ids": ["node-1", "node-2"],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["job_id"] == "job-42"
        assert data["status"] == "registered"

    async def test_list_jobs(self, test_app, client):
        _, _, _, _, js, _ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.get("/api/v1/jobs")
        assert resp.status_code == 200
        jobs = resp.json()
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "job-1"

    async def test_get_job(self, test_app, client):
        _, _, _, _, js, _ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.get("/api/v1/jobs/job-1")
        assert resp.status_code == 200
        assert resp.json()["job_id"] == "job-1"

    async def test_get_job_404(self, client):
        resp = await client.get("/api/v1/jobs/nonexistent")
        assert resp.status_code == 404
