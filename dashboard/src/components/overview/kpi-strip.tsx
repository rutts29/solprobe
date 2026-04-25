"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Sparkline, SparkBars } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";
import {
  Server, AlertTriangle, Brain, Cpu, Zap, Coins,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NodeStatus, AlertModel, HealthStatus } from "@/lib/types";
import {
  avgGpuUtilization, avgGpuTemp, totalPowerKw, totalThroughputTps, alertsPerMinute,
} from "@/lib/derive";

interface KpiStripProps {
  nodes: NodeStatus[];
  alerts: AlertModel[];
  health: HealthStatus | null;
  /** Optional history series (last ~20 samples) for sparklines. Falls back to a flat line if absent. */
  history?: {
    util?: number[];
    throughput?: number[];
    temp?: number[];
    power?: number[];
  };
}

type Trend = "up" | "down" | "flat";

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  delta?: string;
  trend?: Trend;
  icon: LucideIcon;
  iconTone: string;
  spark?: number[];
  sparkKind?: "line" | "bars";
  sparkColor?: string;
}

function KpiCard({ label, value, unit, delta, trend, icon: Icon, iconTone, spark, sparkKind = "line", sparkColor = "var(--brand)" }: KpiCardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up" ? "text-emerald-500 dark:text-emerald-400" :
    trend === "down" ? "text-red-500 dark:text-red-400" : "text-muted-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Icon className={cn("h-3.5 w-3.5", iconTone)} />
              <span>{label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tabular-nums">{value}</span>
              {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            </div>
            {delta && (
              <div className={cn("flex items-center gap-1 text-[11px] font-mono", trendColor)}>
                <TrendIcon className="h-3 w-3" />
                <span>{delta}</span>
              </div>
            )}
          </div>
          <div className="opacity-90">
            {sparkKind === "bars"
              ? <SparkBars data={spark ?? []} width={64} height={28} color={sparkColor} />
              : <Sparkline data={spark ?? []} width={64} height={28} stroke={sparkColor} fillOpacity={0.18} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiStrip({ nodes, alerts, health, history }: KpiStripProps) {
  const util = avgGpuUtilization(nodes);
  const temp = avgGpuTemp(nodes);
  const power = totalPowerKw(nodes);
  const tps = totalThroughputTps(nodes);
  const apm = alertsPerMinute(alerts, 12);
  const alertsTotal = health?.total_alerts ?? alerts.length;
  const diagnosesTotal = health?.total_diagnoses ?? 0;

  const flat = (n: number, len = 12) => Array(len).fill(n);

  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="Connected nodes"
        value={String(nodes.length || health?.connected_sidecars || 0)}
        delta="live"
        trend="flat"
        icon={Server}
        iconTone="text-emerald-500 dark:text-emerald-400"
        spark={history?.util ?? flat(util)}
        sparkColor="var(--ok)"
      />
      <KpiCard
        label="Avg GPU util"
        value={util.toFixed(1)}
        unit="%"
        delta={`${util > 80 ? "saturated" : util > 50 ? "active" : "idle"}`}
        trend={util > 80 ? "up" : util < 30 ? "down" : "flat"}
        icon={Cpu}
        iconTone="text-orange-500 dark:text-orange-400"
        spark={history?.util ?? flat(util)}
        sparkColor="var(--brand)"
      />
      <KpiCard
        label="Throughput"
        value={tps >= 1000 ? (tps / 1000).toFixed(1) : tps.toFixed(0)}
        unit={tps >= 1000 ? "k tok/s" : "tok/s"}
        icon={TrendingUp}
        iconTone="text-blue-500 dark:text-blue-400"
        spark={history?.throughput ?? flat(tps)}
        sparkColor="var(--info)"
      />
      <KpiCard
        label="Alerts / min"
        value={String(alerts.filter((a) => a.timestamp_ms > Date.now() - 60_000).length)}
        delta={`${alertsTotal} total`}
        trend={apm[apm.length - 1] > apm[0] ? "up" : "flat"}
        icon={AlertTriangle}
        iconTone="text-amber-500 dark:text-amber-400"
        spark={apm}
        sparkColor="var(--warn)"
        sparkKind="bars"
      />
      <KpiCard
        label="Diagnoses"
        value={String(diagnosesTotal)}
        delta="today"
        trend="flat"
        icon={Brain}
        iconTone="text-orange-500 dark:text-orange-400"
        spark={flat(diagnosesTotal)}
        sparkColor="var(--brand)"
      />
      <KpiCard
        label="Cluster power"
        value={power.toFixed(1)}
        unit="kW"
        delta={`avg ${temp.toFixed(0)}°C`}
        trend={temp > 75 ? "up" : "flat"}
        icon={Zap}
        iconTone="text-amber-500 dark:text-amber-400"
        spark={history?.power ?? flat(power)}
        sparkColor="var(--warn)"
      />
    </div>
  );
}
