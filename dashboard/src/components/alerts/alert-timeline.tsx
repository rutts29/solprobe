"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "./severity-badge";
import { Badge } from "@/components/ui/badge";
import type { AlertModel, DiagnosisResult } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { requestDiagnosis } from "@/lib/api";

interface AlertTimelineProps {
  alerts: AlertModel[];
  onSelectAlert: (alert: AlertModel) => void;
  onDiagnosisCreated?: (alert: AlertModel, diagnosis: DiagnosisResult) => void;
}

export function AlertTimeline({ alerts, onSelectAlert, onDiagnosisCreated }: AlertTimelineProps) {
  const [diagnosing, setDiagnosing] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      {alerts.map((alert) => (
        <Card
          key={alert.alert_id}
          className="cursor-pointer transition-colors hover:bg-accent/30 animate-slide-in"
          onClick={() => onSelectAlert(alert)}
        >
          <CardContent className="flex items-start gap-4 p-4">
            {/* Timeline dot */}
            <div className="mt-1 flex flex-col items-center">
              <div className={`h-3 w-3 rounded-full ${
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
                {alert.confidence > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {(alert.confidence * 100).toFixed(0)}% confidence
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatRelativeTime(alert.timestamp_ms)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs"
                  disabled={diagnosing.has(alert.alert_id)}
                  onClick={(e) => handleDiagnose(alert, e)}
                >
                  {diagnosing.has(alert.alert_id) ? "Diagnosing..." : "Diagnose"}
                </Button>
                {errors[alert.alert_id] && (
                  <span className="text-xs text-red-400">{errors[alert.alert_id]}</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      {alerts.length === 0 && (
        <p className="py-12 text-center text-muted-foreground">No alerts</p>
      )}
    </div>
  );
}
