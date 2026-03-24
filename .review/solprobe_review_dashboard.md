I'll systematically read all files in the dashboard/src/ directory to perform a thorough code review.

---

I now have a complete picture of the entire codebase. Let me compile the full review.

---

# SolProbe Dashboard — Deep Code Review

Total files reviewed: 41 (all `.tsx`/`.ts` files in `src/` plus `next.config.ts`, `tsconfig.json`, `package.json`).

---

## BREAKING Issues

---

### Finding 1
**File:Line** — `src/lib/websocket.tsx:6`
**Category** — Bug
**Risk Level** — BREAKING
**Description** — The `WS_URL` module-level constant is evaluated once at module load time. On the server (SSR/prerender), `typeof window !== "undefined"` is `false`, so the fallback `ws://localhost:3000` is permanently baked into the string. When this module is subsequently imported on the client, `WS_URL` already holds the server-evaluated fallback value rather than being re-computed from `window.location`. Since `websocket.tsx` is a Client Component (`"use client"`), the actual WebSocket constructor runs on the client, but it still uses the string that was captured during the server evaluation of the module-level expression. In a deployed environment where the host is not `localhost:3000`, the WebSocket will always connect to the wrong URL.
**Suggested Fix** — Move URL construction inside the `connect()` function (or a `useRef` that is initialized inside the `useEffect`), so it runs exclusively on the client with the real `window.location`.

---

### Finding 2
**File:Line** — `src/lib/websocket.tsx:69–76`
**Category** — Bug
**Risk Level** — BREAKING
**Description** — The exponential backoff multiplier is applied *after* scheduling the reconnect, not before. The sequence is: `setTimeout(reconnect, reconnectDelay.current)` then inside the callback `reconnectDelay.current = reconnectDelay.current * 2`. This means the first reconnect fires after 1 s, the second also after 1 s (the delay was updated only after the first callback ran), and so on — the doubling happens one cycle late. In a rapid close/error loop this effectively disables the backoff for the first two attempts, which can hammer the backend under network instability.
**Suggested Fix** — Apply the multiplier before scheduling: `reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY); reconnectTimer.current = setTimeout(connect, reconnectDelay.current);`.

---

### Finding 3
**File:Line** — `src/lib/websocket.tsx:79–82`
**Category** — Bug
**Risk Level** — BREAKING
**Description** — The `onerror` handler calls `ws.close()`. When a `WebSocket` encounters an error, the browser automatically fires `onclose` immediately after `onerror`. Calling `ws.close()` explicitly inside `onerror` triggers a *second* `onclose` event, which schedules a second independent reconnect timer. This creates duplicate reconnect loops. Under sustained connection failures there will be exponentially growing concurrent reconnect timers, each creating its own WebSocket and listener, causing memory leaks and duplicate message processing.
**Suggested Fix** — Remove `ws.close()` from `onerror`. The browser's automatic close sequence is sufficient; just log the error.

---

### Finding 4
**File:Line** — `src/lib/websocket.tsx:128–132` + `src/lib/websocket.tsx:72`
**Category** — Bug / Performance
**Risk Level** — BREAKING
**Description** — The cleanup function in the `useEffect` clears only `reconnectTimer.current` and closes the current WebSocket. However, if the component unmounts while a reconnect timer is *pending* and `unmounted = true` is set, the closure's `unmounted` flag prevents the timer callback from calling `connect()` — this part is correct. But if `wsRef.current` is closed while a new `connect()` call is already in flight (between `new WebSocket()` and `onopen`), the cleanup only closes the `wsRef.current` reference at time of unmount. There is no `mounted`-guard inside the `onopen`, `onclose`, or `onmessage` handlers, so if a partially-initialized WebSocket's event fires after unmount, it will call `setState` on an unmounted component, causing a state update on unmounted component warning in React.
**Suggested Fix** — Add an `if (unmounted) return;` guard at the top of each `ws.on*` handler (not just in `connect()`), and nullify `wsRef.current` in the cleanup before closing.

---

## HIGH Issues

---

