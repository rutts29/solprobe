"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TempChart } from "@/components/charts/temp-chart";
import { UtilizationChart } from "@/components/charts/utilization-chart";
import { LossChart } from "@/components/charts/loss-chart";
import { ThroughputChart } from "@/components/charts/throughput-chart";
import { DilocoCharts } from "@/components/nodes/diloco-charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { NodeMetricsHistory } from "@/lib/types";
import type { ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { useMemo, useState } from "react";

type ChartId = "temp" | "util" | "memory" | "power" | "loss" | "throughput";

interface GpuChartsProps {
  metrics: NodeMetricsHistory;
}

export function GpuCharts({ metrics }: GpuChartsProps) {
  const hasTraining = metrics.training_metrics.length > 0;
  const hasDiloco = metrics.diloco_metrics.length > 0;
  const [expanded, setExpanded] = useState<ChartId | null>(null);

  const charts: Record<ChartId, { title: string; meta: string; body: ReactNode }> = {
    temp: {
      title: "Temperature",
      meta: latestTemp(metrics.gpu_metrics),
      body: <TempChart data={metrics.gpu_metrics} />,
    },
    util: {
      title: "GPU utilization",
      meta: latestPct(metrics.gpu_metrics.at(-1)?.gpu_utilization_pct),
      body: <UtilizationChart data={metrics.gpu_metrics} />,
    },
    memory: {
      title: "Memory usage",
      meta: latestMemory(metrics.gpu_metrics),
      body: <MemoryBar data={metrics.gpu_metrics} />,
    },
    power: {
      title: "Power draw",
      meta: latestPower(metrics.gpu_metrics),
      body: <PowerChart data={metrics.gpu_metrics} />,
    },
    loss: {
      title: "Loss curve",
      meta: latestTraining(metrics.training_metrics, "loss"),
      body: <LossChart data={metrics.training_metrics} />,
    },
    throughput: {
      title: "Throughput and MFU",
      meta: latestTraining(metrics.training_metrics, "throughput"),
      body: <ThroughputChart data={metrics.training_metrics} />,
    },
  };
  const expandedChart = expanded ? charts[expanded] : null;

  return (
    <>
      <Tabs defaultValue="gpu">
        <TabsList>
          <TabsTrigger value="gpu">GPU</TabsTrigger>
          {hasTraining && <TabsTrigger value="training">Training</TabsTrigger>}
          {hasDiloco && <TabsTrigger value="diloco">DiLoCo</TabsTrigger>}
        </TabsList>

        <TabsContent value="gpu">
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard {...charts.temp} onExpand={() => setExpanded("temp")} />
            <ChartCard {...charts.util} onExpand={() => setExpanded("util")} />
            <ChartCard {...charts.memory} onExpand={() => setExpanded("memory")} />
            <ChartCard {...charts.power} onExpand={() => setExpanded("power")} />
          </div>
        </TabsContent>

        {hasTraining && (
          <TabsContent value="training">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard {...charts.loss} onExpand={() => setExpanded("loss")} />
              <ChartCard {...charts.throughput} onExpand={() => setExpanded("throughput")} />
            </div>
          </TabsContent>
        )}

        {hasDiloco && (
          <TabsContent value="diloco">
            <DilocoCharts data={metrics.diloco_metrics} />
          </TabsContent>
        )}
      </Tabs>

      {expandedChart && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setExpanded(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={expandedChart.title}
            className="w-full max-w-5xl rounded-lg border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">{expandedChart.title}</h2>
                <p className="font-mono text-xs text-muted-foreground">{expandedChart.meta}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close chart"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 [&_.h-40]:h-[46vh] [&_.h-64]:h-[60vh]">
              {expandedChart.body}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Inline sub-components

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { GpuMetrics } from "@/lib/types";
import { isGpuPowerAvailable, isGpuTempAvailable } from "@/lib/derive";

const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--popover-foreground)",
} as const;
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 } as const;

function ChartCard({ title, meta, body, onExpand }: { title: string; meta: string; body: ReactNode; onExpand: () => void }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          <span className="mt-1 block font-mono text-xs text-muted-foreground">{meta}</span>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Expand ${title}`}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function latestPct(value: number | undefined) {
  return value === undefined ? "No samples" : `${value.toFixed(1)}% latest`;
}

function latestTemp(data: GpuMetrics[]) {
  const latest = data.at(-1);
  if (!latest || !isGpuTempAvailable(latest)) return "No samples";
  return `${latest.gpu_temp_c.toFixed(0)}C latest`;
}

function latestMemory(data: GpuMetrics[]) {
  const latest = data.at(-1);
  if (!latest) return "No samples";
  const total = latest.fb_used_mb + latest.fb_free_mb;
  const pct = total > 0 ? (latest.fb_used_mb / total) * 100 : 0;
  return `${pct.toFixed(1)}% used`;
}

function latestPower(data: GpuMetrics[]) {
  const latest = data.at(-1);
  if (!latest || !isGpuPowerAvailable(latest)) return "Unavailable";
  return `${latest.power_usage_w.toFixed(0)}W latest`;
}

function latestTraining(data: NodeMetricsHistory["training_metrics"], metric: "loss" | "throughput") {
  const latest = data.at(-1);
  if (!latest) return "No samples";
  return metric === "loss"
    ? `loss ${latest.loss.toFixed(3)}`
    : `${latest.throughput_tps.toFixed(0)} tok/s`;
}

function MemoryBar({ data }: { data: GpuMetrics[] }) {
  const chartData = useMemo(() => data.slice(-60).map(d => ({
    time: new Date(d.timestamp_ms).toLocaleTimeString(),
    used: d.fb_used_mb,
  })), [data]);

  const latest = data[data.length - 1];
  if (!latest) return <p className="py-20 text-center text-sm text-muted-foreground">No samples yet</p>;
  const total = latest.fb_used_mb + latest.fb_free_mb;
  const pct = total > 0 ? (latest.fb_used_mb / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold">{pct.toFixed(1)}%</span>
        <span className="text-muted-foreground text-sm">{latest.fb_used_mb}MB / {total}MB</span>
      </div>
      <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--info)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ ...AXIS_TICK, fontSize: 10 }} />
            <YAxis tick={AXIS_TICK} domain={[0, total]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="used" stroke="var(--info)" strokeWidth={2} dot={false} name="Used MB" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PowerChart({ data }: { data: GpuMetrics[] }) {
  const chartData = useMemo(() => data.map(d => ({
    time: new Date(d.timestamp_ms).toLocaleTimeString(),
    power: isGpuPowerAvailable(d) ? d.power_usage_w : null,
  })), [data]);

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="time" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line type="monotone" dataKey="power" stroke="var(--warn)" strokeWidth={2} dot={false} name="Power (W)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
