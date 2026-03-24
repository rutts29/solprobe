# SolProbe Review Mitigation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 149 validated findings from the 6-reviewer council, grouped into 6 phases by priority.

**Architecture:** Fixes are batched so each phase produces a single commit. Phases are independent — any phase can be skipped without breaking others. Tests must pass after each phase.

**Tech Stack:** Rust (sidecar), Python/FastAPI (backend), TypeScript/Next.js (dashboard), Anchor/Solana (programs), Helm/Terraform/Ansible (infra)

**Validation Source:** `.review/solprobe_review_*.md` (6 review files), validated by 6 Opus agents.

---

## Phase 1: Runtime-Breaking Fixes (MUST FIX)
**Commit:** `fix: staking PDA signing + dashboard WebSocket stability`
**Findings:** S-1, S-2, S-3, Dashboard-3, Dashboard-4

### Task 1.1: Fix staking slash/unstake PDA signing

**Files:**
- Modify: `solana/programs/solprobe-staking/src/lib.rs`

The `slash` and `unstake` functions use direct `try_borrow_mut_lamports` on a System-owned `SystemAccount` vault. This is the exact same bug we already fixed in the escrow program. Replace with `system_program::transfer` using `CpiContext::new_with_signer` with vault PDA seeds.

- [ ] **Step 1:** In `slash` (lines 82-92), replace direct lamport manipulation with `system_program::transfer(CpiContext::new_with_signer(...))` using the vault seeds `[b"stake_vault", worker.key().as_ref(), &[bump]]`
- [ ] **Step 2:** In `unstake` (lines 118-126), apply the same CPI transfer pattern
- [ ] **Step 3:** Ensure `system_program: Program<'info, System>` is in both `Slash` and `Unstake` account structs (add if missing)
- [ ] **Step 4:** Run `anchor build` — verify no compile errors
- [ ] **Step 5:** Run `anchor test` — verify all 15 tests pass (slash test will now actually work)

### Task 1.2: Fix staking re-stake lockout (S-3)

**Files:**
- Modify: `solana/programs/solprobe-staking/src/lib.rs` (Unstake struct)

The `Unstake` account struct doesn't close the `stake_account`, so after unstaking a worker can never re-stake (the PDA still exists, `init` fails with `AlreadyInUse`).

- [ ] **Step 1:** Add `close = worker` constraint to `stake_account` in the `Unstake` accounts struct
- [ ] **Step 2:** Run `anchor build && anchor test`

### Task 1.3: Fix dashboard WebSocket double-reconnect (Dashboard-3)

**Files:**
- Modify: `dashboard/src/lib/websocket.tsx`

The `onerror` handler calls `ws.close()`, but the browser automatically fires `onclose` after `onerror`. This creates duplicate reconnect timers.

- [ ] **Step 1:** Remove `ws.close()` from the `onerror` handler (keep only the error log)
- [ ] **Step 2:** Add `if (unmounted) return;` guard at the top of `onopen`, `onmessage`, and `onclose` handlers

### Task 1.4: Run all tests and commit

- [ ] **Step 1:** `cd solana && anchor test` — 15 pass
- [ ] **Step 2:** `cd dashboard && npm run build` — clean build
- [ ] **Step 3:** Commit: `fix: staking PDA signing + dashboard WebSocket stability`

---

## Phase 2: Correctness Bugs (Demo-Visible)
**Commit:** `fix: detection accuracy, alert handling, and Solana access control`
**Findings:** Rust-11,12; Python-52,53,54; Dashboard-76,78,80,98,99; Solana-A1,A2,A5,S5,S6

### Task 2.1: Fix Rust threshold detector false positives

**Files:**
- Modify: `sidecar/src/detectors/threshold.rs`

- [ ] **Step 1:** Xid severity (Finding 11): Use `Severity::Warning` for non-critical Xid codes, `Severity::Critical` only for codes in `critical_xid_codes`
- [ ] **Step 2:** Clock throttle (Finding 12): Mask out benign bits (`0x1 GpuIdle`, `0x2 AppClocks`, `0x10 SyncBoost`) before checking for non-zero. Only alert on `0x8`, `0x20`, `0x40`, `0x80`
- [ ] **Step 3:** `cargo test` — verify 25 tests pass

### Task 2.2: Fix Python z-score detection accuracy

**Files:**
- Modify: `backend/app/detectors/zscore.py`
- Modify: `backend/app/detectors/cross_node.py`

