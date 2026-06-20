# SolProbe Launch-First Enhancement Plan

**Goal:** Turn the current SolProbe demo into a credible early product: live training + hardware monitoring, configurable alerts, diagnosis, and a reproducible nanochat showcase, without a large rewrite.

**Architecture:** Keep the existing sidecar -> backend -> dashboard pipeline. Add backend-managed monitoring policies over existing metrics first, then add lightweight custom metrics through a REST path. Avoid proto changes, database migrations, Kubernetes production hardening, and deep Solana work until the demo/product loop is strong.

**Tech Stack:** Rust sidecar, FastAPI backend, in-memory stores, Next.js dashboard, existing PyTorch callback/nanochat integration.

---

## 1. Current State To Preserve

- Hardware metrics already flow through sidecar into backend and dashboard.
- Training metrics already flow through mmap into sidecar, then backend and dashboard.
- Existing detectors cover:
  - Edge: thermal threshold, memory pressure, XID, ECC DBE, clock throttle, gradient norm threshold.
  - Central: z-score loss/gradient/throughput/temp, cross-node straggler, correlated failures, DiLoCo drift/divergence.
- Diagnosis exists and should remain optional/fallback-safe when Anthropic fails.
- Nanochat MPS run has already proven the real workload path works.

Do not replace these systems. Build on them.

---

## 2. Phase 0: Stabilize Demo Quality First

**Purpose:** Remove confusing product bugs before adding features.

- Re-check current git state before changes:
  - Confirm why `main` is ahead of `origin/main`.
  - Leave unrelated dirty chart files and `backend/uv.lock` alone unless they are part of the chosen patch.
- Ensure dashboard navigation is sane:
  - Dashboard logo/landing link must reach the landing page even when logged in.
  - Keep `/overview` as the authenticated app entry.
- Ensure Apple Silicon unsupported signals render correctly:
  - `gpu_temp_c=0` and `power_usage_w=0` from Apple Silicon should display as `—`, not healthy `0°C` or `0W`.
- Keep diagnosis UI reliable:
  - Manual Diagnose should update the detail drawer immediately with returned diagnosis.
  - Failed LLM calls should show a friendly local fallback, not raw `API error 502`.

**Acceptance:** User can open dashboard, click around, run a demo, and not see misleading zeros, broken landing navigation, or raw backend error blobs.

---

## 3. Phase 1: Productize The Training Run View

**Purpose:** Make SolProbe feel like it monitors a real run, not just loose node metrics.

### Backend

- Extend the existing job concept without adding a database:
  - Job fields: `job_id`, `name`, `status`, `created_at_ms`, `updated_at_ms`, `node_ids`, `config`.
  - Status values: `registered`, `running`, `completed`, `failed`.
- Add job summary endpoint:
  - `GET /api/v1/jobs/{job_id}/summary`
  - Returns latest training metrics, latest hardware metrics, related alerts, related diagnoses, and run duration.
- Keep data in memory for now.

### Sidecar

- Add optional sidecar `--job-id`.
- When training mmap does not contain `job_id`, sidecar attaches the configured `job_id` to `TrainingMetrics`.
- Edge alerts generated from training metrics should inherit that `job_id`.

### Dashboard

- Upgrade `/training` from “first active node” to “active run workspace”.
- Show:
  - Run name and job ID.
  - Model/config summary.
  - Step, loss, grad norm, throughput, MFU.
  - GPU utilization and Metal/framebuffer memory.
  - Alerts for this job only.
  - Diagnosis status for job alerts.
- If no active job exists, show a clean empty state with the exact demo command.

**Acceptance:** A nanochat run appears as a named run, with its training signals, hardware signals, and alerts tied together.

---

## 4. Phase 2: Add High-Value Detectors Without Big Architecture Changes

**Purpose:** Cover the obvious training failure modes users expect.

Add central detectors over the existing `TrainingMetricsModel` history:

- **Numeric instability**
  - Detect `NaN`, `Inf`, or non-finite `loss`, `gradient_norm`, `throughput_tps`, `mfu_pct`.
  - Severity: `CRITICAL`.
  - Alert type: `numeric_instability`.

