"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface ErrorBannerProps {
  title?: string;
  message: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function ErrorBanner({ title = "Request failed", message, onRetry, className }: ErrorBannerProps) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3", className)}>
      <AlertCircle className="h-4 w-4 shrink-0 text-[var(--crit)]" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--crit)]">{title}</div>
        <div className="text-xs text-[var(--crit)]/80">{message}</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-[var(--crit)]/30 bg-[var(--crit-soft)] px-2.5 py-1 text-xs font-medium text-[var(--crit)] hover:bg-[var(--crit-soft)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
