"use client";

import { NodeCard } from "@/components/nodes/node-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useNodes } from "@/hooks/use-nodes";

export default function NodesPage() {
  const { nodes, loading, error, refresh } = useNodes();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nodes</h1>
        <button
          onClick={refresh}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={refresh} className="ml-2 underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {nodes.map((node) => (
            <NodeCard key={node.node_id} node={node} />
          ))}
          {nodes.length === 0 && (
            <p className="col-span-full text-center text-muted-foreground py-12">No nodes connected</p>
          )}
        </div>
      )}
    </div>
  );
}
