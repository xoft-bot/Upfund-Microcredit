BEGIN;

INSERT INTO permissions (code, name)
VALUES ('portal.accountant', 'Open the accountant portal')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'portal.accountant'
WHERE r.code IN ('admin', 'accountant')
ON CONFLICT DO NOTHING;

COMMIT;