"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import { memPct, nodeTone, tempTone } from "@/lib/derive";
import type { NodeStatus } from "@/lib/types";

interface ClusterSummaryProps {
  nodes: NodeStatus[];
  loading: boolean;
}

const TONE_DOT: Record<string, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-500",
  muted: "bg-zinc-500",
};

function Bar({ value, tone = "ok" }: { value: number; tone?: "ok" | "warn" | "crit" }) {
  const fill = tone === "crit" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", fill)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-muted-foreground w-9 text-right">{value.toFixed(0)}%</span>
    </div>
  );
}

export function ClusterSummary({ nodes, loading }: ClusterSummaryProps) {
  const router = useRouter();
  const [issuesOnly, setIssuesOnly] = useState(false);

  const visible = useMemo(
    () => issuesOnly ? nodes.filter((n) => nodeTone(n) !== "ok") : nodes,
    [nodes, issuesOnly]
  );

  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Cluster Nodes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Cluster Nodes</CardTitle>
        <div className="flex items-center gap-1 rounded-md border bg-background p-0.5 text-xs">
          <button
            onClick={() => setIssuesOnly(false)}
            className={cn("px-2 py-1 rounded transition-colors", !issuesOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            All ({nodes.length})
          </button>
          <button
            onClick={() => setIssuesOnly(true)}
            className={cn("px-2 py-1 rounded transition-colors", issuesOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            Issues ({nodes.filter((n) => nodeTone(n) !== "ok").length})
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Node</th>
                <th className="pb-2 pr-4 font-medium">GPU</th>
                <th className="pb-2 pr-4 font-medium">Util</th>
                <th className="pb-2 pr-4 font-medium">Memory</th>
                <th className="pb-2 pr-4 font-medium">Temp</th>
                <th className="pb-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((node) => {
                const gpu = node.latest_metrics[0] ?? null;
                const tone = nodeTone(node);
                const tTone = gpu ? tempTone(gpu.gpu_temp_c) : "muted";
                return (
                  <tr
                    key={node.node_id}
                    className="cursor-pointer border-b border-border/50 transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/nodes/${node.node_id}`)}
                  >
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone], tone === "ok" && "pulse-dot")} />
                        <span className="font-mono text-xs">{node.node_id}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground">{node.gpu_model || "—"} ×{node.gpu_count}</td>
                    <td className="py-2.5 pr-4">{gpu ? <Bar value={gpu.gpu_utilization_pct} /> : "—"}</td>
                    <td className="py-2.5 pr-4">{gpu ? <Bar value={memPct(gpu)} tone={memPct(gpu) > 90 ? "warn" : "ok"} /> : "—"}</td>
                    <td className="py-2.5 pr-4">
                      {gpu ? (
                        <span className={cn(
                          "font-mono tabular-nums text-xs",
                          tTone === "crit" && "text-red-500 dark:text-red-400",
                          tTone === "warn" && "text-amber-500 dark:text-amber-400",
                          tTone === "ok" && "text-foreground",
                        )}>
                          {gpu.gpu_temp_c}°C
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{formatRelativeTime(node.last_seen_ms)}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">{issuesOnly ? "No nodes with issues" : "No nodes connected"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
