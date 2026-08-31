-- Money lent to friends, and the repayments that come back.

CREATE TABLE IF NOT EXISTS loan (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    friend     TEXT    NOT NULL,
    date       TEXT    NOT NULL,          -- the day the money went out
    month      TEXT    NOT NULL,
    amount     REAL    NOT NULL CHECK (amount > 0),
    paid_from  TEXT    NOT NULL,          -- 'Cash' | 'Bank' | 'Credit Card'
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per repayment, so a friend can pay back in instalments.
CREATE TABLE IF NOT EXISTS loan_repayment (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    loan_id     INTEGER NOT NULL REFERENCES loan (id) ON DELETE CASCADE,
    date        TEXT    NOT NULL,
    month       TEXT    NOT NULL,
    amount      REAL    NOT NULL CHECK (amount > 0),
    received_in TEXT    NOT NULL,         -- 'Cash in Hand' | 'Bank'
    note        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loan_month      ON loan (month);
CREATE INDEX IF NOT EXISTS idx_repayment_loan  ON loan_repayment (loan_id);
CREATE INDEX IF NOT EXISTS idx_repayment_month ON loan_repayment (month);
