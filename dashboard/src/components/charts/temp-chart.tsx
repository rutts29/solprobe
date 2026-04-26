"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import type { GpuMetrics } from "@/lib/types";
import { isGpuTempAvailable } from "@/lib/derive";

interface TempChartProps {
  data: GpuMetrics[];
}

export function TempChart({ data }: TempChartProps) {
  const chartData = data.map((d) => ({
    time: new Date(d.timestamp_ms).toLocaleTimeString(),
    temp: isGpuTempAvailable(d) ? d.gpu_temp_c : null,
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="time" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} domain={[20, 100]} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" }} />
          <ReferenceLine y={80} stroke="var(--warn)" strokeDasharray="5 5" label={{ value: "Warn", fill: "var(--warn)", fontSize: 11 }} />
          <ReferenceLine y={85} stroke="var(--crit)" strokeDasharray="5 5" label={{ value: "Crit", fill: "var(--crit)", fontSize: 11 }} />
          <Line type="monotone" dataKey="temp" stroke="var(--info)" strokeWidth={2} dot={false} name="Temperature (°C)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
