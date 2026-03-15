# SolProbe SP-5: Kubernetes + Infrastructure as Code — Full Spec for Cloud Agent

## Context

SolProbe SP-1 through SP-4 are complete (sidecar, backend, LLM agent, dashboard). This plan builds the production deployment infrastructure: Kubernetes manifests, Terraform for GCP, Ansible for GPU node provisioning, and a Prometheus/Grafana observability stack.

**Read CLAUDE.md for project conventions (especially: never add Co-Authored-By to commits).**

## What to Build

1. **Kubernetes manifests** — deploy sidecar, backend, dashboard as K8s workloads
2. **Helm chart** — parameterized deployment
3. **Terraform** — GCP infrastructure (GKE cluster, networking, IAM)
4. **Ansible** — GPU node provisioning (DCGM, drivers, sidecar)
5. **Prometheus/Grafana** — preconfigured GPU monitoring dashboards

## Directory Structure

```
infra/
├── k8s/
│   ├── namespace.yaml
│   ├── backend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── configmap.yaml
│   ├── sidecar/
│   │   ├── daemonset.yaml       # One sidecar per GPU node
│   │   └── service.yaml         # Prometheus scrape target
│   ├── dashboard/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── ingress.yaml
│   └── monitoring/
│       ├── prometheus-config.yaml
│       ├── grafana-deployment.yaml
│       ├── grafana-dashboards/
│       │   ├── gpu-overview.json
│       │   └── training-health.json
│       └── alertmanager-config.yaml
├── helm/
│   └── solprobe/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── templates/
│       │   ├── _helpers.tpl
│       │   ├── namespace.yaml
│       │   ├── backend-deployment.yaml
│       │   ├── backend-service.yaml
│       │   ├── sidecar-daemonset.yaml
│       │   ├── dashboard-deployment.yaml
│       │   ├── dashboard-service.yaml
│       │   ├── prometheus-config.yaml
│       │   └── grafana.yaml
│       └── values-dev.yaml
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── gke.tf              # GKE cluster with GPU node pool
│   ├── networking.tf       # VPC, subnets, firewall rules
│   ├── iam.tf              # Service accounts, roles
│   ├── storage.tf          # GCS bucket for checkpoints
│   └── terraform.tfvars.example
├── ansible/
│   ├── inventory/
│   │   └── hosts.yaml
│   ├── playbooks/
│   │   ├── setup-gpu-node.yaml
│   │   ├── install-dcgm.yaml
│   │   ├── deploy-sidecar.yaml
│   │   └── configure-monitoring.yaml
│   ├── roles/
│   │   ├── nvidia-drivers/
│   │   │   └── tasks/main.yaml
│   │   ├── dcgm/
│   │   │   └── tasks/main.yaml
│   │   └── solprobe-sidecar/
│   │       ├── tasks/main.yaml
│   │       └── templates/solprobe.service.j2
│   └── ansible.cfg
├── prometheus.yml           # Already exists — enhance it
└── scripts/
    ├── deploy.sh            # Full deployment script
    └── teardown.sh
```

## Implementation Steps

### STEP 1: Kubernetes Manifests

**Namespace**: `solprobe`

**Backend Deployment** (`k8s/backend/`):
- 2 replicas, resource limits (512Mi memory, 500m CPU)
- Env vars: ANTHROPIC_API_KEY from K8s Secret
- Ports: 8000 (HTTP), 50051 (gRPC)
- Liveness probe: GET /api/v1/health
- Readiness probe: GET /api/v1/health

**Backend Service**:
- ClusterIP service exposing ports 8000 and 50051

**Backend ConfigMap**:
- SOLPROBE_LOG_LEVEL, SOLPROBE_METRICS_PORT, etc.

