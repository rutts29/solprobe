# SolProbe SP-3: LLM Diagnosis Agent — Full Spec for Cloud Agent Execution

## Context

SolProbe is an autonomous fault detection and recovery system for distributed GPU training (T4/L4). SP-1 (Rust sidecar) and SP-2 (FastAPI backend) are **complete** — the metrics pipeline collects GPU + training telemetry, detects anomalies (edge thresholds in Rust, statistical/cross-node in Python), and exposes alerts via REST API + WebSocket.

**This plan covers SP-3: LLM Diagnosis Agent** — an AI-powered diagnostic system that receives alerts, correlates them with metrics context, and produces structured diagnoses with root cause classification and recovery action recommendations.

**Why this matters:** Existing tools (TensorPool, Neurox) can detect crashes but cannot diagnose root causes. SolProbe's differentiator is the LLM agent that says not just "something is wrong" but "this is an NCCL timeout on rank 7 caused by thermal throttle on GPU 3, recommended action: reassign workload."

---

## Cloud Agent Instructions

**IMPORTANT: This plan is designed for autonomous execution by a cloud Claude Code agent (Opus 4.6). Follow these methodologies:**

### Development Methodology
1. **Test-Driven Development (TDD)**: For each step, write tests FIRST, then implement until tests pass. Tests go in `backend/tests/`.
2. **Subagent-Driven Development**: If available, use subagents for parallel independent tasks (e.g., writing tests while implementing models).
3. **Incremental verification**: After each step, run `cd backend && source .venv/bin/activate && python -m pytest tests/ -v` to verify nothing is broken.

### Setup Commands
```bash
# Activate Python environment
cd /path/to/solprobe/backend && source .venv/bin/activate

# Install deps (after modifying pyproject.toml in Step 0)
pip install -e ".[dev]"

# Run tests
python -m pytest tests/ -v

# Start backend (for manual verification)
uvicorn app.main:app --port 8000 --app-dir .
```

### Codebase Patterns (MUST follow for consistency)
1. **Store pattern**: Thread-safe `threading.Lock`, `deque(maxlen=N)`, module-level singleton at file bottom
2. **Model pattern**: Pydantic `BaseModel` with `Field(description=...)`, `from __future__ import annotations` first
3. **Background loop pattern**: `async def _xxx_loop()` with `while True: await asyncio.sleep(N)`, appended to `_background_tasks` in `lifespan()`
4. **API route pattern**: `APIRouter(prefix="/api/v1", tags=[...])`, async functions, `HTTPException(404)` for not-found
5. **WebSocket broadcast**: `ws_manager.broadcast_alert(alert)` from detector loops, `call_soon_threadsafe()` from gRPC threads
6. **Test pattern**: `pytest.mark.asyncio(loop_scope="function")`, `fresh_stores` fixture with monkeypatching, `_make_alert()` helpers in `conftest.py`, `AsyncClient` with `ASGITransport`
7. **Imports**: `from __future__ import annotations` first, stdlib, third-party, `app.*`
8. **Logging**: `logger = logging.getLogger(__name__)` per module
9. **No Co-Authored-By lines in commits**

---

## Existing Code Reference (what you're integrating with)

### Key Files
- `backend/app/models/alerts.py` — `AlertModel`, `AnomalyModel`, `EnrichedAlert`
- `backend/app/enrichment.py` — `enrich_alert(alert: AlertModel) -> EnrichedAlert` (attaches ±2min metrics, 10 prior alerts, ±30s correlated events)
- `backend/app/stores.py` — `MetricsStore` (ring buffer per node), `AlertStore` (bounded deque), `AnomalyStore`, `JobStore` — all thread-safe singletons
- `backend/app/api/routes.py` — REST endpoints including `GET /alerts/{alert_id}/enriched`
- `backend/app/grpc_server.py` — gRPC server with `ReportAlert` handler, `_ALERT_TYPE_MAP` for proto→string mapping
- `backend/app/main.py` — FastAPI lifespan, 5 background tasks, gRPC server lifecycle
- `backend/app/ws/websocket.py` — `ConnectionManager` with `broadcast_alert()`, per-client filters

