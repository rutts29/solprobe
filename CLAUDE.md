# SolProbe — Project Context

## Overview
SolProbe is an autonomous fault detection and recovery system for distributed AI training.
Portfolio project targeting MTS Full-Stack role at Prime Intellect.

## Architecture Decisions
- **Sub-project order**: SP-1 (Rust sidecar) + SP-2 (FastAPI backend) → SP-3 (LLM Agent) → SP-4 (Dashboard) → SP-5 (K8s/IaC) → SP-6 (Solana)
- **Anomaly detection**: Hybrid — edge thresholds in Rust sidecar, statistical/cross-node in Python backend
- **Training metrics**: PyTorch callback + mmap shared memory (binary format: 37-byte training, 46-byte DiLoCo)
- **Transport**: gRPC bidirectional streaming (tonic in Rust, grpcio in Python)
- **Storage**: Prometheus + TSDB
- **GPU scope**: T4/L4 only (no NVLink, HBM, MIG)

## Current Status
- **SP-1 + SP-2: COMPLETE** — Rust sidecar compiles (0 warnings), FastAPI backend runs, 25 Rust tests + 55 Python tests passing, Docker Compose verified, E2E test script at scripts/e2e_test.sh
- **SP-3: LLM Diagnosis Agent** — next up
- **SP-4–SP-6**: not started

## Monorepo Structure
- `sidecar/` — Rust metrics sidecar (cargo workspace, tonic/prost/tokio)
- `backend/` — FastAPI backend (grpcio, prometheus-client, numpy)
- `proto/` — Shared Protobuf schemas (metrics.proto, alerts.proto)
- `training/` — PyTorch callbacks + standalone simulator
- `scripts/` — E2E test script
- `infra/` — Prometheus config
- `docs/` — Design specs

## Development Commands
```bash
# Rust sidecar
source ~/.cargo/env && cd sidecar && cargo build
cargo test                              # 25 tests
cargo run -- --simulate --node-id node-0

# Python backend
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
make proto-gen                          # generate Python proto stubs
uvicorn app.main:app --port 8000 --app-dir backend
cd backend && python -m pytest tests/ -v  # 55 tests

# Training simulator (no PyTorch needed)
python -m training.simulate --scenario normal --duration 60

# Docker
docker compose up --build

# E2E test
./scripts/e2e_test.sh
```

## Key Ports
- 8000: FastAPI backend (REST + /metrics)
- 9100: Rust sidecar Prometheus exporter
- 9090: Prometheus
- 50051: gRPC (sidecar → backend)

## Preferences
- NEVER add Co-Authored-By lines to commit messages
- No attribution lines in any commits

## Research Notes

### DCGM Metrics for T4/L4
- T4: Turing (TU104), 16GB GDDR6, 70W TDP, PCIe Gen3 x16, no NVLink, page retirement
- L4: Ada Lovelace (AD104), 24GB GDDR6, 72W TDP, PCIe Gen4 x16, no NVLink, row remapping
- Key DCGM fields: GPU_TEMP, GPU_UTIL, FB_USED/FREE, POWER_USAGE, XID_ERRORS, CLOCK_THROTTLE_REASONS, ECC errors, PCIe replay
- Exclude: NVLink, HBM, MIG, NVSwitch metrics

### Competitor Analysis
- **torchft**: Heartbeat-based fault tolerance, Protobuf schema (QuorumMember, ShouldCommit) — no training metrics monitoring
- **TensorPool**: Log-based detection — cannot detect silent failures (their admitted gap, SolProbe's differentiator)
- **Neurox**: Dashboard product, no public schemas, K8s-focused
- **dcgm-exporter**: CSV-configured Prometheus metrics, no alerting
- **EigenLayer**: TEE attestation + Solidity slashing — Ethereum-only, no Solana equivalent
- **TOPLOC**: Custom binary proof format (258 bytes/window), polynomial interpolation of top-k activations — inference only, training is future work
