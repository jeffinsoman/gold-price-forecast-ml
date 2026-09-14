// Income vs Expense Tracker - Cloudflare Worker API.
// Static pages come from the assets binding; everything under /api is handled here.

import {
  ACCOUNTS,
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_ACCOUNTS,
  INCOME_CATEGORIES,
  LOAN_CATEGORY,
  LOAN_DIRECTIONS,
  LOAN_SOURCES,
  accountForMethod,
  loanFlow,
  loanStatus,
  monthKey,
  monthLabel,
  recentMonths,
  summarize,
  today,
  validateEntry,
  validateLoan,
  validateRepayment,
} from "./summary.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
}

/** "2026-12" -> "2027-01" */
function nextMonth(key) {
  let [year, month] = key.split("-").map(Number);
  month += 1;
  if (month === 13) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function isMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be JSON.");
  }
}

function totalsFrom(rows, key, field = "total") {
  const map = {};
  for (const row of rows) map[row[key]] = Number(row[field]);
  return map;
}

// -------------------------------------------------------------------
// MONTH QUERIES
// -------------------------------------------------------------------
/**
 * What every earlier month left behind: income minus expense, all time before
 * `month`. Loans are in there already, booked as entries when they happen.
 */
async function carriedForward(db, month) {
  const row = await db
    .prepare(
      "SELECT COALESCE((SELECT SUM(amount) FROM income WHERE month < ?1), 0)" +
        " - COALESCE((SELECT SUM(amount) FROM expense WHERE month < ?1), 0) AS carried",
    )
    .bind(month)
    .first();
  return Number(row?.carried) || 0;
}

async function monthSummary(db, month) {
  const day = today();
  const [income, expense, split, budget] = await db.batch([
    db.prepare("SELECT account, SUM(amount) AS total FROM income WHERE month = ?1 GROUP BY account").bind(month),
    db.prepare("SELECT method, SUM(amount) AS total FROM expense WHERE month = ?1 GROUP BY method").bind(month),
    db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN date <= ?2 THEN amount END), 0) AS paid," +
          " COALESCE(SUM(CASE WHEN date > ?2 THEN amount END), 0) AS upcoming" +
          " FROM expense WHERE month = ?1",
      )
      .bind(month, day),
    db.prepare("SELECT amount FROM budget WHERE month = ?1").bind(month),
  ]);

  const totals = split.results[0] ?? { paid: 0, upcoming: 0 };
  const custom = budget.results[0];

  return summarize({
    month,
    incomeByAccount: totalsFrom(income.results, "account"),
    expenseByMethod: totalsFrom(expense.results, "method"),
    expensePaid: Number(totals.paid),
    expenseUpcoming: Number(totals.upcoming),
    customBudget: custom ? Number(custom.amount) : null,
    carriedForward: await carriedForward(db, month),
  });
}

/**
 * What is actually sitting in each account at the end of `month`.
 * Money lent out has left the account; money repaid has come back into one.
 */
async function accountBalances(db, month) {
  const [income, expense] = await db.batch([
    db.prepare("SELECT account, SUM(amount) AS total FROM income WHERE month <= ?1 GROUP BY account").bind(month),
    db.prepare("SELECT method, SUM(amount) AS total FROM expense WHERE month <= ?1 GROUP BY method").bind(month),
  ]);

  const inBy = totalsFrom(income.results, "account");
  const outBy = totalsFrom(expense.results, "method");

  // Loans already moved through these entries, so nothing extra to apply here.
  const balances = {};
  for (const account of ACCOUNTS) balances[account] = inBy[account] ?? 0;
  for (const [method, total] of Object.entries(outBy)) {
    const account = accountForMethod(method);
    if (account) balances[account] -= total;
  }

  return { balances, cardSpend: outBy["Credit Card"] ?? 0 };
}

