"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { TrainingMetrics } from "@/lib/types";

interface LossChartProps {
  data: TrainingMetrics[];
}

export function LossChart({ data }: LossChartProps) {
  const chartData = data.map((d) => ({
    step: d.step,
    loss: Math.max(d.loss, 1e-8),
    gradNorm: Math.max(d.gradient_norm, 1e-8),
    lr: d.learning_rate,
  }));

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="step" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
          <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} scale="log" domain={["auto", "auto"]} allowDataOverflow />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--popover-foreground)" }} />
          <Line type="monotone" dataKey="loss" stroke="var(--warn)" strokeWidth={2} dot={false} name="Loss" />
          <Line type="monotone" dataKey="gradNorm" stroke="var(--crit)" strokeWidth={1} dot={false} name="Grad Norm" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
