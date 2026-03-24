Now let me read the build.rs and Cargo.toml, and also read the generated proto file to understand the full schema:

---

I now have a complete picture of all source files. Let me compile my findings into a thorough review.

---

# Deep Code Review: SolProbe Rust Sidecar

---

## BREAKING Issues

---

**Finding 1**
- **File:Line** `src/main.rs:172-176`
- **Category** Bug
- **Risk Level** BREAKING
- **Description** `signal::ctrl_c()` is an `async fn` that returns a `Future`, but it is called without `.await` inside the `tokio::select!` block. On the `#[cfg(unix)]` path, `ctrl_c` is bound as a `Future` value and then passed as a select branch — this is correct syntax. However, `signal::ctrl_c()` itself creates a new `Ctrl-C` listener every time the closure runs. If the shutdown task is ever restarted or the future is re-polled after cancellation this silently misses signals. More critically, the `expect("Failed to register SIGTERM handler")` at line 173 will **panic the tokio runtime thread** if the process's signal handler table is full or `signal()` fails for any OS reason. This panic is unrecoverable on the signal-handling task.
- **Suggested Fix** Wrap `signal::unix::signal(...)` in a `match` and log + fall back to SIGINT-only if SIGTERM registration fails. Never `expect()` inside a spawned task.

---

**Finding 2**
- **File:Line** `src/main.rs:185`
- **Category** Bug
- **Risk Level** BREAKING
- **Description** On non-unix platforms (Windows), `ctrl_c.await.expect("Failed to listen for Ctrl+C")` panics the spawned task if `ctrl_c` returns an error (e.g., in a container without a console). A panic inside a `tokio::spawn`ed task does not propagate to the main task — it only generates an "unhandled panic" log message, meaning the shutdown logic silently dies. The process then runs forever and cannot be stopped gracefully.
- **Suggested Fix** Replace `expect` with `if let Err(e) = ctrl_c.await { tracing::error!(...); }` and still send the shutdown signal.

---

**Finding 3**
- **File:Line** `src/main.rs:218`
- **Category** Bug
- **Risk Level** BREAKING
- **Description** The NCCL timeout hang path calls `shutdown_rx.changed().await` directly (not inside a `select!`). `watch::Receiver::changed()` returns an error (`RecvError`) if the sender is dropped. If `shutdown_tx` is dropped (e.g., the signal handler task panicked), this call returns immediately with `Err`, the `let _ =` silently discards it, and `break` is hit — so the process exits correctly. BUT: if the signal handler task is still alive and the process is waiting here, `Ctrl-C` *will* eventually work. However, there is a gap: the tick at which the hang is detected (after tick 5) still runs all the remaining code after the `if` block (lines 223–278) for tick 5 itself before the hang path is taken on tick 6+, because the `if is_nccl_timeout && tick_count > 5` check is done after the tick, not before collection. The first 5 ticks still emit zeroed metrics (from `nccl_timeout` fault) which look like a stalled node — but there is no alert fired for this because the detector has no zero-utilization / hang detection. The feature works by accident (stopping metric emission) but the hang is never actually **detected and alerted** — it relies on the Python backend doing cross-node correlation, which is the intended design. This is a documentation/test gap more than a pure bug, but it means the e2e test cannot verify that the sidecar raises a `NcclTimeout` alert on its own.

---

## HIGH Severity Issues

---

**Finding 4**
- **File:Line** `src/main.rs:246-253` and `src/main.rs:261-268`
- **Category** Architecture / Performance
- **Risk Level** HIGH
- **Description** Every tick spawns up to `N+1` new tokio tasks (one per alert + one for metrics streaming), where N is the number of active alerts. All of these tasks compete to acquire the same `Arc<tokio::sync::Mutex<GrpcTransport>>`. This creates a **lock convoy**: if the backend is slow or disconnected, reconnection attempts stack up tick-over-tick. After 10 ticks with alerts on every tick, there will be 10 pending tasks all holding or waiting for the same mutex. The metrics stream task and multiple alert tasks interleave lock acquisition unpredictably. Under a high-alert scenario (e.g., persistent thermal throttle), this grows unboundedly — there is no cap on in-flight tasks.
- **Suggested Fix** Use a single dedicated task with a bounded `mpsc` channel (or use `try_lock` + drop on contention) rather than spawning a new task per alert per tick. Alternatively, process all gRPC sends for a tick serially within the tick's `select!` branch.

