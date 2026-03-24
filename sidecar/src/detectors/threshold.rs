use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use crate::config::ThresholdConfig;
use crate::normalizer;
use crate::proto::solprobe::v1::{
    Alert, AlertSource, AlertType, MetricsBatch, Severity,
};

use super::Detector;

/// Edge-based threshold detector.
/// Compares each GPU metric and training metric against configured thresholds.
pub struct ThresholdDetector {
    config: ThresholdConfig,
}

impl ThresholdDetector {
    pub fn new(config: ThresholdConfig) -> Self {
        Self { config }
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
    }

    fn make_alert(
        node_id: &str,
        severity: Severity,
        alert_type: AlertType,
        description: String,
        evidence: HashMap<String, String>,
        gpu_index: Option<u32>,
    ) -> Alert {
        Alert {
            alert_id: Uuid::new_v4().to_string(),
            node_id: node_id.to_string(),
            timestamp_ms: Self::now_ms(),
            severity: severity.into(),
            source: AlertSource::Edge.into(),
            alert_type: alert_type.into(),
            description,
            confidence: 1.0, // edge alerts are deterministic
            evidence,
            gpu_index: gpu_index,
            job_id: None,
        }
    }

    /// Decode clock throttle reason bitmask into human-readable strings.
    fn decode_clock_throttle(reasons: u64) -> String {
        let mut parts = Vec::new();
        if reasons & 0x1 != 0 {
            parts.push("GpuIdle");
        }
        if reasons & 0x2 != 0 {
            parts.push("ApplicationsClocksSetting");
        }
        if reasons & 0x4 != 0 {
            parts.push("SwPowerCap");
        }
        if reasons & 0x8 != 0 {
            parts.push("HwSlowdown");
        }
        if reasons & 0x10 != 0 {
            parts.push("SyncBoost");
        }
        if reasons & 0x20 != 0 {
            parts.push("SwThermalSlowdown");
        }
        if reasons & 0x40 != 0 {
            parts.push("HwThermalSlowdown");
        }
        if reasons & 0x80 != 0 {
            parts.push("HwPowerBrakeSlowdown");
        }
        if reasons & 0x100 != 0 {
            parts.push("DisplayClockSetting");
        }
        if parts.is_empty() {
            format!("0x{:x}", reasons)
        } else {
            parts.join("|")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ThresholdConfig;
    use crate::detectors::Detector;
    use crate::proto::solprobe::v1::{GpuMetrics, MetricsBatch, TrainingMetrics};

    fn default_gpu(node_id: &str) -> GpuMetrics {
        GpuMetrics {
            node_id: node_id.to_string(),
            gpu_index: 0,
            gpu_model: "T4".to_string(),
            timestamp_ms: 0,
            gpu_temp_c: 50.0,
            memory_temp_c: 45.0,
            gpu_utilization_pct: 80.0,
            mem_copy_utilization_pct: 40.0,
            fb_used_mb: 8000.0,
            fb_free_mb: 8384.0,
            power_usage_w: 55.0,
            xid_errors: 0,
            ecc_sbe_count: 0,
            ecc_dbe_count: 0,
            clock_throttle_reasons: 0,
            pcie_replay_counter: 0,
            pcie_tx_bytes_per_sec: 1e9,
            pcie_rx_bytes_per_sec: 1e9,
            sm_active_pct: 75.0,
            tensor_active_pct: 60.0,
            retired_pages_sbe: 0,
            retired_pages_dbe: 0,
            remapped_rows_correctable: 0,
            remapped_rows_uncorrectable: 0,
            row_remap_failure: false,
        }
    }

    fn default_training(node_id: &str) -> TrainingMetrics {
        TrainingMetrics {
            node_id: node_id.to_string(),
            job_id: "test-job".to_string(),
            timestamp_ms: 0,
            step: 100,
            loss: 1.0,
            gradient_norm: 1.0,
            learning_rate: 3e-4,
            throughput_tps: 5000.0,
            mfu_pct: 45.0,
        }
    }

    fn make_batch(gpu: GpuMetrics, training: Option<TrainingMetrics>) -> MetricsBatch {
        MetricsBatch {
            gpu: vec![gpu],
            training,
            diloco: None,
        }
    }

    #[test]
    fn test_temp_above_critical_fires_alert() {
        let detector = ThresholdDetector::new(ThresholdConfig::default());
        let mut gpu = default_gpu("node-1");
        gpu.gpu_temp_c = 90.0; // above critical (85)
        let batch = make_batch(gpu, None);
        let alerts = detector.check(&batch);
        assert!(!alerts.is_empty());
        let alert = &alerts[0];
        assert_eq!(alert.severity, i32::from(Severity::Critical));
        assert_eq!(alert.alert_type, i32::from(AlertType::ThermalThrottle));
    }

    #[test]
    fn test_temp_below_warn_no_alert() {
        let detector = ThresholdDetector::new(ThresholdConfig::default());
        let mut gpu = default_gpu("node-1");
        gpu.gpu_temp_c = 60.0; // well below warn (80)
        let batch = make_batch(gpu, None);
        let alerts = detector.check(&batch);
        // No thermal alerts
        let thermal: Vec<_> = alerts
            .iter()
            .filter(|a| a.alert_type == i32::from(AlertType::ThermalThrottle))
            .collect();
        assert!(thermal.is_empty());
    }

    #[test]
    fn test_xid_79_fires_alert() {
        let detector = ThresholdDetector::new(ThresholdConfig::default());
        let mut gpu = default_gpu("node-1");
        gpu.xid_errors = 79;
        let batch = make_batch(gpu, None);
        let alerts = detector.check(&batch);
        let xid_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| a.alert_type == i32::from(AlertType::XidError))
            .collect();
        assert_eq!(xid_alerts.len(), 1);
        assert_eq!(xid_alerts[0].severity, i32::from(Severity::Critical));
    }

    #[test]
    fn test_gradient_explosion_fires_alert() {
        let detector = ThresholdDetector::new(ThresholdConfig::default());
        let gpu = default_gpu("node-1");
        let mut training = default_training("node-1");
        training.gradient_norm = 150.0; // above critical (100)
        let batch = make_batch(gpu, Some(training));
        let alerts = detector.check(&batch);
        let grad_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| a.alert_type == i32::from(AlertType::GradientExplosion))
            .collect();
        assert_eq!(grad_alerts.len(), 1);
        assert_eq!(grad_alerts[0].severity, i32::from(Severity::Critical));
    }

