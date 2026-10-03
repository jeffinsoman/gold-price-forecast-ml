-- An expense is either money already gone, or a payment still expected.
-- Only a paid one moves an account balance.
ALTER TABLE expense ADD COLUMN paid INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_expense_paid ON expense (paid);
