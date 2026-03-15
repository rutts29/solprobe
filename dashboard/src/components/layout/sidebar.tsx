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
} from "lucide-react";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/nodes", label: "Nodes", icon: Server },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle },
  { href: "/diagnoses", label: "Diagnoses", icon: Brain },
];

interface SidebarProps {
  connectedNodes: number;
  alertCount: number;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ connectedNodes, alertCount, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <Activity className="h-6 w-6 shrink-0 text-primary" />
        {!collapsed && <span className="text-lg font-bold tracking-tight">SolProbe</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && item.href === "/alerts" && alertCount > 0 && (
                <Badge variant="destructive" className="ml-auto text-xs">
                  {alertCount}
                </Badge>
              )}
              {!collapsed && item.href === "/nodes" && connectedNodes > 0 && (
                <Badge variant="success" className="ml-auto text-xs">
                  {connectedNodes}
                </Badge>
              )}
            </Link>
          );
        })}
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
