#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$INFRA_DIR")"
IMAGE_TAG="${IMAGE_TAG:-v0.1.0}"

cleanup() {
    echo ""
    echo "=== Deployment failed ==="
    echo "Resources may have been partially created."
    rm -f "${ANTHROPIC_SECRET_FILE:-}"
    echo "Run 'infra/scripts/teardown.sh' to clean up."
    exit 1
}
trap cleanup ERR

# Validate required environment variables
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "ERROR: ANTHROPIC_API_KEY environment variable is not set."
    echo "Export it before running: export ANTHROPIC_API_KEY='your-key-here'"
    exit 1
fi

echo "=== SolProbe Deployment ==="

# 1. Terraform: plan and apply GKE cluster
echo "[1/6] Provisioning GKE cluster with Terraform..."
cd "$INFRA_DIR/terraform"
terraform init
terraform plan -out=tfplan
echo ""
read -r -p "Review the plan above. Proceed with apply? (y/N): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborting deployment."
    rm -f tfplan
    exit 0
fi
terraform apply tfplan
rm -f tfplan

# 2. Configure kubectl
echo "[2/6] Configuring kubectl..."
CLUSTER_NAME=$(terraform output -raw cluster_name)
REGION=$(terraform output -raw region)
gcloud container clusters get-credentials "$CLUSTER_NAME" --region "$REGION"

# 3. Build and push Docker images
echo "[3/6] Building and pushing Docker images..."
cd "$ROOT_DIR"
docker build -t "rutts29/solprobe-backend:${IMAGE_TAG}" -f backend/Dockerfile .
docker build -t "rutts29/solprobe-sidecar:${IMAGE_TAG}" -f sidecar/Dockerfile .
docker build -t "rutts29/solprobe-dashboard:${IMAGE_TAG}" -f dashboard/Dockerfile .
docker push "rutts29/solprobe-backend:${IMAGE_TAG}"
docker push "rutts29/solprobe-sidecar:${IMAGE_TAG}"
docker push "rutts29/solprobe-dashboard:${IMAGE_TAG}"

# 4. Create namespace and secrets
echo "[4/6] Creating namespace and secrets..."
kubectl create namespace solprobe --dry-run=client -o yaml | kubectl apply -f -
ANTHROPIC_SECRET_FILE="$(mktemp)"
chmod 600 "$ANTHROPIC_SECRET_FILE"
printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY" > "$ANTHROPIC_SECRET_FILE"
kubectl create secret generic solprobe-secrets -n solprobe \
  --from-env-file="$ANTHROPIC_SECRET_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "$ANTHROPIC_SECRET_FILE"
unset ANTHROPIC_SECRET_FILE
kubectl create secret generic grafana-secret -n solprobe \
  --from-literal=admin-password="${GRAFANA_ADMIN_PASSWORD:-$(openssl rand -base64 16)}" \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Helm install
echo "[5/6] Installing SolProbe via Helm..."
helm upgrade --install solprobe "$INFRA_DIR/helm/solprobe" \
  -n solprobe \
  -f "$INFRA_DIR/helm/solprobe/values.yaml" \
  --set "backend.image=rutts29/solprobe-backend:${IMAGE_TAG}" \
  --set "sidecar.image=rutts29/solprobe-sidecar:${IMAGE_TAG}"

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