**Sidecar DaemonSet** (`k8s/sidecar/`):
- Runs on every node with label `solprobe.io/gpu=true`
- Node selector: `cloud.google.com/gke-accelerator` exists
- Resource limits: 256Mi memory, 250m CPU
- Tolerations for GPU taints
- Args: `--node-id $(NODE_NAME) --backend-addr http://solprobe-backend:50051`
- NODE_NAME from downward API: `fieldRef: fieldPath: spec.nodeName`
- Volume mount: `/tmp` for mmap files (shared with training pods via emptyDir)
- Prometheus port annotation: `prometheus.io/port: "9100"`

**Dashboard Deployment** (`k8s/dashboard/`):
- 1 replica
- Port 3000
- Env: NEXT_PUBLIC_API_URL pointing to backend service

**Dashboard Ingress**:
- Path-based routing: `/` → dashboard, `/api/` → backend, `/ws/` → backend

### STEP 2: Prometheus/Grafana Monitoring

**Prometheus ConfigMap** (`k8s/monitoring/prometheus-config.yaml`):
- Scrape configs: sidecar DaemonSet pods (port 9100), backend pods (port 8000)
- Use kubernetes_sd_configs with pod role
- Relabel configs to pick up solprobe pods by annotation

**Grafana Deployment**:
- Single replica with persistent volume
- Preconfigured data source pointing to Prometheus

**GPU Overview Dashboard** (`grafana-dashboards/gpu-overview.json`):
- Panels: GPU temperature per node, GPU utilization per node, memory usage, power draw
- Alerting: temp > 85°C, memory > 95%
- Variables: node_id dropdown

**Training Health Dashboard** (`grafana-dashboards/training-health.json`):
- Panels: loss curve, gradient norm, throughput, MFU %
- Backend metrics: connected nodes, total alerts, total diagnoses, WS clients

**Alertmanager Config** (`alertmanager-config.yaml`):
- Route CRITICAL alerts to webhook (future: Slack/PagerDuty)

### STEP 3: Helm Chart

**Chart.yaml**:
- name: solprobe
- version: 0.1.0
- appVersion: matches Docker image tags

**values.yaml** (parameterize everything):
```yaml
global:
  namespace: solprobe

backend:
  replicas: 2
  image: rutts29/solprobe-backend:latest
  port: 8000
  grpcPort: 50051
  resources:
    requests: { memory: 256Mi, cpu: 250m }
    limits: { memory: 512Mi, cpu: 500m }
  anthropicApiKeySecret: solprobe-secrets

sidecar:
  image: rutts29/solprobe-sidecar:latest
  metricsPort: 9100
  simulate: false
  resources:
    requests: { memory: 128Mi, cpu: 100m }
    limits: { memory: 256Mi, cpu: 250m }
  nodeSelector:
    cloud.google.com/gke-accelerator: ""

dashboard:
  replicas: 1
  image: rutts29/solprobe-dashboard:latest
  port: 3000

monitoring:
  prometheus:
    enabled: true
    scrapeInterval: 5s
  grafana:
    enabled: true
    adminPassword: admin
```

**values-dev.yaml** (override for local development):
```yaml
sidecar:
  simulate: true
  nodeSelector: {}

monitoring:
  grafana:
    adminPassword: dev
```

**Templates**: Templatize all K8s manifests from Step 1 using Helm `{{ .Values.* }}` syntax.

### STEP 4: Terraform for GCP

**`main.tf`**:
- Provider: google, google-beta
- Backend: GCS bucket for state

**`gke.tf`**:
- GKE cluster with:
  - Default node pool (3 nodes, e2-standard-4) for backend/dashboard
  - GPU node pool (1-4 nodes, n1-standard-4 + nvidia-tesla-t4)
  - GPU node pool auto-scaling (min 1, max 4)
  - Workload Identity enabled
  - Logging and monitoring enabled

**`networking.tf`**:
- VPC with subnet
- Firewall rules: allow internal traffic, allow health checks
- Cloud NAT for outbound internet (sidecar needs to reach backend)

**`iam.tf`**:
- Service account for GKE nodes
- Roles: logging.logWriter, monitoring.metricWriter, artifactregistry.reader

