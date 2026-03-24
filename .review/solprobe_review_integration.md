I'll systematically review all the integration files. Let me fetch the necessary tools and read all the relevant files.

---

Now let me read all the training files and then dig deeper into the backend and sidecar implementations.

---

Now let me look at a few more critical files — the health endpoint discrepancy, the infra Prometheus config, and the dashboard integration.

---

Now let me check the remaining files I need — the Dockerfile presence, `sidecar/Dockerfile`, `backend/Dockerfile`, the `Makefile`, and the health endpoint discrepancy identified above.

---

Now let me check a few final items — the `connected_sidecars` vs `node_count` discrepancy in the health endpoint, the `HasField` usage on proto3 non-optional fields, and the dashboard's API integration.

---

Now let me check a few more specific items — the `HasField` usage on proto3 fields and the `StreamMetrics` single-batch-per-call pattern vs the streaming proto contract.

---

I now have a comprehensive picture of the entire integration layer. Let me compile the full findings report.

---

# SolProbe Integration Layer — Architecture Review

## Summary

After reading all proto schemas, training callbacks, Rust sidecar collectors, Python gRPC server, stores, detectors, API routes, WebSocket hub, Docker Compose, Dockerfiles, E2E test, and dashboard types, I identified **22 findings** across 7 categories.

---

## Findings

---

### Finding 1

**File:Line** — `sidecar/src/collectors/diloco.rs:19–23`
**Category** — Integration Bug
**Risk Level** — BREAKING

**Description** — The Rust DiLoCo reader has a comment that reads: "The spec says 42 bytes, but with correct field sizes it is 46. We accept files >= 42 bytes for backward compatibility." The minimum size check uses `DILOCO_MIN_SIZE = 42`, but then proceeds to read fields all the way through byte index 45 (`buf[41..45]` for `worker_speed_ratio` and `buf[45]` for `is_straggler`). These conditional reads only trigger if `buf.len() > 44` and `buf.len() > 45`. A file that is exactly 42–45 bytes long would pass the minimum size check but then have `buf.len() > 44` or `buf.len() > 45` evaluate to `false`, silently defaulting `worker_speed_ratio = 1.0` and `is_straggler = false`. This is technically graceful, but the comment itself is incorrect: "42 bytes" appears nowhere in the Python layout documentation (which says 46 bytes), so the backward-compatibility rationale is phantom. More importantly, if a future writer produces a 42-byte file (which is possible if the comment were used as a specification), the straggler field would be silently discarded — the very field that triggers `STRAGGLER_DETECTED` alerts.

**Suggested Fix** — Remove the backward-compat path. Set `DILOCO_MIN_SIZE = 46` to match the authoritative Python layout. Delete the conditional reads and read all fields unconditionally up to offset 45.

---

### Finding 2

**File:Line** — `training/callback.py:96–101` (both `SolProbeCallback` and `SolProbeDiLoCoCallback`)
**Category** — Integration Bug
**Risk Level** — HIGH

**Description** — Both mmap callbacks use a two-phase open: first write a zero-filled file with `open(path, "wb")`, then open again with `os.open(path, os.O_RDWR)`. Between these two calls there is no locking. If the sidecar reads the file during this window (after the `"wb"` truncation but before `mmap.mmap()` establishes the mapping), it will see an all-zero buffer. With `valid_flag = 0` this returns `None` gracefully, but if the sidecar is mid-read when the `"wb"` truncate happens (reducing the file to zero bytes), `Mmap::map(&file)` on the Rust side will receive an empty mapping and emit a "file too small" warning, potentially causing one missed sample. The real danger is if the Python process crashes after truncating but before re-mapping: the file is left at zero bytes permanently, so the sidecar can never read training metrics again until the Python process is restarted (which recreates the file).

**Suggested Fix** — Write the initial zero-filled buffer and keep the file descriptor open for the mmap in a single step (open with `O_RDWR | O_CREAT`, `ftruncate`, then mmap). Do not use a separate `"wb"` open. This eliminates the truncation gap.

---

### Finding 3

**File:Line** — `training/callback.py:232` / `training/diloco_callback.py:214`
**Category** — Integration Bug
**Risk Level** — HIGH

