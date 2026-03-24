Now I have read every file. Let me compile the full code review.

---

## Deep Code Review — SolProbe FastAPI Backend

---

### BUG / BREAKING

---

**Finding 1**
- **File:Line** — `app/grpc_server.py:181`
- **Category** — Bug
- **Risk Level** — BREAKING
- **Description** — `HasField` is called on `optional int32 gpu_index` and `optional string job_id` protobuf fields. `HasField` only works on message-type fields and `oneof` fields in proto3; calling it on a scalar field that is not wrapped in a `oneof` raises `ValueError: Field gpu_index is not a singular message field or oneof field.` at runtime on every `ReportAlert` call that includes a GPU alert. The server will crash on the first real sidecar connection.
- **Suggested Fix** — Check for the proto3 default value instead (0 for int32, empty string for string): `gpu_index=g.gpu_index if g.gpu_index != 0 else None` and `job_id=a.job_id if a.job_id else None`. If the proto truly needs optional presence, wrap these fields in a `oneof` in the `.proto` file.

---

**Finding 2**
- **File:Line** — `app/main.py:104–105`
- **Category** — Bug
- **Risk Level** — BREAKING
- **Description** — `_auto_diagnosis_loop` calls `agent.diagnose(alert)` directly in the event loop via `asyncio.to_thread`. `diagnose` is a synchronous blocking method, which is correct for `to_thread`. However, inside `diagnose`, the `enrich_alert` call acquires `MetricsStore._lock` and `AlertStore._lock`. These are `threading.Lock` objects. They are also acquired by the gRPC worker threads at the same time. Since `asyncio.to_thread` runs on a separate OS thread from the asyncio loop, this is safe from a deadlock standpoint, **but** the auto-diagnosis loop holds `asyncio.to_thread` tasks while also iterating up to 20 critical alerts sequentially. If the Claude API is slow (seconds per call), this blocks 20 LLM calls in sequence per 5-second loop cycle, meaning the loop effectively never gets back to sleep and the Prometheus gauge loop and metric summary loop starve. This is a design-level concurrency bug.
- **Suggested Fix** — Cap the number of diagnoses triggered per loop iteration to 1–3, add a per-diagnosis timeout using `asyncio.wait_for`, or use a dedicated `asyncio.Queue` and bounded worker instead of iterating inside the loop.

---

**Finding 3**
- **File:Line** — `app/ws/websocket.py:143–162` (broadcast_metric_summary) and `app/ws/websocket.py:95–114` (broadcast_alert)
- **Category** — Bug
- **Risk Level** — HIGH
- **Description** — Both `broadcast_alert` and `broadcast_metric_summary` mutate `self._connections` (removing stale connections via `self._connections.remove(conn)`) while the `async with self._lock` context is still held. Since `asyncio.Lock` is a non-reentrant lock and these are coroutines, if `conn.ws.send_text(payload)` ever triggers another coroutine that calls `broadcast_alert` or `disconnect` on the same event loop, a deadlock will occur. Additionally, in `broadcast_metric_summary`, the inner loop over `statuses` sends multiple payloads per connection; if the first send fails, the connection is added to `stale` and the `break` exits the inner loop — but the outer loop continues to the next `conn`. This means a single failed connection causes only that connection's first matching status to be skipped, not all statuses for that connection. The logic is subtly wrong.
- **Suggested Fix** — Use a snapshot copy of `self._connections` at the start of broadcast (still inside the lock), then release the lock before iterating and sending. Call `disconnect` after the broadcast loop for stale connections.

---

**Finding 4**
- **File:Line** — `app/ws/websocket.py:164–166`
- **Category** — Bug
- **Risk Level** — HIGH
- **Description** — `active_count` reads `len(self._connections)` without acquiring `_lock`. In asyncio this is usually safe since the event loop is single-threaded, but `_schedule_ws_broadcast` is called from `_event_loop.call_soon_threadsafe`, meaning any thread can schedule tasks. If a gRPC thread calls `set_event_loop` before `active_count` is read by the prom gauge update, a race exists. More concretely, the prom gauge loop calls `ws_manager.active_count` outside the lock on the same pattern used throughout.
- **Suggested Fix** — Acquire `_lock` inside the property, same as the other thread-safe properties.

---

