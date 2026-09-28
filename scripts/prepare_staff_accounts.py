"""Offline only: produce private migration SQL; never connect to a database.

Load the existing deployment's STAFF_USERNAME, STAFF_PASSWORD (if configured),
and ADMIN_SESSION_SECRET into the process environment. Prints only the NEW
temporary credentials once. Existing credentials are never printed or saved.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.v1.shared.staff_accounts import hash_password, username, validate_password


def prepare():
    target = ROOT / '.staff-bootstrap' / '0014_prepared.sql'
    if target.exists():
        raise SystemExit('Prepared migration already exists; refusing to replace credentials.')
    first_username = username(os.environ.get('STAFF_USERNAME') or 'pharmacy_staff')
    first_password = os.environ.get('STAFF_PASSWORD')
    if not first_password:
        secret = os.environ.get('ADMIN_SESSION_SECRET', '')
        if len(secret) < 32:
            raise SystemExit('Load existing ADMIN_SESSION_SECRET or STAFF_PASSWORD before preparation.')
        digest = hmac.new(secret.encode(), b'vatan-pharmacy-staff-password-v1', hashlib.sha256).digest()
        first_password = 'Vt-' + base64.urlsafe_b64encode(digest).decode().rstrip('=')[:28] + '!7'
    second_username = 'staff_pending'
    if first_username.lower() == second_username:
        second_username = 'staff_pending_2'
    second_password = 'Vt-' + secrets.token_urlsafe(24) + '!7aA'
    validate_password(second_password)
    values = {
        'staff1_username': first_username, 'staff1_hash': hash_password(first_password),
        'staff2_username': second_username, 'staff2_hash': hash_password(second_password),
    }
    # SQL contains salted hashes only, never either plaintext password.
    setup = '\n'.join("SELECT set_config('vatan.%s', '%s', true);" % (key, value.replace("'", "''")) for key, value in values.items())
    migration = (ROOT / 'db/migrations/0014_staff_accounts.sql').read_text(encoding='utf-8')
    prepared = migration.replace('BEGIN;', 'BEGIN;\n' + setup, 1)
    target.parent.mkdir(mode=0o700, exist_ok=True)
    with target.open('x', encoding='utf-8') as handle:
        handle.write(prepared)
    print('Prepared offline migration: .staff-bootstrap/0014_prepared.sql')
    print('NEW temporary username: ' + second_username)
    print('NEW temporary password: ' + second_password)


if __name__ == '__main__':
    prepare()
