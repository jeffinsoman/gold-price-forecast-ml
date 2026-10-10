-- Things to buy before a trip or an occasion, ticked off once bought.
CREATE TABLE IF NOT EXISTS purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  bought INTEGER NOT NULL DEFAULT 0,
  bought_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
