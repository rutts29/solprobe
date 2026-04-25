// REPLACE: dashboard/src/app/overview/page.tsx
// Uses the new <KpiStrip> instead of <HealthCards>. Same hooks, same data flow.

"use client";

import { useEffect, useState, useCallback } from "react";
import { KpiStrip } from "@/components/overview/kpi-strip";
import { ClusterSummary } from "@/components/overview/cluster-summary";
import { RecentAlerts } from "@/components/overview/recent-alerts";
import { useNodes } from "@/hooks/use-nodes";
import { useAlerts } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import { fetchHealth } from "@/lib/api";
import { avgGpuUtilization, totalThroughputTps, totalPowerKw } from "@/lib/derive";
import type { HealthStatus, AlertModel } from "@/lib/types";

export default function OverviewPage() {
  const { nodes, loading: nodesLoading } = useNodes();
  const { alerts, loading: alertsLoading, prepend } = useAlerts({ limit: 50 });
  const ws = useWebSocket();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Rolling history for KPI sparklines (~20 samples).
  const [history, setHistory] = useState<{ util: number[]; throughput: number[]; power: number[] }>({
    util: [], throughput: [], power: [],
  });

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err) => setHealthError(err instanceof Error ? err.message : "Failed to fetch health"));
  }, []);

  // Append a sample whenever nodes update (i.e. every poll cycle from useNodes).
  useEffect(() => {
    if (nodes.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rolling sparkline accumulator from poll events
    setHistory((h) => ({
      util: [...h.util, avgGpuUtilization(nodes)].slice(-20),
      throughput: [...h.throughput, totalThroughputTps(nodes)].slice(-20),
      power: [...h.power, totalPowerKw(nodes)].slice(-20),
    }));
  }, [nodes]);

  const onAlert = useCallback(
    (msg: { type: "alert"; data: AlertModel }) => prepend(msg.data),
    [prepend]
  );
  useRealtime(ws.subscribe, { onAlert });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Cluster Overview</h1>
      </div>

      {healthError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          Backend unreachable: {healthError}
        </div>
      )}

      <KpiStrip nodes={nodes} alerts={alerts} health={health} history={history} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ClusterSummary nodes={nodes} loading={nodesLoading} />
        <RecentAlerts alerts={alerts} loading={alertsLoading} />
      </div>
    </div>
  );
}
