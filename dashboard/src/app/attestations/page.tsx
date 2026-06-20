"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Toolbar } from "@/components/ui/toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Badge } from "@/components/ui/badge";
import { AttestationsTable, type Attestation } from "@/components/training/attestations-table";
import { getDemoAttestations } from "@/lib/demo-attestations";

type StatusFilter = "all" | Attestation["status"];

export default function AttestationsPage() {
  const all = useMemo(() => getDemoAttestations(), []);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [error] = useState<string | null>(null);

  const rows = useMemo(
    () => (status === "all" ? all : all.filter((a) => a.status === status)),
    [all, status],
  );

  const totalStaked = all.reduce((s, a) => s + a.staked_sol, 0);
  const slashed = all.filter((a) => a.status === "slashed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attestations"
        eyebrow="On-chain"
        subtitle="Each diagnosis is hashed, signed, and committed to Solana. Validators stake SOL on cluster health; false attestations are slashed."
        badge={<Badge variant="outline" className="font-mono text-[10px]">devnet · sample</Badge>}
        meta={[
          { children: `${all.length} attestations` },
          { children: `◎ ${totalStaked.toFixed(1)} staked` },
          { tone: slashed > 0 ? "crit" : "ok", children: `${slashed} slashed` },
        ]}
      />

      <div className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
        Showing sample data - the backend has no attestation endpoint yet. These rows demonstrate the on-chain trust layer.
      </div>

      {error && <ErrorBanner message={error} />}

      <Toolbar>
        <SegmentedControl<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All" },
            { value: "confirmed", label: "Confirmed" },
            { value: "pending", label: "Pending" },
            { value: "slashed", label: "Slashed" },
          ]}
        />
      </Toolbar>

      <AttestationsTable attestations={rows} loading={false} />
    </div>
  );
}
