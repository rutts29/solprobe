import type {
  HealthStatus,
  NodeStatus,
  NodeMetricsHistory,
  AlertModel,
  EnrichedAlert,
  DiagnosisResult,
  JobModel,
  JobSummary,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export function fetchHealth(): Promise<HealthStatus> {
  return apiFetch("/api/v1/health");
}

export function fetchNodes(): Promise<NodeStatus[]> {
  return apiFetch("/api/v1/nodes");
}

export function fetchNodeMetrics(nodeId: string, windowMinutes = 5): Promise<NodeMetricsHistory> {
  return apiFetch(`/api/v1/nodes/${nodeId}/metrics?window_minutes=${windowMinutes}`);
}

export function fetchAlerts(params?: {
  severity?: string;
  node_id?: string;
  limit?: number;
}): Promise<AlertModel[]> {
  const search = new URLSearchParams();
  if (params?.severity) search.set("severity", params.severity);
  if (params?.node_id) search.set("node_id", params.node_id);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch(`/api/v1/alerts${qs ? `?${qs}` : ""}`);
}

export function fetchEnrichedAlert(alertId: string): Promise<EnrichedAlert> {
  return apiFetch(`/api/v1/alerts/${alertId}/enriched`);
}

export function fetchDiagnoses(params?: {
  node_id?: string;
  root_cause?: string;
  limit?: number;
}): Promise<DiagnosisResult[]> {
  const search = new URLSearchParams();
  if (params?.node_id) search.set("node_id", params.node_id);
  if (params?.root_cause) search.set("root_cause", params.root_cause);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch(`/api/v1/diagnoses${qs ? `?${qs}` : ""}`);
}

export function fetchDiagnosis(id: string): Promise<DiagnosisResult> {
  return apiFetch(`/api/v1/diagnoses/${id}`);
}

export function requestDiagnosis(alertId: string): Promise<DiagnosisResult> {
  return apiFetch("/api/v1/diagnoses", {
    method: "POST",
    body: JSON.stringify({ alert_id: alertId }),
  });
}

export function fetchAlertDiagnosis(alertId: string): Promise<DiagnosisResult> {
  return apiFetch(`/api/v1/alerts/${alertId}/diagnosis`);
}

export function fetchJobs(): Promise<JobModel[]> {
  return apiFetch("/api/v1/jobs");
}

export function fetchJobSummary(jobId: string): Promise<JobSummary> {
  return apiFetch(`/api/v1/jobs/${jobId}/summary`);
}

