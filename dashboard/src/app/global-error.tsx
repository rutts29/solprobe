"use client";

import { useEffect } from "react";
import { ErrorFallback } from "@/components/ui/error-fallback";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error("[GlobalErrorBoundary] App render failed:", error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark" className="dark">
      <body>
        <ErrorFallback reset={reset} />
      </body>
    </html>
  );
}
