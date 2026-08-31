-- Money can move either way: 'lent' is money you gave out, 'borrowed' is money
-- you took from someone. Existing rows were all loans you made.
ALTER TABLE loan ADD COLUMN direction TEXT NOT NULL DEFAULT 'lent';

CREATE INDEX IF NOT EXISTS idx_loan_direction ON loan (direction);