**Description** — Both callbacks define `__del__` calling `self.close()`. If the Python process crashes (SIGKILL, OOM) the destructor is not called. The mmap file is left with `valid_flag = 1` and stale data from the last successful write. The sidecar will continue reading and reporting stale training metrics indefinitely (potentially for hours) until the file is cleaned up externally. The sidecar has no freshness check — it accepts any timestamp in the file without comparing it against wall-clock time.

**Suggested Fix** — The sidecar's `TrainingMetricsReader::read()` should compare `timestamp_ms` in the parsed data against `SystemTime::now()`, and return `None` if the data is older than a configurable staleness threshold (e.g., 5 seconds). This makes crash detection automatic without requiring a clean shutdown.

---

### Finding 4

**File:Line** — `sidecar/src/transport/grpc.rs:84–117`
**Category** — API Contract Mismatch
**Risk Level** — HIGH

**Description** — The proto definition `StreamMetrics` is declared as `rpc StreamMetrics(stream MetricsBatch) returns (StreamAck)` — a client-streaming RPC where the sidecar streams multiple batches in one call and gets a single `StreamAck` at the end. However, the actual Rust implementation calls `StreamMetrics` once per second with a single-message stream: it creates a channel, sends one batch, drops the sender, and immediately awaits the `StreamAck`. This means every 1-second tick opens a new gRPC call instead of reusing the stream. The Python `StreamMetrics` servicer iterates `request_iterator` and only returns the `StreamAck` when the iterator is exhausted — which happens immediately after one batch. This works but wastes significant overhead (one TLS handshake / HTTP/2 stream setup per second per sidecar) and defeats the purpose of client-streaming. Under load with many sidecars, this pattern multiplies connection overhead linearly.

**Suggested Fix** — Implement a long-lived streaming sender on the Rust side: open one `StreamMetrics` call per session and push batches into a `channel` that is kept open for the session's lifetime. Reconnect only on error. Alternatively, rename/change the proto to `rpc SendMetricsBatch(MetricsBatch) returns (StreamAck)` (unary) to match the actual usage pattern.

---

### Finding 5

**File:Line** — `backend/app/grpc_server.py:181–182`
**Category** — API Contract Mismatch
**Risk Level** — HIGH

**Description** — `HasField("gpu_index")` and `HasField("job_id")` are called on `proto3` optional fields in the `Alert` message. This is correct for `optional uint32 gpu_index = 20` and `optional string job_id = 21` because proto3 `optional` fields do generate a `has_*` presence bit. However, the generated Python bindings produced by `protoc` represent these as `oneof` wrappers internally (`_gpu_index` / `_job_id` oneofs visible in the serialized file descriptor in `alerts_pb2.py`). This is currently working, but the correctness depends on the specific `grpc_tools.protoc` version used. If the generated stubs are ever regenerated with a different protoc version that handles optional fields differently (or if `HasField` is called on a non-optional field by mistake during a copy-paste), it will raise `ValueError` at runtime, silently dropping alerts. There is no test exercising `HasField` when `gpu_index` is absent.

**Suggested Fix** — Add a test in `test_api.py` / `test_stores.py` that sends an alert proto with `gpu_index` absent and verifies `AlertModel.gpu_index is None`. Document the proto3 optional dependency explicitly.

---

### Finding 6

**File:Line** — `scripts/e2e_test.sh:147`
**Category** — Testing Gap
**Risk Level** — HIGH

**Description** — The E2E test checks `connected_sidecars > 0` after 8 seconds of data flow, but the `connected_sidecars` metric (`metrics_store.node_count`) is driven purely by whether any `MetricsBatch` has been ingested via gRPC. The sidecar uses `stream_metrics` which reconnects lazily — the initial `try_connect` at startup is non-blocking and may fail silently if the backend gRPC port isn't ready yet. The 8-second wait is the only timing guarantee, but there is no test asserting that the gRPC stream actually delivered data (as opposed to all data being lost to connection failures). If every gRPC call fails but the sidecar's Prometheus endpoint is up, step 3 passes but steps 4 and 5 will fail with no explanation. The E2E test has no step that validates the sidecar's `solprobe_grpc_errors_total` counter or equivalent.

