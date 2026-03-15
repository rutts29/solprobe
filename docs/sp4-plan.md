# SolProbe SP-4: Next.js Real-Time Dashboard — Full Spec for Cloud Agent

## Context

SolProbe SP-1 (Rust sidecar), SP-2 (FastAPI backend), and SP-3 (LLM diagnosis agent) are complete. The backend exposes:
- REST API at `:8000/api/v1/` — nodes, alerts, anomalies, diagnoses, jobs
- WebSocket at `:8000/ws/stream` — real-time alerts, metric summaries, diagnoses
- Prometheus at `:8000/metrics` and `:9100/metrics`

This plan builds **SP-4: a Next.js dashboard** that visualizes training health, anomaly timelines, LLM diagnoses, and provides one-click recovery actions.

## Cloud Agent Instructions

**Read CLAUDE.md first for project conventions (especially: never add Co-Authored-By to commits).**

### Tech Stack
- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS v4
- shadcn/ui components
- Recharts for time-series graphs
- Native WebSocket for real-time updates

### Setup
```bash
cd /path/to/solprobe
npx create-next-app@latest dashboard --typescript --tailwind --app --src-dir --no-import-alias
cd dashboard
npx shadcn@latest init
npx shadcn@latest add card badge button table tabs alert dialog separator skeleton
npm install recharts
```

### Development
```bash
cd dashboard && npm run dev  # starts on :3000
# Backend must be running on :8000 for API calls
```

## API Reference (what the dashboard consumes)

### REST Endpoints
| Method | Path | Returns |
|--------|------|---------|
| GET | /api/v1/health | `{status, connected_sidecars, total_alerts, total_diagnoses, ws_clients}` |
| GET | /api/v1/nodes | `NodeStatus[]` — each has latest GPU/training/DiLoCo metrics |
| GET | /api/v1/nodes/{id}/metrics?window_minutes=5 | Historical metrics (GPU, training, DiLoCo arrays) |
| GET | /api/v1/alerts?severity=&node_id=&limit= | `AlertModel[]` newest first |
| GET | /api/v1/alerts/{id}/enriched | `EnrichedAlert` with metrics context, history, correlated |
| GET | /api/v1/anomalies?limit= | Central detector findings |
| GET | /api/v1/diagnoses?node_id=&root_cause=&limit= | `DiagnosisResult[]` |
| GET | /api/v1/diagnoses/{id} | Single diagnosis |
| POST | /api/v1/diagnoses | `{alert_id}` → triggers manual LLM diagnosis |
| GET | /api/v1/alerts/{id}/diagnosis | Diagnosis for specific alert |
| POST | /api/v1/jobs | Register training job |
| GET | /api/v1/jobs | List jobs |

### WebSocket (/ws/stream)
Connect and optionally send filter: `{"node_ids": ["node-0"], "severity": "CRITICAL"}`
Receives JSON messages:
- `{"type": "alert", "data": AlertModel}`
- `{"type": "metric_summary", "data": {node_id: NodeStatus}}`
- `{"type": "diagnosis", "data": DiagnosisResult}`

### Key Data Shapes

**GpuMetricsModel**: node_id, gpu_index, gpu_model, timestamp_ms, gpu_temp_c, gpu_utilization_pct, fb_used_mb, fb_free_mb, power_usage_w, xid_errors, ecc_sbe_count, ecc_dbe_count, clock_throttle_reasons, sm_active_pct, tensor_active_pct

**TrainingMetricsModel**: node_id, job_id, timestamp_ms, step, loss, gradient_norm, learning_rate, throughput_tps, mfu_pct

**DiLoCoMetricsModel**: node_id, job_id, timestamp_ms, inner_step, outer_step, inner_loss, outer_loss, pseudo_grad_norm, sync_duration_ms, worker_speed_ratio, is_straggler

**AlertModel**: alert_id, node_id, timestamp_ms, severity (INFO/WARNING/CRITICAL), source (EDGE/CENTRAL), alert_type, description, confidence, evidence (dict), gpu_index?, job_id?

**DiagnosisResult**: diagnosis_id, alert_id, node_id, timestamp_ms, root_cause, confidence, reasoning, evidence_chain[], recommended_action {action, params, urgency}, similar_incidents[], status, error?, llm_model, latency_ms

## Implementation Steps

### STEP 1: Project Setup + Layout

