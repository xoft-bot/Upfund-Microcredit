BEGIN;

CREATE TABLE IF NOT EXISTS collector_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  route_code text NOT NULL CHECK (length(trim(route_code)) BETWEEN 1 AND 80),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (officer_id, client_id, route_code, effective_from)
);

CREATE INDEX IF NOT EXISTS collector_assignments_officer_branch_idx
  ON collector_assignments (officer_id, branch_id);
CREATE INDEX IF NOT EXISTS collector_assignments_client_effective_to_idx
  ON collector_assignments (client_id, effective_to);

COMMIT;