"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err) => {
        setHealthError(err instanceof Error ? err.message : "Failed to fetch health");
      });
  }, []);

  const onAlert = useCallback(
    (msg: { type: "alert"; data: typeof alerts[0] }) => prepend(msg.data),
    [prepend]
  );

  useRealtime(ws.subscribe, { onAlert });

  // Compute avg GPU util from latest_metrics (array per node)
  const avgGpuUtil = useMemo(() => {
    const gpuUtils: number[] = [];
    for (const n of nodes) {
      for (const m of n.latest_metrics) {
        gpuUtils.push(m.gpu_utilization_pct);
      }
    }
    return gpuUtils.length > 0 ? gpuUtils.reduce((a, b) => a + b, 0) / gpuUtils.length : 0;
  }, [nodes]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Cluster Overview</h1>

      {healthError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          Backend unreachable: {healthError}
        </div>
      )}

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
