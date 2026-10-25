# Configuration and API reference

## Local services

| Service | Default address | Configuration |
| --- | --- | --- |
| Backend HTTP | `http://127.0.0.1:8000` | Uvicorn `--host` and `--port` |
| Backend gRPC | Port `50051` | `GRPC_PORT` on the backend |
| Dashboard | `http://localhost:3000` | Next.js `--hostname` and `--port` |
| Sidecar Prometheus | Port `9100` | Sidecar `--metrics-port` |
| Sidecar backend connection | `http://localhost:50051` | Sidecar `--backend-addr` |
| Training shared memory | `/tmp` | `SOLPROBE_MMAP_DIR` or `--mmap-dir` |

Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` when starting the dashboard so it can reach the backend. The trainer and sidecar must use the same node ID and shared-memory directory. The sidecar's `--job-id` associates otherwise unlabelled training metrics and alerts with a registered job.

The backend stores metrics, jobs, policies, alerts, and diagnoses in memory. Restarting it clears that state. The Apple Silicon collector reads utilization and memory from IOKit; unavailable temperature and power fields appear as missing values in the UI.

## Authentication and network scope

Set `SOLPROBE_API_KEY` on the backend and enter the same value in the dashboard. REST clients send it in the `X-SolProbe-API-Key` header; the dashboard includes it when connecting its WebSocket stream. The README's `solprobe-demo-key` is a shared local-demo value.

API-key checks protect REST and WebSocket control-plane routes. This is not a multi-user access system. gRPC ingestion and metrics endpoints should remain on a trusted local or private network. The HTTP bind address does not restrict the separate gRPC listener. Add appropriate network isolation before exposing services beyond your machine.

## Optional diagnosis

Set `ANTHROPIC_API_KEY` in the backend environment to enable provider-backed diagnosis. Requests send alert evidence and surrounding telemetry to Anthropic and use the configured provider account.

The diagnosis workflow validates structured responses, caches matching results, and applies per-node rate limits. For supported alert types, local heuristics provide recovery suggestions when an initialized client encounters an API error or a rate limit. If the client cannot initialize, including when no key is configured, the diagnosis is recorded as failed. Metrics, detectors, monitoring policies, and alert investigation remain available.

Local tests exercise provider responses through mocks. See [development](development.md) for their coverage and commands.

## API routes

FastAPI serves interactive API documentation at `/docs` while the backend is running.

| Path | Purpose |
| --- | --- |
| `GET /api/v1/health` | Backend health and sidecar count |
| `POST /api/v1/metrics/batches` | REST metrics batch ingestion |
| `GET /api/v1/nodes` | Node status and metric history |
| `GET /api/v1/alerts` | Alert queries and filtering |
| `POST /api/v1/diagnoses` | Manual diagnosis |
| `GET /api/v1/jobs` | Training job list |
| `POST /api/v1/jobs` | Register a training job |
| `PATCH /api/v1/jobs/{job_id}/status` | Update a job's lifecycle state |
| `GET/POST /api/v1/policies` | List or create monitoring policies |
| `PATCH /api/v1/policies/{policy_id}` | Update a monitoring policy |
| `WS /ws/stream` | Alerts, diagnoses, and metric summaries |
| `GET /metrics` | Prometheus monitoring metrics |

## Request-demo form hosting

The static landing and dashboard include the same request-demo form. The static Vercel deployment uses `landing/api/request-demo.js`; the Next.js dashboard uses `dashboard/src/app/api/request-demo/route.ts`. Both send through Resend from the server runtime.

Configure the following environment variables in the deployment that serves the form:

```text
RESEND_API_KEY=
REQUEST_DEMO_TO_EMAIL=
REQUEST_DEMO_FROM_EMAIL=
```

The sender must use a domain verified in Resend. `landing/.env.example` contains blank keys for local Vercel development. Credentials and the recipient address stay on the server.

Both handlers accept a required email and optional name, role, and interest, check a honeypot field, and limit request bodies to 16 KB. An unconfigured handler returns an explicit configuration error. Form hosting is separate from the local monitoring stack.
