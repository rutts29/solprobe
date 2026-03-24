I'll do a thorough review of all files in the infra/ directory. Let me start by exploring the full structure.

---

Now I have a complete picture of the entire infra. Let me compile the full review.

---

# SolProbe Infrastructure Deep Code Review

## Summary Counts
- BREAKING: 4
- HIGH: 14
- MEDIUM: 13
- LOW: 8
- ENHANCEMENT: 6

---

## BREAKING Issues

---

### Finding 1
**File:Line** — `infra/helm/solprobe/templates/prometheus-config.yaml:17` and `infra/k8s/monitoring/prometheus-config.yaml:15`
**Category** — Reliability
**Risk Level** — BREAKING
**Description** — Both Prometheus configs reference `rule_files: - /etc/prometheus/alert_rules.yml`, but in the Helm chart, `alert_rules.yml` is never mounted or projected into the `prometheus-config` ConfigMap. Only `prometheus.yml` is in that ConfigMap. The k8s manifest version correctly embeds `alert_rules.yml` as a second key in the same ConfigMap. In the Helm deployment, Prometheus will start but all alert rules will silently never be evaluated — no alerts will ever fire in a Helm-deployed environment.
**Suggested Fix** — Add `alert_rules.yml` as a second key in the Helm `prometheus-config.yaml` ConfigMap template (same pattern as the k8s version), or use a separate ConfigMap and mount it alongside.

---

### Finding 2
**File:Line** — `infra/k8s/monitoring/alertmanager-config.yaml` / entire infra
**Category** — Reliability
**Risk Level** — BREAKING
**Description** — Alertmanager is configured as a target in both Prometheus configs (`alertmanager:9093`) and has a ConfigMap with routing rules, but there is no Alertmanager Deployment or Service anywhere in the infra. The `alertmanager-config.yaml` creates only a ConfigMap. Prometheus will fail its startup health check or log continuous errors trying to reach `alertmanager:9093`. If Prometheus exits this connection with a fatal error, no metrics are scraped at all.
**Suggested Fix** — Add an Alertmanager Deployment and Service manifest (or Helm template) that mounts the `alertmanager-config` ConfigMap. Alternatively, remove the `alerting:` block from Prometheus config until Alertmanager is deployed.

---

### Finding 3
**File:Line** — `infra/k8s/sidecar/daemonset.yaml:43` and `infra/helm/solprobe/templates/sidecar-daemonset.yaml:45`
**Category** — Architecture / Reliability
**Risk Level** — BREAKING
**Description** — The sidecar's `--backend-addr` is set to `http://solprobe-backend:50051`. Port 50051 is the gRPC port but the scheme is `http://`. gRPC over standard HTTP/1.1 does not work — gRPC requires HTTP/2. A Rust tonic client connecting with scheme `http://` may negotiate HTTP/1.1 instead of HTTP/2, causing the connection to fail entirely. The gRPC transport layer will get a protocol framing error. Every node's sidecar will fail to report metrics to the backend.
**Suggested Fix** — Change `--backend-addr` to `http://solprobe-backend:50051` only if the tonic client is configured for insecure gRPC with forced HTTP/2 (`Endpoint::from_shared(...).http2_prior_knowledge()`). If not, the scheme must be removed or the URL format must match what tonic expects (just the authority `solprobe-backend:50051`). Audit the Rust sidecar's gRPC connection setup to confirm.

---

### Finding 4
**File:Line** — `infra/prometheus.yml` (root-level file used by docker-compose)
**Category** — Reliability
**Risk Level** — BREAKING
**Description** — The root `prometheus.yml` has no `rule_files` and no `alerting` block, so no alerts fire in the local dev/docker-compose environment. Worse, this file has no `scrape_metrics_path` configured for the backend — the backend exposes `/metrics` but `static_configs: targets: ["backend:8000"]` will default-scrape `/metrics`. That part is fine. However, the sidecar also exposes on port 9100 but is scraped as `sidecar:9100` — this only works if the docker-compose service is named exactly `sidecar`. It is, so this particular issue is not breaking in docker-compose, but the lack of any alerts means the local smoke test cannot validate alerting at all.
**Suggested Fix** — Add `rule_files` and an embedded alerting block to the root `prometheus.yml`, or explicitly note it is a dev-only config. Not a prod blocker but breaks local alerting validation.

---

## HIGH Issues

---

### Finding 5
**File:Line** — `backend/Dockerfile:1` and `backend/Dockerfile:23`
**Category** — Security
**Risk Level** — HIGH
**Description** — The backend Dockerfile has no `USER` instruction. The container runs as root (UID 0). Even though Kubernetes enforces `runAsUser: 1000` via the pod's `securityContext`, this enforcement is at the K8s layer. In docker-compose (dev), the container runs as root. Additionally, the image itself has no non-root user baked in, making it non-compliant with container best practices and any container image scanning policy that rejects images without a declared non-root USER.
**Suggested Fix** — Add `RUN adduser --system --no-create-home --uid 1000 appuser` and `USER appuser` before the `CMD` instruction. Mirror the same UID (1000) the pod securityContext assumes.

---

