#!/usr/bin/env bash
#
# SolProbe nanochat showcase demo.
#
# Brings up the full stack against a real Apple Silicon sidecar, registers a
# nanochat training job, and prints dashboard URLs. Optionally runs the patched
# nanochat MPS smoke trainer when SOLPROBE_DEMO_TRAIN=1.
#
# Usage:
#   bash scripts/demo_nanochat_solprobe.sh [--run-id <id>]
#
# Environment overrides:
#   BACKEND_PORT       (default 8000)
#   DASHBOARD_PORT     (default 3000)
#   SIDECAR_METRICS_PORT (default 9100)
#   GRPC_PORT          (default 50051)
#   NODE_ID            (default node-0)
#   SOLPROBE_API_KEY   (default solprobe-demo-key)
#   SOLPROBE_DEMO_TRAIN  set to 1 to launch patched nanochat smoke training
#   NANOCHAT_DIR       (default .worktrees/nanochat-solprobe)
#   SOLPROBE_MMAP_DIR  (default .runs/<run_id>/mmap)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Source .env if present so port overrides survive across runs.
if [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

BACKEND_PORT="${BACKEND_PORT:-8000}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"
SIDECAR_METRICS_PORT="${SIDECAR_METRICS_PORT:-9100}"
GRPC_PORT="${GRPC_PORT:-50051}"
NODE_ID="${NODE_ID:-node-0}"
SOLPROBE_API_KEY="${SOLPROBE_API_KEY:-solprobe-demo-key}"

RUN_ID="nanochat-$(date +%s)"
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --run-id=*)
      RUN_ID="${1#--run-id=}"
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

LOG_DIR="$PROJECT_ROOT/.runs/$RUN_ID"
mkdir -p "$LOG_DIR"
SOLPROBE_MMAP_DIR="${SOLPROBE_MMAP_DIR:-$LOG_DIR/mmap}"
NANOCHAT_DIR="${NANOCHAT_DIR:-$PROJECT_ROOT/.worktrees/nanochat-solprobe}"
mkdir -p "$SOLPROBE_MMAP_DIR"

if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' NC=''
fi
log()  { echo -e "${YELLOW}[demo]${NC} $*"; }
ok()   { echo -e "${GREEN}[demo]${NC} $*"; }
warn() { echo -e "${RED}[demo]${NC} $*"; }

BACKEND_PID=""
DASHBOARD_PID=""
SIDECAR_PID=""
TRAINING_PID=""

