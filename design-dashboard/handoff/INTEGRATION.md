# Integration steps

## 1. Drop in
```sh
cp -r handoff/src/* dashboard/src/
```

REPLACE files (overwrite existing):
- `app/globals.css`
- `app/layout.tsx`
- `app/overview/page.tsx`
- `app/alerts/page.tsx`
- `components/layout/{sidebar,header,app-shell}.tsx`
- `components/overview/{cluster-summary,recent-alerts}.tsx`  *(remove old `health-cards.tsx`)*
- `components/nodes/node-card.tsx`
- `components/diagnoses/diagnosis-card.tsx`

NEW files (no collision):
- `app/training/page.tsx`
- `app/attestations/page.tsx`
- `components/overview/kpi-strip.tsx`
- `components/alerts/severity-summary.tsx`
- `components/training/{run-panel,attestations-table}.tsx`
- `components/ui/{theme-provider,sparkline}.tsx`
- `hooks/use-theme.ts`
- `lib/derive.ts`

## 2. Delete
- `components/overview/health-cards.tsx` — replaced by `KpiStrip`.

## 3. No new deps
Everything uses what's already in `package.json` (`lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`).

## 4. Verify
- `npm run build` — should pass with zero type errors. All components import from `@/lib/types` exactly as the originals do.
- Theme toggle in the header flips `data-theme` on `<html>`; persisted to `localStorage["solprobe-theme"]`.

## 5. Wire later
- **Training page** uses `nodes[].latest_training` / `latest_diloco`. When `/api/v1/training/runs` lands, swap the selector at the top of `app/training/page.tsx`.
- **Attestations page** has a `fetchAttestations()` stub returning `[]`. Replace with a real call once the on-chain endpoint ships; the table component already accepts the `Attestation[]` shape.
- **Sidebar nodes/alerts badges** still feed off `useWebSocket().alertCount` and `health.connected_sidecars` — unchanged.
