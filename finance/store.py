"""SQLite storage and monthly roll-up logic for the income vs expense tracker.

Standard library only, so the rules below can be tested without Streamlit.
"""

import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "finance_tracker.db"

# Where money lands when it comes in.
INCOME_ACCOUNTS = ("Cash in Hand", "Bank")

# How money goes out.
EXPENSE_METHODS = ("Cash", "Bank", "Credit Card")

INCOME_CATEGORIES = ("Salary", "Business", "Freelance", "Interest", "Rent", "Gift", "Other")
EXPENSE_CATEGORIES = (
    "Food",
    "Groceries",
    "Rent",
    "Bills",
    "Transport",
    "Shopping",
    "Health",
    "Education",
    "EMI",
    "Entertainment",
    "Other",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS income (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    date     TEXT    NOT NULL,
    month    TEXT    NOT NULL,
    amount   REAL    NOT NULL CHECK (amount > 0),
    account  TEXT    NOT NULL,
    category TEXT    NOT NULL DEFAULT 'Other',
    note     TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS expense (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    date     TEXT    NOT NULL,
    month    TEXT    NOT NULL,
    amount   REAL    NOT NULL CHECK (amount > 0),
    method   TEXT    NOT NULL,
    category TEXT    NOT NULL DEFAULT 'Other',
    note     TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS budget (
    month  TEXT PRIMARY KEY,
    amount REAL NOT NULL CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_income_month  ON income (month);
CREATE INDEX IF NOT EXISTS idx_expense_month ON expense (month);
"""


# -------------------------------------------------------------------
# HELPERS
# -------------------------------------------------------------------
def _as_date(value):
    """Accept a date, datetime or ISO string and return a date."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value), "%Y-%m-%d").date()


def month_key(value):
    """'2026-09' for any date-ish value."""
    return _as_date(value).strftime("%Y-%m")


def month_label(key):
    """'2026-09' -> 'Sep 2026'."""
    return datetime.strptime(key, "%Y-%m").strftime("%b %Y")


def _validate(amount, choice, allowed, label):
    amount = float(amount)
    if amount <= 0:
        raise ValueError("Amount must be greater than zero.")
    if choice not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(allowed)}.")
    return amount


# -------------------------------------------------------------------
# CONNECTION
# -------------------------------------------------------------------
def connect(db_path=DB_PATH):
    """Open the tracker database, creating the schema on first use."""
    conn = sqlite3.connect(str(db_path), detect_types=0)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
    return conn


# -------------------------------------------------------------------
# WRITES
# -------------------------------------------------------------------
def add_income(conn, on_date, amount, account, category="Other", note=""):
    """Record money coming in, into Cash in Hand or Bank."""
    amount = _validate(amount, account, INCOME_ACCOUNTS, "Account")
    day = _as_date(on_date)
    cur = conn.execute(
        "INSERT INTO income (date, month, amount, account, category, note)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (day.isoformat(), month_key(day), amount, account, category or "Other", (note or "").strip()),
    )
    conn.commit()
    return cur.lastrowid


def add_expense(conn, on_date, amount, method, category="Other", note=""):
    """Record money going out, paid by Cash, Bank or Credit Card.

    The date is free: today for a spend that already happened, or a future
    date for a bill/EMI that is due later in the month.
    """
    amount = _validate(amount, method, EXPENSE_METHODS, "Payment method")
    day = _as_date(on_date)
    cur = conn.execute(
        "INSERT INTO expense (date, month, amount, method, category, note)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (day.isoformat(), month_key(day), amount, method, category or "Other", (note or "").strip()),
    )
    conn.commit()
    return cur.lastrowid


def delete_income(conn, row_id):
    conn.execute("DELETE FROM income WHERE id = ?", (row_id,))
    conn.commit()


def delete_expense(conn, row_id):
    conn.execute("DELETE FROM expense WHERE id = ?", (row_id,))
    conn.commit()


def set_budget(conn, month, amount):
    """Pin a spending limit for a month. Pass None to fall back to income."""
    if amount is None:
        conn.execute("DELETE FROM budget WHERE month = ?", (month,))
    else:
        amount = float(amount)
        if amount < 0:
            raise ValueError("Budget cannot be negative.")
        conn.execute(
            "INSERT INTO budget (month, amount) VALUES (?, ?)"
            " ON CONFLICT(month) DO UPDATE SET amount = excluded.amount",
            (month, amount),
        )
    conn.commit()


def get_budget(conn, month):
    row = conn.execute("SELECT amount FROM budget WHERE month = ?", (month,)).fetchone()
    return None if row is None else float(row["amount"])


# -------------------------------------------------------------------
# READS
# -------------------------------------------------------------------
def list_income(conn, month=None):
    if month:
        rows = conn.execute(
            "SELECT * FROM income WHERE month = ? ORDER BY date DESC, id DESC", (month,)
        )
    else:
        rows = conn.execute("SELECT * FROM income ORDER BY date DESC, id DESC")
    return [dict(r) for r in rows]


def list_expenses(conn, month=None):
    if month:
        rows = conn.execute(
            "SELECT * FROM expense WHERE month = ? ORDER BY date DESC, id DESC", (month,)
        )
    else:
        rows = conn.execute("SELECT * FROM expense ORDER BY date DESC, id DESC")
    return [dict(r) for r in rows]


def months_available(conn):
    """Every month that has an entry, newest first."""
    rows = conn.execute(
        "SELECT month FROM income UNION SELECT month FROM expense ORDER BY month DESC"
    )
    return [r["month"] for r in rows]


# -------------------------------------------------------------------
# MONTHLY ROLL-UP
# -------------------------------------------------------------------
@dataclass
class MonthlySummary:
    """One month of income vs expense, and the verdict on it."""

    month: str
    income_total: float = 0.0
    expense_total: float = 0.0
    expense_paid: float = 0.0       # dated on or before today
    expense_upcoming: float = 0.0   # future dated, still due
    budget: float = 0.0
    budget_is_custom: bool = False
    income_by_account: dict = field(default_factory=dict)
    expense_by_method: dict = field(default_factory=dict)

    @property
    def label(self):
        return month_label(self.month)

    @property
    def balance(self):
        """Income minus every expense booked in the month."""
        return self.income_total - self.expense_total

    @property
    def remaining(self):
        """Budget left. Negative once spending crosses the budget."""
        return self.budget - self.expense_total

    @property
    def over_by(self):
        return max(0.0, -self.remaining)

    @property
    def is_over_budget(self):
        return self.expense_total > self.budget

    @property
    def has_entries(self):
        return bool(self.income_total or self.expense_total)

    @property
    def status(self):
        if not self.has_entries:
            return "NO ENTRIES"
        return "OUT OF BUDGET" if self.is_over_budget else "IN CONTROL"

    @property
    def status_message(self):
        if not self.has_entries:
            return "Nothing recorded for this month yet"
        if self.is_over_budget:
            return f"Out of budget by {self.over_by:,.0f}"
        return f"In control, {self.remaining:,.0f} left"

    @property
    def budget_used_pct(self):
        if self.budget <= 0:
            return 100.0 if self.expense_total > 0 else 0.0
        return self.expense_total / self.budget * 100.0


def monthly_summary(conn, month, today=None):
    """Totals for one month, split by account/method and by paid vs upcoming.

    The budget is the month's income unless a custom budget was set, so
    spending more than you earned in the month reads as OUT OF BUDGET.
    """
    today = _as_date(today) if today is not None else date.today()
    summary = MonthlySummary(month=month)

    for row in conn.execute(
        "SELECT account, SUM(amount) AS total FROM income WHERE month = ? GROUP BY account",
        (month,),
    ):
        summary.income_by_account[row["account"]] = float(row["total"])
    summary.income_total = sum(summary.income_by_account.values())

    for row in conn.execute(
        "SELECT method, SUM(amount) AS total FROM expense WHERE month = ? GROUP BY method",
        (month,),
    ):
        summary.expense_by_method[row["method"]] = float(row["total"])
    summary.expense_total = sum(summary.expense_by_method.values())

    row = conn.execute(
        "SELECT COALESCE(SUM(CASE WHEN date <= ? THEN amount END), 0) AS paid,"
        "       COALESCE(SUM(CASE WHEN date >  ? THEN amount END), 0) AS upcoming"
        " FROM expense WHERE month = ?",
        (today.isoformat(), today.isoformat(), month),
    ).fetchone()
    summary.expense_paid = float(row["paid"])
    summary.expense_upcoming = float(row["upcoming"])

    custom = get_budget(conn, month)
    summary.budget_is_custom = custom is not None
    summary.budget = custom if custom is not None else summary.income_total
    return summary
