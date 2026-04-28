"""Central detection configuration.

All thresholds and windows for the statistical detectors live here.
Values can be overridden via environment variables (prefix DETECT_)
or by passing a custom DetectionConfig to each detector.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class DetectionConfig(BaseSettings):
    model_config = {"env_prefix": "DETECT_"}

    # ── Z-score detector ───────────────────────────
    zscore_threshold: float = 3.0
    zscore_min_samples: int = 30
    zscore_windows_minutes: list[int] = [5, 15, 60]
    zscore_dedup_cooldown_seconds: float = 60.0
    zscore_gpu_fields: list[str] = ["gpu_temp_c"]
    zscore_training_fields: list[str] = ["gradient_norm", "loss", "throughput_tps"]

    # ── Cross-node detector ────────────────────────
    straggler_ratio: float = 0.80
    correlation_window_ms: int = 30_000

    # ── DiLoCo detector ────────────────────────────
    diloco_divergence_outer_steps: int = 3
    diloco_sync_spike_factor: float = 2.0
    diloco_zscore_threshold: float = 3.0

    # ── Numeric instability detector ───────────────
    numeric_instability_fields: list[str] = ["loss", "gradient_norm", "throughput_tps", "mfu_pct"]

    # ── Training stalled detector ──────────────────
    stalled_warn_seconds: float = 60.0
    stalled_critical_seconds: float = 300.0
    stalled_min_samples: int = 3
    stalled_dedup_cooldown_seconds: float = 60.0
    stalled_node_fresh_seconds: float = 30.0

    # ── Loss plateau detector ──────────────────────
    plateau_window_steps: int = 50
    plateau_warmup_steps: int = 20
    plateau_threshold: float = 1e-4
    plateau_baseline_window_steps: int = 200
    plateau_dedup_cooldown_seconds: float = 300.0

    # ── Throughput regression detector ─────────────
    regression_baseline_samples: int = 200
    regression_recent_samples: int = 30
    regression_ratio: float = 0.7
    regression_dedup_cooldown_seconds: float = 120.0


detection_config = DetectionConfig()
