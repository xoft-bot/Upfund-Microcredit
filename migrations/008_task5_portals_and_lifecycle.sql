BEGIN;

ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'kyc_verified';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'risk_assessed';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id);

CREATE INDEX IF NOT EXISTS users_client_idx ON users(client_id);

CREATE TABLE IF NOT EXISTS loan_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL UNIQUE REFERENCES loans(id),
  disbursement_reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount bigint NOT NULL CHECK (amount > 0),
  posted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (code, name) VALUES
  ('admin', 'Administrator'),
  ('manager', 'Manager'),
  ('officer', 'Loan Officer'),
  ('collector', 'Field Collector'),
  ('accountant', 'Accountant'),
  ('client', 'Client'),
  ('marketing', 'Marketing')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO permissions (code, name) VALUES
  ('portal.manager', 'Open the manager portal'),
  ('portal.officer', 'Open the loan officer portal'),
  ('portal.client', 'Open the client portal'),
  ('portal.marketing', 'Open the marketing portal'),
  ('clients.read', 'Read client profiles'),
  ('clients.create', 'Create client profiles'),
  ('applications.read', 'Read loan applications'),
  ('applications.create', 'Create loan applications'),
  ('applications.submit', 'Submit loan applications'),
  ('applications.review', 'Review loan applications'),
  ('kyc.review', 'Review client KYC'),
  ('risk.assess', 'Assess application risk'),
  ('loans.read', 'Read loan accounts'),
  ('loans.approve', 'Approve or reject loan applications'),
  ('loans.disburse', 'Disburse approved loans'),
  ('loans.transition', 'Advance loan lifecycle states'),
  ('marketing.read', 'Read marketing catalogue and aggregates')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'portal.manager', 'portal.officer', 'portal.client', 'portal.marketing',
  'clients.read', 'clients.create', 'applications.read', 'applications.create',
  'applications.submit', 'applications.review', 'kyc.review', 'risk.assess',
  'loans.read', 'loans.approve', 'loans.disburse', 'loans.transition', 'marketing.read'
)
WHERE r.code = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'portal.manager', 'clients.read', 'clients.create', 'applications.read',
  'applications.create', 'applications.submit', 'applications.review',
  'kyc.review', 'risk.assess', 'loans.read', 'loans.approve',
  'loans.disburse', 'loans.transition'
)
WHERE r.code = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'portal.officer', 'clients.read', 'clients.create', 'applications.read',
  'applications.create', 'applications.submit', 'kyc.review', 'risk.assess',
  'loans.read'
)
WHERE r.code = 'officer'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('portal.client', 'applications.read', 'applications.create', 'applications.submit', 'loans.read')
WHERE r.code = 'client'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('portal.marketing', 'marketing.read')
WHERE r.code = 'marketing'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('loans.read')
WHERE r.code IN ('collector', 'accountant')
ON CONFLICT DO NOTHING;

COMMIT;