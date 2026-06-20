# Google Colab T4 Integration

SolProbe can ingest Colab training telemetry without running the Rust sidecar in the notebook.

## What Runs Where

- SolProbe backend/dashboard: your machine, a VM, or any reachable deployment.
- Colab notebook: trains a tiny PyTorch model on the assigned runtime.
- Metrics path: Colab posts authenticated REST batches to `/api/v1/metrics/batches`.

## Use It

1. Start SolProbe with `make demo`.
2. Expose backend port `8000` with a tunnel or deploy the backend somewhere public.
3. Open the dashboard Training page and download `/colab/solprobe_colab_t4_demo.ipynb`.
4. In Colab, set runtime to T4 GPU.
5. Set `BACKEND_URL` to the public backend URL and `API_KEY` to `solprobe-demo-key`.
6. Run all cells.

The Training page will show a `Google Colab T4 tiny training` job with live training loss, throughput, MFU estimate, and GPU snapshot metrics.

Free Colab GPU access is best-effort. If Colab assigns CPU, the notebook still runs but reports zero GPU utilization.
