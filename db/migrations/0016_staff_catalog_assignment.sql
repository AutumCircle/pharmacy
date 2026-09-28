-- Assign read-only catalogue access to vatan_2 instead of vatan_1.
-- Both accounts retain access to manual order intake.
BEGIN;

ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_check;
ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_catalog_access_check;

UPDATE staff_accounts
SET catalog_access = (account_id = 2),
    credential_version = credential_version + 1,
    updated_at = now()
WHERE catalog_access IS DISTINCT FROM (account_id = 2);

ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_catalog_access_check
    CHECK (catalog_access = (account_id = 2));

COMMIT;
