import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountBalances,
  addMonths,
  friendTotals,
  lines,
  isIsoDate,
  monthKey,
  monthLabel,
  summarize,
  validateEntry,
} from "../worker/summary.js";

test("month keys, labels and shifts", () => {
  assert.equal(monthKey("2026-10-03"), "2026-10");
  assert.equal(monthLabel("2026-10"), "Oct 2026");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

test("out of budget when spending beats what there was to spend", () => {
  const s = summarize({ month: "2026-10", incomeTotal: 9000, expenseTotal: 10000 });
  assert.equal(s.balance, -1000);
  assert.equal(s.status, "OUT OF BUDGET");
  assert.equal(s.statusMessage, "Out of budget by 1,000");
});

test("in control when something is left", () => {
  const s = summarize({ month: "2026-10", incomeTotal: 9000, expenseTotal: 5000 });
  assert.equal(s.balance, 4000);
  assert.equal(s.status, "IN CONTROL");
  assert.equal(s.statusMessage, "In control, 4,000 left");
  assert.equal(Math.round(s.usedPct), 56);
});

test("each month stands on its own: nothing carries in", () => {
  const oct = summarize({ month: "2026-10", incomeTotal: 700, expenseTotal: 500 });
  assert.equal(oct.balance, 200);

  // November knows nothing about October's 200.
  const nov = summarize({ month: "2026-11", incomeTotal: 8947, expenseTotal: 7810 });
  assert.equal(nov.balance, 1137);
  assert.equal(nov.status, "IN CONTROL");

  const empty = summarize({ month: "2026-12" });
  assert.equal(empty.balance, 0);
  assert.equal(empty.status, "NO ENTRIES");
});

test("the dashboard reads as lines, biggest first", () => {
  const rows = lines([
    { category: "Rent", amount: 3000 },
    { category: "Food", amount: 400 },
    { category: "Rent", amount: 500 },
    { category: "Food", amount: 200 },
  ]);
  assert.deepEqual(rows, [
    { label: "Rent", total: 3500 },
    { label: "Food", total: 600 },
  ]);
  assert.deepEqual(lines([]), []);
});

test("cash and bank balances count what went in and out of each", () => {
  const held = accountBalances(
    [{ account: "Bank", total: 9000 }, { account: "Cash in Hand", total: 500 }],
    [{ method: "Cash", total: 200 }, { method: "Bank", total: 1500 }, { method: "Credit Card", total: 1000 }],
  );
  assert.equal(held.balances["Cash in Hand"], 300);
  assert.equal(held.balances.Bank, 7500);
  assert.equal(held.cardSpend, 1000);
  assert.equal(held.total, 7800);

  // Spending cash you never recorded receiving shows up as a negative, not a zero.
  const short = accountBalances([], [{ method: "Cash", total: 120 }]);
  assert.equal(short.balances["Cash in Hand"], -120);
});

test("an empty month reports no entries", () => {
  const s = summarize({ month: "2026-10" });
  assert.equal(s.hasEntries, false);
  assert.equal(s.status, "NO ENTRIES");
  assert.equal(s.isOverBudget, false);
});

test("iso dates are checked properly", () => {
  assert.ok(isIsoDate("2026-10-31"));
  assert.ok(isIsoDate("2024-02-29"));
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("03-10-2026"), false);
});

test("entries are validated and normalised", () => {
  const income = validateEntry(
    { date: "2026-10-01", amount: "9000", account: "Bank", category: "Salary", note: "  pay  " },
    "income",
  );
  assert.deepEqual(income, {
    date: "2026-10-01",
    month: "2026-10",
    amount: 9000,
    account: "Bank",
    category: "Salary",
    friend: "",
    note: "pay",
  });

  const expense = validateEntry({ date: "2026-10-28", amount: 3000, method: "Credit Card", category: "made up" }, "expense");
  assert.equal(expense.method, "Credit Card");
  assert.equal(expense.category, "Other");

  assert.throws(() => validateEntry({ date: "2026-10-01", amount: 0, account: "Bank" }, "income"), /greater than zero/);
  assert.throws(() => validateEntry({ date: "2026-10-01", amount: 10, account: "Credit Card" }, "income"), /Account must be/);
  assert.throws(() => validateEntry({ date: "bad", amount: 10, method: "Cash" }, "expense"), /real date/);
  assert.throws(() => validateEntry({ date: "2026-10-01", amount: 10, method: "Cash in Hand" }, "expense"), /Payment method/);
});

test("a friend's name rides along with the entry", () => {
  const out = validateEntry(
    { date: "2026-10-02", amount: 500, method: "Cash", category: "Other", friend: "  Rahul  " },
    "expense",
  );
  assert.equal(out.friend, "Rahul");

  // Long names are trimmed to something a table can show.
  const long = validateEntry(
    { date: "2026-10-02", amount: 5, method: "Cash", friend: "x".repeat(200) },
    "expense",
  );
  assert.equal(long.friend.length, 60);
});

test("money is netted per friend", () => {
  const totals = friendTotals(
    [{ friend: "Rahul", total: 500 }, { friend: "Ali", total: 200 }, { friend: "", total: 90 }],
    [{ friend: "Rahul", total: 300 }],
  );
  assert.deepEqual(totals, [
    { friend: "Ali", out: 200, back: 0, net: 200 },
    { friend: "Rahul", out: 500, back: 300, net: 200 },
  ]);

  // Paid back in full: settled. Owing them more than went out: negative.
  const settled = friendTotals([{ friend: "Rahul", total: 500 }], [{ friend: "Rahul", total: 500 }]);
  assert.equal(settled[0].net, 0);

  const owed = friendTotals([], [{ friend: "Sam", total: 400 }]);
  assert.equal(owed[0].net, -400);
});
