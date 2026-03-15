"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import type { WebSocketMessage, AlertModel, NodeStatus, DiagnosisResult } from "./types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/stream";
const MAX_RECONNECT_DELAY = 30000;

interface WebSocketState {
  connected: boolean;
  lastAlert: AlertModel | null;
  nodeStatuses: Record<string, NodeStatus>;
  lastDiagnosis: DiagnosisResult | null;
  alertCount: number;
}

interface WebSocketContextValue extends WebSocketState {
  subscribe: (listener: (msg: WebSocketMessage) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const value = useWebSocketInternal();
  return (
    <WebSocketContext value={value}>
      {children}
    </WebSocketContext>
  );
}

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within <WebSocketProvider>");
  return ctx;
}

function useWebSocketInternal(): WebSocketContextValue {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastAlert: null,
    nodeStatuses: {},
    lastDiagnosis: null,
    alertCount: 0,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listenersRef = useRef<Set<(msg: WebSocketMessage) => void>>(new Set());

  const subscribe = useCallback((listener: (msg: WebSocketMessage) => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  useEffect(() => {
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setState((s) => ({ ...s, connected: true }));
        reconnectDelay.current = 1000;
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!unmounted) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_RECONNECT_DELAY);
            connect();
          }, reconnectDelay.current);
        }
      };

      ws.onerror = (event) => {
        console.error("[WebSocket] error:", event);
        ws.close();
      };

      ws.onmessage = (event) => {
        let msg: WebSocketMessage;
        try {
          msg = JSON.parse(event.data);
        } catch (parseError) {
          console.error("[WebSocket] failed to parse message:", parseError);
          return;
        }

        // Notify subscribers with per-subscriber error isolation
        listenersRef.current.forEach((fn) => {
          try {
            fn(msg);
          } catch (subscriberError) {
            console.error("[WebSocket] subscriber error:", subscriberError);
          }
        });

        // Update internal state
        switch (msg.type) {
          case "alert":
            setState((s) => ({
              ...s,
              lastAlert: msg.data,
              alertCount: s.alertCount + 1,
            }));
            break;
          case "metric_summary":
            setState((s) => ({
              ...s,
              nodeStatuses: {
                ...s.nodeStatuses,
                [msg.data.node_id]: msg.data,
              },
            }));
            break;
          case "diagnosis":
            setState((s) => ({ ...s, lastDiagnosis: msg.data }));
            break;
        }
      };
    }

    connect();
    return () => {
      unmounted = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  return { ...state, subscribe };
}
