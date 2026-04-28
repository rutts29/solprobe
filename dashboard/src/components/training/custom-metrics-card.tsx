"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomMetric } from "@/lib/types";

interface CustomMetricsCardProps {
  jobId: string;
  metrics: CustomMetric[];
}

const SERIES_COLORS = [
  "var(--info)",
  "var(--ok)",
  "var(--brand)",
  "var(--warn)",
  "var(--crit)",
];

interface SeriesPoint {
  ts: number;
  value: number;
}

interface SeriesGroup {
  name: string;
  unit: string | null;
  points: SeriesPoint[];
}

function groupByName(metrics: CustomMetric[]): SeriesGroup[] {
  const buckets = new Map<string, SeriesGroup>();
  for (const m of metrics) {
    const existing = buckets.get(m.name);
    if (existing) {
      existing.points.push({ ts: m.timestamp_ms, value: m.value });
      if (!existing.unit && m.unit) existing.unit = m.unit;
    } else {
      buckets.set(m.name, {
        name: m.name,
        unit: m.unit ?? null,
        points: [{ ts: m.timestamp_ms, value: m.value }],
      });
    }
  }
  for (const g of buckets.values()) {
    g.points.sort((a, b) => a.ts - b.ts);
  }
  return Array.from(buckets.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function CustomMetricsCard({ metrics }: CustomMetricsCardProps) {
  const groups = useMemo(() => groupByName(metrics), [metrics]);

  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Custom metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2">
          {groups.map((g, i) => {
            const color = SERIES_COLORS[i % SERIES_COLORS.length];
            const last = g.points[g.points.length - 1]?.value;
            return (
              <div key={g.name} className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-sm font-mono">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {last != null ? last.toFixed(4) : "—"}
                    {g.unit ? ` ${g.unit}` : ""}
                  </div>
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={g.points}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="ts"
                        tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        tickFormatter={(t: number) => new Date(t).toLocaleTimeString()}
                        minTickGap={40}
                      />
                      <YAxis
                        tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                        domain={["auto", "auto"]}
                        width={48}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: "6px",
                          color: "var(--popover-foreground)",
                          fontSize: "12px",
                        }}
                        labelFormatter={(label) => {
                          const t = Number(label);
                          return Number.isFinite(t)
                            ? new Date(t).toLocaleString()
                            : "";
                        }}
                        formatter={(value) => {
                          const v = Number(value);
                          const label = g.unit ?? "value";
                          return [Number.isFinite(v) ? v.toFixed(4) : String(value), label];
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke={color}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
