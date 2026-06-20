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


class TestMetricsBatchEndpoint:
    async def test_post_training_only_batch_ingests_colab_metrics(self, test_app, client):
        _, ms, *_ = test_app

        body = {
            "training": {
                "node_id": "colab-t4-0",
                "job_id": "colab-demo",
                "timestamp_ms": 1_700_000_000_000,
                "step": 12,
                "loss": 1.25,
                "gradient_norm": 0.75,
                "learning_rate": 0.0003,
                "throughput_tps": 2048.0,
                "mfu_pct": 18.5,
            }
        }
        resp = await client.post("/api/v1/metrics/batches", json=body)

        assert resp.status_code == 201
        assert resp.json() == {"accepted": 1}
        status = ms.get_node_status("colab-t4-0")
        assert status is not None
        assert status.latest_training is not None
        assert status.latest_training.step == 12
        assert status.gpu_model == ""

    async def test_post_metrics_batch_marks_registered_job_running(self, test_app, client):
        _, _ms, _als, _ans, js, *_ = test_app
        js.register("colab-demo", {"platform": "colab"}, ["colab-t4-0"])

        resp = await client.post(
            "/api/v1/metrics/batches",
            json={
                "training": {
                    "node_id": "colab-t4-0",
                    "job_id": "colab-demo",
                    "timestamp_ms": 1_700_000_000_000,
                    "step": 1,
                    "loss": 2.0,
                }
            },
        )

        assert resp.status_code == 201
        assert js.get("colab-demo")["status"] == "running"

    async def test_post_list_of_metrics_batches(self, test_app, client):
        _, ms, *_ = test_app

        resp = await client.post(
            "/api/v1/metrics/batches",
            json=[
                {
                    "training": {
                        "node_id": "colab-t4-0",
                        "job_id": "colab-demo",
                        "timestamp_ms": 1_700_000_000_000,
                        "step": 1,
                        "loss": 2.0,
                    }
                },
                {
                    "training": {
                        "node_id": "colab-t4-0",
                        "job_id": "colab-demo",
                        "timestamp_ms": 1_700_000_001_000,
                        "step": 2,
                        "loss": 1.9,
                    }
                },
            ],
        )

        assert resp.status_code == 201
        assert resp.json() == {"accepted": 2}
        assert ms.get_node_status("colab-t4-0").latest_training.step == 2


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
        _, _, _, _, js, *_ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.get("/api/v1/jobs")
        assert resp.status_code == 200
        jobs = resp.json()
        assert len(jobs) == 1
        assert jobs[0]["job_id"] == "job-1"

    async def test_get_job(self, test_app, client):
        _, _, _, _, js, *_ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.get("/api/v1/jobs/job-1")
        assert resp.status_code == 200
        assert resp.json()["job_id"] == "job-1"

    async def test_patch_job_status(self, test_app, client):
        _, _, _, _, js, *_ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.patch("/api/v1/jobs/job-1/status", json={"status": "running"})

        assert resp.status_code == 200
        body = resp.json()
        assert body["job_id"] == "job-1"
        assert body["status"] == "running"
        assert js.get("job-1")["status"] == "running"

    async def test_patch_job_status_rejects_invalid_status(self, test_app, client):
        _, _, _, _, js, *_ = test_app
        js.register("job-1", {"model": "llama"}, ["node-1"])

        resp = await client.patch("/api/v1/jobs/job-1/status", json={"status": "paused"})

        assert resp.status_code == 400
        assert js.get("job-1")["status"] == "registered"

    async def test_patch_job_status_404(self, client):
        resp = await client.patch("/api/v1/jobs/missing/status", json={"status": "running"})

        assert resp.status_code == 404

    async def test_get_job_404(self, client):
        resp = await client.get("/api/v1/jobs/nonexistent")
        assert resp.status_code == 404

    async def test_create_job_with_name(self, client):
        resp = await client.post(
            "/api/v1/jobs",
            json={
                "job_id": "job-named",
                "name": "Nanochat MPS",
                "config": {"model": "nanochat"},
                "node_ids": ["node-0"],
            },
        )
        assert resp.status_code == 201
        # Follow up with a GET to verify name is stored.
        resp = await client.get("/api/v1/jobs/job-named")
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Nanochat MPS"
        assert body["status"] == "registered"


