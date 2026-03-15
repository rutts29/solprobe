# SolProbe — Next Steps Plan (Post SP-1 + SP-2 Implementation)

## What's Done
- Rust sidecar: compiles, simulator + fault injection, edge detectors, gRPC + Prometheus transport
- FastAPI backend: starts cleanly, gRPC server, central detectors, REST API, WebSocket hub
- Training callbacks: mmap-based metrics writer, 4 simulation scenarios, binary format verified
- Proto schemas: both Rust and Python generate successfully
- Toolchain installed: rustc 1.94, cargo, rust-analyzer, pyright, protoc

## What's Left for SP-1 + SP-2

### Phase 1: E2E Integration (local Mac, ~2 hours)

1. **Run sidecar + backend together (no Docker)**
   - Terminal 1: `source backend/.venv/bin/activate && uvicorn app.main:app --port 8000 --app-dir backend`
   - Terminal 2: `source ~/.cargo/env && cd sidecar && cargo run -- --simulate --node-id node-0`
   - Terminal 3: `source backend/.venv/bin/activate && python -m training.simulate --scenario normal`
   - Verify: `curl localhost:8000/api/v1/nodes` shows node-0
   - Verify: `curl localhost:8000/api/v1/alerts` shows edge alerts

2. **Test fault injection scenarios**
   - `cargo run -- --simulate --inject-fault thermal_throttle` → verify CRITICAL alert
   - `cargo run -- --simulate --inject-fault xid_79` → verify XID alert
   - `python -m training.simulate --scenario gradient_explosion` → verify gradient alert
   - `python -m training.simulate --scenario diloco_drift` → verify DiLoCo alerts

3. **Fix any integration bugs**
   - gRPC proto compatibility between Rust (prost/tonic) and Python (grpcio)
   - Binary mmap format alignment between training callbacks and sidecar readers
   - WebSocket streaming to a test client

### Phase 2: Docker Compose (local, ~1 hour)

4. **Fix Dockerfiles for the actual codebase**
   - Sidecar Dockerfile needs protoc installed in builder stage (already done)
   - Backend Dockerfile needs proto generation step
   - Add `backend/.venv` to `.dockerignore`

5. **docker compose up --build**
   - Verify all 3 services start (sidecar, backend, prometheus)
   - Verify Prometheus targets at http://localhost:9090/targets
   - Add Grafana service with preconfigured GPU dashboard (optional)

### Phase 3: Tests (~2 hours)

6. **Rust unit tests**
   - `sidecar/src/normalizer.rs` — detect_profile, memory_used_pct
   - `sidecar/src/detectors/threshold.rs` — each threshold rule
   - `sidecar/src/simulator.rs` — fault injection generates expected metrics
   - `sidecar/src/collectors/training.rs` — mmap read with valid/invalid data

7. **Python unit tests**
   - `backend/app/detectors/zscore.py` — z-score calculation correctness
   - `backend/app/detectors/cross_node.py` — straggler detection
   - `backend/app/api/routes.py` — API endpoint responses (httpx + TestClient)
   - `backend/app/ws/websocket.py` — WebSocket connection + filtering
   - `training/simulate.py` — binary format round-trip

8. **E2E integration test**
   - Script that starts backend + sidecar, waits 10s, queries API, asserts data flows

### Phase 4: Polish (~1 hour)

9. **Wire training/diloco readers into sidecar main loop**
   - The TrainingMetricsReader and DiLoCoMetricsReader are implemented but not yet used in main.rs
   - Add them to the collector to merge training metrics into MetricsBatch

10. **Suppress dead_code warnings** with `#[allow(dead_code)]` on intentionally unused items, or wire them in

---

## After SP-1 + SP-2: Sub-Project Order

| Priority | Sub-Project | Depends On |
|----------|------------|------------|
| Next | SP-3: LLM Diagnosis Agent | SP-1 + SP-2 (needs alerts to diagnose) |
| Then | SP-4: Next.js Dashboard | SP-2 (consumes REST API + WebSocket) |
| Then | SP-5: K8s + IaC | All above (deploys everything) |
| Last | SP-6: Solana Layer | Independent (can parallel with SP-4/5) |

## Resume Instructions

Start a new session and say:
> "Continue SolProbe — run Phase 1 E2E integration testing. Use Teams for coordination."

Claude will pick up context from memory files and the plan.
