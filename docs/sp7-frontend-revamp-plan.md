# SP-7 — Frontend Revamp: Design Spec + Implementation Plan

**Status:** Approved design, ready for autonomous execution.
**Owner:** Any agent (written to be followed exactly by a smaller model).
**Scope:** The Next.js dashboard in `dashboard/`. Landing page (`public/landing.html`) is **out of scope**.

> This document is **self-sufficient**. The code blocks below are authoritative — copy them verbatim. Two HTML mockups exist as *visual* references only (they live in a gitignored session dir and may be cleaned up over time):
> - `.superpowers/brainstorm/74990-1781946388/content/page-anatomy.html` — the target Alerts page (PageHeader + Toolbar + dense rows).
> - `.superpowers/brainstorm/74990-1781946388/content/component-kit.html` — the primitive kit.

---

## 0. Locked decisions (do not re-litigate)

1. **Focus:** in-app pages only. Landing stays as-is.
2. **Personality:** premium shell (spacious headers/toolbars) + dense data regions (compact rows, tabular-nums, sparklines). Think Linear/Vercel chrome wrapped around Datadog-dense tables.
3. **Approach:** design-system-first. Build the missing page-level primitives, tighten tokens, then sweep every page onto a shared `PageHeader → Toolbar → content` anatomy.
4. **Attestations:** seed realistic demo data (backend has no attestation endpoint). Clearly labeled "devnet sample" in the UI.
5. **Keep as-is (token-align only, do not rebuild):** `NodeCard`, `DiagnosisCard`, `KpiStrip`, `Sparkline`/`SparkBars`, `Card`, `Button`, `Badge`, the realtime hooks, the auth gate, keyboard shortcuts, sidebar nav.

---

## 1. Stack & conventions (match these exactly)

- **Next.js 16, React 19, Tailwind v4 (CSS-first config), shadcn/ui pattern, Recharts, lucide-react.**
- Tailwind v4 tokens live in `dashboard/src/app/globals.css` under `@theme inline` (CSS vars → utilities). There is **no `tailwind.config.js`**. Do not create one.
- Utilities: `cn`, `formatTimestamp`, `formatRelativeTime` from `@/lib/utils`.
- Path alias `@/` → `dashboard/src/`.
- Client components need `"use client";` at the top **only when they use hooks/handlers** (`useState`, `onClick`, etc.). Pure presentational components do not.
- Use `import type { ReactNode } from "react"` and type with `ReactNode` (not `React.ReactNode`) to avoid namespace issues.
- Existing primitives: `Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription` (`@/components/ui/card`); `Button` with variants `default|destructive|outline|secondary|ghost|link`, sizes `default|sm|lg|icon` (`@/components/ui/button`); `Badge` with variants `default|secondary|destructive|outline|warning|success|info` (`@/components/ui/badge`); `Skeleton`, `Sparkline`, `SparkBars` (`@/components/ui/sparkline`).

---

## 2. Design tokens (Step 0 — do this first)

### 2a. Add a `surface-2` token

In `dashboard/src/app/globals.css`, inside the `@theme inline { ... }` block, add one line (alongside the other `--color-*` mappings):

```css
  --color-surface-2: var(--surface-2);
```

Then define the value in both themes. In the dark block (`:root, [data-theme="dark"]`):

```css
  --surface-2: #101017;
```

In the light block (`[data-theme="light"]`):

```css
  --surface-2: #f4f4f5;
```

This gives a `bg-surface-2` utility used by toolbars and segmented controls.

### 2b. Existing tokens (reference — already defined, reuse these)

| Token | Dark | Light | Utility |
|---|---|---|---|
| `--background` | `#09090b` | `#fafafa` | `bg-background` |
| `--card` | `#0a0a0f` | `#ffffff` | `bg-card` |
| `--foreground` | `#fafafa` | `#0a0a0f` | `text-foreground` |
| `--muted-foreground` | `#a1a1aa` | `#52525b` | `text-muted-foreground` |
| `--border` | `#27272a` | `#e4e4e7` | `border` |
| `--primary` (brand) | `#FF6B35` | `#FF6B35` | `bg-primary` / `text-primary` |
| `--ok` / `--warn` / `--crit` / `--info` | `#10b981` / `#f59e0b` / `#ef4444` / `#3b82f6` | (lighter variants) | via inline `style` or sparkline `stroke` |

### 2c. Standard class strings (reuse everywhere)

