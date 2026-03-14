import metrics_pb2 as _metrics_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Severity(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SEVERITY_UNSPECIFIED: _ClassVar[Severity]
    SEVERITY_INFO: _ClassVar[Severity]
    SEVERITY_WARNING: _ClassVar[Severity]
    SEVERITY_CRITICAL: _ClassVar[Severity]

class AlertSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ALERT_SOURCE_UNSPECIFIED: _ClassVar[AlertSource]
    ALERT_SOURCE_EDGE: _ClassVar[AlertSource]
    ALERT_SOURCE_CENTRAL: _ClassVar[AlertSource]

class AlertType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ALERT_TYPE_UNSPECIFIED: _ClassVar[AlertType]
    ALERT_TYPE_THERMAL_THROTTLE: _ClassVar[AlertType]
    ALERT_TYPE_MEMORY_PRESSURE: _ClassVar[AlertType]
    ALERT_TYPE_XID_ERROR: _ClassVar[AlertType]
    ALERT_TYPE_ECC_ERROR: _ClassVar[AlertType]
    ALERT_TYPE_CLOCK_THROTTLE: _ClassVar[AlertType]
    ALERT_TYPE_PCIE_ERROR: _ClassVar[AlertType]
    ALERT_TYPE_NCCL_TIMEOUT: _ClassVar[AlertType]
    ALERT_TYPE_GRADIENT_EXPLOSION: _ClassVar[AlertType]
    ALERT_TYPE_LOSS_PLATEAU: _ClassVar[AlertType]
    ALERT_TYPE_LOSS_SPIKE: _ClassVar[AlertType]
    ALERT_TYPE_DILOCO_SYNC_DRIFT: _ClassVar[AlertType]
    ALERT_TYPE_STRAGGLER_DETECTED: _ClassVar[AlertType]
    ALERT_TYPE_PSEUDO_GRAD_DIVERGENCE: _ClassVar[AlertType]
    ALERT_TYPE_INNER_OUTER_DIVERGENCE: _ClassVar[AlertType]
SEVERITY_UNSPECIFIED: Severity
SEVERITY_INFO: Severity
SEVERITY_WARNING: Severity
SEVERITY_CRITICAL: Severity
ALERT_SOURCE_UNSPECIFIED: AlertSource
ALERT_SOURCE_EDGE: AlertSource
ALERT_SOURCE_CENTRAL: AlertSource
ALERT_TYPE_UNSPECIFIED: AlertType
ALERT_TYPE_THERMAL_THROTTLE: AlertType
ALERT_TYPE_MEMORY_PRESSURE: AlertType
ALERT_TYPE_XID_ERROR: AlertType
ALERT_TYPE_ECC_ERROR: AlertType
ALERT_TYPE_CLOCK_THROTTLE: AlertType
ALERT_TYPE_PCIE_ERROR: AlertType
ALERT_TYPE_NCCL_TIMEOUT: AlertType
ALERT_TYPE_GRADIENT_EXPLOSION: AlertType
ALERT_TYPE_LOSS_PLATEAU: AlertType
ALERT_TYPE_LOSS_SPIKE: AlertType
ALERT_TYPE_DILOCO_SYNC_DRIFT: AlertType
ALERT_TYPE_STRAGGLER_DETECTED: AlertType
ALERT_TYPE_PSEUDO_GRAD_DIVERGENCE: AlertType
ALERT_TYPE_INNER_OUTER_DIVERGENCE: AlertType

class Alert(_message.Message):
    __slots__ = ("alert_id", "node_id", "timestamp_ms", "severity", "source", "alert_type", "description", "confidence", "evidence", "gpu_index", "job_id")
    class EvidenceEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ALERT_ID_FIELD_NUMBER: _ClassVar[int]
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_MS_FIELD_NUMBER: _ClassVar[int]
    SEVERITY_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    ALERT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    EVIDENCE_FIELD_NUMBER: _ClassVar[int]
    GPU_INDEX_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    alert_id: str
    node_id: str
    timestamp_ms: int
    severity: Severity
    source: AlertSource
    alert_type: AlertType
    description: str
    confidence: float
    evidence: _containers.ScalarMap[str, str]
    gpu_index: int
    job_id: str
    def __init__(self, alert_id: _Optional[str] = ..., node_id: _Optional[str] = ..., timestamp_ms: _Optional[int] = ..., severity: _Optional[_Union[Severity, str]] = ..., source: _Optional[_Union[AlertSource, str]] = ..., alert_type: _Optional[_Union[AlertType, str]] = ..., description: _Optional[str] = ..., confidence: _Optional[float] = ..., evidence: _Optional[_Mapping[str, str]] = ..., gpu_index: _Optional[int] = ..., job_id: _Optional[str] = ...) -> None: ...

class AlertAck(_message.Message):
    __slots__ = ("ok", "alert_id")
    OK_FIELD_NUMBER: _ClassVar[int]
    ALERT_ID_FIELD_NUMBER: _ClassVar[int]
    ok: bool
    alert_id: str
    def __init__(self, ok: bool = ..., alert_id: _Optional[str] = ...) -> None: ...

class NodeRegistration(_message.Message):
    __slots__ = ("node_id", "gpu_model", "gpu_count", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    NODE_ID_FIELD_NUMBER: _ClassVar[int]
    GPU_MODEL_FIELD_NUMBER: _ClassVar[int]
    GPU_COUNT_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    node_id: str
    gpu_model: str
    gpu_count: int
    labels: _containers.ScalarMap[str, str]
    def __init__(self, node_id: _Optional[str] = ..., gpu_model: _Optional[str] = ..., gpu_count: _Optional[int] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class Command(_message.Message):
    __slots__ = ("command_id", "command_type", "params")
    class ParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    COMMAND_ID_FIELD_NUMBER: _ClassVar[int]
    COMMAND_TYPE_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    command_id: str
    command_type: str
    params: _containers.ScalarMap[str, str]
    def __init__(self, command_id: _Optional[str] = ..., command_type: _Optional[str] = ..., params: _Optional[_Mapping[str, str]] = ...) -> None: ...
