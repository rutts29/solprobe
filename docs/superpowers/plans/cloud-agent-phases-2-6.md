# SolProbe Review Mitigations — Cloud Agent Execution Plan (Phases 2-6)

## Context

You are executing Phases 2-6 of the SolProbe code review mitigation plan. Phase 1 is already complete (staking PDA signing + WebSocket stability). The full review findings are in `.review/solprobe_review_*.md` and the master plan is at `docs/superpowers/plans/2026-03-24-review-mitigations.md`.

**Execute each phase sequentially. After each phase, run all relevant tests and commit. If tests fail, fix before moving to the next phase. Do NOT skip phases.**

**NEVER add Co-Authored-By lines to commit messages.**

---

## Phase 2: Correctness Bugs (Demo-Visible)

**Commit message:** `fix: detection accuracy, alert handling, and Solana access control`

### 2A: Rust threshold detector fixes

File: `sidecar/src/detectors/threshold.rs`

1. **Xid severity**: Find the Xid error check that always uses `Severity::Critical`. Change it to use `Severity::Warning` for non-critical Xid codes and `Severity::Critical` only when `is_critical` is true. The `critical_xid_codes` set already exists in the code.

2. **Clock throttle benign bits**: Find the `clock_throttle_reasons != 0` check. Mask out benign bits before checking:
```rust
let alert_bits = gpu.clock_throttle_reasons & 0xE8; // HwSlowdown(0x8) | SwThermal(0x20) | HwThermal(0x40) | HwPowerBrake(0x80)
if alert_bits != 0 {
    // fire alert
}
```

3. Run `cd sidecar && cargo test` — 25 tests must pass.

### 2B: Python z-score detection fixes

File: `backend/app/detectors/zscore.py`

1. **Z-score calculation**: In `_compute_zscore`, change to compute mean/std over `values[:-1]` (exclude test point), then z-score the last value against that baseline. Also change minimum samples from 10 to 30.
```python
if len(values) < 30:
    return None
arr = np.array(values)
baseline = arr[:-1]
mean = float(np.mean(baseline))
std = float(np.std(baseline))
if std < 1e-9:
    return None
return (float(arr[-1]) - mean) / std
```

2. **Duplicate alert deduplication**: Add a module-level `_last_alerted: dict[tuple[str, str], float] = {}` and 60-second cooldown. Before creating an alert, check if the same `(node_id, alert_type)` has been alerted in the last 60 seconds. Skip if so, update timestamp if not.

3. **gpu_utilization_pct mapping**: Remove `"gpu_utilization_pct"` from `_GPU_FIELDS` entirely (high utilization is normal, not a throttle indicator).

File: `backend/app/detectors/cross_node.py`

4. **Comma-joined node_id**: Find where `node_id=",".join(affected_nodes)` is used. Change to create one alert per affected node in a loop:
```python
for node_id in affected_nodes:
    alert = AlertModel(
        node_id=node_id,
        # ... rest of fields, add evidence showing all correlated nodes
    )
    alerts.append(alert)
```

5. Run `cd backend && source .venv/bin/activate && python -m pytest tests/ -v` — 127+ tests must pass.

### 2C: Dashboard data correctness

File: `dashboard/src/app/alerts/page.tsx`

1. **Severity filter bypass**: In the `onAlert` callback (the `useCallback` that calls `prepend`), add a check:
```typescript
const onAlert = useCallback(
  (msg: { type: "alert"; data: AlertModel }) => {
    if (severity === "ALL" || msg.data.severity === severity) {
      prepend(msg.data);
    }
  },
  [prepend, severity]
);
```

File: `dashboard/src/components/charts/loss-chart.tsx`

2. **Log scale crash**: Filter out zero/negative values from chart data, or add a floor:
```typescript
const chartData = data.map(d => ({
  ...d,
  loss: Math.max(d.loss, 1e-8),
  gradNorm: Math.max(d.gradient_norm, 1e-8),
}));
```

File: `dashboard/src/components/overview/cluster-summary.tsx`

3. **NaN%**: Guard the memory percentage division with a zero-denominator check. Wherever `fb_used_mb / (fb_used_mb + fb_free_mb)` appears, replace with:
```typescript
const total = gpu.fb_used_mb + gpu.fb_free_mb;
const memPct = total > 0 ? (gpu.fb_used_mb / total) * 100 : 0;
```

File: `dashboard/src/components/nodes/node-card.tsx`