### Alert Taxonomy (14 active types)
| AlertType | Source | Severity | Trigger |
|-----------|--------|----------|---------|
| thermal_throttle | EDGE + CENTRAL | CRIT/WARN | gpu_temp > 85°C / z-score > 3 |
| memory_pressure | EDGE | CRIT/WARN | fb memory > 95% / 90% |
| xid_error | EDGE | CRITICAL | xid_errors != 0 |
| ecc_error | EDGE | CRITICAL | ecc_dbe_count > 0 |
| clock_throttle | EDGE + CENTRAL | WARNING | throttle bitmask != 0 / z-score |
| gradient_explosion | EDGE + CENTRAL | CRIT/WARN | grad_norm > 100 / z-score |
| loss_spike | CENTRAL | CRITICAL | loss z-score > 3.0 |
| nccl_timeout | CENTRAL | CRITICAL | 2+ nodes with alerts in 30s |
| straggler_detected | CENTRAL | WARNING | throughput < 80% cluster mean |
| diloco_sync_drift | CENTRAL | WARNING | sync_duration > 2x historical mean |
| pseudo_grad_divergence | CENTRAL | WARNING | cross-worker pseudo_grad z > 3 |
| inner_outer_divergence | CENTRAL | CRITICAL | inner_loss↓ + outer_loss↑ for 3+ steps |

---

## Implementation Steps

### STEP 0: Add anthropic dependency
**File**: `backend/pyproject.toml`
- Add `"anthropic>=0.40"` to `dependencies` list
- Run: `pip install -e ".[dev]"`

### STEP 1: Create diagnosis Pydantic models
**New file**: `backend/app/diagnosis/__init__.py` — docstring only
**New file**: `backend/app/diagnosis/models.py`

Models to create:
- `EvidenceItem(BaseModel)`: metric (str), value (str), context (str)
- `RecommendedAction(BaseModel)`: action (str), params (dict), urgency (str: "immediate"|"soon"|"monitor")
- `SimilarIncident(BaseModel)`: diagnosis_id, root_cause, similarity (float 0-1)
- `DiagnosisResult(BaseModel)`: diagnosis_id, alert_id, node_id, timestamp_ms, root_cause, confidence (0-1), reasoning (str), evidence_chain (list[EvidenceItem]), recommended_action (RecommendedAction), similar_incidents (list[SimilarIncident]), llm_model (str), latency_ms (int), status ("completed"|"failed"|"rate_limited"), error (str|None)
- `DiagnosisRequest(BaseModel)`: alert_id (str) — POST body for manual triggers

### STEP 2: Create DiagnosisStore
**New file**: `backend/app/diagnosis/store.py`
- Thread-safe bounded deque (max 500)
- Methods: `add(diagnosis)`, `get_by_id(id)`, `get_by_alert_id(alert_id)`, `query(node_id=, root_cause=, limit=50)`, `find_similar(alert_type, limit=3)` (for RAG — returns completed diagnoses matching root_cause), `count` property
- Module-level singleton: `diagnosis_store = DiagnosisStore()`

### STEP 3: Create recovery action catalog
**New file**: `backend/app/diagnosis/actions.py`
- `ActionDefinition` dataclass: action_id, display_name, description, parameter_schema (dict), applicable_alert_types (list), default_urgency
- 7 predefined actions:
  1. `restart_from_checkpoint` — for gradient_explosion, loss_spike, inner_outer_divergence, pseudo_grad_divergence (urgency: immediate)
  2. `reassign_workload` — for thermal_throttle, xid_error, ecc_error, memory_pressure, straggler_detected (urgency: immediate)
  3. `reduce_batch_size` — for memory_pressure, thermal_throttle (urgency: soon)
  4. `exclude_node` — for ecc_error, xid_error (urgency: immediate)
  5. `skip_corrupted_shard` — for loss_spike, gradient_explosion (urgency: soon)
  6. `increase_timeout` — for nccl_timeout, diloco_sync_drift, straggler_detected (urgency: soon)
  7. `rollback_lr` — for gradient_explosion, loss_spike, inner_outer_divergence (urgency: soon)
- `ACTION_MAP: dict[str, ActionDefinition]` and `VALID_ACTION_IDS: list[str]`
- `get_catalog_prompt_text() -> str` — formats catalog for LLM system prompt

### STEP 4: Create rate limiter
**New file**: `backend/app/diagnosis/rate_limiter.py`
- `DiagnosisRateLimiter`: per-node cooldown (default 30s), `try_acquire(node_id) -> bool`, `reset(node_id)`, `reset_all()`
- Thread-safe with `threading.Lock`
- Singleton: `diagnosis_rate_limiter = DiagnosisRateLimiter()`

