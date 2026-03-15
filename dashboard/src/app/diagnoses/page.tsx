"use client";

import { useState, useCallback } from "react";
import { DiagnosisCard } from "@/components/diagnoses/diagnosis-card";
import { EvidenceChain } from "@/components/diagnoses/evidence-chain";
import { ActionPanel } from "@/components/diagnoses/action-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiagnoses } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import type { DiagnosisResult } from "@/lib/types";

export default function DiagnosesPage() {
  const [nodeFilter, setNodeFilter] = useState("");
  const { diagnoses, loading, error, refresh, append } = useDiagnoses({
    node_id: nodeFilter || undefined,
    limit: 50,
  });
  const [selected, setSelected] = useState<DiagnosisResult | null>(null);
  const ws = useWebSocket();

  const onDiagnosis = useCallback(
    (msg: { type: "diagnosis"; data: DiagnosisResult }) => append(msg.data),
    [append]
  );

  useRealtime(ws.subscribe, { onDiagnosis });

  // Extract unique node IDs for filter
  const nodeIds = [...new Set(diagnoses.map((d) => d.node_id))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Diagnoses</h1>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          <button onClick={refresh} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        <select
          value={nodeFilter}
          onChange={(e) => setNodeFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm"
        >
          <option value="">All Nodes</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Diagnosis list */}
        <div className="space-y-4 lg:col-span-2">
          {loading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
          ) : diagnoses.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">No diagnoses yet</p>
          ) : (
            diagnoses.map((d) => (
              <div key={d.diagnosis_id} onClick={() => setSelected(d)} className="cursor-pointer">
                <DiagnosisCard diagnosis={d} />
              </div>
            ))
          )}
        </div>

        {/* Detail sidebar */}
        <div className="space-y-4">
          {selected ? (
            <>
              <EvidenceChain evidence={selected.evidence_chain} />
              {selected.recommended_action && (
                <ActionPanel action={selected.recommended_action} />
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a diagnosis to view details</p>
          )}
        </div>
      </div>
    </div>
  );
}
