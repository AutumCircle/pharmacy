-- Owner's manual «Нет в наличии» mark for a medicine: hidden from clients on the public site
-- regardless of the pharmacy DBF sync (which keeps writing only in_stock). Additive and repeatable:
-- new columns with a constant default, no table rewrite on PostgreSQL 11+.
-- Apply before deploying the admin and public Lambdas that read hidden_from_clients.
-- Rollback: deploy the previous Lambdas first, then
--   ALTER TABLE medicines DROP COLUMN IF EXISTS hidden_from_clients_at, DROP COLUMN IF EXISTS hidden_from_clients;
BEGIN;

ALTER TABLE medicines ADD COLUMN IF NOT EXISTS hidden_from_clients BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS hidden_from_clients_at TIMESTAMPTZ;

-- Small partial index for the admin «Скрытые» filter.
CREATE INDEX IF NOT EXISTS medicines_hidden_from_clients_idx ON medicines (id) WHERE hidden_from_clients;

COMMIT;
