"""PyTorch training callback that writes metrics to a memory-mapped file.

The Rust sidecar reads the binary file at
{mmap_dir}/solprobe_training_{node_id}.bin to ingest training telemetry without
any IPC overhead beyond a shared mmap. The directory defaults to /tmp and can be
overridden with the SOLPROBE_MMAP_DIR environment variable.

Binary layout (little-endian, 64 bytes padded):
  Offset  Size  Type  Field
  0       1     u8    valid_flag (1 = data available)
  1       8     i64   timestamp_ms (unix millis)
  9       8     u64   step
  17      4     f32   loss
  21      4     f32   gradient_norm
  25      4     f32   learning_rate
  29      4     f32   throughput_tps
  33      4     f32   mfu_pct
  37..63  27    -     padding (zeros)
"""

from __future__ import annotations

import json
import logging
import mmap
import os
import struct
import threading
import time
from pathlib import Path
from typing import Any
from urllib import request as _urlrequest
from urllib import error as _urlerror

logger = logging.getLogger(__name__)

# Lazy torch import -- only needed at method call time.
_torch = None


def _get_torch():
    """Return the torch module, importing it on first call."""
    global _torch
    if _torch is None:
        try:
            import torch  # noqa: F811
            _torch = torch
        except ImportError as exc:
            raise ImportError(
                "PyTorch is required for SolProbeCallback but is not installed. "
                "Install it with: pip install torch"
            ) from exc
    return _torch


# Struct format for the 37 payload bytes (little-endian).
#   B  = u8   valid_flag
#   q  = i64  timestamp_ms
#   Q  = u64  step
#   f  = f32  loss
#   f  = f32  gradient_norm
#   f  = f32  learning_rate
#   f  = f32  throughput_tps
#   f  = f32  mfu_pct
_PACK_FMT = "<BqQfffff"
_PACK_SIZE = struct.calcsize(_PACK_FMT)  # 37
_FILE_SIZE = 64  # padded size


