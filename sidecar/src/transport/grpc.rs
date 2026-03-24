use std::time::{Duration, Instant};

use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::proto::solprobe::v1::{
    sol_probe_service_client::SolProbeServiceClient, Alert, MetricsBatch,
};

/// gRPC transport client that streams metrics and reports alerts to the backend.
pub struct GrpcTransport {
    backend_addr: String,
    client: Option<SolProbeServiceClient<Channel>>,
    last_connect_attempt: Option<Instant>,
}

impl GrpcTransport {
    pub fn new(backend_addr: String) -> Self {
        Self {
            backend_addr,
            client: None,
            last_connect_attempt: None,
        }
    }

    /// Connect to the backend with retry and exponential backoff.
    #[allow(dead_code)]
    pub async fn connect(&mut self) -> Result<(), tonic::transport::Error> {
        let mut delay = Duration::from_secs(1);
        let max_delay = Duration::from_secs(30);
        let max_retries = 5;

        for attempt in 1..=max_retries {
            tracing::info!(
                addr = %self.backend_addr,
                attempt = attempt,
                "Connecting to backend gRPC service"
            );

            match SolProbeServiceClient::connect(self.backend_addr.clone()).await {
                Ok(client) => {
                    tracing::info!(addr = %self.backend_addr, "Connected to backend");
                    self.client = Some(client);
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!(
                        addr = %self.backend_addr,
                        attempt = attempt,
                        error = %e,
                        retry_in = ?delay,
                        "Failed to connect to backend"
                    );
                    if attempt == max_retries {
                        return Err(e);
                    }
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(max_delay);
                }
            }
        }

        unreachable!()
    }

    /// Try to connect, but don't fail if the backend is unavailable.
    /// Returns true if connected, false otherwise.
    /// Throttled to at most one attempt every 5 seconds.
    pub async fn try_connect(&mut self) -> bool {
        if let Some(last) = self.last_connect_attempt {
            if last.elapsed() < Duration::from_secs(5) {
                tracing::trace!("Reconnect throttled, last attempt was {:?} ago", last.elapsed());
                return false;
            }
        }
        self.last_connect_attempt = Some(Instant::now());
        match SolProbeServiceClient::connect(self.backend_addr.clone()).await {
            Ok(client) => {
                tracing::info!(addr = %self.backend_addr, "Connected to backend");
                self.client = Some(client);
                true
            }
            Err(e) => {
                tracing::warn!(
                    addr = %self.backend_addr,
                    error = %e,
                    "Backend unavailable, will retry later"
                );
                false
            }
        }
    }

    /// Stream a single metrics batch to the backend via client-streaming RPC.
    /// If not connected, attempts reconnection.
    pub async fn stream_metrics(&mut self, batch: MetricsBatch) -> Result<(), String> {
        if self.client.is_none() {
            if !self.try_connect().await {
                return Err("Not connected to backend".to_string());
            }
        }

        let client = self.client.as_mut()
            .ok_or_else(|| "client not connected".to_string())?;
        let (tx, rx) = mpsc::channel(1);
        if tx.send(batch).await.is_err() {
            return Err("Failed to enqueue batch".to_string());
        }
        drop(tx); // close the sender so the stream ends

        let stream = tokio_stream::wrappers::ReceiverStream::new(rx);

        match client.stream_metrics(stream).await {
            Ok(response) => {
                let ack = response.into_inner();
                if !ack.ok {
                    tracing::warn!(message = %ack.message, "Backend NAK on StreamMetrics");
                }
                Ok(())
            }
            Err(status) => {
                tracing::error!(code = ?status.code(), message = %status.message(), "StreamMetrics RPC failed");
                // Reset client to force reconnect on next call
                self.client = None;
                Err(format!("gRPC error: {}", status.message()))
            }
        }
    }

    /// Report a single alert to the backend immediately via unary RPC.
    pub async fn report_alert(&mut self, alert: Alert) -> Result<(), String> {
        if self.client.is_none() {
            if !self.try_connect().await {
                return Err("Not connected to backend".to_string());
            }
        }

        let client = self.client.as_mut()
            .ok_or_else(|| "client not connected".to_string())?;

        match client.report_alert(alert).await {
            Ok(response) => {
                let ack = response.into_inner();
                tracing::info!(alert_id = %ack.alert_id, ok = ack.ok, "Alert acknowledged");
                Ok(())
            }
            Err(status) => {
                tracing::error!(code = ?status.code(), message = %status.message(), "ReportAlert RPC failed");
                self.client = None;
                Err(format!("gRPC error: {}", status.message()))
            }
        }
    }
}