---

**Finding 5**
- **File:Line** `src/transport/grpc.rs:93` and `src/transport/grpc.rs:127`
- **Category** Bug
- **Risk Level** HIGH
- **Description** Both `stream_metrics` and `report_alert` call `self.client.as_mut().unwrap()` immediately after a `try_connect()` that returned `true`. If `try_connect` sets `self.client = Some(client)` on line 71 but then the `is_none()` check at line 87/121 passes *and* `try_connect` returns `true`, the `unwrap()` is safe. However, there is a TOCTOU hazard: the entire `GrpcTransport` struct is behind `Arc<tokio::sync::Mutex<...>>`. When two spawned tasks both hold the lock sequentially, the second task re-checks `is_none()` after acquiring the lock, which is fine. But if `stream_metrics` calls `try_connect` which fails (returns `false`) and then somehow falls through (it returns early with `Err` — so this path is safe as written). The real risk is the `unwrap()` itself: if `try_connect` has a race condition or the internal logic changes, this will panic. The `unwrap()` should be replaced with a proper `?` or `return Err(...)`.
- **Suggested Fix** Replace both `unwrap()` calls with `ok_or("client missing after successful connect")?` or restructure using `if let Some(client) = &mut self.client`.

---

**Finding 6**
- **File:Line** `src/transport/grpc.rs:26-61`
- **Category** Architecture
- **Risk Level** HIGH
- **Description** The `connect()` method with retry is marked `#[allow(dead_code)]` — it is **never called**. The main loop only calls `try_connect()` (no retry, one shot) at startup and re-calls it on each failed RPC. This means if the backend is temporarily unavailable at startup, the sidecar silently runs without a connection and logs one warn-level message. Each subsequent tick spawns a new task that calls `try_connect()` — these are all one-shot attempts with no delay between them, effectively hammering the backend every second. The exponential-backoff `connect()` method is dead code and the retry logic is effectively absent.
- **Suggested Fix** Remove `#[allow(dead_code)]` and wire `connect()` into the startup path, or implement reconnect backoff inside `GrpcTransport` using an internal `last_attempt` timestamp to throttle reconnect attempts.

---

**Finding 7**
- **File:Line** `src/collectors/training.rs:38-40` and `src/collectors/diloco.rs:44-46`
- **Category** Security / Correctness
- **Risk Level** HIGH
- **Description** `unsafe { Mmap::map(&file) }` opens a shared-memory-mapped file in `/tmp` that is written by an **external process** (the PyTorch callback). The `Safety` comment on line 39 claims "we only read from the mmap" — but this is insufficient for safety. The mmap data can change between the `len()` check and any subsequent byte read (TOCTOU). More critically, the PyTorch side writes integer/float fields in-place without a write fence or lock. If the Python writer updates a multi-byte field (e.g., the 8-byte `timestamp_ms`) while Rust is reading it, Rust may observe a **torn read** — reading the first 4 bytes before the write and the last 4 bytes after, producing a completely invalid timestamp. On x86-64 this is unlikely but not impossible under OS preemption at byte boundaries. The `unsafe` block is technically unsound: the language spec permits the writer to produce any bit pattern at any point.
- **Suggested Fix** Use a seqlock pattern: have the writer increment a sequence counter (odd = writing, even = valid), and the reader spin-re-reads if the counter changed during the read. Alternatively, use a dedicated named pipe, Unix socket, or a lock file instead of raw mmap for the IPC channel.

---

**Finding 8**
- **File:Line** `src/main.rs:282-283`
- **Category** Architecture
- **Risk Level** HIGH
- **Description** Shutdown calls `prom_handle.abort()` and `shutdown_handle.abort()`. `JoinHandle::abort()` sends a cancel signal but **does not wait** for the task to actually finish. The HTTP server (axum) may have in-flight requests that are abruptly terminated. More importantly, there is no drain/flush of the gRPC transport: any in-flight `stream_metrics` or `report_alert` spawned tasks are leaked. The process exits immediately after `abort()` without `await`ing completion, meaning the OS will kill them mid-RPC.
- **Suggested Fix** Send the shutdown signal to the Prometheus HTTP server via a shutdown channel (axum supports `with_graceful_shutdown`). Await all spawned gRPC tasks using a `JoinSet` or by joining the handles before returning from `main`.

---

## MEDIUM Severity Issues

---

