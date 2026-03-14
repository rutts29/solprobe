"""Alert context builder for LLM diagnosis.

When any alert fires, enriches it with:
  - recent_metrics: +/-2 minute window of all metrics from the affected node
  - node_history: last 10 alerts from this node
  - correlated_events: alerts from other nodes within +/-30 seconds
"""

from __future__ import annotations

import logging

from app.models.alerts import AlertModel, EnrichedAlert
from app.stores import alert_store, metrics_store

logger = logging.getLogger(__name__)

_CONTEXT_WINDOW_MINUTES = 4  # +/-2 minutes = 4 minute total window
_HISTORY_LIMIT = 10
_CORRELATION_WINDOW_MS = 30_000


def enrich_alert(alert: AlertModel) -> EnrichedAlert:
    """Build an EnrichedAlert with contextual data around the given alert.

    Args:
        alert: The base alert to enrich.

    Returns:
        An EnrichedAlert containing nearby metrics, node history,
        and correlated events from other nodes.
    """
    # 1. Recent metrics: +/-2 minute window from the affected node
    recent_metrics: list[dict] = []
    gpu_history = metrics_store.get_gpu_history(
        alert.node_id,
        window_minutes=_CONTEXT_WINDOW_MINUTES,
    )
    for gpu_list in gpu_history:
        for gm in gpu_list:
            recent_metrics.append(gm.model_dump())

    training_history = metrics_store.get_training_history(
        alert.node_id,
        window_minutes=_CONTEXT_WINDOW_MINUTES,
    )
    for tm in training_history:
        recent_metrics.append(tm.model_dump())

    diloco_history = metrics_store.get_diloco_history(
        alert.node_id,
        window_minutes=_CONTEXT_WINDOW_MINUTES,
    )
    for dm in diloco_history:
        recent_metrics.append(dm.model_dump())

    # 2. Node history: last 10 alerts from this node
    node_history = alert_store.get_node_history(
        alert.node_id,
        limit=_HISTORY_LIMIT,
    )

    # 3. Correlated events: alerts from other nodes within +/-30 seconds
    correlated_events = alert_store.get_correlated(
        alert.timestamp_ms,
        exclude_node=alert.node_id,
        window_ms=_CORRELATION_WINDOW_MS,
    )

    enriched = EnrichedAlert(
        alert=alert,
        recent_metrics=recent_metrics,
        node_history=node_history,
        correlated_events=correlated_events,
    )

    logger.debug(
        "Enriched alert %s: %d metrics, %d history, %d correlated",
        alert.alert_id,
        len(recent_metrics),
        len(node_history),
        len(correlated_events),
    )

    return enriched
