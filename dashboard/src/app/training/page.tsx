"use client";

import { useEffect, useState, useMemo } from "react";
import { RunPanel } from "@/components/training/run-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveJob, useJobSummary } from "@/hooks/use-job-summary";
import type { JobStatus } from "@/lib/types";

const DEMO_COMMAND = "bash scripts/demo_nanochat_solprobe.sh";

function statusTone(status?: JobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "running") return "default";
  if (status === "completed") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function TrainingPage() {
  const { job, loading: jobLoading } = useActiveJob();
  const { summary, loading: summaryLoading } = useJobSummary(job?.job_id ?? null);

  const training = summary?.latest_training ?? null;
  const hardware = summary?.latest_hardware ?? null;
  const alerts = summary?.alerts ?? [];
  const diagnoses = summary?.diagnoses ?? [];

  const [history, setHistory] = useState<{ loss: number[]; throughput: number[]; mfu: number[]; gradNorm: number[] }>({
    loss: [], throughput: [], mfu: [], gradNorm: [],
  });

  useEffect(() => {
    if (!training) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rolling sparkline accumulator from poll events
    setHistory((h) => ({
      loss: [...h.loss, training.loss ?? 0].slice(-30),
      throughput: [...h.throughput, training.throughput_tps ?? 0].slice(-30),
      mfu: [...h.mfu, training.mfu_pct ?? 0].slice(-30),
      gradNorm: [...h.gradNorm, training.gradient_norm ?? 0].slice(-30),
    }));
  }, [training]);

  const configEntries = useMemo(
    () => Object.entries(job?.config ?? {}),
    [job]
  );

  if (jobLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Training</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Training</h1>
        <Card>
          <CardHeader><CardTitle>No active training run</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Register a job and start a sidecar to begin monitoring. The bundled demo runs nanochat on Apple Silicon.
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono">{DEMO_COMMAND}</pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{job.name ?? job.job_id}</h1>
          <div className="text-sm text-muted-foreground font-mono mt-1">{job.job_id}</div>
        </div>
        <div className="flex items-center gap-2">
          {job.status && <Badge variant={statusTone(job.status)}>{job.status}</Badge>}
          {summary && (
            <span className="text-xs text-muted-foreground">
              duration {fmtDuration(summary.run_duration_ms)}
            </span>
          )}
        </div>
      </div>

      {configEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Run config</CardTitle></CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
              {configEntries.map(([k, v]) => (
                <div key={k} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-mono">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <RunPanel training={training} diloco={null} history={history} />

      {hardware && (
        <Card>
          <CardHeader><CardTitle className="text-base">GPU snapshot</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Utilization</div>
                <div className="font-mono">{hardware.gpu_utilization_pct?.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Memory used</div>
                <div className="font-mono">
                  {hardware.fb_used_mb} / {hardware.fb_used_mb + hardware.fb_free_mb} MB
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Power</div>
                <div className="font-mono">
                  {hardware.power_usage_w === 0 ? "—" : `${hardware.power_usage_w?.toFixed(1)} W`}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Temp</div>
                <div className="font-mono">
                  {hardware.gpu_temp_c === 0 ? "—" : `${hardware.gpu_temp_c}°C`}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Alerts for this run ({alerts.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts.</p>
          ) : (
            <ul className="space-y-2">
              {alerts.slice(0, 10).map((a) => (
                <li key={a.alert_id} className="flex items-start gap-3 text-sm">
                  <Badge
                    variant={
                      a.severity === "CRITICAL"
                        ? "destructive"
                        : a.severity === "WARNING"
                        ? "default"
                        : "secondary"
                    }
                  >
                    {a.severity}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    {a.alert_type}
                  </span>
                  <span className="flex-1">{a.description}</span>
                </li>
              ))}
            </ul>
          )}
          {diagnoses.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {diagnoses.length} diagnosis{diagnoses.length === 1 ? "" : "es"} attached
            </p>
          )}
        </CardContent>
      </Card>

      {summaryLoading && (
        <p className="text-xs text-muted-foreground">Refreshing summary…</p>
      )}
    </div>
  );
}