4. Apply the same NaN% fix.

File: `dashboard/src/components/layout/app-shell.tsx`

5. **Keyboard navigation**: Replace all `window.location.href = "/path"` with Next.js router navigation. Import `useRouter` from `next/navigation` and use `router.push("/path")`.

6. Run `cd dashboard && npx next build` — must compile clean.

### 2D: Solana access control

File: `solana/programs/solprobe-attestation/src/lib.rs`

1. **Attestation PDA seed constraint (A-2)**: In the `VerifyAttestation` accounts struct, change the `attestation` account from just `#[account(mut)]` to include PDA seed validation:
```rust
#[account(
    mut,
    seeds = [
        b"attestation",
        attestation.job_id.as_bytes(),
        &attestation.step.to_le_bytes(),
        attestation.worker.as_ref(),
    ],
    bump = attestation.bump,
)]
pub attestation: Account<'info, Attestation>,
```

2. **Age check (A-1)**: Replace `let age = clock.unix_timestamp - attestation.timestamp;` with:
```rust
let age = clock.unix_timestamp
    .checked_sub(attestation.timestamp)
    .ok_or(AttestationError::AttestationTooOld)?;
```

3. **Config validation (A-5)**: In `initialize_config`, add after the existing code:
```rust
require!(max_attestation_age_seconds > 0, AttestationError::InvalidConfig);
```
Add `InvalidConfig` to the error enum if it doesn't exist.

File: `solana/programs/solprobe-staking/src/lib.rs`

4. **Negative cooldown (S-5)**: In both `initialize_config` and `update_config`, add:
```rust
require!(cooldown_seconds >= 0, StakingError::InvalidCooldown);
```
Add `InvalidCooldown` to the error enum.

5. **has_one constraints (S-6)**: In `UpdateConfig` and `Slash` account structs, add `has_one = admin` to the `stake_config` account constraint.

6. Run `cd solana && anchor build && anchor test` — all 15 tests must pass. If any test breaks because of the new validation, update the test to pass valid values.

### 2E: Commit

```bash
git add -A
git commit -m "fix: detection accuracy, alert handling, and Solana access control"
```

---

## Phase 3: Architecture & Reliability

**Commit message:** `refactor: gRPC reliability, store bounds, and config improvements`

### 3A: Rust gRPC transport

File: `sidecar/src/transport/grpc.rs`

1. Replace both `self.client.as_mut().unwrap()` calls with `.ok_or_else(|| Box::<dyn std::error::Error + Send + Sync>::from("client not connected"))?`

2. Add reconnect throttling: add a `last_connect_attempt: Option<std::time::Instant>` field to `GrpcTransport`. In `try_connect`, return early with `false` if the last attempt was less than 5 seconds ago.

3. Run `cargo test`.

### 3B: Python backend hardening

File: `backend/app/stores.py`

1. Add `max_size` to `JobStore`: use `OrderedDict` with eviction when it exceeds 1000 entries. Match the pattern used by `AlertStore`.

File: `backend/app/main.py`

2. Make gRPC port configurable: change `start_grpc_server(port=50051)` to `start_grpc_server(port=int(os.environ.get("GRPC_PORT", "50051")))`.

3. Make CORS origins configurable: change the hardcoded list to `os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")`.

File: `backend/app/detectors/diloco.py`

4. Fix counter reset: in the `_last_outer_step` check, if `current_outer < prev_outer`, reset the entry (detect node restart).

5. Run `python -m pytest tests/ -v`.

### 3C: Docker Compose

File: `docker-compose.yml`

1. Add health checks to backend and sidecar services:
```yaml
backend:
  ...
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/api/v1/health"]
    interval: 10s
    timeout: 5s
    retries: 3
sidecar:
  ...
  depends_on:
    backend:
      condition: service_healthy
```

2. Add `env_file: [.env]` to the backend service.

3. Add a dashboard service:
```yaml
dashboard:
  build:
    context: .
    dockerfile: dashboard/Dockerfile
  ports:
    - "3000:3000"
  environment:
    - NEXT_PUBLIC_API_URL=http://backend:8000
  depends_on:
    backend:
      condition: service_healthy
```

4. Create `.env.example` at repo root with `ANTHROPIC_API_KEY=your-key-here`.

### 3D: Commit

```bash
git add -A
git commit -m "refactor: gRPC reliability, store bounds, and config improvements"
```

