"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SeverityBadge } from "@/components/alerts/severity-badge";
import type { AlertModel } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";

interface RecentAlertsProps {
  alerts: AlertModel[];
  loading: boolean;
}

export function RecentAlerts({ alerts, loading }: RecentAlertsProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Recent Alerts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Recent Alerts</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {alerts.slice(0, 10).map((alert) => (
          <div
            key={alert.alert_id}
            className="flex items-start gap-3 rounded-md border border-border/50 p-3 animate-slide-in"
          >
            <SeverityBadge severity={alert.severity} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{alert.alert_type}</span>
                <span className="text-xs text-muted-foreground font-mono">{alert.node_id}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{alert.description}</p>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(alert.timestamp_ms)}
            </span>
          </div>
        ))}
        {alerts.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">No recent alerts</p>
        )}
      </CardContent>
    </Card>
  );
}
