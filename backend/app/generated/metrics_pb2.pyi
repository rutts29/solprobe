from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GpuMetrics(_message.Message):
    __slots__ = ("node_id", "gpu_index", "gpu_model", "timestamp_ms", "gpu_temp_c", "memory_temp_c", "gpu_utilization_pct", "mem_copy_utilization_pct", "fb_used_mb", "fb_free_mb", "power_usage_w", "xid_errors", "ecc_sbe_count", "ecc_dbe_count", "clock_throttle_reasons", "pcie_replay_counter", "pcie_tx_bytes_per_sec", "pcie_rx_bytes_per_sec", "sm_active_pct", "tensor_active_pct", "retired_pages_sbe", "retired_pages_dbe", "remapped_rows_correctable", "remapped_rows_uncorrectable", "row_remap_failure")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    GPU_INDEX_FIELD_NUMBER: _ClassVar[int]
    GPU_MODEL_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_MS_FIELD_NUMBER: _ClassVar[int]
    GPU_TEMP_C_FIELD_NUMBER: _ClassVar[int]
    MEMORY_TEMP_C_FIELD_NUMBER: _ClassVar[int]
    GPU_UTILIZATION_PCT_FIELD_NUMBER: _ClassVar[int]
    MEM_COPY_UTILIZATION_PCT_FIELD_NUMBER: _ClassVar[int]
    FB_USED_MB_FIELD_NUMBER: _ClassVar[int]
    FB_FREE_MB_FIELD_NUMBER: _ClassVar[int]
    POWER_USAGE_W_FIELD_NUMBER: _ClassVar[int]
    XID_ERRORS_FIELD_NUMBER: _ClassVar[int]
    ECC_SBE_COUNT_FIELD_NUMBER: _ClassVar[int]
    ECC_DBE_COUNT_FIELD_NUMBER: _ClassVar[int]
    CLOCK_THROTTLE_REASONS_FIELD_NUMBER: _ClassVar[int]
    PCIE_REPLAY_COUNTER_FIELD_NUMBER: _ClassVar[int]
    PCIE_TX_BYTES_PER_SEC_FIELD_NUMBER: _ClassVar[int]
    PCIE_RX_BYTES_PER_SEC_FIELD_NUMBER: _ClassVar[int]
    SM_ACTIVE_PCT_FIELD_NUMBER: _ClassVar[int]
    TENSOR_ACTIVE_PCT_FIELD_NUMBER: _ClassVar[int]
    RETIRED_PAGES_SBE_FIELD_NUMBER: _ClassVar[int]
    RETIRED_PAGES_DBE_FIELD_NUMBER: _ClassVar[int]
    REMAPPED_ROWS_CORRECTABLE_FIELD_NUMBER: _ClassVar[int]
    REMAPPED_ROWS_UNCORRECTABLE_FIELD_NUMBER: _ClassVar[int]
    ROW_REMAP_FAILURE_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    gpu_index: int
    gpu_model: str
    timestamp_ms: int
    gpu_temp_c: float
    memory_temp_c: float
    gpu_utilization_pct: float
    mem_copy_utilization_pct: float
    fb_used_mb: float
    fb_free_mb: float
    power_usage_w: float
    xid_errors: int
    ecc_sbe_count: int
    ecc_dbe_count: int
    clock_throttle_reasons: int
    pcie_replay_counter: int
    pcie_tx_bytes_per_sec: float
    pcie_rx_bytes_per_sec: float
    sm_active_pct: float
    tensor_active_pct: float
    retired_pages_sbe: int
    retired_pages_dbe: int
    remapped_rows_correctable: int
    remapped_rows_uncorrectable: int
    row_remap_failure: bool
    def __init__(self, node_id: _Optional[str] = ..., gpu_index: _Optional[int] = ..., gpu_model: _Optional[str] = ..., timestamp_ms: _Optional[int] = ..., gpu_temp_c: _Optional[float] = ..., memory_temp_c: _Optional[float] = ..., gpu_utilization_pct: _Optional[float] = ..., mem_copy_utilization_pct: _Optional[float] = ..., fb_used_mb: _Optional[float] = ..., fb_free_mb: _Optional[float] = ..., power_usage_w: _Optional[float] = ..., xid_errors: _Optional[int] = ..., ecc_sbe_count: _Optional[int] = ..., ecc_dbe_count: _Optional[int] = ..., clock_throttle_reasons: _Optional[int] = ..., pcie_replay_counter: _Optional[int] = ..., pcie_tx_bytes_per_sec: _Optional[float] = ..., pcie_rx_bytes_per_sec: _Optional[float] = ..., sm_active_pct: _Optional[float] = ..., tensor_active_pct: _Optional[float] = ..., retired_pages_sbe: _Optional[int] = ..., retired_pages_dbe: _Optional[int] = ..., remapped_rows_correctable: _Optional[int] = ..., remapped_rows_uncorrectable: _Optional[int] = ..., row_remap_failure: bool = ...) -> None: ...