---

## Phase 4: Dashboard Polish

**Commit message:** `fix: dashboard race conditions, performance, and UX`

### 4A: Data fetching fixes

File: `dashboard/src/hooks/use-alerts.ts`
1. Add `setLoading(true)` at the start of `refresh()` before the fetch.

File: `dashboard/src/hooks/use-nodes.ts`
2. Add `setLoading(true)` at the start of `refresh()`.
3. Add `AbortController` — create one in the hook, pass `signal` to fetch, abort in cleanup.

File: `dashboard/src/components/alerts/alert-detail.tsx`
4. Add `let cancelled = false` guard in the useEffect. Check `if (cancelled) return;` before each setState. Return cleanup that sets `cancelled = true`.

File: `dashboard/src/app/alerts/page.tsx`
5. Reset `setSelectedAlert(null)` when `severity` state changes (add a useEffect).

### 4B: Performance

File: `dashboard/src/app/overview/page.tsx`
1. Wrap `avgGpuUtil` computation in `useMemo(() => { ... }, [nodes])`.

File: `dashboard/src/components/nodes/gpu-charts.tsx`
2. Wrap each `chartData` derivation (in MemoryBar, PowerChart, and the main GpuCharts) in `useMemo`.

File: `dashboard/src/app/diagnoses/page.tsx`
3. Wrap `nodeIds` in `useMemo(() => [...new Set(diagnoses.map(d => d.node_id))], [diagnoses])`.

### 4C: UX cleanup

File: `dashboard/src/components/diagnoses/action-panel.tsx`
1. Remove the disabled "Apply Fix (coming in SP-5)" button entirely.

File: `dashboard/src/lib/api.ts`
2. Remove `fetchAnomalies` and `fetchJobs` functions (dead code, unused).

File: `dashboard/src/components/diagnoses/evidence-chain.tsx`
3. Change `key={i}` to `key={item.metric || i}`.

File: `dashboard/src/app/error.tsx` (CREATE)
4. Add root error boundary:
```tsx
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-bold text-red-400">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">Try again</button>
    </div>
  );
}
```

5. Run `npx next build` — must compile clean.

### 4D: Commit

```bash
git add -A
git commit -m "fix: dashboard race conditions, performance, and UX"
```

---

## Phase 5: Solana Protocol Improvements

**Commit message:** `fix: Solana program validation, events, and test coverage`

### 5A: Staking hardening

File: `solana/programs/solprobe-staking/src/lib.rs`

1. Clamp slash amount: at the start of `slash`, add `let amount = std::cmp::min(amount, stake_account.staked_lamports);`

2. Replace all `.unwrap()` on `checked_add`/`checked_sub` with `.ok_or(StakingError::Overflow)?`. Add `Overflow` to the error enum.

### 5B: Reputation access control

File: `solana/programs/solprobe-reputation/src/lib.rs`

1. Replace all `.unwrap()` on checked arithmetic with `.ok_or(ReputationError::Overflow)?`. Add `Overflow` to error enum.

2. Remove unused `AlreadyRegistered` error variant.

3. Add comment documenting that in production, `record_completion`/`record_failure` should be gated by an oracle or CPI from the escrow program, not the worker's own authority.

### 5C: Escrow documentation and close_job fix

File: `solana/programs/solprobe-escrow/src/lib.rs`

1. In `close_job`, add a check that all workers are settled:
```rust
let all_settled = escrow.workers.iter().all(|w| w.released);
require!(all_settled, EscrowError::WorkersNotSettled);
```
Add `WorkersNotSettled` to the error enum.

2. Remove `Disputed` from `JobStatus` enum (dead code).

3. Add comments on `release_payment` and `slash_payment` documenting the trust model (worker self-release is demo-scope; production would require oracle/creator approval).

### 5D: Events

Add `#[event]` structs and `emit!()` calls to all 4 programs. For each state transition, emit an event. Example for attestation:
```rust
#[event]
pub struct AttestationSubmitted {
    pub worker: Pubkey,
    pub job_id: String,
    pub step: u64,
}
```
Add `emit!(AttestationSubmitted { ... });` after each state change. Do this for all programs: attestation (submitted, verified), escrow (created, released, slashed, closed), reputation (registered, completion, failure), staking (staked, slashed, unstaked).

### 5E: Test coverage

File: `solana/tests/staking.ts`
1. Add a test for slash (now that it works with CPI transfer).
2. Add a test for non-admin slash attempt (should fail).

