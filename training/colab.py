"""Google Colab client for streaming SolProbe metrics over REST.

The Rust sidecar is still the preferred collector for production nodes. Colab
is different: notebooks usually cannot run a long-lived sidecar comfortably, so
this client posts the same metric shape directly to the SolProbe backend.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any
from urllib import error as _urlerror
from urllib import request as _urlrequest


class SolProbeColabClient:
    """Small REST client for Colab/T4 training demos."""

    def __init__(
        self,
        *,
        backend_url: str,
        api_key: str,
        node_id: str = "colab-t4-0",
        job_id: str = "colab-demo",
        gpu_model: str | None = None,
        timeout: float = 2.0,
    ) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.api_key = api_key
        self.node_id = node_id
        self.job_id = job_id
        self.gpu_model = gpu_model or detect_gpu_model()
        self.timeout = timeout

    @classmethod
    def from_env(
        cls,
        *,
        node_id: str = "colab-t4-0",
        job_id: str = "colab-demo",
    ) -> "SolProbeColabClient":
        backend_url = os.environ["SOLPROBE_BACKEND_URL"]
        api_key = os.environ["SOLPROBE_API_KEY"]
        return cls(
            backend_url=backend_url,
            api_key=api_key,
            node_id=node_id,
            job_id=job_id,
        )

    def register_job(
        self,
        *,
        name: str = "Google Colab T4 demo",
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "job_id": self.job_id,
            "name": name,
            "config": {
                "platform": "google-colab",
                "gpu_model": self.gpu_model,
                **(config or {}),
            },
            "node_ids": [self.node_id],
        }
        return self._post("/api/v1/jobs", payload)

    def update_job_status(self, status: str) -> dict[str, Any]:
        return self._patch(f"/api/v1/jobs/{self.job_id}/status", {"status": status})

    def report_training_step(
        self,
        *,
        step: int,
        loss: float,
        gradient_norm: float = 0.0,
        learning_rate: float = 0.0,
        throughput_tps: float = 0.0,
        mfu_pct: float = 0.0,
        gpu_utilization_pct: float | None = None,
        gpu_temp_c: float | None = None,
        fb_used_mb: float | None = None,
        fb_free_mb: float | None = None,
        timestamp_ms: int | None = None,
    ) -> dict[str, Any]:
        timestamp = timestamp_ms or int(time.time() * 1000)
        gpu = sample_nvidia_smi()
        gpu.update({
            "node_id": self.node_id,
            "gpu_index": 0,
            "gpu_model": self.gpu_model,
            "timestamp_ms": timestamp,
        })
        if gpu_utilization_pct is not None:
            gpu["gpu_utilization_pct"] = float(gpu_utilization_pct)
        if gpu_temp_c is not None:
            gpu["gpu_temp_c"] = float(gpu_temp_c)
        if fb_used_mb is not None:
            gpu["fb_used_mb"] = float(fb_used_mb)
        if fb_free_mb is not None:
            gpu["fb_free_mb"] = float(fb_free_mb)

        payload = {
            "gpu": [gpu],
            "training": {
                "node_id": self.node_id,
                "job_id": self.job_id,
                "timestamp_ms": timestamp,
                "step": int(step),
                "loss": float(loss),
                "gradient_norm": float(gradient_norm),
                "learning_rate": float(learning_rate),
                "throughput_tps": float(throughput_tps),
                "mfu_pct": float(mfu_pct),
            },
        }
        return self._post("/api/v1/metrics/batches", payload)

    def report_torch_step(
        self,
        *,
        step: int,
        loss: Any,
        model: Any,
        optimizer: Any,
        batch_time: float,
        tokens_in_batch: int,
        peak_tps: float = 12000.0,
    ) -> dict[str, Any]:
        loss_value = float(loss.detach().item() if hasattr(loss, "detach") else loss)
        throughput = float(tokens_in_batch) / max(float(batch_time), 1e-9)
        learning_rate = float(optimizer.param_groups[0]["lr"])
        grad_norm = _compute_grad_norm(model)
        mfu_pct = (throughput / peak_tps) * 100.0 if peak_tps > 0 else 0.0
        return self.report_training_step(
            step=step,
            loss=loss_value,
            gradient_norm=grad_norm,
            learning_rate=learning_rate,
            throughput_tps=throughput,
            mfu_pct=mfu_pct,
        )

    def log_metric(
        self,
        name: str,
        value: float,
        *,
        step: int | None = None,
        unit: str | None = None,
        tags: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        return self._post(
            "/api/v1/custom-metrics",
            {
                "node_id": self.node_id,
                "job_id": self.job_id,
                "timestamp_ms": int(time.time() * 1000),
                "step": step,
                "name": name,
                "value": float(value),
                "unit": unit,
                "tags": tags or {},
            },
        )

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(path, payload, method="POST")

    def _patch(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request(path, payload, method="PATCH")

    def _request(self, path: str, payload: dict[str, Any], *, method: str) -> dict[str, Any]:
        req = _urlrequest.Request(
            self.backend_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-SolProbe-API-Key": self.api_key,
            },
            method=method,
        )
        try:
            with _urlrequest.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except _urlerror.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"SolProbe API {exc.code}: {detail}") from exc
        except (_urlerror.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"SolProbe API request failed: {exc}") from exc
        return json.loads(raw.decode("utf-8")) if raw else {}


def detect_gpu_model() -> str:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader,nounits"],
            text=True,
            timeout=1.0,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    return out.splitlines()[0].strip() if out else "unknown"


def sample_nvidia_smi() -> dict[str, float]:
    defaults = {
        "gpu_temp_c": 0.0,
        "gpu_utilization_pct": 0.0,
        "fb_used_mb": 0.0,
        "fb_free_mb": 0.0,
        "power_usage_w": 0.0,
    }
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.free,power.draw",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=1.0,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return defaults
    if not out:
        return defaults
    parts = [p.strip() for p in out.splitlines()[0].split(",")]
    try:
        return {
            "gpu_temp_c": float(parts[0]),
            "gpu_utilization_pct": float(parts[1]),
            "fb_used_mb": float(parts[2]),
            "fb_free_mb": float(parts[3]),
            "power_usage_w": float(parts[4]),
        }
    except (IndexError, ValueError):
        return defaults


def _compute_grad_norm(model: Any) -> float:
    total_norm_sq = 0.0
    for param in model.parameters():
        if param.grad is not None:
            total_norm_sq += float(param.grad.data.norm(2).item()) ** 2
    return total_norm_sq ** 0.5