class SolProbeCallback:
    """Writes training metrics to a memory-mapped binary file.

    Usage::

        from training.callback import SolProbeCallback

        cb = SolProbeCallback(node_id="node-0", peak_tps=15000.0)
        for step, batch in enumerate(dataloader):
            t0 = time.perf_counter()
            loss = train_step(model, batch, optimizer)
            batch_time = time.perf_counter() - t0
            cb.on_train_batch_end(
                step=step,
                loss=loss.item(),
                model=model,
                optimizer=optimizer,
                batch_time=batch_time,
                tokens_in_batch=batch_size * seq_len,
            )
        cb.on_train_end()

    Parameters
    ----------
    node_id : str
        Unique identifier for this training node (default ``"node-0"``).
    peak_tps : float
        Theoretical peak tokens-per-second for the hardware, used to
        estimate MFU percentage.  Defaults to ``15000.0`` (reasonable
        for a single T4 running a small transformer).
    mmap_dir : str | pathlib.Path | None
        Directory for the backing mmap file. Defaults to
        ``SOLPROBE_MMAP_DIR`` or ``/tmp``.
    """

    def __init__(
        self,
        node_id: str = "node-0",
        peak_tps: float = 15000.0,
        mmap_dir: str | Path | None = None,
        job_id: str | None = None,
        backend_url: str | None = None,
    ) -> None:
        self.node_id = node_id
        self.peak_tps = peak_tps
        self.job_id = job_id
        self.backend_url = backend_url or os.environ.get(
            "SOLPROBE_BACKEND_URL", "http://localhost:8000"
        )
        self._mmap_dir = Path(mmap_dir or os.environ.get("SOLPROBE_MMAP_DIR", "/tmp"))
        self._mmap_dir.mkdir(parents=True, exist_ok=True)
        self._path = self._mmap_dir / f"solprobe_training_{node_id}.bin"
        self._closed = False
        self._log_metric_warned = False

        # Create / truncate the backing file to _FILE_SIZE bytes.
        with open(self._path, "wb") as f:
            f.write(b"\x00" * _FILE_SIZE)

        # Open the file and create a read-write mmap over it.
        self._fd = os.open(str(self._path), os.O_RDWR)
        self._mm = mmap.mmap(self._fd, _FILE_SIZE)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def on_train_batch_end(
        self,
        step: int,
        loss: float,
        model: Any,
        optimizer: Any,
        batch_time: float,
        tokens_in_batch: int,
    ) -> None:
        """Record metrics for one completed training step.

        Parameters
        ----------
        step : int
            Global training step number.
        loss : float
            Scalar loss value for this batch.
        model : torch.nn.Module
            The model being trained (used to read gradient norms).
        optimizer : torch.optim.Optimizer
            The optimizer (used to read the current learning rate).
        batch_time : float
            Wall-clock seconds elapsed for this training step.
        tokens_in_batch : int
            Number of tokens processed in this batch.
        """
        if self._closed:
            raise RuntimeError("SolProbeCallback has already been closed.")

        torch = _get_torch()

        # -- gradient norm (L2 across all parameters with gradients) --
        grad_norm = self._compute_grad_norm(model, torch)

        # -- learning rate --
        lr = float(optimizer.param_groups[0]["lr"])

        # -- throughput --
        throughput_tps = float(tokens_in_batch) / max(batch_time, 1e-9)

        # -- MFU estimate (simplified) --
        mfu_pct = (throughput_tps / self.peak_tps) * 100.0 if self.peak_tps > 0 else 0.0

        timestamp_ms = int(time.time() * 1000)

        self._write(
            valid_flag=1,
            timestamp_ms=timestamp_ms,
            step=step,
            loss=float(loss),
            gradient_norm=float(grad_norm),
            learning_rate=lr,
            throughput_tps=throughput_tps,
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
        job_id: str | None = None,
    ) -> None:
        """Record a user-defined custom metric to the SolProbe backend.

        Fire-and-forget: ships the metric on a daemon thread with a short
        timeout, never raises, and warns once per callback if the backend URL
        or ``job_id`` is missing. ``job_id`` resolution order is the explicit
        argument, then ``self.job_id`` from construction.
        """
        effective_job = job_id or self.job_id
        if not effective_job:
            if not self._log_metric_warned:
                logger.warning(
                    "SolProbeCallback.log_metric called without job_id; "
                    "set job_id on the callback or pass it per-call."
                )
                self._log_metric_warned = True
            return
        if not self.backend_url:
            if not self._log_metric_warned:
                logger.warning(
                    "SolProbeCallback.log_metric: backend_url not configured."
                )
                self._log_metric_warned = True
            return

        payload = {
            "node_id": self.node_id,
            "job_id": effective_job,
            "timestamp_ms": int(time.time() * 1000),
            "step": step,
            "name": name,
            "value": float(value),
            "unit": unit,
            "tags": tags or {},
        }
        url = self.backend_url.rstrip("/") + "/api/v1/custom-metrics"

        def _send() -> None:
            try:
                req = _urlrequest.Request(
                    url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with _urlrequest.urlopen(req, timeout=2.0):
                    pass
            except (_urlerror.URLError, TimeoutError, OSError) as exc:
                logger.warning("log_metric POST failed: %s", exc)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("log_metric unexpected error: %s", exc)

        threading.Thread(target=_send, daemon=True).start()

    def on_train_end(self) -> None:
        """Signal that training has finished and invalidate the shared buffer."""
        if not self._closed:
            # Set valid_flag to 0.
            self._mm.seek(0)
            self._mm.write(b"\x00")
            self._mm.flush()
        self.close()

    def close(self) -> None:
        """Release the memory-mapped file and file descriptor."""
        if self._closed:
            return
        self._closed = True
        try:
            self._mm.close()
        except Exception:
            pass
        try:
            os.close(self._fd)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_grad_norm(model: Any, torch: Any) -> float:
        """Compute the total L2 gradient norm across all model parameters."""
        total_norm_sq = 0.0
        for p in model.parameters():
            if p.grad is not None:
                total_norm_sq += p.grad.data.norm(2).item() ** 2
        return total_norm_sq ** 0.5

    def _write(
        self,
        valid_flag: int,
        timestamp_ms: int,
        step: int,
        loss: float,
        gradient_norm: float,
        learning_rate: float,
        throughput_tps: float,
        mfu_pct: float,
    ) -> None:
        """Pack fields into the mmap buffer and flush."""
        payload = struct.pack(
            _PACK_FMT,
            valid_flag,
            timestamp_ms,
            step,
            loss,
            gradient_norm,
            learning_rate,
            throughput_tps,
            mfu_pct,
        )
        # Pad to _FILE_SIZE.
        payload = payload + b"\x00" * (_FILE_SIZE - len(payload))
        self._mm.seek(0)
        self._mm.write(payload)
        self._mm.flush()

    def __del__(self) -> None:
        self.close()

    # Context-manager support.
    def __enter__(self) -> "SolProbeCallback":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
