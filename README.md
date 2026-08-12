# SolProbe

**A local observability prototype for AI-training telemetry and anomaly workflows.**

SolProbe combines a Rust sidecar, FastAPI backend, and Next.js dashboard to collect training signals, detect anomalous conditions, and present evidence and recovery suggestions. Its locally verified paths are Apple Silicon collection and simulated fault injection; NVIDIA/DCGM collection, cloud deployment, live Anthropic calls, Google Colab, and on-chain submission are prototype or unverified work.

## Current evidence

The following commands were run locally on 2026-08-12:

| Component | Result | Command |
|---|---:|---|
| Rust sidecar | 32 passed | `cd sidecar && cargo test` |
| Python backend | 296 passed, 1 deprecation warning | `backend/.venv/bin/python -m pytest backend/tests/ -q` |
| Dashboard regression | 14 passed | `cd dashboard && npm test` |
| Dashboard type check | passed | `cd dashboard && npx tsc --noEmit` |
| Dashboard lint | passed | `cd dashboard && npm run lint` |

The repository contains 21 Anchor test cases and an end-to-end script, but neither was run for this evidence snapshot. The diagnosis tests mock Anthropic; no live Anthropic request was made. The bundled Colab notebook is included as source and has no recorded execution outputs.

## What is implemented

```text
sidecar/      Rust collector, threshold detectors, Prometheus exporter, gRPC transport
backend/      FastAPI REST/gRPC/WebSocket service, detectors, policies, in-memory stores
dashboard/    Next.js operations UI for nodes, alerts, policies, diagnoses, and jobs
training/     PyTorch callback, local MPS TinyGPT demo, and metric simulator
proto/        Shared Protobuf schemas
solana/       Four Anchor-program prototypes
infra/        Terraform, Helm, Kubernetes, Ansible, and Grafana deployment artifacts
```

The backend exposes metric ingestion, node and alert queries, alert lifecycle actions, jobs, policies, custom metrics, diagnoses, Prometheus metrics, and a WebSocket stream. State is in memory and is lost on restart.

### Locally verified paths

- **Apple Silicon sidecar:** reads macOS IOKit metrics such as utilization and unified-memory usage.
- **Simulation:** produces repeatable GPU/training telemetry and fault injections for thermal, memory, XID, gradient, and timeout conditions.
- **Training telemetry:** the bundled TinyGPT MPS trainer is designed to write loss, gradient, throughput, and learning-rate data to the sidecar's memory-mapped interface; this end-to-end path was not run for the evidence snapshot.
- **Backend workflows:** detector, policy, alert lifecycle, REST, gRPC, and WebSocket behavior are covered by the local test suite above.

### Prototype and unverified boundaries

- `sidecar/src/collectors/dcgm.rs` is a stub. Do not represent T4/L4, NVIDIA/DCGM, NVML, or multi-node production monitoring as verified.
- The Anthropic client and structured diagnosis code exist, but live external calls have not been verified. The local demo uses deterministic fallback diagnoses without an API key.
- The Colab notebook can post REST batches when configured with a publicly reachable backend, but that flow has not been run for this release snapshot.
- The Solana directory contains attestation, escrow, reputation, and staking programs. The FastAPI backend has no attestation endpoint or Solana client, and the dashboard's attestation page uses clearly labeled sample data.
- Terraform, Helm, Kubernetes, Ansible, and Grafana files are deployment artifacts, not evidence of a deployed or production-ready service.
- API-key authentication is local control-plane protection only; there is no multi-user role-based access control or persistent database.

## Local demo

Prerequisites: Rust, Python 3.11+, Node.js, and `protoc`. Apple Silicon is required for the IOKit/MPS path; simulation does not require a GPU.

Run a repeatable simulated sidecar:

```bash
cd sidecar
cargo run -- --simulate --node-id node-0 --inject-fault thermal_throttle
```

Run the Apple Silicon collector on macOS:

```bash
cd sidecar
cargo run -- --apple-gpu --node-id node-mac
```

The project launcher is intended to start the local dashboard, backend, and Apple Silicon sidecar:

```bash
make demo
```

It uses the local demo API key unless `SOLPROBE_API_KEY` is supplied. This is a development convenience, not a public deployment flow.

To exercise the small bundled trainer, install PyTorch in a local environment and run:

```bash
cd training
python3 -m venv .venv
.venv/bin/pip install torch
cd ..
training/.venv/bin/python -m training.train_mps --steps 30 --inject-spike-at 5
```

## Nanochat integration boundary

SolProbe's repository contains its own `training/train_mps.py` TinyGPT demonstration. The optional `SOLPROBE_DEMO_TRAIN=1` path expects a separately maintained, patched Nanochat checkout at `.worktrees/nanochat-solprobe`, containing `runs/run_solprobe_mps_smoke.sh`.

That checkout is not tracked by this repository or the sibling upstream `nanochat-solprobe` clone, so a fresh SolProbe clone cannot reproduce the Nanochat path without separately obtaining the pinned integration branch. Treat the Nanochat hook as local prototype work until it is published as a documented fork or pinned patch.

## Request a technical demo

The two static landing copies, `landing/index.html` and `dashboard/public/landing.html`, contain the same request-demo form. On the canonical Vercel landing deployment, it posts to `landing/api/request-demo.js`; when served by the Next.js dashboard, it posts to `dashboard/src/app/api/request-demo/route.ts`. Both use Resend's email API from the serverless runtime. No email-provider credential or recipient address is exposed to the browser.

Configure these Vercel environment variables for the landing project, without committing values:

```text
RESEND_API_KEY=
REQUEST_DEMO_TO_EMAIL=
REQUEST_DEMO_FROM_EMAIL=
```

`landing/.env.example` provides the same blank keys for local Vercel development.

`REQUEST_DEMO_FROM_EMAIL` must be a sender address from a domain verified in Resend. The submitted payload contains a required email, optional name/role/interest, and a hidden `botcheck` honeypot. The endpoint validates input, silently accepts honeypot submissions, and returns clear success or error states without logging request contents. Until those Vercel variables are configured, the form responds that demo requests are not configured; it does not use a public key or a hard-coded email fallback.

## API surface

| Path | Purpose |
|---|---|
| `GET /api/v1/health` | Backend health and sidecar count |
| `POST /api/v1/metrics/batches` | REST metrics batch ingest |
| `GET /api/v1/nodes` | Node status and metric history |
| `GET /api/v1/alerts` | Alert query and filtering |
| `POST /api/v1/diagnoses` | Manual diagnosis workflow |
| `GET/POST/PATCH /api/v1/policies` | Monitoring-policy management |
| `WS /ws/stream` | Realtime alerts, diagnoses, and summaries |
| `GET /metrics` | Prometheus metrics |

## Source and release hygiene

- Never add local `.env`, `.runs`, browser logs, `.claude`, `.codex`, or `design-dashboard/` content to a public release without an explicit review.
- The landing page labels its dashboard preview and attestation information as sample data.
- No `LICENSE` file is currently included. The owner must choose and add a license before making the repository public.
