# SolProbe — SP-1 + SP-2: Metrics Foundation Implementation Plan

## Context

SolProbe is an autonomous fault detection and recovery system for distributed AI training. This plan covers **SP-1 (Rust Metrics Sidecar)** and **SP-2 (FastAPI Backend)** — the foundational data pipeline that everything else depends on.

**Problem:** GPU training failures happen every 3 hours at 16K scale. Existing tools (TensorPool, Neurox) detect crashes from logs but cannot detect silent failures (gradient divergence, NCCL hangs, loss plateaus). No tool understands DiLoCo-specific failure modes.

**What we're building:** A metrics pipeline that collects GPU + training telemetry → detects anomalies (hybrid edge/central) → streams alerts via gRPC → exposes REST API + WebSocket for downstream consumers (dashboard, LLM agent, Solana layer — all future sub-projects).

**Target hardware:** GCP T4/L4 GPUs (no NVLink, no HBM, no MIG).

---

## Design Decisions (Validated)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sub-project order | SP-1 + SP-2 first | Everything depends on the metrics pipeline |
| Repo structure | Monorepo | Easier dependency management for solo project |
| Anomaly detection | Hybrid (Rust edge + Python central) | Edge handles instant hardware faults; central handles statistical/cross-node patterns |
| Training metrics capture | PyTorch callback + shared memory | Minimal training code intrusion |
| Sidecar → backend transport | gRPC bidirectional streaming | Type-safe, low-latency; demonstrates "high-performance networking" from JD |
| Time-series storage | Prometheus + TSDB | Already in JD stack; standard observability pattern |
| GPU scope | T4/L4 only | Hardware we can actually test on; extensible later |

---

## Architecture

```
PER GPU NODE:
┌──────────────────────────────────────────────────────┐
│  RUST SIDECAR (solprobe-sidecar)                     │
│                                                      │
│  Collectors:           Edge Detectors:                │
│  ├─ DCGM (T4/L4)      ├─ temp > 85°C                │
│  ├─ Training (shm)     ├─ memory > 95%               │
│  └─ DiLoCo sync        ├─ Xid error != 0             │
│                        ├─ NCCL timeout                │
│  Metric Normalizer     └─ clock throttle (bitmask)    │
│  └─ T4/L4 profiles                                   │
│                                                      │
│  Output: gRPC stream (tonic) + Prometheus :9100       │
└──────────────────────┬───────────────────────────────┘
                       │ gRPC (protobuf)
CENTRAL:               │
┌──────────────────────┴───────────────────────────────┐
│  FASTAPI BACKEND (solprobe-api)                      │
│                                                      │
│  ├─ gRPC server (receives N sidecar streams)         │
│  ├─ Central detectors (z-score, cross-node, DiLoCo)  │
│  ├─ Alert enrichment (context, history, correlation) │
│  ├─ REST API (/api/v1/...)                           │
│  └─ WebSocket hub (/ws/stream)                       │
└──────────────────────────────────────────────────────┘
         │
         ▼
  Prometheus (scrapes sidecar + backend)
```

---

## Monorepo Structure

```
solprobe/
├── sidecar/                     # Rust (cargo workspace)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── collectors/
│       │   ├── mod.rs
│       │   ├── dcgm.rs          # DCGM bindings (T4/L4 metrics)
│       │   ├── training.rs      # Shared memory reader
│       │   └── diloco.rs        # DiLoCo sync state
│       ├── detectors/
│       │   ├── mod.rs
│       │   └── threshold.rs     # Edge threshold rules
│       ├── normalizer.rs        # GPU profile abstraction
│       ├── transport/
│       │   ├── grpc.rs          # tonic gRPC client
│       │   └── prometheus.rs    # metrics exporter
│       ├── simulator.rs         # --simulate mode
│       └── config.rs
├── backend/                     # Python (FastAPI + uv)
│   ├── pyproject.toml
│   └── app/
│       ├── main.py
│       ├── grpc_server.py       # Receives sidecar streams
│       ├── detectors/
│       │   ├── zscore.py        # Statistical anomaly detection
│       │   ├── cross_node.py    # Cross-node correlation
│       │   └── diloco.py        # DiLoCo-specific patterns
│       ├── enrichment.py        # Alert context builder
│       ├── api/
│       │   ├── routes.py        # REST endpoints
│       │   └── websocket.py     # WS hub
│       └── models/
│           ├── metrics.py       # Pydantic schemas
│           └── alerts.py
├── proto/                       # Shared Protobuf definitions
│   ├── metrics.proto
│   └── alerts.proto
├── training/                    # PyTorch callback + simulator
│   ├── callback.py              # Shared memory writer
│   └── simulate.py              # Fake training metrics
├── docker-compose.yml           # Sidecar + backend + Prometheus
├── Makefile
└── README.md
```

