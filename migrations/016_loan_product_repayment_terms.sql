ALTER TABLE loan_products
  ADD COLUMN annual_rate_percent numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN installments integer NOT NULL DEFAULT 1,
  ADD COLUMN repayment_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE loan_products
  ADD CONSTRAINT loan_products_installments_positive CHECK (installments > 0),
  ADD CONSTRAINT loan_products_rate_non_negative CHECK (annual_rate_percent >= 0),
  ADD CONSTRAINT loan_products_repayment_cycle_valid CHECK (repayment_cycle IN ('monthly', 'biweekly'));

UPDATE loan_products SET annual_rate_percent = 24, installments = 6, repayment_cycle = 'monthly' WHERE code = 'PERSONAL';
UPDATE loan_products SET annual_rate_percent = 20, installments = 12, repayment_cycle = 'monthly' WHERE code = 'BUSINESS_GROWTH';
UPDATE loan_products SET annual_rate_percent = 30, installments = 3, repayment_cycle = 'biweekly' WHERE code = 'EMERGENCY';
