"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { NodeStatus } from "@/lib/types";
import { cn, formatRelativeTime } from "@/lib/utils";

interface ClusterSummaryProps {
  nodes: NodeStatus[];
  loading: boolean;
}

export function ClusterSummary({ nodes, loading }: ClusterSummaryProps) {
  const router = useRouter();

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Cluster Nodes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Cluster Nodes</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4">Node</th>
                <th className="pb-2 pr-4">GPU Model</th>
                <th className="pb-2 pr-4">Temp</th>
                <th className="pb-2 pr-4">Utilization</th>
                <th className="pb-2 pr-4">Memory</th>
                <th className="pb-2">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => {
                const gpu = node.latest_metrics[0] ?? null;
                const memPct = gpu ? (gpu.fb_used_mb / (gpu.fb_used_mb + gpu.fb_free_mb)) * 100 : 0;
                return (
                  <tr
                    key={node.node_id}
                    className="cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/nodes/${node.node_id}`)}
                  >
                    <td className="py-2 pr-4 font-mono">{node.node_id}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{node.gpu_model || "—"}</td>
                    <td className={cn("py-2 pr-4", gpu && gpu.gpu_temp_c > 80 ? "text-red-400" : "text-foreground")}>
                      {gpu ? `${gpu.gpu_temp_c}°C` : "—"}
                    </td>
                    <td className="py-2 pr-4">{gpu ? `${gpu.gpu_utilization_pct}%` : "—"}</td>
                    <td className="py-2 pr-4">{gpu ? `${memPct.toFixed(0)}%` : "—"}</td>
                    <td className="py-2 text-muted-foreground">{formatRelativeTime(node.last_seen_ms)}</td>
                  </tr>
                );
              })}
              {nodes.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No nodes connected</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