---

## Protobuf Schemas (T4/L4 Focused)

### metrics.proto — Based on real DCGM field IDs for T4/L4

Key DCGM metrics to collect (excludes NVLink, HBM, MIG):
- `DCGM_FI_DEV_GPU_TEMP`, `DCGM_FI_DEV_MEMORY_TEMP` — temperature
- `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_MEM_COPY_UTIL` — utilization
- `DCGM_FI_DEV_FB_USED`, `DCGM_FI_DEV_FB_FREE` — memory
- `DCGM_FI_DEV_POWER_USAGE` — power
- `DCGM_FI_DEV_XID_ERRORS` — error codes
- `DCGM_FI_DEV_ECC_SBE_VOL_TOTAL`, `DCGM_FI_DEV_ECC_DBE_VOL_TOTAL` — ECC
- `DCGM_FI_DEV_CLOCK_THROTTLE_REASONS` — throttle bitmask
- `DCGM_FI_DEV_PCIE_REPLAY_COUNTER` — PCIe health
- `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE`, `DCGM_FI_PROF_SM_ACTIVE` — profiling
- `DCGM_FI_PROF_PCIE_TX_BYTES`, `DCGM_FI_PROF_PCIE_RX_BYTES` — PCIe bandwidth

T4 specifics: page retirement (`DCGM_FI_DEV_RETIRED_SBE/DBE`).
L4 specifics: row remapping (`DCGM_FI_DEV_*_REMAPPED_ROWS`).

### alerts.proto — Edge alerts with severity + evidence

Modeled after torchft's Protobuf patterns. Alert types:
- `thermal_throttle`, `memory_pressure`, `xid_error`, `ecc_error`
- `nccl_timeout`, `gradient_explosion`, `loss_plateau`
- `diloco_sync_drift`, `straggler_detected`, `pseudo_grad_divergence`

### service.proto — gRPC service definition

```
service SolProbeService {
  rpc StreamMetrics(stream MetricsBatch) returns (StreamAck);
  rpc ReportAlert(Alert) returns (AlertAck);
  rpc Subscribe(NodeRegistration) returns (stream Command);
}
```

---

## Simulation Mode

For Mac development without GPUs:
- **`--simulate` flag** on sidecar: generates synthetic DCGM-like metrics (realistic T4 temperature curves 35-76°C, utilization patterns, occasional Xid errors)
- **`--inject-fault <type>`**: triggers specific edge detectors on demand (`thermal_throttle`, `nccl_timeout`, `gradient_explosion`, `xid_79`)
- **`simulate.py`**: Python script writing fake training metrics to shared memory
- **Replay mode**: record real T4/L4 metrics from GCP, replay locally

---

## Implementation Steps

### Step 1: Project Scaffold + Protobuf

Set up monorepo structure, Rust cargo workspace, Python project (uv), shared proto definitions.

**Files to create:**
- `Makefile` with targets: `proto-gen`, `build-sidecar`, `run-backend`, `dev`
- `proto/metrics.proto`, `proto/alerts.proto` with T4/L4-focused schemas
- `sidecar/Cargo.toml` with deps: `tonic`, `prost`, `tokio`, `prometheus`
- `backend/pyproject.toml` with deps: `fastapi`, `grpcio`, `uvicorn`, `prometheus-client`
- `docker-compose.yml` with services: sidecar, backend, prometheus

### Step 2: Rust Sidecar — Simulator + Collectors

Build the sidecar with simulation mode first (no real DCGM needed).

**Implementation order:**
1. `config.rs` — CLI args (`--simulate`, `--inject-fault`, `--node-id`, `--backend-addr`)
2. `simulator.rs` — generates realistic T4/L4 metrics (temperature curves, utilization patterns, fault injection)
3. `collectors/mod.rs` — trait `MetricCollector { fn collect(&self) -> MetricsBatch }`
4. `collectors/dcgm.rs` — real DCGM collection (stubbed initially, tested on GCP)
5. `collectors/training.rs` — shared memory reader for PyTorch callback metrics
6. `normalizer.rs` — GPU profile enum (T4/L4) with metric ranges and thresholds
7. `main.rs` — tokio runtime, collector loop at 1s intervals

### Step 3: Rust Sidecar — Edge Detection + gRPC

Add threshold-based anomaly detection and gRPC streaming.