### Finding 5
**File:Line** — `src/hooks/use-realtime.ts:28`
**Category** — Bug / Performance
**Risk Level** — HIGH
**Description** — The `useEffect` dependency array is `[subscribe, handlers.onAlert, handlers.onMetricSummary, handlers.onDiagnosis]`. `subscribe` is a stable `useCallback` (correct), but the three handler references are taken directly from an inline `handlers` object. In `overview/page.tsx:34`, `useRealtime(ws.subscribe, { onAlert })` is called: the `handlers` object literal is created fresh each render, so `handlers.onAlert`, `handlers.onMetricSummary`, and `handlers.onDiagnosis` are new references on every render. This causes `useEffect` to re-subscribe every time the parent re-renders, creating and immediately tearing down subscriptions on every re-render and briefly dropping real-time messages.
**Suggested Fix** — Accept handlers as individual props or as a `useRef`-stabilized object. Alternatively, destructure in the caller before passing, or wrap with `useMemo`/`useCallback` at each call site.

---

### Finding 6
**File:Line** — `src/hooks/use-alerts.ts:22` and `src/hooks/use-alerts.ts:50`
**Category** — Bug
**Risk Level** — HIGH
**Description** — The `useCallback` dependency array uses `params?.severity`, `params?.node_id`, `params?.limit` as inline primitives, which is correct. However, the `params` object itself is typically an object literal defined inline in the parent component (e.g., `useAlerts({ severity: severity === "ALL" ? undefined : severity, limit: 50 })`). When `severity` state changes in `alerts/page.tsx`, the parent re-renders, creating a new `params` object. The `useCallback` dep array only lists the primitive fields, so `refresh` is correctly stable between renders when the primitives haven't changed — but when `severity` changes, `refresh` is recreated, triggering `useEffect`, but there is no `loading` reset on re-fetch. The loading indicator is only `true` on the initial mount (`useState(true)`). On every subsequent severity filter change, the old data stays visible with no loading state while the new fetch is in flight, creating a stale-data flash.
**Suggested Fix** — Reset `setLoading(true)` at the start of `refresh()` before the `await` (or add a separate `fetching` state).

---

### Finding 7
**File:Line** — `src/hooks/use-nodes.ts:25–28` and `src/app/overview/page.tsx:15`
**Category** — Bug / Performance
**Risk Level** — HIGH
**Description** — `useNodes()` starts a `setInterval` polling at 5 s. `useNodes()` is called from `OverviewPage`, and `NodeCard` list data is also driven by `useWebSocket().nodeStatuses` via `ws.nodeStatuses` (in `AppShell`). The Overview page uses `useNodes()` polling *and* the WebSocket pushes `metric_summary` events. But neither path deduplicates or cancels the other: the polling will keep firing even when the WebSocket is delivering live data, doubling backend load. Additionally, there is no `AbortController` in the polling fetch — if a slow response arrives after a newer response, it can overwrite the newer data with stale data (classic race condition).
**Suggested Fix** — Use `AbortController` in `refresh()` and abort in the cleanup. Consider disabling REST polling when `ws.connected === true`.

---

### Finding 8
**File:Line** — `src/app/alerts/page.tsx:17–20`
**Category** — Bug
**Risk Level** — HIGH
**Description** — When the severity filter changes (e.g., from `"ALL"` to `"CRITICAL"`), `useAlerts` is called with new params. This creates a new `refresh` callback which fires the `useEffect`. However, new real-time alerts prepended via `prepend()` (from the WebSocket) are prepended *without* checking whether they match the active severity filter. A `"WARNING"` alert arrives via WebSocket while the user has selected `"CRITICAL"` — the alert still gets inserted at the top of the filtered list. This is a data correctness bug visible to users.
**Suggested Fix** — In the `onAlert` callback, check `if (severity === "ALL" || msg.data.severity === severity)` before calling `prepend()`.

---

### Finding 9
**File:Line** — `src/components/alerts/alert-detail.tsx:26–49`
**Category** — Bug
**Risk Level** — HIGH
**Description** — The `useEffect` fires two parallel fetches (`fetchEnrichedAlert` and `fetchAlertDiagnosis`) with no cancellation or `isCurrent` guard. If the user clicks alert A, then quickly clicks alert B, the effect for alert A might still be in flight. The `alert.alert_id` dep correctly causes re-run, but both in-flight promises still hold closures over the same `setEnriched`/`setDiagnosis` setters. Whichever resolves last wins, regardless of which alert is currently selected. The panel can display enrichment data from alert A while showing the header for alert B.
**Suggested Fix** — Add a `let cancelled = false` guard in the effect, and check before each `setState` call. Return `() => { cancelled = true; }` from the effect. Alternatively use `AbortController` with `fetch` (requires passing a signal down to `apiFetch`).

---

