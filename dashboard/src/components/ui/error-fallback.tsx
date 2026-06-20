"use client";

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export function ErrorFallback({ reset }: { reset?: () => void }) {
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md border border-[var(--crit)]/30 bg-[var(--crit-soft)] text-[var(--crit)]">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold">This view could not load</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The dashboard hit an unexpected client-side issue. Retry the view or refresh the dashboard.
        </p>
        {reset && (
          <Button onClick={reset} className="mt-5">
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
