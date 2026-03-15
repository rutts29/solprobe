#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$INFRA_DIR")"

echo "=== SolProbe Deployment ==="

# 1. Terraform: create GKE cluster
echo "[1/6] Provisioning GKE cluster with Terraform..."
cd "$INFRA_DIR/terraform"
terraform init
terraform apply -auto-approve

# 2. Configure kubectl
echo "[2/6] Configuring kubectl..."
CLUSTER_NAME=$(terraform output -raw cluster_name)
REGION=$(terraform output -raw region)
PROJECT_ID=$(terraform output -raw cluster_endpoint | xargs -I{} echo "configured")
gcloud container clusters get-credentials "$CLUSTER_NAME" --region "$REGION"

# 3. Build and push Docker images
echo "[3/6] Building and pushing Docker images..."
cd "$ROOT_DIR"
docker build -t rutts29/solprobe-backend:latest -f backend/Dockerfile .
docker build -t rutts29/solprobe-sidecar:latest -f sidecar/Dockerfile .
docker push rutts29/solprobe-backend:latest
docker push rutts29/solprobe-sidecar:latest

# 4. Create namespace and secrets
echo "[4/6] Creating namespace and secrets..."
kubectl create namespace solprobe --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic solprobe-secrets -n solprobe \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Helm install
echo "[5/6] Installing SolProbe via Helm..."
helm upgrade --install solprobe "$INFRA_DIR/helm/solprobe" \
  -n solprobe \
  -f "$INFRA_DIR/helm/solprobe/values.yaml"

# 6. Wait for rollout
echo "[6/6] Waiting for rollout..."
kubectl rollout status deployment/solprobe-backend -n solprobe --timeout=300s
kubectl rollout status daemonset/solprobe-sidecar -n solprobe --timeout=300s
kubectl rollout status deployment/solprobe-dashboard -n solprobe --timeout=300s

echo ""
echo "=== SolProbe deployed successfully ==="
echo "Dashboard: $(kubectl get ingress -n solprobe -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo 'pending')"
echo "Backend:   kubectl port-forward svc/solprobe-backend 8000:8000 -n solprobe"
echo "Grafana:   kubectl port-forward svc/grafana 3001:3000 -n solprobe"