**Suggested Fix** — Add a dedicated check after the 8-second wait: query the backend's `/api/v1/nodes/node-0/metrics` endpoint and assert the returned `gpu_metrics` list is non-empty. This would confirm end-to-end data delivery (sidecar → gRPC → backend store → REST API) rather than just confirming the node was registered.

---

### Finding 7

**File:Line** — `proto/alerts.proto:34` and `backend/app/detectors/zscore.py` (no `loss_plateau` reference), `backend/app/detectors/cross_node.py`, `backend/app/detectors/diloco.py`
**Category** — Feature Gap
**Risk Level** — HIGH

**Description** — `ALERT_TYPE_LOSS_PLATEAU = 12` is defined in the proto and in `_ALERT_TYPE_MAP` in `grpc_server.py`, and a `loss_plateau` scenario exists in `training/simulate.py`. However, **no detector generates this alert type**. The z-score detector fires on `loss` with alert type `"loss_spike"` — the inverse of a plateau. A loss plateau (loss variance collapsing to near-zero over many steps) requires a different statistical test (e.g., variance dropping below a threshold, or the loss derivative approaching zero for N consecutive steps). Similarly, `ALERT_TYPE_PCIE_ERROR = 6` is defined in the proto and mapped, but the threshold detector never checks `pcie_replay_counter` for anomalies.

**Suggested Fix** — Implement a loss-plateau detector in `backend/app/detectors/zscore.py` or as a separate module: detect when `np.std(loss_series[-window:]) < plateau_variance_threshold` for a minimum number of consecutive samples. Add a PCIe replay counter threshold check in `sidecar/src/detectors/threshold.rs`.

---

### Finding 8

**File:Line** — `backend/app/detectors/cross_node.py:112–113`
**Category** — API Contract Mismatch
**Risk Level** — HIGH

**Description** — When correlated failures are detected, the code sets `node_id = ",".join(affected_nodes)` on the `AlertModel`. The `AlertModel.node_id` field in the Pydantic model is typed as `str` and has no restriction, so this works at the Python layer. However, the dashboard TypeScript types define `AlertModel.node_id: string`, the E2E test checks for `a.get('node_id') == 'node-0'` (exact match), and the WebSocket filter `_matches_filter` checks `node_id not in conn.filt.node_ids` — meaning a correlated-failure alert with `node_id = "node-0,node-1"` will never match a client subscribed to `node_ids: ["node-0"]`. The alert will be silently dropped by the WebSocket filter. The dashboard's per-node alert views will also never show correlated-failure alerts.

**Suggested Fix** — Use a synthetic node ID like `"CLUSTER"` or `"multi"` for correlated alerts, or create a separate field `affected_nodes: list[str]` on `AlertModel`. Expand the WebSocket filter to match if any `affected_node` in the list matches the subscribed node_ids.

---

### Finding 9

**File:Line** — `docker-compose.yml:1–28`
**Category** — Integration Bug
**Risk Level** — HIGH

**Description** — Five problems in the Docker Compose file:
1. No `dashboard` service — the dashboard must be started separately. The README says "Quick Start" involves 3 separate steps with no Docker integration for the dashboard.
2. No `health_check` on any service. `depends_on: - backend` only waits for the container to start, not for the gRPC port (50051) or REST port (8000) to be ready. The sidecar will almost certainly start before the backend is listening, causing the initial `try_connect` to fail and gRPC reconnection to start immediately.
3. No persistent volume for the backend store. All metrics and alerts are in-memory; a backend container restart loses all history. This is documented nowhere.
4. The sidecar container uses `--backend-addr http://backend:50051` but gRPC over plain HTTP requires the address to be `http://backend:50051` (h2c). Tonic's `connect()` will attempt HTTP/2 cleartext, which should work, but if TLS is ever added to the backend this address format will silently fall back or break.
5. The Prometheus scrape config targets `sidecar:9100` and `backend:8000` — these names are correct for Docker Compose networking, but the sidecar's `--metrics-port` defaults to 9100 and is not explicitly set in the compose command, so it works only because of the default value matching. If the default changes, the Prometheus config silently stops scraping.

**Suggested Fix** — Add health checks using `test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health"]` for the backend and `test: ["CMD", "curl", "-f", "http://localhost:9100/metrics"]` for the sidecar. Add a `dashboard` service. Make the sidecar `--metrics-port` explicit in the compose command.

