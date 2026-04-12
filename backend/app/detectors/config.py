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


detection_config = DetectionConfig()
