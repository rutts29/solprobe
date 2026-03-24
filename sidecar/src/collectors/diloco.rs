use crate::proto::solprobe::v1::DiLoCoMetrics;
use memmap2::Mmap;
use std::fs::File;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Expected binary layout size (little-endian):
///   u8  valid_flag         (1 byte)
///   i64 timestamp_ms       (8 bytes)
///   u64 inner_step         (8 bytes)
///   u64 outer_step         (8 bytes)
///   f32 inner_loss         (4 bytes)
///   f32 outer_loss         (4 bytes)
///   f32 pseudo_grad_norm   (4 bytes)
///   f32 sync_duration_ms   (4 bytes)
///   f32 worker_speed_ratio (4 bytes)
///   u8  is_straggler       (1 byte)
///   Total: 46 bytes
///
const DILOCO_RECORD_SIZE: usize = 46;

/// Reads DiLoCoMetrics from a memory-mapped file written by the training loop.
/// File path: `/tmp/solprobe_diloco_{node_id}.bin`
pub struct DiLoCoMetricsReader {
    node_id: String,
}

impl DiLoCoMetricsReader {
    pub fn new(node_id: String) -> Self {
        Self { node_id }
    }

    fn file_path(&self) -> PathBuf {
        PathBuf::from(format!("/tmp/solprobe_diloco_{}.bin", self.node_id))
    }

    /// Attempt to read the latest DiLoCo metrics from the shared-memory file.
    /// Returns `None` if the file doesn't exist, is too small, or valid_flag is 0.
    pub fn read(&self) -> Option<DiLoCoMetrics> {
        let path = self.file_path();
        let file = File::open(&path).ok()?;

        let mmap = unsafe { Mmap::map(&file) }.ok()?;

        if mmap.len() < DILOCO_RECORD_SIZE {
            tracing::warn!(
                path = %path.display(),
                len = mmap.len(),
                expected = DILOCO_RECORD_SIZE,
                "DiLoCo metrics file too small"
            );
            return None;
        }

        let buf = &mmap[..];
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
                "DiLoCo metrics stale, discarding"
            );
            return None;
        }

        let inner_step = u64::from_le_bytes(buf[9..17].try_into().ok()?);
        let outer_step = u64::from_le_bytes(buf[17..25].try_into().ok()?);
        let inner_loss = f32::from_le_bytes(buf[25..29].try_into().ok()?);
        let outer_loss = f32::from_le_bytes(buf[29..33].try_into().ok()?);
        let pseudo_grad_norm = f32::from_le_bytes(buf[33..37].try_into().ok()?);
        let sync_duration_ms = f32::from_le_bytes(buf[37..41].try_into().ok()?);
        let worker_speed_ratio = f32::from_le_bytes(buf[41..45].try_into().ok()?);
        let is_straggler = buf[45] != 0;

        Some(DiLoCoMetrics {
            node_id: self.node_id.clone(),
            job_id: String::new(),
            timestamp_ms,
            inner_step,
            outer_step,
            inner_loss,
            outer_loss,
            pseudo_grad_norm,
            sync_duration_ms,
            worker_speed_ratio,
            is_straggler,
        })
    }
}