Create `dashboard/` directory with Next.js App Router structure:

```
dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout with sidebar nav
│   │   ├── page.tsx          # Dashboard overview (redirect to /overview)
│   │   ├── overview/
│   │   │   └── page.tsx      # Cluster health overview
│   │   ├── nodes/
│   │   │   ├── page.tsx      # Node list
│   │   │   └── [nodeId]/
│   │   │       └── page.tsx  # Single node detail with charts
│   │   ├── alerts/
│   │   │   └── page.tsx      # Alert timeline + filters
│   │   ├── diagnoses/
│   │   │   └── page.tsx      # LLM diagnosis history
│   │   └── globals.css
│   ├── components/
│   │   ├── layout/
│   │   │   ├── sidebar.tsx
│   │   │   └── header.tsx
│   │   ├── overview/
│   │   │   ├── health-cards.tsx
│   │   │   ├── cluster-summary.tsx
│   │   │   └── recent-alerts.tsx
│   │   ├── nodes/
│   │   │   ├── node-card.tsx
│   │   │   └── gpu-charts.tsx
│   │   ├── alerts/
│   │   │   ├── alert-timeline.tsx
│   │   │   ├── alert-detail.tsx
│   │   │   └── severity-badge.tsx
│   │   ├── diagnoses/
│   │   │   ├── diagnosis-card.tsx
│   │   │   ├── evidence-chain.tsx
│   │   │   └── action-panel.tsx
│   │   └── charts/
│   │       ├── temp-chart.tsx
│   │       ├── utilization-chart.tsx
│   │       ├── loss-chart.tsx
│   │       └── throughput-chart.tsx
│   ├── lib/
│   │   ├── api.ts            # REST API client
│   │   ├── websocket.ts      # WebSocket hook
│   │   └── types.ts          # TypeScript interfaces matching API
│   └── hooks/
│       ├── use-nodes.ts      # SWR hook for nodes
│       ├── use-alerts.ts     # SWR hook for alerts
│       └── use-realtime.ts   # WebSocket real-time hook
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

### STEP 2: TypeScript Types + API Client

**`src/lib/types.ts`** — TypeScript interfaces matching ALL API response shapes listed above. Include GpuMetrics, TrainingMetrics, DiLoCoMetrics, AlertModel, DiagnosisResult, NodeStatus, EnrichedAlert.

**`src/lib/api.ts`** — API client with functions:
- `fetchHealth()`, `fetchNodes()`, `fetchNodeMetrics(nodeId, windowMinutes)`
- `fetchAlerts(params)`, `fetchEnrichedAlert(alertId)`
- `fetchDiagnoses(params)`, `fetchDiagnosis(id)`, `requestDiagnosis(alertId)`
- `fetchJobs()`
- Base URL configurable via `NEXT_PUBLIC_API_URL` env var (default `http://localhost:8000`)

**`src/lib/websocket.ts`** — WebSocket manager:
- Connect to `ws://localhost:8000/ws/stream`
- Auto-reconnect with exponential backoff
- Parse incoming JSON messages by type (alert, metric_summary, diagnosis)
- Expose as React hook `useWebSocket()`

### STEP 3: Layout + Navigation

**Root layout** (`layout.tsx`):
- Dark theme (matches GPU monitoring aesthetic)
- Left sidebar with nav links: Overview, Nodes, Alerts, Diagnoses
- Header with cluster health indicator (green/yellow/red based on active CRITICAL alerts)
- WebSocket connection status indicator

**Sidebar** (`sidebar.tsx`):
- SolProbe logo/title
- Nav items with icons and active state
- Connected nodes count badge
- Live alert count badge (updates via WebSocket)

### STEP 4: Overview Page

**Health Cards** (`health-cards.tsx`):
- 4 cards: Connected Nodes, Active Alerts, Diagnoses Today, Avg GPU Utilization
- Cards update in real-time via WebSocket metric_summary messages
- Color-coded: green (healthy), yellow (warnings), red (critical alerts active)

**Cluster Summary** (`cluster-summary.tsx`):
- Table of all nodes with: node_id, GPU model, temperature, utilization, memory %, last seen
- Row highlighting: red if node has active CRITICAL alert, yellow for WARNING
- Click row → navigate to `/nodes/[nodeId]`

