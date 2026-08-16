// NEW: dashboard/src/app/training/page.tsx
// Wires <RunPanel> to live nodes. The "active run" is the first node with a
// latest_training or latest_diloco — pick a different selector when you have
// a real /api/v1/training/runs endpoint.

"use client";

import { useEffect, useState, useMemo } from "react";
import { RunPanel } from "@/components/training/run-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useNodes } from "@/hooks/use-nodes";

export default function TrainingPage() {
  const { nodes, loading } = useNodes();

  // Pick the first node currently reporting training metrics.
  const active = useMemo(
    () => nodes.find((n) => n.latest_training || n.latest_diloco) ?? null,
    [nodes]
  );

  // Rolling histories — pushed each poll cycle for sparklines.
  const [history, setHistory] = useState<{ loss: number[]; throughput: number[]; mfu: number[]; gradNorm: number[] }>({
    loss: [], throughput: [], mfu: [], gradNorm: [],
  });

  useEffect(() => {
    if (!active) return;
    const t = active.latest_training;
    const d = active.latest_diloco;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- rolling sparkline accumulator from poll events
    setHistory((h) => ({
      loss: [...h.loss, t?.loss ?? d?.outer_loss ?? 0].slice(-30),
      throughput: [...h.throughput, t?.throughput_tps ?? 0].slice(-30),
      mfu: [...h.mfu, t?.mfu_pct ?? 0].slice(-30),
      gradNorm: [...h.gradNorm, t?.gradient_norm ?? d?.pseudo_grad_norm ?? 0].slice(-30),
    }));
  }, [active]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Training</h1>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Training</h1>
      </div>

      <RunPanel
        training={active?.latest_training ?? null}
        diloco={active?.latest_diloco ?? null}
        history={history}
      />
    </div>
  );
}
