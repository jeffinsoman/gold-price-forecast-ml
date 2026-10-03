-- What was already in each account before the tracker started.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Money leaving the bank to settle the credit card bill. Charging the card is
-- already an expense; this only moves what is owed off the card.
CREATE TABLE IF NOT EXISTS card_payment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,
    month      TEXT    NOT NULL,
    amount     REAL    NOT NULL CHECK (amount > 0),
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_card_payment_month ON card_payment (month);
