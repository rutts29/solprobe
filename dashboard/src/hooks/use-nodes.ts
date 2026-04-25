"use client";

import { useState, useEffect, useCallback } from "react";
import type { NodeStatus, NodeMetricsHistory } from "@/lib/types";
import { fetchNodes, fetchNodeMetrics } from "@/lib/api";

/**
 * Stale-while-revalidate: `loading` is true ONLY until the first fetch
 * succeeds or errors. Subsequent background polls update `nodes` in place
 * without flipping loading=true, so consumers never unmount their children
 * mid-refresh (which was resetting Tabs state in GpuCharts). `loadedOnce`
 * is useState (not useRef) so reads are pure under Next 16's react-hooks/purity.
 */
export function useNodes(refreshInterval = 5000) {
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchNodes();
      if (signal?.aborted) return;
      setNodes(data);
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch nodes");
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount SWR pattern; setState happens asynchronously after await
    refresh(controller.signal);
    const interval = setInterval(() => refresh(controller.signal), refreshInterval);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh, refreshInterval]);

  const loading = !loadedOnce;
  return { nodes, loading, error, refresh };
}

export function useNodeMetrics(nodeId: string, windowMinutes = 5, refreshInterval = 5000) {
  const [metrics, setMetrics] = useState<NodeMetricsHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await fetchNodeMetrics(nodeId, windowMinutes);
      if (signal?.aborted) return;
      setMetrics(data);
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch metrics");
      setLoadedOnce(true);
    }
  }, [nodeId, windowMinutes]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount SWR pattern; setState happens asynchronously after await
    refresh(controller.signal);
    const interval = setInterval(() => refresh(controller.signal), refreshInterval);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh, refreshInterval]);

  const loading = !loadedOnce;
  return { metrics, loading, error, refresh };
}
