-- Bills that are settled from the bank. Was credit card only; Tabby works the
-- same way, so each payment now says which bill it pays off.
ALTER TABLE card_payment ADD COLUMN method TEXT NOT NULL DEFAULT 'Credit Card';

CREATE INDEX IF NOT EXISTS idx_card_payment_method ON card_payment (method);