cleanup() {
  log "Cleaning up..."
  for pid in "$TRAINING_PID" "$SIDECAR_PID" "$DASHBOARD_PID" "$BACKEND_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in "$TRAINING_PID" "$SIDECAR_PID" "$DASHBOARD_PID" "$BACKEND_PID"; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

is_up() {
  curl -sf -o /dev/null --max-time 2 "$1"
}

wait_for_http() {
  local url="$1" timeout="$2" elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if is_up "$url"; then return 0; fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

# ---------------------------------------------------------------------------
# Backend
# ---------------------------------------------------------------------------
BACKEND_HEALTH="http://127.0.0.1:${BACKEND_PORT}/api/v1/health"
if is_up "$BACKEND_HEALTH"; then
  ok "Backend already running on :${BACKEND_PORT}"
else
  log "Starting backend on :${BACKEND_PORT} (logs: $LOG_DIR/backend.log)"
  if [ ! -d "$PROJECT_ROOT/backend/.venv" ]; then
    warn "backend/.venv missing — run: cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e \".[dev]\""
    exit 1
  fi
  if [ ! -f "$PROJECT_ROOT/backend/app/generated/alerts_pb2.py" ] \
      || [ ! -f "$PROJECT_ROOT/backend/app/generated/metrics_pb2.py" ]; then
    log "Generating gRPC stubs from proto (one-time)"
    (
      # shellcheck disable=SC1091
      source "$PROJECT_ROOT/backend/.venv/bin/activate"
      cd "$PROJECT_ROOT"
      python -m grpc_tools.protoc \
        -I proto \
        --python_out=backend/app/generated \
        --pyi_out=backend/app/generated \
        --grpc_python_out=backend/app/generated \
        proto/metrics.proto proto/alerts.proto
    ) > "$LOG_DIR/proto_gen.log" 2>&1 || {
      warn "proto generation failed (see $LOG_DIR/proto_gen.log)"
      exit 1
    }
  fi
  (
    # shellcheck disable=SC1091
    source "$PROJECT_ROOT/backend/.venv/bin/activate"
    cd "$PROJECT_ROOT/backend"
    SOLPROBE_API_KEY="$SOLPROBE_API_KEY" LOG_LEVEL=debug uvicorn app.main:app \
      --host 127.0.0.1 \
      --port "$BACKEND_PORT" \
      --log-level debug \
      > "$LOG_DIR/backend.log" 2>&1
  ) &
  BACKEND_PID=$!
  if ! wait_for_http "$BACKEND_HEALTH" 30; then
    warn "Backend failed to come up within 30s. Last 20 log lines:"
    tail -20 "$LOG_DIR/backend.log" || true
    exit 1
  fi
  ok "Backend healthy"
fi

# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
DASHBOARD_URL="http://127.0.0.1:${DASHBOARD_PORT}"
if is_up "$DASHBOARD_URL"; then
  ok "Dashboard already running on :${DASHBOARD_PORT}"
else
  log "Starting dashboard on :${DASHBOARD_PORT} (logs: $LOG_DIR/dashboard.log)"
  if [ ! -d "$PROJECT_ROOT/dashboard/node_modules" ]; then
    warn "dashboard/node_modules missing — run: cd dashboard && npm install"
    exit 1
  fi
  (
    cd "$PROJECT_ROOT/dashboard"
    NEXT_PUBLIC_API_URL="http://127.0.0.1:${BACKEND_PORT}" \
      NEXT_PUBLIC_WS_URL="ws://127.0.0.1:${BACKEND_PORT}/ws/stream" \
      PORT="$DASHBOARD_PORT" npm run dev > "$LOG_DIR/dashboard.log" 2>&1
  ) &
  DASHBOARD_PID=$!
  # Next dev server can take a while on first compile.
  if ! wait_for_http "$DASHBOARD_URL" 60; then
    warn "Dashboard failed to come up within 60s. Last 30 log lines:"
    tail -30 "$LOG_DIR/dashboard.log" || true
    exit 1
  fi
  ok "Dashboard ready"
fi

# ---------------------------------------------------------------------------
# Sidecar (real Apple Silicon metrics, attached to run job_id)
# ---------------------------------------------------------------------------
SIDECAR_METRICS_URL="http://127.0.0.1:${SIDECAR_METRICS_PORT}/metrics"
if is_up "$SIDECAR_METRICS_URL"; then
  ok "Sidecar already running on :${SIDECAR_METRICS_PORT}"
else
  log "Starting sidecar (node=$NODE_ID, job=$RUN_ID, logs: $LOG_DIR/sidecar.log)"
  if [ ! -d "$PROJECT_ROOT/sidecar" ]; then
    warn "sidecar/ directory not found"
    exit 1
  fi
  (
    # shellcheck disable=SC1090
    [ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"
    cd "$PROJECT_ROOT/sidecar"
    cargo run -- \
      --apple-gpu \
      --node-id "$NODE_ID" \
      --job-id "$RUN_ID" \
      --backend-addr "http://localhost:${GRPC_PORT}" \
      --metrics-port "$SIDECAR_METRICS_PORT" \
      --mmap-dir "$SOLPROBE_MMAP_DIR" \
      > "$LOG_DIR/sidecar.log" 2>&1
  ) &
  SIDECAR_PID=$!
  # Cargo first build on a clean tree can take 60s+.
  if ! wait_for_http "$SIDECAR_METRICS_URL" 120; then
    warn "Sidecar failed to come up within 120s. Last 30 log lines:"
    tail -30 "$LOG_DIR/sidecar.log" || true
    exit 1
  fi
  ok "Sidecar streaming"
fi

# ---------------------------------------------------------------------------
# Register the nanochat job
# ---------------------------------------------------------------------------
log "Registering job $RUN_ID on backend"
JOB_BODY=$(cat <<EOF
{
  "job_id": "$RUN_ID",
  "name": "Nanochat MPS demo",
  "config": {"trainer": "nanochat scripts.base_train", "model": "nanochat", "device": "mps"},
  "node_ids": ["$NODE_ID"]
}
EOF
)
if curl -sf -X POST "http://127.0.0.1:${BACKEND_PORT}/api/v1/jobs" \
  -H 'Content-Type: application/json' \
  -H "X-SolProbe-API-Key: ${SOLPROBE_API_KEY}" \
  -d "$JOB_BODY" > "$LOG_DIR/job_register.json"; then
  ok "Job registered: $RUN_ID"
else
  warn "Job registration failed (see $LOG_DIR/job_register.json)"
fi

# ---------------------------------------------------------------------------
# Optional: launch patched nanochat MPS smoke trainer
# ---------------------------------------------------------------------------
if [ "${SOLPROBE_DEMO_TRAIN:-0}" = "1" ]; then
  log "Launching nanochat MPS smoke trainer (logs: $LOG_DIR/training.log)"
  if [ ! -d "$NANOCHAT_DIR" ]; then
    warn "nanochat worktree missing at $NANOCHAT_DIR"
    warn "Expected the patched karpathy/nanochat checkout with runs/run_solprobe_mps_smoke.sh"
    exit 1
  fi
  curl -sf -X PATCH "http://127.0.0.1:${BACKEND_PORT}/api/v1/jobs/${RUN_ID}/status" \
    -H 'Content-Type: application/json' \
    -H "X-SolProbe-API-Key: ${SOLPROBE_API_KEY}" \
    -d '{"status":"running"}' > "$LOG_DIR/job_status_running.json" || true
  (
    cd "$NANOCHAT_DIR"
    export SOLPROBE_REPO="$PROJECT_ROOT"
    export SOLPROBE_MMAP_DIR="$SOLPROBE_MMAP_DIR"
    export WANDB_RUN="$RUN_ID"
    bash runs/run_solprobe_mps_smoke.sh > "$LOG_DIR/training.log" 2>&1
  ) &
  TRAINING_PID=$!
  ok "Training PID: $TRAINING_PID"
else
  log "SOLPROBE_DEMO_TRAIN!=1 — skipping nanochat launch (sidecar still streams Apple GPU metrics)"
fi

# ---------------------------------------------------------------------------
# Print dashboard URLs and wait
# ---------------------------------------------------------------------------
cat <<EOF

${GREEN}SolProbe demo running.${NC}
  run_id  = $RUN_ID
  logs    = $LOG_DIR
  mmap    = $SOLPROBE_MMAP_DIR
  nanochat= $NANOCHAT_DIR
  api_key = $SOLPROBE_API_KEY

  http://localhost:${DASHBOARD_PORT}/overview
  http://localhost:${DASHBOARD_PORT}/training
  http://localhost:${DASHBOARD_PORT}/alerts
  http://localhost:${DASHBOARD_PORT}/policies
  http://localhost:${DASHBOARD_PORT}/nodes/${NODE_ID}

Press Ctrl+C to stop all components.
EOF

# If we started any owned processes, wait on them so Ctrl+C cleans up.
if [ -n "$BACKEND_PID$DASHBOARD_PID$SIDECAR_PID$TRAINING_PID" ]; then
  wait
fi
