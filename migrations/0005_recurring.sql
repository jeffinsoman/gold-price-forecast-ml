-- Standing instructions: salary in on the 1st, rent out on the 5th, and so on.
-- Each one writes an ordinary entry per month, which stays editable afterwards.
CREATE TABLE IF NOT EXISTS recurring (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT    NOT NULL,              -- 'income' | 'expense'
    amount      REAL    NOT NULL CHECK (amount > 0),
    account     TEXT    NOT NULL,              -- income: account, expense: payment method
    category    TEXT    NOT NULL DEFAULT 'Other',
    note        TEXT    NOT NULL DEFAULT '',
    day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
    start_month TEXT    NOT NULL,              -- YYYY-MM, first month it applies
    end_month   TEXT,                          -- YYYY-MM, last month, or NULL for open ended
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per month a rule has already written, so an entry you delete by hand
-- is not silently recreated.
CREATE TABLE IF NOT EXISTS recurring_run (
    recurring_id INTEGER NOT NULL REFERENCES recurring (id) ON DELETE CASCADE,
    month        TEXT    NOT NULL,
    entry_id     INTEGER,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (recurring_id, month)
);

-- Marks the entry a rule created, so the list can show where it came from.
ALTER TABLE income  ADD COLUMN recur_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE expense ADD COLUMN recur_ref TEXT NOT NULL DEFAULT '';
