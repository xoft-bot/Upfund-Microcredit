ALTER TABLE audit_events
  ADD COLUMN branch_id uuid REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS audit_events_branch_id_idx ON audit_events (branch_id);
