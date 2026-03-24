"use client";

import { useState, useEffect, useCallback } from "react";
import type { AlertModel, DiagnosisResult } from "@/lib/types";
import { fetchAlerts, fetchDiagnoses } from "@/lib/api";

export function useAlerts(params?: { severity?: string; node_id?: string; limit?: number }) {
  const [alerts, setAlerts] = useState<AlertModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAlerts(params);
      setAlerts(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch alerts");
    } finally {
      setLoading(false);
    }
  }, [params?.severity, params?.node_id, params?.limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const prepend = useCallback((alert: AlertModel) => {
    setAlerts((prev) => [alert, ...prev]);
  }, []);

  return { alerts, loading, error, refresh, prepend };
}

export function useDiagnoses(params?: { node_id?: string; root_cause?: string; limit?: number }) {
  const [diagnoses, setDiagnoses] = useState<DiagnosisResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchDiagnoses(params);
      setDiagnoses(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch diagnoses");
    } finally {
      setLoading(false);
    }
  }, [params?.node_id, params?.root_cause, params?.limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const append = useCallback((diagnosis: DiagnosisResult) => {
    setDiagnoses((prev) => [diagnosis, ...prev]);
  }, []);

  return { diagnoses, loading, error, refresh, append };
}
