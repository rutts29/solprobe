"""PyTorch training callback that writes metrics to a memory-mapped file.

The Rust sidecar reads the binary file at /tmp/solprobe_training_{node_id}.bin
to ingest training telemetry without any IPC overhead beyond a shared mmap.

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

import mmap
import os
import struct
import time
from pathlib import Path
from typing import Any

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
    """

    def __init__(self, node_id: str = "node-0", peak_tps: float = 15000.0) -> None:
        self.node_id = node_id
        self.peak_tps = peak_tps
        self._path = Path(f"/tmp/solprobe_training_{node_id}.bin")
        self._closed = False

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
