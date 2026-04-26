"""Tests for MetricsStore and AlertStore."""

from __future__ import annotations

import time

from app.models.metrics import MetricsBatchModel
from app.stores import AlertStore, JobStore, MetricsStore

from tests.conftest import _make_alert, _make_gpu_metric, _make_training_metric


class TestMetricsStore:
    def test_ingest_creates_node(self, fresh_stores):
        ms, *_ = fresh_stores
        batch = MetricsBatchModel(gpu=[_make_gpu_metric("node-1")])
        ms.ingest_batch(batch)

        assert ms.node_count == 1
        assert ms.get_node_ids() == ["node-1"]

    def test_ring_buffer_cap(self, fresh_stores):
        ms, *_ = fresh_stores
        # Ingest 1850 batches — ring buffer is 1800
        for i in range(1850):
            batch = MetricsBatchModel(
                gpu=[_make_gpu_metric("node-1", ts=1000 + i)]
            )
            ms.ingest_batch(batch)

        history = ms.get_gpu_history("node-1", window_minutes=60)
        assert len(history) == 1800

    def test_multiple_nodes(self, fresh_stores):
        ms, *_ = fresh_stores
        for nid in ["node-1", "node-2", "node-3"]:
            ms.ingest_batch(MetricsBatchModel(gpu=[_make_gpu_metric(nid)]))

        assert ms.node_count == 3
        assert set(ms.get_node_ids()) == {"node-1", "node-2", "node-3"}

    def test_node_status_snapshot(self, fresh_stores):
        ms, *_ = fresh_stores
        batch = MetricsBatchModel(
            gpu=[_make_gpu_metric("node-1", temp=72.0, util=95.0)],
            training=_make_training_metric("node-1", throughput=150.0),
        )
        ms.ingest_batch(batch)

        status = ms.get_node_status("node-1")
        assert status is not None
        assert status.node_id == "node-1"
        assert status.gpu_model == "T4"
        assert status.gpu_count == 1
        assert status.latest_metrics[0].gpu_temp_c == 72.0
        assert status.latest_training is not None
        assert status.latest_training.throughput_tps == 150.0

    def test_node_status_unknown_node(self, fresh_stores):
        ms, *_ = fresh_stores
        assert ms.get_node_status("nonexistent") is None

    def test_gpu_metric_series(self, fresh_stores):
        ms, *_ = fresh_stores
        for i in range(20):
            temp = 50.0 + i
            ms.ingest_batch(
                MetricsBatchModel(gpu=[_make_gpu_metric("node-1", temp=temp, ts=1000 + i)])
            )

        series = ms.get_gpu_metric_series("node-1", "gpu_temp_c", window_minutes=5)
        assert len(series) == 20
        assert series[0] == 50.0
        assert series[-1] == 69.0

    def test_training_metric_series(self, fresh_stores):
        ms, *_ = fresh_stores
        for i in range(15):
            ms.ingest_batch(
                MetricsBatchModel(
                    training=_make_training_metric(
                        "node-1", throughput=100.0 + i, step=i, ts=1000 + i
                    )
                )
            )

        series = ms.get_training_metric_series("node-1", "throughput_tps")
        assert len(series) == 15
        assert series[-1] == 114.0

    def test_get_gpu_history_resolution(self, fresh_stores):
        ms, *_ = fresh_stores
        for i in range(30):
            ms.ingest_batch(
                MetricsBatchModel(gpu=[_make_gpu_metric("node-1", ts=1000 + i)])
            )

        # resolution_seconds=5 should downsample
        history = ms.get_gpu_history("node-1", window_minutes=5, resolution_seconds=5)
        assert len(history) == 6  # 30 / 5 = 6

    def test_training_ingest_only(self, fresh_stores):
        ms, *_ = fresh_stores
        batch = MetricsBatchModel(
            training=_make_training_metric("node-1")
        )
        ms.ingest_batch(batch)
        assert ms.node_count == 1
        status = ms.get_node_status("node-1")
        assert status.latest_training is not None
        assert status.latest_metrics == []


