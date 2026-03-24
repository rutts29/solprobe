"use client";

import { useState, useCallback } from "react";
import { AlertTimeline } from "@/components/alerts/alert-timeline";
import { AlertDetail } from "@/components/alerts/alert-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlerts } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import type { AlertModel } from "@/lib/types";

const SEVERITIES = ["ALL", "CRITICAL", "WARNING", "INFO"] as const;

export default function AlertsPage() {
  const [severity, setSeverity] = useState<string>("ALL");
  const [selectedAlert, setSelectedAlert] = useState<AlertModel | null>(null);
  const { alerts, loading, error, refresh, prepend } = useAlerts({
    severity: severity === "ALL" ? undefined : severity,
    limit: 50,
  });
  const ws = useWebSocket();

  const onAlert = useCallback(
    (msg: { type: "alert"; data: AlertModel }) => {
      if (severity === "ALL" || msg.data.severity === severity) {
        prepend(msg.data);
      }
    },
    [prepend, severity]
  );

  useRealtime(ws.subscribe, { onAlert });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Alerts</h1>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={refresh} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => setSeverity(s)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              severity === s
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <AlertTimeline alerts={alerts} onSelectAlert={setSelectedAlert} />
      )}

      {selectedAlert && (
        <AlertDetail alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}
