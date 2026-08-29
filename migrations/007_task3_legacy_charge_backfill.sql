BEGIN;

UPDATE payments
SET interest_amount = charge_amount
WHERE interest_amount = 0
  AND penalty_amount = 0
  AND charge_amount > 0;

COMMIT;