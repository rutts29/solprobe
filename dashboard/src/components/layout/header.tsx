"use client";

import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff } from "lucide-react";

interface HeaderProps {
  wsConnected: boolean;
  criticalAlerts: number;
}

export function Header({ wsConnected, criticalAlerts }: HeaderProps) {
  const healthColor =
    criticalAlerts > 0 ? "destructive" : "success";
  const healthLabel =
    criticalAlerts > 0 ? `${criticalAlerts} Critical` : "Healthy";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Cluster Status</span>
        <Badge variant={healthColor}>{healthLabel}</Badge>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {wsConnected ? (
          <>
            <Wifi className="h-4 w-4 text-emerald-400" />
            <span className="text-emerald-400">Live</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 text-red-400" />
            <span className="text-red-400">Disconnected</span>
          </>
        )}
      </div>
    </header>
  );
}
