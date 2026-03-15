"use client";

import { useEffect } from "react";
import type { WebSocketMessage } from "@/lib/types";

export function useRealtime(
  subscribe: (fn: (msg: WebSocketMessage) => void) => () => void,
  handlers: {
    onAlert?: (msg: Extract<WebSocketMessage, { type: "alert" }>) => void;
    onMetricSummary?: (msg: Extract<WebSocketMessage, { type: "metric_summary" }>) => void;
    onDiagnosis?: (msg: Extract<WebSocketMessage, { type: "diagnosis" }>) => void;
  }
) {
  useEffect(() => {
    return subscribe((msg) => {
      switch (msg.type) {
        case "alert":
          handlers.onAlert?.(msg);
          break;
        case "metric_summary":
          handlers.onMetricSummary?.(msg);
          break;
        case "diagnosis":
          handlers.onDiagnosis?.(msg);
          break;
      }
    });
  }, [subscribe, handlers.onAlert, handlers.onMetricSummary, handlers.onDiagnosis]);
}
