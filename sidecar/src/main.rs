use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "solprobe-sidecar", about = "GPU metrics sidecar for SolProbe")]
struct Args {
    /// Run in simulation mode (no real GPU required)
    #[arg(long)]
    simulate: bool,

    /// Inject a fault type for testing: thermal_throttle, nccl_timeout, gradient_explosion, xid_79
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
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();

    tracing::info!(
        node_id = %args.node_id,
        simulate = args.simulate,
        backend = %args.backend_addr,
        "SolProbe sidecar starting"
    );

    // TODO: Agents will fill in collector loop, detectors, gRPC transport, Prometheus exporter

    Ok(())
}
