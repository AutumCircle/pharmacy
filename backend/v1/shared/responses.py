"""Consistent JSON responses without leaking database errors."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from .contract import ContractError


class ResponseEncoder(json.JSONEncoder):
    def default(self, value: Any) -> Any:
        if isinstance(value, Decimal):
            return int(value) if value == value.to_integral_value() else str(value)
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        return super().default(value)


def request_id() -> str:
    return f"req_{uuid4().hex}"


def json_response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload, cls=ResponseEncoder, ensure_ascii=False),
    }


def success(data: Any, *, status_code: int = 200, request: str | None = None) -> dict[str, Any]:
    return json_response(status_code, {"data": data, "request_id": request or request_id()})


def success_document(document: dict[str, Any], *, request: str | None = None) -> dict[str, Any]:
    """Return an already-shaped success document without nesting its data field."""

    return json_response(200, {**document, "request_id": request or request_id()})


def error_response(error: ContractError, *, request: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "error": {"code": error.code, "message": error.message},
        "request_id": request or request_id(),
    }
    if error.fields:
        payload["error"]["details"] = {"fields": error.fields}
    return json_response(error.http_status, payload)