### Finding 10
**File:Line** — `src/components/charts/loss-chart.tsx:24`
**Category** — Bug
**Risk Level** — HIGH
**Description** — The YAxis uses `scale="log"`. A logarithmic scale will crash or display an empty chart when any `loss` or `gradNorm` value is `0` or negative (log of 0 is `-Infinity`, log of a negative is `NaN`). Training loss can legitimately be 0 after convergence, and `gradNorm` can be 0 at certain steps. Recharts does not handle this gracefully — it silently drops the data points, or in some versions throws a render error.
**Suggested Fix** — Filter out `loss <= 0` before rendering, or add a small epsilon floor (`Math.max(value, 1e-8)`), or switch to linear scale with auto domain and let users toggle log scale.

---

### Finding 11
**File:Line** — `next.config.ts:6–8`
**Category** — Architecture / Security
**Risk Level** — HIGH
**Description** — The rewrite proxy hardcodes `http://localhost:8000`. In any non-local environment (staging, production, Docker, K8s), this will fail silently: the Next.js server will attempt to proxy to a port that doesn't exist on its own host, returning a 502 with no clear error. The WS rewrite `{ source: "/ws/:path*", destination: "http://localhost:8000/ws/:path*" }` uses HTTP, not WS — Next.js rewrites use HTTP/HTTPS protocols, so the WebSocket upgrade handshake will fail when going through the proxy. The actual WebSocket URL computed in `websocket.tsx` resolves to `ws://host/ws/stream` which hits this rewrite, converting to `http://localhost:8000/ws/stream` — the Upgrade header is forwarded only in some Next.js versions and configurations.
**Suggested Fix** — Make the backend URL configurable via `process.env.BACKEND_URL`. For WebSocket specifically, document that `NEXT_PUBLIC_WS_URL` should point directly to the backend (bypassing the HTTP proxy) in non-dev environments. Add `experimental: { proxyTimeout: ... }` if needed.

---

## MEDIUM Issues

---

### Finding 12
**File:Line** — `src/components/layout/app-shell.tsx:33–36`
**Category** — Bug
**Risk Level** — MEDIUM
**Description** — `criticalAlerts` is a counter that only ever increments; it is never reset. If the user navigates away and back, or if critical alerts are resolved, the count stays inflated forever. There is also no persistence boundary — on page refresh the count resets to 0, so "3 Critical" could immediately disappear.
**Suggested Fix** — Drive `criticalAlerts` from the alerts list rather than a side-effect counter, or add an explicit "dismiss" mechanism with a reset button.

---

### Finding 13
**File:Line** — `src/components/layout/app-shell.tsx:41–58`
**Category** — UX / Bug
**Risk Level** — MEDIUM
**Description** — The keyboard shortcut handler uses `window.location.href` for navigation. This causes a full page reload instead of a client-side Next.js navigation, bypassing the App Router and losing all React state (WebSocket state, loaded data, etc.).
**Suggested Fix** — Use Next.js `useRouter().push()` for navigation.

---

### Finding 14
**File:Line** — `src/lib/websocket.tsx` — no heartbeat/ping mechanism
**Category** — Feature Gap
**Risk Level** — MEDIUM
**Description** — There is no client-side ping/heartbeat. Many reverse proxies (nginx, AWS ELB) and firewalls close idle WebSocket connections after 60–120 s of inactivity. If the backend sends no messages for that period, the connection will be silently dropped. `onclose` will fire eventually, but not immediately, causing the UI to show "Live" for up to the proxy timeout duration while no data is actually flowing.
**Suggested Fix** — Send a JSON ping message every 30 s (`ws.send(JSON.stringify({ type: "ping" }))`), and if no message is received for 60 s, proactively close and reconnect.

---

### Finding 15
**File:Line** — `src/app/overview/page.tsx:37–45`
**Category** — Performance
**Risk Level** — MEDIUM
**Description** — `avgGpuUtil` is computed in an IIFE on every render of `OverviewPage`. This iterates over all nodes and all their metrics on each render (including renders triggered by the 5 s polling or any WebSocket message). With N nodes × M GPUs per node, this runs unnecessarily often.
**Suggested Fix** — Wrap the computation in `useMemo` with `nodes` as the dependency.

---

