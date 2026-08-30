import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isIsoDate,
  monthKey,
  monthLabel,
  recentMonths,
  summarize,
  validateEntry,
} from "../worker/summary.js";

test("month keys and labels", () => {
  assert.equal(monthKey("2026-09-04"), "2026-09");
  assert.equal(monthLabel("2026-09"), "Sep 2026");
  assert.deepEqual(recentMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
});

test("out of budget when spending beats income", () => {
  const s = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 9000 },
    expenseByMethod: { "Credit Card": 10000 },
  });
  assert.equal(s.incomeTotal, 9000);
  assert.equal(s.expenseTotal, 10000);
  assert.equal(s.budget, 9000);
  assert.equal(s.status, "OUT OF BUDGET");
  assert.equal(s.overBy, 1000);
  assert.equal(s.balance, -1000);
  assert.equal(s.statusMessage, "Out of budget by 1,000");
});

test("in control when spending stays under income", () => {
  const s = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 9000 },
    expenseByMethod: { Cash: 5000 },
  });
  assert.equal(s.status, "IN CONTROL");
  assert.equal(s.remaining, 4000);
  assert.equal(s.overBy, 0);
  assert.equal(s.statusMessage, "In control, 4,000 left");
});

test("spending exactly the budget is still in control", () => {
  const s = summarize({
    month: "2026-09",
    incomeByAccount: { "Cash in Hand": 5000 },
    expenseByMethod: { Cash: 5000 },
  });
  assert.equal(s.status, "IN CONTROL");
  assert.equal(s.budgetUsedPct, 100);
});

test("a custom budget overrides income", () => {
  const s = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 9000 },
    expenseByMethod: { Cash: 5000 },
    customBudget: 4000,
  });
  assert.equal(s.budgetIsCustom, true);
  assert.equal(s.status, "OUT OF BUDGET");
  assert.equal(s.overBy, 1000);
});

test("an empty month reports no entries", () => {
  const s = summarize({ month: "2026-09" });
  assert.equal(s.hasEntries, false);
  assert.equal(s.status, "NO ENTRIES");
  assert.equal(s.isOverBudget, false);
});

test("paid and upcoming are carried through", () => {
  const s = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 9000 },
    expenseByMethod: { Cash: 2000, "Credit Card": 3000 },
    expensePaid: 2000,
    expenseUpcoming: 3000,
  });
  assert.equal(s.expenseTotal, 5000);
  assert.equal(s.expensePaid, 2000);
  assert.equal(s.expenseUpcoming, 3000);
});

test("iso dates are checked properly", () => {
  assert.ok(isIsoDate("2026-09-30"));
  assert.ok(isIsoDate("2024-02-29"));
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("30-09-2026"), false);
});

test("entries are validated and normalised", () => {
  const income = validateEntry(
    { date: "2026-09-01", amount: "9000", account: "Bank", category: "Salary", note: "  pay  " },
    "income",
  );
  assert.deepEqual(income, {
    date: "2026-09-01",
    month: "2026-09",
    amount: 9000,
    account: "Bank",
    category: "Salary",
    note: "pay",
  });

  const expense = validateEntry(
    { date: "2026-09-28", amount: 3000, method: "Credit Card", category: "made up" },
    "expense",
  );
  assert.equal(expense.method, "Credit Card");
  assert.equal(expense.category, "Other");

  assert.throws(() => validateEntry({ date: "2026-09-01", amount: 0, account: "Bank" }, "income"), /greater than zero/);
  assert.throws(() => validateEntry({ date: "2026-09-01", amount: 10, account: "Credit Card" }, "income"), /Account must be/);
  assert.throws(() => validateEntry({ date: "bad", amount: 10, method: "Cash" }, "expense"), /real date/);
  assert.throws(() => validateEntry({ date: "2026-09-01", amount: 10, method: "Cash in Hand" }, "expense"), /Payment method/);
});
