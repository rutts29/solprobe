"use client";

import { useState, useEffect, useCallback } from "react";
import type { AlertLifecycle, AlertModel, DiagnosisResult } from "@/lib/types";
import { fetchAlerts, fetchDiagnoses } from "@/lib/api";

export function useAlerts(params?: { severity?: string; node_id?: string; limit?: number }) {
  const [alerts, setAlerts] = useState<AlertModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const severity = params?.severity;
  const nodeId = params?.node_id;
  const limit = params?.limit;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlerts({ severity, node_id: nodeId, limit });
      setAlerts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch alerts");
    } finally {
      setLoading(false);
    }
  }, [severity, nodeId, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const prepend = useCallback((alert: AlertModel) => {
    setAlerts((prev) => [alert, ...prev]);
  }, []);

  const updateLifecycle = useCallback((alertId: string, lifecycle: AlertLifecycle) => {
    setAlerts((prev) =>
      prev.map((a) => (a.alert_id === alertId ? { ...a, lifecycle } : a)),
    );
  }, []);

  return { alerts, loading, error, refresh, prepend, updateLifecycle };
}

export function useDiagnoses(params?: { node_id?: string; root_cause?: string; limit?: number }) {
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const nodeId = params?.node_id;
  const rootCause = params?.root_cause;
  const limit = params?.limit;

  const refresh = useCallback(async () => {
    try {
      const data = await fetchDiagnoses({ node_id: nodeId, root_cause: rootCause, limit });
      setDiagnoses(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diagnoses");
    } finally {
      setLoading(false);
    }
  }, [nodeId, rootCause, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const append = useCallback((diagnosis: DiagnosisResult) => {
    setDiagnoses((prev) => [diagnosis, ...prev]);
  }, []);

  return { diagnoses, loading, error, refresh, append };
}