File: `solana/tests/attestation.ts`
3. Add a test for non-admin verify attempt (should fail).

File: `solana/tests/escrow.ts`
4. Add a test for close_job before all workers settled (should fail with the new check).

5. Run `anchor build && anchor test` — all tests must pass.

### 5F: Commit

```bash
git add -A
git commit -m "fix: Solana program validation, events, and test coverage"
```

---

## Phase 6: Rust Sidecar & Infra Polish

**Commit message:** `fix: sidecar metrics, IaC cleanup, and TypeScript type sync`

### 6A: Prometheus metrics completeness

File: `sidecar/src/transport/prometheus.rs`

Add gauges for: `xid_errors`, `ecc_dbe_count`, `ecc_sbe_count`, `clock_throttle_reasons`, `pcie_replay_counter`, `sm_active_pct`, `tensor_active_pct`. Follow the existing pattern with `GaugeVec` and `with_label_values`.

### 6B: DiLoCo min-size fix

File: `sidecar/src/collectors/diloco.rs`

1. Change `DILOCO_MIN_SIZE` from 42 to 46. Remove the conditional reads — read all fields unconditionally.

File: `sidecar/src/collectors/training.rs` and `diloco.rs`

2. Add staleness check: after parsing `timestamp_ms`, compare against `SystemTime::now()`. If data is older than 5 seconds, return `None`.

3. Run `cargo test`.

### 6C: TypeScript type sync

File: `dashboard/src/lib/types.ts`

Add missing fields to the `GpuMetrics` interface: `memory_temp_c`, `mem_copy_utilization_pct`, `pcie_replay_counter`, `pcie_tx_bytes_per_sec`, `pcie_rx_bytes_per_sec`, `retired_pages_sbe`, `retired_pages_dbe`, `remapped_rows_correctable`, `remapped_rows_uncorrectable`, `row_remap_failure`. All optional (`?:` suffix) since they may not always be present.

### 6D: README fix

File: `README.md`

Update prerequisites section to show exact versions: Rust 1.94+, Python 3.11+, Node 20+, Solana CLI 3.x, Anchor CLI 0.30.1 (with anchor-lang 0.32.1).

### 6E: IaC fixes (interview credibility)

File: `infra/helm/solprobe/templates/prometheus-config.yaml`
1. Add `alert_rules.yml` as a second data key in the ConfigMap (copy pattern from `infra/k8s/monitoring/prometheus-config.yaml`).

File: `infra/terraform/variables.tf`
2. Remove `default = "0.0.0.0/0"` from `authorized_network`. Add a validation block requiring CIDR format.

File: `infra/ansible/roles/nvidia-drivers/tasks/main.yaml`
3. Replace deprecated `apt_key` with `get_url` to download key to `/usr/share/keyrings/` and add `signed-by=` to the repo source.
4. Pin RHEL driver: change `nvidia-driver-latest-dkms` to `nvidia-driver-535-dkms`.

File: `infra/ansible/roles/dcgm/tasks/main.yaml`
5. Add GPG key download and `signed-by=` reference for the DCGM repo.

File: `infra/ansible/inventory/hosts.yaml`
6. Replace `backend_addr: "http://solprobe-backend:50051"` with `backend_addr: "http://{{ backend_ip }}:50051"` (variable reference).

File: `infra/k8s/monitoring/grafana-deployment.yaml`
7. Change `runAsUser: 1000` to `runAsUser: 472` and `fsGroup: 472` to match Grafana's image UID.

File: `infra/k8s/monitoring/prometheus-config.yaml`
8. Remove the duplicate/dead relabel rule (the intermediate `__address__` replacement that only sets the port).

File: `infra/scripts/deploy.sh`
9. Add dashboard image build step alongside backend and sidecar.

### 6F: Final verification and commit

```bash
cd sidecar && cargo test
cd ../backend && source .venv/bin/activate && python -m pytest tests/ -v
cd ../dashboard && npx next build
cd ../solana && anchor build
git add -A
git commit -m "fix: sidecar metrics, IaC cleanup, and TypeScript type sync"
git push origin main
```

---

## Execution Summary

Execute phases 2 → 3 → 4 → 5 → 6 in order. Each phase produces one commit. Run tests after each phase. Push to `origin/main` after the final phase.

Expected final state: 5 new commits on main, all tests passing, 133 review findings addressed.