**Finding 5**
- **File:Line** — `app/detectors/diloco.py:30`
- **Category** — Bug
- **Risk Level** — HIGH
- **Description** — `_last_outer_step: dict[str, int] = {}` is a module-level mutable global with no lock. `run_diloco_detection` is called from `_detector_loop` which runs in an asyncio task, but `asyncio.to_thread` is also used for LLM calls. While the detector itself is not run in a thread, if this dict were ever read/written by multiple concurrent asyncio tasks (e.g., if detection frequency is increased), or if a future refactor passes it to a thread, there is a latent data race. More immediately, this state is never reset if a node restarts and resets its `outer_step` counter back to 0, causing the detector to never trigger again for that node.
- **Suggested Fix** — Protect with a threading.Lock or asyncio.Lock. Also reset the entry if `current_outer < prev_outer` (detecting counter reset).

---

### SECURITY

---

**Finding 6**
- **File:Line** — `app/main.py:225–230`
- **Category** — Security
- **Risk Level** — HIGH
- **Description** — `allow_credentials` is not set (defaults to False), but `allow_headers=["*"]` and `allow_methods=["*"]` are wide open. More critically, the CORS origins list is hardcoded as `["http://localhost:3000", "http://127.0.0.1:3000"]` with no way to override from environment variables. In production (deployed to GKE), the dashboard domain would not be `localhost`, and a developer will either widen the list to `["*"]` or break the dashboard. There is also no HTTPS enforcement.
- **Suggested Fix** — Read allowed origins from `CORS_ORIGINS` environment variable (`os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")`). Never use `allow_origins=["*"]` in production.

---

**Finding 7**
- **File:Line** — `app/grpc_server.py:293`
- **Category** — Security
- **Risk Level** — HIGH
- **Description** — The gRPC server is started with `add_insecure_port`. There is no TLS, no authentication, and no client certificate verification. Any host on the network that can reach port 50051 can stream arbitrary metric data or inject alerts into the system.
- **Suggested Fix** — Use `grpc.ssl_server_credentials` with mTLS in production. At minimum, add a shared-secret token check in the servicer, or bind to `127.0.0.1` only and rely on K8s network policies for isolation.

---

**Finding 8**
- **File:Line** — `app/api/routes.py:99–111` and `app/api/routes.py:186–199`
- **Category** — Security
- **Risk Level** — MEDIUM
- **Description** — `get_enriched_alert` and `create_diagnosis` perform linear O(N) scans through all alerts (up to 1000) to look up an alert by ID: `all_alerts = alert_store.query(limit=1000)`. This is a denial-of-service surface — rapid calls to either endpoint with random IDs will hammer the store's lock repeatedly. There is no rate limiting on REST endpoints.
- **Suggested Fix** — Add an O(1) lookup index (dict by alert_id) to `AlertStore`. Add API-level rate limiting middleware (e.g., `slowapi`).

---

**Finding 9**
- **File:Line** — `app/api/routes.py:85–86`
- **Category** — Security
- **Risk Level** — MEDIUM
- **Description** — `severity` and `alert_type` query parameters are passed directly to `alert_store.query` with no validation against an allowed set of values. Invalid values silently return 0 results rather than a 400 error, which is confusing. More importantly, there is no protection against absurdly long strings being injected as query parameters.
- **Suggested Fix** — Use `Literal` or `Enum` types for `severity` and `alert_type` query parameters in FastAPI to get automatic validation and 422 responses for invalid values.

---

**Finding 10**
- **File:Line** — `app/diagnosis/agent.py:44–49`
- **Category** — Security
- **Risk Level** — MEDIUM
- **Description** — The `ANTHROPIC_API_KEY` is read directly from environment and passed to the `anthropic.Anthropic` client. If an exception occurs during client construction, it is caught broadly and the client is set to `None` with a warning log. This means the key may be present but the client still fails silently. There is no validation that the key is non-empty or in the expected format before use.
- **Suggested Fix** — Validate key format on startup (non-empty, starts with `sk-ant-`). Log a `WARNING` that diagnoses will fail, but don't swallow the error completely — consider raising during startup if the key is absent.

---

### PERFORMANCE

---