### Finding 6
**File:Line** — `sidecar/Dockerfile:9-12`
**Category** — Security
**Risk Level** — HIGH
**Description** — The sidecar Dockerfile runtime stage (`FROM debian:bookworm-slim`) has no `USER` instruction. The container runs as root (UID 0) in docker-compose. Additionally, the runtime stage only installs `ca-certificates` and copies the binary, but runs the binary as root. The binary accesses GPU device files (`/dev/nvidiaX`) — running as root to access these is a security risk. The same UID/GID problem applies as the backend.
**Suggested Fix** — Create a non-root user in the runtime stage (e.g., UID 65534 / nobody, or a dedicated `solprobe` user), add it with `groupadd`/`useradd`, and add a `USER` directive. Verify that the solprobe user needs group membership for GPU device access and add it to the appropriate group if needed.

---

### Finding 7
**File:Line** — `infra/terraform/variables.tf:8-10`
**Category** — Security
**Risk Level** — HIGH
**Description** — The `authorized_network` variable defaults to `"0.0.0.0/0"`, which opens the GKE master API endpoint to the entire internet. Even with auth tokens, this is a significant attack surface — brute-force auth attempts, CVE exploitation against the Kubernetes API server, and unauthenticated endpoints all become internet-facing. This is the most common misconfiguration audited in GKE production environments.
**Suggested Fix** — Remove the default value entirely and make the variable required (add `validation {}` block), or change the default to the corporate egress IP range. The `terraform.tfvars.example` should include a concrete example like a home/office CIDR. Never default to `0.0.0.0/0`.

---

### Finding 8
**File:Line** — `infra/helm/solprobe/values-dev.yaml:7`
**Category** — Security
**Risk Level** — HIGH
**Description** — The dev values file sets `grafana.adminPassword: dev` in plaintext, checked into version control. Even for dev, this establishes a pattern where credentials live in committed YAML files. If the dev values file is accidentally used in staging/prod (e.g., `helm upgrade -f values-dev.yaml`) Grafana becomes trivially accessible. Additionally, this value is interpolated directly — there is no indication in the Helm `grafana.yaml` template that `adminPassword` from values is handled as a secret; instead, grafana reads from `grafana-secret` Kubernetes Secret. The dev values key `adminPassword` is not actually consumed anywhere in the template, making it dead config and misleading.
**Suggested Fix** — Remove `adminPassword` from `values-dev.yaml` entirely. Document in a comment that the grafana secret is provisioned separately via `kubectl create secret`. Use `--set grafana.adminPassword=...` only on the CLI during dev, never in files.

---

### Finding 9
**File:Line** — `infra/ansible/ansible.cfg:4`
**Category** — Security
**Risk Level** — HIGH
**Description** — `host_key_checking = accept-new` silently accepts any new host key on first connection without user confirmation. In an automated provisioning scenario, this exposes the system to SSH MITM attacks during initial provisioning — an attacker who can intercept the network connection during the first Ansible run will get the private key operations silently forwarded. This is categorically different from `host_key_checking = False` (which is worse) but is still a trust-on-first-use vulnerability in a hostile network.
**Suggested Fix** — Pre-populate `~/.ssh/known_hosts` with GKE node fingerprints using `ssh-keyscan`, or use `host_key_checking = True` and manage a `known_hosts` file via a separate task. In a GCP environment, use OS Login which handles key trust via the GCP control plane.

---

### Finding 10
**File:Line** — `infra/ansible/roles/nvidia-drivers/tasks/main.yaml:12-14`
**Category** — Security
**Risk Level** — HIGH
**Description** — The `apt_key` module is deprecated since Ubuntu 22.04 (Jammy) and will not work on newer systems. The deprecated `apt-key` command imports keys into a single global keyring (`/etc/apt/trusted.gpg`), which is considered a security risk — any key in the global keyring is trusted for all repositories. On Ubuntu 22.04+, `apt_key` is effectively a no-op or produces warnings; the NVIDIA driver install will then fail with "NO_PUBKEY" errors. This is both a security issue and a functional breakage on modern Ubuntu.
**Suggested Fix** — Replace `apt_key` with `get_url` to download the key to `/usr/share/keyrings/nvidia-container-toolkit.gpg`, then reference it in the apt repository configuration via `signed-by=` option. Use the `ansible.builtin.deb822_repository` module or a template-based approach.

---

### Finding 11
**File:Line** — `infra/terraform/gke.tf:50`
**Category** — Reliability
**Risk Level** — HIGH
**Description** — The default node pool uses `node_count = 3` (a fixed count, no autoscaling). There is no `management` block specifying `auto_repair = true` and `auto_upgrade = true`. GKE nodes can become unhealthy silently — without auto-repair, a failed node simply disappears from the cluster. Without auto-upgrade, nodes accumulate OS CVEs indefinitely. The GPU node pool correctly uses autoscaling but also lacks a `management {}` block.
**Suggested Fix** — Add a `management { auto_repair = true; auto_upgrade = true }` block to both node pool resources. Consider adding autoscaling to the default pool as well.

---

### Finding 12
**File:Line** — `infra/k8s/monitoring/prometheus-deployment.yaml:66-67` and same in Helm `prometheus-deployment.yaml:69`
**Category** — Reliability
**Risk Level** — HIGH
**Description** — Prometheus storage is configured as `emptyDir: {}` — ephemeral storage that is wiped on pod restart, node drain, or eviction. The `--storage.tsdb.retention.time=15d` flag is set, but that data will never survive a pod reschedule. Any node restarts (common with GKE auto-upgrades and GPU driver updates) will wipe all collected metrics. Grafana dashboards will show blank gaps after every restart.
**Suggested Fix** — Replace the `emptyDir` prometheus-storage volume with a `PersistentVolumeClaim` (similar to the Grafana PVC pattern already used). Size it appropriately — at 5s scrape intervals across ~5 targets for 15 days, approximately 5-10Gi is appropriate.

