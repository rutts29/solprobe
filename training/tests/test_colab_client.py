from __future__ import annotations

import json

from training.colab import SolProbeColabClient


class _Response:
    def __init__(self, payload: bytes = b'{"ok": true}') -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def read(self) -> bytes:
        return self.payload


def test_report_training_step_posts_authenticated_metrics_batch(monkeypatch):
    captured = []

    def fake_urlopen(req, timeout=0):
        captured.append((req, timeout))
        return _Response()

    monkeypatch.setattr("training.colab._urlrequest.urlopen", fake_urlopen)
    client = SolProbeColabClient(
        backend_url="https://solprobe.example",
        api_key="demo-key",
        node_id="colab-t4-0",
        job_id="colab-demo",
        gpu_model="T4",
    )

    client.report_training_step(
        step=7,
        loss=1.23,
        gradient_norm=0.9,
        learning_rate=3e-4,
        throughput_tps=2048.0,
        mfu_pct=17.5,
        gpu_utilization_pct=82.0,
        fb_used_mb=1024.0,
        fb_free_mb=14336.0,
    )

    assert len(captured) == 1
    req, timeout = captured[0]
    assert timeout == 2.0
    assert req.full_url == "https://solprobe.example/api/v1/metrics/batches"
    assert req.get_method() == "POST"
    assert req.headers["X-solprobe-api-key"] == "demo-key"
    body = json.loads(req.data.decode("utf-8"))
    assert body["training"]["node_id"] == "colab-t4-0"
    assert body["training"]["job_id"] == "colab-demo"
    assert body["training"]["step"] == 7
    assert body["gpu"][0]["gpu_model"] == "T4"
    assert body["gpu"][0]["gpu_utilization_pct"] == 82.0


def test_register_job_posts_job_metadata_with_api_key(monkeypatch):
    captured = []

    def fake_urlopen(req, timeout=0):
        captured.append((req, timeout))
        return _Response()

    monkeypatch.setattr("training.colab._urlrequest.urlopen", fake_urlopen)
    client = SolProbeColabClient(
        backend_url="https://solprobe.example/",
        api_key="demo-key",
        node_id="colab-t4-0",
        job_id="colab-demo",
    )

    client.register_job(name="Colab T4 smoke", config={"model": "tiny-transformer"})

    req, _ = captured[0]
    body = json.loads(req.data.decode("utf-8"))
    assert req.full_url == "https://solprobe.example/api/v1/jobs"
    assert req.headers["X-solprobe-api-key"] == "demo-key"
    assert body["job_id"] == "colab-demo"
    assert body["node_ids"] == ["colab-t4-0"]
    assert body["config"]["platform"] == "google-colab"
    assert body["config"]["model"] == "tiny-transformer"
