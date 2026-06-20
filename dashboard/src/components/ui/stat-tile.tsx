import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, unit, hint, className }: StatTileProps) {
  return (
    <Card className={cn("p-4", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
