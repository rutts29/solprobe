// NEW: dashboard/src/app/attestations/page.tsx
// Stub page wired to a fetcher. Replace `mockAttestations` with a real API call
// once your on-chain endpoint ships (e.g. fetchAttestations() from lib/api.ts).

"use client";

import { useState, useEffect } from "react";
import { AttestationsTable, type Attestation } from "@/components/training/attestations-table";

// TODO: replace with real fetcher once the on-chain API ships.
async function fetchAttestations(): Promise<Attestation[]> {
  return [];
}

export default function AttestationsPage() {
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAttestations()
      .then((data) => { if (!cancelled) setAttestations(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to fetch attestations"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Attestations</h1>
        <span className="text-xs text-muted-foreground font-mono">mainnet-beta</span>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <AttestationsTable attestations={attestations} loading={loading} />
    </div>
  );
}
