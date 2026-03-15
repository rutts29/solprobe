"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DiLoCoMetrics } from "@/lib/types";

interface DilocoChartsProps {
  data: DiLoCoMetrics[];
}

export function DilocoCharts({ data }: DilocoChartsProps) {
  const chartData = data.map((d) => ({
    step: d.inner_step,
    innerLoss: d.inner_loss,
    outerLoss: d.outer_loss,
    pseudoGradNorm: d.pseudo_grad_norm,
    syncDuration: d.sync_duration_ms,
    speedRatio: d.worker_speed_ratio,
    isStraggler: d.is_straggler,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Inner vs Outer Loss</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
                <Line type="monotone" dataKey="innerLoss" stroke="#3b82f6" strokeWidth={2} dot={false} name="Inner Loss" />
                <Line type="monotone" dataKey="outerLoss" stroke="#f59e0b" strokeWidth={2} dot={false} name="Outer Loss" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pseudo-Gradient Norm</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
                <Line type="monotone" dataKey="pseudoGradNorm" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Pseudo Grad Norm" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sync Duration</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
                <Line type="monotone" dataKey="syncDuration" stroke="#06b6d4" strokeWidth={2} dot={false} name="Sync (ms)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Worker Speed Ratio</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="step" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} domain={[0, 2]} />
                <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #27272a", borderRadius: "6px" }} />
                <ReferenceLine y={0.8} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "Straggler", fill: "#ef4444", fontSize: 11 }} />
                <Line type="monotone" dataKey="speedRatio" stroke="#10b981" strokeWidth={2} dot={false} name="Speed Ratio" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
