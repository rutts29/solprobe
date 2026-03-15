"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { TrainingMetrics } from "@/lib/types";

interface ThroughputChartProps {
  data: TrainingMetrics[];
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  const chartData = data.map((d) => ({
    step: d.step,
    throughput: d.throughput_tps,
    mfu: d.mfu_pct,
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "#a1a1aa", fontSize: 11 }} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
          <Line yAxisId="left" type="monotone" dataKey="throughput" stroke="#10b981" strokeWidth={2} dot={false} name="Tokens/sec" />
          <Line yAxisId="right" type="monotone" dataKey="mfu" stroke="#8b5cf6" strokeWidth={2} dot={false} name="MFU %" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
