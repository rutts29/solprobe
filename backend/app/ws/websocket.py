"""WebSocket hub for real-time alert and metric streaming.

Endpoint: /ws/stream
Broadcasts:
  - New alerts (edge or central)
  - Metric summaries every 5 seconds (aggregated per node)

Clients can send a JSON filter on connect:
  { "node_ids": ["node-1"], "severity": "CRITICAL" }
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect

from app.auth import require_websocket_api_key
from app.models.alerts import AlertModel
from app.stores import metrics_store

# Avoid circular import — use TYPE_CHECKING for type hints only
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.diagnosis.models import DiagnosisResult

logger = logging.getLogger(__name__)


@dataclass
class _ClientFilter:
    """Per-client subscription filter."""

    node_ids: list[str] = field(default_factory=list)
    severity: str | None = None


@dataclass
class _Connection:
    """A tracked WebSocket connection with its filter."""

    ws: WebSocket
    filt: _ClientFilter = field(default_factory=_ClientFilter)


class ConnectionManager:
    """Manages active WebSocket connections and broadcast logic."""

    def __init__(self) -> None:
        self._connections: list[_Connection] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> _Connection:
        """Accept a WebSocket and register it."""
        await require_websocket_api_key(ws)
        await ws.accept()
        conn = _Connection(ws=ws)
        async with self._lock:
            self._connections.append(conn)
        logger.info("WebSocket client connected (%d total)", len(self._connections))
        return conn

    async def disconnect(self, conn: _Connection) -> None:
        """Remove a connection from the active set."""
        async with self._lock:
            try:
                self._connections.remove(conn)
            except ValueError:
                pass
        logger.info("WebSocket client disconnected (%d remaining)", len(self._connections))

    async def set_filter(self, conn: _Connection, raw: str) -> None:
        """Parse a client-sent JSON filter and apply it."""
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                conn.filt = _ClientFilter(
                    node_ids=data.get("node_ids", []),
                    severity=data.get("severity"),
                )
                logger.debug("Client filter updated: %s", conn.filt)
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("Invalid filter payload: %s", exc)

    def _matches_filter(self, conn: _Connection, node_id: str, severity: str | None = None) -> bool:
        """Check whether a message passes the client's filter."""
        if conn.filt.node_ids and node_id not in conn.filt.node_ids:
            return False
        if conn.filt.severity and severity and conn.filt.severity != severity:
            return False
        return True

    async def broadcast_alert(self, alert: AlertModel) -> None:
        """Send an alert to all connected clients that match the filter."""
        payload = json.dumps({
            "type": "alert",
            "data": alert.model_dump(),
        })
        async with self._lock:
            stale: list[_Connection] = []
            for conn in self._connections:
                if not self._matches_filter(conn, alert.node_id, alert.severity):
                    continue
                try:
                    await conn.ws.send_text(payload)
                except (WebSocketDisconnect, RuntimeError):
                    stale.append(conn)
            for conn in stale:
                try:
                    self._connections.remove(conn)
                except ValueError:
                    pass

    async def broadcast_diagnosis(self, diagnosis: DiagnosisResult) -> None:
        """Send a diagnosis result to all connected clients matching the node."""
        payload = json.dumps({
            "type": "diagnosis",
            "data": diagnosis.model_dump(),
        })
        async with self._lock:
            stale: list[_Connection] = []
            for conn in self._connections:
                if not self._matches_filter(conn, diagnosis.node_id):
                    continue
                try:
                    await conn.ws.send_text(payload)
                except (WebSocketDisconnect, RuntimeError):
                    stale.append(conn)
            for conn in stale:
                try:
                    self._connections.remove(conn)
                except ValueError:
                    pass

    async def broadcast_metric_summary(self) -> None:
        """Send aggregated per-node metric summaries to all clients."""
        statuses = metrics_store.get_all_node_statuses()
        if not statuses:
            return

        async with self._lock:
            stale: list[_Connection] = []
            for conn in self._connections:
                for status in statuses:
                    if not self._matches_filter(conn, status.node_id):
                        continue
                    payload = json.dumps({
                        "type": "metric_summary",
                        "data": status.model_dump(),
                    })
                    try:
                        await conn.ws.send_text(payload)
                    except (WebSocketDisconnect, RuntimeError):
                        stale.append(conn)
                        break
            for conn in stale:
                try:
                    self._connections.remove(conn)
                except ValueError:
                    pass

    @property
    def active_count(self) -> int:
        return len(self._connections)


# Global singleton
ws_manager = ConnectionManager()


async def websocket_endpoint(ws: WebSocket) -> None:
    """FastAPI WebSocket handler for /ws/stream."""
    conn = await ws_manager.connect(ws)
    try:
        while True:
            # Listen for filter messages from client
            data = await ws.receive_text()
            await ws_manager.set_filter(conn, data)
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        # Connection already closed
        pass
    finally:
        await ws_manager.disconnect(conn)


async def metric_summary_loop() -> None:
    """Background loop that broadcasts metric summaries every 5 seconds."""
    while True:
        await asyncio.sleep(5)
        try:
            await ws_manager.broadcast_metric_summary()
        except Exception:
            logger.exception("Error broadcasting metric summary")
