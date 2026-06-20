# SolProbe Showcase

SolProbe is a fault-detection and diagnosis layer for distributed AI training. The demo here runs the full stack on a single Apple Silicon Mac against a tiny GPT trained on synthetic data, and it can also ingest a Google Colab T4 notebook over REST when free Colab GPU capacity is available.

## What SolProbe monitors

A Rust sidecar polls the host every second and forwards three streams to the backend over gRPC: GPU hardware counters (temperature, utilization, framebuffer, power, ECC/XID errors, clock-throttle reasons, PCIe replay), training telemetry from a PyTorch callback (`step`, `loss`, `gradient_norm`, `learning_rate`, `throughput_tps`, `mfu_pct`), and DiLoCo-specific metrics (inner/outer step, pseudo-grad norm, sync duration, worker-speed ratio). Training scripts can also push user-defined custom metrics and full metrics batches directly to the backend over authenticated REST.

## Anomalies covered

- **Edge thresholds (Rust sidecar)** — thermal throttle, memory pressure, XID errors, ECC double-bit, clock throttling, gradient-norm threshold.
- **Central statistical detectors** — z-score on loss / gradient / throughput / temperature, cross-node straggler detection, correlated failures, DiLoCo drift and divergence.
- **Phase 2 training detectors** — numeric instability (NaN/Inf in loss or grads), training stalled (step doesn't advance), loss plateau (slope ~0 after warmup), throughput regression vs. recent baseline.
- **Phase 3 monitoring policy engine** — user-defined thresholds with operators (`gt`, `gte`, `lt`, `lte`, `abs_gt`, `stale_for`), sustained-violation `for_seconds`, severity, cooldown, and optional node/job scope. Policies run over GPU, training, DiLoCo, and custom metrics.
- **Phase 5 alert lifecycle** — alerts move through `acknowledged` → `investigating` → `resolved` / `ignored`, with free-text notes per alert.
- **LLM diagnosis** — Claude proposes a root cause and one of seven recovery actions, with a deterministic local fallback when the API is unavailable.

## What the nanochat demo proves

The script wires up backend, dashboard, and an Apple Silicon sidecar with a real `job_id`, registers a "Nanochat MPS demo" job, and (optionally) launches `training/train_mps.py` to train a tiny GPT on MPS. A reviewer opens `/training` and sees the active run with live loss / grad-norm / throughput / MFU charts; `/nodes/node-0` shows live MPS utilization and Metal framebuffer; `/policies` shows the preset library plus the new custom-metric source; and `/alerts` collects anything the detectors raise. The script is idempotent — running it again with the backend already up will reuse the running services and just register a new job.

## What the Colab demo proves

The Training page includes a downloadable `solprobe_colab_t4_demo.ipynb` notebook. In Colab, select a T4 runtime, point `BACKEND_URL` at a public SolProbe backend, set the API key, and run all cells. The notebook trains a tiny PyTorch MLP and posts GPU/training batches to `/api/v1/metrics/batches`, so the dashboard shows a `Google Colab T4 tiny training` run without installing or running the Rust sidecar inside Colab.

## How to run

Prerequisites (one-time):

```bash
# Backend venv
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && cd ..

# Dashboard deps
cd dashboard && npm install && cd ..

# Rust toolchain (cargo on PATH)
```

Launch the demo:

```bash
make demo
```

Open `http://localhost:3000` and sign in with `solprobe-demo-key`.

For the Colab path, expose backend port `8000` with a tunnel or deployment, then download the notebook from `http://localhost:3000/colab/solprobe_colab_t4_demo.ipynb`.

To also run the MPS trainer (writes real training metrics into the mmap the sidecar reads):

```bash
SOLPROBE_DEMO_TRAIN=1 SOLPROBE_TRAIN_STEPS=300 bash scripts/demo_nanochat_solprobe.sh
```

The script logs each component to `.runs/<run_id>/{backend,dashboard,sidecar,training}.log` and prints the dashboard URLs when ready. No GPU is required — Apple Silicon (MPS) and CPU both work.

## Known limits

- Apple Silicon GPU temperature and power are not exposed by Metal, so those fields render as `—` instead of `0`.
- All state is in-memory; restarting the backend wipes alerts, diagnoses, jobs, and custom metrics. There is no Postgres persistence yet.
- Colab free GPU availability is best-effort; if Colab assigns CPU, the notebook still runs but reports zero GPU utilization.
- Custom metrics and Colab metrics batch ingest are REST paths; they don't flow through the sidecar/protobuf path.
- The Solana trust layer (4 Anchor programs for attestation, escrow, reputation, staking) is demo-stage — included to validate the design, not wired into the production reward loop.
- Local API-key auth protects REST and WebSocket control-plane surfaces. There is no multi-user RBAC yet.
- Diagnosis defaults to a local heuristic fallback if `ANTHROPIC_API_KEY` isn't set, so the demo runs without external network calls.
