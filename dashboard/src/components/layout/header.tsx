"use client";

import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/ui/theme-provider";
import { Wifi, WifiOff, Search, Sun, Moon } from "lucide-react";
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
};

export function Header({ wsConnected, criticalAlerts }: HeaderProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  // Build crumbs from /a/b/c — first crumb is "SolProbe"
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: PATH_LABELS[seg] ?? seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
  }));

  const healthVariant = criticalAlerts > 0 ? "destructive" : "success";
  const healthLabel = criticalAlerts > 0 ? `${criticalAlerts} Critical` : "Healthy";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-card/80 px-6 backdrop-blur-sm">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">SolProbe</span>
        {crumbs.map((c) => (
          <span key={c.href} className="flex items-center gap-2">
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{c.label}</span>
          </span>
        ))}
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* ⌘K search */}
        <button className="flex h-8 items-center gap-2 rounded-md border bg-background px-3 text-xs text-muted-foreground hover:text-foreground">
          <Search className="h-3.5 w-3.5" />
          <span>Search nodes, alerts…</span>
          <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>

        {/* Cluster status */}
        <Badge variant={healthVariant}>{healthLabel}</Badge>

        {/* WS pill */}
        <div className="flex items-center gap-1.5 text-xs">
          {wsConnected ? (
            <>
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <Wifi className="h-3.5 w-3.5 text-emerald-400" />
              <span className="font-medium text-emerald-400">Live</span>
            </>
          ) : (
            <>
              <WifiOff className="h-3.5 w-3.5 text-red-400" />
              <span className="font-medium text-red-400">Disconnected</span>
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
      </div>
    </header>
  );
}
