#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== SolProbe Teardown ==="

# 1. Uninstall Helm release
echo "[1/3] Uninstalling Helm release..."
helm uninstall solprobe -n solprobe 2>/dev/null || echo "Helm release not found, skipping"

# 2. Delete namespace
echo "[2/3] Deleting namespace..."
kubectl delete namespace solprobe --ignore-not-found

# 3. Destroy Terraform resources
echo "[3/3] Destroying Terraform resources..."
cd "$INFRA_DIR/terraform"
terraform destroy -auto-approve

echo ""
echo "=== SolProbe teardown complete ==="