class TestAlertStore:
    def test_add_and_query(self):
        store = AlertStore()
        alert = _make_alert(node_id="node-1", severity="WARNING")
        store.add(alert)

        results = store.query()
        assert len(results) == 1
        assert results[0].node_id == "node-1"

    def test_max_size_cap(self):
        store = AlertStore(max_size=10)
        for i in range(15):
            store.add(_make_alert(node_id=f"node-{i}"))

        assert store.count == 10

    def test_query_by_severity(self):
        store = AlertStore()
        store.add(_make_alert(severity="WARNING"))
        store.add(_make_alert(severity="CRITICAL"))
        store.add(_make_alert(severity="WARNING"))

        results = store.query(severity="CRITICAL")
        assert len(results) == 1
        assert results[0].severity == "CRITICAL"

    def test_query_by_node(self):
        store = AlertStore()
        store.add(_make_alert(node_id="node-1"))
        store.add(_make_alert(node_id="node-2"))
        store.add(_make_alert(node_id="node-1"))

        results = store.query(node_id="node-1")
        assert len(results) == 2

    def test_query_by_alert_type(self):
        store = AlertStore()
        store.add(_make_alert(alert_type="thermal_throttle"))
        store.add(_make_alert(alert_type="gradient_explosion"))

        results = store.query(alert_type="gradient_explosion")
        assert len(results) == 1

    def test_query_limit(self):
        store = AlertStore()
        for _ in range(20):
            store.add(_make_alert())

        results = store.query(limit=5)
        assert len(results) == 5

    def test_newest_first(self):
        store = AlertStore()
        store.add(_make_alert(ts=1000))
        store.add(_make_alert(ts=2000))
        store.add(_make_alert(ts=3000))

        results = store.query()
        assert results[0].timestamp_ms == 3000
        assert results[-1].timestamp_ms == 1000

    def test_get_node_history(self):
        store = AlertStore()
        store.add(_make_alert(node_id="node-1"))
        store.add(_make_alert(node_id="node-2"))
        store.add(_make_alert(node_id="node-1"))

        history = store.get_node_history("node-1", limit=10)
        assert len(history) == 2
        assert all(a.node_id == "node-1" for a in history)

    def test_get_correlated(self):
        store = AlertStore()
        now = int(time.time() * 1000)
        store.add(_make_alert(node_id="node-1", ts=now))
        store.add(_make_alert(node_id="node-2", ts=now + 5000))
        store.add(_make_alert(node_id="node-3", ts=now + 100_000))  # outside window

        correlated = store.get_correlated(now, exclude_node="node-1", window_ms=30_000)
        assert len(correlated) == 1
        assert correlated[0].node_id == "node-2"


class TestJobStore:
    def test_bounded_eviction(self):
        store = JobStore(max_size=3)
        for i in range(4):
            store.register(f"job-{i}", {"type": "train"}, [f"node-{i}"])
        # Oldest (job-0) should be evicted
        assert store.get("job-0") is None
        assert store.get("job-1") is not None
        assert store.get("job-3") is not None

    def test_reregister_moves_to_end(self):
        store = JobStore(max_size=3)
        store.register("job-a", {}, ["n1"])
        store.register("job-b", {}, ["n2"])
        store.register("job-c", {}, ["n3"])
        # Re-register job-a (should move to end)
        store.register("job-a", {}, ["n1"])
        # Now add job-d — job-b should be evicted (oldest), not job-a
        store.register("job-d", {}, ["n4"])
        assert store.get("job-b") is None
        assert store.get("job-a") is not None
        assert store.get("job-d") is not None

    def test_register_seeds_status_and_timestamps(self):
        store = JobStore()
        before_ms = int(time.time() * 1000)
        store.register("job-x", {}, ["n1"], name="Nanochat run")
        after_ms = int(time.time() * 1000)

        job = store.get("job-x")
        assert job is not None
        assert job["job_id"] == "job-x"
        assert job["name"] == "Nanochat run"
        assert job["status"] == "registered"
        assert before_ms <= job["created_at_ms"] <= after_ms
        assert job["updated_at_ms"] == job["created_at_ms"]

    def test_register_default_name_is_none(self):
        store = JobStore()
        store.register("job-x", {}, ["n1"])
        job = store.get("job-x")
        assert job is not None
        assert job["name"] is None

    def test_update_status_changes_status_and_touches_updated_at(self):
        store = JobStore()
        store.register("job-x", {}, ["n1"])
        original_updated = store.get("job-x")["updated_at_ms"]

        time.sleep(0.005)  # ensure clock advances at least 1ms
        store.update_status("job-x", "running")

        job = store.get("job-x")
        assert job["status"] == "running"
        assert job["updated_at_ms"] > original_updated

    def test_update_status_unknown_job_is_noop(self):
        store = JobStore()
        # Should not raise
        store.update_status("nonexistent", "running")
        assert store.get("nonexistent") is None

    def test_update_status_rejects_invalid_status(self):
        store = JobStore()
        store.register("job-x", {}, ["n1"])
        try:
            store.update_status("job-x", "bogus")
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError for invalid status")

    def test_touch_advances_updated_at(self):
        store = JobStore()
        store.register("job-x", {}, ["n1"])
        before = store.get("job-x")["updated_at_ms"]
        time.sleep(0.005)
        store.touch("job-x")
        assert store.get("job-x")["updated_at_ms"] > before

    def test_touch_unknown_job_is_noop(self):
        store = JobStore()
        store.touch("nonexistent")  # should not raise
        assert store.get("nonexistent") is None

    def test_re_register_preserves_created_at_updates_updated_at(self):
        store = JobStore()
        store.register("job-x", {}, ["n1"])
        first_created = store.get("job-x")["created_at_ms"]

        time.sleep(0.005)
        store.register("job-x", {}, ["n1"], name="rename")
        job = store.get("job-x")
        assert job["created_at_ms"] == first_created
        assert job["updated_at_ms"] > first_created
        assert job["name"] == "rename"