### Finding 16
**File:Line** — `src/components/nodes/gpu-charts.tsx:100–103`
**Category** — Performance
**Risk Level** — MEDIUM
**Description** — `MemoryBar` maps over `data.slice(-20)` every render and creates `new Date(d.timestamp_ms).toLocaleTimeString()` for each element inline. The same pattern exists in `PowerChart` (line 119), `TempChart` (line 11), `UtilizationChart` (line 11), `LossChart` (line 11), and `ThroughputChart` (line 11). Each chart component re-creates the full derived `chartData` array on every render. With auto-refresh at 5 s and 4–6 charts per tab, this means 4–6 full array allocations and date formatting operations every 5 s even when data hasn't changed.
**Suggested Fix** — Wrap `chartData` derivations in `useMemo` keyed on the `data` prop in each chart component.

---

### Finding 17
**File:Line** — `src/app/diagnoses/page.tsx:30`
**Category** — Performance / UX
**Risk Level** — MEDIUM
**Description** — `nodeIds` is computed with `[...new Set(diagnoses.map(d => d.node_id))]` on every render. This is an O(N) operation over all diagnoses on every render, including renders triggered by `append()` (WebSocket). Also, the node filter dropdown is populated from *already loaded* diagnoses, not from a separate nodes endpoint. This means if a node has no diagnoses yet, it won't appear in the filter, even though it may be connected and generating metrics.
**Suggested Fix** — `useMemo` for `nodeIds`, and populate the node filter from `useNodes()` rather than from the diagnosis list.

---

### Finding 18
**File:Line** — `src/app/alerts/page.tsx:62–65`
**Category** — UX
**Risk Level** — MEDIUM
**Description** — When `loading` is true, skeletons are shown. But the `AlertDetail` side panel (`selectedAlert`) remains rendered during loading. If the user already had an alert selected and then changes the severity filter (triggering re-fetch), the panel stays open showing data from the previous filter's alert, which may not exist in the new result set.
**Suggested Fix** — Reset `selectedAlert` to `null` when the severity filter changes.

---

### Finding 19
**File:Line** — `src/components/alerts/alert-detail.tsx:65–66`
**Category** — UX / Accessibility
**Risk Level** — MEDIUM
**Description** — The detail panel is implemented as `position: fixed` covering the entire right portion of the screen, but there is no backdrop/overlay, no focus trap, and no `Escape` key handler. The close button is a plain `<button>` without `aria-label`. Screen readers will not announce the panel as a dialog, and keyboard users cannot close it without clicking.
**Suggested Fix** — Add `role="dialog"`, `aria-modal="true"`, `aria-label="Alert Detail"`, a focus trap (`focus-trap-react` or manual), and an `Escape` key handler (`useEffect` on `keydown`). Add a semi-transparent backdrop.

---

### Finding 20
**File:Line** — `src/components/nodes/gpu-charts.tsx:75–116` — `MemoryBar` and `PowerChart` defined in same file as `GpuCharts`
**Category** — Architecture
**Risk Level** — MEDIUM
**Description** — `MemoryBar` and `PowerChart` are declared inline *after* their usage in `GpuCharts` (usage is at lines 40, 44; declarations at lines 79, 118). JavaScript hoisting does not apply to `function` declarations used as JSX components when they are defined below the point of use in the same file in certain module contexts. More importantly, mixing `recharts` imports (`BarChart`, `LineChart`, etc.) alongside component imports at the top of `gpu-charts.tsx` breaks the single-responsibility principle and makes the file hard to test or swap.
**Suggested Fix** — Move `MemoryBar` and `PowerChart` to their own files under `src/components/charts/`, matching the pattern of `temp-chart.tsx`, `utilization-chart.tsx`, etc.

---

### Finding 21
**File:Line** — `src/components/ui/tabs.tsx:10`
**Category** — Architecture
**Risk Level** — MEDIUM
**Description** — `TabsContext` is initialized with a default value of `{ value: "", onValueChange: () => {} }`. A `TabsTrigger` used outside a `<Tabs>` provider will silently receive a no-op context rather than throwing an error, making misconfigured usage impossible to detect. Additionally, the custom `Tabs` implementation lacks keyboard navigation (arrow keys between tabs), which is a WCAG 2.1 Level A violation for tab widget patterns (role="tab" with arrow key support required).
**Suggested Fix** — Throw in `useContext` if `Tabs` parent is missing. Add `role="tablist"`, `role="tab"`, `aria-selected`, and arrow-key `onKeyDown` navigation. Consider replacing with Radix UI's `Tabs` primitive (already used elsewhere in shadcn patterns).

---