---

### Finding 13
**File:Line** — `infra/scripts/deploy.sh:60-61`
**Category** — Security
**Risk Level** — HIGH
**Description** — The `ANTHROPIC_API_KEY` is passed to `kubectl create secret` via process substitution: `--from-env-file=<(echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")`. The value of `ANTHROPIC_API_KEY` is expanded into a shell string that is passed as a file descriptor — but the shell expansion `echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"` will show the key in `ps aux` output (as the argument to the process substitution command) and in shell debug traces (`set -x`). The script uses `set -euo pipefail` but not `set +x`, so if debug tracing is enabled upstream, the key leaks.
**Suggested Fix** — Write the key to a named temp file with `mktemp`, restrict permissions to `0600`, pass `--from-env-file=<tempfile>`, then `shred -u` the temp file in a `trap`. Alternatively, use a secrets manager (GCP Secret Manager) and reference it from there.

---

### Finding 14
**File:Line** — `docker-compose.yml:18`
**Category** — Security
**Risk Level** — HIGH
**Description** — The docker-compose `backend` service has no `ANTHROPIC_API_KEY` environment variable injection — no `env_file:` directive, no environment mapping. The service will start but the LLM diagnosis agent will fail at runtime with a missing API key error, and there is no indication to the developer where to set it. This will cause silent failures during the local smoke test because no `env_file: .env` is referenced anywhere in docker-compose.
**Suggested Fix** — Add `env_file: - .env` to the backend service in docker-compose.yml and add a `.env.example` file to the repo root showing `ANTHROPIC_API_KEY=your-key-here`.

---

### Finding 15
**File:Line** — `infra/k8s/monitoring/grafana-deployment.yaml:52-70` (volumes section) vs. Helm `grafana.yaml:56-64`
**Category** — Reliability
**Risk Level** — HIGH
**Description** — The raw k8s Grafana deployment references four volumes: `grafana-storage`, `grafana-datasources`, `grafana-dashboards-provisioning`, and `grafana-dashboards`. However, the ConfigMaps `grafana-dashboard-provisioning` and `grafana-dashboards` are never created anywhere in the k8s manifests — only `grafana-datasources` and `grafana-pvc` are defined. This will cause the Grafana pod to fail to start with a `ConfigMap "grafana-dashboard-provisioning" not found` error. The Helm chart version has the same gap — `grafana-dashboards` ConfigMap (containing the actual JSON) is never defined.
**Suggested Fix** — Add a `grafana-dashboards` ConfigMap that embeds the JSON from `infra/k8s/monitoring/grafana-dashboards/` as data keys. Add the `grafana-dashboard-provisioning` ConfigMap to the k8s manifests. The Helm template can use `tpl` and `Files.Get` to embed the JSONs from the chart's `files/` directory.

---

### Finding 16
**File:Line** — `infra/terraform/iam.tf`
**Category** — Security
**Risk Level** — HIGH
**Description** — All GKE nodes (default pool and GPU pool) share a single service account `gke_nodes`. This violates least-privilege separation — the backend pods (which need to call Anthropic APIs and may write to GCS) share the same GCP identity as the sidecar DaemonSet (which only needs to emit metrics). If a sidecar container is compromised, the attacker gets the same GCP permissions as the backend. With Workload Identity enabled, this should be segregated.
**Suggested Fix** — Create separate service accounts for GPU nodes and default nodes. Map Kubernetes ServiceAccounts (`solprobe-backend`, `solprobe-sidecar`) to distinct GCP service accounts via Workload Identity annotations (`iam.gke.io/gcp-service-account`). Grant GCS write access only to the backend's GCP service account.

---

### Finding 17
**File:Line** — `infra/ansible/roles/nvidia-drivers/tasks/main.yaml:25-29`
**Category** — Reliability
**Risk Level** — HIGH
**Description** — The RHEL/yum path installs `nvidia-driver-latest-dkms` (unpinned, `latest`). This means any re-run of the playbook on RHEL nodes could upgrade the NVIDIA driver to a new version mid-production without a controlled change process. Driver mismatches between nodes running different versions will produce undefined behavior in distributed training — gradient synchronization will fail non-deterministically.
**Suggested Fix** — Pin to a specific version: `nvidia-driver-535-dkms` or equivalent. Use the same version across both the Ubuntu and RHEL paths.

---

### Finding 18
**File:Line** — `infra/ansible/roles/nvidia-drivers/handlers/main.yaml:5`
**Category** — Reliability
**Risk Level** — HIGH
**Description** — The reboot handler condition `when: ansible_facts['kernel'] is defined` is always true — `ansible_facts['kernel']` is always populated after a `gather_facts` run. This means the handler will always trigger a reboot whenever the NVIDIA driver task notifies it, regardless of whether a reboot is actually needed (e.g., on repeated playbook runs when the driver is already installed and `changed: false`). Handlers are only called when the notifying task reports `changed: true`, which mitigates this partially, but the condition itself is wrong.
**Suggested Fix** — Replace the condition with a proper check: register the result of the driver install task and check `when: result.changed`, or use `needs-restarting -r` on RHEL / `needrestart` on Ubuntu to conditionally reboot only when required.

---

## MEDIUM Issues

---

