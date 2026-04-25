"""DiLoCo training callback that writes distributed training metrics to a
memory-mapped file consumed by the Rust sidecar.

Binary layout at {mmap_dir}/solprobe_diloco_{node_id}.bin (little-endian,
64 bytes). The directory defaults to /tmp and can be overridden with the
SOLPROBE_MMAP_DIR environment variable.
  Offset  Size  Type  Field
  0       1     u8    valid_flag (1 = data available)
  1       8     i64   timestamp_ms (unix millis)
  9       8     u64   inner_step
  17      8     u64   outer_step
  25      4     f32   inner_loss
  29      4     f32   outer_loss
  33      4     f32   pseudo_grad_norm
  37      4     f32   sync_duration_ms
  41      4     f32   worker_speed_ratio
  45      1     u8    is_straggler (0 or 1)
  46..63  18    -     padding (zeros)
"""

from __future__ import annotations

import mmap
import os
import struct
import time
from pathlib import Path
from typing import Any

# Struct format for the 46 payload bytes (little-endian).
#   B  = u8   valid_flag
#   q  = i64  timestamp_ms
#   Q  = u64  inner_step
#   Q  = u64  outer_step
#   f  = f32  inner_loss
#   f  = f32  outer_loss
#   f  = f32  pseudo_grad_norm
#   f  = f32  sync_duration_ms
#   f  = f32  worker_speed_ratio
#   B  = u8   is_straggler
_PACK_FMT = "<BqQQfffffB"
_PACK_SIZE = struct.calcsize(_PACK_FMT)  # 46
_FILE_SIZE = 64  # padded size


class SolProbeDiLoCoCallback:
    """Writes DiLoCo distributed training metrics to a memory-mapped file.

    This callback is designed to work alongside :class:`SolProbeCallback`
    (they write to different files).

    Usage::

        from training.diloco_callback import SolProbeDiLoCoCallback

        dcb = SolProbeDiLoCoCallback(node_id="node-0")
        # During inner steps:
        dcb.on_inner_step(inner_step=5, outer_step=0, inner_loss=2.1)
        # After outer sync:
        dcb.on_outer_step(
            outer_step=1,
            outer_loss=1.8,
            pseudo_grad_norm=0.45,
            sync_duration_ms=320.0,
            worker_speed_ratio=0.98,
            is_straggler=False,
        )
        dcb.close()

    Parameters
    ----------
    node_id : str
        Unique identifier for this training node (default ``"node-0"``).
    mmap_dir : str | pathlib.Path | None
        Directory for the backing mmap file. Defaults to
        ``SOLPROBE_MMAP_DIR`` or ``/tmp``.
    """

    def __init__(self, node_id: str = "node-0", mmap_dir: str | Path | None = None) -> None:
        self.node_id = node_id
        self._mmap_dir = Path(mmap_dir or os.environ.get("SOLPROBE_MMAP_DIR", "/tmp"))
        self._mmap_dir.mkdir(parents=True, exist_ok=True)
        self._path = self._mmap_dir / f"solprobe_diloco_{node_id}.bin"
        self._closed = False

        # Internal state so partial updates (on_inner_step) can fill the
        # remaining fields with the most recently known values.
        self._inner_step: int = 0
        self._outer_step: int = 0
        self._inner_loss: float = 0.0
        self._outer_loss: float = 0.0
        self._pseudo_grad_norm: float = 0.0
        self._sync_duration_ms: float = 0.0
        self._worker_speed_ratio: float = 1.0
        self._is_straggler: bool = False

        # Create / truncate the backing file to _FILE_SIZE bytes.
        with open(self._path, "wb") as f:
            f.write(b"\x00" * _FILE_SIZE)

        # Open the file and create a read-write mmap over it.
        self._fd = os.open(str(self._path), os.O_RDWR)
        self._mm = mmap.mmap(self._fd, _FILE_SIZE)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def on_inner_step(
        self,
        inner_step: int,
        outer_step: int,
        inner_loss: float,
    ) -> None:
        """Record metrics after an inner (local) training step.

        Parameters
        ----------
        inner_step : int
            Current inner step count within the current outer step.
        outer_step : int
            Current outer step.
        inner_loss : float
            Loss value for this inner step.
        """
        if self._closed:
            raise RuntimeError("SolProbeDiLoCoCallback has already been closed.")

        self._inner_step = inner_step
        self._outer_step = outer_step
        self._inner_loss = float(inner_loss)

        self._flush()

    def on_outer_step(
        self,
        outer_step: int,
        outer_loss: float,
        pseudo_grad_norm: float,
        sync_duration_ms: float,
        worker_speed_ratio: float,
        is_straggler: bool,
    ) -> None:
        """Record metrics after an outer (synchronisation) step.

        Parameters
        ----------
        outer_step : int
            The completed outer step number.
        outer_loss : float
            Loss after outer synchronisation.
        pseudo_grad_norm : float
            L2 norm of the pseudo-gradient (difference between local and
            global parameters).
        sync_duration_ms : float
            Time taken for the outer sync in milliseconds.
        worker_speed_ratio : float
            This worker's speed relative to the cluster average (1.0 = average).
        is_straggler : bool
            Whether this worker was flagged as a straggler.
        """
        if self._closed:
            raise RuntimeError("SolProbeDiLoCoCallback has already been closed.")

        self._outer_step = outer_step
        self._outer_loss = float(outer_loss)
        self._pseudo_grad_norm = float(pseudo_grad_norm)
        self._sync_duration_ms = float(sync_duration_ms)
        self._worker_speed_ratio = float(worker_speed_ratio)
        self._is_straggler = bool(is_straggler)

        self._flush()

    def close(self) -> None:
        """Invalidate the shared buffer and release resources."""
        if self._closed:
            return
        self._closed = True
        # Invalidate: set valid_flag to 0.
        try:
            self._mm.seek(0)
            self._mm.write(b"\x00")
            self._mm.flush()
        except Exception:
            pass
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

    def _flush(self) -> None:
        """Pack current state into the mmap buffer."""
        timestamp_ms = int(time.time() * 1000)
        payload = struct.pack(
            _PACK_FMT,
            1,  # valid_flag
            timestamp_ms,
            self._inner_step,
            self._outer_step,
            self._inner_loss,
            self._outer_loss,
            self._pseudo_grad_norm,
            self._sync_duration_ms,
            self._worker_speed_ratio,
            1 if self._is_straggler else 0,
        )
        # Pad to _FILE_SIZE.
        payload = payload + b"\x00" * (_FILE_SIZE - len(payload))
        self._mm.seek(0)
        self._mm.write(payload)
        self._mm.flush()

    def __del__(self) -> None:
        self.close()

    # Context-manager support.
    def __enter__(self) -> "SolProbeDiLoCoCallback":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