### Finding 22
**File:Line** — `src/components/ui/separator.tsx:6–17`
**Category** — Accessibility
**Risk Level** — MEDIUM
**Description** — The `Separator` component is a plain `<div>` without `role="separator"` or `aria-orientation`. Screen readers will not announce it as a separator, reducing structural comprehension for visually impaired users.
**Suggested Fix** — Add `role="separator"` and `aria-orientation={orientation}` to the rendered div, or use Radix UI's `Separator` primitive.

---

### Finding 23
**File:Line** — `src/components/layout/sidebar.tsx:78–83`
**Category** — Accessibility / UX
**Risk Level** — MEDIUM
**Description** — The sidebar collapse toggle button renders `"→"` and `"←"` as text characters. There is no `aria-label`, no `aria-expanded` state, and no `title` attribute. Screen readers will announce "right-pointing arrow" or similar instead of "Collapse sidebar". Additionally, the toggle button has no discernible focus ring or keyboard activation feedback.
**Suggested Fix** — Use proper icon components with `aria-label="Collapse sidebar"` / `aria-label="Expand sidebar"` and `aria-expanded={!collapsed}`.

---

### Finding 24
**File:Line** — `src/app/nodes/[nodeId]/page.tsx:11`
**Category** — UX
**Risk Level** — MEDIUM
**Description** — The node detail page resolves `nodeId` from `params` using React 19's `use(params)`. There is no validation of `nodeId` before passing it to `useNodeMetrics`. If a user navigates to `/nodes/../../etc/passwd` or any path-traversal-style input, it is passed directly to `fetchNodeMetrics`, which constructs `/api/v1/nodes/${nodeId}/metrics`. While the backend should sanitize, the frontend performs no validation. Also, there is no `notFound()` call if the node doesn't exist — the page just shows "No metrics available" with no indication the node ID is invalid.
**Suggested Fix** — Validate `nodeId` against a safe pattern (alphanumeric/dashes) before use, and show a proper 404-style state when the API returns a 404.

---

### Finding 25
**File:Line** — `src/lib/api.ts:17`
**Category** — Bug
**Risk Level** — MEDIUM
**Description** — `apiFetch` calls `await res.text()` in the error path, but `res.text()` is an async operation. If the error response body is large or the network is slow, this blocks the error propagation. More critically, `res.text()` can also fail (e.g., if the body has already been consumed), in which case the `throw new Error(...)` itself would throw an unhandled promise rejection. Additionally, `res.json()` in the success path has no type assertion — it returns `any`, which is then cast to `T`. A backend schema change will silently pass type checking while delivering wrong-shaped data to components.
**Suggested Fix** — Wrap `res.text()` in a try/catch. Consider using a validation library (Zod) for the `res.json()` response shape.

---

### Finding 26
**File:Line** — `src/lib/api.ts:50` and `src/lib/api.ts:82`
**Category** — Code Quality / Architecture
**Risk Level** — MEDIUM
**Description** — `fetchAnomalies` and `fetchJobs` return `unknown[]` and `Promise<unknown[]>` respectively. These endpoints are fetched but the results are never typed or consumed anywhere in the dashboard source tree. This dead API surface makes it unclear whether these endpoints are wired up anywhere or simply placeholders.
**Suggested Fix** — Define proper types for the anomaly and job response shapes in `types.ts`, or remove the functions if they are not yet used.

---

## LOW Issues

---

### Finding 27
**File:Line** — `src/components/overview/recent-alerts.tsx:30`
**Category** — UX
**Risk Level** — LOW
**Description** — `alerts.slice(0, 10)` is applied after the component receives `alerts` (which is already limited to 10 via `useAlerts({ limit: 10 })` in the overview page). The double-slicing is redundant but harmless. However, it means if the limit from the hook is increased, the component silently drops the extra items without any visual indication, which is a confusing hidden constraint.
**Suggested Fix** — Remove the `.slice(0, 10)` in the component since the parent already controls the limit, or make the component's max configurable via prop.

---

### Finding 28
**File:Line** — `src/components/diagnoses/evidence-chain.tsx:19`
**Category** — Code Quality
**Risk Level** — LOW
**Description** — The evidence items use array index `i` as the React key: `key={i}`. If the evidence array is reordered or an item is inserted/removed, React will misidentify items and may display wrong content (wrong icon, wrong border highlight) without re-mounting. Evidence items don't have a natural unique ID, but `item.metric` should be unique within a diagnosis's evidence chain.
**Suggested Fix** — Use `key={item.metric}` or `key={`${item.metric}-${i}`}` as a fallback.

---

