"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useWebSocket } from "@/lib/websocket";
import { fetchHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ws = useWebSocket();
  const [collapsed, setCollapsed] = useState(false);
  const [connectedNodes, setConnectedNodes] = useState(0);
  const [criticalAlerts, setCriticalAlerts] = useState(0);

  useEffect(() => {
    fetchHealth()
      .then((h) => {
        setConnectedNodes(h.connected_sidecars);
      })
      .catch((err) => {
        console.error("[AppShell] failed to fetch health:", err);
      });
  }, []);

  // Update connected nodes from WS metric summaries
  useEffect(() => {
    const count = Object.keys(ws.nodeStatuses).length;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing WS external state
    if (count > 0) setConnectedNodes(count);
  }, [ws.nodeStatuses]);

  // Accumulate count from WebSocket event stream — not derived state
  useEffect(() => {
    if (ws.lastAlert?.severity === "CRITICAL") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- event accumulator, not derivable
      setCriticalAlerts((c) => c + 1);
    }
  }, [ws.lastAlert]);

  // Keyboard shortcuts
  useEffect(() => {
    let pendingKey: string | null = null;
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (pendingKey === "g") {
        pendingKey = null;
        switch (e.key) {
          case "o": router.push("/overview"); break;
          case "a": router.push("/alerts"); break;
          case "d": router.push("/diagnoses"); break;
          case "n": router.push("/nodes"); break;
        }
      } else {
        pendingKey = e.key === "g" ? "g" : null;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        connectedNodes={connectedNodes}
        alertCount={ws.alertCount}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      <div className={cn("transition-all duration-200", collapsed ? "ml-16" : "ml-56")}>
        <Header wsConnected={ws.connected} criticalAlerts={criticalAlerts} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