### STEP 5: Create system prompt and prompt builder
**New file**: `backend/app/diagnosis/prompts.py`
- `SYSTEM_PROMPT` — domain knowledge about T4/L4 GPUs, training patterns, DiLoCo, alert types. Includes `{action_catalog}` placeholder
- `build_system_prompt() -> str` — inserts action catalog text
- `build_user_message(enriched: EnrichedAlert, similar_diagnoses: list[DiagnosisResult]) -> str` — formats: triggering alert, recent metrics (sampled to 20 points to manage tokens), node history, correlated events, similar past diagnoses
- `DIAGNOSIS_TOOL` — Claude tool_use schema with fields: root_cause (enum of 15 values including "data_corruption", "network_degradation", "unknown"), confidence (0-1), reasoning, evidence_chain, recommended_action (action enum of 7 valid IDs, params, urgency)

### STEP 6: Create the diagnosis agent
**New file**: `backend/app/diagnosis/agent.py`
- `DiagnosisAgent` class:
  - `__init__(api_key=None, model="claude-sonnet-4-20250514")` — reads `ANTHROPIC_API_KEY` env var, initializes `anthropic.Anthropic` client
  - `diagnose(alert: AlertModel, bypass_rate_limit=False) -> DiagnosisResult`:
    1. Check rate limit (return `status="rate_limited"` if blocked)
    2. Call `enrich_alert(alert)` to get full context
    3. Call `diagnosis_store.find_similar(alert.alert_type, limit=3)` for RAG
    4. Build prompt via `build_user_message(enriched, similar_raw)`
    5. Call `self._client.messages.create()` with `tools=[DIAGNOSIS_TOOL]`, `tool_choice={"type": "tool", "name": "submit_diagnosis"}`
    6. Parse `tool_use` response block into `DiagnosisResult`
    7. Store result via `diagnosis_store.add(result)`
    8. Return result
  - On error: return `DiagnosisResult(status="failed", error=str(exc))`
  - `_parse_response()` — extracts tool_use block, builds EvidenceItem list and RecommendedAction
- Lazy singleton: `get_or_create_agent() -> DiagnosisAgent`
- **Note**: `diagnose()` is synchronous (Anthropic SDK is sync). Wrap with `asyncio.to_thread()` when calling from async code.

### STEP 7: Add REST API endpoints
**Modify**: `backend/app/api/routes.py`
- Add imports: `asyncio`, diagnosis agent/store/models
- `GET /api/v1/diagnoses` — query diagnoses (node_id, root_cause, limit filters)
- `GET /api/v1/diagnoses/{diagnosis_id}` — get single diagnosis
- `POST /api/v1/diagnoses` — manual trigger (body: `DiagnosisRequest`), bypasses rate limit, runs in thread pool via `asyncio.to_thread()`
- `GET /api/v1/alerts/{alert_id}/diagnosis` — get diagnosis for specific alert

### STEP 8: Add WebSocket broadcast for diagnoses
**Modify**: `backend/app/ws/websocket.py`
- Add `broadcast_diagnosis(diagnosis: DiagnosisResult)` to `ConnectionManager`
- Same pattern as `broadcast_alert` — JSON payload `{"type": "diagnosis", "data": diagnosis.model_dump()}`

### STEP 9: Wire into main.py
**Modify**: `backend/app/main.py`
- Add `_auto_diagnosis_loop()`: every 5s, check `alert_store` for CRITICAL alerts without diagnoses, run diagnosis via `asyncio.to_thread(agent.diagnose, alert)`, broadcast result via WebSocket
- Register task in `lifespan()`: `_background_tasks.append(asyncio.create_task(_auto_diagnosis_loop()))`
- Update health endpoint: add `"total_diagnoses": diagnosis_store.count`
- Add Prometheus gauge: `solprobe_total_diagnoses`

### STEP 10: Hook gRPC ReportAlert
**Modify**: `backend/app/grpc_server.py`
- After `alert_store.add(alert_model)` in `ReportAlert`, for CRITICAL alerts:
  - Schedule `_run_diagnosis_in_thread(alert_model)` via `_event_loop.call_soon_threadsafe()`
  - Helper does: check if already diagnosed, call `agent.diagnose()` in thread, broadcast result

---

## Tests (write FIRST per TDD)

### Test file: `backend/tests/test_diagnosis_models.py`
- DiagnosisResult serialization round-trip
- EvidenceItem validation
- RecommendedAction urgency enum validation

### Test file: `backend/tests/test_diagnosis_store.py`
- add + get_by_id
- get_by_alert_id
- query with filters (node_id, root_cause)
- find_similar returns matching root_causes
- bounded at 500 entries
- thread safety (concurrent adds)