### Finding 19
**File:Line** — `infra/helm/solprobe/templates/backend-deployment.yaml` (no `startupProbe`)
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — The backend container has liveness and readiness probes but no `startupProbe`. The backend installs Python dependencies, generates protobuf stubs, and initializes gRPC server — this can take 20-30 seconds on a cold start. With `initialDelaySeconds: 10` on the liveness probe and `periodSeconds: 15`, the liveness probe fires at t=10s, 25s, 40s. If startup takes >25s (likely on a slow node or cold pull), the container will be killed and restarted in a loop before it ever becomes ready. The same issue applies to the dashboard (Next.js startup).
**Suggested Fix** — Add a `startupProbe` with `failureThreshold: 12` and `periodSeconds: 5` (giving 60s for startup), then let liveness take over after successful startup.

---

### Finding 20
**File:Line** — `infra/helm/solprobe/templates/sidecar-daemonset.yaml:59-70`
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — The sidecar uses `/metrics` as its liveness and readiness probe endpoint. The `/metrics` endpoint in Prometheus format returns `200 OK` even when the sidecar is in a degraded state (e.g., GPU not detected, DCGM unavailable). A healthy HTTP response from `/metrics` does not indicate that the sidecar is actually collecting GPU data. A broken sidecar will appear healthy and no alerts will fire.
**Suggested Fix** — Add a dedicated `/healthz` endpoint to the Rust sidecar that returns 503 when DCGM is unreachable or no GPU is detected. Use that as the liveness probe path. Use `/metrics` only for readiness (meaning "I'm ready to be scraped").

---

### Finding 21
**File:Line** — `infra/helm/solprobe/templates/dashboard-deployment.yaml:44-55`
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — The dashboard liveness and readiness probes hit the root path `/`. For a Next.js App Router application, a `/` probe fetches a full server-rendered HTML page — this is expensive, runs middleware, and hits the backend API (via `NEXT_PUBLIC_API_URL`). If the backend is temporarily down, the dashboard's readiness probe will fail (the SSR page may error), causing the dashboard to be removed from the Service endpoints even though the Next.js server itself is healthy.
**Suggested Fix** — Add a lightweight `/api/healthz` Next.js API route that returns `{"status":"ok"}` and use that path for both probes. This decouples dashboard availability from backend availability.

---

### Finding 22
**File:Line** — `infra/helm/solprobe/values.yaml` (entire file) and `infra/k8s/backend/deployment.yaml` (image tag)
**Category** — Security
**Risk Level** — MEDIUM
**Description** — Images are referenced as `rutts29/solprobe-backend:v0.1.0` — plain Docker Hub references without a registry digest (`@sha256:...`). This means `kubectl` will pull by tag, and if the tag is re-pushed with different content (intentionally or via a supply-chain attack), the running workload can diverge from the known-good image. The Helm `Chart.yaml` also sets `appVersion: "latest"` which compounds the confusion.
**Suggested Fix** — Pin images to their SHA256 digest in production manifests. Enforce this via a policy (OPA Gatekeeper or Kyverno). Change `appVersion` to the actual version. Use a private artifact registry (GCP Artifact Registry) rather than Docker Hub.

---

### Finding 23
**File:Line** — No `imagePullPolicy` anywhere in infra
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — No `imagePullPolicy` is specified in any deployment or daemonset across the entire infra. When no policy is set, Kubernetes defaults to `IfNotPresent` for tags with a specific version (like `v0.1.0`), which means updated images will not be pulled if the tag already exists on the node. This silently prevents rollouts from picking up new images during CI/CD if the tag is reused without changing the tag string. Conversely, for the `latest` tag referenced by docker-compose Prometheus (`prom/prometheus:latest`), the default is `Always`, wasting bandwidth.
**Suggested Fix** — Explicitly set `imagePullPolicy: IfNotPresent` for versioned tags, and use immutable tags (never reuse a version tag). Add `imagePullPolicy: Always` only for `latest`-tagged images if they must be used.

---

### Finding 24
**File:Line** — All k8s and Helm manifests
**Category** — Security
**Risk Level** — MEDIUM
**Description** — No `seccompProfile` is set on any pod or container securityContext. Without a seccomp profile, all syscalls are allowed. The Kubernetes recommended baseline profile (`RuntimeDefault`) blocks ~40 risky syscalls. Setting `seccompProfile: {type: RuntimeDefault}` costs nothing and reduces the attack surface significantly. Given that the sidecar potentially runs near GPU device drivers, this is especially important.
**Suggested Fix** — Add `seccompProfile: { type: RuntimeDefault }` to every pod-level `securityContext` across all Deployments and DaemonSets. For the sidecar, audit whether it needs any additional syscalls and consider a custom seccomp profile.

---

### Finding 25
**File:Line** — All k8s and Helm manifests — no NetworkPolicy anywhere
**Category** — Security
**Risk Level** — MEDIUM
**Description** — There are no Kubernetes `NetworkPolicy` resources defined anywhere. All pods can communicate with all other pods in the namespace and with pods in other namespaces. This means a compromised dashboard pod can make direct connections to the Prometheus API, the backend gRPC port, and any other cluster service. The blast radius of a compromised pod is unrestricted.
**Suggested Fix** — Define NetworkPolicy resources establishing: (1) dashboard can only egress to `solprobe-backend:8000`; (2) backend can only ingress from dashboard and sidecar; (3) Prometheus can only ingress from Grafana; (4) sidecar can only egress to backend:50051. Default-deny-all ingress/egress policy in the namespace.

---

