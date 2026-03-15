"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvidenceItem } from "@/lib/types";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface EvidenceChainProps {
  evidence: EvidenceItem[];
}

export function EvidenceChain({ evidence }: EvidenceChainProps) {
  if (!evidence || evidence.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Evidence Chain</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-3">
          {evidence.map((item, i) => {
            const numVal = parseFloat(item.value);
            const isNumeric = !isNaN(numVal);
            return (
              <div key={i} className="flex items-start gap-3 border-l-2 border-border pl-4">
                <div className="mt-0.5 text-muted-foreground">
                  {isNumeric && numVal > 0 ? (
                    <TrendingUp className="h-4 w-4 text-red-400" />
                  ) : isNumeric && numVal < 0 ? (
                    <TrendingDown className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <Minus className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{item.metric}</span>
                    <span className="font-mono text-sm text-muted-foreground">{item.value}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.context}</p>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
