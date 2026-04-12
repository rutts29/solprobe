"""Cross-node correlation anomaly detector.

Compares the same metric across all connected nodes to detect:
  - Stragglers: node throughput < 80% of cluster mean
  - Correlated failures: 2+ nodes with alerts within 30 seconds

Runs every 15 seconds.
"""

from __future__ import annotations

import logging
import time
import uuid

import numpy as np

from app.detectors.config import detection_config as _cfg
from app.models.alerts import AlertModel, AnomalyModel
from app.stores import alert_store, anomaly_store, metrics_store

logger = logging.getLogger(__name__)

_STRAGGLER_RATIO = _cfg.straggler_ratio
_CORRELATION_WINDOW_MS = _cfg.correlation_window_ms


def _detect_stragglers(window_minutes: int = 5) -> list[AnomalyModel]:
    """Detect nodes whose throughput is significantly below cluster average."""
    node_ids = metrics_store.get_node_ids()
    if len(node_ids) < 2:
        return []

    # Gather latest throughput for each node
    node_throughputs: dict[str, float] = {}
    for node_id in node_ids:
        series = metrics_store.get_training_metric_series(node_id, "throughput_tps", window_minutes)
        if series:
            node_throughputs[node_id] = float(np.mean(series[-30:]))  # last 30 samples

    if len(node_throughputs) < 2:
        return []

    values = list(node_throughputs.values())
    cluster_mean = float(np.mean(values))
    if cluster_mean < 1e-9:
        return []

    findings: list[AnomalyModel] = []
    for node_id, throughput in node_throughputs.items():
        ratio = throughput / cluster_mean
        if ratio < _STRAGGLER_RATIO:
            confidence = min(1.0, (1.0 - ratio) / 0.5)
            alert = AlertModel(
                alert_id=str(uuid.uuid4()),
                node_id=node_id,
                timestamp_ms=int(time.time() * 1000),
                severity="WARNING",
                source="CENTRAL",
                alert_type="straggler_detected",
                description=(
                    f"Node throughput ({throughput:.1f} tok/s) is "
                    f"{ratio:.0%} of cluster mean ({cluster_mean:.1f} tok/s)"
                ),
                confidence=confidence,
                evidence={
                    "detector": "cross_node",
                    "node_throughput": f"{throughput:.2f}",
                    "cluster_mean": f"{cluster_mean:.2f}",
                    "ratio": f"{ratio:.4f}",
                },
            )
            anomaly = AnomalyModel(
                alert=alert,
                detector_name="cross_node",
                window_minutes=window_minutes,
                raw_score=ratio,
            )
            alert_store.add(alert)
            anomaly_store.add(anomaly.model_dump())
            findings.append(anomaly)
            logger.warning(
                "Straggler detected: node=%s ratio=%.2f (threshold=%.2f)",
                node_id, ratio, _STRAGGLER_RATIO,
            )

    return findings


def _detect_correlated_failures() -> list[AnomalyModel]:
    """Check if multiple nodes have alerts within a 30-second window.

    If 2+ nodes have alerts in the recent window, enrich each alert
    with correlation evidence.
    """
    now_ms = int(time.time() * 1000)
    recent_alerts = alert_store.query(limit=200)

    # Group recent alerts by time bucket (30s)
    window_start = now_ms - _CORRELATION_WINDOW_MS
    recent_in_window = [
        a for a in recent_alerts
        if a.timestamp_ms >= window_start and a.source != "CENTRAL"
    ]

    # Group by distinct nodes
    nodes_with_alerts: dict[str, list[AlertModel]] = {}
    for a in recent_in_window:
        nodes_with_alerts.setdefault(a.node_id, []).append(a)

    if len(nodes_with_alerts) < 2:
        return []

    findings: list[AnomalyModel] = []
    affected_nodes = list(nodes_with_alerts.keys())
    for node_id in affected_nodes:
        alert = AlertModel(
            alert_id=str(uuid.uuid4()),
            node_id=node_id,
            timestamp_ms=now_ms,
            severity="CRITICAL",
            source="CENTRAL",
            alert_type="nccl_timeout",
            description=(
                f"Correlated failures detected across {len(affected_nodes)} nodes "
                f"within {_CORRELATION_WINDOW_MS // 1000}s: {affected_nodes}"
            ),
            confidence=min(1.0, len(affected_nodes) / 4.0),
            evidence={
                "detector": "cross_node_correlation",
                "affected_nodes": ",".join(affected_nodes),
                "alert_count": str(len(recent_in_window)),
                "window_seconds": str(_CORRELATION_WINDOW_MS // 1000),
            },
        )
        anomaly = AnomalyModel(
            alert=alert,
            detector_name="cross_node",
            window_minutes=1,
            raw_score=float(len(affected_nodes)),
        )
        alert_store.add(alert)
        anomaly_store.add(anomaly.model_dump())
        findings.append(anomaly)
    logger.warning(
        "Correlated failures: %d nodes affected in %ds window: %s",
        len(affected_nodes), _CORRELATION_WINDOW_MS // 1000, affected_nodes,
    )
    return findings


def run_cross_node_detection() -> list[AnomalyModel]:
    """Run all cross-node detection checks.

    Called every 15 seconds from the main event loop.
    """
    findings: list[AnomalyModel] = []
    findings.extend(_detect_stragglers())
    findings.extend(_detect_correlated_failures())
    return findings
