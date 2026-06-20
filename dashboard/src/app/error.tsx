"use client";
import { useEffect } from "react";
import { ErrorFallback } from "@/components/ui/error-fallback";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("[ErrorBoundary] Client render failed:", error);
  }, [error]);

  return <ErrorFallback reset={reset} />;
}
