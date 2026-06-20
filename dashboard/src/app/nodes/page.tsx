"use client";

import { useMemo, useState } from "react";
import { NodeCard } from "@/components/nodes/node-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Toolbar, ToolbarSearch } from "@/components/ui/toolbar";
import { useNodes } from "@/hooks/use-nodes";
import { nodeTone } from "@/lib/derive";
import { RefreshCw, Server } from "lucide-react";

type StatusFilter = "all" | "healthy" | "degraded";

export default function NodesPage() {
  const { nodes, loading, error, refresh } = useNodes();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    let next = nodes;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      next = next.filter((n) => n.node_id.toLowerCase().includes(q) || n.gpu_model.toLowerCase().includes(q));
    }
    if (status !== "all") {
      next = next.filter((n) => (status === "healthy" ? nodeTone(n) === "ok" : nodeTone(n) !== "ok"));
    }
    return next;
  }, [nodes, query, status]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nodes"
        eyebrow="Monitoring"
        subtitle="GPU nodes reporting through the sidecar. Select a node to inspect live metrics."
        badge={<span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ok)]/30 bg-[var(--ok-soft)] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[var(--ok)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" />{nodes.length} live</span>}
      />

      {error ? (
        <ErrorBanner title="Could not load nodes" message={error} onRetry={refresh} />
      ) : (
        <Toolbar>
          <SegmentedControl<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: "All" },
              { value: "healthy", label: "Healthy" },
              { value: "degraded", label: "Degraded" },
            ]}
          />
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Search node id, GPU model..." />
          <Button variant="outline" size="sm" onClick={() => refresh()} className="ml-auto">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </Toolbar>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title={nodes.length === 0 ? "No nodes connected" : "No nodes match your filters"}
          description={nodes.length === 0 ? "Start a sidecar to stream metrics." : "Clear the search or status filter."}
          action={nodes.length === 0 ? <code className="rounded-md border bg-muted px-2 py-1 font-mono text-xs text-primary">make demo</code> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((node) => (
            <NodeCard key={node.node_id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}
