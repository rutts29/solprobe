use crate::proto::solprobe::v1::TrainingMetrics;
use memmap2::Mmap;
use std::fs::File;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Expected binary layout size (little-endian):
///   u8  valid_flag       (1 byte)
///   i64 timestamp_ms     (8 bytes)
///   u64 step             (8 bytes)
///   f32 loss             (4 bytes)
///   f32 gradient_norm    (4 bytes)
///   f32 learning_rate    (4 bytes)
///   f32 throughput_tps   (4 bytes)
///   f32 mfu_pct          (4 bytes)
///   Total: 37 bytes
const TRAINING_RECORD_SIZE: usize = 37;

/// Reads TrainingMetrics from a memory-mapped file written by a PyTorch callback.
/// File path: `{mmap_dir}/solprobe_training_{node_id}.bin`
pub struct TrainingMetricsReader {
    node_id: String,
    mmap_dir: PathBuf,
}

impl TrainingMetricsReader {
    #[cfg(test)]
    pub fn new(node_id: String) -> Self {
        Self::with_mmap_dir(node_id, PathBuf::from("/tmp"))
    }

    pub fn with_mmap_dir(node_id: String, mmap_dir: impl Into<PathBuf>) -> Self {
        Self {
            node_id,
            mmap_dir: mmap_dir.into(),
        }
    }

    fn file_path(&self) -> PathBuf {
        self.mmap_dir
            .join(format!("solprobe_training_{}.bin", self.node_id))
    }