---

### Finding 10

**File:Line** — `backend/Dockerfile:1`
**Category** — Integration Bug
**Risk Level** — HIGH

**Description** — The backend Dockerfile uses `python:3.12-slim` as the base image, but `CLAUDE.md` documents the toolchain as Python 3.14.3. The `pyproject.toml` likely specifies a minimum Python version requirement that may conflict with 3.12. More critically, `grpc_tools.protoc` generates stubs inside the Docker build using whatever version of `protoc` is bundled with the `grpcio-tools` package. The checked-in generated stubs in `backend/app/generated/` (generated with Protobuf 6.31.1, as seen in `alerts_pb2.py`) may differ from what the Dockerfile regenerates with the pinned `grpcio-tools` version installed from `pyproject.toml`. If there is a version mismatch, the generated stubs will be silently overwritten with potentially incompatible code.

**Suggested Fix** — Align the Dockerfile base image to match the documented Python version. Pin `grpcio-tools` to the exact version used to generate the checked-in stubs, or remove the checked-in stubs and always rely on the Dockerfile-generated ones, never committing them.

---

### Finding 11

**File:Line** — `sidecar/src/collectors/training.rs:68` / `sidecar/src/collectors/diloco.rs:87`
**Category** — Feature Gap
**Risk Level** — MEDIUM

**Description** — `job_id` is always set to `String::new()` (empty string) in both `TrainingMetrics` and `DiLoCoMetrics` produced by the mmap readers. The proto defines `job_id` as a required `string` field (not `optional`), so an empty string is a valid proto3 value. However, the backend's `TrainingMetricsModel` declares `job_id: str` as non-optional with no default, so an empty string will be stored and surfaced in the API and dashboard. Diagnosis requests, job-scoped alert filtering (`/api/v1/alerts?job_id=xxx`), and Solana attestation (which needs `job_id` for escrow lookup) all depend on a meaningful `job_id`. The simulator hardcodes `"sim-job-001"` as `job_id`, but real mmap-based training has no way to inject a `job_id` into the callback.

**Suggested Fix** — Add a `job_id: str = "unknown"` parameter to `SolProbeCallback.__init__` and `SolProbeDiLoCoCallback.__init__`, and either encode it in the mmap binary format (requires extending the layout and updating the Rust reader) or pass it as a separate file (e.g., `/tmp/solprobe_job_{node_id}.txt`). The Rust reader can read this file to populate `job_id`.

---

### Finding 12

**File:Line** — `backend/app/ws/websocket.py:173–187`
**Category** — Testing Gap
**Risk Level** — MEDIUM

**Description** — The WebSocket `websocket_endpoint` function only listens for incoming text messages to update the client filter. It never sends anything proactively — metric summaries and alerts are pushed by `broadcast_alert` and `broadcast_metric_summary` which are triggered externally. If no alerts arrive and no nodes are connected, a WebSocket client that just connected will receive zero messages and have no way to distinguish "connected and healthy, no data" from "connection established but backend has no active nodes." There is no initial welcome/handshake message, no keepalive ping, and the `metric_summary_loop` only fires every 5 seconds. A client that connects, sets a filter, and waits will see nothing for up to 5 seconds with no feedback.

**Suggested Fix** — Send an immediate `{"type": "connected", "data": {"active_nodes": N, "total_alerts": M}}` message on connection. Add a server-side ping/keepalive every 30 seconds so the client can detect stale connections.

---

### Finding 13

**File:Line** — `backend/app/main.py:225–230`
**Category** — Integration Bug
**Risk Level** — MEDIUM

**Description** — CORS is configured to allow only `http://localhost:3000` and `http://127.0.0.1:3000`. The dashboard `api.ts` sets `BASE_URL = process.env.NEXT_PUBLIC_API_URL || ""` — when empty, API calls are made relative to the current origin. This works during local `npm run dev` (Next.js dev server proxies to the backend). However, in Docker Compose there is no dashboard service and no Next.js proxy, so if someone tries to access the dashboard at any URL other than `localhost:3000` (e.g., a remote dev environment, a different port mapping, or a production deployment), all API calls will fail with CORS errors. The `README.md` Quick Start section does not document the CORS restriction or the need to set `NEXT_PUBLIC_API_URL`.

