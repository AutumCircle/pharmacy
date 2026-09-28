"""Two fixed employee accounts; passwords and session authority stay in Lambda."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time

from .contract import ContractError
from .database import transaction

ITERATIONS = 600_000
SESSION_SECONDS = 8 * 60 * 60
PUBLIC_COLUMNS = "account_id, username, catalog_access, credential_version, true AS password_set"
SERVICE_TOKEN_CONTEXT = b"pharmacy-vatan:staff-api:v1"


def username(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{3,64}", value):
        raise ContractError("VALIDATION_ERROR", "Логин: 3–64 латинских буквы, цифры, _, . или -")
    return value


def validate_password(value):
    if (not isinstance(value, str) or not 14 <= len(value) <= 128
            or not all(re.search(pattern, value) for pattern in (r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9\s]"))):
        raise ContractError("VALIDATION_ERROR", "Пароль: 14–128 символов, строчная и заглавная буквы, цифра и специальный символ")
    return value


def hash_password(value):
    # Bootstrap may retain an existing password; new passwords are validated separately.
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(value, encoded):
    try:
        algorithm, iterations, salt, digest = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or int(iterations) != ITERATIONS:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", value.encode(), bytes.fromhex(salt), int(iterations))
        return hmac.compare_digest(actual.hex(), digest)
    except (ValueError, TypeError, AttributeError):
        return False


def _encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _secret():
    value = os.environ.get("ADMIN_SESSION_SECRET", "")
    if len(value) < 32:
        raise RuntimeError("Session signing configuration is incomplete")
    return value.encode()


def create_session(account):
    payload = _encode(json.dumps({"role": "staff", "accountId": account["account_id"],
        "credentialVersion": account["credential_version"],
        "expiresAt": int(time.time()) + SESSION_SECONDS}, separators=(",", ":")).encode())
    return payload + "." + _encode(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())


def _derived_service_token():
    return hmac.new(_secret(), SERVICE_TOKEN_CONTEXT, hashlib.sha256).hexdigest()


def require_service(event):
    configured = os.environ.get("STAFF_API_BEARER_TOKEN", "").strip()
    admin = os.environ.get("ADMIN_API_BEARER_TOKEN", "").strip()
    if configured and configured == admin:
        raise ContractError("FORBIDDEN", "Staff service must use a separate credential", http_status=403)
    headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
    supplied = str(headers.get("authorization") or "")
    allowed = supplied == f"Bearer {_derived_service_token()}"
    if configured:
        allowed = allowed or hmac.compare_digest(supplied, f"Bearer {configured}")
    if not allowed:
        raise ContractError("FORBIDDEN", "Staff service authorization is required", http_status=403)


def session_account(event, *, catalog=False):
    headers = {str(k).lower(): v for k, v in (event.get("headers") or {}).items()}
    token = headers.get("x-staff-session", "")
    try:
        if not isinstance(token, str) or len(token) > 2048:
            raise ValueError()
        payload, signature = token.split(".")
        expected = _encode(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if (claims.get("role") != "staff" or type(claims.get("expiresAt")) is not int
                or claims["expiresAt"] <= time.time() or type(claims.get("accountId")) is not int
                or claims["accountId"] not in (1, 2) or type(claims.get("credentialVersion")) is not int):
            raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ContractError("SESSION_REQUIRED", "Войдите снова", http_status=401) from None
    with transaction() as cur:
        cur.execute(f"SELECT {PUBLIC_COLUMNS} FROM staff_accounts WHERE account_id = %s AND credential_version = %s",
                    (claims["accountId"], claims["credentialVersion"]))
        account = cur.fetchone()
    if not account:
        raise ContractError("SESSION_REQUIRED", "Войдите снова", http_status=401)
    if catalog and not account["catalog_access"]:
        raise ContractError("FORBIDDEN", "Доступ пока не предоставлен", http_status=403)
    return dict(account)


def login(payload):
    supplied_username = payload.get("username")
    password = payload.get("password")
    if (not isinstance(supplied_username, str) or not 1 <= len(supplied_username) <= 64
            or not isinstance(password, str) or not 1 <= len(password) <= 128):
        raise ContractError("INVALID_CREDENTIALS", "Неверный логин или пароль", http_status=401)
    # Row locks serialize failures across Lambda instances; failures commit before raising.
    with transaction() as cur:
        cur.execute("SELECT *, locked_until > now() AS locked FROM staff_accounts WHERE lower(username) = lower(%s) FOR UPDATE", (supplied_username,))
        account = cur.fetchone()
        if account and account["locked"]:
            raise ContractError("RATE_LIMITED", "Повторите через 15 минут", http_status=429)
        encoded = account["password_hash"] if account else f"pbkdf2_sha256${ITERATIONS}${'00' * 16}${'00' * 32}"
        valid = verify_password(password, encoded) and account is not None
        if account:
            if valid:
                cur.execute("UPDATE staff_accounts SET failed_attempts = 0, locked_until = NULL WHERE account_id = %s", (account["account_id"],))
            else:
                cur.execute("""UPDATE staff_accounts SET
                    failed_attempts = CASE WHEN failed_attempts >= 4 THEN 0 ELSE failed_attempts + 1 END,
                    locked_until = CASE WHEN failed_attempts >= 4 THEN now() + interval '15 minutes' ELSE NULL END
                    WHERE account_id = %s""", (account["account_id"],))
    if not valid:
        raise ContractError("INVALID_CREDENTIALS", "Неверный логин или пароль", http_status=401)
    return {"token": create_session(account)}


def list_accounts():
    with transaction() as cur:
        cur.execute(f"SELECT {PUBLIC_COLUMNS} FROM staff_accounts ORDER BY account_id")
        return [dict(row) for row in cur.fetchall()]


def update_account(account_id, payload, actor_id, request_id, audit):
    if account_id not in (1, 2) or not payload or set(payload) - {"username", "password"}:
        raise ContractError("VALIDATION_ERROR", "Можно изменить только логин и пароль двух сотрудников")
    new_username = username(payload["username"]) if "username" in payload else None
    new_hash = hash_password(validate_password(payload["password"])) if "password" in payload else None
    with transaction() as cur:
        cur.execute("SELECT username FROM staff_accounts WHERE account_id = %s FOR UPDATE", (account_id,))
        old = cur.fetchone()
        if not old:
            raise ContractError("NOT_FOUND", "Сотрудник не найден", http_status=404)
        cur.execute(f"""UPDATE staff_accounts SET username = COALESCE(%s, username),
            password_hash = COALESCE(%s, password_hash), credential_version = credential_version + 1,
            failed_attempts = 0, locked_until = NULL, updated_at = now()
            WHERE account_id = %s RETURNING {PUBLIC_COLUMNS}""", (new_username, new_hash, account_id))
        result = dict(cur.fetchone())
        audit(cur, actor_id=actor_id, action="staff.credentials.changed", resource_type="staff_account",
              resource_id=str(account_id), request=request_id,
              details={"username_changed": new_username is not None and new_username != old["username"],
                       "password_changed": new_hash is not None})
    return result
