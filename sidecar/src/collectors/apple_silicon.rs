use super::diloco::DiLoCoMetricsReader;
use super::training::TrainingMetricsReader;
use super::{CollectorError, MetricCollector};
use crate::proto::solprobe::v1::{GpuMetrics, MetricsBatch};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Collector for Apple Silicon GPUs (M1/M2/M3/M4 series).
///
/// Reads GPU utilization and memory stats from macOS IOKit via `ioreg`.
/// No sudo required. Temperature and power require `powermetrics` (sudo)
/// and are reported as 0 when unavailable.
///
/// Available metrics:
///   - gpu_utilization_pct  ← "Device Utilization %"
///   - fb_used_mb / fb_free_mb ← "In use system memory" / "VRAM,totalMB"
///   - sm_active_pct ← "Renderer Utilization %"
///   - tensor_active_pct ← "Tiler Utilization %"
///
/// Not available (NVIDIA-specific):
///   - gpu_temp_c, power_usage_w (need sudo powermetrics)
///   - xid_errors, ecc_*, clock_throttle_reasons, pcie_* (no Apple equivalent)
pub struct AppleSiliconCollector {
    node_id: String,
    training_reader: TrainingMetricsReader,
    diloco_reader: DiLoCoMetricsReader,
}

impl AppleSiliconCollector {
    #[cfg(test)]
    pub fn new(node_id: String) -> Self {
        Self::with_mmap_dir(node_id, PathBuf::from("/tmp"))
    }

    pub fn with_mmap_dir(node_id: String, mmap_dir: impl Into<PathBuf>) -> Self {
        let mmap_dir = mmap_dir.into();
        tracing::info!(node_id = %node_id, "Apple Silicon GPU collector initialized");
        Self {
            training_reader: TrainingMetricsReader::with_mmap_dir(
                node_id.clone(),
                mmap_dir.clone(),
            ),
            diloco_reader: DiLoCoMetricsReader::with_mmap_dir(node_id.clone(), mmap_dir),
            node_id,
        }
    }