- [ ] **Step 1:** Z-score (Finding 52): In `_compute_zscore`, compute mean/std over `arr[:-1]` (exclude the test point), then compute z-score of `arr[-1]` against that baseline. Raise minimum samples to 30.
- [ ] **Step 2:** Duplicate alerts (Finding 53): Add a `_last_alerted: dict[tuple[str, str], float]` with a 60-second cooldown. Only fire an alert if the same `(node_id, alert_type)` hasn't fired in the last 60s.
- [ ] **Step 3:** Comma-joined node_id (Finding 54): In `cross_node.py`, create one alert per affected node (loop over `affected_nodes` and create individual alerts) rather than joining into a single `node_id` string.
- [ ] **Step 4:** `gpu_utilization_pct` mapping (Integration-209): Remove `"gpu_utilization_pct"` from `_GPU_FIELDS` or change its mapping to `"straggler_detected"` with only negative z-score triggering.
- [ ] **Step 5:** `python -m pytest tests/ -v` — 127+ tests pass

### Task 2.3: Fix dashboard data correctness bugs

**Files:**
- Modify: `dashboard/src/app/alerts/page.tsx`
- Modify: `dashboard/src/components/charts/loss-chart.tsx`
- Modify: `dashboard/src/components/overview/cluster-summary.tsx`
- Modify: `dashboard/src/components/nodes/node-card.tsx`
- Modify: `dashboard/src/components/layout/app-shell.tsx`

- [ ] **Step 1:** Severity filter bypass (Dashboard-76/Finding 76): In `alerts/page.tsx` `onAlert` callback, check `if (severity === "ALL" || msg.data.severity === severity)` before calling `prepend()`
- [ ] **Step 2:** Log scale crash (Dashboard-78/Finding 78): In `loss-chart.tsx`, filter out values <= 0 before rendering, or add `Math.max(value, 1e-8)` floor
- [ ] **Step 3:** NaN% (Findings 98-99): Guard division in `cluster-summary.tsx` and `node-card.tsx` — `(used + free) > 0 ? (used / (used + free)) * 100 : 0`
- [ ] **Step 4:** Critical counter reset (Finding 80): In `app-shell.tsx`, derive `criticalAlerts` from actual alert count rather than a monotonic counter
- [ ] **Step 5:** Keyboard navigation (Finding 81): Replace `window.location.href` with `useRouter().push()`
- [ ] **Step 6:** `npm run build` — clean build

### Task 2.4: Fix Solana access control and validation gaps

**Files:**
- Modify: `solana/programs/solprobe-attestation/src/lib.rs`
- Modify: `solana/programs/solprobe-staking/src/lib.rs`

- [ ] **Step 1:** Attestation PDA seed constraint (A-2): Add `seeds = [b"attestation", attestation.job_id.as_bytes(), &attestation.step.to_le_bytes(), attestation.worker.as_ref()], bump = attestation.bump` to the `VerifyAttestation` attestation account
- [ ] **Step 2:** Attestation age check (A-1): Replace `clock.unix_timestamp - attestation.timestamp` with `clock.unix_timestamp.checked_sub(attestation.timestamp).ok_or(AttestationError::AttestationTooOld)?`
- [ ] **Step 3:** Config validation (A-5): Add `require!(max_attestation_age_seconds > 0, AttestationError::InvalidConfig)` in `initialize_config`
- [ ] **Step 4:** Negative cooldown (S-5): Add `require!(cooldown_seconds >= 0, StakingError::InvalidCooldown)` in both `initialize_config` and `update_config`
- [ ] **Step 5:** has_one constraints (S-6): Add `has_one = admin` to `UpdateConfig` and `Slash` account structs on `stake_config`
- [ ] **Step 6:** `anchor build && anchor test` — all tests pass

### Task 2.5: Commit Phase 2

- [ ] Run all test suites: `cargo test` (25), `pytest` (127), `npm run build`, `anchor test` (15)
- [ ] Commit: `fix: detection accuracy, alert handling, and Solana access control`

---

## Phase 3: Architecture & Reliability
**Commit:** `refactor: gRPC reliability, store bounds, and config improvements`
**Findings:** Rust-4,5,6,8; Python-34,35,46,47,50; Integration-200,204; Infra-158

### Task 3.1: Rust gRPC transport improvements

