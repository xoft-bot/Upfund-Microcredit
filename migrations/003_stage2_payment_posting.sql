BEGIN;

ALTER TABLE repayment_schedules ADD COLUMN IF NOT EXISTS principal_paid bigint NOT NULL DEFAULT 0 CHECK (principal_paid >= 0);
ALTER TABLE repayment_schedules ADD COLUMN IF NOT EXISTS charge_paid bigint NOT NULL DEFAULT 0 CHECK (charge_paid >= 0);
ALTER TABLE repayment_schedules ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS principal_amount bigint NOT NULL DEFAULT 0 CHECK (principal_amount >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_amount bigint NOT NULL DEFAULT 0 CHECK (charge_amount >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES repayment_schedules(id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_schedule_idempotency_uidx ON payments(schedule_id, idempotency_key);

COMMIT;