**Implementation order:**
1. `detectors/threshold.rs` — configurable rules engine (temp > 85°C → CRITICAL, Xid != 0 → CRITICAL, memory > 95% → WARNING, clock_throttle bitmask check)
2. `transport/grpc.rs` — tonic client: `StreamMetrics` (1s batches), `ReportAlert` (immediate for edge alerts)
3. `transport/prometheus.rs` — expose metrics at `:9100/metrics` for Prometheus scraping
4. Integration: collector loop → normalizer → detector → (alert? → gRPC alert) → gRPC stream + prom export

### Step 4: PyTorch Training Callback

Build the training-side metrics writer.

**Files:**
- `training/callback.py` — PyTorch callback that writes loss, gradient norms, throughput, learning rate to shared memory (using `multiprocessing.shared_memory`)
- `training/simulate.py` — standalone script that writes fake training metrics (for testing without real training)
- `training/diloco_callback.py` — extension for DiLoCo-specific metrics (inner/outer step, pseudo-grad norms, sync duration)

### Step 5: FastAPI Backend — gRPC Server + Central Detection

Build the backend that receives sidecar streams and runs statistical detection.

**Implementation order:**
1. `app/grpc_server.py` — async gRPC server using `grpcio-tools` generated stubs. Receives `StreamMetrics` from N sidecars, stores in-memory ring buffer
2. `app/models/metrics.py` — Pydantic models mirroring Protobuf schemas
3. `app/models/alerts.py` — Alert model with severity, source (EDGE/CENTRAL), confidence, evidence map
4. `app/detectors/zscore.py` — rolling z-score anomaly detection over time windows (configurable: 5min, 15min, 1hr)
5. `app/detectors/cross_node.py` — compare metrics across nodes: straggler detection (throughput < 80% of mean), correlated failures
6. `app/detectors/diloco.py` — inner/outer loss divergence, pseudo-gradient norm drift, sync duration spikes
7. `app/enrichment.py` — when alert fires, attach: recent metrics window (±2min), node history, correlated events from other nodes

### Step 6: FastAPI Backend — REST API + WebSocket

Expose the data for dashboard and future LLM agent.

**Endpoints:**
- `GET /api/v1/health` — backend health + connected sidecar count
- `GET /api/v1/nodes` — list connected nodes with latest metrics
- `GET /api/v1/nodes/{node_id}/metrics` — historical metrics (query params: window, resolution)
- `GET /api/v1/alerts` — recent alerts (filterable by severity, type, node)
- `GET /api/v1/anomalies` — central detector findings with confidence scores
- `POST /api/v1/jobs` — register a training job (job_id, config, participating nodes)
- `WS /ws/stream` — real-time push of metrics + alerts to connected dashboards

### Step 7: Docker Compose + Prometheus

Wire everything together for local development.

**docker-compose.yml services:**
- `sidecar` — Rust binary with `--simulate` mode
- `backend` — FastAPI on `:8000`
- `prometheus` — scrapes sidecar `:9100` + backend `:8000/metrics`, config in `infra/prometheus.yml`
- `grafana` — optional, preconfigured dashboard for GPU metrics

### Step 8: Integration Testing + GCP Validation

- Local: Run full pipeline with simulated metrics, inject faults, verify alerts flow end-to-end
- GCP: Deploy sidecar on T4/L4 instance, verify real DCGM collection, stream to backend running locally or on another instance
- Record real T4 metrics for replay mode

---

## Verification Plan

### Local (Mac, simulated)
1. `make dev` → starts sidecar (simulated) + backend + prometheus
2. Sidecar generates T4-like metrics at 1s intervals
3. Verify gRPC stream arrives at backend: `curl localhost:8000/api/v1/nodes`
4. Inject fault: `--inject-fault thermal_throttle`
5. Verify edge alert appears: `curl localhost:8000/api/v1/alerts`
6. Verify central detector fires after sustained anomaly: `curl localhost:8000/api/v1/anomalies`
7. Connect WebSocket client, verify real-time push
8. Check Prometheus targets: `http://localhost:9090/targets`

### GCP (real T4/L4)
1. Deploy sidecar on GCP T4 instance (Docker or bare metal)
2. Run a real PyTorch training job with callback
3. Verify real DCGM metrics flow through the pipeline
4. Record metrics for replay mode
5. Stress test: simulate multi-node (multiple sidecar instances with different node IDs)

### Unit/Integration Tests
- Sidecar: Rust tests for each collector, detector, and normalizer
- Backend: pytest for each detector, API endpoint, and WebSocket handler
- Proto: verify Rust (prost) and Python (grpcio) both compile and are compatible
- E2E: docker-compose based test that verifies full pipeline
