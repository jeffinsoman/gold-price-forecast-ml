// Income vs Expense Tracker - Cloudflare Worker API.
// Static pages come from the assets binding; everything under /api is handled here.

import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_ACCOUNTS,
  INCOME_CATEGORIES,
  accountBalances,
  addMonths,
  friendTotals,
  lines,
  monthKey,
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
// SCHEMA
// -------------------------------------------------------------------
// Deploys do not run migrations, so a column the code needs is added here on
// first use. Adding one that already exists throws, which is the signal to stop.
let schemaReady = null;

function ensureSchema(db) {
  schemaReady ??= (async () => {
    for (const table of ["income", "expense"]) {
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN friend TEXT NOT NULL DEFAULT ''`).run();
      } catch {
        // Already there.
      }
    }
  })();
  return schemaReady;
}

// -------------------------------------------------------------------
// QUERIES
// -------------------------------------------------------------------
/** What sits in each account at the end of `month`, counting from the beginning. */
async function held(db, month) {
  const [income, expense] = await db.batch([
    db.prepare("SELECT account, SUM(amount) AS total FROM income WHERE month <= ?1 GROUP BY account").bind(month),
    db.prepare("SELECT method, SUM(amount) AS total FROM expense WHERE month <= ?1 GROUP BY method").bind(month),
  ]);
  return accountBalances(income.results, expense.results);
}

/** Everything tagged with a name, netted per friend, across every month. */
async function friends(db) {
  const [out, back] = await db.batch([
    db.prepare("SELECT friend, SUM(amount) AS total FROM expense WHERE friend <> '' GROUP BY friend"),
    db.prepare("SELECT friend, SUM(amount) AS total FROM income WHERE friend <> '' GROUP BY friend"),
  ]);
  return friendTotals(out.results, back.results);
}

async function monthData(db, month) {
  const [income, expense, accounts, withFriends] = await Promise.all([
    db.prepare("SELECT * FROM income WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month).all(),
    db.prepare("SELECT * FROM expense WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month).all(),
    held(db, month),
    friends(db),
  ]);

  const total = (rows) => rows.reduce((sum, row) => sum + Number(row.amount), 0);

  return {
    summary: summarize({
      month,
      incomeTotal: total(income.results),
      expenseTotal: total(expense.results),
    }),
    income: income.results,
    expenses: expense.results,
    incomeLines: lines(income.results),
    expenseLines: lines(expense.results),
    accounts,
    friends: withFriends,
  };
}

/** Months that hold anything, plus this month and the next one. */
async function availableMonths(db) {
  const { results } = await db
    .prepare("SELECT month FROM income UNION SELECT month FROM expense ORDER BY month DESC")
    .all();
  const months = new Set(results.map((row) => row.month));
  const current = monthKey(today());
  months.add(current);
  months.add(addMonths([...months].sort().pop() ?? current, 1));
  return [...months].sort().reverse();
}

// -------------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------------
async function handleApi(request, env, url) {
  const db = env.DB;
  if (!db) return fail("No D1 binding named DB. Check wrangler.jsonc.", 500);
  await ensureSchema(db);

  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = request.method.toUpperCase();

  // GET /api/bootstrap - the choices the forms offer, plus known months.
  if (method === "GET" && path === "bootstrap") {
    return json({
      today: today(),
      currentMonth: monthKey(today()),
      months: await availableMonths(db),
      friends: (await friends(db)).map((row) => row.friend),
      options: {
        incomeAccounts: INCOME_ACCOUNTS,
        expenseMethods: EXPENSE_METHODS,
        incomeCategories: INCOME_CATEGORIES,
        expenseCategories: EXPENSE_CATEGORIES,
      },
    });
  }

  // GET /api/month/2026-10 - the whole month in one answer.
  if (method === "GET" && path.startsWith("month/")) {
    const month = path.slice("month/".length);
    if (!isMonth(month)) return fail("Month must look like 2026-10.");
    return json({ ...(await monthData(db, month)), months: await availableMonths(db) });
  }

  // POST|PATCH /api/income | /api/expense
  const entry = path.match(/^(income|expense)\/(\d+)$/);
  if ((method === "POST" && (path === "income" || path === "expense")) || (method === "PATCH" && entry)) {
    const table = method === "POST" ? path : entry[1];
    const row = validateEntry(await readJson(request), table);
    const field = table === "income" ? "account" : "method";

    if (method === "POST") {
      const result = await db
        .prepare(
          `INSERT INTO ${table} (date, month, amount, ${field}, category, friend, note)` +
            " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(row.date, row.month, row.amount, row[field], row.category, row.friend, row.note)
        .run();
      return json({ id: result.meta.last_row_id, entry: row, ...(await monthData(db, row.month)) }, 201);
    }

    const result = await db
      .prepare(
        `UPDATE ${table} SET date = ?1, month = ?2, amount = ?3, ${field} = ?4, category = ?5,` +
          " friend = ?6, note = ?7 WHERE id = ?8",
      )
      .bind(row.date, row.month, row.amount, row[field], row.category, row.friend, row.note, Number(entry[2]))
      .run();
    if (!result.meta.changes) return fail("That entry no longer exists.", 404);
    return json({ id: Number(entry[2]), entry: row, ...(await monthData(db, row.month)) });
  }

  // DELETE /api/income/12 | /api/expense/12
  if (method === "DELETE" && entry) {
    const [, table, id] = entry;
    const result = await db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(Number(id)).run();
    if (!result.meta.changes) return fail("That entry no longer exists.", 404);
    return json({ deleted: Number(id) });
  }

  // POST /api/reset - empties the tracker. Needs the word RESET to go through.
  if (method === "POST" && path === "reset") {
    const body = await readJson(request);
    if (String(body?.confirm ?? "").trim().toUpperCase() !== "RESET") {
      return fail('Send { "confirm": "RESET" } to clear everything.');
    }

    // Tables from older versions of the app may or may not be there.
    let cleared = 0;
    for (const table of ["income", "expense", "budget", "loan_repayment", "loan", "recurring_run", "recurring"]) {
      try {
        const result = await db.prepare(`DELETE FROM ${table}`).run();
        cleared += result.meta.changes ?? 0;
      } catch {
        // No such table in this database: nothing to clear.
      }
    }
    return json({ cleared });
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
      const known = /must be|cannot be|no longer|JSON/i.test(message);
      return fail(message, known ? 400 : 500);
    }
  },
};
