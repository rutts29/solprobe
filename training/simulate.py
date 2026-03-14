"""Standalone metric simulator for SolProbe.

Writes fake training metrics to memory-mapped files WITHOUT requiring PyTorch.
Useful for testing the Rust sidecar without running a real training job.

Usage::

    python -m training.simulate --node-id node-0 --duration 300 --scenario normal

Scenarios:
    normal              Loss decreases 4.0 -> 0.5, steady throughput ~5000 tps.
    gradient_explosion  Stable training then gradient_norm spikes to 1e6 at step 200.
    loss_plateau        Loss drops normally then plateaus at ~2.0 for 100+ steps.
    diloco_drift        Inner loss decreasing, outer loss diverges after outer step 5.
"""

from __future__ import annotations

import argparse
import math
import mmap
import os
import random
import struct
import sys
import time
from pathlib import Path

# -----------------------------------------------------------------------
# Binary formats (must match Rust sidecar exactly)
# -----------------------------------------------------------------------

# Training metrics: /tmp/solprobe_training_{node_id}.bin
_TRAIN_FMT = "<BqQfffff"
_TRAIN_SIZE = struct.calcsize(_TRAIN_FMT)  # 37
_TRAIN_FILE_SIZE = 64

# DiLoCo metrics: /tmp/solprobe_diloco_{node_id}.bin
_DILOCO_FMT = "<BqQQfffffB"
_DILOCO_SIZE = struct.calcsize(_DILOCO_FMT)  # 46
_DILOCO_FILE_SIZE = 64

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------


def _open_mmap(path: Path, size: int) -> tuple[int, mmap.mmap]:
    """Create (or truncate) a file and return (fd, mmap)."""
    with open(path, "wb") as f:
        f.write(b"\x00" * size)
    fd = os.open(str(path), os.O_RDWR)
    mm = mmap.mmap(fd, size)
    return fd, mm


def _write_training(
    mm: mmap.mmap,
    *,
    step: int,
    loss: float,
    gradient_norm: float,
    learning_rate: float,
    throughput_tps: float,
    mfu_pct: float,
) -> None:
    """Pack training metrics into the mmap buffer."""
    timestamp_ms = int(time.time() * 1000)
    payload = struct.pack(
        _TRAIN_FMT,
        1,  # valid_flag
        timestamp_ms,
        step,
        loss,
        gradient_norm,
        learning_rate,
        throughput_tps,
        mfu_pct,
    )
    payload += b"\x00" * (_TRAIN_FILE_SIZE - len(payload))
    mm.seek(0)
    mm.write(payload)
    mm.flush()


def _write_diloco(
    mm: mmap.mmap,
    *,
    inner_step: int,
    outer_step: int,
    inner_loss: float,
    outer_loss: float,
    pseudo_grad_norm: float,
    sync_duration_ms: float,
    worker_speed_ratio: float,
    is_straggler: bool,
) -> None:
    """Pack DiLoCo metrics into the mmap buffer."""
    timestamp_ms = int(time.time() * 1000)
    payload = struct.pack(
        _DILOCO_FMT,
        1,  # valid_flag
        timestamp_ms,
        inner_step,
        outer_step,
        inner_loss,
        outer_loss,
        pseudo_grad_norm,
        sync_duration_ms,
        worker_speed_ratio,
        1 if is_straggler else 0,
    )
    payload += b"\x00" * (_DILOCO_FILE_SIZE - len(payload))
    mm.seek(0)
    mm.write(payload)
    mm.flush()


# -----------------------------------------------------------------------
# Scenario generators
# -----------------------------------------------------------------------


def _jitter(value: float, pct: float = 0.05) -> float:
    """Apply random jitter of +/- pct to value."""
    return value * (1.0 + random.uniform(-pct, pct))


