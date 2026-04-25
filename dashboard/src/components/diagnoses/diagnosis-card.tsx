"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DiagnosisResult } from "@/lib/types";
import { ChevronDown, ChevronUp, Brain, ArrowRight } from "lucide-react";

interface DiagnosisCardProps {
  diagnosis: DiagnosisResult;
  onApply?: (d: DiagnosisResult) => void;
  onDefer?: (d: DiagnosisResult) => void;
}

export function DiagnosisCard({ diagnosis, onApply, onDefer }: DiagnosisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confPct = (diagnosis.confidence * 100).toFixed(0);
  const confColor =
    diagnosis.confidence > 0.8 ? "bg-emerald-500" :
    diagnosis.confidence > 0.5 ? "bg-amber-500" : "bg-red-500";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary">
              <Brain className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">{diagnosis.root_cause}</CardTitle>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="font-mono text-[10px]">{diagnosis.node_id}</Badge>
                <span>{diagnosis.alert_type}</span>
                <span>·</span>
                <span>{formatRelativeTime(diagnosis.timestamp_ms)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex w-28 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-all", confColor)} style={{ width: `${confPct}%` }} />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{confPct}%</span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <p className={cn("text-sm text-muted-foreground", !expanded && "line-clamp-2")}>
            {diagnosis.reasoning}
          </p>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : "Show evidence chain"}
          </button>
        </div>

        {expanded && diagnosis.evidence_chain.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence chain</div>
            <table className="w-full text-xs">
              <tbody>
                {diagnosis.evidence_chain.map((ev, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{ev.metric}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums text-muted-foreground">{ev.value}</td>
                    <td className="py-1.5 text-muted-foreground">{ev.context}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {diagnosis.recommended_action && (
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate text-sm font-medium">{diagnosis.recommended_action.action}</span>
              </div>
              <Badge variant={
                diagnosis.recommended_action.urgency === "immediate" ? "destructive" :
                diagnosis.recommended_action.urgency === "soon" ? "warning" : "info"
              }>
                {diagnosis.recommended_action.urgency}
              </Badge>
            </div>
            {(onApply || onDefer) && (
              <div className="mt-3 flex items-center gap-2">
                {onApply && (
                  <button
                    onClick={() => onApply(diagnosis)}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    Apply
                  </button>
                )}
                {onDefer && (
                  <button
                    onClick={() => onDefer(diagnosis)}
                    className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent"
                  >
                    Defer
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>Model: <span className="font-mono">{diagnosis.llm_model}</span></span>
          <span>Latency: <span className="font-mono tabular-nums">{diagnosis.latency_ms}ms</span></span>
          {diagnosis.similar_incidents?.length > 0 && (
            <span>{diagnosis.similar_incidents.length} similar</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