### Finding 26
**File:Line** — No `PodDisruptionBudget` anywhere
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — No `PodDisruptionBudget` (PDB) resources exist for any workload. During GKE node upgrades (triggered by the `REGULAR` release channel which auto-upgrades), the backend's two replicas could be drained simultaneously. If both backend replicas are on the same node (likely given `node_count = 3` and no pod anti-affinity), a single node drain will cause 100% backend downtime. During active training, this means all fault detection goes blind.
**Suggested Fix** — Add PDBs: `minAvailable: 1` for the backend (2 replicas). Add pod anti-affinity to the backend deployment to spread replicas across nodes.

---

### Finding 27
**File:Line** — `infra/terraform/gke.tf:1-41` — no `network_policy` or Dataplane V2
**Category** — Security
**Risk Level** — MEDIUM
**Description** — The GKE cluster does not enable `network_policy { enabled = true }` or the Dataplane V2 (`dataplane_v2_enabled`). Without GKE-level network policy enforcement, any Kubernetes NetworkPolicy resources created will be syntactically accepted but silently ignored — they will have no effect. This is a common misconfiguration trap.
**Suggested Fix** — Add `dataplane_v2 { enabled = true }` to the cluster config (preferred over legacy network_policy addon for GKE) or `addons_config { network_policy_config { disabled = false } }` with `network_policy { enabled = true }`. Dataplane V2 (Cilium-based) is the GKE recommendation.

---

### Finding 28
**File:Line** — `infra/k8s/monitoring/prometheus-config.yaml:30-40`
**Category** — Reliability
**Risk Level** — MEDIUM
**Description** — The sidecar scrape job has a duplicate/conflicting relabel_config. Lines 32-35 set `__address__` to just the port number (`replacement: ${1}`), then lines 37-40 immediately overwrite it with the correct `IP:port` format. The intermediate step leaves `__address__` as just a port string momentarily and the ordering of relabel rules means if Prometheus processes them sequentially, the final result is correct — but only by accident. The intermediate replacement to just `${1}` (port only) is a dead rule that adds confusion and could break if rule ordering semantics change.
**Suggested Fix** — Remove the intermediate redundant relabel rule (lines 32-35 in `prometheus-config.yaml`). Keep only the single rule that combines pod IP and annotation port into `IP:port`.

---

### Finding 29
**File:Line** — `infra/terraform/gke.tf:68-111` (GPU node pool)
**Category** — Cost
**Risk Level** — MEDIUM
**Description** — The GPU node pool `min_node_count = 1` means at least one T4 GPU node (`n1-standard-4` + T4) is always running, even when there are no training jobs. A T4 on GCP costs approximately $0.35/hour for the GPU + $0.19/hour for the VM — about $400/month minimum even with zero utilization. There is no idle scale-down mechanism.
**Suggested Fix** — Set `min_node_count = 0` for the GPU pool. Use Cluster Autoscaler's scale-to-zero capability with appropriate `nodeSelector` and `tolerations` on the sidecar DaemonSet so nodes spin up only when training jobs are scheduled. Add a `scaleDownUnneededTime` annotation to the node pool.

---

### Finding 30
**File:Line** — `infra/ansible/roles/dcgm/tasks/main.yaml:3-7`
**Category** — Security
**Risk Level** — MEDIUM
**Description** — The DCGM apt repository is added without a `signed-by` key reference — the repo line is `deb https://developer.download.nvidia.com/... /` with no GPG key pinning. Packages from this repo will be accepted without signature verification unless a matching global keyring entry exists (which is not set up in the dcgm role). This enables a potential package substitution attack if the CDN or DNS is compromised.
**Suggested Fix** — Download the NVIDIA CUDA repo GPG key to a dedicated keyring file and reference it in the `apt_repository` module using the `signed-by=` option in the repo source line.

---

### Finding 31
**File:Line** — `infra/scripts/deploy.sh:51-54`
**Category** — Architecture
**Risk Level** — MEDIUM
**Description** — The deploy script builds and pushes `solprobe-backend` and `solprobe-sidecar` images but does not build the dashboard image (`solprobe-dashboard`). The Helm chart and k8s manifests reference `rutts29/solprobe-dashboard:v0.1.0`, but this image is never built in the deploy pipeline. The dashboard will fail to pull on first deployment unless it was pre-built manually.
**Suggested Fix** — Add `docker build -t "rutts29/solprobe-dashboard:${IMAGE_TAG}" -f dashboard/Dockerfile .` and the corresponding `docker push` step. Alternatively, add a `dashboard/Dockerfile` if it doesn't exist.

---

## LOW Issues

---

### Finding 32
**File:Line** — `infra/helm/solprobe/templates/grafana.yaml:28-31`
**Category** — Security
**Risk Level** — LOW
**Description** — Grafana is deployed with `readOnlyRootFilesystem: true` and `runAsUser: 1000`, but Grafana's official image uses UID 472 (the `grafana` user). Running as UID 1000 means Grafana cannot write to its own data directories inside the image without the PVC providing the right ownership. The `fsGroup: 1000` on the pod should handle PVC ownership, but the container-internal paths (`/etc/grafana/`, `/usr/share/grafana/`) owned by UID 472 in the image will be read-only to UID 1000. This may cause Grafana to fail to load plugins or write session data.
**Suggested Fix** — Change `runAsUser` to `472` and `fsGroup` to `472` to match the Grafana official image's built-in user. Verify the image's USER directive and align the securityContext accordingly.

---

