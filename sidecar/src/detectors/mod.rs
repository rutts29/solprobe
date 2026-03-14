pub mod threshold;

use crate::proto::solprobe::v1::{Alert, MetricsBatch};

/// Trait for edge-based anomaly detectors that inspect a MetricsBatch
/// and return zero or more alerts.
pub trait Detector: Send + Sync {
    fn check(&self, batch: &MetricsBatch) -> Vec<Alert>;
}