**Files:**
- Modify: `sidecar/src/transport/grpc.rs`
- Modify: `sidecar/src/main.rs`

- [ ] **Step 1:** Replace `unwrap()` on `self.client.as_mut()` (Finding 5) with `.ok_or_else(|| ...)?`
- [ ] **Step 2:** Remove dead `connect()` method (Finding 6) or wire it into startup with backoff. At minimum, add a `last_attempt: Instant` to throttle `try_connect()` to at most once per 5 seconds.
- [ ] **Step 3:** In main.rs, cap spawned gRPC tasks (Finding 4): Use `try_lock()` instead of spawning — if the transport mutex is locked, skip that tick's gRPC send rather than queuing unbounded tasks.
- [ ] **Step 4:** `cargo test && cargo build`

### Task 3.2: Python backend hardening

**Files:**
- Modify: `backend/app/stores.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/grpc_server.py`
- Modify: `backend/app/detectors/diloco.py`

- [ ] **Step 1:** JobStore bounds (Finding 47): Add `maxlen=1000` to `JobStore` using an `OrderedDict` with eviction, matching `AlertStore`/`AnomalyStore` pattern
- [ ] **Step 2:** gRPC port configurable (Finding 50): Change `start_grpc_server(port=50051)` to `start_grpc_server(port=int(os.environ.get("GRPC_PORT", "50051")))`
- [ ] **Step 3:** CORS env override (Finding 35/204): Read `CORS_ORIGINS` from env: `os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")`
- [ ] **Step 4:** DiLoCo counter reset (Finding 34): In `_last_outer_step` check, reset the entry if `current_outer < prev_outer` (detect counter reset)
- [ ] **Step 5:** `python -m pytest tests/ -v`

### Task 3.3: Docker Compose fixes

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1:** Add health checks for backend and sidecar (Integration-200)
- [ ] **Step 2:** Add `env_file: - .env` to backend service (Infra-158)
- [ ] **Step 3:** Add dashboard service
- [ ] **Step 4:** Create `.env.example` at repo root with `ANTHROPIC_API_KEY=your-key-here`

### Task 3.4: Commit Phase 3

- [ ] Run test suites
- [ ] Commit: `refactor: gRPC reliability, store bounds, and config improvements`

---

## Phase 4: Dashboard Polish
**Commit:** `fix: dashboard race conditions, performance, and UX`
**Findings:** Dashboard-74,75,77,82,83,84,85,86,89,93,94,95,96,97,104,105,106,107,110,111

### Task 4.1: Data fetching race conditions

**Files:**
- Modify: `dashboard/src/hooks/use-alerts.ts`
- Modify: `dashboard/src/hooks/use-nodes.ts`
- Modify: `dashboard/src/components/alerts/alert-detail.tsx`

- [ ] **Step 1:** Add `setLoading(true)` at the start of `refresh()` in both `use-alerts.ts` and `use-nodes.ts` (Findings 74, 105)
- [ ] **Step 2:** Add `AbortController` to `useNodes` polling to prevent stale responses overwriting newer data (Finding 75)
- [ ] **Step 3:** Add `let cancelled = false` guard in `alert-detail.tsx` useEffect, check before each setState (Finding 77)
- [ ] **Step 4:** Reset `selectedAlert` to null when severity filter changes in `alerts/page.tsx` (Finding 86)

### Task 4.2: Performance optimizations

**Files:**
- Modify: `dashboard/src/app/overview/page.tsx`
- Modify: `dashboard/src/components/nodes/gpu-charts.tsx`
- Modify: `dashboard/src/app/diagnoses/page.tsx`

- [ ] **Step 1:** Wrap `avgGpuUtil` computation in `useMemo` (Finding 83)
- [ ] **Step 2:** Wrap `chartData` derivations in all chart components in `useMemo` (Finding 84)
- [ ] **Step 3:** Wrap `nodeIds` computation in `useMemo` in diagnoses page (Finding 85)

### Task 4.3: UX fixes and cleanup

**Files:**
- Modify: various dashboard components

- [ ] **Step 1:** Remove "Apply Fix (coming in SP-5)" button from `action-panel.tsx` (Finding 104)
- [ ] **Step 2:** Remove dead `fetchAnomalies` and `fetchJobs` functions from `api.ts` (Finding 94)
- [ ] **Step 3:** Fix array index React key in `evidence-chain.tsx` — use `item.metric` (Finding 96)
- [ ] **Step 4:** Add `error.tsx` at root layout level for error boundary (Finding 106)
- [ ] **Step 5:** Add `loading.tsx` at each route for Suspense skeletons (Finding 107)

