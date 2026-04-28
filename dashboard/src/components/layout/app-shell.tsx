"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useWebSocket } from "@/lib/websocket";
import { useAuth } from "@/hooks/use-auth";
import { fetchHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const ws = useWebSocket();
  const { loaded, isAuthenticated } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [connectedNodes, setConnectedNodes] = useState(0);
  const [criticalAlerts, setCriticalAlerts] = useState(0);

  const isLanding = pathname === "/";

  // Gate: redirect unauthenticated users away from dashboard routes.
  useEffect(() => {
    if (loaded && !isAuthenticated && !isLanding) {
      router.replace("/");
    }
  }, [loaded, isAuthenticated, isLanding, router]);

  useEffect(() => {
    fetchHealth()
      .then((h) => setConnectedNodes(h.connected_sidecars))
      .catch((err) => console.error("[AppShell] failed to fetch health:", err));
  }, []);

  useEffect(() => {
    const count = Object.keys(ws.nodeStatuses).length;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing WS external state
    if (count > 0) setConnectedNodes(count);
  }, [ws.nodeStatuses]);

  useEffect(() => {
    if (ws.lastAlert?.severity === "CRITICAL") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- event accumulator, not derivable
      setCriticalAlerts((c) => c + 1);
    }
  }, [ws.lastAlert]);

  // Keyboard shortcuts: g→o/n/a/d/t/c
  useEffect(() => {
    let pendingKey: string | null = null;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (pendingKey === "g") {
        pendingKey = null;
        switch (e.key) {
          case "o": router.push("/overview"); break;
          case "n": router.push("/nodes"); break;
          case "a": router.push("/alerts"); break;
          case "d": router.push("/diagnoses"); break;
          case "t": router.push("/training"); break;
          case "p": router.push("/policies"); break;
          case "c": router.push("/attestations"); break;
        }
      } else {
        pendingKey = e.key === "g" ? "g" : null;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  // Landing page renders standalone (no sidebar/header chrome).
  if (isLanding) return <>{children}</>;

  // Brief blank while auth is being resolved on first load.
  if (!loaded || !isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        connectedNodes={connectedNodes}
        alertCount={ws.alertCount}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      <div className={cn("transition-all duration-200", collapsed ? "ml-16" : "ml-60")}>
        <Header wsConnected={ws.connected} criticalAlerts={criticalAlerts} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