- **No progress / stale step**
  - If a job is `running`, sidecar is alive, but training step has not advanced for configurable duration.
  - Severity: `WARNING` first, `CRITICAL` after longer duration.
  - Alert type: `training_stalled`.

- **Loss plateau**
  - After warmup, if loss slope is near zero for a configurable window while throughput is normal.
  - Severity: `WARNING`.
  - Alert type: `loss_plateau`.

- **Throughput degradation**
  - If throughput falls below recent baseline for sustained duration.
  - This complements existing z-score straggler detection.
  - Severity: `WARNING`.
  - Alert type: `throughput_regression`.

Do not add a generic expression language yet.

**Acceptance:** SolProbe catches the common local training failures: exploded gradients, loss spike, loss plateau, stalled training, and broken numeric values.

---

## 5. Phase 3: Monitoring Policy Engine V0

**Purpose:** Give users the “define metrics and thresholds” feature without overbuilding.

### Backend API

Add in-memory policy APIs:

- `GET /api/v1/policies`
- `POST /api/v1/policies`
- `PATCH /api/v1/policies/{policy_id}`
- `DELETE /api/v1/policies/{policy_id}`
- `POST /api/v1/policies/{policy_id}/toggle`

Policy shape:

```json
{
  "policy_id": "grad-norm-critical",
  "name": "Gradient norm critical",
  "enabled": true,
  "scope": {
    "job_id": "optional",
    "node_id": "optional"
  },
  "metric": {
    "source": "training",
    "field": "gradient_norm"
  },
  "condition": {
    "operator": "gt",
    "threshold": 100.0,
    "for_seconds": 5
  },
  "severity": "CRITICAL",
  "cooldown_seconds": 60,
  "description": "Gradient norm exceeded safe range"
}
```

Supported metric sources in V0:

- `gpu`: existing GPU fields.
- `training`: existing training fields.
- `diloco`: existing DiLoCo fields.

Supported operators in V0:

- `gt`
- `gte`
- `lt`
- `lte`
- `abs_gt`
- `stale_for`

### Runtime

- Add a backend policy evaluator loop every 5 seconds.
- Evaluator reads existing stores only.
- It creates normal `AlertModel` records with:
  - `source="CENTRAL"`
  - `alert_type="policy_violation"`
  - evidence containing policy ID, field, threshold, actual value, and duration.
- Add cooldown per policy/node/job so it does not spam.

### Dashboard

Add `/policies`.

- Table of enabled policies.
- Create/edit drawer with:
  - source dropdown,
  - metric dropdown,
  - operator,
  - threshold,
  - duration,
  - severity,
  - cooldown.
- Add presets:
  - Gradient norm warning.
  - Gradient norm critical.
  - Low throughput.
  - Training stalled.
  - High GPU memory.
  - Apple GPU utilization sustained high.
- Show last triggered time and active/inactive state.

**Acceptance:** User can create a threshold from the dashboard, run nanochat or `train_mps.py`, and see a policy-generated alert.

---

## 6. Phase 4: Custom Metrics V0

**Purpose:** Let users monitor metrics SolProbe does not know about yet, while keeping implementation small.

### Backend

Add custom metric model:

```json
{
  "node_id": "node-0",
  "job_id": "nanochat-mps-001",
  "timestamp_ms": 1777193300000,
  "step": 42,
  "name": "eval_bpb",
  "value": 1.73,
  "unit": "bpb",
  "tags": {
    "split": "val"
  }
}
```

Add endpoints:

- `POST /api/v1/custom-metrics`
- `GET /api/v1/custom-metrics?job_id=...&name=...`
- `GET /api/v1/custom-metrics/names`

Store in an in-memory ring buffer.

### Training SDK

Add a lightweight helper beside `SolProbeCallback`:

```python
cb.log_metric("eval_bpb", value, step=step, unit="bpb")
cb.log_metric("dataloader_wait_ms", wait_ms, step=step, unit="ms")
```

For V0, custom metrics can go directly to backend via REST. Do not route them through sidecar/protobuf yet.

### Policies

Policy engine supports:

```json
{
  "metric": {
    "source": "custom",
    "name": "eval_bpb"
  }
}
```

### Dashboard

- Show custom metric charts on the Training page.
- Policy builder lists discovered custom metric names.