async function monthTrend(db, month) {
  const months = recentMonths(month, 6);
  const marks = months.map((_, i) => `?${i + 1}`).join(", ");
  const [income, expense, budgets] = await db.batch([
    db.prepare(`SELECT month, SUM(amount) AS total FROM income WHERE month IN (${marks}) GROUP BY month`).bind(...months),
    db.prepare(`SELECT month, SUM(amount) AS total FROM expense WHERE month IN (${marks}) GROUP BY month`).bind(...months),
    db.prepare(`SELECT month, amount FROM budget WHERE month IN (${marks})`).bind(...months),
  ]);

  const incomeMap = totalsFrom(income.results, "month");
  const expenseMap = totalsFrom(expense.results, "month");
  const budgetMap = totalsFrom(budgets.results, "month", "amount");

  return months.map((key) => {
    const incomeTotal = incomeMap[key] ?? 0;
    return {
      month: key,
      label: monthLabel(key),
      income: incomeTotal,
      expense: expenseMap[key] ?? 0,
      budget: budgetMap[key] ?? incomeTotal,
    };
  });
}

/** What the month went on, biggest first — the dashboard draws this as a breakdown. */
async function monthCategories(db, month) {
  const [expense, income] = await db.batch([
    db.prepare("SELECT category, SUM(amount) AS total FROM expense WHERE month = ?1 GROUP BY category ORDER BY total DESC").bind(month),
    db.prepare("SELECT category, SUM(amount) AS total FROM income WHERE month = ?1 GROUP BY category ORDER BY total DESC").bind(month),
  ]);
  const shape = (rows) => rows.map((row) => ({ category: row.category, total: Number(row.total) }));
  return { expense: shape(expense.results), income: shape(income.results) };
}

