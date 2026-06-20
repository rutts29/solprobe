# SolProbe

**Autonomous fault detection and recovery for distributed GPU training.**

SolProbe monitors distributed T4/L4 GPU training clusters in real-time, detects hardware and software anomalies before they cause failures, diagnoses root causes using an LLM agent, and records compute attestations on Solana for trust verification in decentralized training networks.

```
                    Training Cluster
                    +-----------+
                    | GPU Node  |  (T4 / L4)
                    |  Sidecar  | ---- Prometheus :9100
                    +-----+-----+
                          | gRPC stream
                          v
                    +-----+-----+
                    |  Backend  | ---- REST API :8000
                    | (FastAPI) | ---- WebSocket /ws/stream
                    |  +------+ | ---- Prometheus /metrics
                    |  | LLM  | |
                    |  | Agent | | ---> Claude API
                    |  +------+ |
                    +-----+-----+
                          |
              +-----------+-----------+
              |                       |
        +-----+-----+          +-----+-----+
        | Dashboard |          |  Solana   |
        | (Next.js) |          | Programs  |
        |   :3000   |          | (Anchor)  |
        +-----------+          +-----------+
```

## Why SolProbe?

Existing tools detect crashes after they happen. SolProbe catches **silent failures** — thermal throttling, gradient explosions, NCCL timeouts, ECC errors — and diagnoses root causes before training runs are lost.

| Tool | Detection | Diagnosis | On-chain Trust |
|------|-----------|-----------|----------------|
| torchft | Heartbeat (crash only) | None | None |
| TensorPool | Log-based | None | None |
| Neurox | Basic GPU monitoring | None | None |
| **SolProbe** | **Hybrid edge + central** | **LLM root cause analysis** | **Solana attestation** |

## Architecture

### Hybrid Anomaly Detection

- **Edge (Rust sidecar)**: Per-node threshold checks on GPU temp, memory, Xid errors, ECC, gradient norms. Instant detection (<1s latency).
- **Central (Python backend)**: Z-score statistical analysis, cross-node correlation (NCCL timeout = 2+ nodes with alerts in 30s), DiLoCo-specific detectors (sync drift, pseudo-gradient divergence, inner/outer loss divergence).

### Alert Taxonomy (14 types)

| Alert | Source | Severity | Trigger |
|-------|--------|----------|---------|
| thermal_throttle | Edge + Central | CRITICAL | gpu_temp > 85C |
| memory_pressure | Edge | CRITICAL | fb_used > 95% |
| xid_error | Edge | CRITICAL | xid_errors != 0 |
| ecc_error | Edge | CRITICAL | ecc_dbe > 0 |
| gradient_explosion | Edge + Central | CRITICAL | grad_norm > 100 |
| loss_spike | Central | CRITICAL | z-score > 3.0 |
| nccl_timeout | Central | CRITICAL | 2+ correlated nodes |
| straggler_detected | Central | WARNING | throughput < 80% mean |
| clock_throttle | Edge + Central | WARNING | throttle bitmask != 0 |
| diloco_sync_drift | Central | WARNING | sync > 2x historical |
| pseudo_grad_divergence | Central | WARNING | cross-worker z > 3 |
| inner_outer_divergence | Central | CRITICAL | inner loss down + outer loss up for 3+ steps |

### LLM Diagnosis Agent

When CRITICAL alerts fire, the diagnosis agent:
1. Enriches the alert with +/-2 min metrics context, 10 prior alerts, correlated events
2. Queries past diagnoses for similar incidents (simple RAG)
3. Calls Claude API with structured tool_use output
4. Returns: root cause classification, confidence score, evidence chain, recommended recovery action

**7 Recovery Actions**: `restart_from_checkpoint`, `reassign_workload`, `reduce_batch_size`, `exclude_node`, `skip_corrupted_shard`, `increase_timeout`, `rollback_lr`

### Solana Trust Layer

4 Anchor programs for decentralized compute verification:

- **Attestation**: Workers submit checkpoint hashes + GPU metadata; verifiers confirm integrity
- **Escrow**: Job creators deposit SOL; released to workers on completion or slashed on failure
- **Reputation**: On-chain worker profiles with completion rate, failure count, stake slashed
- **Staking**: Workers stake SOL as collateral; slashable for misbehavior with cooldown-protected unstaking

## Project Structure

```
solprobe/
  sidecar/          Rust metrics sidecar (tonic, prost, tokio)
  backend/          FastAPI backend (gRPC, REST, WebSocket, detectors)
    app/diagnosis/  LLM diagnosis agent (Claude API, recovery actions)
  dashboard/        Next.js 15 real-time dashboard (Tailwind, Recharts)
  solana/           4 Anchor programs (anchor-lang 0.32.1)
  training/         PyTorch callbacks + Colab REST client + simulator
  proto/            Shared Protobuf schemas
  infra/            Helm chart, Terraform (GKE), Ansible, Grafana
  scripts/          E2E test, deploy/teardown scripts
```

## Quick Start

### Prerequisites

- Rust 1.94+, Python 3.12+, Node 22+
- protoc (`brew install protobuf`)
- Solana CLI 3.x + Anchor CLI 0.30.1 (with anchor-lang 0.32.1) (for Solana programs)

