-- Courier delivery checklist: manual steps the courier ticks inside a website order card.
-- Steps 3, 6 and 8 are derived from orders.status and are never stored here (enforced in Lambda).
-- Internal to the courier: no change to orders columns, the orders.status CHECK or order_status_history.
-- Additive and safe to re-run. Apply before deploying the Lambda that reads this table.
BEGIN;

CREATE TABLE IF NOT EXISTS order_courier_checklist (
    order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    step smallint NOT NULL CHECK (step BETWEEN 1 AND 8),
    completed_at timestamptz NOT NULL DEFAULT now(),
    completed_by text NOT NULL,
    PRIMARY KEY (order_id, step)
);

COMMIT;
