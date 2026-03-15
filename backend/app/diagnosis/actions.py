"""Recovery action catalog for LLM diagnosis."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ActionDefinition:
    """A predefined recovery action the LLM can recommend."""

    action_id: str
    display_name: str
    description: str
    parameter_schema: dict = field(default_factory=dict)
    applicable_alert_types: list[str] = field(default_factory=list)
    default_urgency: str = "soon"


_ACTIONS: list[ActionDefinition] = [
    ActionDefinition(
        action_id="restart_from_checkpoint",
        display_name="Restart from Checkpoint",
        description="Restart training from the last known-good checkpoint.",
        parameter_schema={"checkpoint_id": "string (optional, defaults to latest)"},
        applicable_alert_types=[
            "gradient_explosion",
            "loss_spike",
            "inner_outer_divergence",
            "pseudo_grad_divergence",
        ],
        default_urgency="immediate",
    ),
    ActionDefinition(
        action_id="reassign_workload",
        display_name="Reassign Workload",
        description="Move workload off the affected node to a healthy node.",
        parameter_schema={"target_node": "string (optional)"},
        applicable_alert_types=[
            "thermal_throttle",
            "xid_error",
            "ecc_error",
            "memory_pressure",
            "straggler_detected",
        ],
        default_urgency="immediate",
    ),
    ActionDefinition(
        action_id="reduce_batch_size",
        display_name="Reduce Batch Size",
        description="Reduce the per-GPU batch size to lower memory/thermal pressure.",
        parameter_schema={"factor": "float (e.g. 0.5 for half)"},
        applicable_alert_types=["memory_pressure", "thermal_throttle"],
        default_urgency="soon",
    ),
    ActionDefinition(
        action_id="exclude_node",
        display_name="Exclude Node",
        description="Remove the node from the training cluster entirely.",
        parameter_schema={"node_id": "string"},
        applicable_alert_types=["ecc_error", "xid_error"],
        default_urgency="immediate",
    ),
    ActionDefinition(
        action_id="skip_corrupted_shard",
        display_name="Skip Corrupted Shard",
        description="Skip the current data shard and advance to the next one.",
        parameter_schema={"shard_id": "string (optional)"},
        applicable_alert_types=["loss_spike", "gradient_explosion"],
        default_urgency="soon",
    ),
    ActionDefinition(
        action_id="increase_timeout",
        display_name="Increase Timeout",
        description="Increase NCCL/communication timeout to tolerate slow nodes.",
        parameter_schema={"timeout_seconds": "int"},
        applicable_alert_types=["nccl_timeout", "diloco_sync_drift", "straggler_detected"],
        default_urgency="soon",
    ),
    ActionDefinition(
        action_id="rollback_lr",
        display_name="Rollback Learning Rate",
        description="Reduce learning rate to stabilize training after instability.",
        parameter_schema={"factor": "float (e.g. 0.1 for 10x reduction)"},
        applicable_alert_types=["gradient_explosion", "loss_spike", "inner_outer_divergence"],
        default_urgency="soon",
    ),
]

ACTION_MAP: dict[str, ActionDefinition] = {a.action_id: a for a in _ACTIONS}
VALID_ACTION_IDS: list[str] = list(ACTION_MAP.keys())


def get_catalog_prompt_text() -> str:
    """Format the action catalog for inclusion in the LLM system prompt."""
    lines: list[str] = ["Available recovery actions:"]
    for a in _ACTIONS:
        lines.append(f"\n- **{a.action_id}** ({a.display_name})")
        lines.append(f"  Description: {a.description}")
        lines.append(f"  Applicable to: {', '.join(a.applicable_alert_types)}")
        lines.append(f"  Default urgency: {a.default_urgency}")
        if a.parameter_schema:
            params = ", ".join(f"{k}: {v}" for k, v in a.parameter_schema.items())
            lines.append(f"  Parameters: {params}")
    return "\n".join(lines)