**Finding 11**
- **File:Line** — `app/detectors/zscore.py:101–140`
- **Category** — Performance
- **Risk Level** — HIGH
- **Description** — `run_zscore_detection` is O(N_nodes × N_windows × N_fields). With 3 windows × 2 GPU fields + 3 windows × 3 training fields = 15 window/field combinations per node, and e.g. 100 nodes, that is 1500 `get_gpu_metric_series`/`get_training_metric_series` calls per 10-second cycle. Each of those acquires `MetricsStore._lock` and creates a new list copy. With 1800-entry ring buffers, this is significant GC pressure. Furthermore, each `_compute_zscore` runs `np.array(values)`, `np.mean`, and `np.std` synchronously in the asyncio event loop (not in a thread), which will block the loop for measurable time under load.
- **Suggested Fix** — Run the detection functions in `asyncio.to_thread` (as the `_detector_loop` already calls `run_fn()` synchronously — this is already blocked, but it should be wrapped). Better: pre-compute incremental running mean/variance using Welford's algorithm inside the `_NodeBuffer` to avoid per-call numpy allocations.

---

**Finding 12**
- **File:Line** — `app/main.py:104` (`_auto_diagnosis_loop`)
- **Category** — Performance
- **Risk Level** — HIGH
- **Description** — `alert_store.query(severity="CRITICAL", limit=20)` scans and copies up to 1000 alerts every 5 seconds. Then for each of up to 20 alerts, `diagnosis_store.get_by_alert_id` does another full linear scan of 500 diagnoses. Total worst case: 20 × 500 = 10,000 comparisons every 5 seconds while holding `_lock`.
- **Suggested Fix** — Add an index dict (`_by_alert_id: dict[str, DiagnosisResult]`) in `DiagnosisStore` for O(1) lookup. Also consider only querying alerts created after the last loop run.

---

**Finding 13**
- **File:Line** — `app/ws/websocket.py:137–162` (`broadcast_metric_summary`)
- **Category** — Performance
- **Risk Level** — MEDIUM
- **Description** — `broadcast_metric_summary` calls `metrics_store.get_all_node_statuses()` (acquires lock, copies all node data), then for each connection, serializes a payload per node. With 100 nodes and 50 WebSocket clients, that is 5000 `json.dumps` + `send_text` calls per 5-second broadcast cycle, all while holding the asyncio lock. The lock is held for the entire nested iteration, blocking other coroutines from calling `broadcast_alert` during this time.
- **Suggested Fix** — Pre-serialize payloads once per status before iterating connections. Release the lock before sending (take a snapshot of connections under lock, then release, then iterate and send).

---

**Finding 14**
- **File:Line** — `app/stores.py:181–192` (`get_gpu_metric_series`)
- **Category** — Performance
- **Risk Level** — MEDIUM
- **Description** — `get_gpu_metric_series` calls `get_gpu_history` which acquires the lock and copies data, then iterates the result doing N `getattr` calls with string names. This pattern is repeated in `get_training_metric_series`. Called 15 times per node per zscore detection cycle, the repeated lock acquisition and list copying is O(N_samples × N_fields × N_nodes) work.
- **Suggested Fix** — Expose a single batch-fetch method that extracts multiple fields in one lock acquisition. Consider caching the most recent summary per node.

---

**Finding 15**
- **File:Line** — `app/main.py:104`
- **Category** — Performance
- **Risk Level** — MEDIUM
- **Description** — The `_auto_diagnosis_loop` calls `asyncio.to_thread(agent.diagnose, alert)` in a simple `for` loop with `await`. This is sequential — each LLM call (potentially 1–5 seconds) must complete before the next starts. With 20 critical alerts, this loop can take up to 100 seconds, far exceeding the 5-second target interval.
- **Suggested Fix** — Use `asyncio.gather` with a bounded semaphore to parallelize diagnoses, or limit to 1 per loop iteration.

---

### ARCHITECTURE

---

**Finding 16**
- **File:Line** — `app/main.py:91` and `app/detectors/diloco.py:30`
- **Category** — Architecture
- **Risk Level** — HIGH
- **Description** — All background tasks (`_background_tasks: list[asyncio.Task]`) are module-level globals. The `lifespan` function appends to this list on each startup but never checks if it already has entries. On hot-reload (uvicorn `--reload` mode) or if `lifespan` were called twice, tasks would accumulate and leak. Additionally, `_last_outer_step` in `diloco.py` is module-level state that persists across test runs (shown by the need to monkeypatch stores in tests but not this dict).
- **Suggested Fix** — Instantiate the task list inside `lifespan` as a local variable or on the `application.state`. Reset `_last_outer_step` as part of a `DilocoDetector` class instance (like the other stores).

---