### Finding 29
**File:Line** — `src/app/overview/page.tsx:21–27`
**Category** — UX
**Risk Level** — LOW
**Description** — The health fetch in `OverviewPage` fires only once on mount (empty dependency array). The health data displayed in `HealthCards` (connected sidecars, total diagnoses) can become stale immediately as new sidecars connect or diagnoses are created. The `AppShell` also does a single health fetch on mount. The data is duplicated between the two components with no shared cache.
**Suggested Fix** — Either poll health every 30 s or derive `connectedNodes`/`diagnosesToday` from real-time WebSocket state plus the REST fetch.

---

### Finding 30
**File:Line** — `src/components/overview/cluster-summary.tsx:47`
**Category** — UX
**Risk Level** — LOW
**Description** — Memory percentage calculation `(fb_used_mb / (fb_used_mb + fb_free_mb)) * 100` can produce `NaN` if both `fb_used_mb` and `fb_free_mb` are `0` (a possible backend state before metrics arrive). `NaN.toFixed(0)` returns `"NaN"`, which is displayed as "NaN%" to users.
**Suggested Fix** — Guard: `(gpu.fb_used_mb + gpu.fb_free_mb) > 0 ? ... : 0`.

---

### Finding 31
**File:Line** — `src/components/nodes/node-card.tsx:15`
**Category** — Bug (same root cause)
**Risk Level** — LOW
**Description** — Same `NaN%` issue as Finding 30 for `memPct` in `NodeCard`.
**Suggested Fix** — Same guard as above.

---

### Finding 32
**File:Line** — `src/lib/utils.ts:12–20`
**Category** — Bug
**Risk Level** — LOW
**Description** — `formatRelativeTime` uses `Date.now()` at call time. When this is called during server-side rendering (e.g., if a Server Component ever calls it, or in a test environment), `Date.now()` is the server's time, which may differ from the client's time. The result also goes stale — a component displaying "5s ago" will show the same string until it re-renders. There is no mechanism to trigger re-renders on a timer to keep relative timestamps fresh.
**Suggested Fix** — Add a 1-minute interval that triggers a re-render in any component displaying relative times, or use a `useRelativeTime` hook that updates periodically.

---

### Finding 33
**File:Line** — `src/app/layout.tsx:13`
**Category** — UX
**Risk Level** — LOW
**Description** — `<html lang="en" className="dark">` hardcodes `dark` mode. There is no way to switch to a light theme or respect `prefers-color-scheme`. For a portfolio project this is acceptable, but as a production concern the className forces dark mode even if a system accessibility setting is configured for high-contrast light mode.
**Suggested Fix** — Use `next-themes` to manage theme switching, or at minimum acknowledge this as an intentional constraint.

---

### Finding 34
**File:Line** — `src/components/charts/temp-chart.tsx:22`
**Category** — UX
**Risk Level** — LOW
**Description** — `TempChart` hard-codes the YAxis domain as `[20, 100]`. GPU temperatures above 100°C (possible under extreme conditions or a bug) would be clipped off the visible chart area with no indication. The `ReferenceLine` for "Crit" is at 85°C, but hardware critical thresholds for T4/L4 are actually 90°C+. Both values are magic numbers not linked to the threshold constants in the Rust sidecar.
**Suggested Fix** — Set domain to `["dataMin - 5", "dataMax + 5"]` or `[0, "auto"]`, and import threshold constants from a shared config.

---

### Finding 35
**File:Line** — `src/components/charts/diloco-charts.tsx:84`
**Category** — UX
**Risk Level** — LOW
**Description** — The `Worker Speed Ratio` chart has a hard-coded Y domain of `[0, 2]` and a straggler reference line at `0.8`. If any node's speed ratio exceeds 2.0 (possible in scenarios where one worker is much faster than others), the data is clipped off-chart. The straggler threshold of 0.8 is also a magic number not documented or linked to the backend's straggler detection logic.
**Suggested Fix** — Use `["auto", "auto"]` domain and extract the straggler threshold as a named constant.

---

### Finding 36
**File:Line** — `src/components/diagnoses/action-panel.tsx:43`
**Category** — UX / Code Quality
**Risk Level** — LOW
**Description** — The "Apply Fix" button has `title="Will be wired in SP-5"` and `disabled`. The title attribute is invisible on touch devices and not announced by screen readers. The text "coming in SP-5" is a development artifact that should be removed before any demo or production use.
**Suggested Fix** — Remove the button entirely (or hide it behind a feature flag) until it is functional, rather than showing a disabled placeholder with internal notes.

