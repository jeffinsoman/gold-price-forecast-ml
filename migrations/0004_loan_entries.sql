-- Money moving with a friend is booked as an ordinary income or expense entry.
-- loan_ref links that entry back to the loan (or repayment) that created it, so
-- editing the loan keeps the entry in step and deleting it takes the entry away.
ALTER TABLE income  ADD COLUMN loan_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE expense ADD COLUMN loan_ref TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_income_ref  ON income (loan_ref);
CREATE INDEX IF NOT EXISTS idx_expense_ref ON expense (loan_ref);