**Finding 17**
- **File:Line** — `app/grpc_server.py:256–258`
- **Category** — Architecture
- **Risk Level** — HIGH
- **Description** — The `Subscribe` RPC handler does `while context.is_active(): time.sleep(1)`. This is a blocking call running in one of the gRPC thread pool's 10 threads. If 10 sidecars subscribe simultaneously, the entire thread pool is saturated and no new `StreamMetrics` or `ReportAlert` calls can be handled. `time.sleep` inside a gRPC thread is the correct approach (cannot use asyncio), but 1-second polling is inefficient and the thread pool size should be >= max expected concurrent sidecar connections + buffer.
- **Suggested Fix** — Use `context.add_callback(lambda: None)` and a `threading.Event` to wake up immediately when the context closes, rather than polling every second. Increase the thread pool to `max_workers=max_sidecars * 3` (StreamMetrics + ReportAlert + Subscribe per sidecar).

---

**Finding 18**
- **File:Line** — `app/stores.py:278–308` (`JobStore`)
- **Category** — Architecture
- **Risk Level** — MEDIUM
- **Description** — `JobStore` is unbounded — `self._jobs` is a plain dict with no eviction. If jobs are registered but never cleaned up (and there is no delete endpoint), it grows without limit. In a long-running deployment, this is a memory leak.
- **Suggested Fix** — Add `max_size` (e.g., 1000) like the other stores, or implement a TTL-based eviction. Alternatively, add a `DELETE /api/v1/jobs/{job_id}` endpoint.

---

**Finding 19**
- **File:Line** — `app/diagnosis/agent.py:298–311`
- **Category** — Architecture
- **Risk Level** — MEDIUM
- **Description** — `get_or_create_agent` uses double-checked locking. The singleton `_agent_instance` is read without a lock on line 305. In CPython with the GIL, this is safe, but it is not safe in general Python (e.g., free-threaded Python 3.13+ with GIL disabled). The pattern also makes it impossible to inject a different agent for testing without monkeypatching the module-level global.
- **Suggested Fix** — Use the lock for the first read too (simple locking), or use a `threading.local` / application-state approach. For testability, consider making `get_or_create_agent` accept an optional factory argument.

---

**Finding 20**
- **File:Line** — `app/generated/__init__.py:11–14`
- **Category** — Architecture
- **Risk Level** — MEDIUM
- **Description** — `sys.path.insert(0, _generated_dir)` modifies the global Python path at import time as a side effect of importing the package. This is a well-known anti-pattern: it pollutes the module namespace, can cause import confusion in tests, and conflicts with proper package structure. If `metrics_pb2.py` or `alerts_pb2.py` happen to shadow any top-level module name, imports elsewhere break silently.
- **Suggested Fix** — Fix the generated protobuf files to use relative imports (`from . import metrics_pb2`) or use `grpc_tools.protoc` with the `--python_out` and `--grpc_python_out` flags combined with `--pyi_out`, and configure the import style to generate relative imports.

---

**Finding 21**
- **File:Line** — `app/main.py:184`
- **Category** — Architecture
- **Risk Level** — MEDIUM
- **Description** — The gRPC port (50051) is hardcoded in the lifespan startup call. It is not configurable via environment variable, making it impossible to run two instances on the same host or override in Kubernetes without code changes.
- **Suggested Fix** — Read from `int(os.environ.get("GRPC_PORT", "50051"))`.

---

**Finding 22**
- **File:Line** — `app/diagnosis/store.py` and `app/stores.py`
- **Category** — Architecture
- **Risk Level** — MEDIUM
- **Description** — All stores use `threading.Lock` for thread safety, but the FastAPI application is async. The `threading.Lock` is correct for cross-thread usage (gRPC threads), but within the asyncio event loop, holding a blocking `threading.Lock` in an async context — even briefly — blocks the event loop. The `with self._lock` blocks inside `get_all_node_statuses`, `get_gpu_history`, etc. are called from async route handlers without `await`. Under heavy concurrent request load, the event loop stalls while waiting for the lock.
- **Suggested Fix** — Consider using `asyncio.Lock` for the async code paths, with a separate `threading.Lock` only for gRPC-thread access. Or structure the data access so that the main asyncio loop owns the stores and gRPC threads submit updates via `call_soon_threadsafe` / `asyncio.Queue`.

---

### DETECTOR ACCURACY

---