async function monthEntries(db, month) {
  const [income, expense] = await db.batch([
    db.prepare("SELECT * FROM income WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month),
    db.prepare("SELECT * FROM expense WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month),
  ]);
  return { income: income.results, expenses: expense.results };
}

async function availableMonths(db) {
  const { results } = await db
    .prepare("SELECT month FROM income UNION SELECT month FROM expense ORDER BY month DESC")
    .all();
  const months = new Set(results.map((row) => row.month));
  months.add(monthKey(today()));

  // Always offer the month after the last one, so the carried balance has
  // somewhere to be seen before anything is booked there.
  const latest = [...months].sort().pop();
  months.add(nextMonth(latest));

  return [...months].sort().reverse();
}

// -------------------------------------------------------------------
// LOANS AS ENTRIES
// -------------------------------------------------------------------
// Money moving with a friend is booked as an ordinary entry, so the dashboard
// only ever adds up income and expense:
//
//   lent out          -> expense, paid by the account it left
//   borrowed          -> income, into the account it arrived in
//   a friend repays   -> income, into the account it arrived in
//   you repay a debt  -> expense, paid by the account it left

/** Wipe the entries a loan or repayment created, so they can be written fresh. */
async function clearEntries(db, refs) {
  const marks = refs.map((_, i) => `?${i + 1}`).join(", ");
  await db.batch([
    db.prepare(`DELETE FROM income WHERE loan_ref IN (${marks})`).bind(...refs),
    db.prepare(`DELETE FROM expense WHERE loan_ref IN (${marks})`).bind(...refs),
  ]);
}

async function writeEntry(db, { table, ref, date, amount, account, category, note }) {
  const field = table === "income" ? "account" : "method";
  await db
    .prepare(
      `INSERT INTO ${table} (date, month, amount, ${field}, category, note, loan_ref)` +
        " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(date, monthKey(date), amount, account, category, note, ref)
    .run();
}

/** The entry a loan itself stands for: money out when lent, money in when borrowed. */
async function syncLoanEntry(db, id, loan) {
  const ref = `loan:${id}`;
  await clearEntries(db, [ref]);
  const borrowed = loan.direction === "borrowed";
  await writeEntry(db, {
    table: borrowed ? "income" : "expense",
    ref,
    date: loan.date,
    amount: loan.amount,
    account: loan.paidFrom,
    category: borrowed ? LOAN_CATEGORY.borrowed : LOAN_CATEGORY.lent,
    note: `${borrowed ? "Borrowed from" : "Lent to"} ${loan.friend}${loan.note ? ` · ${loan.note}` : ""}`,
  });
}

/** The entry a repayment stands for: money back in, or a debt paid out. */
async function syncRepaymentEntry(db, id, repayment, loan) {
  const ref = `repayment:${id}`;
  await clearEntries(db, [ref]);
  const borrowed = loan.direction === "borrowed";
  await writeEntry(db, {
    table: borrowed ? "expense" : "income",
    ref,
    date: repayment.date,
    amount: repayment.amount,
    account: repayment.receivedIn,
    category: borrowed ? LOAN_CATEGORY.repaid : LOAN_CATEGORY.returned,
    note: `${borrowed ? "Paid back to" : "Returned by"} ${loan.friend}${repayment.note ? ` · ${repayment.note}` : ""}`,
  });
}

// -------------------------------------------------------------------
// LOAN QUERIES
// -------------------------------------------------------------------
async function listLoans(db) {
  const [loans, repayments] = await db.batch([
    db.prepare("SELECT * FROM loan ORDER BY date DESC, id DESC"),
    db.prepare("SELECT * FROM loan_repayment ORDER BY date ASC, id ASC"),
  ]);

  const byLoan = {};
  for (const row of repayments.results) (byLoan[row.loan_id] ??= []).push(row);

  const rows = loans.results.map((loan) => {
    const paid = byLoan[loan.id] ?? [];
    const repaid = paid.reduce((total, row) => total + Number(row.amount), 0);
    const direction = loan.direction ?? "lent";
    return { ...loan, direction, ...loanStatus(loan.amount, repaid, direction), repayments: paid };
  });

  const tally = (list) =>
    list.reduce(
      (acc, row) => ({
        total: acc.total + row.lent,
        settled: acc.settled + row.repaid,
        outstanding: acc.outstanding + row.outstanding,
        open: acc.open + (row.outstanding > 0 ? 1 : 0),
      }),
      { total: 0, settled: 0, outstanding: 0, open: 0 },
    );

  const lent = rows.filter((row) => row.direction === "lent");
  const borrowed = rows.filter((row) => row.direction === "borrowed");

  return {
    loans: rows,
    lent,
    borrowed,
    totals: {
      lent: tally(lent),
      borrowed: tally(borrowed),
      // What the two sides come to: positive means friends owe you overall.
      net: tally(lent).outstanding - tally(borrowed).outstanding,
    },
    friends: [...new Set(rows.map((row) => row.friend))].sort(),
  };
}

/** What is still owed on a loan, optionally ignoring one repayment being edited. */
async function outstandingFor(db, loanId, ignoreRepaymentId = null) {
  const loan = await db.prepare("SELECT amount, direction, friend FROM loan WHERE id = ?1").bind(loanId).first();
  if (!loan) return null;
  const row = await db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS repaid FROM loan_repayment WHERE loan_id = ?1 AND id IS NOT ?2",
    )
    .bind(loanId, ignoreRepaymentId)
    .first();
  const direction = loan.direction ?? "lent";
  return { ...loanStatus(loan.amount, Number(row?.repaid) || 0, direction), direction, friend: loan.friend };
}

// -------------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------------
async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) return fail("No D1 binding named DB. Check wrangler.jsonc.", 500);

  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method.toUpperCase();

  // GET /api/bootstrap - the choices the forms offer, plus known months.
  if (method === "GET" && path === "bootstrap") {
    return json({
      today: today(),
      currentMonth: monthKey(today()),
      months: await availableMonths(db),
      options: {
        incomeAccounts: INCOME_ACCOUNTS,
        expenseMethods: EXPENSE_METHODS,
        incomeCategories: INCOME_CATEGORIES,
        expenseCategories: EXPENSE_CATEGORIES,
        loanSources: LOAN_SOURCES,
        accounts: ACCOUNTS,
        loanDirections: LOAN_DIRECTIONS,
        loanFlow: Object.fromEntries(LOAN_DIRECTIONS.map((d) => [d, loanFlow(d)])),
      },
    });
  }

  // GET /api/month/2026-09 - everything the dashboard draws.
  if (method === "GET" && path.startsWith("month/")) {
    const month = path.slice("month/".length);
    if (!isMonth(month)) return fail("Month must look like 2026-09.");
    const [summary, trend, entries, accounts, lending, categories] = await Promise.all([
      monthSummary(db, month),
      monthTrend(db, month),
      monthEntries(db, month),
      accountBalances(db, month),
      listLoans(db),
      monthCategories(db, month),
    ]);
    const upcoming = entries.expenses.filter((row) => row.date > today());
    return json({
      summary,
      trend,
      ...entries,
      upcoming,
      categories,
      accounts,
      lending: lending.totals,
      months: await availableMonths(db),
    });
  }

  // POST|PATCH /api/income | /api/expense
  const entryEdit = path.match(/^(income|expense)\/(\d+)$/);
  if ((method === "POST" && (path === "income" || path === "expense")) || (method === "PATCH" && entryEdit)) {
    const table = method === "POST" ? path : entryEdit[1];
    const row = validateEntry(await readJson(request), table);
    const field = table === "income" ? "account" : "method";

    if (method === "POST") {
      const result = await db
        .prepare(
          `INSERT INTO ${table} (date, month, amount, ${field}, category, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .bind(row.date, row.month, row.amount, row[field], row.category, row.note)
        .run();
      return json({ id: result.meta.last_row_id, entry: row, summary: await monthSummary(db, row.month) }, 201);
    }

    const linked = await db.prepare(`SELECT loan_ref FROM ${table} WHERE id = ?1`).bind(Number(entryEdit[2])).first();
    if (linked?.loan_ref) return fail("This entry belongs to a loan. Change it on the Friends page.");

    const result = await db
      .prepare(
        `UPDATE ${table} SET date = ?1, month = ?2, amount = ?3, ${field} = ?4, category = ?5, note = ?6 WHERE id = ?7`,
      )
      .bind(row.date, row.month, row.amount, row[field], row.category, row.note, Number(entryEdit[2]))
      .run();
    if (!result.meta.changes) return fail("That entry no longer exists.", 404);
    return json({ id: Number(entryEdit[2]), entry: row, summary: await monthSummary(db, row.month) });
  }

  // DELETE /api/income/12 | /api/expense/12
  if (method === "DELETE" && entryEdit) {
    const [, table, id] = entryEdit;
    const linked = await db.prepare(`SELECT loan_ref FROM ${table} WHERE id = ?1`).bind(Number(id)).first();
    if (linked?.loan_ref) return fail("This entry belongs to a loan. Change it on the Friends page.");
    const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(Number(id)).run();
    if (!result.meta.changes) return fail("That entry no longer exists.", 404);
    return json({ deleted: Number(id) });
  }

  // PUT /api/budget - set a custom limit, or null to fall back to income.
  if (method === "PUT" && path === "budget") {
    const body = await readJson(request);
    const month = String(body?.month ?? "");
    if (!isMonth(month)) return fail("Month must look like 2026-09.");

    if (body?.amount === null || body?.amount === undefined || body?.amount === "") {
      await db.prepare("DELETE FROM budget WHERE month = ?1").bind(month).run();
    } else {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount < 0) return fail("Budget cannot be negative.");
      await db
        .prepare(
          "INSERT INTO budget (month, amount) VALUES (?1, ?2)" +
            " ON CONFLICT(month) DO UPDATE SET amount = excluded.amount",
        )
        .bind(month, Math.round(amount * 100) / 100)
        .run();
    }
    return json({ summary: await monthSummary(db, month) });
  }

  // ---------------- money lent to friends ----------------
  if (method === "GET" && path === "loans") {
    return json(await listLoans(db));
  }

  if (method === "POST" && path === "loans") {
    const row = validateLoan(await readJson(request));
    const result = await db
      .prepare(
        "INSERT INTO loan (friend, date, month, amount, paid_from, note, direction) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      )
      .bind(row.friend, row.date, row.month, row.amount, row.paidFrom, row.note, row.direction)
      .run();
    await syncLoanEntry(db, result.meta.last_row_id, row);
    return json({ id: result.meta.last_row_id, loan: row, ...(await listLoans(db)) }, 201);
  }

  const loanEdit = path.match(/^loans\/(\d+)$/);
  if (method === "PATCH" && loanEdit) {
    const id = Number(loanEdit[1]);
    const row = validateLoan(await readJson(request));
    const repaid = await db
      .prepare("SELECT COALESCE(SUM(amount), 0) AS repaid FROM loan_repayment WHERE loan_id = ?1")
      .bind(id)
      .first();
    if (row.amount < (Number(repaid?.repaid) || 0)) {
      return fail(`Already repaid ${Number(repaid.repaid).toLocaleString("en-US")}. The loan cannot be less than that.`);
    }
    const result = await db
      .prepare(
        "UPDATE loan SET friend = ?1, date = ?2, month = ?3, amount = ?4, paid_from = ?5, note = ?6, direction = ?7 WHERE id = ?8",
      )
      .bind(row.friend, row.date, row.month, row.amount, row.paidFrom, row.note, row.direction, id)
      .run();
    if (!result.meta.changes) return fail("That loan no longer exists.", 404);
    await syncLoanEntry(db, id, row);
    return json({ id, loan: row, ...(await listLoans(db)) });
  }

  if (method === "DELETE" && loanEdit) {
    const id = Number(loanEdit[1]);
    const { results } = await db.prepare("SELECT id FROM loan_repayment WHERE loan_id = ?1").bind(id).all();
    await clearEntries(db, [`loan:${id}`, ...results.map((row) => `repayment:${row.id}`)]);
    await db.prepare("DELETE FROM loan_repayment WHERE loan_id = ?1").bind(id).run();
    const result = await db.prepare("DELETE FROM loan WHERE id = ?1").bind(id).run();
    if (!result.meta.changes) return fail("That loan no longer exists.", 404);
    return json({ deleted: id, ...(await listLoans(db)) });
  }

  // POST /api/loans/3/repayments - a full or partial return.
  const repayAdd = path.match(/^loans\/(\d+)\/repayments$/);
  if (method === "POST" && repayAdd) {
    const loanId = Number(repayAdd[1]);
    const open = await outstandingFor(db, loanId);
    if (open === null) return fail("That loan no longer exists.", 404);
    if (open.outstanding <= 0) return fail("That loan is already settled.");

    const row = validateRepayment(await readJson(request), open.outstanding, open.direction);
    const result = await db
      .prepare(
        "INSERT INTO loan_repayment (loan_id, date, month, amount, received_in, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      )
      .bind(loanId, row.date, row.month, row.amount, row.receivedIn, row.note)
      .run();
    await syncRepaymentEntry(db, result.meta.last_row_id, row, { ...open, friend: open.friend });
    return json({ id: result.meta.last_row_id, repayment: row, ...(await listLoans(db)) }, 201);
  }

  const repayEdit = path.match(/^repayments\/(\d+)$/);
  if ((method === "PATCH" || method === "DELETE") && repayEdit) {
    const id = Number(repayEdit[1]);
    const existing = await db.prepare("SELECT * FROM loan_repayment WHERE id = ?1").bind(id).first();
    if (!existing) return fail("That repayment no longer exists.", 404);

    if (method === "DELETE") {
      await clearEntries(db, [`repayment:${id}`]);
      await db.prepare("DELETE FROM loan_repayment WHERE id = ?1").bind(id).run();
      return json({ deleted: id, ...(await listLoans(db)) });
    }

    // Editing: measure the outstanding balance without this repayment in it.
    const open = await outstandingFor(db, existing.loan_id, id);
    const row = validateRepayment(await readJson(request), open.outstanding, open.direction);
    await db
      .prepare("UPDATE loan_repayment SET date = ?1, month = ?2, amount = ?3, received_in = ?4, note = ?5 WHERE id = ?6")
      .bind(row.date, row.month, row.amount, row.receivedIn, row.note, id)
      .run();
    await syncRepaymentEntry(db, id, row, open);
    return json({ id, repayment: row, ...(await listLoans(db)) });
  }

  return fail("Unknown endpoint.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) {
      // Anything that is not the API is a static asset.
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      const message = error?.message ?? "Something went wrong.";
      const known = /must be|cannot be|no longer|JSON|outstanding|name/i.test(message);
      return fail(message, known ? 400 : 500);
    }
  },
};
