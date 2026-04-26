// REPLACE: dashboard/src/app/alerts/page.tsx — adds <SeveritySummary>.
// Filters, AlertTimeline, AlertDetail unchanged.

"use client";

import { useState, useCallback, useMemo } from "react";
import { AlertTimeline } from "@/components/alerts/alert-timeline";
import { AlertDetail } from "@/components/alerts/alert-detail";
import { SeveritySummary } from "@/components/alerts/severity-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlerts } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import type { AlertModel, DiagnosisResult } from "@/lib/types";

const SEVERITIES = ["ALL", "CRITICAL", "WARNING", "INFO"] as const;

export default function AlertsPage() {
  const [severity, setSeverity] = useState<string>("ALL");
  const [selectedAlert, setSelectedAlert] = useState<AlertModel | null>(null);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<DiagnosisResult | null>(null);
  const { alerts, loading, error, refresh, prepend } = useAlerts({ limit: 100 });
  const ws = useWebSocket();

  const onAlert = useCallback(
    (msg: { type: "alert"; data: AlertModel }) => {
      prepend(msg.data);
    },
    [prepend]
  );
  const onDiagnosis = useCallback(
    (msg: { type: "diagnosis"; data: DiagnosisResult }) => {
      if (selectedAlert?.alert_id === msg.data.alert_id) {
        setSelectedDiagnosis(msg.data);
      }
    },
    [selectedAlert?.alert_id]
  );
  useRealtime(ws.subscribe, { onAlert, onDiagnosis });

  const filteredAlerts = useMemo(
    () => (severity === "ALL" ? alerts : alerts.filter((a) => a.severity === severity)),
    [alerts, severity]
  );

  const selectAlert = useCallback((alert: AlertModel) => {
    setSelectedAlert(alert);
    setSelectedDiagnosis(null);
  }, []);

  const selectSeverity = useCallback((nextSeverity: string) => {
    setSeverity(nextSeverity);
    setSelectedAlert(null);
    setSelectedDiagnosis(null);
  }, []);

  const handleDiagnosisCreated = useCallback((alert: AlertModel, diagnosis: DiagnosisResult) => {
    setSelectedAlert(alert);
    setSelectedDiagnosis(diagnosis);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={refresh} className="ml-2 underline">Retry</button>
        </div>
      )}

      <SeveritySummary alerts={alerts} />

      <div className="flex gap-2">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            onClick={() => selectSeverity(s)}
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
        <AlertTimeline
          alerts={filteredAlerts}
          onSelectAlert={selectAlert}
          onDiagnosisCreated={handleDiagnosisCreated}
        />
      )}

      {selectedAlert && (
        <AlertDetail
          alert={selectedAlert}
          initialDiagnosis={selectedDiagnosis}
          onClose={() => {
            setSelectedAlert(null);
            setSelectedDiagnosis(null);
          }}
        />
      )}
    </div>
  );
}