| Pattern | Class string |
|---|---|
| Page title | `text-2xl font-bold tracking-tight` |
| Page subtitle | `max-w-2xl text-sm text-muted-foreground` |
| Eyebrow | `text-[11px] font-semibold uppercase tracking-wider text-primary` |
| Meta chip | `inline-flex items-center gap-1.5 rounded-md border bg-card/60 px-2 py-1 text-xs text-muted-foreground` |
| Mono cell | `font-mono text-xs` |
| Tabular number | `font-mono text-xs tabular-nums` |
| Dense table header cell | `px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` |
| Dense table body cell | `px-3 py-2.5` |

---

## 3. New primitives (Step 1 — create these 8 files)

Create each file verbatim under `dashboard/src/components/ui/`. Run `npx tsc --noEmit` after creating all of them.

### 3.1 `page-header.tsx`

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface PageMetaChip {
  key?: string;
  tone?: "ok" | "warn" | "crit" | "info" | "muted";
  children: ReactNode;
}

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  /** Badge rendered next to the title (e.g. a live count pill). */
  badge?: ReactNode;
  meta?: PageMetaChip[];
  actions?: ReactNode;
  className?: string;
}

const TONE_DOT: Record<NonNullable<PageMetaChip["tone"]>, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-500",
  info: "bg-blue-500",
  muted: "bg-zinc-500",
};

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  badge,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 md:flex-row md:items-start md:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {meta.map((m, i) => (
              <span
                key={m.key ?? i}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card/60 px-2 py-1 text-xs text-muted-foreground"
              >
                {m.tone && <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[m.tone])} />}
                {m.children}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
```

### 3.2 `segmented-control.tsx`

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-lg border bg-surface-2 p-0.5", className)} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={cn("font-mono text-[10px] tabular-nums", active ? "opacity-70" : "opacity-50")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

### 3.3 `toolbar.tsx`

```tsx
"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 min-w-[180px] flex-1 items-center gap-2 rounded-md border bg-background px-2.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Search className="h-3.5 w-3.5" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
```

### 3.4 `data-table.tsx`

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  className?: string;
}

const ALIGN: Record<string, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  empty,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                  ALIGN[c.align ?? "left"],
                  c.headerClassName,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted-foreground">
                {empty ?? "No data"}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b transition-colors last:border-b-0",
                  onRowClick && "cursor-pointer hover:bg-accent/40",
                  rowClassName?.(row),
                )}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2.5", ALIGN[c.align ?? "left"], c.className)}>
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

### 3.5 `empty-state.tsx`

```tsx
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

### 3.6 `error-banner.tsx`

```tsx
"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface ErrorBannerProps {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ title = "Something went wrong", message, onRetry, className }: ErrorBannerProps) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3", className)}>
      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-red-400">{title}</div>
        <div className="text-xs text-red-400/80">{message}</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

### 3.7 `stat-tile.tsx`

```tsx
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, unit, hint, className }: StatTileProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
```

### 3.8 `select.tsx` (native select, styled — unifies all the raw `<select>`s)

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "h-8 rounded-md border bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
```

---

## 4. Attestations demo data (Step 2)

Create `dashboard/src/lib/demo-attestations.ts`:

