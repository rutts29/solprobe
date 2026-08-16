# SolProbe Dashboard — Design Handoff

Drop-in replacements for `dashboard/src/`. Every file in this package targets a path that already exists in your repo (or sits next to one), uses the same `@/lib/types` shapes, the same shadcn primitives (`Card`, `Badge`, `Skeleton`, `Button`, `cn`, `formatRelativeTime`), and the same hooks (`useNodes`, `useAlerts`, `useDiagnoses`, `useNodeMetrics`, `useWebSocket`, `useRealtime`).

No prop shapes were invented. Nothing to refactor.

## File map

```
handoff/src/
├── app/
│   └── globals.css                        ← REPLACE: adds light theme + accent token
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx                  ← REPLACE: adds theme toggle + Training/Attestations routes
│   │   ├── header.tsx                     ← REPLACE: adds breadcrumb + ⌘K + theme switch
│   │   └── sidebar.tsx                    ← REPLACE: grouped nav (Monitoring / On-chain), cluster picker
│   ├── overview/
│   │   ├── kpi-strip.tsx                  ← NEW: 6-up KPIs with sparklines, replaces health-cards
│   │   ├── cluster-summary.tsx            ← REPLACE: status dots + inline bar gauges + Issues filter
│   │   └── recent-alerts.tsx              ← REPLACE: severity timeline, source pill, confidence
│   ├── nodes/
│   │   └── node-card.tsx                  ← REPLACE: status dot, util/mem/temp bars, sparkline strip
│   ├── alerts/
│   │   └── severity-summary.tsx           ← NEW: critical/warning/info counts + alerts/min bar chart
│   ├── diagnoses/
│   │   └── diagnosis-card.tsx             ← REPLACE: expandable reasoning + evidence chain table
│   ├── training/
│   │   ├── run-panel.tsx                  ← NEW: DiLoCo step progress, loss/MFU/throughput
│   │   └── attestations-table.tsx         ← NEW: on-chain stake/slash table
│   └── ui/
│       └── theme-provider.tsx             ← NEW: light/dark via data-theme on <html>
├── hooks/
│   └── use-theme.ts                       ← NEW: persists theme in localStorage
└── lib/
    └── derive.ts                          ← NEW: pure helpers (avgUtil, status from temp, etc.)
```

## How to integrate

1. **Copy `handoff/src/` over `dashboard/src/`.** Files marked REPLACE shadow the existing ones; NEW files don't collide.
2. **No new dependencies** — uses only `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, all already in `package.json`.
3. **No type changes** — every component imports from `@/lib/types` exactly as written.
4. **Theme switching** — the new `globals.css` defines both `:root` (dark, current) and `[data-theme="light"]`. The `<ThemeProvider>` flips the attribute. Wrap it in `app/layout.tsx` inside `<WebSocketProvider>`.
5. **New routes** — Training and Attestations pages aren't in this drop yet; the sidebar links to `/training` and `/attestations`. Add `app/training/page.tsx` and `app/attestations/page.tsx` when you wire those endpoints. The components (`run-panel.tsx`, `attestations-table.tsx`) are ready to render whatever shape you define.

## Data contract

Every component consumes the existing types verbatim:

| Component | Type from `@/lib/types` |
|---|---|
| `KpiStrip` | `NodeStatus[]`, `AlertModel[]`, `HealthStatus` |
| `ClusterSummary` | `NodeStatus[]` (uses `latest_metrics[0]`, `gpu_temp_c`, `gpu_utilization_pct`, `fb_used_mb`, `fb_free_mb`) |
| `NodeCard` | `NodeStatus` |
| `RecentAlerts` | `AlertModel[]` |
| `SeveritySummary` | `AlertModel[]` |
| `DiagnosisCard` | `DiagnosisResult` |
| `RunPanel` | `TrainingMetrics`, `DiLoCoMetrics` (latest + history) |

## What's intentionally NOT changed

- `lib/api.ts`, `lib/types.ts`, `lib/websocket.tsx`, `lib/utils.ts` — untouched. Stable contract.
- `hooks/use-nodes.ts`, `hooks/use-alerts.ts`, `hooks/use-realtime.ts` — untouched.
- `components/ui/{card,badge,button,skeleton,tabs,separator}.tsx` — untouched.

The point of this handoff is the **visual layer only**. The data layer you've built is correct and stays.
