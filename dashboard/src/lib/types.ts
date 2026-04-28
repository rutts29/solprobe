export interface GpuMetrics {
  node_id: string;
  gpu_index: number;
  gpu_model: string;
  timestamp_ms: number;
  gpu_temp_c: number;
  gpu_utilization_pct: number;
  fb_used_mb: number;
  fb_free_mb: number;
  power_usage_w: number;
  xid_errors: number;
  ecc_sbe_count: number;
  ecc_dbe_count: number;
  clock_throttle_reasons: number;
  sm_active_pct: number;
  tensor_active_pct: number;
  memory_temp_c?: number;
  mem_copy_utilization_pct?: number;
  pcie_replay_counter?: number;
  pcie_tx_bytes_per_sec?: number;
  pcie_rx_bytes_per_sec?: number;
  retired_pages_sbe?: number;
  retired_pages_dbe?: number;
  remapped_rows_correctable?: number;
  remapped_rows_uncorrectable?: number;
  row_remap_failure?: boolean;
}

export interface TrainingMetrics {
  node_id: string;
  job_id: string;
  timestamp_ms: number;
  step: number;
  loss: number;
  gradient_norm: number;
  learning_rate: number;
  throughput_tps: number;
  mfu_pct: number;
}

export interface DiLoCoMetrics {
  node_id: string;
  job_id: string;
  timestamp_ms: number;
  inner_step: number;
  outer_step: number;
  inner_loss: number;
  outer_loss: number;
  pseudo_grad_norm: number;
  sync_duration_ms: number;
  worker_speed_ratio: number;
  is_straggler: boolean;
}

export type AlertLifecycleState =
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "ignored";

export interface AlertLifecycleNote {
  text: string;
  author: string | null;
  timestamp_ms: number;
}

export interface AlertLifecycle {
  state: AlertLifecycleState | null;
  notes: AlertLifecycleNote[];
}

export interface AlertModel {
  alert_id: string;
  node_id: string;
  timestamp_ms: number;
  severity: "INFO" | "WARNING" | "CRITICAL";
  source: "EDGE" | "CENTRAL";
  alert_type: string;
  description: string;
  confidence: number;
  evidence: Record<string, unknown>;
  gpu_index?: number;
  job_id?: string;
  lifecycle?: AlertLifecycle | null;
}

export interface EvidenceItem {
  metric: string;
  value: string;
  context: string;
}

export interface RecommendedAction {
  action: string;
  params: Record<string, unknown>;
  urgency: "immediate" | "soon" | "monitor";
}

export interface SimilarIncident {
  diagnosis_id: string;
  root_cause: string;
  similarity: number;
}

export interface DiagnosisResult {
  diagnosis_id: string;
  alert_id: string;
  alert_type: string;
  node_id: string;
  timestamp_ms: number;
  root_cause: string;
  confidence: number;
  reasoning: string;
  evidence_chain: EvidenceItem[];
  recommended_action: RecommendedAction;
  similar_incidents: SimilarIncident[];
  llm_model: string;
  latency_ms: number;
  status: "completed" | "failed" | "rate_limited";
  error?: string;
}

export interface NodeStatus {
  node_id: string;
  gpu_model: string;
  gpu_count: number;
  last_seen_ms: number;
  latest_metrics: GpuMetrics[];
  latest_training: TrainingMetrics | null;
  latest_diloco: DiLoCoMetrics | null;
}

export interface EnrichedAlert {
  alert: AlertModel;
  recent_metrics: Record<string, unknown>[];
  node_history: AlertModel[];
  correlated_events: AlertModel[];
  lifecycle?: AlertLifecycle | null;
}

export interface HealthStatus {
  status: string;
  connected_sidecars: number;
  total_alerts: number;
  total_diagnoses: number;
  ws_clients: number;
}

export interface NodeMetricsHistory {
  gpu_metrics: GpuMetrics[];
  training_metrics: TrainingMetrics[];
  diloco_metrics: DiLoCoMetrics[];
}

export type WebSocketMessage =
  | { type: "alert"; data: AlertModel }
  | { type: "metric_summary"; data: NodeStatus }
  | { type: "diagnosis"; data: DiagnosisResult };

export type JobStatus = "registered" | "running" | "completed" | "failed";

export interface JobModel {
  job_id: string;
  name?: string | null;
  status?: JobStatus;
  created_at_ms?: number;
  updated_at_ms?: number;
  config: Record<string, string>;
  node_ids: string[];
}

export interface JobSummary {
  job: JobModel;
  latest_training: TrainingMetrics | null;
  latest_hardware: GpuMetrics | null;
  alerts: AlertModel[];
  diagnoses: DiagnosisResult[];
  run_duration_ms: number;
}

export type PolicySource = "gpu" | "training" | "diloco";
export type PolicyOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "abs_gt"
  | "stale_for";
export type PolicySeverity = "INFO" | "WARNING" | "CRITICAL";

export interface PolicyScope {
  job_id: string | null;
  node_id: string | null;
}

export interface PolicyMetric {
  source: PolicySource;
  field: string;
}

export interface PolicyCondition {
  operator: PolicyOperator;
  threshold: number;
  for_seconds: number;
}

export interface MonitoringPolicy {
  policy_id: string;
  name: string;
  enabled: boolean;
  scope: PolicyScope;
  metric: PolicyMetric;
  condition: PolicyCondition;
  severity: PolicySeverity;
  cooldown_seconds: number;
  description: string;
  created_at_ms: number;
  updated_at_ms: number;
  last_triggered_at_ms: number | null;
}

export interface PolicyCreate {
  policy_id: string;
  name: string;
  enabled?: boolean;
  scope?: PolicyScope;
  metric: PolicyMetric;
  condition: PolicyCondition;
  severity?: PolicySeverity;
  cooldown_seconds?: number;
  description?: string;
}

export type PolicyUpdate = Partial<Omit<PolicyCreate, "policy_id">>;

export interface CustomMetric {
  node_id: string;
  job_id: string;
  timestamp_ms: number;
  step?: number | null;
  name: string;
  value: number;
  unit?: string | null;
  tags: Record<string, string>;
}
