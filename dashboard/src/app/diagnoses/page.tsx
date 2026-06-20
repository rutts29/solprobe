"use client";

import { useState, useCallback, useMemo } from "react";
import { DiagnosisCard } from "@/components/diagnoses/diagnosis-card";
import { EvidenceChain } from "@/components/diagnoses/evidence-chain";
import { ActionPanel } from "@/components/diagnoses/action-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Toolbar } from "@/components/ui/toolbar";
import { useDiagnoses } from "@/hooks/use-alerts";
import { useWebSocket } from "@/lib/websocket";
import { useRealtime } from "@/hooks/use-realtime";
import { Brain } from "lucide-react";
import type { DiagnosisResult } from "@/lib/types";

export default function DiagnosesPage() {
  const [nodeFilter, setNodeFilter] = useState("");
  const { diagnoses, loading, error, refresh, append } = useDiagnoses({
    node_id: nodeFilter || undefined,
    limit: 50,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ws = useWebSocket();

  const onDiagnosis = useCallback(
    (msg: { type: "diagnosis"; data: DiagnosisResult }) => append(msg.data),
    [append]
  );

  useRealtime(ws.subscribe, { onDiagnosis });

  // Extract unique node IDs for filter
  const nodeIds = useMemo(() => [...new Set(diagnoses.map((d) => d.node_id))], [diagnoses]);
  const selected = useMemo(
    () => diagnoses.find((diagnosis) => diagnosis.diagnosis_id === selectedId) ?? null,
    [diagnoses, selectedId],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnoses"
        eyebrow="Monitoring"
        subtitle="LLM-grounded root-cause analyses with evidence chains and recommended actions."
      />

      {error && <ErrorBanner title="Couldn't load diagnoses" message={error} onRetry={refresh} />}

      <Toolbar>
        <SegmentedControl<string>
          value={nodeFilter}
          onChange={(v) => { setNodeFilter(v); setSelectedId(null); }}
          options={[
            { value: "", label: "All nodes" },
            ...nodeIds.map((id) => ({ value: id, label: id })),
          ]}
        />
      </Toolbar>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Diagnosis list */}
        <div className="space-y-4 lg:col-span-2">
          {loading ? (
            [...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
          ) : diagnoses.length === 0 ? (
            <EmptyState icon={Brain} title="No diagnoses yet" description="Diagnoses appear here after alerts are sent to the LLM agent." />
          ) : (
            diagnoses.map((d) => (
              <div key={d.diagnosis_id} onClick={() => setSelectedId(d.diagnosis_id)} className="cursor-pointer">
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
            <EmptyState title="Select a diagnosis" description="Evidence and recovery actions will appear here." className="py-10" />
          )}
        </div>
      </div>
    </div>
  );
}
