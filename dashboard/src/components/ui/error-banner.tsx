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

export function ErrorBanner({ title = "Something went wrong", message, onRetry, className }: ErrorBannerProps) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3", className)}>
      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-red-400">{title}</div>
        <div className="text-xs text-red-400/80">{message}</div>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}
