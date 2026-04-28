"""Pydantic models mirroring protobuf metric schemas for REST API responses."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GpuMetricsModel(BaseModel):
    """GPU hardware metrics from DCGM, scoped to T4/L4."""

    node_id: str
    gpu_index: int
    gpu_model: str = Field(description='GPU model identifier, e.g. "T4" or "L4"')
    timestamp_ms: int

    # Temperature
    gpu_temp_c: float = 0.0
    memory_temp_c: float = 0.0

    # Utilization
    gpu_utilization_pct: float = 0.0
    mem_copy_utilization_pct: float = 0.0

    # Framebuffer
    fb_used_mb: float = 0.0
    fb_free_mb: float = 0.0

    # Power
    power_usage_w: float = 0.0

    # Errors
    xid_errors: int = 0
    ecc_sbe_count: int = 0
    ecc_dbe_count: int = 0
    clock_throttle_reasons: int = 0

    # PCIe
    pcie_replay_counter: int = 0
    pcie_tx_bytes_per_sec: float = 0.0
    pcie_rx_bytes_per_sec: float = 0.0

    # Profiling
    sm_active_pct: float = 0.0
    tensor_active_pct: float = 0.0

    # T4-specific: page retirement
    retired_pages_sbe: int = 0
    retired_pages_dbe: int = 0

    # L4-specific: row remapping
    remapped_rows_correctable: int = 0
    remapped_rows_uncorrectable: int = 0
    row_remap_failure: bool = False


class TrainingMetricsModel(BaseModel):
    """Training telemetry from PyTorch callback."""

    node_id: str
    job_id: str
    timestamp_ms: int
    step: int

    loss: float = 0.0
    gradient_norm: float = 0.0
    learning_rate: float = 0.0
    throughput_tps: float = 0.0
    mfu_pct: float = 0.0


class DiLoCoMetricsModel(BaseModel):
    """DiLoCo-specific distributed training metrics."""

    node_id: str
    job_id: str
    timestamp_ms: int

    inner_step: int = 0
    outer_step: int = 0
    inner_loss: float = 0.0
    outer_loss: float = 0.0
    pseudo_grad_norm: float = 0.0
    sync_duration_ms: float = 0.0
    worker_speed_ratio: float = 0.0
    is_straggler: bool = False


class MetricsBatchModel(BaseModel):
    """A batch of metrics corresponding to a single reporting interval."""

    gpu: list[GpuMetricsModel] = Field(default_factory=list)
    training: TrainingMetricsModel | None = None
    diloco: DiLoCoMetricsModel | None = None


class NodeStatus(BaseModel):
    """Aggregated status for a single connected node."""

    node_id: str
    gpu_model: str
    gpu_count: int
    last_seen_ms: int
    latest_metrics: list[GpuMetricsModel]
    latest_training: TrainingMetricsModel | None = None
    latest_diloco: DiLoCoMetricsModel | None = None


class CustomMetricModel(BaseModel):
    """User-defined metric reported by a training script via REST."""

    node_id: str
    job_id: str
    timestamp_ms: int
    step: int | None = None
    name: str
    value: float
    unit: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)
