-- Supply transaction-local vatan.staff{1,2}_{username,hash} settings using the
-- offline preparation script. Missing settings fail the migration atomically.
BEGIN;
CREATE TABLE staff_accounts (
    account_id smallint PRIMARY KEY CHECK (account_id IN (1, 2)),
    username varchar(64) NOT NULL CHECK (username ~ '^[A-Za-z0-9_.-]{3,64}$'),
    password_hash text NOT NULL CHECK (password_hash ~ '^pbkdf2_sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$'),
    catalog_access boolean NOT NULL,
    credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (catalog_access = (account_id = 1))
);
CREATE UNIQUE INDEX staff_accounts_username_unique ON staff_accounts (lower(username));
INSERT INTO staff_accounts (account_id, username, password_hash, catalog_access) VALUES
    (1, current_setting('vatan.staff1_username'), current_setting('vatan.staff1_hash'), true),
    (2, current_setting('vatan.staff2_username'), current_setting('vatan.staff2_hash'), false);
-- No API exposes create/delete or permission editing in this phase.
COMMIT;
