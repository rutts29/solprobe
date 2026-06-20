from __future__ import annotations

from training.callback import SolProbeCallback


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None


class _ImmediateThread:
    def __init__(self, target, daemon=False):
        self._target = target

    def start(self):
        self._target()


def test_log_metric_posts_api_key_header(monkeypatch, tmp_path):
    captured = []

    def fake_urlopen(req, timeout=0):
        captured.append((req, timeout))
        return _Response()

    monkeypatch.setattr("training.callback._urlrequest.urlopen", fake_urlopen)
    monkeypatch.setattr("training.callback.threading.Thread", _ImmediateThread)

    callback = SolProbeCallback(
        node_id="colab-t4-0",
        job_id="colab-demo",
        backend_url="https://solprobe.example",
        api_key="demo-key",
        mmap_dir=tmp_path,
    )
    try:
        callback.log_metric("eval_loss", 1.2, step=3)
    finally:
        callback.close()

    req, timeout = captured[0]
    assert timeout == 2.0
    assert req.full_url == "https://solprobe.example/api/v1/custom-metrics"
    assert req.headers["X-solprobe-api-key"] == "demo-key"