**Finding 9**
- **File:Line** `src/simulator.rs:38`
- **Category** Performance
- **Risk Level** MEDIUM
- **Description** `rand::thread_rng()` is called once per `generate()` call which happens every tick (1 Hz). `thread_rng()` acquires a thread-local RNG seeded from the OS, which is fine, but the real issue is that `generate()` calls three functions (`generate_gpu_metrics`, `generate_training_metrics`, `generate_diloco_metrics`) each taking `rng: &mut impl Rng`. The RNG is passed by mutable reference correctly. However, `Simulator` is behind a `std::sync::Mutex` in `SimulatorCollector`, and the entire lock is held for the duration of all three `generate_*` calls plus RNG seeding. Since this is a `std::sync::Mutex` (not tokio), holding it across what could be a slow system call (in a real implementation) would block the async executor thread. Currently the only work inside the lock is fast CPU math, so this is acceptable — but the design is fragile.
- **Suggested Fix** Store the RNG inside `Simulator` (seeded once at construction) to avoid re-seeding each tick, and consider replacing `std::sync::Mutex` with `tokio::sync::Mutex` if any async work ever needs to happen inside `collect()`.

---

**Finding 10**
- **File:Line** `src/simulator.rs:28-33`
- **Category** Bug
- **Risk Level** MEDIUM
- **Description** `now_ms()` casts `as_millis()` (a `u128`) to `i64`. This is safe until ~year 292,278,994 for Unix timestamps, but `as_millis() as i64` will silently wrap if the `u128` value exceeds `i64::MAX`. No checked cast is used. The same pattern appears identically in `src/detectors/threshold.rs:25-29`. While not practically dangerous today, it is an incorrect cast: `u128 as i64` is defined to truncate in Rust (no overflow check), not to panic or saturate.
- **Suggested Fix** Use `i64::try_from(millis).unwrap_or(i64::MAX)` or accept the semantic that timestamps saturate at `i64::MAX`.

---

**Finding 11**
- **File:Line** `src/detectors/threshold.rs:317-333`
- **Category** Bug
- **Risk Level** MEDIUM
- **Description** The Xid error check fires a `Severity::Critical` alert for **any** non-zero `xid_errors` value, regardless of whether the code is in `critical_xid_codes`. The `is_critical_xid` field is computed and stored in the evidence map (line 322), but the severity is always `Critical`. This means a benign Xid code (e.g., Xid 31 = "GPU memory page fault" which can be non-fatal) generates the same severity as a fatal Xid 79 (MIG mode violation / GPU engine hang). The evidence map correctly records `is_critical_xid` but the alert severity does not use it.
- **Suggested Fix** Check `is_critical` and use `Severity::Warning` for non-critical Xid codes and `Severity::Critical` only for codes in `critical_xid_codes`.

---

**Finding 12**
- **File:Line** `src/detectors/threshold.rs:354-373`
- **Category** Bug
- **Risk Level** MEDIUM
- **Description** The clock throttle detector fires a `Severity::Warning` alert for **any** non-zero `clock_throttle_reasons`, including bit 0x1 (`GpuIdle`). `GpuIdle` means the GPU is idle and has reduced its own clock — this is entirely normal behavior and should not generate an alert. Similarly, bits `0x2` (`ApplicationsClocksSetting`) and `0x10` (`SyncBoost`) are benign operational states. Firing a warning every time the GPU idles will generate alert spam.
- **Suggested Fix** Mask out benign bits (`GpuIdle`, `ApplicationsClocksSetting`, `SyncBoost`) before checking for non-zero. Only alert on hardware throttle bits: `HwSlowdown (0x8)`, `SwThermalSlowdown (0x20)`, `HwThermalSlowdown (0x40)`, `HwPowerBrakeSlowdown (0x80)`.

---