---

### Finding 37
**File:Line** — `src/hooks/use-nodes.ts:7–31` — no initial loading reset
**Category** — UX
**Risk Level** — LOW
**Description** — `useNodeMetrics` starts with `loading: true`. When the `refreshInterval` prop changes (e.g., a parent passes a different value), the effect tears down and re-runs, but `loading` is *not* reset to `true`. The user sees the stale data without any indication a new fetch is in progress.
**Suggested Fix** — Reset `setLoading(true)` at the start of `refresh()`.

---

## ENHANCEMENT (Feature Gap)

---

### Finding 38
**File:Line** — `src/` — no `error.tsx` files
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — None of the route segments (`/overview`, `/alerts`, `/diagnoses`, `/nodes`, `/nodes/[nodeId]`) have an `error.tsx` file. If any page component throws (e.g., a chart crashes due to malformed data — see Finding 10), Next.js App Router has no error boundary to catch it, and the entire page goes blank or shows an unhandled runtime error. The `WebSocketProvider` also has no error boundary around it; a subscriber error escaping the try/catch (edge case) would propagate to the React root.
**Suggested Fix** — Add `error.tsx` with a proper `ErrorBoundary` component at least at the root layout level, and optionally per route.

---

### Finding 39
**File:Line** — `src/` — no `loading.tsx` files
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — There are no `loading.tsx` route-level loading states for App Router. All loading logic is handled via `useState` inside each component, meaning the first meaningful content is blocked by the data fetch before any skeleton is shown. `loading.tsx` files allow React Suspense to stream skeletons immediately.
**Suggested Fix** — Add `loading.tsx` per route for immediate skeleton rendering via Suspense.

---

### Finding 40
**File:Line** — `src/components/charts/*` — no `Legend` component
**Category** — UX / Accessibility
**Risk Level** — ENHANCEMENT
**Description** — None of the Recharts chart components include a `<Legend />` component. The `UtilizationChart` renders three overlapping areas (`utilization`, `smActive`, `tensorActive`) with no legend, making it impossible to distinguish the lines without hovering over each point. On small screens tooltips are hard to reach. Color alone (without shape or text label) is not sufficient for color-blind users (WCAG 1.4.1).
**Suggested Fix** — Add `<Legend />` to all multi-series charts. Use distinct line dash patterns or point shapes in addition to color.

---

### Finding 41
**File:Line** — `src/` — no responsive mobile layout
**Category** — UX
**Risk Level** — ENHANCEMENT
**Description** — The sidebar is `fixed` at `w-56`/`w-16` with no mobile breakpoint — on screens narrower than ~600px the sidebar overlaps the main content. The main content area has `ml-56`/`ml-16` margin, but on small screens this leaves very little or negative space. Chart containers have fixed heights (`h-64`, `h-72`) that do not adapt to small screens.
**Suggested Fix** — Add a mobile hamburger menu pattern (drawer/sheet), swap `ml-56` to a responsive class at the `md` breakpoint, and consider `aspect-ratio` instead of fixed heights for charts.

---

### Finding 42
**File:Line** — `src/lib/websocket.tsx` — `alertCount` never resets
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — `alertCount` in the WebSocket state is a session-lifetime counter used for the sidebar badge. It never decrements or resets. There is no way to "acknowledge" alerts from the sidebar badge. The badge will accumulate into the thousands over a long session, losing meaning.
**Suggested Fix** — Either make the badge show only unacknowledged/unseen alerts (with a reset callback), or base it on the current list count from `useAlerts`, not a persistent counter.

---

### Finding 43
**File:Line** — `src/components/nodes/gpu-charts.tsx:21–69` — no window-size selector
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — The node detail page hard-codes `windowMinutes=5` with no UI to change it. For a training run lasting hours, a 5-minute window may miss important trends. There is a `windowMinutes` parameter in `useNodeMetrics` and `fetchNodeMetrics` but no control is exposed to users.
**Suggested Fix** — Add a time-range selector (Last 5m / 15m / 1h / custom) to the node detail page, passing the value down to `useNodeMetrics`.

---

## Summary Table