### Finding 33
**File:Line** — `infra/k8s/monitoring/grafana-deployment.yaml` and Helm `grafana.yaml`
**Category** — Security
**Risk Level** — LOW
**Description** — No `GF_SECURITY_ADMIN_USER` environment variable is set — Grafana defaults to `admin` as the username. No `GF_AUTH_ANONYMOUS_ENABLED=false` is explicitly set (it defaults to false, but defense-in-depth says to be explicit). No `GF_SNAPSHOTS_EXTERNAL_ENABLED=false` is set, leaving snapshot sharing enabled by default. No `GF_SECURITY_DISABLE_GRAVATAR=true`, which leaks user email hashes to gravatar.com.
**Suggested Fix** — Set a non-default admin username via secret, and explicitly set `GF_SNAPSHOTS_EXTERNAL_ENABLED=false`, `GF_SECURITY_DISABLE_GRAVATAR=true`, `GF_REPORTING_ENABLED=false` via environment variables in the Grafana deployment.

---

### Finding 34
**File:Line** — `infra/k8s/monitoring/grafana-dashboards/gpu-overview.json` and `training-health.json`
**Category** — Performance
**Risk Level** — LOW
**Description** — Both Grafana dashboards use `"from": "now-1h"` as the default time range. At a 5-second scrape interval, a 1-hour window means 720 data points per series per panel. The training-health dashboard has 4 timeseries panels + 4 stat panels. With multiple nodes selected via `$node_id` (e.g., 4 GPU nodes), that is 4 × 4 × 720 = 11,520 data points per load. With Prometheus as a memory-limited deployment (512Mi limit), this can cause OOM on Prometheus during dashboard loads. Additionally, both dashboards have `"graphTooltip": 1` (shared crosshair) which requires all panels to re-render simultaneously.
**Suggested Fix** — Change the default time range to `now-30m`. Add `step: 15` or `min_step: "15s"` to panel targets to reduce resolution for the default view. Consider setting `"refresh": "30s"` instead of no auto-refresh.

---

### Finding 35
**File:Line** — `infra/terraform/storage.tf:22-26`
**Category** — Security
**Risk Level** — LOW
**Description** — The GCS checkpoints bucket grants `roles/storage.objectViewer` to the `gke_nodes` service account. `objectViewer` allows listing all objects in the bucket in addition to reading them. Since all nodes share one SA (see Finding 16), the sidecar DaemonSet on every GPU node can list and read all training checkpoints — it only needs to write its own output. Furthermore, the bucket has no CMEK (Customer Managed Encryption Key) configured.
**Suggested Fix** — Once SA segregation is done (Finding 16), grant only the backend SA the viewer role. Grant the backend `objectCreator` or `objectAdmin` as needed, not `objectViewer`. Enable CMEK using a Cloud KMS key.

---

### Finding 36
**File:Line** — `infra/terraform/gke.tf:83-87`
**Category** — Reliability
**Risk Level** — LOW
**Description** — GPU driver installation is configured as `gpu_driver_version = "LATEST"`. This installs the latest available NVIDIA driver GKE supports, which changes over time. Combined with the autoscaler (`min=1, max=4`), when the autoscaler provisions new nodes they may receive a different driver version than existing nodes if LATEST has moved forward. Driver version heterogeneity across a GPU pool causes undefined behavior in CUDA operations.
**Suggested Fix** — Pin to a specific driver version like `"LATEST"` → `"535.104.12"` or use `"DEFAULT"` which is stable across GKE patch releases. Track driver versions via a variable.

---

### Finding 37
**File:Line** — `infra/k8s/monitoring/prometheus-config.yaml:77-85` and Helm equivalent
**Category** — Reliability
**Risk Level** — LOW
**Description** — The `GPUUtilizationLow` alert fires when GPU utilization is below 10% for 5 minutes. This will fire during every cluster startup, after training job completion, and during any checkpoint save/restore pause. In a real training environment, this alert will be a constant source of noise, leading to alert fatigue and the alert being disabled. There is no alert for "GPU utilization dropped to 0% after being high" (regression detection), which is the operationally useful signal.
**Suggested Fix** — Replace the static threshold alert with a rate-of-change alert: `rate(gpu_utilization_percent[5m]) < -50` to detect sudden drops. Add a `unless` clause to suppress during known maintenance windows. Add additional alerts for XID errors and ECC memory errors (which are the actual hardware failure indicators for T4/L4).

---

### Finding 38
**File:Line** — `infra/ansible/inventory/hosts.yaml:14`
**Category** — Architecture
**Risk Level** — LOW
**Description** — `backend_addr: "http://solprobe-backend:50051"` in the static inventory assumes the Ansible-managed bare-metal nodes can resolve the Kubernetes DNS name `solprobe-backend`. This only works if the nodes are configured to use the cluster's CoreDNS as their upstream resolver — which they will not be by default. Bare-metal GPU nodes provisioned via Ansible outside the K8s cluster will fail to resolve this hostname.
**Suggested Fix** — Replace with the actual backend IP or a real DNS name. Use a Terraform output or a variable (`backend_external_ip`) populated after cluster provisioning. Or provision an internal load balancer Service for the backend and use its ClusterIP/external IP.

---

