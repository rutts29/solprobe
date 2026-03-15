"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, AlertTriangle, Brain, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthCardsProps {
  connectedNodes: number;
  activeAlerts: number;
  diagnosesToday: number;
  avgGpuUtil: number;
}

export function HealthCards({ connectedNodes, activeAlerts, diagnosesToday, avgGpuUtil }: HealthCardsProps) {
  const cards = [
    {
      title: "Connected Nodes",
      value: connectedNodes,
      icon: Server,
      color: connectedNodes > 0 ? "text-emerald-400" : "text-red-400",
    },
    {
      title: "Active Alerts",
      value: activeAlerts,
      icon: AlertTriangle,
      color: activeAlerts === 0 ? "text-emerald-400" : activeAlerts > 5 ? "text-red-400" : "text-amber-400",
    },
    {
      title: "Diagnoses Today",
      value: diagnosesToday,
      icon: Brain,
      color: "text-blue-400",
    },
    {
      title: "Avg GPU Util",
      value: `${avgGpuUtil.toFixed(1)}%`,
      icon: Cpu,
      color: avgGpuUtil > 80 ? "text-emerald-400" : avgGpuUtil > 50 ? "text-amber-400" : "text-red-400",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
            <card.icon className={cn("h-4 w-4", card.color)} />
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", card.color)}>{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