    #[test]
    fn test_memory_pressure_critical() {
        let detector = ThresholdDetector::new(ThresholdConfig::default());
        let mut gpu = default_gpu("node-1");
        // 96% memory usage: used=15728.64, free=655.36 (total=16384)
        gpu.fb_used_mb = 16384.0 * 0.96;
        gpu.fb_free_mb = 16384.0 - gpu.fb_used_mb;
        let batch = make_batch(gpu, None);
        let alerts = detector.check(&batch);
        let mem_alerts: Vec<_> = alerts
            .iter()
            .filter(|a| a.alert_type == i32::from(AlertType::MemoryPressure))
            .collect();
        assert_eq!(mem_alerts.len(), 1);
        assert_eq!(mem_alerts[0].severity, i32::from(Severity::Critical));
    }
}

impl Detector for ThresholdDetector {
    fn check(&self, batch: &MetricsBatch) -> Vec<Alert> {
        let mut alerts = Vec::new();

        // --- Check each GPU's metrics ---
        for gpu in &batch.gpu {
            let mem_pct = normalizer::memory_used_pct(gpu.fb_used_mb, gpu.fb_free_mb);

            // Temperature checks
            if gpu.gpu_temp_c > self.config.temp_critical_c {
                let mut ev = HashMap::new();
                ev.insert("gpu_temp_c".into(), format!("{:.1}", gpu.gpu_temp_c));
                ev.insert(
                    "threshold_c".into(),
                    format!("{:.1}", self.config.temp_critical_c),
                );
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Critical,
                    AlertType::ThermalThrottle,
                    format!(
                        "GPU {} temperature {:.1}C exceeds critical threshold {:.1}C",
                        gpu.gpu_index, gpu.gpu_temp_c, self.config.temp_critical_c
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            } else if gpu.gpu_temp_c > self.config.temp_warn_c {
                let mut ev = HashMap::new();
                ev.insert("gpu_temp_c".into(), format!("{:.1}", gpu.gpu_temp_c));
                ev.insert(
                    "threshold_c".into(),
                    format!("{:.1}", self.config.temp_warn_c),
                );
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Warning,
                    AlertType::ThermalThrottle,
                    format!(
                        "GPU {} temperature {:.1}C exceeds warning threshold {:.1}C",
                        gpu.gpu_index, gpu.gpu_temp_c, self.config.temp_warn_c
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            }

            // Memory pressure checks
            if mem_pct > self.config.memory_critical_pct {
                let mut ev = HashMap::new();
                ev.insert("memory_used_pct".into(), format!("{:.1}", mem_pct));
                ev.insert(
                    "threshold_pct".into(),
                    format!("{:.1}", self.config.memory_critical_pct),
                );
                ev.insert("fb_used_mb".into(), format!("{:.0}", gpu.fb_used_mb));
                ev.insert("fb_free_mb".into(), format!("{:.0}", gpu.fb_free_mb));
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Critical,
                    AlertType::MemoryPressure,
                    format!(
                        "GPU {} memory usage {:.1}% exceeds critical threshold {:.1}%",
                        gpu.gpu_index, mem_pct, self.config.memory_critical_pct
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            } else if mem_pct > self.config.memory_warn_pct {
                let mut ev = HashMap::new();
                ev.insert("memory_used_pct".into(), format!("{:.1}", mem_pct));
                ev.insert(
                    "threshold_pct".into(),
                    format!("{:.1}", self.config.memory_warn_pct),
                );
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Warning,
                    AlertType::MemoryPressure,
                    format!(
                        "GPU {} memory usage {:.1}% exceeds warning threshold {:.1}%",
                        gpu.gpu_index, mem_pct, self.config.memory_warn_pct
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            }

            // Xid error check
            if gpu.xid_errors != 0 {
                let mut ev = HashMap::new();
                ev.insert("xid_code".into(), format!("{}", gpu.xid_errors));
                let is_critical = self.config.critical_xid_codes.contains(&gpu.xid_errors);
                ev.insert("is_critical_xid".into(), format!("{}", is_critical));
                let severity = if is_critical { Severity::Critical } else { Severity::Warning };
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    severity,
                    AlertType::XidError,
                    format!(
                        "GPU {} reported Xid error {}",
                        gpu.gpu_index, gpu.xid_errors
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            }

            // ECC double-bit error check
            if gpu.ecc_dbe_count > 0 {
                let mut ev = HashMap::new();
                ev.insert("ecc_dbe_count".into(), format!("{}", gpu.ecc_dbe_count));
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Critical,
                    AlertType::EccError,
                    format!(
                        "GPU {} has {} uncorrectable ECC errors",
                        gpu.gpu_index, gpu.ecc_dbe_count
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            }

            // Clock throttle reasons — mask out benign bits (GpuIdle, AppClocks, SwPowerCap, SyncBoost, DisplayClock)
            let alert_bits = gpu.clock_throttle_reasons & 0xE8; // HwSlowdown(0x8) | SwThermal(0x20) | HwThermal(0x40) | HwPowerBrake(0x80)
            if alert_bits != 0 {
                let decoded = Self::decode_clock_throttle(gpu.clock_throttle_reasons);
                let mut ev = HashMap::new();
                ev.insert(
                    "clock_throttle_reasons_raw".into(),
                    format!("0x{:x}", gpu.clock_throttle_reasons),
                );
                ev.insert("clock_throttle_reasons".into(), decoded.clone());
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Warning,
                    AlertType::ClockThrottle,
                    format!(
                        "GPU {} clock throttled: {}",
                        gpu.gpu_index, decoded
                    ),
                    ev,
                    Some(gpu.gpu_index),
                ));
            }
        }

        // --- Check training metrics ---
        if let Some(ref training) = batch.training {
            if training.gradient_norm > self.config.gradient_norm_critical {
                let mut ev = HashMap::new();
                ev.insert(
                    "gradient_norm".into(),
                    format!("{:.4}", training.gradient_norm),
                );
                ev.insert(
                    "threshold".into(),
                    format!("{:.1}", self.config.gradient_norm_critical),
                );
                ev.insert("step".into(), format!("{}", training.step));
                alerts.push(Self::make_alert(
                    &training.node_id,
                    Severity::Critical,
                    AlertType::GradientExplosion,
                    format!(
                        "Gradient norm {:.4} exceeds critical threshold {:.1} at step {}",
                        training.gradient_norm, self.config.gradient_norm_critical, training.step
                    ),
                    ev,
                    None,
                ));
            } else if training.gradient_norm > self.config.gradient_norm_warn {
                let mut ev = HashMap::new();
                ev.insert(
                    "gradient_norm".into(),
                    format!("{:.4}", training.gradient_norm),
                );
                ev.insert(
                    "threshold".into(),
                    format!("{:.1}", self.config.gradient_norm_warn),
                );
                ev.insert("step".into(), format!("{}", training.step));
                alerts.push(Self::make_alert(
                    &training.node_id,
                    Severity::Warning,
                    AlertType::GradientExplosion,
                    format!(
                        "Gradient norm {:.4} exceeds warning threshold {:.1} at step {}",
                        training.gradient_norm, self.config.gradient_norm_warn, training.step
                    ),
                    ev,
                    None,
                ));
            }
        }

        alerts
    }
}