class TrainingMetrics(_message.Message):
    __slots__ = ("node_id", "job_id", "timestamp_ms", "step", "loss", "gradient_norm", "learning_rate", "throughput_tps", "mfu_pct")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_MS_FIELD_NUMBER: _ClassVar[int]
    STEP_FIELD_NUMBER: _ClassVar[int]
    LOSS_FIELD_NUMBER: _ClassVar[int]
    GRADIENT_NORM_FIELD_NUMBER: _ClassVar[int]
    LEARNING_RATE_FIELD_NUMBER: _ClassVar[int]
    THROUGHPUT_TPS_FIELD_NUMBER: _ClassVar[int]
    MFU_PCT_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    job_id: str
    timestamp_ms: int
    step: int
    loss: float
    gradient_norm: float
    learning_rate: float
    throughput_tps: float
    mfu_pct: float
    def __init__(self, node_id: _Optional[str] = ..., job_id: _Optional[str] = ..., timestamp_ms: _Optional[int] = ..., step: _Optional[int] = ..., loss: _Optional[float] = ..., gradient_norm: _Optional[float] = ..., learning_rate: _Optional[float] = ..., throughput_tps: _Optional[float] = ..., mfu_pct: _Optional[float] = ...) -> None: ...

class DiLoCoMetrics(_message.Message):
    __slots__ = ("node_id", "job_id", "timestamp_ms", "inner_step", "outer_step", "inner_loss", "outer_loss", "pseudo_grad_norm", "sync_duration_ms", "worker_speed_ratio", "is_straggler")
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_MS_FIELD_NUMBER: _ClassVar[int]
    INNER_STEP_FIELD_NUMBER: _ClassVar[int]
    OUTER_STEP_FIELD_NUMBER: _ClassVar[int]
    INNER_LOSS_FIELD_NUMBER: _ClassVar[int]
    OUTER_LOSS_FIELD_NUMBER: _ClassVar[int]
    PSEUDO_GRAD_NORM_FIELD_NUMBER: _ClassVar[int]
    SYNC_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    WORKER_SPEED_RATIO_FIELD_NUMBER: _ClassVar[int]
    IS_STRAGGLER_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    job_id: str
    timestamp_ms: int
    inner_step: int
    outer_step: int
    inner_loss: float
    outer_loss: float
    pseudo_grad_norm: float
    sync_duration_ms: float
    worker_speed_ratio: float
    is_straggler: bool
    def __init__(self, node_id: _Optional[str] = ..., job_id: _Optional[str] = ..., timestamp_ms: _Optional[int] = ..., inner_step: _Optional[int] = ..., outer_step: _Optional[int] = ..., inner_loss: _Optional[float] = ..., outer_loss: _Optional[float] = ..., pseudo_grad_norm: _Optional[float] = ..., sync_duration_ms: _Optional[float] = ..., worker_speed_ratio: _Optional[float] = ..., is_straggler: bool = ...) -> None: ...

class MetricsBatch(_message.Message):
    __slots__ = ("gpu", "training", "diloco")
    GPU_FIELD_NUMBER: _ClassVar[int]
    TRAINING_FIELD_NUMBER: _ClassVar[int]
    DILOCO_FIELD_NUMBER: _ClassVar[int]
    gpu: _containers.RepeatedCompositeFieldContainer[GpuMetrics]
    training: TrainingMetrics
    diloco: DiLoCoMetrics
    def __init__(self, gpu: _Optional[_Iterable[_Union[GpuMetrics, _Mapping]]] = ..., training: _Optional[_Union[TrainingMetrics, _Mapping]] = ..., diloco: _Optional[_Union[DiLoCoMetrics, _Mapping]] = ...) -> None: ...

class StreamAck(_message.Message):
    __slots__ = ("ok", "message")
    OK_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ok: bool
    message: str
    def __init__(self, ok: bool = ..., message: _Optional[str] = ...) -> None: ...
