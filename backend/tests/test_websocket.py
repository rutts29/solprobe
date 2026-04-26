"""Tests for WebSocket endpoint and ConnectionManager."""

from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio(loop_scope="function")


class TestWebSocketConnection:
    async def test_connect_and_receive(self, test_app):
        from starlette.testclient import TestClient

        app, *_ = test_app
        sync_client = TestClient(app)

        with sync_client.websocket_connect("/ws/stream") as ws:
            # Connection should succeed — send a filter message
            ws.send_text(json.dumps({"node_ids": ["node-1"]}))
            # If we got here, connection and filter were accepted

    async def test_filter_subscription(self, test_app):
        from starlette.testclient import TestClient

        app, ms, als, ans, js, lcs, wm = test_app

        sync_client = TestClient(app)
        with sync_client.websocket_connect("/ws/stream") as ws:
            # Subscribe to a specific node
            ws.send_text(json.dumps({
                "node_ids": ["node-1"],
                "severity": "CRITICAL",
            }))
            # Verify manager tracked the connection
            assert wm.active_count >= 1

    async def test_multiple_connections(self, test_app):
        from starlette.testclient import TestClient

        app, _, _, _, _, _, wm = test_app

        sync_client = TestClient(app)
        with sync_client.websocket_connect("/ws/stream") as ws1:
            with sync_client.websocket_connect("/ws/stream") as ws2:
                assert wm.active_count >= 2


class TestConnectionManager:
    async def test_matches_filter_no_filter(self):
        from app.ws.websocket import ConnectionManager, _ClientFilter, _Connection
        from unittest.mock import AsyncMock

        mgr = ConnectionManager()
        mock_ws = AsyncMock()
        conn = _Connection(ws=mock_ws, filt=_ClientFilter())

        # No filter — everything matches
        assert mgr._matches_filter(conn, "node-1") is True
        assert mgr._matches_filter(conn, "node-1", "WARNING") is True

    async def test_matches_filter_node_filter(self):
        from app.ws.websocket import ConnectionManager, _ClientFilter, _Connection
        from unittest.mock import AsyncMock

        mgr = ConnectionManager()
        mock_ws = AsyncMock()
        conn = _Connection(ws=mock_ws, filt=_ClientFilter(node_ids=["node-1"]))

        assert mgr._matches_filter(conn, "node-1") is True
        assert mgr._matches_filter(conn, "node-2") is False

    async def test_matches_filter_severity(self):
        from app.ws.websocket import ConnectionManager, _ClientFilter, _Connection
        from unittest.mock import AsyncMock

        mgr = ConnectionManager()
        mock_ws = AsyncMock()
        conn = _Connection(ws=mock_ws, filt=_ClientFilter(severity="CRITICAL"))

        assert mgr._matches_filter(conn, "node-1", "CRITICAL") is True
        assert mgr._matches_filter(conn, "node-1", "WARNING") is False