**Recent Alerts** (`recent-alerts.tsx`):
- Last 10 alerts with severity badge, type, node, timestamp, description
- Real-time: new alerts animate in from top via WebSocket
- Click alert → slide-out panel with enriched details

### STEP 5: Node Detail Page

**`/nodes/[nodeId]/page.tsx`**:
- Fetch node metrics with 5-minute window
- Auto-refresh every 5 seconds

**GPU Charts** (`gpu-charts.tsx`):
- Temperature line chart (Recharts) with threshold lines at 80°C (warn) and 85°C (critical)
- GPU Utilization area chart
- Memory usage bar (used/free with percentage)
- Power draw line chart

**Training Charts** (if training metrics available):
- Loss curve (log scale)
- Gradient norm chart with threshold lines
- Throughput (tokens/sec) chart
- MFU % gauge

**DiLoCo Charts** (if DiLoCo metrics available):
- Inner vs Outer loss overlay chart
- Pseudo-gradient norm
- Sync duration chart
- Worker speed ratio with straggler threshold line

### STEP 6: Alerts Page

**Alert Timeline** (`alert-timeline.tsx`):
- Vertical timeline, newest at top
- Filter bar: severity (ALL/INFO/WARNING/CRITICAL), node_id dropdown, alert_type dropdown
- Each alert card shows: severity badge, type, node, timestamp, description, confidence
- Real-time: new alerts push to top via WebSocket
- "Diagnose" button on each undiagnosed alert → calls POST /api/v1/diagnoses

**Alert Detail** (`alert-detail.tsx`):
- Slide-out panel when clicking an alert
- Shows enriched alert: evidence map, recent metrics mini-charts, node history, correlated events
- If diagnosis exists: shows diagnosis inline with evidence chain and recommended action
- "Request Diagnosis" button if no diagnosis exists

**Severity Badge** (`severity-badge.tsx`):
- CRITICAL: red, WARNING: amber, INFO: blue
- Use shadcn Badge component

### STEP 7: Diagnoses Page

**Diagnosis List** (`diagnoses/page.tsx`):
- Filter by node_id, root_cause
- Cards showing: root_cause, confidence bar, node, timestamp, reasoning (truncated), recommended action

**Diagnosis Card** (`diagnosis-card.tsx`):
- Root cause with icon
- Confidence score as colored progress bar (red < 0.5, yellow 0.5-0.8, green > 0.8)
- Reasoning text (expandable)
- LLM model used + latency

**Evidence Chain** (`evidence-chain.tsx`):
- Vertical list of evidence items: metric name, value, context explanation
- Visual indicators (up/down arrows for anomalous values)

**Action Panel** (`action-panel.tsx`):
- Recommended action with description
- Parameters displayed as key-value pairs
- Urgency badge (immediate=red, soon=yellow, monitor=blue)
- "Apply Fix" button (disabled for now — SP-5 will wire this up)

### STEP 8: Real-Time Updates

Wire WebSocket throughout:
- Overview cards update on metric_summary
- Alert counts badge updates on new alerts
- Alert timeline gets new entries on alert events
- Diagnosis list gets new entries on diagnosis events
- Node detail charts append new data points
- Toast notifications for CRITICAL alerts

### STEP 9: next.config.ts + Proxy

Configure API proxy to avoid CORS:
```typescript
// next.config.ts
const nextConfig = {
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:8000/api/:path*' },
      { source: '/ws/:path*', destination: 'http://localhost:8000/ws/:path*' },
    ]
  },
}
```

### STEP 10: Polish + Responsive

- Loading skeletons for all data-fetching components
- Error states with retry buttons
- Mobile-responsive sidebar (collapsible)
- Keyboard shortcuts: `g o` → overview, `g a` → alerts, `g d` → diagnoses

## Testing

- Use Playwright or Vitest for component tests
- Test API client functions with msw (mock service worker)
- Test WebSocket reconnection logic
- Verify all pages render without errors

## Verification

```bash
# Start backend
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000

# Start sidecar (generates test data)
source ~/.cargo/env && cd sidecar && cargo run -- --simulate --inject-fault thermal_throttle

# Start dashboard
cd dashboard && npm run dev

# Visit http://localhost:3000
# Should see: node-0 with thermal alerts, real-time updates
```

## Commit Strategy
- Commit after each step
- Push to branch `feature/sp4-dashboard`
- Create PR for review