**Finding 23**
- **File:Line** — `app/detectors/zscore.py:50–62`
- **Category** — Bug
- **Risk Level** — MEDIUM
- **Description** — `_compute_zscore` computes the z-score of the last value against the **entire window including that last value** in the mean and std. This underestimates the z-score because the anomalous point pulls the mean toward itself and inflates the standard deviation. The minimum of 10 samples is too low — with only 10 samples, the z-score is highly sensitive to noise and the max possible z-score is bounded by `(n-1)/sqrt(n) ≈ 2.85` for n=10, making the threshold of 3.0 nearly unreachable for the smallest window.
- **Suggested Fix** — Compute mean and std over all samples **except** the last (the test point), then compute the z-score of the last value against that baseline. This is the standard approach for anomaly detection. Also raise the minimum sample count to at least 30.

---

**Finding 24**
- **File:Line** — `app/detectors/zscore.py:110–138`
- **Category** — Bug
- **Risk Level** — MEDIUM
- **Description** — `run_zscore_detection` checks the same metric across three overlapping windows (5, 15, 60 minutes). A single anomalous spike generates up to 3 duplicate alerts for the same event and the same field. Each duplicate is stored in `alert_store` and `anomaly_store`, polluting the downstream diagnosis context. The auto-diagnosis loop will trigger separate LLM calls for each duplicate.
- **Suggested Fix** — Deduplicate alerts by (node_id, alert_type) within a configurable cooldown window before storing, or only generate an alert for the smallest window that triggers. Alternatively track a per-(node, field) last-alerted timestamp.

---

**Finding 25**
- **File:Line** — `app/detectors/cross_node.py:112–113`
- **Category** — Bug
- **Risk Level** — MEDIUM
- **Description** — When correlated failures are detected, the alert is created with `node_id=",".join(affected_nodes)`. This is a comma-separated multi-node ID string, not a valid node ID. The `AlertModel.node_id` field is typed as `str` with no validation, so this silently passes. Downstream, `alert_store.query(node_id=some_id)` will never find this alert. `enrich_alert` will call `metrics_store.get_gpu_history(",".join(affected_nodes), ...)` which returns `[]`. The WebSocket `_matches_filter` comparison will fail for all client filters. The `node_id` in the diagnosis result will be a comma-joined string that breaks UI display.
- **Suggested Fix** — Create one alert per affected node with correlated evidence, or create a synthetic `node_id` like `"cluster"` with a clear convention, or add a `affected_nodes: list[str]` field to `AlertModel`.

---

**Finding 26**
- **File:Line** — `app/detectors/diloco.py:170–218` (`_detect_sync_duration_spikes`)
- **Category** — Bug
- **Risk Level** — MEDIUM
- **Description** — The function computes `hist_mean = float(np.mean(arr[:-1]))` — mean over all except the last entry — then compares against `durations[-1]`. However, `durations` is filtered from `history` to exclude zero values, meaning `arr[:-1]` may not correspond to the same indices as `history`. If the last zero-duration entry was in the middle of history and the actual last entry in `history` is not the same as `durations[-1]`, the comparison is against the wrong point.
- **Suggested Fix** — Store the index of the actual last entry before filtering zeros, or filter zeros before slicing `history` and use `history[-1].sync_duration_ms` only if it is non-zero.

---

### CODE QUALITY / FEATURE GAPS

---

**Finding 27**
- **File:Line** — `app/api/routes.py:186`
- **Category** — Code Quality
- **Risk Level** — MEDIUM
- **Description** — `create_diagnosis` is annotated as `-> Response` but the `response_model=DiagnosisResult` decorator is set on the route. FastAPI bypasses `response_model` validation when the handler returns a `Response` object directly. This means the response schema in OpenAPI docs is `DiagnosisResult`, but the actual serialization is done manually with `result.model_dump_json()`. If `DiagnosisResult` fields change, the documentation and implementation can silently diverge. Additionally, returning `Response` directly bypasses FastAPI's automatic JSON encoding of Python objects like `datetime`.
- **Suggested Fix** — Either remove `response_model=DiagnosisResult` and document the dual status codes separately, or use `JSONResponse` consistently, or (best) use proper `Annotated` response types with `responses={201: ..., 502: ...}` in the route decorator.

---

**Finding 28**
- **File:Line** — `app/models/alerts.py:14–16`
- **Category** — Code Quality
- **Risk Level** — MEDIUM
- **Description** — `severity`, `source`, and `alert_type` fields in `AlertModel` are plain `str` with no validation (no `Literal`, no `Enum`, no `validator`). Alerts with invalid severity like `"UNKNOWN"` or `"critical"` (lowercase) will be silently stored. The `AlertStore.query` filter does a string equality comparison, so filtering by `"CRITICAL"` will miss any `"critical"` entries.
- **Suggested Fix** — Use `Literal["INFO", "WARNING", "CRITICAL"]` for `severity`, `Literal["EDGE", "CENTRAL"]` for `source`, and either a `Literal` or `Enum` for `alert_type`.