**Finding 13**
- **File:Line** `src/collectors/diloco.rs:21-23` and lines `73-83`
- **Category** Bug
- **Risk Level** MEDIUM
- **Description** The comment on line 19 says "The spec says 42 bytes, but with correct field sizes it is 46." The code accepts files `>= DILOCO_MIN_SIZE (42)`. However, the boundary checks for optional fields are wrong: `worker_speed_ratio` is read when `buf.len() > 44` (line 73), meaning it requires at least 45 bytes, which reads bytes 41–44 (4 bytes). But the field starts at offset 41 and ends at 45 — so for a 45-byte file (`buf.len() == 45`), `buf.len() > 44` is true (45 > 44), but `buf[41..45]` needs exactly 45 bytes. A 45-byte file is borderline. Then `is_straggler` checks `buf.len() > 45` (line 79), requiring 46 bytes minimum. This means a 44-byte file (42 < 44 >= DILOCO_MIN_SIZE) will set `worker_speed_ratio = 1.0` and `is_straggler = false`, silently dropping real data without any warning logged.
- **Suggested Fix** Log a debug/warn when the file is between 42–46 bytes to alert operators about mismatched writer/reader versions. Consolidate on `DILOCO_RECORD_SIZE = 46` as the minimum, or explicitly document and test each partial size.

---

**Finding 14**
- **File:Line** `src/transport/prometheus.rs:11-17`
- **Category** Feature Gap
- **Risk Level** MEDIUM
- **Description** The Prometheus exporter exposes only 4 metrics: `gpu_temp`, `gpu_utilization`, `gpu_memory_used_pct`, and `gpu_power_watts`. The proto schema has 20+ fields per GPU (ECC errors, Xid errors, clock throttle reasons, PCIe replay counter, SM active %, tensor active %, page retirements, row remapping). None of these are exported. In particular, `ecc_dbe_count` (uncorrectable ECC errors), `xid_errors`, and `pcie_replay_counter` are critical for SRE alerting from Prometheus/Grafana but are completely absent.
- **Suggested Fix** Add `CounterVec` or `GaugeVec` for at minimum: `xid_errors`, `ecc_dbe_count`, `ecc_sbe_count`, `clock_throttle_reasons`, `pcie_replay_counter`, `sm_active_pct`, `tensor_active_pct`. Also add training metrics: `loss`, `gradient_norm`, `throughput_tps`, `mfu_pct`.

---

**Finding 15**
- **File:Line** `src/transport/prometheus.rs:55-75`
- **Category** Bug / Performance
- **Risk Level** MEDIUM
- **Description** `PrometheusExporter::update()` calls `with_label_values(labels)` on every tick, which creates a new `Gauge` time-series entry in the registry for each `(node_id, gpu_index)` pair it sees. If the `node_id` string changes between ticks (e.g., config reload, or a bug in the collector), stale label sets accumulate in the registry forever and are never cleaned up. Prometheus registries do not automatically expire unused label sets — they grow monotonically in memory. This is a slow memory leak under any dynamic labeling scenario.
- **Suggested Fix** Either cache the `Gauge` references per GPU index at construction time (since the node_id and gpu_index are fixed for the process lifetime), or document clearly that node_id must never change at runtime.

---

**Finding 16**
- **File:Line** `src/collectors/training.rs:35-37` (and `diloco.rs:42-44`)
- **Category** Performance
- **Risk Level** MEDIUM
- **Description** `TrainingMetricsReader::read()` opens the file with `File::open()` and creates a new `Mmap` on **every call** — i.e., every second. Opening a file and mapping it into the process address space is a non-trivial system call sequence (open → fstat → mmap → madvise). Unmapping on drop is also a syscall. This adds at least 3–4 syscalls per second per reader (2 readers = 6–8 syscalls/sec) that are entirely unnecessary since the file path never changes.
- **Suggested Fix** Open and mmap the file once at construction time and keep the `Mmap` alive for the process lifetime. Re-open only if `File::open` fails (file was replaced). Add `madvise(MADV_RANDOM)` hint since only the first `TRAINING_RECORD_SIZE` bytes are ever read.

---

**Finding 17**
- **File:Line** `src/transport/grpc.rs:84-117`
- **Category** Architecture
- **Risk Level** MEDIUM
- **Description** The `StreamMetrics` RPC is implemented as a **client-streaming** call: a new streaming RPC is opened, one `MetricsBatch` is sent, the sender is dropped (closing the stream), and the sidecar waits for a `StreamAck`. This creates a full gRPC round-trip (connection setup + streaming call + teardown) per batch — effectively the same cost as a unary call but with more overhead. A truly streaming design would keep a single long-lived bidirectional or client-streaming RPC open and push batches through it, which would reduce latency from ~50ms (new stream per call) to sub-millisecond per batch.
- **Suggested Fix** Open a persistent client-streaming RPC at startup and keep an `mpsc::Sender<MetricsBatch>` for the main loop to push into. Only reconnect the stream on error.

---

## LOW Severity Issues

---

