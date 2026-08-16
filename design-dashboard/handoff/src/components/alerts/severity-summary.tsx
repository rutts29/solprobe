"use client";

import { Card, CardContent } from "@/components/ui/card";
import { SparkBars } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";
import type { AlertModel } from "@/lib/types";
import { alertsBySeverity, alertsPerMinute } from "@/lib/derive";

interface SeveritySummaryProps {
  alerts: AlertModel[];
}

export function SeveritySummary({ alerts }: SeveritySummaryProps) {
  const counts = alertsBySeverity(alerts);
  const apm = alertsPerMinute(alerts, 24, 24 * 60_000);
  const peak = Math.max(1, ...apm);

  const cards = [
    { label: "Critical", value: counts.CRITICAL, color: "var(--crit)", textClass: "text-red-500 dark:text-red-400" },
    { label: "Warning",  value: counts.WARNING,  color: "var(--warn)", textClass: "text-amber-500 dark:text-amber-400" },
    { label: "Info",     value: counts.INFO,     color: "var(--info)", textClass: "text-blue-500 dark:text-blue-400" },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{c.label}</div>
            <div className={cn("mt-1 text-3xl font-semibold tabular-nums", c.textClass)}>{c.value}</div>
            <div className="mt-2 text-[11px] text-muted-foreground">last 24h</div>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Alerts / min</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{apm[apm.length - 1]}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">peak {peak}/min · 24h</div>
            </div>
            <SparkBars data={apm} width={120} height={48} color="var(--warn)" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
