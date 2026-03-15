#!/usr/bin/env bash
#
# SolProbe End-to-End Integration Test
#
# Starts backend, sidecar (simulation mode), waits for data flow,
# then validates health, nodes, alerts, and Prometheus endpoints.
#
# Exit 0 on success, 1 on failure.

set -euo pipefail

# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_PORT=8000
GRPC_PORT=50051
SIDECAR_METRICS_PORT=9100
NODE_ID="node-0"

BACKEND_PID=""
SIDECAR_PID=""
SIDECAR_FAULT_PID=""

PASS_COUNT=0
FAIL_COUNT=0

# ------------------------------------------------------------------
# Colors (disabled if not a terminal)
# ------------------------------------------------------------------
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' NC=''
fi

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
log()  { echo -e "${YELLOW}[E2E]${NC} $*"; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo -e "  ${GREEN}PASS${NC}: $*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); echo -e "  ${RED}FAIL${NC}: $*"; }

# Wait for an HTTP endpoint to become available
wait_for_http() {
  local url="$1"
  local timeout="$2"
  local elapsed=0
  while [ $elapsed -lt "$timeout" ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ------------------------------------------------------------------
# Cleanup: kill all background processes on exit
# ------------------------------------------------------------------
cleanup() {
  log "Cleaning up background processes..."
  [ -n "$SIDECAR_FAULT_PID" ] && kill "$SIDECAR_FAULT_PID" 2>/dev/null || true
  [ -n "$SIDECAR_PID" ]       && kill "$SIDECAR_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ]       && kill "$BACKEND_PID" 2>/dev/null || true

  # Wait briefly for processes to exit
  sleep 1

  # Force-kill stragglers
  [ -n "$SIDECAR_FAULT_PID" ] && kill -9 "$SIDECAR_FAULT_PID" 2>/dev/null || true
  [ -n "$SIDECAR_PID" ]       && kill -9 "$SIDECAR_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ]       && kill -9 "$BACKEND_PID" 2>/dev/null || true

  log "Cleanup complete."
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------------------
# Step 1: Start backend
# ------------------------------------------------------------------
log "Starting backend on port $BACKEND_PORT..."
(
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/backend/.venv/bin/activate"
  uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --app-dir "$PROJECT_ROOT/backend" \
    > /tmp/solprobe_e2e_backend.log 2>&1
) &
BACKEND_PID=$!
log "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
if wait_for_http "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" 15; then
  pass "Backend is responding"
else
  fail "Backend failed to start within 15 seconds"
  echo "--- Backend log ---"
  cat /tmp/solprobe_e2e_backend.log 2>/dev/null || true
  exit 1
fi

# ------------------------------------------------------------------
# Step 2: Start sidecar in simulation mode
# ------------------------------------------------------------------
log "Starting sidecar in simulation mode (node=$NODE_ID)..."
(
  # shellcheck disable=SC1090
  [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
  cd "$PROJECT_ROOT/sidecar"
  cargo run -- \
    --simulate \
    --node-id "$NODE_ID" \
    --backend-addr "http://localhost:${GRPC_PORT}" \
    --metrics-port "$SIDECAR_METRICS_PORT" \
    > /tmp/solprobe_e2e_sidecar.log 2>&1
) &
SIDECAR_PID=$!
log "Sidecar PID: $SIDECAR_PID"

# Wait for sidecar Prometheus endpoint (longer timeout to account for cargo build)
if wait_for_http "http://127.0.0.1:${SIDECAR_METRICS_PORT}/metrics" 60; then
  pass "Sidecar Prometheus endpoint is responding"
else
  fail "Sidecar Prometheus endpoint failed to start"
  echo "--- Sidecar log ---"
  cat /tmp/solprobe_e2e_sidecar.log 2>/dev/null || true
  exit 1
fi

# ------------------------------------------------------------------
# Step 3: Wait for data to flow through the pipeline
# ------------------------------------------------------------------
log "Waiting 8 seconds for metrics to flow..."
sleep 8

# ------------------------------------------------------------------
# Step 4: Assert health endpoint shows connected_sidecars > 0
# ------------------------------------------------------------------
log "Checking health endpoint..."
HEALTH_JSON=$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/health" 2>/dev/null || echo "{}")

CONNECTED=$(echo "$HEALTH_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('connected_sidecars',0))" 2>/dev/null || echo "0")
if [ "$CONNECTED" -gt 0 ] 2>/dev/null; then
  pass "Health: connected_sidecars=$CONNECTED (> 0)"
else
  fail "Health: connected_sidecars=$CONNECTED (expected > 0)"
fi

# ------------------------------------------------------------------
# Step 5: Assert nodes endpoint returns node-0
# ------------------------------------------------------------------
log "Checking nodes endpoint..."
NODES_JSON=$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/nodes" 2>/dev/null || echo "[]")
NODE_COUNT=$(echo "$NODES_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$NODE_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Nodes: $NODE_COUNT node(s) registered (>= 1)"
else
  fail "Nodes: $NODE_COUNT nodes (expected >= 1)"
fi

# Check that node-0 is specifically present
HAS_NODE_0=$(echo "$NODES_JSON" | python3 -c "
import sys, json
nodes = json.load(sys.stdin)
found = any(n.get('node_id') == 'node-0' for n in nodes)
print('yes' if found else 'no')
" 2>/dev/null || echo "no")
if [ "$HAS_NODE_0" = "yes" ]; then
  pass "Nodes: node-0 is present"
else
  fail "Nodes: node-0 not found in response"
fi

# ------------------------------------------------------------------
# Step 6: Kill sidecar, restart with --inject-fault thermal_throttle
# ------------------------------------------------------------------
log "Stopping normal sidecar..."
kill "$SIDECAR_PID" 2>/dev/null || true
wait "$SIDECAR_PID" 2>/dev/null || true
SIDECAR_PID=""

# Use a different metrics port to avoid bind conflicts
FAULT_METRICS_PORT=9101
log "Starting sidecar with thermal_throttle fault injection (metrics port $FAULT_METRICS_PORT)..."
(
  # shellcheck disable=SC1090
  [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
  cd "$PROJECT_ROOT/sidecar"
  cargo run -- \
    --simulate \
    --node-id "$NODE_ID" \
    --backend-addr "http://localhost:${GRPC_PORT}" \
    --metrics-port "$FAULT_METRICS_PORT" \
    --inject-fault thermal_throttle \
    > /tmp/solprobe_e2e_sidecar_fault.log 2>&1
) &
SIDECAR_FAULT_PID=$!
log "Fault sidecar PID: $SIDECAR_FAULT_PID"

# Wait for fault sidecar to be ready (already compiled, should be fast)
if wait_for_http "http://127.0.0.1:${FAULT_METRICS_PORT}/metrics" 30; then
  pass "Fault sidecar is responding"
else
  fail "Fault sidecar failed to start"
  echo "--- Fault sidecar log ---"
  cat /tmp/solprobe_e2e_sidecar_fault.log 2>/dev/null || true
fi

# ------------------------------------------------------------------
# Step 7: Wait for fault alerts, then check alerts endpoint
# ------------------------------------------------------------------
log "Waiting 5 seconds for fault alerts..."
sleep 5

log "Checking alerts endpoint for CRITICAL thermal_throttle alerts..."
ALERTS_JSON=$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/alerts?severity=CRITICAL" 2>/dev/null || echo "[]")
CRITICAL_COUNT=$(echo "$ALERTS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
if [ "$CRITICAL_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Alerts: $CRITICAL_COUNT CRITICAL alert(s) found (>= 1)"
else
  fail "Alerts: $CRITICAL_COUNT CRITICAL alerts (expected >= 1)"
  # Show all alerts for debugging
  log "All alerts:"
  curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/v1/alerts" 2>/dev/null | python3 -m json.tool 2>/dev/null | head -30 || true
fi

# Check that at least one alert is thermal_throttle type
THERMAL_COUNT=$(echo "$ALERTS_JSON" | python3 -c "
import sys, json
alerts = json.load(sys.stdin)
count = sum(1 for a in alerts if a.get('alert_type') == 'thermal_throttle')
print(count)
" 2>/dev/null || echo "0")
if [ "$THERMAL_COUNT" -gt 0 ] 2>/dev/null; then
  pass "Alerts: $THERMAL_COUNT thermal_throttle alert(s) found"
else
  fail "Alerts: no thermal_throttle alerts found"
fi

# ------------------------------------------------------------------
# Step 8: Test Prometheus endpoint
# ------------------------------------------------------------------
log "Checking Prometheus endpoint..."

# Sidecar Prometheus: check for solprobe_gpu_temp metric
SIDECAR_PROM=$(curl -sf "http://127.0.0.1:${FAULT_METRICS_PORT}/metrics" 2>/dev/null || echo "")
if echo "$SIDECAR_PROM" | grep -q "solprobe_gpu_temp"; then
  pass "Sidecar Prometheus: solprobe_gpu_temp metric present"
else
  fail "Sidecar Prometheus: solprobe_gpu_temp metric not found"
fi

# Backend Prometheus
BACKEND_PROM=$(curl -sf "http://127.0.0.1:${BACKEND_PORT}/metrics" 2>/dev/null || echo "")
if echo "$BACKEND_PROM" | grep -q "solprobe_"; then
  pass "Backend Prometheus: solprobe_ metrics present"
else
  fail "Backend Prometheus: no solprobe_ metrics found"
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
log "=========================================="
log "  E2E Test Results"
log "=========================================="
log "  Passed: $PASS_COUNT"
log "  Failed: $FAIL_COUNT"
log "=========================================="
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