**`storage.tf`**:
- GCS bucket for training checkpoints (referenced in recovery actions)

**`variables.tf`**:
- project_id, region (default us-central1), cluster_name, gpu_count, machine_type

**`outputs.tf`**:
- cluster_endpoint, cluster_ca_certificate, kubectl_command

**`terraform.tfvars.example`**:
```hcl
project_id   = "your-gcp-project"
region       = "us-central1"
cluster_name = "solprobe-cluster"
gpu_count    = 1
```

### STEP 5: Ansible Playbooks

**`setup-gpu-node.yaml`**:
- Install NVIDIA drivers (nvidia-driver-535 or latest)
- Install nvidia-container-toolkit
- Verify: `nvidia-smi` runs successfully

**`install-dcgm.yaml`**:
- Install NVIDIA DCGM (datacenter-gpu-manager)
- Enable dcgm systemd service
- Verify: `dcgmi discovery -l` lists GPUs

**`deploy-sidecar.yaml`**:
- Copy sidecar binary to target
- Create systemd service from template (`solprobe.service.j2`)
- Configure: node-id, backend-addr, metrics-port
- Start and enable service

**`configure-monitoring.yaml`**:
- Install node_exporter
- Configure Prometheus to scrape node_exporter + sidecar
- Verify: curl localhost:9100/metrics returns solprobe metrics

**Roles**:
- `nvidia-drivers`: tasks for driver installation with distribution detection (Ubuntu/RHEL)
- `dcgm`: tasks for DCGM installation and service management
- `solprobe-sidecar`: tasks + systemd template for sidecar deployment

### STEP 6: Deployment Scripts

**`scripts/deploy.sh`**:
```bash
#!/bin/bash
set -euo pipefail

# 1. Terraform: create GKE cluster
cd infra/terraform && terraform init && terraform apply -auto-approve

# 2. Configure kubectl
gcloud container clusters get-credentials $(terraform output -raw cluster_name) --region $(terraform output -raw region)

# 3. Build and push Docker images
docker build -t rutts29/solprobe-backend:latest -f backend/Dockerfile .
docker build -t rutts29/solprobe-sidecar:latest -f sidecar/Dockerfile .
docker push rutts29/solprobe-backend:latest
docker push rutts29/solprobe-sidecar:latest

# 4. Create namespace and secrets
kubectl create namespace solprobe --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic solprobe-secrets -n solprobe \
  --from-literal=ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY} \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Helm install
helm upgrade --install solprobe infra/helm/solprobe -n solprobe -f infra/helm/solprobe/values.yaml

# 6. Wait for rollout
kubectl rollout status deployment/solprobe-backend -n solprobe
kubectl rollout status daemonset/solprobe-sidecar -n solprobe

echo "SolProbe deployed. Dashboard: $(kubectl get ingress -n solprobe -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')"
```

**`scripts/teardown.sh`**:
```bash
#!/bin/bash
set -euo pipefail
helm uninstall solprobe -n solprobe
kubectl delete namespace solprobe
cd infra/terraform && terraform destroy -auto-approve
```

## Testing

- `helm template solprobe infra/helm/solprobe/` — verify templates render without errors
- `terraform validate` — verify Terraform config
- `ansible-playbook --syntax-check playbooks/*.yaml` — verify Ansible syntax
- `kubectl apply --dry-run=client -f infra/k8s/` — verify K8s manifests

## Verification

```bash
# Local K8s (minikube or kind)
minikube start --gpus=all  # or: kind create cluster
helm install solprobe infra/helm/solprobe -f infra/helm/solprobe/values-dev.yaml
kubectl get pods -n solprobe  # all should be Running
curl $(minikube service solprobe-backend -n solprobe --url)/api/v1/health
```

## Commit Strategy
- Commit after each step
- Push to branch `feature/sp5-k8s-iac`
- Create PR for review