**Acceptance:** A training script can log `eval_bpb` or `dataloader_wait_ms`, dashboard charts it, and a user-defined policy can alert on it.

---

## 7. Phase 5: Incident Workflow

**Purpose:** Make alerts actionable instead of just visible.

Add lightweight lifecycle state without changing the alert schema:

- `acknowledged`
- `investigating`
- `resolved`
- `ignored`

Backend endpoints:

- `PATCH /api/v1/alerts/{alert_id}/state`
- `POST /api/v1/alerts/{alert_id}/notes`

Dashboard additions:

- Alert detail shows state, diagnosis, evidence, and recommended action.
- Buttons:
  - Acknowledge.
  - Mark investigating.
  - Resolve.
  - Ignore for this run.
- Add “Open incidents” filter.

Do not build users, assignment, RBAC, Slack, PagerDuty, or audit trails yet.

**Acceptance:** During a demo, an alert can move from “critical” to “diagnosed” to “resolved”, making the product feel complete.

---

## 8. Phase 6: Reproducible Showcase Demo

**Purpose:** Make the portfolio demo easy to run and trust.

Add one demo script:

```bash
scripts/demo_nanochat_solprobe.sh
```

It should:

- Start backend with verbose logs.
- Start dashboard.
- Start Apple Silicon sidecar with `--job-id`.
- Register a nanochat job.
- Run nanochat MPS training.
- Save logs to `.runs/<run_id>/`.
- Print dashboard URLs:
  - `/overview`
  - `/training`
  - `/alerts`
  - `/policies`
  - `/nodes/node-0`

Add a short `SHOWCASE.md`:

- What SolProbe monitors.
- What anomalies are covered.
- What the nanochat demo proves.
- Known limits:
  - Apple temp/power unavailable.
  - In-memory state.
  - Custom metrics V0 uses REST, not sidecar.
  - Solana path still demo-stage.

**Acceptance:** A reviewer can run one script, open the dashboard, and understand the product story.

---

## 9. What Not To Build Yet

- No Postgres/Redis persistence in this pass.
- No full auth/RBAC.
- No Kubernetes production rollout work.
- No generic expression/rule language.
- No proto change for custom metrics.
- No full Solana staking/slashing workflow.
- No multi-tenant SaaS surface.
- No perfect detector taxonomy before launch.

These are later once the demo gets feedback.

---

## 10. Test Plan

### Backend

Run:

```bash
cd backend
uv run pytest
```

Add tests for:

- Job summary endpoint.
- Policy CRUD.
- Policy evaluator threshold trigger.
- Policy cooldown.
- Stale training detector.
- Numeric instability detector.
- Loss plateau detector.
- Custom metric ingest/query.
- Custom metric policy trigger.
- Alert lifecycle state updates.

### Sidecar

Run:

```bash
cargo test -p solprobe-sidecar
```

Add tests for:

- `--job-id` attaches job ID to training metrics.
- Training-derived alerts include job ID.
- Existing no-training behavior still returns no training metrics.

### Dashboard

Run:

```bash
cd dashboard
npm run lint
npm run build
```

Manually verify:

- `/training` shows active nanochat run.
- `/policies` can create and disable policies.
- Policy alerts appear in `/alerts`.
- Alert detail shows diagnosis and lifecycle actions.
- Apple unsupported temp/power still render as unavailable.

### End-To-End

Run:

```bash
scripts/demo_nanochat_solprobe.sh
```

Verify:

- Hardware metrics roughly match Activity Monitor.
- Nanochat training metrics update live.
- A custom policy can fire.
- A built-in detector can fire.
- Manual diagnosis updates the UI.
- Logs are saved under `.runs/<run_id>/`.

---

## 11. Recommended Implementation Order

1. Phase 0: polish and correctness fixes.
2. Phase 1: run-aware training dashboard with `job_id`.
3. Phase 2: stale/numeric/plateau detectors.
4. Phase 3: policy engine over existing metrics.
5. Phase 4: custom metrics REST path.
6. Phase 5: alert lifecycle.
7. Phase 6: demo script and `SHOWCASE.md`.

This order keeps every step shippable. If time gets tight, stop after Phase 3: that already gives a strong product story.
