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
  Activity,
  GitBranch,
  Coins,
  ChevronsUpDown,
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
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Activity className="h-5 w-5 shrink-0 text-primary" />
        {!collapsed && <span className="text-base font-bold tracking-tight">SolProbe</span>}
      </div>

      {/* Cluster picker */}
      {!collapsed && (
        <button className="mx-2 mt-3 flex items-center justify-between rounded-md border bg-background/50 px-3 py-2 text-left text-xs hover:bg-accent">
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
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && item.badgeKey && badgeValue > 0 && (
                      <Badge
                        variant={item.badgeKey === "alerts" ? "destructive" : "success"}
                        className="ml-auto text-[10px]"
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
