"use client";

import { useState, useEffect, useCallback } from "react";
import type { NodeStatus, NodeMetricsHistory } from "@/lib/types";
import { fetchNodes, fetchNodeMetrics } from "@/lib/api";

export function useNodes(refreshInterval = 5000) {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchNodes();
      setNodes(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch nodes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    return () => clearInterval(interval);
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
