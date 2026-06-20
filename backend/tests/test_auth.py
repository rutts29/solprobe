"""Tests for API key enforcement."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

pytestmark = pytest.mark.asyncio(loop_scope="function")


async def test_api_routes_reject_missing_key(test_app, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SOLPROBE_API_KEY", "test-secret")
    app, *_ = test_app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.get("/api/v1/nodes")

    assert resp.status_code == 401


async def test_api_routes_accept_valid_key(test_app, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SOLPROBE_API_KEY", "test-secret")
    app, *_ = test_app

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-SolProbe-API-Key": "test-secret"},
    ) as ac:
        resp = await ac.get("/api/v1/nodes")

    assert resp.status_code == 200


async def test_websocket_rejects_missing_key(test_app, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SOLPROBE_API_KEY", "test-secret")
    app, *_ = test_app
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/stream"):
            pass


async def test_websocket_accepts_valid_query_key(test_app, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SOLPROBE_API_KEY", "test-secret")
    app, *_ = test_app
    client = TestClient(app)

    with client.websocket_connect("/ws/stream?api_key=test-secret") as ws:
        ws.send_text("{}")
