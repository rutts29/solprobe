"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import type { NodeStatus } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { memPct, nodeTone, tempTone } from "@/lib/derive";

interface NodeCardProps {
  node: NodeStatus;
  /** Optional history for sparkline. Falls back to a flat line. */
  utilHistory?: number[];
}

const TONE_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-500",
  muted: "bg-zinc-500",
};

function Bar({ value, tone = "ok", label }: { value: number; tone?: "ok" | "warn" | "crit"; label: string }) {
  const fill = tone === "crit" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{value.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function NodeCard({ node, utilHistory }: NodeCardProps) {
  const gpu = node.latest_metrics[0] ?? null;
  const tone = nodeTone(node);
  const tTone = gpu ? tempTone(gpu.gpu_temp_c) : "muted";
  const memValue = gpu ? memPct(gpu) : 0;
  const series = utilHistory && utilHistory.length > 1 ? utilHistory : Array(12).fill(gpu?.gpu_utilization_pct ?? 0);

  return (
    <Link href={`/nodes/${node.node_id}`}>
      <Card className="transition-colors hover:bg-accent/30">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone], tone === "ok" && "pulse-dot")} />
              <CardTitle className="font-mono text-sm">{node.node_id}</CardTitle>
            </div>
            <div className="text-[11px] text-muted-foreground">{node.gpu_model || "Unknown GPU"}</div>
          </div>
          <Badge variant="outline" className="font-mono text-[10px]">×{node.gpu_count}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {gpu ? (
            <>
              <Sparkline data={series} width={240} height={36} stroke="var(--brand)" fillOpacity={0.16} className="w-full" />

              <div className="grid grid-cols-2 gap-3">
                <Bar value={gpu.gpu_utilization_pct} label="GPU util" />
                <Bar value={memValue} tone={memValue > 90 ? "warn" : "ok"} label="Memory" />
              </div>

              <div className="flex items-center justify-between border-t pt-2 text-[11px]">
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    Temp{" "}
                    <span className={cn(
                      "font-mono tabular-nums",
                      tTone === "crit" && "text-red-500 dark:text-red-400",
                      tTone === "warn" && "text-amber-500 dark:text-amber-400",
                      tTone === "ok" && "text-foreground",
                    )}>
                      {gpu.gpu_temp_c}°C
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    Power <span className="font-mono tabular-nums text-foreground">{gpu.power_usage_w}W</span>
                  </span>
                </div>
                <span className="text-muted-foreground">{formatRelativeTime(node.last_seen_ms)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No GPU metrics available</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