---

**Finding 29**
- **File:Line** — `app/diagnosis/agent.py:51–78`
- **Category** — Feature Gap
- **Risk Level** — MEDIUM
- **Description** — `bypass_rate_limit=True` is passed from the manual diagnosis endpoint (`POST /api/v1/diagnoses`) but the rate limiter's `_last_call` is **not updated** when bypassing. This means a bypassed diagnosis does not reset the cooldown — the next auto-diagnosis attempt immediately after a manual bypass will still be blocked for the remaining cooldown period. The intention is unclear, but semantically inconsistent.
- **Suggested Fix** — After a successful bypassed diagnosis, call `self._rate_limiter.try_acquire(alert.node_id)` unconditionally to update the timestamp, or add a `force_acquire` method that always records the time without gating.

---

**Finding 30**
- **File:Line** — `app/diagnosis/rate_limiter.py:20–29`
- **Category** — Feature Gap
- **Risk Level** — MEDIUM
- **Description** — The rate limiter tracks only a single timestamp per node. There is no global budget (e.g., max 10 diagnoses per minute across all nodes). Under an alert storm affecting 20 nodes simultaneously, all 20 will each get a diagnosis triggered (one per node), consuming 20 LLM API tokens in 5 seconds. With the current 30-second cooldown per node, that is 40 calls/minute per 20-node cluster — well above Anthropic's free-tier limit.
- **Suggested Fix** — Add a global token bucket or leaky bucket across all nodes, in addition to per-node cooldown.

---

**Finding 31**
- **File:Line** — `app/enrichment.py:34–55`
- **Category** — Performance / Feature Gap
- **Risk Level** — MEDIUM
- **Description** — `enrich_alert` calls `get_gpu_history`, `get_training_history`, and `get_diloco_history` — each acquires `MetricsStore._lock` separately. Over a 4-minute window at 1-second resolution, this could pull up to 240 GPU frames × (number of GPUs) entries from the ring buffer. All entries are converted to `dict` via `gm.model_dump()` — this is serializing raw Pydantic objects to dicts then immediately re-serializing them to strings for the LLM prompt. This is two full serialization passes.
- **Suggested Fix** — Acquire the lock once and fetch all three metric types in a single call. Expose a `get_node_context(node_id, window_minutes)` method. Cache the `model_dump()` result or pass the model objects directly.

---

**Finding 32**
- **File:Line** — `app/ws/websocket.py:74–85` (`set_filter`)
- **Category** — Feature Gap / Security
- **Risk Level** — LOW
- **Description** — The client filter only supports `node_ids` and `severity`. Clients cannot filter by `alert_type`. With dozens of alert types, a dashboard showing only "xid_error" alerts has no way to subscribe to just those — it receives all severity-matching alerts and must filter client-side. There is also no limit on the number of `node_ids` a client can subscribe to, and no validation that node IDs are non-empty strings.
- **Suggested Fix** — Add `alert_types: list[str]` to `_ClientFilter`. Validate and cap the `node_ids` list length (e.g., max 50).

---

**Finding 33**
- **File:Line** — `app/detectors/zscore.py:23–24`
- **Category** — Feature Gap
- **Risk Level** — LOW
- **Description** — `_GPU_FIELDS` only monitors `gpu_temp_c` and `gpu_utilization_pct`. Critical fields like `power_usage_w`, `ecc_sbe_count`, `ecc_dbe_count`, `pcie_replay_counter`, and `fb_used_mb` (memory pressure) are not monitored by the z-score detector. The system can miss thermal throttling due to power limit, memory leaks, and ECC degradation — which are the primary failure modes for T4/L4 GPUs.
- **Suggested Fix** — Add `power_usage_w`, `fb_used_mb`, `ecc_sbe_count`, `ecc_dbe_count`, and `pcie_replay_counter` to `_GPU_FIELDS` with appropriate `_FIELD_TO_ALERT_TYPE` and `_FIELD_TO_SEVERITY` mappings. For counter fields (ECC, PCIe), detect rate-of-increase rather than raw z-score.

---

### TEST COVERAGE GAPS

---

