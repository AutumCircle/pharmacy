"""Pure authorization checks shared by protected Lambda handlers."""

from __future__ import annotations

import hmac
import os
from typing import Any

from .contract import ContractError


def _static_bearer_identity(event: dict[str, Any], environment_name: str, principal: str) -> str | None:
    expected = os.environ.get(environment_name, "")
    if len(expected) < 32:
        return None
    headers = {
        str(key).lower(): str(value)
        for key, value in (event.get("headers") or {}).items()
        if value is not None
    }
    authorization = headers.get("authorization", "")
    supplied = authorization[7:] if authorization.lower().startswith("bearer ") else ""
    return principal if supplied and hmac.compare_digest(supplied, expected) else None


def require_admin_identity(event: dict[str, Any]) -> str:
    """Require an API Gateway authorizer context with an explicit admin role."""

    authorizer = ((event.get("requestContext") or {}).get("authorizer") or {})
    claims = authorizer.get("claims") if isinstance(authorizer.get("claims"), dict) else authorizer
    if isinstance(claims, dict):
        role = claims.get("role")
        principal = claims.get("principalId") or claims.get("sub")
        if role == "admin" and principal:
            return str(principal)[:100]
    static_principal = _static_bearer_identity(event, "ADMIN_API_BEARER_TOKEN", "admin:mvp-token")
    if static_principal:
        return static_principal
    raise ContractError("FORBIDDEN", "Admin authorization is required", http_status=403)


def require_sync_identity(event: dict[str, Any]) -> str:
    """Require the dedicated pharmacy agent machine identity."""

    authorizer = ((event.get("requestContext") or {}).get("authorizer") or {})
    claims = authorizer.get("claims") if isinstance(authorizer.get("claims"), dict) else authorizer
    if isinstance(claims, dict):
        principal = claims.get("principalId") or claims.get("sub")
        if claims.get("role") == "agent_sync" and principal:
            return str(principal)[:100]
    static_principal = _static_bearer_identity(event, "SYNC_API_BEARER_TOKEN", "agent_sync:mvp-token")
    if static_principal:
        return static_principal
    raise ContractError("FORBIDDEN", "Sync authorization is required", http_status=403)