    /// Attempt to read the latest training metrics from the shared-memory file.
    /// Returns `None` if the file doesn't exist, is too small, or valid_flag is 0.
    pub fn read(&self) -> Option<TrainingMetrics> {
        let path = self.file_path();
        let file = File::open(&path).ok()?;

        // Safety: we only read from the mmap; the PyTorch side is the writer.
        let mmap = unsafe { Mmap::map(&file) }.ok()?;

        if mmap.len() < TRAINING_RECORD_SIZE {
            tracing::warn!(
                path = %path.display(),
                len = mmap.len(),
                expected = TRAINING_RECORD_SIZE,
                "Training metrics file too small"
            );
            return None;
        }

        let buf = &mmap[..TRAINING_RECORD_SIZE];
        let valid_flag = buf[0];
        if valid_flag == 0 {
            return None;
        }

        let timestamp_ms = i64::from_le_bytes(buf[1..9].try_into().ok()?);

        // Staleness check: discard data older than 5 seconds
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        if now_ms - timestamp_ms > 5_000 {
            tracing::debug!(
                node_id = %self.node_id,
                age_ms = now_ms - timestamp_ms,
                "Training metrics stale, discarding"
            );
            return None;
        }

        let step = u64::from_le_bytes(buf[9..17].try_into().ok()?);
        let loss = f32::from_le_bytes(buf[17..21].try_into().ok()?);
        let gradient_norm = f32::from_le_bytes(buf[21..25].try_into().ok()?);
        let learning_rate = f32::from_le_bytes(buf[25..29].try_into().ok()?);
        let throughput_tps = f32::from_le_bytes(buf[29..33].try_into().ok()?);
        let mfu_pct = f32::from_le_bytes(buf[33..37].try_into().ok()?);

        Some(TrainingMetrics {
            node_id: self.node_id.clone(),
            job_id: String::new(), // Not stored in the binary file
            timestamp_ms,
            step,
            loss,
            gradient_norm,
            learning_rate,
            throughput_tps,
            mfu_pct,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Write a valid 64-byte binary file matching the expected layout.
    fn write_test_file(
        path: &std::path::Path,
        valid_flag: u8,
        timestamp_ms: i64,
        step: u64,
        loss: f32,
        gradient_norm: f32,
        learning_rate: f32,
        throughput_tps: f32,
        mfu_pct: f32,
    ) {
        let mut buf = vec![0u8; 64]; // padded to 64 bytes
        buf[0] = valid_flag;
        buf[1..9].copy_from_slice(&timestamp_ms.to_le_bytes());
        buf[9..17].copy_from_slice(&step.to_le_bytes());
        buf[17..21].copy_from_slice(&loss.to_le_bytes());
        buf[21..25].copy_from_slice(&gradient_norm.to_le_bytes());
        buf[25..29].copy_from_slice(&learning_rate.to_le_bytes());
        buf[29..33].copy_from_slice(&throughput_tps.to_le_bytes());
        buf[33..37].copy_from_slice(&mfu_pct.to_le_bytes());
        // bytes 37..64 are zero padding
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&buf).unwrap();
        f.sync_all().unwrap();
    }

    #[test]
    fn test_read_valid_file() {
        let node_id = format!("test_valid_{}", std::process::id());
        let mmap_dir = std::env::temp_dir().join(format!(
            "solprobe_training_test_{}_valid",
            std::process::id()
        ));
        std::fs::create_dir_all(&mmap_dir).unwrap();
        let path = mmap_dir.join(format!("solprobe_training_{}.bin", node_id));

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        write_test_file(&path, 1, now_ms, 42, 2.5, 1.2, 3e-4, 5000.0, 45.0);

        let reader = TrainingMetricsReader::with_mmap_dir(node_id, mmap_dir.clone());
        let metrics = reader.read().expect("Should parse valid file");

        assert!((metrics.timestamp_ms - now_ms).abs() < 1000);
        assert_eq!(metrics.step, 42);
        assert!((metrics.loss - 2.5).abs() < 1e-6);
        assert!((metrics.gradient_norm - 1.2).abs() < 1e-6);
        assert!((metrics.learning_rate - 3e-4).abs() < 1e-7);
        assert!((metrics.throughput_tps - 5000.0).abs() < 1e-3);
        assert!((metrics.mfu_pct - 45.0).abs() < 1e-6);

        std::fs::remove_file(&path).ok();
        std::fs::remove_dir(&mmap_dir).ok();
    }

    #[test]
    fn test_read_invalid_flag_returns_none() {
        let node_id = format!("test_invalid_{}", std::process::id());
        let mmap_dir = std::env::temp_dir().join(format!(
            "solprobe_training_test_{}_invalid",
            std::process::id()
        ));
        std::fs::create_dir_all(&mmap_dir).unwrap();
        let path = mmap_dir.join(format!("solprobe_training_{}.bin", node_id));

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        write_test_file(&path, 0, now_ms, 10, 1.0, 0.5, 1e-4, 3000.0, 40.0);

        let reader = TrainingMetricsReader::with_mmap_dir(node_id, mmap_dir.clone());
        assert!(reader.read().is_none(), "valid_flag=0 should return None");

        std::fs::remove_file(&path).ok();
        std::fs::remove_dir(&mmap_dir).ok();
    }

    #[test]
    fn test_read_missing_file_returns_none() {
        let node_id = format!("test_missing_{}", std::process::id());
        let mmap_dir = std::env::temp_dir().join(format!(
            "solprobe_training_test_{}_missing",
            std::process::id()
        ));
        let reader = TrainingMetricsReader::with_mmap_dir(node_id, mmap_dir);
        assert!(reader.read().is_none(), "Missing file should return None");
    }

    #[test]
    fn test_file_path_uses_configured_mmap_dir() {
        let mmap_dir = PathBuf::from("/var/lib/solprobe/mmap");
        let reader = TrainingMetricsReader::with_mmap_dir("node-a".to_string(), mmap_dir.clone());
        assert_eq!(
            reader.file_path(),
            mmap_dir.join("solprobe_training_node-a.bin")
        );
    }

    #[test]
    fn test_new_defaults_to_tmp() {
        let reader = TrainingMetricsReader::new("node-a".to_string());
        assert_eq!(
            reader.file_path(),
            PathBuf::from("/tmp").join("solprobe_training_node-a.bin")
        );
    }
}
