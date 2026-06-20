import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const globals = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
const darkTheme = globals.match(/:root,\s*\n\[data-theme="dark"\]\s*{[\s\S]*?\n}/)?.[0] ?? "";
const shellAndOverviewFiles = await Promise.all([
  "../src/components/layout/sidebar.tsx",
  "../src/components/layout/header.tsx",
  "../src/components/overview/kpi-strip.tsx",
  "../src/components/overview/cluster-summary.tsx",
  "../src/components/ui/badge.tsx",
  "../src/components/ui/page-header.tsx",
  "../src/components/ui/error-banner.tsx",
  "../src/app/nodes/page.tsx",
  "../src/app/policies/page.tsx",
  "../src/app/attestations/page.tsx",
  "../src/components/alerts/alert-detail.tsx",
  "../src/components/charts/utilization-chart.tsx",
  "../src/components/charts/throughput-chart.tsx",
  "../src/components/nodes/diloco-charts.tsx",
].map(async (path) => [path, await readFile(new URL(path, import.meta.url), "utf8")]));

test("dark theme uses neutral GLM mockup surfaces instead of navy-tinted surfaces", () => {
  assert.notEqual(darkTheme, "");
  assert.match(darkTheme, /--background:\s*#050505;/);
  assert.match(darkTheme, /--card:\s*#050505;/);
  assert.match(darkTheme, /--surface-2:\s*#101010;/);
  assert.match(darkTheme, /--secondary:\s*#101010;/);
  assert.match(darkTheme, /--muted:\s*#101010;/);
  assert.match(darkTheme, /--accent:\s*#101010;/);
  assert.match(darkTheme, /--border:\s*#242424;/);
  assert.match(darkTheme, /--input:\s*#242424;/);
  assert.doesNotMatch(darkTheme, /#07070a|#0a0a0f|#101017|#1e1e2e|#1a1a2e|#1f1f25/);
});

test("dashboard typography matches the landing page and GLM mockups", () => {
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(globals, /--font-sans:\s*var\(--font-ui,\s*'Inter'\)/);
  assert.match(globals, /--font-mono:\s*var\(--font-code,\s*'JetBrains Mono'\)/);
  assert.match(globals, /font-family:\s*var\(--font-ui,\s*'Inter'\)/);
  assert.match(globals, /font-feature-settings:\s*'cv11',\s*'ss01'/);
  assert.match(globals, /letter-spacing:\s*-0\.005em/);
});

test("shell and overview colors use GLM semantic tokens instead of Tailwind color families", () => {
  for (const [path, source] of shellAndOverviewFiles) {
    assert.doesNotMatch(
      source,
      /\b(?:bg|text|border)-(?:emerald|amber|blue|red|orange|green|zinc)-\d{3}\b|#8b5cf6|#06b6d4/,
      `${path} contains a hard-coded Tailwind status color`,
    );
  }
  assert.match(globals, /--ok-soft:\s*rgba\(16,\s*185,\s*129,\s*\.16\);/);
  assert.match(globals, /--warn-soft:\s*rgba\(245,\s*158,\s*11,\s*\.16\);/);
  assert.match(globals, /--crit-soft:\s*rgba\(239,\s*68,\s*68,\s*\.16\);/);
  assert.match(globals, /--info-soft:\s*rgba\(59,\s*130,\s*246,\s*\.16\);/);
  assert.match(globals, /--brand-soft:\s*rgba\(255,\s*107,\s*53,\s*\.12\);/);
});

test("form controls are centralized for policy and alert forms", async () => {
  const [policies, lifecycle, select, input, textarea] = await Promise.all([
    readFile(new URL("../src/app/policies/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/alerts/lifecycle-actions.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/input.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/textarea.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(policies, /from "@\/components\/ui\/input"/);
  assert.match(policies, /from "@\/components\/ui\/textarea"/);
  assert.match(lifecycle, /from "@\/components\/ui\/input"/);
  assert.doesNotMatch(policies, /<input\b/);
  assert.doesNotMatch(policies, /<textarea\b/);
  for (const source of [select, input, textarea]) {
    assert.match(source, /border-input/);
    assert.match(source, /bg-background/);
    assert.match(source, /focus-visible:ring-ring/);
  }
});

test("client error boundaries do not render raw exception messages", async () => {
  const [routeError, globalError, fallback, api] = await Promise.all([
    readFile(new URL("../src/app/error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/global-error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/error-fallback.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(routeError, /error\.message/);
  assert.doesNotMatch(globalError, /error\.message/);
  assert.doesNotMatch(fallback, /Something went wrong|console/i);
  assert.match(api, /apiErrorMessage/);
  assert.doesNotMatch(api, /throw new Error\(`API error/);
});
