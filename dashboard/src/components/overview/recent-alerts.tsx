"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/alerts/severity-badge";
import type { AlertModel } from "@/lib/types";
import { formatRelativeTime, cn } from "@/lib/utils";

interface RecentAlertsProps {
  alerts: AlertModel[];
  loading: boolean;
  onSelectAlert?: (alert: AlertModel) => void;
}

export function RecentAlerts({ alerts, loading, onSelectAlert }: RecentAlertsProps) {
  if (loading) {
    return (
      <Card className="min-w-0">
        <CardHeader><CardTitle>Recent Alerts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Recent Alerts</CardTitle>
        <span className="text-xs text-muted-foreground">{alerts.length} total</span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {alerts.slice(0, 10).map((alert) => {
          const dotColor =
            alert.severity === "CRITICAL" ? "bg-red-500" :
            alert.severity === "WARNING" ? "bg-amber-500" : "bg-blue-500";
          return (
            <div
              key={alert.alert_id}
              onClick={() => onSelectAlert?.(alert)}
              className={cn(
                "flex items-start gap-3 rounded-md border border-border/50 p-3 animate-slide-in transition-colors",
                onSelectAlert && "cursor-pointer hover:bg-accent/50"
              )}
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotColor)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <SeverityBadge severity={alert.severity} />
                  <span className="text-sm font-medium">{alert.alert_type}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">{alert.node_id}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{alert.source}</Badge>
                  {alert.confidence > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {(alert.confidence * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{alert.description}</p>
              </div>
              <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                {formatRelativeTime(alert.timestamp_ms)}
              </span>
            </div>
          );
        })}
        {alerts.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No recent alerts</p>
        )}
      </CardContent>
    </Card>
  );
}
