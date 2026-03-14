use super::{CollectorError, MetricCollector};
use crate::proto::solprobe::v1::MetricsBatch;
use std::future::Future;
use std::pin::Pin;

/// Stub DCGM collector — returns an error when no GPU is present.
/// TODO: Integrate with real DCGM library on GCP GPU nodes.
pub struct DcgmCollector;

impl DcgmCollector {
    pub fn new() -> Self {
        Self
    }
}

impl MetricCollector for DcgmCollector {
    fn collect(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<MetricsBatch, CollectorError>> + Send + '_>> {
        Box::pin(async {
            Err(CollectorError::Unavailable(
                "DCGM not available — use --simulate".to_string(),
            ))
        })
    }
}