**Suggested Fix** — Document the CORS constraint explicitly in the README. Allow `CORS_ORIGINS` to be set via environment variable. Add the dashboard origin to the compose file once the dashboard service is added.

---

### Finding 14

**File:Line** — `backend/app/main.py:146–165` (`_auto_diagnosis_loop`)
**Category** — Integration Bug
**Risk Level** — MEDIUM

**Description** — The auto-diagnosis loop queries `alert_store.query(severity="CRITICAL", limit=20)` every 5 seconds and calls `agent.diagnose` for any alert without a completed diagnosis. With the default exponential backoff, this fires immediately at startup (first `sleep(5)`), before any alerts have arrived. More critically, `agent.diagnose` is called with `asyncio.to_thread`, which is correct (it's a blocking call). However, if 20 CRITICAL alerts arrive in a burst (e.g., during fault injection), the loop will try to diagnose all 20 serially. With typical Claude API latency of 2–5 seconds per call, this backlog takes 40–100 seconds to clear. Meanwhile, new CRITICAL alerts keep accumulating. The `consecutive_failures` counter also resets on any success within the batch, so a single successful diagnosis prevents exponential backoff even if the other 19 fail due to rate limiting.

**Suggested Fix** — Implement a concurrent diagnosis semaphore (e.g., 3 parallel diagnoses max). Track `last_attempted_at` per alert to avoid hammering recently-failed diagnoses. Move the diagnosis queue to a dedicated `asyncio.Queue` fed by alert arrivals rather than polling.

---

### Finding 15

**File:Line** — `sidecar/src/main.rs:246–254`
**Category** — Integration Bug
**Risk Level** — MEDIUM

**Description** — Alert reporting is done with `tokio::spawn` (fire-and-forget). If the gRPC call fails, `report_alert` logs a warning and returns an error. The spawned task discards this error. Alerts can be lost permanently if the backend is temporarily unavailable — there is no retry queue, no buffering, and no acknowledgment tracking. Since edge alerts (Xid errors, thermal throttle, ECC) are latency-sensitive and exactly what the system is designed to catch, silent loss of these alerts is a significant reliability gap.

**Suggested Fix** — Maintain a bounded in-memory retry queue (e.g., `VecDeque` with max 100 entries) for failed alert deliveries. Re-attempt on the next tick before collecting new metrics. The `StreamAck.ok = false` path should also re-enqueue.

---

### Finding 16

**File:Line** — `scripts/e2e_test.sh:217–243`
**Category** — Testing Gap
**Risk Level** — MEDIUM

**Description** — The E2E test checks for CRITICAL alerts by querying `/api/v1/alerts?severity=CRITICAL`, but the thermal_throttle fault is edge-detected (sidecar-side) and the alert reaches the backend via `ReportAlert` gRPC. The test waits only 5 seconds after the fault sidecar starts. Given that (a) the fault sidecar needs to connect gRPC (~1–2 seconds), (b) `report_alert` spawns a goroutine that may be delayed, and (c) the backend must receive and store the alert before the curl query, 5 seconds may be insufficient on a slow CI machine or under cargo rebuild. The test has no retry loop — it does one curl and evaluates immediately. If the timing is marginally off, the test fails with a misleading "0 CRITICAL alerts" message.

**Suggested Fix** — Replace the fixed `sleep 5` with a `wait_for_http`-style polling loop that retries the `/api/v1/alerts?severity=CRITICAL` endpoint until `CRITICAL_COUNT > 0` or a 30-second timeout is reached.

---

### Finding 17

**File:Line** — `dashboard/src/lib/types.ts:1–17` (`GpuMetrics` interface)
**Category** — API Contract Mismatch
**Risk Level** — MEDIUM

**Description** — The TypeScript `GpuMetrics` interface is missing several fields that are present in the backend `GpuMetricsModel` Pydantic model and the proto `GpuMetrics` message: `memory_temp_c`, `mem_copy_utilization_pct`, `pcie_replay_counter`, `pcie_tx_bytes_per_sec`, `pcie_rx_bytes_per_sec`, `retired_pages_sbe`, `retired_pages_dbe`, `remapped_rows_correctable`, `remapped_rows_uncorrectable`, and `row_remap_failure`. The backend returns all these fields in API responses. Dashboard components that need to display PCIe errors, page retirement (T4-specific), or row remapping (L4-specific) cannot do so without TypeScript errors, since the fields are absent from the type. This creates a silent schema drift between the TypeScript client and the backend API.

**Suggested Fix** — Add all missing fields to the `GpuMetrics` TypeScript interface. Consider using a code generator (e.g., `openapi-typescript` pointed at the FastAPI OpenAPI schema) to keep the types in sync automatically.

---

### Finding 18

**File:Line** — `backend/app/detectors/zscore.py:33–39`
**Category** — API Contract Mismatch
**Risk Level** — MEDIUM

**Description** — `_FIELD_TO_ALERT_TYPE` maps `"gpu_utilization_pct"` to `"clock_throttle"`. A z-score spike on GPU utilization percentage is not semantically equivalent to a clock throttle event. High GPU utilization is desirable; a z-score spike in utilization (above the mean) would indicate a GPU working harder than normal, which is not an alert condition. A z-score below the mean (negative z-score) would indicate underutilization, which maps more to `straggler_detected`. The current code fires a `clock_throttle` alert on any `abs(z) > 3.0` for utilization, which will generate false positives whenever utilization increases beyond normal variance.

**Suggested Fix** — Remove `gpu_utilization_pct` from `_GPU_FIELDS` for z-score monitoring, or add directional logic (only fire on low utilization, mapping to `straggler_detected`). Clock throttle detection should rely on the `clock_throttle_reasons` bitmask, not utilization percentage.

---

### Finding 19

**File:Line** — `backend/app/grpc_server.py:256–258` (`Subscribe` method)
**Category** — Feature Gap
**Risk Level** — MEDIUM

**Description** — The `Subscribe` RPC is a placeholder that keeps the stream alive with `while context.is_active(): time.sleep(1)` but never yields any `Command`. The `Command` message is defined in `alerts.proto` with `command_type: "update_thresholds"` and `"inject_fault"`, but no sidecar-side `Subscribe` caller exists. The sidecar never calls `Subscribe`. This means the bidirectional command channel (backend → sidecar) is entirely unimplemented. Threshold updates configured through the backend cannot reach the sidecar — the sidecar always uses its default `solprobe.toml` thresholds or compiled defaults. The `Command` proto message and `Subscribe` RPC represent dead code.

**Suggested Fix** — Either implement the `Subscribe` command channel (sidecar calls `Subscribe` at startup, backend pushes `update_thresholds` commands to update the threshold detector at runtime) or remove `Subscribe` and `Command` from the proto to avoid confusion. At minimum, document this as unimplemented in comments.

---

### Finding 20

**File:Line** — `backend/app/stores.py:262–275` (`AnomalyStore`)
**Category** — API Contract Mismatch
**Risk Level** — MEDIUM

**Description** — `AnomalyStore` stores `dict[str, Any]` objects (via `anomaly.model_dump()`), not `AnomalyModel` instances. The `/api/v1/anomalies` route returns `list[dict]` without a `response_model`. The dashboard's `fetchAnomalies()` returns `Promise<unknown[]>`. This means anomalies have no type contract anywhere in the stack — proto → backend → API → dashboard — even though `AlertModel` and `AnomalyModel` are fully typed. A consumer of the anomalies endpoint cannot know the response shape without reading the source code.

**Suggested Fix** — Change `AnomalyStore` to store `AnomalyModel` instances. Add `response_model=list[AnomalyModel]` to the `/api/v1/anomalies` route. Add the `AnomalyModel` TypeScript interface to `types.ts`.

---

### Finding 21

**File:Line** — `README.md:107`
**Category** — Documentation
**Risk Level** — LOW

**Description** — The README lists prerequisites as "Rust 1.70+, Python 3.11+, Node 20+". The actual toolchain is Rust 1.94, Python 3.14, Node 24 (from `CLAUDE.md`). `anchor-lang 0.32.1` requires a specific Solana toolchain version; the README does not mention that the Solana CLI and Anchor CLI versions are tightly coupled (`solana 3.1.11` + `anchor 0.30.1` + `anchor-lang 0.32.1` is a specific compatibility matrix that is non-obvious). A developer following the README with Rust 1.70 or Python 3.11 will hit build failures or silent behavioral differences.

**Suggested Fix** — Update prerequisites to exact versions. Add a note that Anchor CLI and anchor-lang must be version-matched, and point to the Anchor version compatibility table.

---

### Finding 22

**File:Line** — `scripts/e2e_test.sh:109–132`
**Category** — Testing Gap
**Risk Level** — LOW

**Description** — The E2E test has no multi-node scenario. It starts exactly one sidecar (`node-0`). The cross-node correlation detector, the straggler detector, and the DiLoCo pseudo-gradient divergence detector all require `>= 2` nodes to produce findings (they return empty lists with `< 2` nodes). These three central detectors are never exercised by the E2E test. The only detector path exercised is the edge threshold detector via `thermal_throttle` injection.

**Suggested Fix** — Add a second sidecar instance (`node-1`) in the E2E test using a different `--metrics-port` (e.g., 9102) and check that the `/api/v1/anomalies` endpoint returns cross-node findings after both sidecars are running.

---

## Cross-Reference Summary

| # | File | Category | Risk |
|---|------|----------|------|
| 1 | `sidecar/src/collectors/diloco.rs:19-23` | Integration Bug | BREAKING |
| 2 | `training/callback.py:96-101` | Integration Bug | HIGH |
| 3 | `training/callback.py:232`, `diloco_callback.py:214` | Integration Bug | HIGH |
| 4 | `sidecar/src/transport/grpc.rs:84-117` | API Contract Mismatch | HIGH |
| 5 | `backend/app/grpc_server.py:181-182` | API Contract Mismatch | HIGH |
| 6 | `scripts/e2e_test.sh:147` | Testing Gap | HIGH |
| 7 | `proto/alerts.proto:34` + detectors | Feature Gap | HIGH |
| 8 | `backend/app/detectors/cross_node.py:112-113` | Integration Bug | HIGH |
| 9 | `docker-compose.yml:1-28` | Integration Bug | HIGH |
| 10 | `backend/Dockerfile:1` | Integration Bug | HIGH |
| 11 | `sidecar/src/collectors/training.rs:68` | Feature Gap | MEDIUM |
| 12 | `backend/app/ws/websocket.py:173-187` | Testing Gap | MEDIUM |
| 13 | `backend/app/main.py:225-230` | Integration Bug | MEDIUM |
| 14 | `backend/app/main.py:146-165` | Integration Bug | MEDIUM |
| 15 | `sidecar/src/main.rs:246-254` | Integration Bug | MEDIUM |
| 16 | `scripts/e2e_test.sh:217-243` | Testing Gap | MEDIUM |
| 17 | `dashboard/src/lib/types.ts:1-17` | API Contract Mismatch | MEDIUM |
| 18 | `backend/app/detectors/zscore.py:33-39` | API Contract Mismatch | MEDIUM |
| 19 | `backend/app/grpc_server.py:256-258` | Feature Gap | MEDIUM |
| 20 | `backend/app/stores.py:262-275` | API Contract Mismatch | MEDIUM |
| 21 | `README.md:107` | Documentation | LOW |
| 22 | `scripts/e2e_test.sh:109-132` | Testing Gap | LOW |

---

## Priority Ordering for a Demo-Readiness Pass

**Fix first (will cause runtime failures):**
- Finding 1 — DiLoCo min-size backward compat phantom (silent straggler field loss)
- Finding 8 — Correlated failure alert `node_id` is comma-joined (WebSocket filter breaks)
- Finding 9 — Docker Compose missing health checks (sidecar starts before backend is ready)

**Fix before load testing:**
- Finding 4 — `StreamMetrics` called once-per-second instead of streaming (N×connection overhead)
- Finding 15 — Fire-and-forget alert reporting (alerts silently lost on backend unavailability)
- Finding 14 — Auto-diagnosis loop serial backlog (20 alerts = 100s to clear)

**Fix before claiming feature completeness:**
- Finding 7 — `loss_plateau` and `pcie_error` alert types defined but no detector emits them
- Finding 19 — `Subscribe`/`Command` RPC is dead code in both sidecar and backend
- Finding 11 — `job_id` always empty from mmap callbacks (Solana escrow lookup broken)

---