```ts
import type { Attestation } from "@/components/training/attestations-table";

// SAMPLE DATA — the backend has no /attestations endpoint yet. These rows let
// the Attestations page demonstrate the on-chain feature. The UI labels them
// "devnet sample". Replace getDemoAttestations() with a real fetcher once the
// backend bridge ships.

const MIN = 60_000;

export function getDemoAttestations(): Attestation[] {
  const now = Date.now();
  return [
    { signature: "4Hk2z8qPm7vR3cXy1aDb9wUtNfLe2sJo6VvK0Hp", node_id: "node-a03", outer_step: 8420, job_id: "nano-dilo-01", staked_sol: 16.4, status: "confirmed", slot: 312884071, timestamp_ms: now - 0.4 * MIN, validator: "Probe11…uF9p" },
    { signature: "2rWm8QaZc9FpL3kYxVbN7HdTsEjRoUqi1AeW0Zd", node_id: "node-a01", outer_step: 8420, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884070, timestamp_ms: now - 1 * MIN, validator: "Probe11…uF9p" },
    { signature: "9Bf3LpQ2sM8vRxKcT6YwHaZdNoEuIj7km0VbC1q", node_id: "node-a07", outer_step: 8419, job_id: "nano-dilo-01", staked_sol: 8.2, status: "pending", slot: 312884069, timestamp_ms: now - 2 * MIN, validator: "ProbeCq…3aKr" },
    { signature: "5KpQ8wZxE2mNvRcHfL6sTbYaD9JjUoIi0nWqV3r", node_id: "node-a02", outer_step: 8419, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884068, timestamp_ms: now - 4 * MIN, validator: "Probe11…uF9p" },
    { signature: "7HmZkQ1wExNvRcTfL6sPbYaD9JjUoIi2nWqV4tB", node_id: "node-a04", outer_step: 8418, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884067, timestamp_ms: now - 6 * MIN, validator: "Probe11…uF9p" },
    { signature: "1PqEwZ8kNxMvRcTfL4sPbYaD9JjUoIi3nWqV5cC", node_id: "node-a09", outer_step: 8418, job_id: "nano-dilo-01", staked_sol: 4.1, status: "slashed", slot: 312884066, timestamp_ms: now - 9 * MIN, validator: "ProbeRz…8wQe" },
    { signature: "3TqAwZ7kMxNvRcTfL5sPbYaD9JjUoIi4nWqV6dD", node_id: "node-a05", outer_step: 8417, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884065, timestamp_ms: now - 12 * MIN, validator: "Probe11…uF9p" },
    { signature: "6UqBwZ5kLxNvRcTfL7sPbYaD9JjUoIi5nWqV7eE", node_id: "node-a06", outer_step: 8417, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884064, timestamp_ms: now - 18 * MIN, validator: "ProbeCq…3aKr" },
  ];
}
```

---

## 5. Per-page implementation (Step 3)

**Shared rule for every page:** wrap the page body in `<div className="space-y-6">…</div>` (most already do). Top of that div: `<PageHeader …/>`. If the page has filters: a `<Toolbar>…</Toolbar>` as the second child. Replace any ad-hoc error block with `<ErrorBanner …/>` and any "No X" `<p>` with `<EmptyState …/>`.

The breadcrumb in the global `Header` component already reflects the route — `PageHeader` does **not** render a breadcrumb.

### 5.1 `/overview` — `src/app/overview/page.tsx`

Light touch. Replace the bare `<h1>` block with a `PageHeader`. Keep `KpiStrip`, `ClusterSummary`, `RecentAlerts`, all hooks/history logic unchanged.

Replace:
```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Cluster Overview</h1>
      </div>
```
with:
```tsx
      <PageHeader
        title="Cluster Overview"
        subtitle="Real-time health across every sidecar-connected GPU node."
        meta={[
          { tone: "ok", children: `${nodes.length} nodes live` },
          { tone: healthError ? "crit" : "ok", children: healthError ? "backend unreachable" : "streaming" },
        ]}
      />
```
Add `import { PageHeader } from "@/components/ui/page-header";`. Replace the `healthError` block with `<ErrorBanner message={`Backend unreachable: ${healthError}`} />` (import it).

### 5.2 `/nodes` — `src/app/nodes/page.tsx`

Add a `PageHeader` + `Toolbar` (search + status filter). Keep `NodeCard` grid. Add an `EmptyState`.

```tsx
"use client";

import { useMemo, useState } from "react";
import { NodeCard } from "@/components/nodes/node-card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar, ToolbarSearch } from "@/components/ui/toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@/components/ui/button";
import { RefreshCw, Server } from "lucide-react";
import { useNodes } from "@/hooks/use-nodes";
import { nodeTone } from "@/lib/derive";

type StatusFilter = "all" | "healthy" | "degraded";

export default function NodesPage() {
  const { nodes, loading, error, refresh } = useNodes();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    let next = nodes;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      next = next.filter((n) => n.node_id.toLowerCase().includes(q) || (n.gpu_model ?? "").toLowerCase().includes(q));
    }
    if (status !== "all") {
      next = next.filter((n) => (status === "healthy" ? nodeTone(n) === "ok" : nodeTone(n) !== "ok"));
    }
    return next;
  }, [nodes, query, status]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nodes"
        eyebrow="Monitoring"
        subtitle="GPU nodes reporting through the sidecar. Click a node for live metrics."
        badge={<span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-primary"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{nodes.length} live</span>}
      />

      {error ? (
        <ErrorBanner title="Couldn't load nodes" message={error} onRetry={refresh} />
      ) : (
        <Toolbar>
          <SegmentedControl<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All" },
              { value: "healthy", label: "Healthy" },
              { value: "degraded", label: "Degraded" },
            ]}
          />
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search node id, GPU model…" />
          <Button variant="outline" size="sm" onClick={() => refresh()} className="ml-auto">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </Toolbar>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title={nodes.length === 0 ? "No nodes connected" : "No nodes match your filters"}
          description={nodes.length === 0 ? "Start a sidecar to begin streaming metrics." : "Try clearing the search or status filter."}
          action={nodes.length === 0 ? <code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-primary">make demo</code> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((node) => <NodeCard key={node.node_id} node={node} />)}
        </div>
      )}
    </div>
  );
}
```

