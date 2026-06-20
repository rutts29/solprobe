"use client";

import { useEffect, useState, useMemo } from "react";
import { RunPanel } from "@/components/training/run-panel";
import { CustomMetricsCard } from "@/components/training/custom-metrics-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveJob, useJobSummary } from "@/hooks/use-job-summary";
import { useCustomMetrics } from "@/hooks/use-custom-metrics";
import { formatRelativeTime } from "@/lib/utils";
import type { AlertModel, JobStatus } from "@/lib/types";

const DEMO_COMMAND = "make demo";
const COLAB_NOTEBOOK_URL = "/colab/solprobe_colab_t4_demo.ipynb";

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

function alertSeverityVariant(severity: AlertModel["severity"]): "default" | "secondary" | "destructive" {
  if (severity === "CRITICAL") return "destructive";
  if (severity === "WARNING") return "default";
  return "secondary";
}

function ColabQuickstartCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Google Colab T4</CardTitle>
          <Badge variant="info">REST client</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Run a tiny PyTorch training job on a free Colab GPU and stream GPU plus training telemetry into this dashboard.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={COLAB_NOTEBOOK_URL}
            download
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Download notebook
          </a>
          <a
            href="/training"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            View run
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          Colab needs a public backend URL. Use a deployed backend or expose local port 8000 with your tunnel of choice.
        </p>
      </CardContent>
    </Card>
  );
}

export default function TrainingPage() {
  const { job, loading: jobLoading } = useActiveJob();
  const { summary, loading: summaryLoading } = useJobSummary(job?.job_id ?? null);
  const { metrics: customMetrics } = useCustomMetrics(job?.job_id ?? null);

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
  const alertColumns = useMemo<DataTableColumn<AlertModel>[]>(
    () => [
      {
        key: "severity",
        header: "Severity",
        cell: (alert) => <Badge variant={alertSeverityVariant(alert.severity)}>{alert.severity}</Badge>,
      },
      {
        key: "type",
        header: "Type",
        cell: (alert) => <span className="font-mono text-xs text-muted-foreground">{alert.alert_type}</span>,
      },
      {
        key: "description",
        header: "Description",
        cell: (alert) => alert.description,
      },
      {
        key: "time",
        header: "Time",
        align: "right",
        cell: (alert) => (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {formatRelativeTime(alert.timestamp_ms)}
          </span>
        ),
      },
    ],
    [],
  );

  if (jobLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Training" eyebrow="Monitoring / Training" subtitle="Live job metrics and custom training telemetry." />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-6">
        <PageHeader title="Training" eyebrow="Monitoring / Training" subtitle="Live job metrics and custom training telemetry." />
        <Card>
          <CardContent className="space-y-3">
            <EmptyState
              title="No active training run"
              description="Register a job and start a sidecar to begin monitoring. The bundled demo runs nanochat on Apple Silicon."
              action={<code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-primary">{DEMO_COMMAND}</code>}
            />
          </CardContent>
        </Card>
        <ColabQuickstartCard />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.name ?? job.job_id}
        eyebrow="Monitoring / Training"
        subtitle={<span className="font-mono text-xs">{job.job_id}</span>}
        badge={job.status ? <Badge variant={statusTone(job.status)}>{job.status}</Badge> : undefined}
        meta={summary ? [{ children: `duration ${fmtDuration(summary.run_duration_ms)}` }] : undefined}
      />

      <ColabQuickstartCard />

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

      <CustomMetricsCard metrics={customMetrics} />

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
            <EmptyState title="No alerts" description="Alerts scoped to this training run will appear here." className="py-8" />
          ) : (
            <DataTable
              columns={alertColumns}
              rows={alerts.slice(0, 10)}
              rowKey={(alert) => alert.alert_id}
            />
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
