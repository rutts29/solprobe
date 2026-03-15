"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NodeStatus } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

interface NodeCardProps {
  node: NodeStatus;
}

export function NodeCard({ node }: NodeCardProps) {
  const gpu = node.latest_metrics[0] ?? null;
  const memPct = gpu ? (gpu.fb_used_mb / (gpu.fb_used_mb + gpu.fb_free_mb)) * 100 : 0;

  return (
    <Link href={`/nodes/${node.node_id}`}>
      <Card className="transition-colors hover:bg-accent/30">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-mono text-sm">{node.node_id}</CardTitle>
          <Badge variant="success">{node.gpu_count} GPU{node.gpu_count !== 1 ? "s" : ""}</Badge>
        </CardHeader>
        <CardContent>
          {gpu ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">GPU: </span>
                <span>{node.gpu_model}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Temp: </span>
                <span className={cn(gpu.gpu_temp_c > 80 ? "text-red-400" : gpu.gpu_temp_c > 70 ? "text-amber-400" : "text-emerald-400")}>
                  {gpu.gpu_temp_c}°C
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Util: </span>
                <span>{gpu.gpu_utilization_pct}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Mem: </span>
                <span>{memPct.toFixed(0)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Power: </span>
                <span>{gpu.power_usage_w}W</span>
              </div>
              <div>
                <span className="text-muted-foreground">Last seen: </span>
                <span className="text-muted-foreground">{formatRelativeTime(node.last_seen_ms)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No GPU metrics available</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
