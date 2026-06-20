"use client";

import { useState, useCallback, useMemo } from "react";
import { AlertTimeline } from "@/components/alerts/alert-timeline";
import { AlertDetail } from "@/components/alerts/alert-detail";
import { SeveritySummary } from "@/components/alerts/severity-summary";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Toolbar } from "@/components/ui/toolbar";
import { useAlerts, useDiagnoses } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import type { AlertLifecycle, AlertModel, DiagnosisResult } from "@/lib/types";

const CLOSED_LIFECYCLE_STATES = new Set(["resolved", "ignored"]);

function isOpen(alert: AlertModel): boolean {
  return !CLOSED_LIFECYCLE_STATES.has(alert.lifecycle?.state ?? "");
}

export default function AlertsPage() {
  const [severity, setSeverity] = useState<string>("ALL");
  const [openOnly, setOpenOnly] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertModel | null>(null);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<DiagnosisResult | null>(null);
  const { alerts, loading, error, refresh, prepend, updateLifecycle } = useAlerts({ limit: 100 });
  const { diagnoses, append: appendDiagnosis } = useDiagnoses({ limit: 100 });
  const ws = useWebSocket();

  const onAlert = useCallback(
    (msg: { type: "alert"; data: AlertModel }) => {
      prepend(msg.data);
    },
    [prepend]
  );
  const onDiagnosis = useCallback(
    (msg: { type: "diagnosis"; data: DiagnosisResult }) => {
      appendDiagnosis(msg.data);
      if (selectedAlert?.alert_id === msg.data.alert_id) {
        setSelectedDiagnosis(msg.data);
      }
    },
    [appendDiagnosis, selectedAlert?.alert_id]
  );
  useRealtime(ws.subscribe, { onAlert, onDiagnosis });

  // Timeline filter: severity + open-only.
  // KPI summary (SeveritySummary) keeps using unfiltered `alerts` — do not
  // apply these filters there or the 24h totals regress.
  const filteredAlerts = useMemo(() => {
    let next = alerts;
    if (severity !== "ALL") next = next.filter((a) => a.severity === severity);
    if (openOnly) next = next.filter(isOpen);
    return next;
  }, [alerts, severity, openOnly]);

  const handleLifecycleChange = useCallback(
    (alertId: string, lifecycle: AlertLifecycle) => {
      updateLifecycle(alertId, lifecycle);
      setSelectedAlert((prev) =>
        prev && prev.alert_id === alertId ? { ...prev, lifecycle } : prev,
      );
    },
    [updateLifecycle],
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
      <PageHeader
        title="Alerts"
        eyebrow="Monitoring"
        subtitle="Edge and central-detector alerts across the cluster, in real time. Acknowledge, suppress, or send to diagnosis."
        meta={[
          { tone: "crit", children: `${alerts.filter((a) => a.severity === "CRITICAL").length} critical` },
          { tone: "warn", children: `${alerts.filter((a) => a.severity === "WARNING").length} warning` },
          { tone: "info", children: `${alerts.filter((a) => a.severity === "INFO").length} info` },
        ]}
      />

      {error && <ErrorBanner title="Could not load alerts" message={error} onRetry={refresh} />}

      <SeveritySummary alerts={alerts} />

      <Toolbar>
        <SegmentedControl<string>
          value={severity}
          onChange={selectSeverity}
          options={[
            { value: "ALL", label: "All" },
            { value: "CRITICAL", label: "Crit" },
            { value: "WARNING", label: "Warn" },
            { value: "INFO", label: "Info" },
          ]}
        />
        <button
          onClick={() => setOpenOnly((v) => !v)}
          aria-pressed={openOnly}
          className={`ml-auto inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors ${openOnly ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:text-foreground"}`}
        >
          Open incidents only
        </button>
      </Toolbar>

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <AlertTimeline
          alerts={filteredAlerts}
          diagnoses={diagnoses}
          onSelectAlert={selectAlert}
          onDiagnosisCreated={handleDiagnosisCreated}
        />
      )}

      {selectedAlert && (
        <AlertDetail
          alert={selectedAlert}
          initialDiagnosis={selectedDiagnosis}
          onLifecycleChange={handleLifecycleChange}
          onClose={() => {
            setSelectedAlert(null);
            setSelectedDiagnosis(null);
          }}
        />
      )}
    </div>
  );
}
