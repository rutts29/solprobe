"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import type { TrainingMetrics, DiLoCoMetrics } from "@/lib/types";
import { GitBranch, Cpu, Gauge, TrendingUp } from "lucide-react";

interface RunPanelProps {
  /** Latest training metric for the run (per-step). */
  training: TrainingMetrics | null;
  /** Latest DiLoCo state (inner/outer step, sync). */
  diloco: DiLoCoMetrics | null;
  /** Optional histories for sparklines. */
  history?: {
    loss?: number[];
    throughput?: number[];
    mfu?: number[];
    gradNorm?: number[];
  };
  /** Total target outer steps for the run, for the progress bar. */
  totalOuterSteps?: number;
}

export function RunPanel({ training, diloco, history, totalOuterSteps = 1000 }: RunPanelProps) {
  if (!training && !diloco) {
    return (
      <Card>
        <CardHeader><CardTitle>Active training run</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No active run</p></CardContent>
      </Card>
    );
  }

  const outerStep = diloco?.outer_step ?? 0;
  const innerStep = diloco?.inner_step ?? training?.step ?? 0;
  const progress = totalOuterSteps > 0 ? Math.min(100, (outerStep / totalOuterSteps) * 100) : 0;

  const stats = [
    {
      label: "Loss",
      value: training?.loss?.toFixed(4) ?? diloco?.outer_loss?.toFixed(4) ?? "—",
      icon: TrendingUp,
      tone: "var(--info)",
      spark: history?.loss,
    },
    {
      label: "Throughput",
      value: training ? `${(training.throughput_tps / 1000).toFixed(1)}k` : "—",
      unit: "tok/s",
      icon: Gauge,
      tone: "var(--ok)",
      spark: history?.throughput,
    },
    {
      label: "MFU",
      value: training ? `${training.mfu_pct.toFixed(1)}` : "—",
      unit: "%",
      icon: Cpu,
      tone: "var(--brand)",
      spark: history?.mfu,
    },
    {
      label: "Grad norm",
      value: training?.gradient_norm?.toFixed(3) ?? diloco?.pseudo_grad_norm?.toFixed(3) ?? "—",
      icon: GitBranch,
      tone: "var(--warn)",
      spark: history?.gradNorm,
    },
  ];

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle>Active training run</CardTitle>
              <Badge variant="success" className="text-[10px]">RUNNING</Badge>
              {diloco?.is_straggler && <Badge variant="warning" className="text-[10px]">straggler</Badge>}
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {training?.job_id ?? diloco?.job_id ?? "—"}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <div>Outer step <span className="font-mono tabular-nums text-foreground">{outerStep}</span> / {totalOuterSteps}</div>
            <div>Inner step <span className="font-mono tabular-nums text-foreground">{innerStep}</span></div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{progress.toFixed(1)}% complete</span>
            {diloco && <span>sync {diloco.sync_duration_ms}ms · worker speed {(diloco.worker_speed_ratio * 100).toFixed(0)}%</span>}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3 w-3" style={{ color: s.tone }} />
                    {s.label}
                  </div>
                  <Sparkline data={s.spark ?? []} width={56} height={20} stroke={s.tone} fillOpacity={0.15} />
                </div>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-xl font-semibold tabular-nums">{s.value}</span>
                  {s.unit && <span className="text-[11px] text-muted-foreground">{s.unit}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