### Finding 39
**File:Line** — `docker-compose.yml:3-8`
**Category** — Architecture
**Risk Level** — LOW
**Description** — The docker-compose file has no `dashboard` service. The Next.js dashboard is listed as a first-class component but cannot be run via `docker compose up` for local development — only sidecar, backend, and prometheus are defined. This makes full-stack local testing impossible without manually running the dashboard separately.
**Suggested Fix** — Add a `dashboard` service with the appropriate build context, ports mapping `3000:3000`, and `NEXT_PUBLIC_API_URL=http://backend:8000` environment variable.

---

## ENHANCEMENT Suggestions

---

### Finding 40
**File:Line** — All Deployments (Helm and k8s)
**Category** — Reliability
**Risk Level** — ENHANCEMENT
**Description** — No Horizontal Pod Autoscaler (HPA) is defined for the backend. The backend receives gRPC streams from all sidecars simultaneously — at 4 GPU nodes with a 5s scrape interval, the backend handles ~48 messages/minute minimum. Under burst training-event conditions (all 4 nodes fire alerts simultaneously) the backend could become a bottleneck. HPA on CPU/memory would allow the backend to scale from 2 to N replicas automatically.
**Suggested Fix** — Add an HPA resource targeting the backend deployment with `minReplicas: 2`, `maxReplicas: 6`, and a CPU utilization target of 70%.

---

### Finding 41
**File:Line** — `infra/terraform/gke.tf` and all Deployments
**Category** — Architecture
**Risk Level** — ENHANCEMENT
**Description** — No pod anti-affinity rules exist for the backend Deployment. With `replicas: 2` and `node_count: 3`, both backend replicas can land on the same node. A single node failure (or drain for GPU driver updates) kills all backend replicas simultaneously. The `PodDisruptionBudget` (Finding 26) helps with voluntary disruptions but not node failures.
**Suggested Fix** — Add `affinity.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution` to the backend deployment using `topologyKey: kubernetes.io/hostname`.

---

### Finding 42
**File:Line** — `infra/k8s/monitoring/prometheus-config.yaml` and Grafana dashboards
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — No XID error, ECC error, PCIe replay counter, or clock throttle reason metrics are alerted on. Per the CLAUDE.md research notes, these are the primary DCGM health indicators for T4/L4 GPUs. The dashboards show temperature, utilization, memory, and power — but not the hardware-level fault indicators that SolProbe is specifically designed to catch. This is a gap between the documented design intent and the deployed monitoring.
**Suggested Fix** — Add Prometheus alert rules for `gpu_xid_errors_total > 0` (alert immediately), `gpu_ecc_errors_total{type="double_bit"} > 0` (critical), and `gpu_clock_throttle_reasons != 0` (warning). Add panels for these metrics to the `gpu-overview.json` dashboard.

---

### Finding 43
**File:Line** — `infra/terraform/gke.tf`
**Category** — Reliability
**Risk Level** — ENHANCEMENT
**Description** — The GKE cluster uses `release_channel: REGULAR` which triggers automatic upgrades. There is no `maintenance_policy` block specifying a maintenance window. This means GKE can upgrade nodes at any time, including during active training runs, causing sudden node drains and training job interruptions.
**Suggested Fix** — Add a `maintenance_policy { recurring_window { recurrence = "FREQ=WEEKLY;BYDAY=SA,SU"; window { start_time = "2000-01-01T00:00:00Z"; end_time = "2000-01-01T06:00:00Z" } } }` block to restrict upgrades to weekend off-hours.

---

### Finding 44
**File:Line** — Entire infra
**Category** — Feature Gap
**Risk Level** — ENHANCEMENT
**Description** — There is no Kubernetes `LimitRange` resource for the `solprobe` namespace. While individual containers have resource limits set, new workloads added without explicit resource requests/limits (e.g., debug pods, batch jobs) will have no constraints and can OOM the node, evicting the sidecar or backend.
**Suggested Fix** — Add a `LimitRange` resource with default requests/limits for the namespace, and a `ResourceQuota` capping the total namespace CPU and memory consumption.

---

### Finding 45
**File:Line** — `infra/terraform/main.tf:14-18`
**Category** — Architecture
**Risk Level** — ENHANCEMENT
**Description** — The Terraform GCS backend uses a single bucket `solprobe-terraform-state` with no state locking mechanism documented. GCS backends in Terraform use object versioning for locking (not DynamoDB like AWS). The bucket is in `storage.tf` but the state bucket itself is not managed by Terraform — it must exist before `terraform init`. There is no `terraform.lock.hcl` guidance or backend config for CI/CD to pass `-backend-config` securely.
**Suggested Fix** — Add a bootstrap script or Terraform `null_resource` that creates the state bucket if it doesn't exist. Document the required GCS IAM permissions for the CI/CD service account. Consider adding a `gcs_state_bucket` Terraform resource in a separate bootstrap workspace.

---

## Cross-Cutting Summary Table

