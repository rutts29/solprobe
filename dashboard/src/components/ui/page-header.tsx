import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface PageMetaChip {
  key?: string;
  tone?: "ok" | "warn" | "crit" | "info" | "muted";
  children: ReactNode;
}

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  meta?: PageMetaChip[];
  actions?: ReactNode;
  className?: string;
}

const TONE_DOT: Record<NonNullable<PageMetaChip["tone"]>, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  crit: "bg-red-500",
  info: "bg-blue-500",
  muted: "bg-zinc-500",
};

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  badge,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 md:flex-row md:items-start md:justify-between", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">{eyebrow}</div>
        )}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {meta.map((m, i) => (
              <span
                key={m.key ?? i}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card/60 px-2 py-1 text-xs text-muted-foreground"
              >
                {m.tone && <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[m.tone])} />}
                {m.children}
              </span>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
