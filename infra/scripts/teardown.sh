#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== SolProbe Teardown ==="
echo "This will destroy ALL SolProbe resources including the GKE cluster."
read -r -p "Are you sure? (y/N): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborting teardown."
    exit 0
fi

# 1. Uninstall Helm release
echo "[1/3] Uninstalling Helm release..."
if helm status solprobe -n solprobe &>/dev/null; then
    helm uninstall solprobe -n solprobe
else
    echo "Helm release not found, skipping."
fi

# 2. Delete namespace
echo "[2/3] Deleting namespace..."
kubectl delete namespace solprobe --ignore-not-found

# 3. Destroy Terraform resources
echo "[3/3] Destroying Terraform resources..."
cd "$INFRA_DIR/terraform"
terraform plan -destroy -out=tfplan
echo ""
read -r -p "Review the destroy plan above. Proceed? (y/N): " confirm_destroy
if [[ "$confirm_destroy" != "y" && "$confirm_destroy" != "Y" ]]; then
    echo "Aborting Terraform destroy."
    rm -f tfplan
    exit 0
fi
terraform apply tfplan
rm -f tfplan

echo ""
echo "=== SolProbe teardown complete ==="