**Finding 34**
- **File:Line** — `tests/` (all test files)
- **Category** — Feature Gap (Test Coverage)
- **Risk Level** — MEDIUM
- **Description** — The following are completely untested:
  1. `app/grpc_server.py` — No tests for `StreamMetrics`, `ReportAlert`, `Subscribe`, or the `_proto_*_to_model` conversion functions. The `HasField` bug (Finding 1) would have been caught immediately.
  2. `app/detectors/diloco.py` — No tests for the DiLoCo detector at all.
  3. `app/enrichment.py` — No direct tests for `enrich_alert`.
  4. `app/main.py` — No integration tests for the full lifespan (startup/shutdown), the auto-diagnosis loop, or the prom gauge loop.
  5. `app/stores.py` — `AnomalyStore.query` is untested. `JobStore` has no standalone test (only tested indirectly via API).
  6. `app/ws/websocket.py` — `broadcast_diagnosis`, `broadcast_metric_summary`, and `metric_summary_loop` have no tests. The stale-connection cleanup path is not tested.
  7. Concurrent access to stores from multiple gRPC threads (finding 22) is not tested.
  8. `app/generated/__init__.py` — The `sys.path` manipulation is never verified to work correctly.
- **Suggested Fix** — Add a `test_grpc_server.py` using `grpc.testing` or by directly calling the servicer methods with mock proto objects. Add `test_diloco.py` with at least the same coverage level as `test_zscore.py`. Add `test_enrichment.py`. Add a broadcast integration test using `pytest-asyncio` with real `asyncio.Queue` or `AsyncMock`.

---

**Finding 35**
- **File:Line** — `tests/conftest.py:94–112`
- **Category** — Code Quality (Tests)
- **Risk Level** — MEDIUM
- **Description** — The `fresh_stores` fixture patches `app.detectors.zscore.metrics_store` and `app.detectors.cross_node.metrics_store` but does **not** patch `app.detectors.diloco.metrics_store` (diloco is not imported). It also does not patch `app.enrichment.alert_store` for tests using `fresh_stores` directly (only `test_app` patches enrichment). This means tests that use `fresh_stores` and trigger enrichment will use the global singleton `alert_store`, creating test pollution between test runs.
- **Suggested Fix** — Patch all modules that import the store singletons in `fresh_stores`, including `app.detectors.diloco`. Use `importlib` to discover all importers, or list them explicitly.

---

**Finding 36**
- **File:Line** — `tests/conftest.py:121–130`
- **Category** — Code Quality (Tests)
- **Risk Level** — LOW
- **Description** — `test_app` mutates module-level attributes directly: `routes_mod.metrics_store = ms`. This works but leaves the module in a modified state if the test fails before the fixture teardown. Unlike `monkeypatch.setattr`, direct attribute mutation is not automatically reverted by pytest. Subsequent tests that import these modules may see the mutated state.
- **Suggested Fix** — Use `monkeypatch.setattr(routes_mod, "metrics_store", ms)` for all assignments in `test_app` so pytest reverts them automatically.

---

**Finding 37**
- **File:Line** — `app/diagnosis/prompts.py:151–153` (`build_system_prompt`)
- **Category** — Performance
- **Risk Level** — LOW
- **Description** — `build_system_prompt()` calls `get_catalog_prompt_text()` on every invocation, which iterates the `_ACTIONS` tuple and builds a string every time. This function is called for every LLM request (`agent.diagnose` → `build_system_prompt()`). The result is a constant string (the catalog never changes at runtime) and should be cached.
- **Suggested Fix** — Use `functools.lru_cache(maxsize=1)` on `build_system_prompt`, or compute `_SYSTEM_PROMPT_CACHED = build_system_prompt()` at module load time.

---

**Finding 38**
- **File:Line** — `app/stores.py:243–254` (`AlertStore.get_correlated`)
- **Category** — Bug
- **Risk Level** — LOW
- **Description** — `get_correlated` iterates in reverse chronological order (newest first, since the deque is appended newest-last) and scans all 1000 alerts. It has no early exit once it goes past `lo` (alerts older than `timestamp_ms - window_ms`). Since alerts are stored oldest-first in the deque, when iterating `reversed`, the scan goes from newest to oldest. Once the alert timestamp drops below `lo`, no further alerts can match but the scan continues to the end of the deque.
- **Suggested Fix** — Add `if alert.timestamp_ms < lo: break` inside the reversed iteration loop once you are scanning older alerts than the window. This turns worst-case O(N) into O(window_size) in the common case.

---

