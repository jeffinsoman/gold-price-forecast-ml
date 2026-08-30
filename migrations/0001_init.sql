-- Income vs Expense Tracker schema.

CREATE TABLE IF NOT EXISTS income (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,          -- YYYY-MM-DD, the day money came in
    month      TEXT    NOT NULL,          -- YYYY-MM, denormalised for fast monthly roll-ups
    amount     REAL    NOT NULL CHECK (amount > 0),
    account    TEXT    NOT NULL,          -- 'Cash in Hand' | 'Bank'
    category   TEXT    NOT NULL DEFAULT 'Other',
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,          -- today for a spend, a later date for a bill due
    month      TEXT    NOT NULL,
    amount     REAL    NOT NULL CHECK (amount > 0),
    method     TEXT    NOT NULL,          -- 'Cash' | 'Bank' | 'Credit Card'
    category   TEXT    NOT NULL DEFAULT 'Other',
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Optional per-month spending limit. Without a row here the month's income is the budget.
CREATE TABLE IF NOT EXISTS budget (
    month  TEXT PRIMARY KEY,
    amount REAL NOT NULL CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_income_month  ON income (month);
CREATE INDEX IF NOT EXISTS idx_expense_month ON expense (month);
