"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SeverityBadge } from "./severity-badge";
import { Badge } from "@/components/ui/badge";
import type { AlertModel, DiagnosisResult } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { requestDiagnosis } from "@/lib/api";
import { BrainCircuit, CheckCircle2, Clock3, MessageSquare } from "lucide-react";

interface AlertTimelineProps {
  alerts: AlertModel[];
  diagnoses?: DiagnosisResult[];
  onSelectAlert: (alert: AlertModel) => void;
  onDiagnosisCreated?: (alert: AlertModel, diagnosis: DiagnosisResult) => void;
}

export function AlertTimeline({ alerts, diagnoses = [], onSelectAlert, onDiagnosisCreated }: AlertTimelineProps) {
  const [diagnosing, setDiagnosing] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const diagnosisByAlert = new Map(diagnoses.map((diagnosis) => [diagnosis.alert_id, diagnosis]));

  async function handleDiagnose(alert: AlertModel, e: React.MouseEvent) {
    e.stopPropagation();
    const alertId = alert.alert_id;
    setDiagnosing((s) => new Set(s).add(alertId));
    setErrors((prev) => { const next = { ...prev }; delete next[alertId]; return next; });
    try {
      const diagnosis = await requestDiagnosis(alertId);
      onDiagnosisCreated?.(alert, diagnosis);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [alertId]: err instanceof Error ? err.message : "Diagnosis failed",
      }));
    } finally {
      setDiagnosing((s) => {
        const next = new Set(s);
        next.delete(alertId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const diagnosis = diagnosisByAlert.get(alert.alert_id);
        const lifecycleState = alert.lifecycle?.state ?? "open";
        const noteCount = alert.lifecycle?.notes.length ?? 0;
        const isClosed = lifecycleState === "resolved" || lifecycleState === "ignored";

        return (
        <Card
          key={alert.alert_id}
          className="cursor-pointer transition-colors hover:bg-accent/30 animate-slide-in"
          onClick={() => onSelectAlert(alert)}
        >
          <CardContent className="flex items-start gap-4 p-4">
            <div className="mt-1 flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full ${
                isClosed ? "bg-emerald-500" :
                alert.severity === "CRITICAL" ? "bg-red-500" :
                alert.severity === "WARNING" ? "bg-amber-500" : "bg-blue-500"
              }`} />
              <div className="mt-1 h-full w-px bg-border" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SeverityBadge severity={alert.severity} />
                <span className="font-medium text-sm">{alert.alert_type}</span>
                <Badge variant="outline" className="text-xs font-mono">{alert.node_id}</Badge>
                <Badge variant="secondary" className="text-xs">{alert.source}</Badge>
                <Badge variant={isClosed ? "success" : "outline"} className="gap-1 text-xs">
                  {isClosed ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                  {lifecycleState}
                </Badge>
                {alert.confidence > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {(alert.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatRelativeTime(alert.timestamp_ms)}</span>
                {alert.job_id && (
                  <Badge variant="outline" className="text-xs font-mono">{alert.job_id}</Badge>
                )}
                {noteCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="h-3 w-3" />
                    {noteCount}
                  </span>
                )}
                {diagnosis && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <BrainCircuit className="h-3 w-3" />
                    {diagnosis.root_cause} / {diagnosis.recommended_action.urgency}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 text-xs"
                  disabled={diagnosing.has(alert.alert_id)}
                  onClick={(e) => handleDiagnose(alert, e)}
                >
                  <BrainCircuit className="h-3 w-3" />
                  {diagnosing.has(alert.alert_id) ? "Diagnosing..." : "Diagnose"}
                </Button>
                {errors[alert.alert_id] && (
                  <span className="text-xs text-[var(--crit)]">{errors[alert.alert_id]}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}
      {alerts.length === 0 && (
        <EmptyState icon={MessageSquare} title="No alerts" description="Matching alerts will appear here as they stream in." />
      )}
    </div>
  );
}
