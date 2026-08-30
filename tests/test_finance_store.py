"""Tests for the monthly income vs expense rules."""

import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from finance import store


class MonthlyTrackerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = store.connect(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def test_month_key_and_label(self):
        self.assertEqual(store.month_key(date(2026, 9, 4)), "2026-09")
        self.assertEqual(store.month_key("2026-09-04"), "2026-09")
        self.assertEqual(store.month_label("2026-09"), "Sep 2026")

    def test_out_of_budget_when_spending_beats_income(self):
        store.add_income(self.conn, "2026-09-01", 9000, "Bank", "Salary")
        store.add_expense(self.conn, "2026-09-05", 10000, "Credit Card", "Shopping")

        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-30")
        self.assertEqual(summary.income_total, 9000)
        self.assertEqual(summary.expense_total, 10000)
        self.assertEqual(summary.budget, 9000)
        self.assertEqual(summary.status, "OUT OF BUDGET")
        self.assertEqual(summary.over_by, 1000)
        self.assertEqual(summary.balance, -1000)

    def test_in_control_when_spending_stays_under_income(self):
        store.add_income(self.conn, "2026-09-01", 9000, "Bank", "Salary")
        store.add_expense(self.conn, "2026-09-05", 5000, "Cash", "Food")

        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-30")
        self.assertEqual(summary.status, "IN CONTROL")
        self.assertEqual(summary.remaining, 4000)
        self.assertEqual(summary.over_by, 0)
        self.assertIn("4,000 left", summary.status_message)

    def test_spending_exactly_the_budget_is_still_in_control(self):
        store.add_income(self.conn, "2026-09-01", 5000, "Cash in Hand")
        store.add_expense(self.conn, "2026-09-02", 5000, "Cash")
        self.assertEqual(store.monthly_summary(self.conn, "2026-09").status, "IN CONTROL")

    def test_future_dated_expense_counts_as_upcoming(self):
        store.add_income(self.conn, "2026-09-01", 9000, "Bank")
        store.add_expense(self.conn, "2026-09-10", 2000, "Cash")      # already spent
        store.add_expense(self.conn, "2026-09-25", 3000, "Credit Card")  # due later

        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-15")
        self.assertEqual(summary.expense_paid, 2000)
        self.assertEqual(summary.expense_upcoming, 3000)
        self.assertEqual(summary.expense_total, 5000)
        self.assertEqual(summary.status, "IN CONTROL")

    def test_splits_by_account_and_method(self):
        store.add_income(self.conn, "2026-09-01", 6000, "Bank")
        store.add_income(self.conn, "2026-09-03", 3000, "Cash in Hand")
        store.add_expense(self.conn, "2026-09-04", 1000, "Cash")
        store.add_expense(self.conn, "2026-09-05", 2500, "Bank")
        store.add_expense(self.conn, "2026-09-06", 500, "Credit Card")

        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-30")
        self.assertEqual(summary.income_by_account, {"Bank": 6000, "Cash in Hand": 3000})
        self.assertEqual(
            summary.expense_by_method, {"Cash": 1000, "Bank": 2500, "Credit Card": 500}
        )

    def test_custom_budget_overrides_income(self):
        store.add_income(self.conn, "2026-09-01", 9000, "Bank")
        store.add_expense(self.conn, "2026-09-02", 5000, "Cash")
        store.set_budget(self.conn, "2026-09", 4000)

        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-30")
        self.assertTrue(summary.budget_is_custom)
        self.assertEqual(summary.budget, 4000)
        self.assertEqual(summary.status, "OUT OF BUDGET")

        store.set_budget(self.conn, "2026-09", None)
        summary = store.monthly_summary(self.conn, "2026-09", today="2026-09-30")
        self.assertFalse(summary.budget_is_custom)
        self.assertEqual(summary.status, "IN CONTROL")

    def test_months_are_kept_separate(self):
        store.add_income(self.conn, "2026-09-01", 9000, "Bank")
        store.add_expense(self.conn, "2026-10-02", 12000, "Bank")

        self.assertEqual(store.months_available(self.conn), ["2026-10", "2026-09"])
        self.assertEqual(store.monthly_summary(self.conn, "2026-09").expense_total, 0)
        oct_summary = store.monthly_summary(self.conn, "2026-10", today="2026-10-31")
        self.assertEqual(oct_summary.income_total, 0)
        self.assertEqual(oct_summary.status, "OUT OF BUDGET")

    def test_empty_month_reports_no_entries(self):
        summary = store.monthly_summary(self.conn, "2026-09")
        self.assertFalse(summary.has_entries)
        self.assertEqual(summary.status, "NO ENTRIES")
        self.assertIn("Nothing recorded", summary.status_message)

    def test_rejects_bad_input(self):
        with self.assertRaises(ValueError):
            store.add_income(self.conn, "2026-09-01", 0, "Bank")
        with self.assertRaises(ValueError):
            store.add_income(self.conn, "2026-09-01", 100, "Credit Card")
        with self.assertRaises(ValueError):
            store.add_expense(self.conn, "2026-09-01", -5, "Cash")
        with self.assertRaises(ValueError):
            store.add_expense(self.conn, "2026-09-01", 100, "Cash in Hand")

    def test_delete_removes_entry(self):
        income_id = store.add_income(self.conn, "2026-09-01", 9000, "Bank")
        expense_id = store.add_expense(self.conn, "2026-09-02", 1000, "Cash")
        store.delete_income(self.conn, income_id)
        store.delete_expense(self.conn, expense_id)

        summary = store.monthly_summary(self.conn, "2026-09")
        self.assertEqual(summary.income_total, 0)
        self.assertEqual(summary.expense_total, 0)


if __name__ == "__main__":
    unittest.main()
