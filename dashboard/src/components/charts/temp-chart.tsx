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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="time" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} domain={[20, 100]} />
          <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
          <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Warn", fill: "#f59e0b", fontSize: 11 }} />
          <ReferenceLine y={85} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "Crit", fill: "#ef4444", fontSize: 11 }} />
          <Line type="monotone" dataKey="temp" stroke="#3b82f6" strokeWidth={2} dot={false} name="Temperature (°C)" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
