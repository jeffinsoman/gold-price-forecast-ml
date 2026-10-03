-- Gold challenge (AED 200 -> AED 100,000 in 100 days): one row per XAUUSD trade.
-- Start date and starting balance live in settings as gold:startDate / gold:startBalance.
CREATE TABLE IF NOT EXISTS gold_trade (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,          -- YYYY-MM-DD, the day the trade closed
    day        INTEGER NOT NULL,          -- challenge day 1..100
    direction  TEXT    NOT NULL DEFAULT 'Buy',
    lot        REAL    NOT NULL CHECK (lot > 0),
    entry      REAL,
    exit       REAL,
    pnl        REAL    NOT NULL,          -- AED, after the trade closed
    note       TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gold_trade_day ON gold_trade (day);
