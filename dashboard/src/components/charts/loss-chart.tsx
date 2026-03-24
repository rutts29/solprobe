"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
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
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} scale="log" domain={["auto", "auto"]} allowDataOverflow />
          <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
          <Line type="monotone" dataKey="loss" stroke="#f59e0b" strokeWidth={2} dot={false} name="Loss" />
          <Line type="monotone" dataKey="gradNorm" stroke="#ef4444" strokeWidth={1} dot={false} name="Grad Norm" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
