"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-lg border bg-surface-2 p-0.5", className)} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className={cn("font-mono text-[10px] tabular-nums", active ? "opacity-70" : "opacity-50")}>
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