**Verify `nodeTone` exists** in `@/lib/derive` (it does — `NodeCard` imports it). If `gpu_model` is not a field on `NodeStatus`, drop that clause from the search filter.

### 5.3 `/nodes/[nodeId]` — `src/app/nodes/[nodeId]/page.tsx`

Add `PageHeader` with a back link, the node id, and the auto-refresh badge. Keep `GpuCharts`.

Replace the existing header div with:
```tsx
      <PageHeader
        title={<span className="font-mono">{nodeId}</span>}
        eyebrow="Monitoring / Nodes"
        subtitle="Live GPU metrics for this node, auto-refreshing every 5s."
        actions={<Badge variant="outline">Auto-refresh: 5s</Badge>}
      />
```
Keep the `ArrowLeft` back link — move it into the `actions` or render `<Link href="/nodes"><ArrowLeft/></Link>` just above `PageHeader`. Keep error/empty states, swapping in `ErrorBanner`/`EmptyState`.

### 5.4 `/alerts` — `src/app/alerts/page.tsx`

Apply the screen-1 mock. Replace the bare `<h1>` and the ad-hoc filter pill row with `PageHeader` + `Toolbar`. Keep all realtime logic (`useRealtime`, `prepend`, `handleLifecycleChange`, etc.), `SeveritySummary`, `AlertTimeline`, `AlertDetail`.

