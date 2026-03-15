"""System prompt, prompt builder, and tool schema for LLM diagnosis."""

from __future__ import annotations

import json
import logging

from app.diagnosis.actions import VALID_ACTION_IDS, get_catalog_prompt_text
from app.diagnosis.models import DiagnosisResult
from app.models.alerts import EnrichedAlert

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are SolProbe, an expert autonomous fault diagnosis agent for distributed GPU training clusters.

## Domain Knowledge

### GPU Hardware (T4/L4 only)
- T4: Turing (TU104), 16GB GDDR6, 70W TDP, PCIe Gen3 x16, no NVLink, supports page retirement
- L4: Ada Lovelace (AD104), 24GB GDDR6, 72W TDP, PCIe Gen4 x16, no NVLink, supports row remapping
- Critical DCGM fields: GPU_TEMP (throttle >85°C), GPU_UTIL, FB_USED/FREE, POWER_USAGE, XID_ERRORS, CLOCK_THROTTLE_REASONS, ECC errors (SBE=correctable, DBE=uncorrectable), PCIe replay counter
- Page retirement (T4) or row remapping (L4) indicates degrading DRAM — escalates from SBE to DBE

### Training Patterns
- Normal loss curve: monotonically decreasing with noise
- Gradient norm: stable within 2 standard deviations; spikes indicate instability
- Throughput: consistent across nodes; stragglers drag collective operations
- MFU (Model FLOP Utilization): drops indicate compute inefficiency

### DiLoCo (Distributed Local Computation)
- Inner loop: local SGD steps on each worker
- Outer loop: periodic pseudo-gradient synchronization across workers
- Inner loss↓ + outer loss↑ = divergence between local and global models
- Sync duration spikes indicate network or straggler issues
- Pseudo-gradient norm divergence across workers = heterogeneous data or learning rates

### Alert Types
| Type | Root Cause Pattern |
|------|-------------------|
| thermal_throttle | GPU overheating → clock reduction → throughput drop |
| memory_pressure | OOM risk → allocation failures → training crash |
| xid_error | Hardware fault (GPU hang, bus error) → requires node exclusion |
| ecc_error | Memory cell degradation → data corruption risk |
| clock_throttle | Power/thermal limit → reduced performance |
| gradient_explosion | Learning rate too high, corrupted data, or numerical instability |
| loss_spike | Bad data batch, gradient explosion propagation, or checkpoint corruption |
| nccl_timeout | Network issue or straggler blocking collective operation |
| straggler_detected | One node significantly slower than cluster mean |
| diloco_sync_drift | Sync taking >2x normal → network degradation or heterogeneous compute |
| pseudo_grad_divergence | Workers learning differently → data heterogeneity or LR mismatch |
| inner_outer_divergence | Local models diverging from global → needs checkpoint restart |

{action_catalog}

## Your Task
Analyze the provided alert with its contextual data (metrics, history, correlated events) and produce a structured diagnosis. Use the submit_diagnosis tool to return your findings.

## Guidelines
1. Always provide a root cause — use "unknown" only if genuinely ambiguous
2. Confidence should reflect certainty: >0.8 for clear patterns, 0.5-0.8 for probable, <0.5 for uncertain
3. Evidence chain should cite specific metric values from the provided data
4. Consider correlated events across nodes for cluster-wide issues
5. If similar past diagnoses are provided, reference them for consistency
6. Recommended action must be from the catalog — choose the most appropriate one
"""

# Root causes the LLM can choose from
ROOT_CAUSES = [
    "thermal_throttle",
    "memory_exhaustion",
    "hardware_fault",
    "ecc_degradation",
    "power_limit",
    "gradient_instability",
    "data_corruption",
    "network_degradation",
    "straggler_bottleneck",
    "sync_failure",
    "model_divergence",
    "learning_rate_issue",
    "nccl_failure",
    "clock_throttle",
    "unknown",
]

DIAGNOSIS_TOOL = {
    "name": "submit_diagnosis",
    "description": "Submit the structured diagnosis result for the given alert.",
    "input_schema": {
        "type": "object",
        "required": [
            "root_cause",
            "confidence",
            "reasoning",
            "evidence_chain",
            "recommended_action",
        ],
        "properties": {
            "root_cause": {
                "type": "string",
                "enum": ROOT_CAUSES,
                "description": "The identified root cause of the alert.",
            },
            "confidence": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0,
                "description": "Confidence in the diagnosis (0-1).",
            },
            "reasoning": {
                "type": "string",
                "description": "Step-by-step reasoning explaining how you arrived at this diagnosis.",
            },
            "evidence_chain": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["metric", "value", "context"],
                    "properties": {
                        "metric": {"type": "string"},
                        "value": {"type": "string"},
                        "context": {"type": "string"},
                    },
                },
                "description": "List of evidence items supporting the diagnosis.",
            },
            "recommended_action": {
                "type": "object",
                "required": ["action", "params", "urgency"],
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": VALID_ACTION_IDS,
                    },
                    "params": {
                        "type": "object",
                        "description": "Action-specific parameters.",
                    },
                    "urgency": {
                        "type": "string",
                        "enum": ["immediate", "soon", "monitor"],
                    },
                },
            },
        },
    },
}


def build_system_prompt() -> str:
    """Build the full system prompt with action catalog inserted."""
    return SYSTEM_PROMPT.format(action_catalog=get_catalog_prompt_text())


def build_user_message(
    enriched: EnrichedAlert,
    similar_diagnoses: list[DiagnosisResult],
) -> str:
    """Build the user message with alert context for the LLM."""
    parts: list[str] = []

    # Triggering alert
    alert = enriched.alert
    parts.append("## Triggering Alert")
    parts.append(f"- Alert ID: {alert.alert_id}")
    parts.append(f"- Node: {alert.node_id}")
    parts.append(f"- Type: {alert.alert_type}")
    parts.append(f"- Severity: {alert.severity}")
    parts.append(f"- Source: {alert.source}")
    parts.append(f"- Description: {alert.description}")
    parts.append(f"- Confidence: {alert.confidence}")
    if alert.evidence:
        parts.append(f"- Evidence: {json.dumps(alert.evidence)}")

    # Recent metrics (sampled to ~20 points to manage tokens)
    if enriched.recent_metrics:
        parts.append("\n## Recent Metrics (±2 minute window)")
        metrics = enriched.recent_metrics
        if len(metrics) > 20:
            step = len(metrics) // 20
            metrics = metrics[::step][:20]
        for m in metrics:
            parts.append(f"  {json.dumps(m)}")

    # Node history
    if enriched.node_history:
        parts.append("\n## Node Alert History (last 10)")
        for h in enriched.node_history:
            parts.append(
                f"  - [{h.severity}] {h.alert_type}: {h.description} "
                f"(ts={h.timestamp_ms})"
            )

    # Correlated events
    if enriched.correlated_events:
        parts.append("\n## Correlated Events (±30s from other nodes)")
        for e in enriched.correlated_events:
            parts.append(
                f"  - Node {e.node_id} [{e.severity}] {e.alert_type}: "
                f"{e.description}"
            )

    # Similar past diagnoses (RAG)
    if similar_diagnoses:
        parts.append("\n## Similar Past Diagnoses")
        for sd in similar_diagnoses:
            parts.append(f"  - Diagnosis {sd.diagnosis_id}: root_cause={sd.root_cause}, "
                         f"confidence={sd.confidence}, action={sd.recommended_action.action}")

    return "\n".join(parts)