### Task 4.4: Commit Phase 4

- [ ] `npm run build` — clean
- [ ] Commit: `fix: dashboard race conditions, performance, and UX`

---

## Phase 5: Solana Protocol Improvements
**Commit:** `fix: Solana program validation, events, and test coverage`
**Findings:** S-4,S-8,S-9,E-2,E-4,E-5,E-7,R-1,R-3,R-4,A-4,A-6,E-9,R-5,X-1,X-2,X-4

### Task 5.1: Staking program hardening

**Files:**
- Modify: `solana/programs/solprobe-staking/src/lib.rs`

- [ ] **Step 1:** Clamp slash amount (S-4): `let amount = std::cmp::min(amount, stake_account.staked_lamports);`
- [ ] **Step 2:** Apply `slash_percentage` (X-4): Replace arbitrary `amount` param with `stake_account.staked_lamports * config.slash_percentage as u64 / 100`
- [ ] **Step 3:** Replace all `.unwrap()` on checked arithmetic with `.ok_or(StakingError::Overflow)?`

### Task 5.2: Reputation access control

**Files:**
- Modify: `solana/programs/solprobe-reputation/src/lib.rs`

- [ ] **Step 1:** Add an `oracle: Signer<'info>` to `UpdateProfile` that is separate from `authority` (the worker). The oracle signs reputation updates, not the worker (R-1). Add oracle pubkey to a config PDA.
- [ ] **Step 2:** Replace `.unwrap()` on checked arithmetic with `.ok_or(ReputationError::Overflow)?` (R-2 validated concern)
- [ ] **Step 3:** Remove unused `AlreadyRegistered` error variant (R-4)

### Task 5.3: Escrow design improvements

**Files:**
- Modify: `solana/programs/solprobe-escrow/src/lib.rs`

- [ ] **Step 1:** Document in comments that `release_payment` intentionally allows worker self-release for demo scope, with a TODO noting production would require creator/oracle approval (E-2)
- [ ] **Step 2:** Document `slash_payment` trust model as creator-authorized for demo, noting production would need oracle/dispute (E-4)
- [ ] **Step 3:** In `close_job`, add `require!` that all workers are either released or slashed before closing (E-5)
- [ ] **Step 4:** Remove dead `JobStatus::Disputed` variant (E-7)

### Task 5.4: Add emit!() events to all programs (X-2)

**Files:**
- Modify: all 4 program `lib.rs` files

- [ ] **Step 1:** Define `#[event]` structs for key state transitions (attestation submitted/verified, payment released/slashed, worker registered, stake deposited/slashed/withdrawn)
- [ ] **Step 2:** Add `emit!()` calls after each state transition

### Task 5.5: Expand Solana test coverage (A-6, E-9, R-5, S-9)

**Files:**
- Modify: `solana/tests/attestation.ts`
- Modify: `solana/tests/escrow.ts`
- Modify: `solana/tests/reputation.ts`
- Modify: `solana/tests/staking.ts`

- [ ] **Step 1:** Attestation: add tests for expired attestation, non-admin verify attempt, fabricated account
- [ ] **Step 2:** Escrow: add tests for non-creator slash attempt, double-release, close-before-settle
- [ ] **Step 3:** Reputation: add test for non-oracle update attempt (after Task 5.2)
- [ ] **Step 4:** Staking: add tests for slash, re-stake after unstake, non-admin slash attempt

### Task 5.6: Commit Phase 5

- [ ] `anchor build && anchor test` — all tests pass
- [ ] Commit: `fix: Solana program validation, events, and test coverage`

---

## Phase 6: Rust Sidecar & Infra Polish
**Commit:** `fix: sidecar metrics completeness, simulator realism, and IaC cleanup`
**Findings:** Rust-10,13,14,16,17,18-23,26,28,29; Infra-145,149,151,154,161,172,174,175,176,182,183,191; Integration-192,202,208,212

### Task 6.1: Prometheus metrics completeness (Rust-14)

**Files:**
- Modify: `sidecar/src/transport/prometheus.rs`