**Finding 18**
- **File:Line** `src/simulator.rs:56`
- **Category** Feature Gap (Simulator Realism)
- **Risk Level** LOW
- **Description** Temperature is generated as a sine wave with a fixed 0.05 rad/tick period. At 1 tick/sec this completes a full sine cycle in ~126 seconds. Real T4/L4 GPU temperature changes are much slower (thermal mass means they rise/fall over minutes under load). The fast oscillation means the threshold detector (`temp_warn_c: 80.0`) will be regularly triggered during the sine wave's peak (55.5 + 20.5 = 76.0 max — actually never exceeds warn threshold in normal mode). This is actually correct by coincidence (76 < 80), but the period is unrealistic for demo purposes.
- **Suggested Fix** Replace the fast sine with a slower thermal model: idle baseline + load-proportional heating term + exponential cooling, with a realistic thermal time constant of ~120 seconds.

---

**Finding 19**
- **File:Line** `src/simulator.rs:59-61`
- **Category** Feature Gap (Simulator Realism)
- **Risk Level** LOW
- **Description** GPU utilization is generated as a uniform random value between 70–95%, with 1-in-20 dips to 20–30%. Real GPU utilization during training is mostly high (>90%) with brief drops during data loading pipeline stalls or optimizer steps. The utilization pattern does not model PCIe data transfer stalls (where `mem_copy_utilization_pct` spikes while `gpu_utilization_pct` drops), which is a common source of false straggler detection.
- **Suggested Fix** Correlate `mem_copy_util` and `gpu_util` inversely during simulated data-loading phases.

---

**Finding 20**
- **File:Line** `src/simulator.rs:65-66`
- **Category** Bug (Simulator Realism)
- **Risk Level** LOW
- **Description** Memory fill uses `fill_frac = 0.60 + 0.25 * (1.0 - exp(-0.005 * t))`. This is a correct monotone-increasing curve reaching 85% asymptotically. However `fb_used` is computed as `f64 * f32` then cast to `f32`. The intermediate computation `self.fb_total_mb as f64 * fill_frac` casts a `f32` (fb_total_mb) to `f64` to preserve precision, which is correct. But then `as f32` truncates back to f32. The result is correct but the type dance is confusing — `fb_total_mb` should just be stored as `f64` in the simulator.
- **Suggested Fix** Minor: store `fb_total_mb` and `tdp_watts` as `f64` in `Simulator` to avoid mixed-precision arithmetic.

---

**Finding 21**
- **File:Line** `src/simulator.rs:87`
- **Category** Bug
- **Risk Level** LOW
- **Description** `thermal_throttle` fault sets `temp = 92.0 + rng.gen_range(-0.5..0.5) as f64`. The `as f64` cast is applied to the result of `gen_range(-0.5..0.5)` which returns `f64` already (because the range bounds are `f64`). The cast is a no-op but suggests a type confusion — the author may have intended `rng.gen_range::<f32>(-0.5..0.5) as f64`. The critical threshold is 85.0°C, so 92.0 clears it by 7°C; the noise of ±0.5 is fine, but the code shows inconsistency since elsewhere `temp` is typed as `f64` but ultimately stored as `f32` in the proto struct.
- **Suggested Fix** Be consistent: either make the whole `generate_gpu_metrics` function use `f64` throughout and cast once at the struct literal, or use `f32` throughout.

---

**Finding 22**
- **File:Line** `src/config.rs:51-71`
- **Category** Code Quality
- **Risk Level** LOW
- **Description** `SidecarConfig::load_or_default` silently falls back to defaults on malformed TOML. This is logged at `warn` level but there is no way for an operator to detect that the config file was ignored at runtime (the process continues with defaults that may be dangerously permissive or conservative). There is also no config validation: a TOML file could set `temp_critical_c: -10.0` or `gradient_norm_critical: 0.0001` which would generate a flood of false alerts, and no validation catches this.
- **Suggested Fix** Add a `validate()` method on `ThresholdConfig` that checks ranges (e.g., `temp_warn_c < temp_critical_c`, both positive, `memory_warn_pct < memory_critical_pct < 100.0`). Return an error (not just log-and-ignore) on invalid config.

---

