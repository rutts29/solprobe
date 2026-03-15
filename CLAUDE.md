# SolProbe — Project Context

## Overview
SolProbe is an autonomous fault detection and recovery system for distributed AI training.
Portfolio project targeting MTS Full-Stack role at Prime Intellect.

## Current Status — ALL 6 SUB-PROJECTS COMPLETE

| SP | Component | Status | Key Stats |
|----|-----------|--------|-----------|
| SP-1 | Rust Metrics Sidecar | Done | 25 Rust tests, 0 warnings, simulator + fault injection |
| SP-2 | FastAPI Backend | Done | 127 Python tests, gRPC + REST + WebSocket, central detectors |
| SP-3 | LLM Diagnosis Agent | Done | Claude API, 7 recovery actions, rate limiter, RAG |
| SP-4 | Next.js Dashboard | Done | 55 files, 4 pages, real-time WebSocket, Recharts |
| SP-5 | K8s + IaC | Done | Helm chart, Terraform (GKE), Ansible, Grafana dashboards |
| SP-6 | Solana Trust Layer | Done | 4 Anchor programs (attestation, escrow, reputation, staking) |

## Remaining Work (Polish / Demo)
- Full-stack smoke test (sidecar + backend + dashboard together)
- `anchor test` on localnet for SP-6
- README.md with architecture diagram + setup instructions
- GCP T4/L4 validation (optional, needs cloud access)
- Demo recording

## Architecture
- **Anomaly detection**: Hybrid — edge thresholds in Rust sidecar, statistical/cross-node in Python backend
- **Training metrics**: PyTorch callback + mmap shared memory (37-byte training, 46-byte DiLoCo)
- **Transport**: gRPC bidirectional streaming (tonic in Rust, grpcio in Python)
- **LLM Diagnosis**: Claude API with tool_use structured output, 7 recovery actions, per-node rate limiting
- **Storage**: Prometheus + TSDB (in-memory stores for alerts/diagnoses)
- **GPU scope**: T4/L4 only (no NVLink, HBM, MIG)
- **Solana**: 4 Anchor programs — compute attestation, job escrow, worker reputation, stake/slash

## Monorepo Structure
- `sidecar/` — Rust metrics sidecar (tonic/prost/tokio, anchor-lang for Solana)
- `backend/` — FastAPI backend (grpcio, prometheus-client, numpy, anthropic)
- `backend/app/diagnosis/` — LLM diagnosis agent (Claude API, recovery actions, RAG)
- `proto/` — Shared Protobuf schemas (metrics.proto, alerts.proto)
- `training/` — PyTorch callbacks + standalone simulator
- `dashboard/` — Next.js 15 App Router (TypeScript, Tailwind, shadcn/ui, Recharts)
- `solana/` — Anchor workspace with 4 programs (anchor-lang 0.32.1)
- `infra/` — K8s manifests, Helm chart, Terraform, Ansible, Prometheus/Grafana
- `scripts/` — E2E test script, deploy/teardown scripts
- `docs/` — Design specs and plans for all SPs

## Development Commands
```bash
# Rust sidecar
source ~/.cargo/env && cd sidecar && cargo build
cargo test                              # 25 tests
cargo run -- --simulate --node-id node-0

# Python backend (127 tests)
cd backend && source .venv/bin/activate
pip install -e ".[dev]"
python -m pytest tests/ -v
uvicorn app.main:app --port 8000

# Training simulator (no PyTorch needed)
python -m training.simulate --scenario normal --duration 60

# Next.js dashboard
cd dashboard && npm install && npm run dev  # :3000

# Solana programs
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd solana && anchor build                    # compile all 4 programs
anchor test                                  # run TypeScript tests on localnet

# Docker
docker compose up --build

# E2E test
./scripts/e2e_test.sh

# K8s (Helm)
helm install solprobe infra/helm/solprobe -n solprobe

# Terraform
cd infra/terraform && terraform init && terraform plan
```

## Key Ports
- 3000: Next.js dashboard
- 8000: FastAPI backend (REST + /metrics)
- 9100: Rust sidecar Prometheus exporter
- 9090: Prometheus
- 50051: gRPC (sidecar → backend)

## Toolchain Versions
- Rust: 1.94.0, rust-analyzer 1.94.0
- Solana CLI: 3.1.11 (Agave)
- Anchor CLI: 0.30.1, anchor-lang: 0.32.1
- Python: 3.14.3, pyright 1.1.408
- Node: 24.14.0, yarn 1.22.22
- protoc: installed via brew

## Preferences
- NEVER add Co-Authored-By lines to commit messages
- No attribution lines in any commits

## Research Notes

### DCGM Metrics for T4/L4
- T4: Turing (TU104), 16GB GDDR6, 70W TDP, PCIe Gen3 x16, no NVLink, page retirement
- L4: Ada Lovelace (AD104), 24GB GDDR6, 72W TDP, PCIe Gen4 x16, no NVLink, row remapping
- Key DCGM fields: GPU_TEMP, GPU_UTIL, FB_USED/FREE, POWER_USAGE, XID_ERRORS, CLOCK_THROTTLE_REASONS, ECC errors, PCIe replay

### Competitor Analysis
- **torchft**: Heartbeat-based fault tolerance — no training metrics monitoring
- **TensorPool**: Log-based detection — cannot detect silent failures (SolProbe's differentiator)
- **EigenLayer**: TEE attestation + Solidity slashing — Ethereum-only, no Solana equivalent
- **TOPLOC**: Binary proof format for inference verification — training is future work
