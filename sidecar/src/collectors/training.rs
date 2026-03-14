use crate::proto::solprobe::v1::TrainingMetrics;
use memmap2::Mmap;
use std::fs::File;
use std::path::PathBuf;

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
/// File path: `/tmp/solprobe_training_{node_id}.bin`
pub struct TrainingMetricsReader {
    node_id: String,
}

impl TrainingMetricsReader {
    pub fn new(node_id: String) -> Self {
        Self { node_id }
    }

    fn file_path(&self) -> PathBuf {
        PathBuf::from(format!("/tmp/solprobe_training_{}.bin", self.node_id))
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