Replace the `<h1>` block:
```tsx
      <PageHeader
        title="Alerts"
        eyebrow="Monitoring"
        subtitle="Edge and central-detector alerts across the cluster, in real time. Acknowledge, suppress, or send to diagnosis."
        meta={[
          { tone: "crit", children: `${alerts.filter(a => a.severity === "CRITICAL").length} critical` },
          { tone: "warn", children: `${alerts.filter(a => a.severity === "WARNING").length} warning` },
          { tone: "info", children: `${alerts.filter(a => a.severity === "INFO").length} info` },
        ]}
      />
```
Replace the `<div className="flex flex-wrap items-center gap-2">…</div>` filter row with:
```tsx
      <Toolbar>
        <SegmentedControl<string>
          value={severity}
          onChange={selectSeverity}
          options={[
            { value: "ALL", label: "All" },
            { value: "CRITICAL", label: "Crit" },
            { value: "WARNING", label: "Warn" },
            { value: "INFO", label: "Info" },
          ]}
        />
        <button
          onClick={() => setOpenOnly((v) => !v)}
          aria-pressed={openOnly}
          className={`ml-auto inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors ${openOnly ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:text-foreground"}`}
        >
          Open incidents only
        </button>
      </Toolbar>
```
Keep `SeveritySummary` above the toolbar (it uses unfiltered `alerts` — do not change that). Replace the error block with `<ErrorBanner … onRetry={refresh} />`.

**Remove the now-unused `SEVERITIES` constant** at the top of the file (it was only used by the old pill row). If you'd rather keep it, derive the options from it instead: `options={SEVERITIES.map((s) => ({ value: s, label: s === "CRITICAL" ? "Crit" : s === "WARNING" ? "Warn" : s === "INFO" ? "Info" : "All" }))}`. Either way, no unused identifiers (ESLint will fail the build otherwise).

### 5.5 `/diagnoses` — `src/app/diagnoses/page.tsx`

Replace the native `<select>` node filter with a `SegmentedControl` + `ToolbarSearch`. Keep `DiagnosisCard`, `EvidenceChain`, `ActionPanel`, all realtime logic.

Replace the `<div className="flex gap-2">…<select/>…</div>` filter block with:
```tsx
      <Toolbar>
        <SegmentedControl<string>
          value={nodeFilter}
          onChange={(v) => { setNodeFilter(v); setSelectedId(null); }}
          options={[
            { value: "", label: "All nodes" },
            ...nodeIds.map((id) => ({ value: id, label: id })),
          ]}
        />
      </Toolbar>
```
(Note: the `useDiagnoses` hook already accepts `node_id: nodeFilter || undefined`, so a segmented control with node ids works directly.) Replace `<h1>Diagnoses</h1>` with `<PageHeader title="Diagnoses" eyebrow="Monitoring" subtitle="LLM-grounded root-cause analyses with evidence chains and recommended actions." />`. Replace error/empty with `ErrorBanner`/`EmptyState` (`EmptyState` with `icon={Brain}` from lucide).

### 5.6 `/training` — `src/app/training/page.tsx`

Already well-structured. Replace the header block:
```tsx
      <PageHeader
        title={job.name ?? job.job_id}
        eyebrow="Monitoring / Training"
        subtitle={<span className="font-mono text-xs">{job.job_id}</span>}
        badge={job.status ? <Badge variant={statusTone(job.status)}>{job.status}</Badge> : undefined}
        meta={summary ? [{ children: `duration ${fmtDuration(summary.run_duration_ms)}` }] : undefined}
      />
```
Convert the "Alerts for this run" `<ul>` to a `DataTable` (columns: severity badge, `alert_type` mono, description, relative time). Keep `RunPanel`, `CustomMetricsCard`, GPU snapshot, config grid. Replace the empty-state `<p>No alerts.</p>` with `EmptyState`. Keep `fmtDuration` and `statusTone` helpers.

### 5.7 `/policies` — `src/app/policies/page.tsx`

Already the best template — light touch. Convert the `<table>` in "All policies" to `DataTable` (columns: name+id, source, field, condition, severity badge, last-triggered, enabled toggle, delete action). Keep `PRESETS`, the drawer, all handlers, the 5s poll. In the drawer form, replace every raw `<select>` with the new `<Select>` component and every raw text `<input>`'s className with the matching `h-8 rounded-md border bg-background px-2.5 text-sm` style (consistency only — behavior unchanged). The header already has subtitle — leave it, or swap to `PageHeader` for uniformity (optional).

### 5.8 `/attestations` — `src/app/attestations/page.tsx`

Wire the demo data and add a summary + "devnet sample" banner. Replace the whole file:

```tsx
"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Badge } from "@/components/ui/badge";
import { AttestationsTable, type Attestation } from "@/components/training/attestations-table";
import { getDemoAttestations } from "@/lib/demo-attestations";

type StatusFilter = "all" | Attestation["status"];

export default function AttestationsPage() {
  const all = useMemo(() => getDemoAttestations(), []);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [error] = useState<string | null>(null);

  const rows = useMemo(
    () => (status === "all" ? all : all.filter((a) => a.status === status)),
    [all, status],
  );

  const totalStaked = all.reduce((s, a) => s + a.staked_sol, 0);
  const slashed = all.filter((a) => a.status === "slashed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attestations"
        eyebrow="On-chain"
        subtitle="Each diagnosis is hashed, signed, and committed to Solana. Validators stake SOL on cluster health; false attestations are slashed."
        badge={<Badge variant="outline" className="font-mono text-[10px]">devnet · sample</Badge>}
        meta={[
          { children: `${all.length} attestations` },
          { children: `◎ ${totalStaked.toFixed(1)} staked` },
          { tone: slashed > 0 ? "crit" : "ok", children: `${slashed} slashed` },
        ]}
      />

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
        Showing sample data — the backend has no attestation endpoint yet. These rows demonstrate the on-chain trust layer.
      </div>

      {error && <ErrorBanner message={error} />}

      <Toolbar>
        <SegmentedControl<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "confirmed", label: "Confirmed" },
            { value: "pending", label: "Pending" },
            { value: "slashed", label: "Slashed" },
          ]}
        />
      </Toolbar>

      <AttestationsTable attestations={rows} loading={false} />
    </div>
  );
}
```

(Leave the `AttestationsTable` component itself unchanged — it already renders explorer links and status badges.)

---

## 6. Ordered task list (execute top-to-bottom)

Each step ends with a verification command. Do not mark a step done unless its check passes.

- [ ] **S0. Tokens.** Edit `globals.css` per §2a. → `cd dashboard && npx tsc --noEmit` (expect: no new errors).
- [ ] **S1. Primitives.** Create the 8 files in §3 (`page-header`, `segmented-control`, `toolbar`, `data-table`, `empty-state`, `error-banner`, `stat-tile`, `select`). → `npx tsc --noEmit` (expect: clean).
- [ ] **S2. Demo data.** Create `lib/demo-attestations.ts` per §4. → `npx tsc --noEmit`.
- [ ] **S3. Overview** (§5.1). → `npm run dev`, open `/overview`, confirm header + meta chips render, KPIs intact.
- [ ] **S4. Nodes** (§5.2). → search + status filter work, empty state shows when filtered to nothing, Refresh is a button.
- [ ] **S5. Node detail** (§5.3). → back link + header render, charts intact.
- [ ] **S6. Alerts** (§5.4). → segmented filter works, `SeveritySummary` still shows unfiltered totals, realtime prepend still works (trigger an alert via the backend/simulator).
- [ ] **S7. Diagnoses** (§5.5). → node segmented filter works, selecting a card shows evidence/action sidebar.
- [ ] **S8. Training** (§5.6). → header + status badge render, alerts DataTable renders.
- [ ] **S9. Policies** (§5.7). → table still renders, create/toggle/delete still work, drawer form inputs styled consistently.
- [ ] **S10. Attestations** (§5.8). → 8 sample rows render, explorer links open, status filter works, slashed row tinted, sample banner shows.
- [ ] **S11. Polish pass.** Walk every page: confirm each has `PageHeader`, every error is `ErrorBanner`, every empty is `EmptyState`, no bare `<h1>`s remain, titles all use the same class string. Check dark **and** light theme (toggle in header). Check responsive at 768px and 375px (sidebar collapses, grids reflow, tables scroll horizontally).
- [ ] **S12. Final verification.** `npx tsc --noEmit && npm run lint`. Both must pass.

---

## 7. Constraints — do NOT break these

- **Realtime wiring:** every page that uses `useRealtime`/`useWebSocket` must preserve its `onAlert`/`onDiagnosis` callbacks and `prepend`/`append` behavior exactly.
- **Auth gate:** do not touch `AppShell`'s redirect-on-unauthenticated logic or the `useAuth` hook.
- **Keyboard shortcuts:** the `g→o/n/a/d/t/p/c` handlers in `AppShell` must keep working.
- **Hooks:** do not change the signatures or behavior of `useNodes`, `useAlerts`, `useDiagnoses`, `useJobSummary`, `useCustomMetrics`, `useNodeMetrics`, `useRealtime`. Only change what pages *render*.
- **Landing:** do not modify `public/landing.html` or the Next rewrite that serves it.
- **No new dependencies.** Everything uses existing `lucide-react`, `recharts`, `cn`, shadcn primitives.
- **Commits:** no `Co-Authored-By`, no AI attribution lines (per project `CLAUDE.md`). Work on a branch, not `main`.

---

## 8. Done definition

The revamp is complete when:
1. `npx tsc --noEmit` is clean and `npm run lint` passes.
2. All 8 in-app pages use the shared `PageHeader → Toolbar → content` anatomy; no bare `<h1>` headers remain.
3. Every filter uses `SegmentedControl` (no raw `<select>` in page bodies; drawer may use the styled `Select`).
4. Every error state is `ErrorBanner`; every empty state is `EmptyState`.
5. Attestations shows 8 sample rows with working filters and a sample banner.
6. Dark + light themes both look correct; layout holds at 768px and 375px.
7. Realtime updates still flow (alerts/diagnoses prepend live) and the auth gate + keyboard shortcuts still work.

---

## 9. Notes for the executing agent

- **You do not need to design anything.** Every class string, prop, and code block is specified above. Copy verbatim, then adapt only the data-wiring (which hooks/fields exist).
- **If a referenced field doesn't exist** (e.g. `gpu_model`, `nodeTone`), check `src/lib/types.ts` / `src/lib/derive.ts` and adjust that one line — do not abandon the pattern.
- **Verify continuously.** Run `npx tsc --noEmit` after every file you create or edit. Type errors compound; catch them immediately.
- **Prefer the existing component** when one already does the job (`Badge`, `Skeleton`, `Sparkline`, `NodeCard`, `DiagnosisCard`, `KpiStrip`). This plan adds page-level primitives, not replacements for working cards.
