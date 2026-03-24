use std::sync::Arc;

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Router};
use prometheus::{Encoder, GaugeVec, Opts, Registry, TextEncoder};

use crate::proto::solprobe::v1::MetricsBatch;
use crate::normalizer;

/// Prometheus metrics exporter served over HTTP.
#[derive(Clone)]
pub struct PrometheusExporter {
    registry: Arc<Registry>,
    gpu_temp: GaugeVec,
    gpu_utilization: GaugeVec,
    gpu_memory_used_pct: GaugeVec,
    gpu_power_watts: GaugeVec,
    xid_errors: GaugeVec,
    ecc_dbe_count: GaugeVec,
    ecc_sbe_count: GaugeVec,
    clock_throttle_reasons: GaugeVec,
    pcie_replay_counter: GaugeVec,
    sm_active_pct: GaugeVec,
    tensor_active_pct: GaugeVec,
}

impl PrometheusExporter {
    pub fn new() -> Result<Self, prometheus::Error> {
        let registry = Registry::new();

        let gpu_temp = GaugeVec::new(
            Opts::new("solprobe_gpu_temp", "GPU temperature in Celsius"),
            &["node_id", "gpu_index"],
        )?;
        let gpu_utilization = GaugeVec::new(
            Opts::new("solprobe_gpu_utilization", "GPU utilization percentage"),
            &["node_id", "gpu_index"],
        )?;
        let gpu_memory_used_pct = GaugeVec::new(
            Opts::new("solprobe_gpu_memory_used_pct", "GPU memory usage percentage"),
            &["node_id", "gpu_index"],
        )?;
        let gpu_power_watts = GaugeVec::new(
            Opts::new("solprobe_gpu_power_watts", "GPU power usage in watts"),
            &["node_id", "gpu_index"],
        )?;
        let xid_errors = GaugeVec::new(
            Opts::new("solprobe_xid_errors", "XID error code"),
            &["node_id", "gpu_index"],
        )?;
        let ecc_dbe_count = GaugeVec::new(
            Opts::new("solprobe_ecc_dbe_count", "ECC double-bit error count"),
            &["node_id", "gpu_index"],
        )?;
        let ecc_sbe_count = GaugeVec::new(
            Opts::new("solprobe_ecc_sbe_count", "ECC single-bit error count"),
            &["node_id", "gpu_index"],
        )?;
        let clock_throttle_reasons = GaugeVec::new(
            Opts::new("solprobe_clock_throttle_reasons", "Clock throttle reason bitmask"),
            &["node_id", "gpu_index"],
        )?;
        let pcie_replay_counter = GaugeVec::new(
            Opts::new("solprobe_pcie_replay_counter", "PCIe replay counter"),
            &["node_id", "gpu_index"],
        )?;
        let sm_active_pct = GaugeVec::new(
            Opts::new("solprobe_sm_active_pct", "SM active percentage"),
            &["node_id", "gpu_index"],
        )?;
        let tensor_active_pct = GaugeVec::new(
            Opts::new("solprobe_tensor_active_pct", "Tensor core active percentage"),
            &["node_id", "gpu_index"],
        )?;

        registry.register(Box::new(gpu_temp.clone()))?;
        registry.register(Box::new(gpu_utilization.clone()))?;
        registry.register(Box::new(gpu_memory_used_pct.clone()))?;
        registry.register(Box::new(gpu_power_watts.clone()))?;
        registry.register(Box::new(xid_errors.clone()))?;
        registry.register(Box::new(ecc_dbe_count.clone()))?;
        registry.register(Box::new(ecc_sbe_count.clone()))?;
        registry.register(Box::new(clock_throttle_reasons.clone()))?;
        registry.register(Box::new(pcie_replay_counter.clone()))?;
        registry.register(Box::new(sm_active_pct.clone()))?;
        registry.register(Box::new(tensor_active_pct.clone()))?;

        Ok(Self {
            registry: Arc::new(registry),
            gpu_temp,
            gpu_utilization,
            gpu_memory_used_pct,
            gpu_power_watts,
            xid_errors,
            ecc_dbe_count,
            ecc_sbe_count,
            clock_throttle_reasons,
            pcie_replay_counter,
            sm_active_pct,
            tensor_active_pct,
        })
    }

    /// Update gauge values from a MetricsBatch.
    pub fn update(&self, batch: &MetricsBatch) {
        for gpu in &batch.gpu {
            let idx = gpu.gpu_index.to_string();
            let labels = &[gpu.node_id.as_str(), idx.as_str()];

            self.gpu_temp
                .with_label_values(labels)
                .set(gpu.gpu_temp_c as f64);
            self.gpu_utilization
                .with_label_values(labels)
                .set(gpu.gpu_utilization_pct as f64);

            let mem_pct = normalizer::memory_used_pct(gpu.fb_used_mb, gpu.fb_free_mb);
            self.gpu_memory_used_pct
                .with_label_values(labels)
                .set(mem_pct as f64);

            self.gpu_power_watts
                .with_label_values(labels)
                .set(gpu.power_usage_w as f64);
            self.xid_errors
                .with_label_values(labels)
                .set(gpu.xid_errors as f64);
            self.ecc_dbe_count
                .with_label_values(labels)
                .set(gpu.ecc_dbe_count as f64);
            self.ecc_sbe_count
                .with_label_values(labels)
                .set(gpu.ecc_sbe_count as f64);
            self.clock_throttle_reasons
                .with_label_values(labels)
                .set(gpu.clock_throttle_reasons as f64);
            self.pcie_replay_counter
                .with_label_values(labels)
                .set(gpu.pcie_replay_counter as f64);
            self.sm_active_pct
                .with_label_values(labels)
                .set(gpu.sm_active_pct as f64);
            self.tensor_active_pct
                .with_label_values(labels)
                .set(gpu.tensor_active_pct as f64);
        }
    }

    /// Build the axum Router for serving /metrics.
    pub fn router(&self) -> Router {
        Router::new()
            .route("/metrics", get(metrics_handler))
            .with_state(self.registry.clone())
    }

    /// Spawn the HTTP server on the given port.
    /// Returns a JoinHandle that runs until shutdown.
    pub async fn serve(
        &self,
        port: u16,
    ) -> Result<tokio::task::JoinHandle<()>, Box<dyn std::error::Error + Send + Sync>> {
        let app = self.router();
        let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
        let listener = tokio::net::TcpListener::bind(addr).await?;
        tracing::info!(port = port, "Prometheus exporter listening");

        let handle = tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::error!(error = %e, "Prometheus HTTP server error");
            }
        });

        Ok(handle)
    }
}

/// Handler for GET /metrics — renders Prometheus text format.
async fn metrics_handler(
    State(registry): State<Arc<Registry>>,
) -> impl IntoResponse {
    let encoder = TextEncoder::new();
    let metric_families = registry.gather();
    let mut buffer = Vec::new();

    match encoder.encode(&metric_families, &mut buffer) {
        Ok(()) => (
            StatusCode::OK,
            [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
            buffer,
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error = %e, "Failed to encode Prometheus metrics");
            (StatusCode::INTERNAL_SERVER_ERROR, "encoding error").into_response()
        }
    }
}
