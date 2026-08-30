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

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

/** Today in UTC as YYYY-MM-DD. */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** The `count` months ending at `key`, oldest first. */
export function recentMonths(key, count = 6) {
  let [year, month] = String(key).split("-").map(Number);
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return keys.reverse();
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
    note: String(body?.note ?? "").trim().slice(0, 200),
  };
}

function sum(values) {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

/**
 * Turn one month's raw totals into the numbers and the verdict the dashboard shows.
 *
 * The budget is the month's own income unless a custom budget was set, so
 * spending more than you earned in the month reads as OUT OF BUDGET.
 */
export function summarize({
  month,
  incomeByAccount = {},
  expenseByMethod = {},
  expensePaid = 0,
  expenseUpcoming = 0,
  customBudget = null,
}) {
  const incomeTotal = sum(incomeByAccount);
  const expenseTotal = sum(expenseByMethod);
  const budgetIsCustom = customBudget !== null && customBudget !== undefined;
  const budget = budgetIsCustom ? Number(customBudget) : incomeTotal;

  const hasEntries = incomeTotal > 0 || expenseTotal > 0;
  const isOverBudget = hasEntries && expenseTotal > budget;
  const remaining = budget - expenseTotal;
  const overBy = Math.max(0, -remaining);

  let status = "NO ENTRIES";
  let statusMessage = "Nothing recorded for this month yet";
  if (hasEntries && isOverBudget) {
    status = "OUT OF BUDGET";
    statusMessage = `Out of budget by ${format(overBy)}`;
  } else if (hasEntries) {
    status = "IN CONTROL";
    statusMessage = `In control, ${format(remaining)} left`;
  }

  let budgetUsedPct = 0;
  if (budget > 0) budgetUsedPct = (expenseTotal / budget) * 100;
  else if (expenseTotal > 0) budgetUsedPct = 100;

  return {
    month,
    label: monthLabel(month),
    incomeTotal,
    expenseTotal,
    expensePaid: Number(expensePaid) || 0,
    expenseUpcoming: Number(expenseUpcoming) || 0,
    balance: incomeTotal - expenseTotal,
    budget,
    budgetIsCustom,
    budgetUsedPct,
    remaining,
    overBy,
    hasEntries,
    isOverBudget,
    status,
    statusMessage,
    incomeByAccount,
    expenseByMethod,
  };
}

function format(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
