"use client";

import { use } from "react";
import { GpuCharts } from "@/components/nodes/gpu-charts";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { useNodeMetrics } from "@/hooks/use-nodes";
import { ArrowLeft, Activity } from "lucide-react";
import Link from "next/link";

export default function NodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = use(params);
  const { metrics, loading, error, refresh } = useNodeMetrics(nodeId, 5, 5000);

  return (
    <div className="space-y-6">
      <Link href="/nodes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Nodes
      </Link>
      <PageHeader
        title={<span className="font-mono">{nodeId}</span>}
        eyebrow="Monitoring / Nodes"
        subtitle="Live GPU, training, and DiLoCo telemetry for this node."
        actions={<Badge variant="outline">Auto-refresh: 5s</Badge>}
      />

      {error && <ErrorBanner title="Could not load node metrics" message={error} onRetry={refresh} />}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
        </div>
      ) : metrics ? (
        <GpuCharts metrics={metrics} />
      ) : (
        <EmptyState icon={Activity} title="No metrics yet" description="This node has not reported telemetry samples." />
      )}
    </div>
  );
}
