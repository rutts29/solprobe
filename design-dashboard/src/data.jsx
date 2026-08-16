// Mock data shaped to the real SolProbe types

const NODES = [
  { node_id: "node-0",  gpu_model: "NVIDIA L4",  gpu_count: 1, last_seen_ms: Date.now() - 1200,  temp: 62, util: 94, mem_pct: 71, power: 68, sm: 88, status: "healthy",  region: "us-central1-a", job: "diloco-gpt-4b" },
  { node_id: "node-1",  gpu_model: "NVIDIA L4",  gpu_count: 1, last_seen_ms: Date.now() - 800,   temp: 67, util: 91, mem_pct: 74, power: 71, sm: 86, status: "healthy",  region: "us-central1-a", job: "diloco-gpt-4b" },
  { node_id: "node-2",  gpu_model: "NVIDIA L4",  gpu_count: 1, last_seen_ms: Date.now() - 2400,  temp: 84, util: 78, mem_pct: 89, power: 72, sm: 71, status: "warning",  region: "us-central1-b", job: "diloco-gpt-4b" },
  { node_id: "node-3",  gpu_model: "NVIDIA T4",  gpu_count: 1, last_seen_ms: Date.now() - 600,   temp: 71, util: 88, mem_pct: 64, power: 62, sm: 82, status: "healthy",  region: "us-central1-b", job: "diloco-gpt-4b" },
  { node_id: "node-4",  gpu_model: "NVIDIA T4",  gpu_count: 1, last_seen_ms: Date.now() - 1100,  temp: 69, util: 90, mem_pct: 68, power: 64, sm: 84, status: "healthy",  region: "us-central1-c", job: "diloco-gpt-4b" },
  { node_id: "node-5",  gpu_model: "NVIDIA L4",  gpu_count: 1, last_seen_ms: Date.now() - 31000, temp: 87, util: 12, mem_pct: 95, power: 74, sm: 8,  status: "critical", region: "us-central1-c", job: "diloco-gpt-4b" },
  { node_id: "node-6",  gpu_model: "NVIDIA T4",  gpu_count: 1, last_seen_ms: Date.now() - 900,   temp: 64, util: 92, mem_pct: 70, power: 60, sm: 87, status: "healthy",  region: "us-east1-b",    job: "diloco-gpt-4b" },
  { node_id: "node-7",  gpu_model: "NVIDIA L4",  gpu_count: 1, last_seen_ms: Date.now() - 1400,  temp: 73, util: 85, mem_pct: 72, power: 66, sm: 80, status: "healthy",  region: "us-east1-b",    job: "diloco-gpt-4b" },
];

const ALERTS = [
  { alert_id: "alt_8af2", node_id: "node-5", ts: Date.now() - 42_000,    severity: "CRITICAL", source: "EDGE",    type: "thermal_throttle",     description: "GPU temp exceeded 85°C threshold for >30s",                    confidence: 0.98 },
  { alert_id: "alt_8ae1", node_id: "node-5", ts: Date.now() - 95_000,    severity: "CRITICAL", source: "CENTRAL", type: "nccl_timeout",         description: "Correlated stall detected across node-5, node-2 within 30s",   confidence: 0.91 },
  { alert_id: "alt_8acd", node_id: "node-2", ts: Date.now() - 6 * 60_000, severity: "WARNING", source: "EDGE",    type: "clock_throttle",       description: "Clock throttle bitmask 0x2 (HW slowdown) for 18s",             confidence: 0.86 },
  { alert_id: "alt_8abc", node_id: "node-5", ts: Date.now() - 9 * 60_000, severity: "CRITICAL", source: "EDGE",   type: "memory_pressure",      description: "fb_used 95.2% — checkpoint write may stall",                    confidence: 0.94 },
  { alert_id: "alt_8a91", node_id: "node-3", ts: Date.now() - 14 * 60_000,severity: "WARNING", source: "CENTRAL", type: "straggler_detected",   description: "Throughput 76% of cluster mean over 4 steps",                  confidence: 0.79 },
  { alert_id: "alt_8a72", node_id: "node-2", ts: Date.now() - 22 * 60_000,severity: "WARNING", source: "CENTRAL", type: "diloco_sync_drift",    description: "Outer-step sync 2.3× historical mean",                          confidence: 0.81 },
  { alert_id: "alt_8a51", node_id: "node-1", ts: Date.now() - 38 * 60_000,severity: "INFO",    source: "EDGE",    type: "pcie_replay",          description: "PCIe replay counter incremented by 4 over 60s",                 confidence: 0.62 },
];

