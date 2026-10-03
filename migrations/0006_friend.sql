-- An optional name on an entry: who the money went to, or came back from.
ALTER TABLE income  ADD COLUMN friend TEXT NOT NULL DEFAULT '';
ALTER TABLE expense ADD COLUMN friend TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_income_friend  ON income (friend);
CREATE INDEX IF NOT EXISTS idx_expense_friend ON expense (friend);