def scenario_normal(
    train_mm: mmap.mmap,
    diloco_mm: mmap.mmap | None,
    duration: int,
) -> None:
    """Normal healthy training: loss decreases, stable throughput."""
    total_steps = duration if duration > 0 else 10_000_000
    lr = 3e-4
    base_throughput = 5000.0
    peak_tps = 15000.0

    for step in range(total_steps):
        # Loss: exponential decay from 4.0 -> ~0.5
        progress = min(step / max(total_steps - 1, 1), 1.0)
        loss = 4.0 * math.exp(-3.5 * progress) + 0.5
        loss = _jitter(loss, 0.03)

        grad_norm = _jitter(1.0, 0.15)
        throughput = _jitter(base_throughput, 0.05)
        mfu = (throughput / peak_tps) * 100.0

        _write_training(
            train_mm,
            step=step,
            loss=loss,
            gradient_norm=grad_norm,
            learning_rate=lr,
            throughput_tps=throughput,
            mfu_pct=mfu,
        )

        print(
            f"[normal] step={step:>6d}  loss={loss:.4f}  "
            f"grad_norm={grad_norm:.4f}  tps={throughput:.0f}  mfu={mfu:.1f}%"
        )

        if duration > 0 and step >= duration - 1:
            break
        time.sleep(1)


def scenario_gradient_explosion(
    train_mm: mmap.mmap,
    diloco_mm: mmap.mmap | None,
    duration: int,
) -> None:
    """Stable training then gradient_norm spikes at step 200."""
    total_steps = duration if duration > 0 else 10_000_000
    lr = 3e-4
    base_throughput = 5000.0
    peak_tps = 15000.0

    for step in range(total_steps):
        progress = min(step / max(total_steps - 1, 1), 1.0)
        loss = 4.0 * math.exp(-3.5 * progress) + 0.5

        if step < 200:
            grad_norm = _jitter(1.0, 0.15)
        else:
            # Exponential spike starting at step 200
            spike_factor = min(10 ** ((step - 200) / 20.0), 1e6)
            grad_norm = spike_factor
            # Loss also blows up
            loss = loss + spike_factor * 0.001

        loss = _jitter(loss, 0.03)
        throughput = _jitter(base_throughput, 0.05)
        mfu = (throughput / peak_tps) * 100.0

        _write_training(
            train_mm,
            step=step,
            loss=loss,
            gradient_norm=grad_norm,
            learning_rate=lr,
            throughput_tps=throughput,
            mfu_pct=mfu,
        )

        print(
            f"[grad_explosion] step={step:>6d}  loss={loss:.4f}  "
            f"grad_norm={grad_norm:.4e}  tps={throughput:.0f}"
        )

        if duration > 0 and step >= duration - 1:
            break
        time.sleep(1)


