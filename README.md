# SolProbe

**Training observability, anomaly detection, and diagnosis.**

[![CI](https://github.com/rutts29/solprobe/actions/workflows/ci.yml/badge.svg)](https://github.com/rutts29/solprobe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

SolProbe brings training metrics, GPU telemetry, and alerts into one dashboard so you can investigate unstable or stalled runs. A Rust sidecar collects signals, a FastAPI service detects faults and evaluates monitoring policies, and a Next.js dashboard presents the evidence and recovery suggestions.

Start with the Apple Silicon collector or the built-in fault simulator. The simulator exercises thermal, memory, gradient, XID, and timeout scenarios without a GPU. The [bundled TinyGPT walkthrough](SHOWCASE.md) adds real training telemetry from PyTorch.

## What it does

- **Collects training signals.** Loss, gradient norm, learning rate, throughput, and custom metrics arrive through a PyTorch callback or authenticated REST batches. The Apple Silicon collector adds GPU utilization and memory usage.
- **Finds changes that matter.** Threshold and statistical detectors cover numeric instability, stalled steps, loss plateaus, throughput regression, stragglers, and DiLoCo drift.
- **Makes alerts actionable.** Each finding carries its metrics and context. Monitoring policies support sustained thresholds, cooldowns, severity, and node or job scope. Alerts can be acknowledged, investigated, resolved, or ignored, with notes.
- **Supports diagnosis.** The Anthropic integration turns alert context into a structured root-cause explanation and recommended recovery action. Local heuristics handle selected API-error and rate-limit cases. Detection and alert investigation work without an LLM key.
- **Keeps the workflow visible.** The dashboard shows nodes, training jobs, policies, alerts, and diagnoses; WebSocket updates and Prometheus endpoints expose the same monitoring activity.

## Run locally

Use Python 3.11+, Node.js 24, a Rust toolchain, and the Protocol Buffers compiler (`protoc`). Run the following from the repository root:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev]'
backend/.venv/bin/python -m grpc_tools.protoc \
  -I proto \
  --python_out=backend/app/generated \
  --pyi_out=backend/app/generated \
  --grpc_python_out=backend/app/generated \
  proto/metrics.proto proto/alerts.proto
npm --prefix dashboard ci --ignore-scripts
```

Start the backend in one terminal:

```bash
cd backend
SOLPROBE_API_KEY=solprobe-demo-key .venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 --port 8000
```

From the repository root, start the dashboard in a second terminal:

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/stream \
npm --prefix dashboard run dev -- --hostname 127.0.0.1
```

Start a simulated node in a third terminal, also from the repository root:

```bash
cargo run --manifest-path sidecar/Cargo.toml -- \
  --simulate --node-id node-0 --inject-fault thermal_throttle
```

Open [localhost:3000](http://localhost:3000) and enter `solprobe-demo-key`. Inspect the node metrics and the thermal alert. On an Apple Silicon Mac, replace `--simulate --inject-fault thermal_throttle` with `--apple-gpu` to collect the host's GPU metrics.

The demo uses in-memory state, which resets when the backend stops. Keep these local services on a trusted machine; the shared demo key is for local use. See [configuration](docs/configuration.md) for ports, authentication, and optional diagnosis setup.

## How it fits together

```text
PyTorch callback                       Apple Silicon / fault simulator
       | shared memory                               |
       +-----------------> Rust sidecar <-------------+
                                |
                               gRPC
                                v
REST training clients --> FastAPI detectors and policies
                                |
                     alerts and diagnosis context
                                |
                        REST + WebSocket
                                v
                         Next.js dashboard
```

REST batches can also enter the backend directly. The sidecar exports Prometheus metrics on port 9100; the backend exports its monitoring metrics at `/metrics`.

| Component | Responsibility |
| --- | --- |
| [`sidecar/`](sidecar/) | Collection, fault simulation, threshold checks, gRPC and Prometheus |
| [`backend/`](backend/) | Statistical detectors, monitoring policies, alert lifecycle, diagnoses and API |
| [`dashboard/`](dashboard/) | Nodes, training jobs, alerts, policies and investigation UI |
| [`training/`](training/) | PyTorch callback, bundled TinyGPT trainer, REST client and simulation |
| [`proto/`](proto/) | Shared metric and alert schemas |

## Tests

The test suites cover detector behavior, policies, alert lifecycle, API authentication, stores, diagnosis responses, telemetry handling, and dashboard regressions. Diagnosis tests use mocked provider responses.

[CI](https://github.com/rutts29/solprobe/actions/workflows/ci.yml) builds and tests the Rust sidecar and Python backend, then lints and builds the dashboard. The [September 7 run](https://github.com/rutts29/solprobe/actions/runs/34164106539) passed 296 backend tests and 31 Rust tests on Linux. See [development and test commands](docs/development.md) to run the suites locally.

## Further directions

NVIDIA/DCGM collection, persistent storage, multi-user access, and deployment across multiple hosts are natural extensions of the monitoring stack. The repository also contains [Colab ingestion](docs/colab.md) and [compute verification experiments](solana/README.md) that explore other sources of telemetry and evidence.

## About the project

Built to explore how training failures can be detected and investigated from telemetry. Shared for others to run, study and adapt.

## License

[MIT](LICENSE). Copyright (c) 2026 Ruttansh Bhatelia.
