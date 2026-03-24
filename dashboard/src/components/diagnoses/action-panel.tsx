"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { RecommendedAction } from "@/lib/types";

interface ActionPanelProps {
  action: RecommendedAction;
}

export function ActionPanel({ action }: ActionPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Recommended Action</CardTitle>
          <Badge variant={
            action.urgency === "immediate" ? "destructive" :
            action.urgency === "soon" ? "warning" : "info"
          }>
            {action.urgency}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{action.action}</p>

        {Object.keys(action.params).length > 0 && (
          <div className="rounded-md border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Parameters</p>
            <dl className="space-y-1 text-sm">
              {Object.entries(action.params).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-mono">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
