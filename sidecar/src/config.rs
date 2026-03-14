use serde::Deserialize;
use std::path::Path;

/// Threshold configuration for edge-based anomaly detection.
/// Defaults are tuned for T4 / L4 GPUs.
#[derive(Debug, Clone, Deserialize)]
pub struct ThresholdConfig {
    pub temp_warn_c: f32,
    pub temp_critical_c: f32,
    pub memory_warn_pct: f32,
    pub memory_critical_pct: f32,
    pub gradient_norm_warn: f32,
    pub gradient_norm_critical: f32,
    /// Xid error codes considered critical.
    pub critical_xid_codes: Vec<u32>,
}

impl Default for ThresholdConfig {
    fn default() -> Self {
        Self {
            temp_warn_c: 80.0,
            temp_critical_c: 85.0,
            memory_warn_pct: 90.0,
            memory_critical_pct: 95.0,
            gradient_norm_warn: 10.0,
            gradient_norm_critical: 100.0,
            critical_xid_codes: vec![
                31, 43, 45, 48, 61, 62, 63, 64, 68, 69, 73, 74, 79, 119, 120,
            ],
        }
    }
}

/// Top-level configuration that can be loaded from a TOML file.
#[derive(Debug, Clone, Deserialize)]
pub struct SidecarConfig {
    #[serde(default)]
    pub thresholds: ThresholdConfig,
}

impl Default for SidecarConfig {
    fn default() -> Self {
        Self {
            thresholds: ThresholdConfig::default(),
        }
    }
}

impl SidecarConfig {
    /// Attempt to load config from a TOML file.
    /// Falls back to defaults if the file does not exist or is malformed.
    pub fn load_or_default(path: &str) -> Self {
        let p = Path::new(path);
        if p.exists() {
            match std::fs::read_to_string(p) {
                Ok(contents) => match toml::from_str::<SidecarConfig>(&contents) {
                    Ok(cfg) => {
                        tracing::info!(path = %path, "Loaded config from TOML file");
                        return cfg;
                    }
                    Err(e) => {
                        tracing::warn!(path = %path, error = %e, "Failed to parse TOML config, using defaults");
                    }
                },
                Err(e) => {
                    tracing::warn!(path = %path, error = %e, "Failed to read config file, using defaults");
                }
            }
        }
        Self::default()
    }
}
