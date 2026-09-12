BEGIN;

ALTER TYPE reconciliation_status ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE reconciliations
  ADD COLUMN IF NOT EXISTS decision_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'reconciliations_decision_reason_length'
       AND conrelid = 'reconciliations'::regclass
  ) THEN
    ALTER TABLE reconciliations
      ADD CONSTRAINT reconciliations_decision_reason_length
      CHECK (decision_reason IS NULL OR length(trim(decision_reason)) BETWEEN 1 AND 500);
  END IF;
END $$;

COMMIT;