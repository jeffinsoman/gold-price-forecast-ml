-- Income is either money that has arrived, or money still to come.
-- Only received money counts towards an account balance.
ALTER TABLE income ADD COLUMN received INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_income_received ON income (received);
