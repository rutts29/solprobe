pub mod dcgm;
pub mod diloco;
pub mod training;

use crate::proto::solprobe::v1::MetricsBatch;
use std::fmt;
use std::future::Future;
use std::pin::Pin;

/// Errors that can occur during metric collection.
#[derive(Debug)]
pub enum CollectorError {
    /// The underlying collector backend is unavailable (e.g., no GPU).
    Unavailable(String),
    /// An I/O or system error.
    Io(std::io::Error),
    /// Generic collection error.
    Other(String),
}

impl fmt::Display for CollectorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CollectorError::Unavailable(msg) => write!(f, "collector unavailable: {msg}"),
            CollectorError::Io(e) => write!(f, "I/O error: {e}"),
            CollectorError::Other(msg) => write!(f, "collection error: {msg}"),
        }
    }
}

impl std::error::Error for CollectorError {}

impl From<std::io::Error> for CollectorError {
    fn from(e: std::io::Error) -> Self {
        CollectorError::Io(e)
    }
}

/// Trait for collecting a batch of metrics from some source.
pub trait MetricCollector: Send + Sync {
    fn collect(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<MetricsBatch, CollectorError>> + Send + '_>>;
}
