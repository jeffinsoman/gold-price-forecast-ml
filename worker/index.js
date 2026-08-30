// Income vs Expense Tracker - Cloudflare Worker API.
// Static pages come from the assets binding; everything under /api is handled here.

import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_ACCOUNTS,
  INCOME_CATEGORIES,
  monthKey,
  monthLabel,
  recentMonths,
  summarize,
  today,
  validateEntry,
} from "./summary.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(message, status = 400) {
  return json({ error: message }, status);
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

// -------------------------------------------------------------------
// QUERIES
// -------------------------------------------------------------------
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

  const incomeByAccount = {};
  for (const row of income.results) incomeByAccount[row.account] = Number(row.total);

  const expenseByMethod = {};
  for (const row of expense.results) expenseByMethod[row.method] = Number(row.total);

  const totals = split.results[0] ?? { paid: 0, upcoming: 0 };
  const custom = budget.results[0];

  return summarize({
    month,
    incomeByAccount,
    expenseByMethod,
    expensePaid: Number(totals.paid),
    expenseUpcoming: Number(totals.upcoming),
    customBudget: custom ? Number(custom.amount) : null,
  });
}

async function monthTrend(db, month) {
  const months = recentMonths(month, 6);
  const marks = months.map((_, i) => `?${i + 1}`).join(", ");
  const [income, expense, budgets] = await db.batch([
    db.prepare(`SELECT month, SUM(amount) AS total FROM income WHERE month IN (${marks}) GROUP BY month`).bind(...months),
    db.prepare(`SELECT month, SUM(amount) AS total FROM expense WHERE month IN (${marks}) GROUP BY month`).bind(...months),
    db.prepare(`SELECT month, amount FROM budget WHERE month IN (${marks})`).bind(...months),
  ]);

  const byMonth = (rows, field) => {
    const map = {};
    for (const row of rows) map[row.month] = Number(row[field]);
    return map;
  };
  const incomeMap = byMonth(income.results, "total");
  const expenseMap = byMonth(expense.results, "total");
  const budgetMap = byMonth(budgets.results, "amount");

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
  const months = results.map((row) => row.month);
  const current = monthKey(today());
  if (!months.includes(current)) months.push(current);
  return months.sort().reverse();
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
      },
    });
  }

  // GET /api/month/2026-09 - everything the dashboard draws.
  if (method === "GET" && path.startsWith("month/")) {
    const month = path.slice("month/".length);
    if (!isMonth(month)) return fail("Month must look like 2026-09.");
    const [summary, trend, entries] = await Promise.all([
      monthSummary(db, month),
      monthTrend(db, month),
      monthEntries(db, month),
    ]);
    const upcoming = entries.expenses.filter((row) => row.date > today());
    return json({ summary, trend, ...entries, upcoming, months: await availableMonths(db) });
  }

  // POST /api/income | /api/expense
  if (method === "POST" && (path === "income" || path === "expense")) {
    const body = await readJson(request);
    const row = validateEntry(body, path);
    const statement =
      path === "income"
        ? db
            .prepare(
              "INSERT INTO income (date, month, amount, account, category, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(row.date, row.month, row.amount, row.account, row.category, row.note)
        : db
            .prepare(
              "INSERT INTO expense (date, month, amount, method, category, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(row.date, row.month, row.amount, row.method, row.category, row.note);

    const result = await statement.run();
    return json(
      { id: result.meta.last_row_id, entry: row, summary: await monthSummary(db, row.month) },
      201,
    );
  }

  // DELETE /api/income/12 | /api/expense/12
  const remove = path.match(/^(income|expense)\/(\d+)$/);
  if (method === "DELETE" && remove) {
    const [, table, id] = remove;
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

  return fail("Unknown endpoint.", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) {
      // Anything that is not the API is a static asset.
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    }
    try {
      return await handleApi(request, env, url);
    } catch (error) {
      const message = error?.message ?? "Something went wrong.";
      const known = /must be|cannot be|no longer|JSON/i.test(message);
      return fail(message, known ? 400 : 500);
    }
  },
};