### Test file: `backend/tests/test_diagnosis_agent.py` (MOCK the LLM)
- Mock `anthropic.Anthropic.messages.create` to return a fake tool_use response
- Test full `diagnose()` pipeline: enrichment → prompt building → parsing → storage
- Test rate limiting: second call within 30s returns `status="rate_limited"`
- Test error handling: API error → `status="failed"`
- Test bypass_rate_limit flag

### Test file: `backend/tests/test_diagnosis_api.py`
- GET /diagnoses (empty, with data, filters)
- GET /diagnoses/{id} (found, 404)
- POST /diagnoses (mock LLM, verify 201)
- GET /alerts/{id}/diagnosis (found, 404)

### Run all tests:
```bash
cd backend && source .venv/bin/activate && python -m pytest tests/ -v
```

---

## Verification Plan

### Unit tests
```bash
cd backend && python -m pytest tests/ -v
# Expected: all existing 55 tests + ~30 new diagnosis tests pass
```

### Manual E2E test
```bash
# Terminal 1: Start backend
export ANTHROPIC_API_KEY="your-anthropic-api-key"
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000

# Terminal 2: Start sidecar with fault injection
source ~/.cargo/env && cd sidecar && cargo run -- --simulate --inject-fault thermal_throttle --node-id node-0

# Wait 15s, then:
curl -s http://localhost:8000/api/v1/diagnoses | python3 -m json.tool
# Should show at least 1 diagnosis with root_cause="thermal_throttle"

# Manual diagnosis trigger:
ALERT_ID=$(curl -s http://localhost:8000/api/v1/alerts | python3 -c "import sys,json; print(json.loads(sys.stdin.read())[0]['alert_id'])")
curl -X POST http://localhost:8000/api/v1/diagnoses -H "Content-Type: application/json" -d "{\"alert_id\": \"$ALERT_ID\"}" | python3 -m json.tool
```

### Without API key (offline mode)
If `ANTHROPIC_API_KEY` is not set, the agent will log a warning and all diagnoses will return `status="failed"`. Tests use mocked responses and work without an API key.

---

## File Summary

### New files (7)
| File | Purpose |
|------|---------|
| `backend/app/diagnosis/__init__.py` | Package docstring |
| `backend/app/diagnosis/models.py` | Pydantic models: DiagnosisResult, EvidenceItem, RecommendedAction, etc. |
| `backend/app/diagnosis/store.py` | DiagnosisStore: thread-safe bounded deque |
| `backend/app/diagnosis/actions.py` | Recovery action catalog (7 actions) |
| `backend/app/diagnosis/rate_limiter.py` | Per-node rate limiter (30s cooldown) |
| `backend/app/diagnosis/prompts.py` | System prompt, prompt builder, DIAGNOSIS_TOOL schema |
| `backend/app/diagnosis/agent.py` | DiagnosisAgent: orchestrates enrichment → LLM → parsing → storage |

### Modified files (4)
| File | Changes |
|------|---------|
| `backend/app/api/routes.py` | Add 4 diagnosis endpoints |
| `backend/app/ws/websocket.py` | Add `broadcast_diagnosis()` method |
| `backend/app/main.py` | Add auto-diagnosis loop, health/prometheus updates |
| `backend/app/grpc_server.py` | Hook CRITICAL edge alerts for auto-diagnosis |

### New test files (4)
| File | Tests |
|------|-------|
| `backend/tests/test_diagnosis_models.py` | Model serialization/validation |
| `backend/tests/test_diagnosis_store.py` | Store operations + thread safety |
| `backend/tests/test_diagnosis_agent.py` | Full pipeline with mocked LLM |
| `backend/tests/test_diagnosis_api.py` | API endpoints with mocked agent |

### Config change (1)
| File | Change |
|------|--------|
| `backend/pyproject.toml` | Add `"anthropic>=0.40"` to dependencies |

---

## Delegation Notes

**Cloud agent executes ALL of the above.** The plan is self-contained — no local decisions needed. The cloud agent should:
1. Follow TDD: write test files first, then implement
2. Run `pytest` after each step
3. Commit after each step (or batch related steps)
4. Push to `origin/main` (or create a `feature/sp3-llm-diagnosis` branch for PR review)

**Local review focuses on:**
- Prompt quality (does the system prompt produce good diagnoses?)
- Cost management (is the rate limiter sufficient?)
- Integration correctness (do diagnoses appear in the API?)

These are reviewed AFTER the cloud agent pushes code, not during implementation.
