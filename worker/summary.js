// Month roll-up rules for the income vs expense tracker.
// Pure functions: no D1, no Worker globals, so they can be unit tested directly.

export const INCOME_ACCOUNTS = ["Cash in Hand", "Bank"];
export const EXPENSE_METHODS = ["Cash", "Bank", "Credit Card"];

export const INCOME_CATEGORIES = [
  "Salary",
  "Business",
  "Freelance",
  "Interest",
  "Rent",
  "Gift",
  "Other",
];

export const EXPENSE_CATEGORIES = [
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
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-09-04" -> "2026-09" */
export function monthKey(value) {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return iso.slice(0, 7);
}

/** "2026-09" -> "Sep 2026" */
export function monthLabel(key) {
  const [year, month] = String(key).split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** Shift a month key by whole months: addMonths("2026-12", 1) -> "2027-01". */
export function addMonths(key, count) {
  const [year, month] = String(key).split("-").map(Number);
  const total = year * 12 + (month - 1) + count;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Today in UTC as YYYY-MM-DD. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Reject anything that would put junk in the database. Returns a clean row. */
export function validateEntry(body, kind) {
  const isIncome = kind === "income";
  const field = isIncome ? "account" : "method";
  const allowed = isIncome ? INCOME_ACCOUNTS : EXPENSE_METHODS;
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const date = String(body?.date ?? "").trim();
  if (!isIsoDate(date)) throw new Error("Date must be a real date in YYYY-MM-DD format.");

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const choice = String(body?.[field] ?? "").trim();
  if (!allowed.includes(choice)) {
    throw new Error(`${isIncome ? "Account" : "Payment method"} must be one of ${allowed.join(", ")}.`);
  }

  let category = String(body?.category ?? "").trim() || "Other";
  if (!categories.includes(category)) category = "Other";

  return {
    date,
    month: monthKey(date),
    amount: Math.round(amount * 100) / 100,
    [field]: choice,
    category,
    friend: String(body?.friend ?? "").trim().slice(0, 60),
    note: String(body?.note ?? "").trim().slice(0, 200),
  };
}

/**
 * Money tagged with a name, netted per friend: what went out to them against
 * what came back. A positive net means they still have some of yours.
 */
export function friendTotals(outRows = [], backRows = []) {
  const names = new Map();
  const add = (rows, key) => {
    for (const row of rows) {
      const friend = String(row.friend ?? "").trim();
      if (!friend) continue;
      const entry = names.get(friend) ?? { friend, out: 0, back: 0 };
      entry[key] += Number(row.total ?? row.amount) || 0;
      names.set(friend, entry);
    }
  };
  add(outRows, "out");
  add(backRows, "back");

  return [...names.values()]
    .map((entry) => ({ ...entry, net: Math.round((entry.out - entry.back) * 100) / 100 }))
    .sort((a, b) => b.net - a.net || a.friend.localeCompare(b.friend));
}

/**
 * One month, and the only question it has to answer: how much is left?
 *
 *   carried forward + income - expense = balance   ->   opens the next month
 *
 * Spending more than there was to spend reads as OUT OF BUDGET.
 */
export function summarize({ month, incomeTotal = 0, expenseTotal = 0, carriedForward = 0 }) {
  const income = Math.round((Number(incomeTotal) || 0) * 100) / 100;
  const expense = Math.round((Number(expenseTotal) || 0) * 100) / 100;
  const opening = Math.round((Number(carriedForward) || 0) * 100) / 100;

  const available = opening + income;
  const balance = available - expense;
  const hasEntries = income > 0 || expense > 0;
  const isOverBudget = hasEntries && balance < 0;

  let status = "NO ENTRIES";
  let statusMessage = "Nothing recorded for this month yet";
  if (hasEntries && isOverBudget) {
    status = "OUT OF BUDGET";
    statusMessage = `Out of budget by ${format(-balance)}`;
  } else if (hasEntries) {
    status = "IN CONTROL";
    statusMessage = `In control, ${format(balance)} left`;
  }

  let usedPct = 0;
  if (available > 0) usedPct = (expense / available) * 100;
  else if (expense > 0) usedPct = 100;

  return {
    month,
    label: monthLabel(month),
    carriedForward: opening,
    incomeTotal: income,
    expenseTotal: expense,
    available,
    balance,
    hasEntries,
    isOverBudget,
    status,
    statusMessage,
    usedPct,
  };
}

function format(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
