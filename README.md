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
  training/         PyTorch callbacks + standalone simulator
  proto/            Shared Protobuf schemas
  infra/            Helm chart, Terraform (GKE), Ansible, Grafana
  scripts/          E2E test, deploy/teardown scripts
```

## Quick Start

### Prerequisites

- Rust 1.70+, Python 3.11+, Node 20+
- protoc (`brew install protobuf`)
- Solana CLI 3.x + Anchor CLI 0.30.x (for Solana programs)

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --port 8000
```

### 2. Sidecar (Simulation Mode)

```bash
cd sidecar
cargo run -- --simulate --node-id node-0
```

### 3. Dashboard

```bash
cd dashboard
npm install && npm run dev
# Open http://localhost:3000
```

### 4. LLM Diagnosis (Optional)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Restart backend — auto-diagnosis loop activates for CRITICAL alerts
```

### 5. Fault Injection

```bash
cd sidecar
cargo run -- --simulate --node-id node-0 --inject-fault thermal_throttle
# Available faults: thermal_throttle, xid_79, gradient_explosion,
#                   nccl_timeout, memory_pressure
```

### 6. Solana Programs

```bash
cd solana
anchor build
anchor test  # runs on localnet
```

### 7. E2E Integration Test

```bash
./scripts/e2e_test.sh
# Starts backend + sidecar, validates data flow, fault injection, alerts
```

## Test Suite

| Component | Tests | Command |
|-----------|-------|---------|
| Rust sidecar | 25 | `cd sidecar && cargo test` |
| Python backend | 127 | `cd backend && python -m pytest tests/ -v` |
| Solana programs | 15 | `cd solana && anchor test` |
| E2E integration | 10 | `./scripts/e2e_test.sh` |
| **Total** | **177** | |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check + connected sidecars count |
| GET | `/api/v1/nodes` | List connected nodes with latest metrics |
| GET | `/api/v1/nodes/{id}/metrics` | Historical metrics for a node |
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

## GPU Scope

SolProbe targets **T4** (Turing, 16GB GDDR6) and **L4** (Ada Lovelace, 24GB GDDR6) — the GPUs commonly used in cost-efficient distributed training. No NVLink, no HBM, no MIG — those require different detection strategies.

## License

MIT
