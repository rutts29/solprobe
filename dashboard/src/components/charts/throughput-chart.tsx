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
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="step" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <YAxis yAxisId="left" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" }} />
          <Line yAxisId="left" type="monotone" dataKey="throughput" stroke="var(--ok)" strokeWidth={2} dot={false} name="Tokens/sec" />
          <Line yAxisId="right" type="monotone" dataKey="mfu" stroke="#8b5cf6" strokeWidth={2} dot={false} name="MFU %" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