- [ ] **Step 1:** Add gauges for `xid_errors`, `ecc_dbe_count`, `ecc_sbe_count`, `clock_throttle_reasons`, `pcie_replay_counter`, `sm_active_pct`, `tensor_active_pct`
- [ ] **Step 2:** Add training metric gauges: `loss`, `gradient_norm`, `throughput_tps`, `mfu_pct`
- [ ] **Step 3:** `cargo test`

### Task 6.2: DiLoCo min-size and mmap improvements

**Files:**
- Modify: `sidecar/src/collectors/diloco.rs`
- Modify: `sidecar/src/collectors/training.rs`

- [ ] **Step 1:** Set `DILOCO_MIN_SIZE = 46`, remove conditional reads (Integration-192/Finding 13)
- [ ] **Step 2:** Add staleness check: if `timestamp_ms` in parsed data is older than 5 seconds, return `None` (Integration-194)
- [ ] **Step 3:** `cargo test`

### Task 6.3: TypeScript types sync (Integration-208)

**Files:**
- Modify: `dashboard/src/lib/types.ts`

- [ ] **Step 1:** Add missing fields to `GpuMetrics` interface: `memory_temp_c`, `mem_copy_utilization_pct`, `pcie_replay_counter`, `pcie_tx_bytes_per_sec`, `pcie_rx_bytes_per_sec`, `retired_pages_sbe`, `retired_pages_dbe`, `remapped_rows_correctable`, `remapped_rows_uncorrectable`, `row_remap_failure`

### Task 6.4: README accuracy (Integration-212)

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Update prerequisites to exact versions: Rust 1.94, Python 3.11+, Node 20+, Solana CLI 3.x, Anchor CLI 0.30.1 + anchor-lang 0.32.1

### Task 6.5: IaC fixes (interview credibility)

**Files:**
- Modify: `infra/helm/solprobe/templates/prometheus-config.yaml` — add alert_rules.yml (Infra-145)
- Modify: `infra/terraform/variables.tf` — remove 0.0.0.0/0 default, add validation block (Infra-151)
- Modify: `infra/ansible/roles/nvidia-drivers/tasks/main.yaml` — replace deprecated `apt_key` (Infra-154), pin RHEL driver version (Infra-161)
- Modify: `infra/ansible/roles/dcgm/tasks/main.yaml` — add signed-by key (Infra-174)
- Modify: `infra/ansible/inventory/hosts.yaml` — replace K8s DNS with variable (Infra-182)
- Modify: `infra/k8s/monitoring/grafana-deployment.yaml` — fix runAsUser to 472 (Infra-176)
- Modify: `infra/scripts/deploy.sh` — add dashboard image build (Infra-175)
- Modify: `infra/k8s/monitoring/prometheus-config.yaml` — remove duplicate relabel rule (Infra-172)

### Task 6.6: Commit Phase 6

- [ ] `cargo test && npm run build && python -m pytest tests/ -v`
- [ ] Commit: `fix: sidecar metrics completeness, simulator realism, and IaC cleanup`

---

## Execution Order & Dependencies

```
Phase 1 (MUST FIX) ──→ Phase 2 (Correctness) ──→ Phase 3 (Architecture)
                                                        ↓
Phase 4 (Dashboard) ←── can run in parallel ──→ Phase 5 (Solana)
                                                        ↓
                                               Phase 6 (Polish)
```

- **Phases 1-3** are sequential (each builds on prior)
- **Phases 4, 5** can run in parallel (independent components)
- **Phase 6** is last (polish after functional fixes)

## Summary

| Phase | Findings | Risk | Est. Scope |
|-------|----------|------|------------|
| 1 | 5 | BREAKING | Small — pattern already proven in escrow fix |
| 2 | ~15 | HIGH | Medium — detection logic + Solana validation |
| 3 | ~15 | HIGH/MEDIUM | Medium — backend + docker-compose |
| 4 | ~20 | MEDIUM/LOW | Medium — dashboard hooks + UX |
| 5 | ~25 | HIGH/MEDIUM | Large — Solana protocol + tests |
| 6 | ~25 | MEDIUM/LOW | Medium — metrics + IaC cleanup |

**Not addressed (VALID but deprioritized):**
- Enhancement-level findings (simulator realism, debouncing, Subscribe RPC) — nice-to-have, not needed for portfolio readiness
- Python test coverage gaps (Finding 63) — would add ~200 lines of test code for gRPC/DiLoCo/enrichment, valuable but not blocking
- Rust connect() startup retry, graceful shutdown drain — operational improvements for production, not demo
