"use client";

import { use } from "react";
import { GpuCharts } from "@/components/nodes/gpu-charts";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useNodeMetrics } from "@/hooks/use-nodes";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = use(params);
  const { metrics, loading, error, refresh } = useNodeMetrics(nodeId, 5, 5000);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/nodes" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold font-mono">{nodeId}</h1>
        <Badge variant="outline">Auto-refresh: 5s</Badge>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={() => refresh()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : metrics ? (
        <GpuCharts metrics={metrics} />
      ) : (
        <p className="text-muted-foreground">No metrics available for this node</p>
      )}
    </div>
  );
}