const DIAGNOSES = [
  {
    id: "dx_3c41",
    alert_id: "alt_8af2",
    node_id: "node-5",
    ts: Date.now() - 35_000,
    root_cause: "Thermal envelope exceeded — likely fan degradation on adjacent node-2",
    confidence: 0.92,
    reasoning: "Sustained gpu_temp_c climb on node-5 from 78°C → 87°C over 4m correlates with node-2 thermal_throttle event. Memory temp also rising (fb_used 95%). Inlet temperature normal — points to chassis-level airflow rather than facility cooling.",
    action: { name: "reassign_workload", urgency: "immediate", target: "node-{6,7}" },
    evidence: [
      { metric: "gpu_temp_c",       value: "87°C",    context: "+9° vs 5m baseline" },
      { metric: "memory_temp_c",    value: "82°C",    context: "approaching limit" },
      { metric: "throttle_reasons", value: "0x2|0x4", context: "HW slowdown + thermal" },
      { metric: "fb_used_mb",       value: "22813",   context: "95.2% — no headroom" },
    ],
    similar: [{ id: "dx_2e1a", root_cause: "Fan stall, chassis B", similarity: 0.87 }],
    model: "claude-haiku-4-5",
    latency_ms: 1842,
  },
  {
    id: "dx_3c2e",
    alert_id: "alt_8ae1",
    node_id: "node-5",
    ts: Date.now() - 80_000,
    root_cause: "NCCL allreduce stall triggered by upstream thermal throttle on node-5",
    confidence: 0.88,
    reasoning: "Allreduce timed out at 32s. Node-5 was throttling concurrently. Recommend exclusion + checkpoint resume from step 14820.",
    action: { name: "restart_from_checkpoint", urgency: "soon", target: "step 14820" },
    evidence: [
      { metric: "nccl_timeout_ms",  value: "32000",   context: "default 30s exceeded" },
      { metric: "correlated_nodes", value: "node-5,2",context: "both throttling" },
    ],
    similar: [{ id: "dx_19c2", root_cause: "Topology-aware retry", similarity: 0.74 }],
    model: "claude-haiku-4-5",
    latency_ms: 2104,
  },
  {
    id: "dx_3bf0",
    alert_id: "alt_8acd",
    node_id: "node-2",
    ts: Date.now() - 5 * 60_000,
    root_cause: "Sustained HW slowdown — power capping likely, no thermal cause",
    confidence: 0.71,
    reasoning: "Clock throttle bitmask 0x2 set without temperature exceedance. Power draw at 72W vs 65W baseline. Likely PSU-level capping; recommend monitoring for 5m before action.",
    action: { name: "monitor", urgency: "monitor", target: "node-2" },
    evidence: [
      { metric: "throttle_reasons", value: "0x2",     context: "HW slowdown only" },
      { metric: "power_usage_w",    value: "72",      context: "+10% vs baseline" },
    ],
    similar: [],
    model: "claude-haiku-4-5",
    latency_ms: 1611,
  },
];

// Sparkline series (24 points each — last 24 minutes)
function gen(base, jitter, trend = 0, len = 24) {
  const arr = [];
  for (let i = 0; i < len; i++) {
    const v = base + Math.sin(i / 3.2) * jitter * 0.5 + (Math.random() - 0.5) * jitter + trend * (i / len);
    arr.push(Math.max(0, v));
  }
  return arr;
}

const SERIES = {
  cluster_util:  gen(86, 8, 2),
  cluster_temp:  gen(70, 6, 4),
  alerts_per_m:  [0,0,1,0,0,2,1,0,0,1,0,0,3,1,2,0,1,0,0,4,2,1,3,2],
  throughput:    gen(2400, 180, -120),
  loss:          gen(2.1, 0.15, -0.4).map(v => v.toFixed(3)),
  grad_norm:     gen(1.4, 0.4, 0.6),
};

// Training run summary
const RUN = {
  job_id: "diloco-gpt-4b",
  step: 14_823,
  total_steps: 50_000,
  loss: 1.732,
  loss_delta: -0.018,
  throughput_tps: 2_287,
  mfu: 41.8,
  outer_step: 207,
  inner_step: 71,
  sync_ms: 1_842,
  attestations: 192,
  staked_sol: "12,400",
};

Object.assign(window, { NODES, ALERTS, DIAGNOSES, SERIES, RUN });