| # | File | Category | Risk | Issue |
|---|------|----------|------|-------|
| 1 | helm/prometheus-config.yaml:17 | Reliability | BREAKING | Alert rules never mounted in Helm |
| 2 | k8s/monitoring/ (entire) | Reliability | BREAKING | Alertmanager referenced but never deployed |
| 3 | k8s/sidecar/daemonset.yaml:43 | Architecture | BREAKING | gRPC backend-addr uses http:// scheme |
| 4 | infra/prometheus.yml | Reliability | BREAKING | No alerting in docker-compose config |
| 5 | backend/Dockerfile:1 | Security | HIGH | No USER directive, runs as root |
| 6 | sidecar/Dockerfile:9 | Security | HIGH | No USER directive in runtime stage |
| 7 | terraform/variables.tf:9 | Security | HIGH | authorized_network defaults to 0.0.0.0/0 |
| 8 | helm/values-dev.yaml:7 | Security | HIGH | Hardcoded password in VCS |
| 9 | ansible/ansible.cfg:4 | Security | HIGH | host_key_checking = accept-new TOFU vuln |
| 10 | ansible/roles/nvidia-drivers/tasks:12 | Security | HIGH | Deprecated apt_key, broken on Ubuntu 22.04+ |
| 11 | terraform/gke.tf:50 | Reliability | HIGH | No auto_repair/auto_upgrade on node pools |
| 12 | k8s/monitoring/prometheus-deployment.yaml:67 | Reliability | HIGH | Prometheus storage is emptyDir (ephemeral) |
| 13 | scripts/deploy.sh:60 | Security | HIGH | API key exposed in process substitution |
| 14 | docker-compose.yml:18 | Security | HIGH | No ANTHROPIC_API_KEY injected |
| 15 | k8s/monitoring/grafana-deployment.yaml:52 | Reliability | HIGH | grafana-dashboards ConfigMap never created |
| 16 | terraform/iam.tf | Security | HIGH | Single SA for all nodes, violates least-privilege |
| 17 | ansible/roles/nvidia-drivers/tasks:27 | Reliability | HIGH | Unpinned nvidia-driver-latest-dkms on RHEL |
| 18 | ansible/roles/nvidia-drivers/handlers:5 | Reliability | HIGH | Reboot handler condition always true |
| 19 | helm/backend-deployment.yaml | Reliability | MEDIUM | No startupProbe; liveness fires before ready |
| 20 | helm/sidecar-daemonset.yaml:59 | Reliability | MEDIUM | /metrics liveness doesn't detect degraded state |
| 21 | helm/dashboard-deployment.yaml:44 | Reliability | MEDIUM | / probe runs full SSR page fetch |
| 22 | helm/values.yaml:6 | Security | MEDIUM | Images not pinned to digest |
| 23 | All manifests | Reliability | MEDIUM | No imagePullPolicy specified anywhere |
| 24 | All manifests | Security | MEDIUM | No seccompProfile on any pod |
| 25 | All manifests | Security | MEDIUM | No NetworkPolicy defined |
| 26 | All manifests | Reliability | MEDIUM | No PodDisruptionBudget |
| 27 | terraform/gke.tf | Security | MEDIUM | NetworkPolicy enforcement not enabled at GKE |
| 28 | k8s/monitoring/prometheus-config.yaml:32 | Reliability | MEDIUM | Duplicate dead relabel rule |
| 29 | terraform/gke.tf:75 | Cost | MEDIUM | GPU pool min=1 always costs ~$400/mo |
| 30 | ansible/roles/dcgm/tasks/main.yaml:3 | Security | MEDIUM | DCGM repo has no signed-by key pinning |
| 31 | scripts/deploy.sh:51 | Architecture | MEDIUM | Dashboard image never built in deploy script |
| 32 | helm/grafana.yaml:22 | Security | LOW | runAsUser 1000 conflicts with Grafana UID 472 |
| 33 | k8s/monitoring/grafana-deployment.yaml | Security | LOW | No GF_SNAPSHOTS/GF_REPORTING disabled |
| 34 | grafana-dashboards/*.json | Performance | LOW | 1h default range → 720 points/series, OOM risk |
| 35 | terraform/storage.tf:22 | Security | LOW | objectViewer grants list on shared SA |
| 36 | terraform/gke.tf:86 | Reliability | LOW | gpu_driver_version = LATEST causes heterogeneity |
| 37 | k8s/monitoring/prometheus-config.yaml:78 | Reliability | LOW | Low-GPU-util alert is noisy, no XID/ECC alerts |
| 38 | ansible/inventory/hosts.yaml:14 | Architecture | LOW | K8s DNS name unresolvable on bare-metal nodes |
| 39 | docker-compose.yml | Architecture | LOW | Dashboard service missing from compose file |
| 40 | All Deployments | Reliability | ENHANCEMENT | No HPA for backend |
| 41 | All Deployments | Architecture | ENHANCEMENT | No pod anti-affinity on backend |
| 42 | prometheus-config.yaml | Feature Gap | ENHANCEMENT | No XID/ECC/throttle alerts (core SolProbe value) |
| 43 | terraform/gke.tf | Reliability | ENHANCEMENT | No maintenance_policy window |
| 44 | Entire infra | Architecture | ENHANCEMENT | No LimitRange or ResourceQuota |
| 45 | terraform/main.tf:15 | Architecture | ENHANCEMENT | No state bucket bootstrap or lock documentation |

---

## Top 5 Priorities to Fix First

1. **Finding 1 + 2** — Alert rules not mounted in Helm + Alertmanager never deployed. The entire alerting pipeline is broken end-to-end. Fix these together.
2. **Finding 3** — `http://` scheme on gRPC address means all sidecars fail to connect to the backend. This breaks the core telemetry pipeline.
3. **Finding 12 + 15** — Prometheus data is ephemeral (emptyDir) and Grafana dashboard ConfigMaps don't exist. Monitoring is both non-persistent and partly non-functional.
4. **Finding 7** — GKE master API open to 0.0.0.0/0 by default. One terraform apply with a forgotten variable and the cluster control plane is internet-exposed.
5. **Finding 5 + 6** — Both application Dockerfiles run as root. Fix before any image is pushed to a registry.

---

