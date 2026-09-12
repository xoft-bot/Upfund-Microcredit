ALTER TABLE kyc_records
  ADD COLUMN IF NOT EXISTS evidence_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE risk_assessments
  ADD COLUMN IF NOT EXISTS rationale text,
  ADD COLUMN IF NOT EXISTS assessed_at timestamptz;

CREATE TABLE IF NOT EXISTS application_transition_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES loan_applications(id),
  from_state text,
  to_state text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_transition_history_application_idx
  ON application_transition_history(application_id, created_at, id);
