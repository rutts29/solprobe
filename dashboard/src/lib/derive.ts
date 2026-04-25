// Pure helpers — no React, no DOM, no fetch. Safe for SSR, easy to unit-test.
import type { NodeStatus, GpuMetrics, AlertModel } from "./types";

export type HealthTone = "ok" | "warn" | "crit" | "muted";

export function isAppleSiliconModel(gpuModel: string | null | undefined): boolean {
  return gpuModel === "Apple Silicon";
}

function gpuModelFor(gpu: GpuMetrics, node?: Pick<NodeStatus, "gpu_model">): string {
  return gpu.gpu_model || node?.gpu_model || "";
}

export function isGpuTempAvailable(gpu: GpuMetrics, node?: Pick<NodeStatus, "gpu_model">): boolean {
  return !(isAppleSiliconModel(gpuModelFor(gpu, node)) && gpu.gpu_temp_c === 0);
}

export function isGpuPowerAvailable(gpu: GpuMetrics, node?: Pick<NodeStatus, "gpu_model">): boolean {
  return !(isAppleSiliconModel(gpuModelFor(gpu, node)) && gpu.power_usage_w === 0);
}

/** Average GPU utilization across every GPU on every connected node. */
export function avgGpuUtilization(nodes: NodeStatus[]): number {
  const utils: number[] = [];
  for (const n of nodes) for (const m of n.latest_metrics) utils.push(m.gpu_utilization_pct);
  return utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 0;
}

/** Average supported GPU temp across every GPU on every connected node. */
export function avgGpuTemp(nodes: NodeStatus[]): number | null {
  const temps: number[] = [];
  for (const n of nodes) {
    for (const m of n.latest_metrics) {
      if (isGpuTempAvailable(m, n)) temps.push(m.gpu_temp_c);
    }
  }
  return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
}

/** Sum of supported power_usage_w across every GPU on every connected node. */
export function totalPowerKw(nodes: NodeStatus[]): number | null {
  let watts = 0;
  let samples = 0;
  for (const n of nodes) {
    for (const m of n.latest_metrics) {
      if (!isGpuPowerAvailable(m, n)) continue;
      watts += m.power_usage_w;
      samples++;
    }
  }
  if (samples === 0) return null;
  return watts / 1000;
}

/** Memory percentage for a single GPU metrics row. Returns 0 when total is unknown. */
export function memPct(gpu: GpuMetrics): number {
  const total = gpu.fb_used_mb + gpu.fb_free_mb;
  return total > 0 ? (gpu.fb_used_mb / total) * 100 : 0;
}

/** Tone for a temperature reading. Mirrors thresholds used in node-card.tsx. */
export function tempTone(c: number): HealthTone {
  if (c > 80) return "crit";
  if (c > 70) return "warn";
  return "ok";
}

export function gpuTempTone(gpu: GpuMetrics, node?: Pick<NodeStatus, "gpu_model">): HealthTone {
  if (!isGpuTempAvailable(gpu, node)) return "muted";
  return tempTone(gpu.gpu_temp_c);
}

/** Tone for a node based on staleness + per-GPU temp. */
export function nodeTone(node: NodeStatus, now: number = Date.now()): HealthTone {
  const stale = now - node.last_seen_ms > 60_000;
  if (stale) return "muted";
  const gpu = node.latest_metrics[0];
  if (!gpu) return "muted";
  return gpuTempTone(gpu, node);
}

/** Throughput across all training metrics (sum of tps). */
export function totalThroughputTps(nodes: NodeStatus[]): number {
  let tps = 0;
  for (const n of nodes) if (n.latest_training) tps += n.latest_training.throughput_tps;
  return tps;
}

/** Bucket a stream of alerts into N equal-width time bins (most-recent first becomes rightmost). */
export function alertsPerMinute(alerts: AlertModel[], bins = 12, windowMs = 12 * 60_000): number[] {
  const now = Date.now();
  const start = now - windowMs;
  const binWidth = windowMs / bins;
  const out = new Array(bins).fill(0);
  for (const a of alerts) {
    if (a.timestamp_ms < start) continue;
    const idx = Math.min(bins - 1, Math.floor((a.timestamp_ms - start) / binWidth));
    out[idx]++;
  }
  return out;
}

/** Group alerts by severity. */
export function alertsBySeverity(alerts: AlertModel[]): { CRITICAL: number; WARNING: number; INFO: number } {
  const out = { CRITICAL: 0, WARNING: 0, INFO: 0 };
  for (const a of alerts) out[a.severity]++;
  return out;
}

/** Total stragglers in current DiLoCo state. */
export function stragglerCount(nodes: NodeStatus[]): number {
  return nodes.filter((n) => n.latest_diloco?.is_straggler).length;
}
