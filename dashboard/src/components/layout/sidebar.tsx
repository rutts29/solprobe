"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Server,
  AlertTriangle,
  Brain,
  GitBranch,
  Coins,
  ChevronsUpDown,
  ShieldCheck,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badgeKey?: "alerts" | "nodes";
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitoring",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      { href: "/nodes", label: "Nodes", icon: Server, badgeKey: "nodes" },
      { href: "/alerts", label: "Alerts", icon: AlertTriangle, badgeKey: "alerts" },
      { href: "/diagnoses", label: "Diagnoses", icon: Brain },
      { href: "/training", label: "Training", icon: GitBranch },
      { href: "/policies", label: "Policies", icon: ShieldCheck },
    ],
  },
  {
    label: "On-chain",
    items: [
      { href: "/attestations", label: "Attestations", icon: Coins },
    ],
  },
];

interface SidebarProps {
  connectedNodes: number;
  alertCount: number;
  collapsed: boolean;
  onToggle: () => void;
  clusterName?: string;
}

export function Sidebar({ connectedNodes, alertCount, collapsed, onToggle, clusterName = "mainnet-prod" }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-16 md:w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b px-3">
        <a
          href="/landing.html"
          aria-label="Open SolProbe landing page"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-ring",
            collapsed ? "justify-center" : "px-1"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/solprobe-mark.svg" alt="" className="h-8 w-8 shrink-0" />
          {!collapsed && (
            <span className="hidden whitespace-nowrap text-base font-bold tracking-tight md:inline">
              <span className="text-foreground">Sol</span><span className="font-medium text-muted-foreground">Probe</span>
            </span>
          )}
        </a>
      </div>

      {/* Cluster picker */}
      {!collapsed && (
        <button className="mx-2 mt-3 hidden items-center justify-between rounded-md border bg-background/50 px-3 py-2 text-left text-xs hover:bg-accent md:flex">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cluster</div>
            <div className="font-mono text-foreground">{clusterName}</div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {/* Navigation */}
      <nav className="flex-1 space-y-4 p-2">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="mb-1 hidden px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                const badgeValue =
                  item.badgeKey === "alerts" ? alertCount :
                  item.badgeKey === "nodes" ? connectedNodes : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="hidden md:inline">{item.label}</span>}
                    {!collapsed && item.badgeKey && badgeValue > 0 && (
                      <Badge
                        variant={item.badgeKey === "alerts" ? "destructive" : "success"}
                        className="ml-auto hidden text-[10px] md:inline-flex"
                      >
                        {badgeValue}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex h-10 items-center justify-center border-t text-muted-foreground hover:text-foreground"
      >
        {collapsed ? "→" : "←"}
      </button>
    </aside>
  );
}
