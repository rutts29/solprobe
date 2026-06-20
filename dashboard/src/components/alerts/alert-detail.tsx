"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/error-banner";
import { SeverityBadge } from "./severity-badge";
import { LifecycleActions } from "./lifecycle-actions";
import { Badge } from "@/components/ui/badge";
import type {
  AlertLifecycle,
  AlertModel,
  EnrichedAlert,
  DiagnosisResult,
} from "@/lib/types";
import { fetchEnrichedAlert, fetchAlertDiagnosis, requestDiagnosis } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";
import { X } from "lucide-react";

interface AlertDetailProps {
  alert: AlertModel;
  onClose: () => void;
  initialDiagnosis?: DiagnosisResult | null;
  onLifecycleChange?: (alertId: string, lifecycle: AlertLifecycle) => void;
}

export function AlertDetail({ alert, onClose, initialDiagnosis = null, onLifecycleChange }: AlertDetailProps) {
  const [enriched, setEnriched] = useState<EnrichedAlert | null>(null);
  const [enrichedError, setEnrichedError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [diagnosisNotFound, setDiagnosisNotFound] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<AlertLifecycle | null>(alert.lifecycle ?? null);

  useEffect(() => {
    let cancelled = false;
    setEnriched(null);
    setEnrichedError(null);
    setDiagnosis(initialDiagnosis);
    setDiagnosisNotFound(false);
    setRequestError(null);
    setLifecycle(alert.lifecycle ?? null);

    fetchEnrichedAlert(alert.alert_id)
      .then((data) => {
        if (cancelled) return;
        setEnriched(data);
        if (data.lifecycle !== undefined) setLifecycle(data.lifecycle);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes("404")) return;
        setEnrichedError(err instanceof Error ? err.message : "Failed to load enriched alert");
      });

    if (!initialDiagnosis) fetchAlertDiagnosis(alert.alert_id)
      .then((data) => { if (!cancelled) setDiagnosis(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message.includes("404")) {
          setDiagnosisNotFound(true);
          return;
        }
        console.error("[AlertDetail] failed to fetch diagnosis:", err);
      });

    return () => { cancelled = true; };
  }, [alert.alert_id, alert.lifecycle, initialDiagnosis]);

  async function handleRequestDiagnosis() {
    setRequesting(true);
    setRequestError(null);
    try {
      const result = await requestDiagnosis(alert.alert_id);
      setDiagnosis(result);
      setDiagnosisNotFound(false);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Diagnosis request failed");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l bg-card shadow-xl">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="font-semibold">Alert Detail</h2>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {/* Alert info */}
        <div className="flex items-center gap-2 flex-wrap">
          <SeverityBadge severity={alert.severity} />
          <Badge variant="outline" className="font-mono">{alert.node_id}</Badge>
          <Badge variant="secondary">{alert.source}</Badge>
        </div>
        <h3 className="text-lg font-medium">{alert.alert_type}</h3>
        <p className="text-sm text-muted-foreground">{alert.description}</p>
        <p className="text-xs text-muted-foreground">{formatTimestamp(alert.timestamp_ms)}</p>

        <LifecycleActions
          alertId={alert.alert_id}
          lifecycle={lifecycle}
          onChange={(next) => {
            setLifecycle(next);
            onLifecycleChange?.(alert.alert_id, next);
          }}
        />

        {/* Evidence */}
        {alert.evidence && Object.keys(alert.evidence).length > 0 && (
          <Card>
            <CardHeader><CardTitle>Evidence</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {Object.entries(alert.evidence).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Enrichment error */}
        {enrichedError && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
            Failed to load enriched data: {enrichedError}
          </div>
        )}

        {/* Correlated alerts — uses EnrichedAlert.correlated_events */}
        {enriched?.correlated_events && enriched.correlated_events.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Correlated Events</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {enriched.correlated_events.map((a) => (
                <div key={a.alert_id} className="flex items-center gap-2 text-sm">
                  <SeverityBadge severity={a.severity} />
                  <span>{a.alert_type}</span>
                  <span className="text-muted-foreground font-mono">{a.node_id}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Diagnosis */}
        {diagnosis ? (
          <Card>
            <CardHeader><CardTitle>Diagnosis</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="font-medium">{diagnosis.root_cause}</span>
                <Badge variant={diagnosis.confidence > 0.8 ? "success" : diagnosis.confidence > 0.5 ? "warning" : "destructive"}>
                  {(diagnosis.confidence * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{diagnosis.reasoning}</p>
              {diagnosis.recommended_action && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">{diagnosis.recommended_action.action}</p>
                  <Badge variant={
                    diagnosis.recommended_action.urgency === "immediate" ? "destructive" :
                    diagnosis.recommended_action.urgency === "soon" ? "warning" : "info"
                  } className="mt-1">
                    {diagnosis.recommended_action.urgency}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {requestError && (
              <ErrorBanner title="Diagnosis request failed" message={requestError} />
            )}
            {diagnosisNotFound && (
              <Button onClick={handleRequestDiagnosis} disabled={requesting}>
                {requesting ? "Requesting..." : "Request Diagnosis"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
