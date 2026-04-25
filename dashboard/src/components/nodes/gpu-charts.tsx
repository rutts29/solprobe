"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TempChart } from "@/components/charts/temp-chart";
import { UtilizationChart } from "@/components/charts/utilization-chart";
import { LossChart } from "@/components/charts/loss-chart";
import { ThroughputChart } from "@/components/charts/throughput-chart";
import { DilocoCharts } from "@/components/nodes/diloco-charts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { NodeMetricsHistory } from "@/lib/types";

interface GpuChartsProps {
  metrics: NodeMetricsHistory;
}

export function GpuCharts({ metrics }: GpuChartsProps) {
  const hasTraining = metrics.training_metrics.length > 0;
  const hasDiloco = metrics.diloco_metrics.length > 0;

  return (
    <Tabs defaultValue="gpu">
      <TabsList>
        <TabsTrigger value="gpu">GPU Metrics</TabsTrigger>
        {hasTraining && <TabsTrigger value="training">Training</TabsTrigger>}
        {hasDiloco && <TabsTrigger value="diloco">DiLoCo</TabsTrigger>}
      </TabsList>

      <TabsContent value="gpu">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Temperature</CardTitle></CardHeader>
            <CardContent><TempChart data={metrics.gpu_metrics} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>GPU Utilization</CardTitle></CardHeader>
            <CardContent><UtilizationChart data={metrics.gpu_metrics} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Memory Usage</CardTitle></CardHeader>
            <CardContent><MemoryBar data={metrics.gpu_metrics} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Power Draw</CardTitle></CardHeader>
            <CardContent><PowerChart data={metrics.gpu_metrics} /></CardContent>
          </Card>
        </div>
      </TabsContent>

      {hasTraining && (
        <TabsContent value="training">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Loss Curve</CardTitle></CardHeader>
              <CardContent><LossChart data={metrics.training_metrics} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Throughput & MFU</CardTitle></CardHeader>
              <CardContent><ThroughputChart data={metrics.training_metrics} /></CardContent>
            </Card>
          </div>
        </TabsContent>
      )}

      {hasDiloco && (
        <TabsContent value="diloco">
          <DilocoCharts data={metrics.diloco_metrics} />
        </TabsContent>
      )}
    </Tabs>
  );
}

// Inline sub-components

import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { LineChart, Line } from "recharts";
import type { GpuMetrics } from "@/lib/types";
import { isGpuPowerAvailable } from "@/lib/derive";

function MemoryBar({ data }: { data: GpuMetrics[] }) {
  const chartData = useMemo(() => data.slice(-20).map(d => ({
    time: new Date(d.timestamp_ms).toLocaleTimeString(),
    used: d.fb_used_mb,
    free: d.fb_free_mb,
  })), [data]);

  const latest = data[data.length - 1];
  if (!latest) return <p className="text-muted-foreground">No data</p>;
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
          className="h-full rounded-full bg-blue-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Historical trend */}
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="time" tick={{ fill: "#a1a1aa", fontSize: 10 }} />
            <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
            <Bar dataKey="used" stackId="a" fill="#3b82f6" name="Used MB" />
            <Bar dataKey="free" stackId="a" fill="#1e1e2e" name="Free MB" />
          </BarChart>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="time" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
          <Line type="monotone" dataKey="power" stroke="#f59e0b" strokeWidth={2} dot={false} name="Power (W)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
