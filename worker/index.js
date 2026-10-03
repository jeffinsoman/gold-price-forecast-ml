// Income vs Expense Tracker - Cloudflare Worker API.
// Static pages come from the assets binding; everything under /api is handled here.

import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_ACCOUNTS,
  INCOME_CATEGORIES,
  BILL_METHODS,
  INCOME_ACCOUNTS as ACCOUNTS,
  accountBalances,
  addMonths,
  friendTotals,
  lines,
  monthKey,
  summarize,
  today,
  isSettled,
  validateBillPayment,
  validateEntry,
  validateOpening,
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
    for (const [table, column] of [
      ["expense", "paid"],
      ["income", "received"],
    ]) {
      try {
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`).run();
      } catch {
        // Already there.
      }
    }
    try {
      await db.prepare("ALTER TABLE card_payment ADD COLUMN method TEXT NOT NULL DEFAULT 'Credit Card'").run();
    } catch {
      // Already there.
    }
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      db.prepare(
        "CREATE TABLE IF NOT EXISTS card_payment (id INTEGER PRIMARY KEY AUTOINCREMENT," +
          " date TEXT NOT NULL, month TEXT NOT NULL, amount REAL NOT NULL CHECK (amount > 0)," +
          " note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
      ),
    ]);
  })();
  return schemaReady;
}

/** What each account held before the first entry was ever written. */
async function openingBalances(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'opening:%'").all();
  const opening = Object.fromEntries(ACCOUNTS.map((account) => [account, 0]));
  for (const row of results) {
    const account = row.key.slice("opening:".length);
    if (account in opening) opening[account] = Number(row.value) || 0;
  }
  return opening;
}

// -------------------------------------------------------------------
// QUERIES
// -------------------------------------------------------------------
/** What sits in each account at the end of `month`, counting from the beginning. */
async function held(db, month) {
  const [income, expense, card] = await db.batch([
    db
      .prepare("SELECT account, SUM(amount) AS total FROM income WHERE month <= ?1 AND received = 1 GROUP BY account")
      .bind(month),
    db
      .prepare("SELECT method, SUM(amount) AS total FROM expense WHERE month <= ?1 AND paid = 1 GROUP BY method")
      .bind(month),
    db
      .prepare("SELECT method, SUM(amount) AS paid FROM card_payment WHERE month <= ?1 GROUP BY method")
      .bind(month),
  ]);

  const billsPaid = {};
  for (const row of card.results) billsPaid[row.method ?? "Credit Card"] = Number(row.paid) || 0;

  const opening = await openingBalances(db);
  return {
    ...accountBalances({
      incomeRows: income.results,
      expenseRows: expense.results,
      opening,
      billsPaid,
    }),
    opening,
  };
}

/** What is still owed on each bill, across every month. */
async function billsPending(db) {
  const [charged, paid] = await db.batch([
    db
      .prepare("SELECT method, SUM(amount) AS total FROM expense WHERE paid = 1 AND method IN (?1, ?2) GROUP BY method")
      .bind(...BILL_METHODS),
    db.prepare("SELECT method, SUM(amount) AS total FROM card_payment GROUP BY method"),
  ]);

  const owed = Object.fromEntries(BILL_METHODS.map((method) => [method, 0]));
  for (const row of charged.results) owed[row.method] += Number(row.total) || 0;
  for (const row of paid.results) {
    const method = row.method ?? "Credit Card";
    if (method in owed) owed[method] -= Number(row.total) || 0;
  }
  for (const method of BILL_METHODS) owed[method] = Math.round(owed[method] * 100) / 100;
  return owed;
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
  const [income, expense, accounts, withFriends, payments, pending] = await Promise.all([
    db.prepare("SELECT * FROM income WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month).all(),
    db.prepare("SELECT * FROM expense WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month).all(),
    held(db, month),
    friends(db),
    db.prepare("SELECT * FROM card_payment WHERE month = ?1 ORDER BY date DESC, id DESC").bind(month).all(),
    billsPending(db),
  ]);

  const total = (rows) => rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const unpaid = expense.results.filter((row) => !row.paid);
  const awaited = income.results.filter((row) => !row.received);

  return {
    summary: summarize({
      month,
      incomeTotal: total(income.results),
      incomePending: total(awaited),
      expenseTotal: total(expense.results),
      expensePending: total(unpaid),
    }),
    income: income.results,
    expenses: expense.results,
    incomeLines: lines(income.results),
    expenseLines: lines(expense.results),
    toPay: unpaid,
    toCome: awaited,
    accounts: {
      ...accounts,
      bills: accounts.bills.map((bill) => ({ ...bill, pendingAllTime: pending[bill.method] ?? 0 })),
    },
    billPayments: payments.results,
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
          table === "income"
            ? "INSERT INTO income (date, month, amount, account, category, friend, note, received)" +
                " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
            : "INSERT INTO expense (date, month, amount, method, category, friend, note, paid)" +
                " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(
          ...[row.date, row.month, row.amount, row[field], row.category, row.friend, row.note],
          table === "income" ? row.received : row.paid,
        )
        .run();
      return json({ id: result.meta.last_row_id, entry: row, ...(await monthData(db, row.month)) }, 201);
    }

    const result = await db
      .prepare(
        table === "income"
          ? "UPDATE income SET date = ?1, month = ?2, amount = ?3, account = ?4, category = ?5," +
              " friend = ?6, note = ?7, received = ?9 WHERE id = ?8"
          : "UPDATE expense SET date = ?1, month = ?2, amount = ?3, method = ?4, category = ?5," +
              " friend = ?6, note = ?7, paid = ?9 WHERE id = ?8",
      )
      .bind(
        ...[row.date, row.month, row.amount, row[field], row.category, row.friend, row.note, Number(entry[2])],
        table === "income" ? row.received : row.paid,
      )
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

  // GET|PUT /api/opening - what each account held before the tracker started.
  if (method === "GET" && path === "opening") {
    return json({ opening: await openingBalances(db) });
  }

  if (method === "PUT" && path === "opening") {
    const opening = validateOpening(await readJson(request));
    await db.batch(
      Object.entries(opening).map(([account, amount]) =>
        db
          .prepare(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)" +
              " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          )
          .bind(`opening:${account}`, String(amount)),
      ),
    );
    return json({ opening, ...(await monthData(db, monthKey(today()))) });
  }

  // POST /api/bill-payments - settle some of a card or Tabby bill from the bank.
  if (method === "POST" && path === "bill-payments") {
    const body = await readJson(request);
    const owed = await billsPending(db);
    const which = String(body?.method ?? BILL_METHODS[0]);
    if (!(owed[which] > 0)) return fail(`Nothing is pending on ${which}.`);

    const row = validateBillPayment(body, owed[which]);
    const result = await db
      .prepare("INSERT INTO card_payment (date, month, amount, note, method) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(row.date, row.month, row.amount, row.note, row.method)
      .run();
    return json({ id: result.meta.last_row_id, payment: row, ...(await monthData(db, row.month)) }, 201);
  }

  const payment = path.match(/^bill-payments\/(\d+)$/);
  if (method === "DELETE" && payment) {
    const result = await db.prepare("DELETE FROM card_payment WHERE id = ?1").bind(Number(payment[1])).run();
    if (!result.meta.changes) return fail("That payment no longer exists.", 404);
    return json({ deleted: Number(payment[1]) });
  }

  // PATCH /api/expense/12/paid - settle an expected payment, or put it back.
  // PATCH /api/income/12/received - mark money as arrived, or back to expected.
  const settle = path.match(/^(income|expense)\/(\d+)\/(received|paid)$/);
  if (method === "PATCH" && settle) {
    const [, table, id, column] = settle;
    if ((table === "income") !== (column === "received")) return fail("Unknown endpoint.", 404);

    const body = await readJson(request);
    const value = isSettled(body?.[column]);
    const result = await db
      .prepare(`UPDATE ${table} SET ${column} = ?1 WHERE id = ?2`)
      .bind(value, Number(id))
      .run();
    if (!result.meta.changes) return fail("That entry no longer exists.", 404);

    const row = await db.prepare(`SELECT month FROM ${table} WHERE id = ?1`).bind(Number(id)).first();
    return json({ id: Number(id), [column]: Boolean(value), ...(await monthData(db, row.month)) });
  }

  // POST /api/reset - empties the tracker. Needs the word RESET to go through.
  if (method === "POST" && path === "reset") {
    const body = await readJson(request);
    if (String(body?.confirm ?? "").trim().toUpperCase() !== "RESET") {
      return fail('Send { "confirm": "RESET" } to clear everything.');
    }

    // Tables from older versions of the app may or may not be there.
    let cleared = 0;
    for (const table of [
      "income",
      "expense",
      "card_payment",
      "settings",
      "budget",
      "loan_repayment",
      "loan",
      "recurring_run",
      "recurring",
    ]) {
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
      const known = /must be|cannot be|no longer|JSON|pending|number/i.test(message);
      return fail(message, known ? 400 : 500);
    }
  },
};