### 1. One-command demo

```bash
make demo
# Open http://localhost:3000 and sign in with solprobe-demo-key
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
export SOLPROBE_API_KEY="solprobe-demo-key"
uvicorn app.main:app --port 8000
```

### 3. Sidecar (Simulation Mode)

```bash
cd sidecar
cargo run -- --simulate --node-id node-0
```

### 4. Dashboard

```bash
cd dashboard
npm install && npm run dev
# Open http://localhost:3000
```

### 5. Google Colab T4 Demo

The dashboard includes a bundled notebook at `/colab/solprobe_colab_t4_demo.ipynb`.
Expose the backend on a public URL, open the notebook in Colab, select a T4 runtime, set `BACKEND_URL` and `API_KEY`, and run all cells. The notebook trains a tiny PyTorch model and streams GPU/training telemetry over REST to `/api/v1/metrics/batches`.

See `docs/colab.md` for the full flow.

### 6. LLM Diagnosis (Optional)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Restart backend — auto-diagnosis loop activates for CRITICAL alerts
```

### 7. Fault Injection

```bash
cd sidecar
cargo run -- --simulate --node-id node-0 --inject-fault thermal_throttle
# Available faults: thermal_throttle, xid_79, gradient_explosion,
#                   nccl_timeout, memory_pressure
```

### 8. Solana Programs

```bash
cd solana
anchor build
anchor test  # runs on localnet
```

### 9. E2E Integration Test

```bash
./scripts/e2e_test.sh
# Starts backend + sidecar, validates data flow, fault injection, alerts
```

## Test Suite

| Component | Tests | Command |
|-----------|-------|---------|
| Rust sidecar | 32 | `cd sidecar && cargo test` |
| Python backend | 294 | `cd backend && python -m pytest tests/ -v` |
| Dashboard regression | 4 | `cd dashboard && npm test` |
| Solana programs | 21 | `cd solana && anchor test` |
| E2E integration | 10 | `./scripts/e2e_test.sh` |
| **Total** | **361** | |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check + connected sidecars count |
| GET | `/api/v1/nodes` | List connected nodes with latest metrics |
| GET | `/api/v1/nodes/{id}/metrics` | Historical metrics for a node |
| POST | `/api/v1/metrics/batches` | REST metrics ingest for Colab/non-sidecar clients |
| GET | `/api/v1/alerts` | Query alerts (filter by severity, type, node) |
| GET | `/api/v1/alerts/{id}/enriched` | Alert with full metrics context |
| GET | `/api/v1/diagnoses` | Query diagnoses |
| POST | `/api/v1/diagnoses` | Manually trigger diagnosis for an alert |
| WS | `/ws/stream` | Real-time alerts, diagnoses, metric summaries |
| GET | `/metrics` | Prometheus metrics |

## Infrastructure

The `infra/` directory contains production-ready IaC:

- **Helm chart**: Parameterized templates for backend, sidecar (DaemonSet), dashboard
- **Terraform**: GKE private cluster with T4/L4 GPU node pools, least-privilege IAM
- **Ansible**: GPU node provisioning (NVIDIA drivers, DCGM, container toolkit)
- **Grafana**: Pre-built dashboards for GPU metrics, training metrics, alert overview

## Key Ports

| Port | Service |
|------|---------|
| 3000 | Next.js dashboard |
| 8000 | FastAPI backend (REST + /metrics) |
| 9100 | Sidecar Prometheus exporter |
| 50051 | gRPC (sidecar to backend) |

## Local Development (Apple Silicon)

SolProbe runs fully on Apple Silicon Macs for local development and testing — no cloud GPU required.

### Apple Silicon GPU Monitoring

```bash
cd sidecar
cargo run -- --apple-gpu --node-id node-mac
# Reads real GPU metrics via IOKit: utilization, Metal memory, renderer/tiler activity
```

The `--apple-gpu` collector maps Apple Silicon's unified memory model to SolProbe's metric schema:
- `Device Utilization %` → `gpu_utilization_pct`
- `In use system memory` → `fb_used_mb` (Metal GPU allocations, not total RAM)
- `Renderer Utilization %` → `sm_active_pct`
- `Tiler Utilization %` → `tensor_active_pct`

### MPS Training Demo

```bash
cd training && python3 -m venv .venv && .venv/bin/pip install torch
cd .. && training/.venv/bin/python -m training.train_mps --steps 30
# TinyGPT (~867K params) training on Metal Performance Shaders
# SolProbe callback writes metrics to shared memory for sidecar integration

# Test with anomaly injection:
training/.venv/bin/python -m training.train_mps --steps 30 --inject-spike-at 5
```

### Architecture Explorer

Open `solprobe-playground.html` in a browser for an interactive visualization of the full system architecture.

## GPU Scope

SolProbe targets **T4** (Turing, 16GB GDDR6) and **L4** (Ada Lovelace, 24GB GDDR6) in production. The Apple Silicon collector enables local development on M-series Macs. No NVLink, no HBM, no MIG — those require different detection strategies.

## License

MIT
