"""API key enforcement for SolProbe control-plane surfaces."""

from __future__ import annotations

import hmac
import os
from typing import Annotated

from fastapi import Header, HTTPException, WebSocket, status
from starlette.websockets import WebSocketDisconnect

API_KEY_ENV = "SOLPROBE_API_KEY"
API_KEY_HEADER = "X-SolProbe-API-Key"


def _configured_api_key() -> str | None:
    key = os.environ.get(API_KEY_ENV)
    if key is None:
        return None
    stripped = key.strip()
    return stripped or None


def _is_valid_api_key(provided: str | None) -> bool:
    expected = _configured_api_key()
    if expected is None or provided is None:
        return False
    return hmac.compare_digest(provided, expected)


async def require_api_key(
    api_key: Annotated[str | None, Header(alias=API_KEY_HEADER)] = None,
) -> None:
    if _configured_api_key() is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{API_KEY_ENV} is not configured",
        )
    if not _is_valid_api_key(api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )


async def require_websocket_api_key(websocket: WebSocket) -> None:
    provided = websocket.query_params.get("api_key") or websocket.headers.get(API_KEY_HEADER)
    if _configured_api_key() is None or not _is_valid_api_key(provided):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        raise WebSocketDisconnect(code=status.WS_1008_POLICY_VIOLATION)