    fn collect_sync(&self) -> Result<GpuMetrics, CollectorError> {
        let output = Command::new("ioreg")
            .args(["-l", "-w0"])
            .output()
            .map_err(|e| CollectorError::Unavailable(format!("ioreg failed: {e}")))?;

        if !output.status.success() {
            return Err(CollectorError::Other(
                "ioreg returned non-zero exit code".into(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        let mut perf_stats: HashMap<String, i64> = HashMap::new();
        let mut vram_total_mb: f32 = 0.0;

        for line in stdout.lines() {
            // Parse the GPU PerformanceStatistics dictionary
            if line.contains("\"PerformanceStatistics\"") && line.contains("Device Utilization") {
                if let Some(start) = line.find('{') {
                    if let Some(end) = line.rfind('}') {
                        perf_stats = Self::parse_iokit_dict(&line[start..=end]);
                    }
                }
            }
            // Parse VRAM total (appears in a different IOKit entry)
            if let Some(val) = Self::extract_after(line, "\"VRAM,totalMB\"=") {
                vram_total_mb = val as f32;
            }
        }

        let device_util = perf_stats.get("Device Utilization %").copied().unwrap_or(0);
        let renderer_util = perf_stats
            .get("Renderer Utilization %")
            .copied()
            .unwrap_or(0);
        let tiler_util = perf_stats.get("Tiler Utilization %").copied().unwrap_or(0);
        let in_use_bytes = perf_stats.get("In use system memory").copied().unwrap_or(0);

        // "In use system memory" = Metal GPU allocations from unified pool (typically 200-900 MB idle).
        // fb_free_mb is the remainder of the total addressable pool, not OS-level free RAM.
        let fb_used_mb = (in_use_bytes as f64 / 1_048_576.0) as f32;
        let fb_free_mb = (vram_total_mb - fb_used_mb).max(0.0);

        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        Ok(GpuMetrics {
            node_id: self.node_id.clone(),
            gpu_index: 0,
            gpu_model: "Apple Silicon".to_string(),
            timestamp_ms,
            gpu_temp_c: 0.0,    // requires sudo powermetrics
            memory_temp_c: 0.0, // N/A on Apple Silicon
            gpu_utilization_pct: device_util as f32,
            mem_copy_utilization_pct: 0.0,
            fb_used_mb,
            fb_free_mb,
            power_usage_w: 0.0,        // requires sudo powermetrics
            xid_errors: 0,             // NVIDIA-specific
            ecc_sbe_count: 0,          // NVIDIA-specific
            ecc_dbe_count: 0,          // NVIDIA-specific
            clock_throttle_reasons: 0, // NVIDIA-specific
            pcie_replay_counter: 0,    // no discrete PCIe bus
            pcie_tx_bytes_per_sec: 0.0,
            pcie_rx_bytes_per_sec: 0.0,
            sm_active_pct: renderer_util as f32,
            tensor_active_pct: tiler_util as f32,
            retired_pages_sbe: 0,
            retired_pages_dbe: 0,
            remapped_rows_correctable: 0,
            remapped_rows_uncorrectable: 0,
            row_remap_failure: false,
        })
    }

    /// Parse an IOKit dictionary string like:
    /// {"key1"=val1,"key2"=val2,...}
    fn parse_iokit_dict(dict_str: &str) -> HashMap<String, i64> {
        let mut map = HashMap::new();
        let inner = dict_str.trim_start_matches('{').trim_end_matches('}');
        for entry in inner.split(',') {
            let entry = entry.trim();
            if let Some(eq_pos) = entry.rfind('=') {
                let key = entry[..eq_pos].trim().trim_matches('"');
                let val_str = entry[eq_pos + 1..].trim();
                if let Ok(val) = val_str.parse::<i64>() {
                    map.insert(key.to_string(), val);
                }
            }
        }
        map
    }

    /// Extract the integer value after a pattern like `"VRAM,totalMB"=16384`
    fn extract_after(line: &str, pattern: &str) -> Option<i64> {
        let pos = line.find(pattern)?;
        let after = &line[pos + pattern.len()..];
        let num_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        num_str.parse().ok()
    }
}

impl MetricCollector for AppleSiliconCollector {
    fn collect(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<MetricsBatch, CollectorError>> + Send + '_>> {
        Box::pin(async {
            let gpu = self.collect_sync()?;
            let mut batch = MetricsBatch {
                gpu: vec![gpu],
                training: None,
                diloco: None,
            };

            // Pick up training metrics from any PyTorch process writing to mmap.
            // Without this, MPS training scripts (train_mps.py, nanochat fork, etc.)
            // would have their loss/throughput/grad_norm written but never observed.
            if let Some(training) = self.training_reader.read() {
                tracing::debug!("Read training metrics from mmap (step={})", training.step);
                batch.training = Some(training);
            }
            if let Some(diloco) = self.diloco_reader.read() {
                tracing::debug!(
                    "Read DiLoCo metrics from mmap (inner_step={})",
                    diloco.inner_step
                );
                batch.diloco = Some(diloco);
            }

            Ok(batch)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_iokit_dict() {
        let dict = r#"{"In use system memory (driver)"=0,"Alloc system memory"=2188165120,"Tiler Utilization %"=36,"recoveryCount"=0,"Renderer Utilization %"=42,"Device Utilization %"=38,"In use system memory"=408895488}"#;
        let map = AppleSiliconCollector::parse_iokit_dict(dict);

        assert_eq!(map.get("Device Utilization %"), Some(&38));
        assert_eq!(map.get("Renderer Utilization %"), Some(&42));
        assert_eq!(map.get("Tiler Utilization %"), Some(&36));
        assert_eq!(map.get("In use system memory"), Some(&408895488));
        assert_eq!(map.get("In use system memory (driver)"), Some(&0));
    }

    #[test]
    fn test_extract_after() {
        let line = r#"    "VRAM,totalMB"=16384,"other"=42"#;
        assert_eq!(
            AppleSiliconCollector::extract_after(line, "\"VRAM,totalMB\"="),
            Some(16384)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_collect_real_metrics() {
        let collector = AppleSiliconCollector::new("test-node".to_string());
        let result = collector.collect_sync();
        assert!(result.is_ok(), "collect_sync failed: {:?}", result.err());
        let gpu = result.unwrap();
        assert_eq!(gpu.node_id, "test-node");
        assert_eq!(gpu.gpu_model, "Apple Silicon");
        // Utilization should be 0-100
        assert!(gpu.gpu_utilization_pct <= 100.0);
        // Memory should be positive (something is always using GPU memory)
        assert!(gpu.fb_used_mb > 0.0, "GPU memory in use should be > 0");
    }
}
