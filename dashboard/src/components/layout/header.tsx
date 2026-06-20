"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/ui/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { fetchAlerts, fetchNodes } from "@/lib/api";
import type { AlertModel, NodeStatus } from "@/lib/types";
import { Wifi, WifiOff, Search, Sun, Moon, LogOut, Server, AlertTriangle, FileText, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  wsConnected: boolean;
  criticalAlerts: number;
}

const PATH_LABELS: Record<string, string> = {
  overview: "Overview",
  nodes: "Nodes",
  alerts: "Alerts",
  diagnoses: "Diagnoses",
  training: "Training",
  attestations: "Attestations",
  policies: "Policies",
  status: "Status",
};

const PUBLIC_STATUS_PAGE_URL = process.env.NEXT_PUBLIC_STATUS_PAGE_URL?.trim();

const STATIC_SEARCH_ITEMS = [
  { id: "page-overview", label: "Overview", description: "Cluster health and KPI summary", href: "/overview", kind: "Page" },
  {
    id: "page-status",
    label: "Public Status",
    description: "External incident.io status page",
    href: PUBLIC_STATUS_PAGE_URL || "/status",
    kind: PUBLIC_STATUS_PAGE_URL ? "External" : "Page",
  },
  { id: "page-nodes", label: "Nodes", description: "GPU node inventory and metrics", href: "/nodes", kind: "Page" },
  { id: "page-alerts", label: "Alerts", description: "Alert timeline and incident response", href: "/alerts", kind: "Page" },
  { id: "page-diagnoses", label: "Diagnoses", description: "Root-cause analyses and actions", href: "/diagnoses", kind: "Page" },
  { id: "page-training", label: "Training", description: "Training run telemetry", href: "/training", kind: "Page" },
  { id: "page-policies", label: "Policies", description: "Monitoring policy configuration", href: "/policies", kind: "Page" },
  { id: "page-attestations", label: "Attestations", description: "On-chain trust layer samples", href: "/attestations", kind: "Page" },
];

export function Header({ wsConnected, criticalAlerts }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [alerts, setAlerts] = useState<AlertModel[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Build crumbs from /a/b/c — first crumb is "SolProbe"
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: PATH_LABELS[seg] ?? seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
  }));

  const healthVariant = criticalAlerts > 0 ? "destructive" : "success";
  const healthLabel = criticalAlerts > 0 ? `${criticalAlerts} Critical` : "Healthy";

  function openSearch() {
    setSearchLoading(true);
    setSearchOpen(true);
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
      if (event.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    let cancelled = false;
    Promise.all([fetchNodes(), fetchAlerts({ limit: 25 })])
      .then(([nextNodes, nextAlerts]) => {
        if (cancelled) return;
        setNodes(nextNodes);
        setAlerts(nextAlerts);
      })
      .catch((err) => console.error("[CommandPalette] search data failed:", err))
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [searchOpen]);

  const searchItems = useMemo(() => {
    const dynamicItems = [
      ...nodes.map((node) => ({
        id: `node-${node.node_id}`,
        label: node.node_id,
        description: `${node.gpu_model || "GPU node"} · ${node.gpu_count} GPU${node.gpu_count === 1 ? "" : "s"}`,
        href: `/nodes/${node.node_id}`,
        kind: "Node",
      })),
      ...alerts.map((alert) => ({
        id: `alert-${alert.alert_id}`,
        label: alert.alert_type,
        description: `${alert.severity} · ${alert.node_id} · ${alert.description}`,
        href: "/alerts",
        kind: "Alert",
      })),
    ];
    const q = query.trim().toLowerCase();
    const all = [...STATIC_SEARCH_ITEMS, ...dynamicItems];
    if (!q) return all.slice(0, 12);
    return all
      .filter((item) => `${item.label} ${item.description} ${item.kind}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [alerts, nodes, query]);

  function goToSearchItem(href: string) {
    setSearchOpen(false);
    setQuery("");
    if (/^https?:\/\//.test(href)) {
      window.open(href, "_blank", "noreferrer");
      return;
    }
    router.push(href);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-card/80 px-4 backdrop-blur-sm md:px-6">
      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Link href="/" className="text-muted-foreground transition-colors hover:text-foreground">
          SolProbe
        </Link>
        {crumbs.map((c) => (
          <span key={c.href} className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-medium">{c.label}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-1 items-center justify-end gap-2 md:gap-3">
        {/* ⌘K search */}
        <button
          type="button"
          onClick={openSearch}
          className="hidden h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground hover:text-foreground lg:flex"
        >
          <Search className="h-3.5 w-3.5" />
          <span>Search nodes, alerts…</span>
          <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>

        {/* Cluster status */}
        {PUBLIC_STATUS_PAGE_URL ? (
          <a href={PUBLIC_STATUS_PAGE_URL} target="_blank" rel="noreferrer" title="Open public status page">
            <Badge variant={healthVariant} className="gap-1">
              {healthLabel}
              <ExternalLink className="h-3 w-3" />
            </Badge>
          </a>
        ) : (
          <Link href="/status">
            <Badge variant={healthVariant}>{healthLabel}</Badge>
          </Link>
        )}

        {/* WS pill */}
        <div className="flex items-center gap-1.5 text-xs">
          {wsConnected ? (
            <>
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />
              <Wifi className="h-3.5 w-3.5 text-[var(--ok)]" />
              <span className="font-medium text-[var(--ok)]">Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-[var(--crit)]" />
              <span className="font-medium text-[var(--crit)]">Disconnected</span>
            </>
          )}
        </div>

        {/* Theme toggle (segmented) */}
        <div className="flex h-8 items-center rounded-md border bg-background p-0.5">
          <button
            onClick={() => setTheme("light")}
            aria-label="Light theme"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              theme === "light" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sun className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setTheme("dark")}
            aria-label="Dark theme"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded transition-colors",
              theme === "dark" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Moon className="h-3.5 w-3.5" />
          </button>
        </div>

        <SignOutButton />
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setSearchOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command search"
            className="mx-auto mt-20 w-full max-w-xl overflow-hidden rounded-lg border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, nodes, alerts..."
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {searchLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading cluster results...</div>}
              {searchItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToSearchItem(item.href)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
                >
                  <SearchItemIcon kind={item.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{item.kind}</span>
                </button>
              ))}
              {!searchLoading && searchItems.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">No matching results</div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function SearchItemIcon({ kind }: { kind: string }) {
  if (kind === "Node") return <Server className="h-4 w-4 shrink-0 text-[var(--ok)]" />;
  if (kind === "Alert") return <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warn)]" />;
  if (kind === "External") return <ExternalLink className="h-4 w-4 shrink-0 text-primary" />;
  return <FileText className="h-4 w-4 shrink-0 text-primary" />;
}

function SignOutButton() {
  const { signOut } = useAuth();
  const router = useRouter();
  return (
    <button
      onClick={() => {
        signOut();
        router.replace("/");
      }}
      aria-label="Sign out"
      title="Sign out"
      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
