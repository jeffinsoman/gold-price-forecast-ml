import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountForMethod,
  isIsoDate,
  loanStatus,
  monthKey,
  monthLabel,
  recentMonths,
  summarize,
  validateEntry,
  validateLoan,
  validateRepayment,
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
  assert.equal(s.available, 9000);
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

test("balance is carried forward + income - expense, and it carries on", () => {
  const sep = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 700 },
    expenseByMethod: { Cash: 500 },
  });
  assert.equal(sep.carriedForward, 0);
  assert.equal(sep.balance, 200);

  // Next month opens on exactly that balance.
  const oct = summarize({ month: "2026-10", carriedForward: sep.balance });
  assert.equal(oct.carriedForward, 200);
  assert.equal(oct.available, 200);
  assert.equal(oct.balance, 200);

  // 659 carried + 8,947 earned - 7,810 spent = 1,796 into November.
  const nov = summarize({
    month: "2026-11",
    incomeByAccount: { Bank: 8947 },
    expenseByMethod: { Cash: 7810 },
    carriedForward: 659,
  });
  assert.equal(nov.available, 9606);
  assert.equal(nov.balance, 1796);
  assert.equal(nov.budget, 9606);
  assert.equal(nov.status, "IN CONTROL");
  assert.equal(nov.statusMessage, "In control, 1,796 left");
  assert.equal(nov.remaining, nov.balance);
});

test("spending past the carried balance goes out of budget", () => {
  const s = summarize({
    month: "2026-11",
    incomeByAccount: { Bank: 1000 },
    expenseByMethod: { Cash: 1400 },
    carriedForward: 200,
  });
  assert.equal(s.available, 1200);
  assert.equal(s.balance, -200);
  assert.equal(s.status, "OUT OF BUDGET");
  assert.equal(s.overBy, 200);
});

test("expense methods map onto the accounts that hold money", () => {
  assert.equal(accountForMethod("Cash"), "Cash in Hand");
  assert.equal(accountForMethod("Bank"), "Bank");
  assert.equal(accountForMethod("Credit Card"), null);
});

test("loan status tracks partial repayment", () => {
  assert.deepEqual(loanStatus(1000, 0), { lent: 1000, repaid: 0, outstanding: 1000, status: "Not repaid", repaidPct: 0 });
  assert.deepEqual(loanStatus(1000, 400), { lent: 1000, repaid: 400, outstanding: 600, status: "Partly repaid", repaidPct: 40 });
  assert.deepEqual(loanStatus(1000, 1000), { lent: 1000, repaid: 1000, outstanding: 0, status: "Settled", repaidPct: 100 });
});

test("loans are validated", () => {
  const loan = validateLoan({ friend: "  Sam  ", date: "2026-09-02", amount: "500", paidFrom: "Cash", note: "trip" });
  assert.deepEqual(loan, {
    friend: "Sam",
    date: "2026-09-02",
    month: "2026-09",
    amount: 500,
    paidFrom: "Cash",
    note: "trip",
  });
  assert.throws(() => validateLoan({ date: "2026-09-02", amount: 500, paidFrom: "Cash" }), /name/);
  assert.throws(() => validateLoan({ friend: "Sam", date: "2026-09-02", amount: 0, paidFrom: "Cash" }), /greater than zero/);
  assert.throws(() => validateLoan({ friend: "Sam", date: "2026-09-02", amount: 5, paidFrom: "Wallet" }), /Paid from/);
});

test("repayments cannot exceed what is outstanding", () => {
  const part = validateRepayment({ date: "2026-09-20", amount: 200, receivedIn: "Bank" }, 500);
  assert.equal(part.amount, 200);
  assert.equal(part.receivedIn, "Bank");

  const full = validateRepayment({ date: "2026-09-20", amount: 500, receivedIn: "Cash in Hand" }, 500);
  assert.equal(full.amount, 500);

  assert.throws(() => validateRepayment({ date: "2026-09-20", amount: 501, receivedIn: "Bank" }, 500), /outstanding/);
  assert.throws(() => validateRepayment({ date: "2026-09-20", amount: 100, receivedIn: "Credit Card" }, 500), /Received in/);
});