**Finding 23**
- **File:Line** `src/normalizer.rs:49-58`
- **Category** Bug
- **Risk Level** LOW
- **Description** `detect_profile("L4 GPU")` would correctly match "L4". However, `detect_profile("RTX 4090 L4-compatible")` would also match "L4" — a false positive. More practically, NVIDIA's naming sometimes uses "NVIDIA L4" which is fine, but also "GH200 L4" theoretical variants. The check is `upper.contains("T4")` — the string "A140" does not contain "T4" so that's fine, but the function is order-dependent: it checks T4 first, so "T4L4" (hypothetical) would match T4. This is an edge case, but the `#[allow(dead_code)]` annotation on `detect_profile` means it is never actually called in production code — the normalizer module is used only for `memory_used_pct`, so this whole profile detection system is dead code.
- **Suggested Fix** Either integrate `detect_profile` into `DcgmCollector` or remove it. If kept, prefer exact matching over `contains()`.

---

**Finding 24**
- **File:Line** `src/detectors/threshold.rs:50`
- **Category** Code Quality
- **Risk Level** LOW
- **Description** `gpu_index: gpu_index` — the redundant field shorthand `gpu_index` (using field init shorthand) on line 50 is written as `gpu_index: gpu_index` instead of just `gpu_index`. While functionally identical, this inconsistency with Rust idiom (all other fields use shorthand in the same struct) suggests a subtle copy-paste from an older style.
- **Suggested Fix** Change to the field shorthand `gpu_index,` per Rust style convention.

---

## ENHANCEMENT (Feature Ideas)

---

**Finding 25**
- **File:Line** `src/transport/grpc.rs:1-143` (whole file)
- **Category** Feature Gap
- **Risk Level** ENHANCEMENT
- **Description** The `Subscribe` RPC (backend → sidecar command channel) is fully generated in the proto client stub (lines 467–491 of the generated code) and the server trait requires it, but the sidecar never calls `client.subscribe()`. This means the backend has no way to push threshold updates, fault injection commands, or config reloads to a running sidecar at runtime. The proto `Command` message supports `update_thresholds`, `inject_fault`, etc. but this channel is completely unimplemented on the client side.
- **Suggested Fix** Spawn a subscribe task after connection that calls `client.subscribe(NodeRegistration{...})` and processes incoming `Command` messages — at minimum handling `update_thresholds` to allow live threshold changes without restart.

---

**Finding 26**
- **File:Line** `src/main.rs:196`
- **Category** Feature Gap
- **Risk Level** ENHANCEMENT
- **Description** The collection interval is hardcoded to 1 second (`Duration::from_secs(1)`). DCGM supports 100ms profiling intervals for PROF_* metrics (SM active, tensor active, PCIe bytes). The current design cannot capture sub-second GPU utilization spikes, which are the most common manifestation of training pipeline bubbles and straggler effects. There is no `--interval` CLI flag and no config field for this.
- **Suggested Fix** Add an `interval_ms: u64` field to `SidecarConfig` (default 1000) and expose `--interval-ms` as a CLI argument. Use `tokio::time::interval(Duration::from_millis(...))`.

---

**Finding 27**
- **File:Line** `src/collectors/dcgm.rs:1-26` (whole file)
- **Category** Feature Gap
- **Risk Level** ENHANCEMENT
- **Description** The `DcgmCollector` is a stub that always returns `CollectorError::Unavailable`. There is no real DCGM integration — not even a mock of the dcgm-rs bindings or the DCGM REST API. For a portfolio project targeting a GPU infrastructure role, the absence of even a skeleton of real DCGM field queries (via `dcgm_client` crate or FFI to `libdcgm.so`) is a significant gap. The `--simulate` flag workaround means the system has never collected a single real GPU metric.
- **Suggested Fix** Implement at minimum the DCGM REST API path (DCGM exposes a local HTTP server at port 5555) as the real collector, with a compile-time feature flag `cfg(feature = "real-dcgm")` to gate it.

---

**Finding 28**
- **File:Line** `src/simulator.rs:205-232` (DiLoCo metrics)
- **Category** Feature Gap (Simulator Realism)
- **Risk Level** ENHANCEMENT
- **Description** The simulated `DiLoCoMetrics.worker_speed_ratio` is always close to 1.0 (±5%), and `is_straggler` is always `false`. The straggler detection feature of DiLoCo is one of SolProbe's differentiators, but the simulator never generates a straggler scenario, making it impossible to demo the straggler detection path end-to-end. There is also no fault injection type for straggler simulation.
- **Suggested Fix** Add a `"straggler"` fault injection type that sets `worker_speed_ratio` to 0.3–0.5 and `is_straggler` to `true` in the DiLoCo metrics, with a matching detector check in `ThresholdDetector`.

