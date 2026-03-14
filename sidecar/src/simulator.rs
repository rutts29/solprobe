use crate::proto::solprobe::v1::{DiLoCoMetrics, GpuMetrics, MetricsBatch, TrainingMetrics};
use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};

/// Simulator state for generating realistic GPU/training metrics.
pub struct Simulator {
    node_id: String,
    gpu_model: String,
    tick: u64,
    inject_fault: Option<String>,
    fb_total_mb: f32,
    tdp_watts: f32,
}

impl Simulator {
    pub fn new(node_id: String, inject_fault: Option<String>) -> Self {
        // Default to T4 for simulation
        Self {
            node_id,
            gpu_model: "T4".to_string(),
            tick: 0,
            inject_fault,
            fb_total_mb: 16384.0,
            tdp_watts: 70.0,
        }
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    /// Generate a single batch of simulated metrics.
    pub fn generate(&mut self) -> MetricsBatch {
        self.tick += 1;
        let mut rng = rand::thread_rng();

        let gpu = self.generate_gpu_metrics(&mut rng);
        let training = self.generate_training_metrics(&mut rng);
        let diloco = self.generate_diloco_metrics(&mut rng);

        MetricsBatch {
            gpu: vec![gpu],
            training: Some(training),
            diloco: Some(diloco),
        }
    }

    fn generate_gpu_metrics(&self, rng: &mut impl Rng) -> GpuMetrics {
        let t = self.tick as f64;
        let ts = Self::now_ms();

        // --- Temperature: sine wave 35-76 C with +/-2 noise ---
        let mut temp = 55.5 + 20.5 * (t * 0.05).sin() + rng.gen_range(-2.0..2.0);

        // --- Utilization: 70-95% with occasional dips ---
        let mut util = rng.gen_range(70.0..95.0_f32);
        if rng.gen_ratio(1, 20) {
            util = rng.gen_range(20.0..30.0);
        }

        // --- Memory: slowly fills 60% -> 85% ---
        let fill_frac = 0.60 + 0.25 * (1.0 - (-0.005 * t).exp());
        let mut fb_used = (self.fb_total_mb as f64 * fill_frac) as f32;
        let mut fb_free = self.fb_total_mb - fb_used;

        // --- Power: proportional to utilization ---
        let power_min = self.tdp_watts * 0.43; // ~30W for T4
        let power_range = self.tdp_watts * 0.57; // up to 70W
        let power = power_min + power_range * (util / 100.0);

        // --- Xid / ECC defaults ---
        let mut xid_errors: u32 = 0;
        let ecc_sbe: u64 = 0;
        let ecc_dbe: u64 = 0;
        let clock_throttle: u64 = 0;

        // --- Gradient norm default for fault injection ---
        // (gradient_norm is on TrainingMetrics, handled separately)

        // --- Fault injection ---
        if let Some(ref fault) = self.inject_fault {
            match fault.as_str() {
                "thermal_throttle" => {
                    temp = 92.0 + rng.gen_range(-0.5..0.5) as f64;
                }
                "xid_79" => {
                    xid_errors = 79;
                }
                "memory_pressure" => {
                    fb_used = self.fb_total_mb * 0.96;
                    fb_free = self.fb_total_mb - fb_used;
                }
                "nccl_timeout" => {
                    // Simulate hang: we return metrics but main loop can detect this flag
                    // and stop generating. Handled at a higher level; here we just return
                    // zeros to indicate a stalled GPU.
                    return GpuMetrics {
                        node_id: self.node_id.clone(),
                        gpu_index: 0,
                        gpu_model: self.gpu_model.clone(),
                        timestamp_ms: ts,
                        gpu_temp_c: 0.0,
                        memory_temp_c: 0.0,
                        gpu_utilization_pct: 0.0,
                        mem_copy_utilization_pct: 0.0,
                        fb_used_mb: 0.0,
                        fb_free_mb: self.fb_total_mb,
                        power_usage_w: 0.0,
                        xid_errors: 0,
                        ecc_sbe_count: 0,
                        ecc_dbe_count: 0,
                        clock_throttle_reasons: 0,
                        pcie_replay_counter: 0,
                        pcie_tx_bytes_per_sec: 0.0,
                        pcie_rx_bytes_per_sec: 0.0,
                        sm_active_pct: 0.0,
                        tensor_active_pct: 0.0,
                        retired_pages_sbe: 0,
                        retired_pages_dbe: 0,
                        remapped_rows_correctable: 0,
                        remapped_rows_uncorrectable: 0,
                        row_remap_failure: false,
                    };
                }
                _ => {}
            }
        }

        let mem_temp = temp as f32 - rng.gen_range(3.0..8.0);
        let mem_copy_util = util * rng.gen_range(0.3..0.6);
        let sm_active = util * rng.gen_range(0.8..0.95);
        let tensor_active = util * rng.gen_range(0.5..0.8);

        GpuMetrics {
            node_id: self.node_id.clone(),
            gpu_index: 0,
            gpu_model: self.gpu_model.clone(),
            timestamp_ms: ts,
            gpu_temp_c: temp as f32,
            memory_temp_c: mem_temp,
            gpu_utilization_pct: util,
            mem_copy_utilization_pct: mem_copy_util,
            fb_used_mb: fb_used,
            fb_free_mb: fb_free,
            power_usage_w: power,
            xid_errors,
            ecc_sbe_count: ecc_sbe,
            ecc_dbe_count: ecc_dbe,
            clock_throttle_reasons: clock_throttle,
            pcie_replay_counter: 0,
            pcie_tx_bytes_per_sec: rng.gen_range(1e9..5e9),
            pcie_rx_bytes_per_sec: rng.gen_range(1e9..5e9),
            sm_active_pct: sm_active,
            tensor_active_pct: tensor_active,
            retired_pages_sbe: 0,
            retired_pages_dbe: 0,
            remapped_rows_correctable: 0,
            remapped_rows_uncorrectable: 0,
            row_remap_failure: false,
        }
    }

    fn generate_training_metrics(&self, rng: &mut impl Rng) -> TrainingMetrics {
        let t = self.tick as f64;
        let ts = Self::now_ms();

        // Loss: decreasing from ~4.0 toward ~0.5
        let loss = 0.5 + 3.5 * (-0.003 * t).exp() + rng.gen_range(-0.05..0.05) as f64;

        // Gradient norm: ~1.0 with noise
        let mut grad_norm: f64 = 1.0 + rng.gen_range(-0.3..0.3);

        // Throughput: ~5000 tokens/sec with noise
        let throughput = 5000.0 + rng.gen_range(-200.0..200.0_f64);

        // Learning rate: cosine schedule-ish
        let lr = 3e-4 * (1.0 + (std::f64::consts::PI * t / 1000.0).cos()) / 2.0;

        // MFU: ~40-55%
        let mfu = rng.gen_range(40.0..55.0_f64);

        // Fault injection
        if let Some(ref fault) = self.inject_fault {
            if fault == "gradient_explosion" {
                grad_norm = 1e6;
            }
        }

        TrainingMetrics {
            node_id: self.node_id.clone(),
            job_id: "sim-job-001".to_string(),
            timestamp_ms: ts,
            step: self.tick,
            loss: loss as f32,
            gradient_norm: grad_norm as f32,
            learning_rate: lr as f32,
            throughput_tps: throughput as f32,
            mfu_pct: mfu as f32,
        }
    }

    fn generate_diloco_metrics(&self, rng: &mut impl Rng) -> DiLoCoMetrics {
        let t = self.tick;
        let ts = Self::now_ms();

        let inner_step = t;
        let outer_step = t / 10; // outer step every 10 inner steps

        let inner_loss = 0.5 + 3.5 * (-0.003 * t as f64).exp() + rng.gen_range(-0.05..0.05);
        let outer_loss = inner_loss + rng.gen_range(-0.1..0.1);

        let pseudo_grad_norm = 0.8 + rng.gen_range(-0.2..0.2_f64);
        let sync_duration = 50.0 + rng.gen_range(-10.0..30.0_f64); // ms
        let speed_ratio = 1.0 + rng.gen_range(-0.05..0.05_f64);

        DiLoCoMetrics {
            node_id: self.node_id.clone(),
            job_id: "sim-job-001".to_string(),
            timestamp_ms: ts,
            inner_step,
            outer_step,
            inner_loss: inner_loss as f32,
            outer_loss: outer_loss as f32,
            pseudo_grad_norm: pseudo_grad_norm as f32,
            sync_duration_ms: sync_duration as f32,
            worker_speed_ratio: speed_ratio as f32,
            is_straggler: false,
        }
    }
}
