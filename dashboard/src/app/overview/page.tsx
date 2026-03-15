"use client";

import { useEffect, useState, useCallback } from "react";
import { HealthCards } from "@/components/overview/health-cards";
import { ClusterSummary } from "@/components/overview/cluster-summary";
import { RecentAlerts } from "@/components/overview/recent-alerts";
import { useNodes } from "@/hooks/use-nodes";
import { useAlerts } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import { fetchHealth } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";

export default function OverviewPage() {
  const { nodes, loading: nodesLoading } = useNodes();
  const { alerts, loading: alertsLoading, prepend } = useAlerts({ limit: 10 });
  const ws = useWebSocket();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => {});
  }, []);

  const onAlert = useCallback(
    (msg: { type: "alert"; data: typeof alerts[0] }) => prepend(msg.data),
    [prepend]
  );

  useRealtime(ws.subscribe, { onAlert });

  const avgGpuUtil =
    nodes.length > 0
      ? nodes.reduce((sum, n) => sum + (n.gpu_metrics?.gpu_utilization_pct ?? 0), 0) / nodes.length
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cluster Overview</h1>
      <HealthCards
        connectedNodes={health?.connected_sidecars ?? nodes.length}
        activeAlerts={health?.total_alerts ?? alerts.length}
        diagnosesToday={health?.total_diagnoses ?? 0}
        avgGpuUtil={avgGpuUtil}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ClusterSummary nodes={nodes} loading={nodesLoading} />
        <RecentAlerts alerts={alerts} loading={alertsLoading} />
      </div>
    </div>
  );
}
