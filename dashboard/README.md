# SolProbe dashboard

The Next.js dashboard presents nodes, training jobs, alerts, monitoring policies, and diagnosis evidence from the SolProbe backend. REST provides queries and control actions; WebSocket updates refresh monitoring activity.

For a complete local setup, use the [project quick start](../README.md#run-locally). To run only the dashboard after the backend is available:

```bash
npm ci --ignore-scripts
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8000/ws/stream \
npm run dev -- --hostname 127.0.0.1
```

Open [localhost:3000](http://localhost:3000) and enter the API key configured on the backend. The dashboard stores that key in the browser's local storage for subsequent REST and WebSocket connections.

```bash
npm test
npm run lint
npm run build
```

The request-demo form has separate server-side email configuration; see [configuration](../docs/configuration.md#request-demo-form-hosting). The attestation view contains labelled samples from the [compute verification experiments](../solana/README.md).

[Apache License 2.0](LICENSE). Copyright (c) 2026 Ruttansh Bhatelia.
