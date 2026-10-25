# Follow a training run with SolProbe

This walkthrough connects the bundled TinyGPT trainer to SolProbe. It uses the code in this repository and runs on CPU, Apple MPS, or CUDA through PyTorch. The Rust sidecar reads the trainer's shared-memory metrics and sends them to the backend alongside simulated hardware telemetry or Apple Silicon metrics.

## Start the monitoring stack

Complete the installation and start the backend and dashboard using the [README](README.md#run-locally). Stop the simulated sidecar from that example before starting the one below, so only one process uses metrics port 9100.

From the repository root, create a shared metrics directory and start the sidecar:

```bash
mkdir -p .runs/tinygpt/mmap
cargo run --manifest-path sidecar/Cargo.toml -- \
  --simulate --node-id node-0 --job-id tinygpt-demo \
  --mmap-dir "$PWD/.runs/tinygpt/mmap"
```

On an Apple Silicon Mac, use `--apple-gpu` instead of `--simulate` for real GPU utilization and memory readings. The simulated collector also accepts the trainer's real metrics; those replace its synthetic training values while the trainer is running.

## Register the run

In another terminal, from the repository root:

```bash
curl --fail-with-body http://127.0.0.1:8000/api/v1/jobs \
  -H 'Content-Type: application/json' \
  -H 'X-SolProbe-API-Key: solprobe-demo-key' \
  -d '{"job_id":"tinygpt-demo","name":"TinyGPT training demo","config":{"trainer":"training.train_mps"},"node_ids":["node-0"]}'

curl --fail-with-body -X PATCH \
  http://127.0.0.1:8000/api/v1/jobs/tinygpt-demo/status \
  -H 'Content-Type: application/json' \
  -H 'X-SolProbe-API-Key: solprobe-demo-key' \
  -d '{"status":"running"}'
```

## Train and inject a gradient spike

Install PyTorch into a separate environment, then run the bundled trainer:

```bash
python3 -m venv training/.venv
training/.venv/bin/python -m pip install torch
training/.venv/bin/python -m training.train_mps \
  --node-id node-0 --mmap-dir "$PWD/.runs/tinygpt/mmap" \
  --steps 120 --slow-step-ms 1000 \
  --inject-spike-at 30 --spike-duration 10 --spike-magnitude 1000
```

The trainer selects MPS when available, then CUDA, then CPU. Its callback records loss, gradient norm, learning rate, and throughput after each step. The deliberate slowdown gives the sidecar's one-second polling loop time to observe the values. The injected fault multiplies gradients for ten steps.

Open the dashboard's **Training** page and select **TinyGPT training demo**. Compare the training charts around the injected spike, then inspect **Alerts** for the associated evidence. The **Nodes** page shows the hardware stream. Without an Anthropic key, use metrics, alert evidence, and investigation notes; provider-backed diagnosis is optional.

When training finishes, mark the run complete:

```bash
curl --fail-with-body -X PATCH \
  http://127.0.0.1:8000/api/v1/jobs/tinygpt-demo/status \
  -H 'Content-Type: application/json' \
  -H 'X-SolProbe-API-Key: solprobe-demo-key' \
  -d '{"status":"completed"}'
```

Stop the sidecar, dashboard, and backend with Ctrl+C in their terminals. Backend state lasts for that process's lifetime.

## Optional Nanochat integration

`scripts/demo_nanochat_solprobe.sh` is a separate Apple Silicon launcher. `make demo` starts its backend, dashboard, and Apple GPU sidecar and registers a Nanochat-labelled job. It does **not** start the bundled TinyGPT trainer.

Setting `SOLPROBE_DEMO_TRAIN=1` asks that launcher to run `runs/run_solprobe_mps_smoke.sh` from a patched Nanochat checkout. Supply that checkout through `NANOCHAT_DIR`; its default is `.worktrees/nanochat-solprobe`. The checkout is not included here. Use the TinyGPT steps above for a demo that needs only this repository.

The launcher accepts `--run-id`, `NODE_ID`, `SOLPROBE_MMAP_DIR`, and port overrides, and writes component logs to `.runs/<run_id>/`. See its [environment options](scripts/demo_nanochat_solprobe.sh) before connecting an existing Nanochat workspace.

## Other telemetry sources

The [Colab guide](docs/colab.md) describes notebook ingestion over authenticated REST. This path does not require the Rust sidecar inside the notebook. A reachable backend and the API key are required; GPU availability depends on the Colab runtime.
