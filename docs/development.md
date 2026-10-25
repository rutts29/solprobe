# Development and tests

Follow the [local installation steps](../README.md#run-locally), then run the relevant suite from the repository root:

```bash
cargo test --manifest-path sidecar/Cargo.toml --locked
backend/.venv/bin/python -m pytest backend/tests/ -q
npm --prefix dashboard test
npm --prefix dashboard run lint
npm --prefix dashboard run build
```

## Coverage

- Rust tests cover collector parsing, simulated faults, threshold detection, normalization, shared-memory telemetry, and job IDs. The real Apple Silicon collector test is conditional on macOS.
- Backend tests cover metric and alert APIs, authentication, stores, statistical detectors, policy evaluation, alert lifecycle, WebSocket behavior, and structured diagnosis responses. Provider calls are mocked.
- Dashboard regression tests cover the request-demo form, its server handlers, and WebSocket authentication. The production build also checks TypeScript.
- Training tests cover REST callback authentication and the Colab client.
- The Anchor programs have their own TypeScript tests under `solana/tests/` and are separate from the monitoring CI workflow.

The [CI workflow](../.github/workflows/ci.yml) builds and tests the sidecar and backend, then lints and builds the dashboard. The [September 7, 2026 run](https://github.com/rutts29/solprobe/actions/runs/34164106539) at commit `52a096d` passed 296 backend tests and 31 Rust tests on Linux. The dashboard lint and build passed in the same run. The dashboard regression command is available locally but is not currently a CI step.

The earlier local snapshot on August 12 recorded 32 Rust tests on macOS, 296 backend tests, and 17 dashboard tests, plus passing dashboard type and lint checks. These counts describe those runs rather than a promise that every environment selects the same tests.

Tests establish behavior for the paths they exercise. Optional live-provider calls, Colab execution, infrastructure provisioning, and chain submission use separate environments and are not run by the monitoring CI workflow.

## Generated files

`proto/` is the source for the Python and Rust message types. Cargo generates Rust bindings during the sidecar build. To regenerate Python bindings with the backend environment:

```bash
backend/.venv/bin/python -m grpc_tools.protoc \
  -I proto \
  --python_out=backend/app/generated \
  --pyi_out=backend/app/generated \
  --grpc_python_out=backend/app/generated \
  proto/metrics.proto proto/alerts.proto
```

## Repository and distribution files

Keep credentials, local environment files, `.runs/` logs, and local assistant or design-tool state out of commits. The existing `.gitignore` covers these development artifacts.

The root `LICENSE` is the project's MIT licence. Identical copies live in each independently packaged component so Python, JavaScript, Rust, and container distributions can retain the notice. Keep those copies and their SPDX metadata aligned when changing packaging.
