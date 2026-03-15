mod collectors;
mod config;
mod detectors;
mod normalizer;
mod proto;
mod simulator;
mod transport;

use std::sync::{Arc, Mutex};

use clap::Parser;
use tokio::signal;
use tokio::sync::watch;

use crate::collectors::dcgm::DcgmCollector;
use crate::collectors::diloco::DiLoCoMetricsReader;
use crate::collectors::training::TrainingMetricsReader;
use crate::collectors::MetricCollector;
use crate::config::SidecarConfig;
use crate::detectors::threshold::ThresholdDetector;
use crate::detectors::Detector;
use crate::simulator::Simulator;
use crate::transport::grpc::GrpcTransport;
use crate::transport::prometheus::PrometheusExporter;

#[derive(Parser, Debug, Clone)]
#[command(name = "solprobe-sidecar", about = "GPU metrics sidecar for SolProbe")]
pub struct Args {
    /// Run in simulation mode (no real GPU required)
    #[arg(long)]
    simulate: bool,

    /// Inject a fault type for testing: thermal_throttle, nccl_timeout, gradient_explosion, xid_79, memory_pressure
    #[arg(long)]
    inject_fault: Option<String>,

    /// Unique node identifier
    #[arg(long, default_value = "node-0")]
    node_id: String,

    /// Backend gRPC address
    #[arg(long, default_value = "http://localhost:50051")]
    backend_addr: String,

    /// Prometheus metrics port
    #[arg(long, default_value_t = 9100)]
    metrics_port: u16,

    /// Path to optional TOML config file
    #[arg(long, default_value = "solprobe.toml")]
    config: String,
}

/// Wrapper that adapts the Simulator into the MetricCollector trait.
/// Also reads from mmap files written by PyTorch callbacks, giving mmap
/// data priority over simulator-generated training/diloco metrics.
struct SimulatorCollector {
    sim: Mutex<Simulator>,
    training_reader: TrainingMetricsReader,
    diloco_reader: DiLoCoMetricsReader,
}

impl SimulatorCollector {
    fn new(node_id: String, inject_fault: Option<String>) -> Self {
        Self {
            sim: Mutex::new(Simulator::new(node_id.clone(), inject_fault)),
            training_reader: TrainingMetricsReader::new(node_id.clone()),
            diloco_reader: DiLoCoMetricsReader::new(node_id),
        }
    }
}

impl MetricCollector for SimulatorCollector {
    fn collect(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<
                        proto::solprobe::v1::MetricsBatch,
                        collectors::CollectorError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async {
            let mut batch = self
                .sim
                .lock()
                .map_err(|e| collectors::CollectorError::Other(format!("lock poisoned: {e}")))?
                .generate();

            // Override with mmap data when available (real training process running)
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    tracing::info!(
        node_id = %args.node_id,
        simulate = args.simulate,
        backend = %args.backend_addr,
        metrics_port = args.metrics_port,
        "SolProbe sidecar starting"
    );

    // Load configuration
    let cfg = SidecarConfig::load_or_default(&args.config);
    tracing::info!(?cfg, "Configuration loaded");

    // --- 1. Create the collector ---
    let collector: Box<dyn MetricCollector> = if args.simulate {
        tracing::info!("Running in SIMULATION mode");
        Box::new(SimulatorCollector::new(
            args.node_id.clone(),
            args.inject_fault.clone(),
        ))
    } else {
        tracing::info!("Running in DCGM mode (requires GPU)");
        Box::new(DcgmCollector::new())
    };

    // --- 2. Create the threshold detector ---
    let detector = ThresholdDetector::new(cfg.thresholds);

    // --- 3. Create the Prometheus exporter ---
    let prom_exporter = PrometheusExporter::new()
        .map_err(|e| format!("Failed to create Prometheus exporter: {e}"))?;
    let prom_handle = prom_exporter
        .serve(args.metrics_port)
        .await
        .map_err(|e| -> Box<dyn std::error::Error> { Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) })?;
    tracing::info!(port = args.metrics_port, "Prometheus exporter started");

    // --- 4. Create the gRPC transport ---
    let grpc_transport = Arc::new(tokio::sync::Mutex::new(GrpcTransport::new(
        args.backend_addr.clone(),
    )));

    // Attempt initial connection (non-blocking — will retry in the loop)
    {
        let mut transport = grpc_transport.lock().await;
        transport.try_connect().await;
    }

    // --- 5. Shutdown signal ---
    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

    let shutdown_handle = tokio::spawn(async move {
        let ctrl_c = signal::ctrl_c();
        #[cfg(unix)]
        {
            let mut sigterm =
                signal::unix::signal(signal::unix::SignalKind::terminate())
                    .expect("Failed to register SIGTERM handler");
            tokio::select! {
                _ = ctrl_c => {
                    tracing::info!("Received SIGINT, shutting down");
                }
                _ = sigterm.recv() => {
                    tracing::info!("Received SIGTERM, shutting down");
                }
            }
        }
        #[cfg(not(unix))]
        {
            ctrl_c.await.expect("Failed to listen for Ctrl+C");
            tracing::info!("Received SIGINT, shutting down");
        }
        let _ = shutdown_tx.send(true);
    });

    // --- 6. Main collection loop: every 1 second ---
    let is_nccl_timeout = args
        .inject_fault
        .as_deref()
        .map_or(false, |f| f == "nccl_timeout");
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    let mut tick_count: u64 = 0;

    tracing::info!("Entering main collection loop");

    loop {
        tokio::select! {
            _ = interval.tick() => {}
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    tracing::info!("Shutdown signal received, exiting collection loop");
                    break;
                }
            }
        }

        tick_count += 1;

        // Simulate NCCL timeout: stop producing metrics after 5 ticks
        if is_nccl_timeout && tick_count > 5 {
            tracing::warn!("NCCL timeout injected — halting metric collection (simulating hang)");
            // Wait for shutdown signal
            let _ = shutdown_rx.changed().await;
            break;
        }

        // Collect metrics
        let batch = match collector.collect().await {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(error = %e, "Failed to collect metrics");
                continue;
            }
        };

        // Run detector
        let alerts = detector.check(&batch);
        if !alerts.is_empty() {
            tracing::warn!(count = alerts.len(), "Detected anomalies");
        }

        // Send alerts via gRPC
        for alert in &alerts {
            tracing::warn!(
                alert_id = %alert.alert_id,
                alert_type = alert.alert_type,
                severity = alert.severity,
                description = %alert.description,
                "Alert raised"
            );
            let transport = grpc_transport.clone();
            let alert_clone = alert.clone();
            tokio::spawn(async move {
                let mut t = transport.lock().await;
                if let Err(e) = t.report_alert(alert_clone).await {
                    tracing::warn!(error = %e, "Failed to report alert to backend");
                }
            });
        }

        // Update Prometheus gauges
        prom_exporter.update(&batch);

        // Stream metrics via gRPC
        {
            let transport = grpc_transport.clone();
            let batch_clone = batch;
            tokio::spawn(async move {
                let mut t = transport.lock().await;
                if let Err(e) = t.stream_metrics(batch_clone).await {
                    tracing::debug!(error = %e, "Failed to stream metrics to backend");
                }
            });
        }

        // Log a summary
        if tick_count % 10 == 0 {
            tracing::info!(
                tick = tick_count,
                alerts = alerts.len(),
                "Collection loop heartbeat"
            );
        }
    }

    tracing::info!("Waiting for background tasks to finish");
    prom_handle.abort();
    shutdown_handle.abort();
    tracing::info!("SolProbe sidecar stopped");

    Ok(())
}