**Finding 39**
- **File:Line** — `app/diagnosis/agent.py:265–294` (`_make_failed_result`)
- **Category** — Code Quality
- **Risk Level** — LOW
- **Description** — `_make_failed_result` always sets `recommended_action` to `RecommendedAction(action="reassign_workload", params={}, urgency="monitor")`. This is a hardcoded default that will appear in every failed diagnosis result — rate-limited, timeout, or API error. The dashboard will display "Recommended: Reassign Workload" even for a rate-limited non-diagnosis, which is misleading.
- **Suggested Fix** — For failed/rate-limited results, use a sentinel action like `action="no_action"` (add to catalog), or make `recommended_action` optional (`None`) in `DiagnosisResult` for non-completed statuses.

---

## Summary

| Finding | Category | Risk |
|---|---|---|
| 1 — `HasField` on scalar proto field crashes ReportAlert | Bug | BREAKING |
| 2 — Sequential async LLM calls starve the event loop | Bug | BREAKING |
| 3 — WS lock held during send; stale cleanup logic wrong | Bug | HIGH |
| 4 — `active_count` reads without lock | Bug | HIGH |
| 5 — `_last_outer_step` global: no lock, no counter-reset handling | Bug | HIGH |
| 6 — CORS origins hardcoded, no env override | Security | HIGH |
| 7 — gRPC server has no TLS or auth | Security | HIGH |
| 8 — Linear alert scan is a DoS surface; no API rate limiting | Security | MEDIUM |
| 9 — Severity/alert_type query params not validated | Security | MEDIUM |
| 10 — API key silently swallowed on client init failure | Security | MEDIUM |
| 11 — Zscore detection blocks event loop; excessive lock contention | Performance | HIGH |
| 12 — Auto-diagnosis loop does 10,000 comparisons per 5s cycle | Performance | HIGH |
| 13 — WS broadcast serializes per-connection while holding lock | Performance | MEDIUM |
| 14 — Repeated lock acquisitions per field per detector call | Performance | MEDIUM |
| 15 — Sequential LLM calls in auto-diagnosis; up to 100s per cycle | Performance | MEDIUM |
| 16 — Module-level globals: task list and `_last_outer_step` persist across restarts | Architecture | HIGH |
| 17 — Subscribe RPC saturates gRPC thread pool with 1s sleeps | Architecture | HIGH |
| 18 — JobStore is unbounded (memory leak) | Architecture | MEDIUM |
| 19 — Double-checked locking not safe in free-threaded Python | Architecture | MEDIUM |
| 20 — `sys.path.insert` in `__init__.py` pollutes global path | Architecture | MEDIUM |
| 21 — gRPC port hardcoded, not env-configurable | Architecture | MEDIUM |
| 22 — `threading.Lock` inside async route handlers blocks event loop | Architecture | MEDIUM |
| 23 — Z-score includes the anomalous point in mean/std; min-10 too low | Detector Accuracy | MEDIUM |
| 24 — Triple-window detection generates 3 duplicate alerts per anomaly | Detector Accuracy | MEDIUM |
| 25 — Correlated failure alert uses comma-joined string as `node_id` | Detector Accuracy | MEDIUM |
| 26 — Sync spike detector filters zeros after slicing, wrong comparison | Detector Accuracy | MEDIUM |
| 27 — `response_model` on `Response`-returning handler is silently ignored | Code Quality | MEDIUM |
| 28 — `severity`/`source`/`alert_type` have no enum validation | Code Quality | MEDIUM |
| 29 — `bypass_rate_limit` doesn't update the limiter's timestamp | Feature Gap | MEDIUM |
| 30 — No global budget across nodes for LLM calls | Feature Gap | MEDIUM |
| 31 — `enrich_alert` acquires lock 3 times; double-serializes metrics | Performance | MEDIUM |
| 32 — WebSocket filter can't subscribe by `alert_type` | Feature Gap | LOW |
| 33 — Zscore only monitors 2 of ~10 critical GPU fields | Feature Gap | LOW |
| 34 — Zero test coverage for gRPC server, DiLoCo detector, enrichment, WS broadcast | Test Gaps | MEDIUM |
| 35 — `fresh_stores` fixture doesn't patch diloco or enrichment module | Test Quality | MEDIUM |
| 36 — `test_app` uses direct attribute mutation instead of monkeypatch | Test Quality | LOW |
| 37 — `build_system_prompt()` rebuilds constant string on every LLM call | Performance | LOW |
| 38 — `get_correlated` has no early exit past the time window | Bug | LOW |
| 39 — Failed diagnoses always show "Reassign Workload" as recommendation | Code Quality | LOW |

---

