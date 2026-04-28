"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomMetric } from "@/lib/types";
import { fetchCustomMetrics } from "@/lib/api";

export function useCustomMetrics(jobId: string | null, refreshInterval = 5000) {
  const [metrics, setMetrics] = useState<CustomMetric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!jobId) {
      setMetrics([]);
      setLoadedOnce(true);
      return;
    }
    try {
      const data = await fetchCustomMetrics({ job_id: jobId, limit: 1000 });
      if (signal?.aborted) return;
      setMetrics(data);
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch custom metrics");
      setLoadedOnce(true);
    }
  }, [jobId]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount SWR pattern
    refresh(controller.signal);
    const interval = setInterval(() => refresh(controller.signal), refreshInterval);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh, refreshInterval]);

  return { metrics, loading: !loadedOnce, error, refresh };
}
