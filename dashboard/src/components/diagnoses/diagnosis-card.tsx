"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DiagnosisResult } from "@/lib/types";
import { ChevronDown, ChevronUp } from "lucide-react";

interface DiagnosisCardProps {
  diagnosis: DiagnosisResult;
}

export function DiagnosisCard({ diagnosis }: DiagnosisCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confPct = (diagnosis.confidence * 100).toFixed(0);
  const confColor = diagnosis.confidence > 0.8 ? "bg-emerald-500" : diagnosis.confidence > 0.5 ? "bg-amber-500" : "bg-red-500";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{diagnosis.root_cause}</CardTitle>
          <Badge variant="outline" className="font-mono text-xs">{diagnosis.node_id}</Badge>
        </div>
        <div className="flex items-center gap-3 mt-2">
          {/* Confidence bar */}
          <div className="flex items-center gap-2 flex-1">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", confColor)} style={{ width: `${confPct}%` }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground">{confPct}%</span>
          </div>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(diagnosis.timestamp_ms)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Reasoning (expandable) */}
        <div>
          <p className={cn("text-sm text-muted-foreground", !expanded && "line-clamp-2")}>
            {diagnosis.reasoning}
          </p>
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>

        {/* Recommended action */}
        {diagnosis.recommended_action && (
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{diagnosis.recommended_action.action}</span>
              <Badge variant={
                diagnosis.recommended_action.urgency === "immediate" ? "destructive" :
                diagnosis.recommended_action.urgency === "soon" ? "warning" : "info"
              }>
                {diagnosis.recommended_action.urgency}
              </Badge>
            </div>
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Model: {diagnosis.llm_model}</span>
          <span>Latency: {diagnosis.latency_ms}ms</span>
        </div>
      </CardContent>
    </Card>
  );
}