def scenario_loss_plateau(
    train_mm: mmap.mmap,
    diloco_mm: mmap.mmap | None,
    duration: int,
) -> None:
    """Loss drops normally then plateaus at ~2.0 for 100+ steps."""
    total_steps = duration if duration > 0 else 10_000_000
    lr = 3e-4
    base_throughput = 5000.0
    peak_tps = 15000.0
    plateau_start = min(100, total_steps // 3)

    for step in range(total_steps):
        if step < plateau_start:
            # Normal descent toward ~2.0
            progress = step / max(plateau_start - 1, 1)
            loss = 4.0 - 2.0 * progress
        else:
            # Plateau at ~2.0 with minor noise
            loss = 2.0

        loss = _jitter(loss, 0.02)
        grad_norm = _jitter(0.3 if step >= plateau_start else 1.0, 0.15)
        throughput = _jitter(base_throughput, 0.05)
        mfu = (throughput / peak_tps) * 100.0

        _write_training(
            train_mm,
            step=step,
            loss=loss,
            gradient_norm=grad_norm,
            learning_rate=lr,
            throughput_tps=throughput,
            mfu_pct=mfu,
        )

        plateau_tag = " [PLATEAU]" if step >= plateau_start else ""
        print(
            f"[loss_plateau] step={step:>6d}  loss={loss:.4f}  "
            f"grad_norm={grad_norm:.4f}  tps={throughput:.0f}{plateau_tag}"
        )

        if duration > 0 and step >= duration - 1:
            break
        time.sleep(1)


def scenario_diloco_drift(
    train_mm: mmap.mmap,
    diloco_mm: mmap.mmap | None,
    duration: int,
) -> None:
    """Inner loss decreasing but outer loss diverges after outer step 5."""
    if diloco_mm is None:
        print("ERROR: diloco_drift scenario requires DiLoCo mmap file.", file=sys.stderr)
        return

    total_steps = duration if duration > 0 else 10_000_000
    lr = 3e-4
    base_throughput = 5000.0
    peak_tps = 15000.0
    inner_steps_per_outer = 10

    for step in range(total_steps):
        inner_step = step % inner_steps_per_outer
        outer_step = step // inner_steps_per_outer

        # Inner loss always decreasing (local model doing fine)
        overall_progress = min(step / max(total_steps - 1, 1), 1.0)
        inner_loss = 4.0 * math.exp(-3.0 * overall_progress) + 0.3
        inner_loss = _jitter(inner_loss, 0.03)

        # Training metrics
        grad_norm = _jitter(1.0, 0.15)
        throughput = _jitter(base_throughput, 0.05)
        mfu = (throughput / peak_tps) * 100.0

        _write_training(
            train_mm,
            step=step,
            loss=inner_loss,
            gradient_norm=grad_norm,
            learning_rate=lr,
            throughput_tps=throughput,
            mfu_pct=mfu,
        )

        # DiLoCo metrics: write on every step for inner tracking,
        # full update on outer step boundaries.
        if inner_step == inner_steps_per_outer - 1:
            # Outer step boundary
            if outer_step <= 5:
                outer_loss = inner_loss * 1.1  # Slightly worse but tracking
                pseudo_grad_norm = _jitter(0.5, 0.1)
                sync_dur = _jitter(300.0, 0.1)
                speed_ratio = _jitter(1.0, 0.05)
                is_straggler = False
            else:
                # Divergence: outer loss goes up despite inner loss going down
                drift_factor = (outer_step - 5) * 0.4
                outer_loss = inner_loss + drift_factor
                pseudo_grad_norm = _jitter(0.5 + drift_factor * 0.5, 0.1)
                sync_dur = _jitter(300.0 + (outer_step - 5) * 50.0, 0.1)
                speed_ratio = max(0.5, _jitter(1.0 - (outer_step - 5) * 0.05, 0.05))
                is_straggler = speed_ratio < 0.75

            _write_diloco(
                diloco_mm,
                inner_step=inner_step,
                outer_step=outer_step,
                inner_loss=inner_loss,
                outer_loss=outer_loss,
                pseudo_grad_norm=pseudo_grad_norm,
                sync_duration_ms=sync_dur,
                worker_speed_ratio=speed_ratio,
                is_straggler=is_straggler,
            )

            drift_tag = " [DRIFT]" if outer_step > 5 else ""
            strag_tag = " [STRAGGLER]" if is_straggler else ""
            print(
                f"[diloco_drift] step={step:>6d}  outer={outer_step}  "
                f"inner_loss={inner_loss:.4f}  outer_loss={outer_loss:.4f}  "
                f"pseudo_grad={pseudo_grad_norm:.4f}  sync={sync_dur:.0f}ms  "
                f"speed={speed_ratio:.3f}{drift_tag}{strag_tag}"
            )
        else:
            _write_diloco(
                diloco_mm,
                inner_step=inner_step,
                outer_step=outer_step,
                inner_loss=inner_loss,
                outer_loss=0.0,
                pseudo_grad_norm=0.0,
                sync_duration_ms=0.0,
                worker_speed_ratio=1.0,
                is_straggler=False,
            )
            print(
                f"[diloco_drift] step={step:>6d}  outer={outer_step}  "
                f"inner_step={inner_step}  inner_loss={inner_loss:.4f}"
            )

        if duration > 0 and step >= duration - 1:
            break
        time.sleep(1)


# -----------------------------------------------------------------------
# Verification helper
# -----------------------------------------------------------------------


def _verify_binary_format() -> None:
    """Write-then-read sanity check for both binary formats."""
    # Training format
    assert _TRAIN_SIZE == 37, f"Training struct size mismatch: {_TRAIN_SIZE} != 37"
    data = struct.pack(_TRAIN_FMT, 1, 1234567890000, 42, 2.5, 1.0, 3e-4, 5000.0, 33.3)
    fields = struct.unpack(_TRAIN_FMT, data)
    assert fields[0] == 1  # valid
    assert fields[1] == 1234567890000  # timestamp
    assert fields[2] == 42  # step
    assert abs(fields[3] - 2.5) < 1e-5  # loss

    # DiLoCo format
    assert _DILOCO_SIZE == 46, f"DiLoCo struct size mismatch: {_DILOCO_SIZE} != 46"
    data = struct.pack(
        _DILOCO_FMT, 1, 1234567890000, 5, 1, 2.1, 1.8, 0.45, 320.0, 0.98, 0
    )
    fields = struct.unpack(_DILOCO_FMT, data)
    assert fields[0] == 1
    assert fields[2] == 5  # inner_step
    assert fields[3] == 1  # outer_step
    assert fields[9] == 0  # is_straggler

    print("Binary format verification passed.")


# -----------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------

_SCENARIOS = {
    "normal": scenario_normal,
    "gradient_explosion": scenario_gradient_explosion,
    "loss_plateau": scenario_loss_plateau,
    "diloco_drift": scenario_diloco_drift,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="SolProbe metric simulator -- writes fake training metrics "
        "to shared memory files without requiring PyTorch."
    )
    parser.add_argument(
        "--node-id",
        type=str,
        default="node-0",
        help="Node identifier (default: node-0)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=300,
        help="Number of simulated steps (0 = run indefinitely, default: 300)",
    )
    parser.add_argument(
        "--scenario",
        type=str,
        default="normal",
        choices=list(_SCENARIOS.keys()),
        help="Simulation scenario (default: normal)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run binary format verification and exit",
    )
    args = parser.parse_args()

    if args.verify:
        _verify_binary_format()
        return

    node_id = args.node_id
    train_path = Path(f"/tmp/solprobe_training_{node_id}.bin")
    diloco_path = Path(f"/tmp/solprobe_diloco_{node_id}.bin")

    print(f"SolProbe Simulator")
    print(f"  node_id:    {node_id}")
    print(f"  scenario:   {args.scenario}")
    print(f"  duration:   {'indefinite' if args.duration == 0 else args.duration}")
    print(f"  train file: {train_path}")
    print(f"  diloco file:{diloco_path}")
    print()

    # Verify before starting
    _verify_binary_format()
    print()

    train_fd, train_mm = _open_mmap(train_path, _TRAIN_FILE_SIZE)
    diloco_fd, diloco_mm = _open_mmap(diloco_path, _DILOCO_FILE_SIZE)

    try:
        scenario_fn = _SCENARIOS[args.scenario]
        scenario_fn(train_mm, diloco_mm, args.duration)
    except KeyboardInterrupt:
        print("\nSimulation interrupted by user.")
    finally:
        # Invalidate both files
        for mm in (train_mm, diloco_mm):
            try:
                mm.seek(0)
                mm.write(b"\x00")
                mm.flush()
                mm.close()
            except Exception:
                pass
        for fd in (train_fd, diloco_fd):
            try:
                os.close(fd)
            except Exception:
                pass
        print("Cleanup complete. Shared memory files invalidated.")


if __name__ == "__main__":
    main()