class TestJobSummaryEndpoint:
    async def test_summary_404_for_unknown_job(self, client):
        resp = await client.get("/api/v1/jobs/nonexistent/summary")
        assert resp.status_code == 404

    async def test_summary_returns_job_metrics_alerts_diagnoses(self, test_app, client):
        from app.diagnosis.models import (
            DiagnosisResult,
            EvidenceItem,
            RecommendedAction,
        )

        _, ms, als, _, js, ds, *_ = test_app

        # Register job in 'running' state.
        js.register("job-A", {"model": "llama"}, ["node-0"], name="Run A")
        js.update_status("job-A", "running")

        # Hardware + training metrics for node-0.
        ms.ingest_batch(
            MetricsBatchModel(
                gpu=[_make_gpu_metric("node-0", ts=2_000)],
                training=_make_training_metric("node-0", ts=2_000, step=5),
            )
        )

        # Two alerts: one for job-A, one for an unrelated job.
        a1 = _make_alert(node_id="node-0", job_id="job-A", alert_id="alert-A1")
        a2 = _make_alert(node_id="node-0", job_id="job-OTHER", alert_id="alert-OTHER")
        als.add(a1)
        als.add(a2)

        # Diagnosis attached to a1 only.
        ds.add(
            DiagnosisResult(
                diagnosis_id="diag-1",
                alert_id="alert-A1",
                alert_type="thermal_throttle",
                node_id="node-0",
                timestamp_ms=2_500,
                root_cause="thermal",
                confidence=0.9,
                reasoning="hot",
                evidence_chain=[EvidenceItem(metric="t", value="90", context="c")],
                recommended_action=RecommendedAction(action="cool", params={}, urgency="soon"),
                similar_incidents=[],
                llm_model="claude",
                latency_ms=10,
                status="completed",
            )
        )

        resp = await client.get("/api/v1/jobs/job-A/summary")
        assert resp.status_code == 200
        body = resp.json()

        assert body["job"]["job_id"] == "job-A"
        assert body["job"]["name"] == "Run A"
        assert body["job"]["status"] == "running"
        assert body["latest_training"] is not None
        assert body["latest_training"]["step"] == 5
        assert body["latest_hardware"] is not None
        assert body["latest_hardware"]["node_id"] == "node-0"

        alert_ids = {a["alert_id"] for a in body["alerts"]}
        assert alert_ids == {"alert-A1"}

        diag_alert_ids = {d["alert_id"] for d in body["diagnoses"]}
        assert diag_alert_ids == {"alert-A1"}

        assert body["run_duration_ms"] >= 0

    async def test_summary_run_duration_uses_updated_at_when_completed(self, test_app, client):
        _, _, _, _, js, *_ = test_app

        js.register("job-done", {}, ["node-0"], name="Done")
        # Force timestamps for deterministic duration.
        with js._lock:
            entry = js._jobs["job-done"]
            entry["created_at_ms"] = 1_000
            entry["updated_at_ms"] = 6_500
            entry["status"] = "completed"

        resp = await client.get("/api/v1/jobs/job-done/summary")
        assert resp.status_code == 200
        body = resp.json()
        assert body["job"]["status"] == "completed"
        assert body["run_duration_ms"] == 5_500


class TestAlertLifecycleEndpoints:
    async def test_patch_state_happy_path(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        resp = await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "acknowledged"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["state"] == "acknowledged"
        assert body["notes"] == []

    async def test_patch_state_unknown_alert_404(self, client):
        resp = await client.patch(
            "/api/v1/alerts/missing/state",
            json={"state": "acknowledged"},
        )
        assert resp.status_code == 404

    async def test_patch_state_invalid_value_400(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        resp = await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "totally-bogus"},
        )
        assert resp.status_code == 400

    async def test_patch_state_idempotent(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        first = await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "investigating"},
        )
        second = await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "investigating"},
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert second.json()["state"] == "investigating"

    async def test_post_note_happy_path(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        resp = await client.post(
            f"/api/v1/alerts/{alert.alert_id}/notes",
            json={"text": "checked logs", "author": "cara"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["notes"]) == 1
        assert body["notes"][0]["text"] == "checked logs"
        assert body["notes"][0]["author"] == "cara"

    async def test_post_note_unknown_alert_404(self, client):
        resp = await client.post(
            "/api/v1/alerts/missing/notes",
            json={"text": "hi"},
        )
        assert resp.status_code == 404

    async def test_listing_includes_lifecycle(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        # Set lifecycle state
        await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "acknowledged"},
        )

        resp = await client.get("/api/v1/alerts")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        # AlertModel fields preserved
        assert item["alert_id"] == alert.alert_id
        assert item["severity"] == alert.severity
        # lifecycle present
        assert "lifecycle" in item
        assert item["lifecycle"]["state"] == "acknowledged"

    async def test_listing_lifecycle_null_when_untouched(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        resp = await client.get("/api/v1/alerts")
        assert resp.status_code == 200
        items = resp.json()
        assert items[0]["lifecycle"] is None

    async def test_enriched_includes_lifecycle(self, test_app, client):
        _, _, als, *_ = test_app
        alert = _make_alert()
        als.add(alert)

        await client.patch(
            f"/api/v1/alerts/{alert.alert_id}/state",
            json={"state": "investigating"},
        )

        resp = await client.get(f"/api/v1/alerts/{alert.alert_id}/enriched")
        assert resp.status_code == 200
        body = resp.json()
        assert body["lifecycle"]["state"] == "investigating"
        # Underlying alert fields still present
        assert body["alert"]["alert_id"] == alert.alert_id
