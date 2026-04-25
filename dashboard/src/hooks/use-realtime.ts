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
  const { onAlert, onMetricSummary, onDiagnosis } = handlers;

  useEffect(() => {
    return subscribe((msg) => {
      switch (msg.type) {
        case "alert":
          onAlert?.(msg);
          break;
        case "metric_summary":
          onMetricSummary?.(msg);
          break;
        case "diagnosis":
          onDiagnosis?.(msg);
          break;
      }
    });
  }, [subscribe, onAlert, onMetricSummary, onDiagnosis]);
}
