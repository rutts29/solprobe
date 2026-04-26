"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
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

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" }} />
          <Area type="monotone" dataKey="utilization" stroke="var(--info)" fill="var(--info)" fillOpacity={0.2} strokeWidth={2} name="GPU Util %" />
          <Area type="monotone" dataKey="smActive" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} strokeWidth={1} name="SM Active %" />
          <Area type="monotone" dataKey="tensorActive" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={1} name="Tensor Active %" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