---

**Finding 29**
- **File:Line** `src/detectors/threshold.rs:229-427` (entire `check` impl)
- **Category** Feature Gap
- **Risk Level** ENHANCEMENT
- **Description** The threshold detector checks individual metrics independently on every tick with no debouncing or hysteresis. A single high-temperature reading (e.g., from a transient spike) generates an alert immediately. In production, this leads to alert storms: a brief thermal spike produces `critical` alerts on every tick until it clears, potentially flooding the gRPC channel and the backend. There is no state carried between ticks (no `last_alert_time`, no `consecutive_violations`, no cooldown period).
- **Suggested Fix** Add a `HashMap<AlertType, Instant>` cooldown registry to `ThresholdDetector` (requires making it `mut` or using interior mutability). Only re-fire an alert if the condition has persisted for N consecutive ticks or has not fired within a cooldown window (e.g., 60 seconds).

---

## Summary Table

| # | File:Line | Category | Risk |
|---|-----------|----------|------|
| 1 | `main.rs:173` | Bug | BREAKING |
| 2 | `main.rs:185` | Bug | BREAKING |
| 3 | `main.rs:218` | Bug | BREAKING |
| 4 | `main.rs:246-268` | Architecture/Performance | HIGH |
| 5 | `grpc.rs:93,127` | Bug | HIGH |
| 6 | `grpc.rs:26-61` | Architecture | HIGH |
| 7 | `training.rs:38`, `diloco.rs:44` | Security/Correctness | HIGH |
| 8 | `main.rs:282-283` | Architecture | HIGH |
| 9 | `simulator.rs:38` | Performance | MEDIUM |
| 10 | `simulator.rs:28-33`, `threshold.rs:25-29` | Bug | MEDIUM |
| 11 | `threshold.rs:317-333` | Bug | MEDIUM |
| 12 | `threshold.rs:354-373` | Bug | MEDIUM |
| 13 | `diloco.rs:21-83` | Bug | MEDIUM |
| 14 | `prometheus.rs:11-17` | Feature Gap | MEDIUM |
| 15 | `prometheus.rs:55-75` | Bug/Performance | MEDIUM |
| 16 | `training.rs:35-37`, `diloco.rs:42-44` | Performance | MEDIUM |
| 17 | `grpc.rs:84-117` | Architecture | MEDIUM |
| 18 | `simulator.rs:56` | Feature Gap | LOW |
| 19 | `simulator.rs:59-61` | Feature Gap | LOW |
| 20 | `simulator.rs:65-66` | Bug | LOW |
| 21 | `simulator.rs:87` | Bug | LOW |
| 22 | `config.rs:51-71` | Code Quality | LOW |
| 23 | `normalizer.rs:49-58` | Bug | LOW |
| 24 | `threshold.rs:50` | Code Quality | LOW |
| 25 | `grpc.rs` (whole) | Feature Gap | ENHANCEMENT |
| 26 | `main.rs:196` | Feature Gap | ENHANCEMENT |
| 27 | `dcgm.rs` (whole) | Feature Gap | ENHANCEMENT |
| 28 | `simulator.rs:205-232` | Feature Gap | ENHANCEMENT |
| 29 | `threshold.rs:229-427` | Feature Gap | ENHANCEMENT |

---

**Key themes across the codebase:**

1. **Shutdown is not graceful** — the entire gRPC task fan-out (Findings 4, 8) means in-flight RPCs are silently killed on `abort()`. This is the most operationally dangerous cluster of issues.

2. **Unsafe mmap IPC is unsound** (Finding 7) — torn reads are possible without a seqlock. This is the most serious correctness issue and affects the primary data path between PyTorch and the sidecar.

3. **The gRPC reconnect strategy is inverted** (Finding 6) — the exponential-backoff `connect()` exists but is dead code. The live path hammers the backend every second during an outage.

4. **Prometheus coverage is sparse** (Finding 14) — only 4 of 20+ available GPU metrics are exported, making the Grafana dashboards in SP-5 largely unable to display the hardware health data the system collects.

5. **Detector has no debouncing** (Finding 29) — a persistent condition generates unbounded alert volume, which will overwhelm the backend's alert storage and the LLM diagnosis agent's rate limiter in SP-3.

---

