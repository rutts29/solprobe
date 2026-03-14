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
                alerts.push(Self::make_alert(
                    &gpu.node_id,
                    Severity::Critical,
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

            // Clock throttle reasons
            if gpu.clock_throttle_reasons != 0 {
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
