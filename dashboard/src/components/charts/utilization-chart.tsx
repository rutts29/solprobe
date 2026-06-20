"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { GpuMetrics } from "@/lib/types";

interface UtilizationChartProps {
  data: GpuMetrics[];
}

export function UtilizationChart({ data }: UtilizationChartProps) {
  const chartData = data.map((d) => ({
    time: new Date(d.timestamp_ms).toLocaleTimeString(),
    utilization: d.gpu_utilization_pct,
    smActive: d.sm_active_pct,
    tensorActive: d.tensor_active_pct,
  }));
  const overlapping =
    chartData.length > 0 &&
    chartData.every((d) => d.utilization === d.smActive && d.smActive === d.tensorActive);

  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} domain={[0, 100]} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" }} />
            <Legend wrapperStyle={{ color: "var(--muted-foreground)", fontSize: 11 }} />
            <Line type="monotone" dataKey="utilization" stroke="var(--info)" strokeWidth={2} dot={false} name="GPU Util %" />
            <Line type="monotone" dataKey="smActive" stroke="var(--brand)" strokeWidth={2} dot={false} strokeDasharray="5 3" name="SM Active %" />
            <Line type="monotone" dataKey="tensorActive" stroke="var(--warn)" strokeWidth={2} dot={false} strokeDasharray="2 3" name="Tensor Active %" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {overlapping && (
        <p className="mt-2 text-xs text-muted-foreground">
          All utilization series currently match in the source samples.
        </p>
      )}
    </div>
  );
}
