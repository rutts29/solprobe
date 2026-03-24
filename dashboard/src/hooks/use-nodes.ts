"use client";

import { useState, useEffect, useCallback } from "react";
import type { NodeStatus, NodeMetricsHistory } from "@/lib/types";
import { fetchNodes, fetchNodeMetrics } from "@/lib/api";

export function useNodes(refreshInterval = 5000) {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const data = await fetchNodes();
      if (signal?.aborted) return;
      setNodes(data);
      setError(null);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch nodes");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    const interval = setInterval(() => refresh(controller.signal), refreshInterval);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh, refreshInterval]);

  return { nodes, loading, error, refresh };
}

export function useNodeMetrics(nodeId: string, windowMinutes = 5, refreshInterval = 5000) {
  const [metrics, setMetrics] = useState<NodeMetricsHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchNodeMetrics(nodeId, windowMinutes);
      setMetrics(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch metrics");
    } finally {
      setLoading(false);
    }
  }, [nodeId, windowMinutes]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
  }, [refresh, refreshInterval]);

  return { metrics, loading, error, refresh };
}
