"use client";

import { useState, useEffect, useCallback } from "react";
import type { JobModel, JobSummary } from "@/lib/types";
import { fetchJobs, fetchJobSummary } from "@/lib/api";

function pickActiveJob(jobs: JobModel[]): JobModel | null {
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === "running");
  if (running.length > 0) {
    return running.reduce((a, b) =>
      (b.updated_at_ms ?? 0) > (a.updated_at_ms ?? 0) ? b : a
    );
  }
  return jobs.reduce((a, b) =>
    (b.created_at_ms ?? 0) > (a.created_at_ms ?? 0) ? b : a
  );
}

export function useActiveJob(refreshInterval = 5000) {
  const [job, setJob] = useState<JobModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const jobs = await fetchJobs();
      if (signal?.aborted) return;
      setJob(pickActiveJob(jobs));
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch jobs");
      setLoadedOnce(true);
    }
  }, []);

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

  return { job, loading: !loadedOnce, error, refresh };
}

export function useJobSummary(jobId: string | null, refreshInterval = 2000) {
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!jobId) {
      setSummary(null);
      setLoadedOnce(true);
      return;
    }
    try {
      const data = await fetchJobSummary(jobId);
      if (signal?.aborted) return;
      setSummary(data);
      setError(null);
      setLoadedOnce(true);
    } catch (e) {
      if (signal?.aborted) return;
      setError(e instanceof Error ? e.message : "Failed to fetch job summary");
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

  return { summary, loading: !loadedOnce, error, refresh };
}
