"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

/**
 * On-chain attestation row. The shape is intentionally permissive — the
 * blockchain layer isn't in `lib/types.ts` yet, so plug your real type in
 * once the API is defined.
 */
export interface Attestation {
  signature: string;
  node_id: string;
  outer_step: number;
  job_id: string;
  staked_sol: number;
  status: "confirmed" | "pending" | "slashed";
  slot: number;
  timestamp_ms: number;
  validator: string;
}

interface AttestationsTableProps {
  attestations: Attestation[];
  loading?: boolean;
  /** Optional Solana explorer URL builder. Defaults to mainnet explorer. */
  explorerUrl?: (sig: string) => string;
}

const STATUS_VARIANT: Record<Attestation["status"], "success" | "warning" | "destructive"> = {
  confirmed: "success",
  pending: "warning",
  slashed: "destructive",
};

const defaultExplorer = (sig: string) => `https://explorer.solana.com/tx/${sig}`;

export function AttestationsTable({ attestations, loading, explorerUrl = defaultExplorer }: AttestationsTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Attestations</CardTitle>
        <span className="text-xs text-muted-foreground">{attestations.length} on-chain</span>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Signature</th>
                <th className="pb-2 pr-4 font-medium">Node</th>
                <th className="pb-2 pr-4 font-medium">Step</th>
                <th className="pb-2 pr-4 font-medium">Stake</th>
                <th className="pb-2 pr-4 font-medium">Slot</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && attestations.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No attestations</td></tr>
              )}
              {attestations.map((a) => (
                <tr key={a.signature} className={cn(
                  "border-b border-border/50 transition-colors hover:bg-accent/50",
                  a.status === "slashed" && "bg-red-500/5",
                )}>
                  <td className="py-2.5 pr-4">
                    <a
                      href={explorerUrl(a.signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                    >
                      {a.signature.slice(0, 8)}…{a.signature.slice(-4)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs">{a.node_id}</td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-xs">{a.outer_step}</td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-xs">◎ {a.staked_sol.toFixed(2)}</td>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-xs text-muted-foreground">{a.slot.toLocaleString()}</td>
                  <td className="py-2.5 pr-4">
                    <Badge variant={STATUS_VARIANT[a.status]} className="text-[10px]">{a.status}</Badge>
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground">{formatRelativeTime(a.timestamp_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
