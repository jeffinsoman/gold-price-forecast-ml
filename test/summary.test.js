import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountForMethod,
  addMonths,
  dueDate,
  endMonthFor,
  monthsFrom,
  runLength,
  isIsoDate,
  loanFlow,
  loanStatus,
  monthKey,
  monthLabel,
  recentMonths,
  summarize,
  validateEntry,
  validateLoan,
  validateRecurring,
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
    direction: "lent",
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

test("lending is an expense, so it leaves the balance until it comes back", () => {
  // Aug: earned 1,514, spent 120, lent 500 — the loan is booked as an expense.
  const aug = summarize({
    month: "2026-08",
    incomeByAccount: { Bank: 1514 },
    expenseByMethod: { Cash: 620 },
  });
  assert.equal(aug.balance, 894);
  assert.equal(aug.status, "IN CONTROL");

  // Sep: the friend returns it, booked as income, so it comes back.
  const sep = summarize({
    month: "2026-09",
    carriedForward: aug.balance,
    incomeByAccount: { Bank: 500 },
  });
  assert.equal(sep.carriedForward, 894);
  assert.equal(sep.balance, 1394);
});

test("borrowing is income, and paying it back is an expense", () => {
  const sep = summarize({
    month: "2026-09",
    incomeByAccount: { Bank: 3000 },
    expenseByMethod: { Cash: 300 },
  });
  assert.equal(sep.balance, 2700);

  const oct = summarize({
    month: "2026-10",
    carriedForward: sep.balance,
    expenseByMethod: { Cash: 800 },
  });
  assert.equal(oct.balance, 1900);
});

test("each direction moves money the opposite way", () => {
  assert.deepEqual(loanFlow("lent"), {
    openLabel: "Paid from",
    openValues: ["Cash", "Bank", "Credit Card"],
    backLabel: "Received in",
    backValues: ["Cash in Hand", "Bank"],
  });
  assert.deepEqual(loanFlow("borrowed"), {
    openLabel: "Received in",
    openValues: ["Cash in Hand", "Bank"],
    backLabel: "Repaid from",
    backValues: ["Cash", "Bank", "Credit Card"],
  });

  const borrowed = validateLoan({ direction: "borrowed", friend: "Ali", date: "2026-09-02", amount: 2000, paidFrom: "Bank" });
  assert.equal(borrowed.direction, "borrowed");
  assert.throws(
    () => validateLoan({ direction: "borrowed", friend: "Ali", date: "2026-09-02", amount: 20, paidFrom: "Credit Card" }),
    /Received in/,
  );
  assert.throws(
    () => validateRepayment({ date: "2026-09-20", amount: 100, receivedIn: "Cash in Hand" }, 500, "borrowed"),
    /Repaid from/,
  );
  assert.equal(loanStatus(2000, 500, "borrowed").status, "Partly paid back");
});

test("months shift and list correctly", () => {
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-09", 0), "2026-09");
  assert.deepEqual(monthsFrom("2026-08", "2026-11"), ["2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthsFrom("2026-09", "2026-09"), ["2026-09"]);
  assert.deepEqual(monthsFrom("2026-10", "2026-09"), []);
});

test("a repeat due on the 31st falls back to the last day of short months", () => {
  assert.equal(dueDate("2026-10", 31), "2026-10-31");
  assert.equal(dueDate("2026-09", 31), "2026-09-30");
  assert.equal(dueDate("2027-02", 30), "2027-02-28");
  assert.equal(dueDate("2028-02", 31), "2028-02-29");
  assert.equal(dueDate("2026-09", 1), "2026-09-01");
});

test("repeats are validated", () => {
  const rule = validateRecurring({
    kind: "income",
    amount: "8000",
    account: "Bank",
    category: "Salary",
    day: 1,
    startMonth: "2026-09",
    note: "  Monthly salary  ",
  });
  assert.deepEqual(rule, {
    kind: "income",
    amount: 8000,
    account: "Bank",
    category: "Salary",
    day: 1,
    startMonth: "2026-09",
    endMonth: null,
    note: "Monthly salary",
    active: 1,
  });

  assert.throws(() => validateRecurring({ kind: "savings", amount: 1, account: "Bank", day: 1, startMonth: "2026-09" }), /income or expense/);
  assert.throws(() => validateRecurring({ kind: "income", amount: 1, account: "Credit Card", day: 1, startMonth: "2026-09" }), /Account must be/);
  assert.throws(() => validateRecurring({ kind: "expense", amount: 1, account: "Cash", day: 0, startMonth: "2026-09" }), /Day must be/);
  assert.throws(() => validateRecurring({ kind: "expense", amount: 1, account: "Cash", day: 32, startMonth: "2026-09" }), /Day must be/);
  assert.throws(() => validateRecurring({ kind: "expense", amount: 1, account: "Cash", day: 5, startMonth: "sept" }), /Starting month/);
  assert.throws(
    () => validateRecurring({ kind: "expense", amount: 1, account: "Cash", day: 5, startMonth: "2026-09", endMonth: "2026-08" }),
    /cannot be before/,
  );

  // An expense may be charged to a card; income cannot land on one.
  assert.equal(validateRecurring({ kind: "expense", amount: 350, account: "Credit Card", category: "Bills", day: 5, startMonth: "2026-09" }).account, "Credit Card");
});

test("a run can be set by its number of payments", () => {
  assert.equal(endMonthFor("2026-10", 24), "2028-09");
  assert.equal(endMonthFor("2026-10", 1), "2026-10");
  assert.equal(endMonthFor("2026-12", 3), "2027-02");
  assert.throws(() => endMonthFor("2026-10", 0), /1 or more/);
  assert.throws(() => endMonthFor("2026-10", 2.5), /1 or more/);

  // Either way of saying it lands on the same month.
  const byCount = validateRecurring({ kind: "expense", amount: 1200, account: "Bank", category: "EMI", day: 5, startMonth: "2026-10", payments: 24 });
  const byMonth = validateRecurring({ kind: "expense", amount: 1200, account: "Bank", category: "EMI", day: 5, startMonth: "2026-10", endMonth: "2028-09" });
  assert.equal(byCount.endMonth, byMonth.endMonth);
});

test("a run reports how far along it is", () => {
  assert.deepEqual(runLength("2026-10", null, 3), { planned: null, written: 3, remaining: null, finished: false, progress: 0 });

  const part = runLength("2026-10", "2028-09", 6);
  assert.equal(part.planned, 24);
  assert.equal(part.remaining, 18);
  assert.equal(part.finished, false);
  assert.equal(Math.round(part.progress), 25);

  const done = runLength("2026-07", "2026-08", 2);
  assert.equal(done.remaining, 0);
  assert.equal(done.finished, true);
  assert.equal(done.progress, 100);
});