| # | File | Category | Risk |
|---|------|----------|------|
| 1 | `lib/websocket.tsx:6` | Bug | BREAKING |
| 2 | `lib/websocket.tsx:69` | Bug | BREAKING |
| 3 | `lib/websocket.tsx:79` | Bug | BREAKING |
| 4 | `lib/websocket.tsx:128` | Bug/Performance | BREAKING |
| 5 | `hooks/use-realtime.ts:28` | Bug/Performance | HIGH |
| 6 | `hooks/use-alerts.ts:22` | Bug | HIGH |
| 7 | `hooks/use-nodes.ts:25` | Bug/Performance | HIGH |
| 8 | `app/alerts/page.tsx:23` | Bug | HIGH |
| 9 | `components/alerts/alert-detail.tsx:26` | Bug | HIGH |
| 10 | `components/charts/loss-chart.tsx:24` | Bug | HIGH |
| 11 | `next.config.ts:6` | Architecture/Security | HIGH |
| 12 | `components/layout/app-shell.tsx:33` | Bug | MEDIUM |
| 13 | `components/layout/app-shell.tsx:48` | UX/Bug | MEDIUM |
| 14 | `lib/websocket.tsx` (no heartbeat) | Feature Gap | MEDIUM |
| 15 | `app/overview/page.tsx:37` | Performance | MEDIUM |
| 16 | `components/nodes/gpu-charts.tsx:100` | Performance | MEDIUM |
| 17 | `app/diagnoses/page.tsx:30` | Performance/UX | MEDIUM |
| 18 | `app/alerts/page.tsx:68` | UX | MEDIUM |
| 19 | `components/alerts/alert-detail.tsx:65` | UX/a11y | MEDIUM |
| 20 | `components/nodes/gpu-charts.tsx:79` | Architecture | MEDIUM |
| 21 | `components/ui/tabs.tsx:10` | Architecture/a11y | MEDIUM |
| 22 | `components/ui/separator.tsx:6` | Accessibility | MEDIUM |
| 23 | `components/layout/sidebar.tsx:78` | Accessibility/UX | MEDIUM |
| 24 | `app/nodes/[nodeId]/page.tsx:11` | UX/Security | MEDIUM |
| 25 | `lib/api.ts:17` | Bug | MEDIUM |
| 26 | `lib/api.ts:50,82` | Code Quality | MEDIUM |
| 27 | `components/overview/recent-alerts.tsx:30` | UX | LOW |
| 28 | `components/diagnoses/evidence-chain.tsx:19` | Code Quality | LOW |
| 29 | `app/overview/page.tsx:21` | UX | LOW |
| 30 | `components/overview/cluster-summary.tsx:47` | Bug | LOW |
| 31 | `components/nodes/node-card.tsx:15` | Bug | LOW |
| 32 | `lib/utils.ts:12` | Bug | LOW |
| 33 | `app/layout.tsx:13` | UX | LOW |
| 34 | `components/charts/temp-chart.tsx:22` | UX | LOW |
| 35 | `components/charts/diloco-charts.tsx:84` | UX | LOW |
| 36 | `components/diagnoses/action-panel.tsx:43` | UX | LOW |
| 37 | `hooks/use-nodes.ts:33` | UX | LOW |
| 38 | `src/` (no error.tsx) | Feature Gap | ENHANCEMENT |
| 39 | `src/` (no loading.tsx) | Feature Gap | ENHANCEMENT |
| 40 | `components/charts/*` (no Legend) | UX/a11y | ENHANCEMENT |
| 41 | `src/` (no mobile layout) | UX | ENHANCEMENT |
| 42 | `lib/websocket.tsx` (alertCount) | Feature Gap | ENHANCEMENT |
| 43 | `components/nodes/gpu-charts.tsx` (no window selector) | Feature Gap | ENHANCEMENT |

---

## Prioritized Action Plan

**Fix immediately (BREAKING — these cause runtime failures in any non-localhost environment):**
1. Move WS_URL construction inside `connect()` (Finding 1)
2. Fix double-reconnect from `onerror` calling `ws.close()` (Finding 3)
3. Fix backoff timing — apply multiplier before scheduling (Finding 2)
4. Add unmounted guards to all WebSocket event handlers (Finding 4)

**Fix before demo (HIGH — visible data correctness issues):**
5. Add `AbortController` / `cancelled` guard in `alert-detail.tsx` useEffect (Finding 9)
6. Fix WebSocket prepend ignoring severity filter (Finding 8)
7. Fix log-scale crash with zero/negative loss values (Finding 10)
8. Fix `use-realtime.ts` handler reference instability (Finding 5)
9. Add `BACKEND_URL` env var to `next.config.ts` (Finding 11)

---

