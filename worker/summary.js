// Month roll-up rules for the income vs expense tracker.
// Pure functions: no D1, no Worker globals, so they can be unit tested directly.

export const INCOME_ACCOUNTS = ["Cash in Hand", "Bank"];
export const EXPENSE_METHODS = ["Cash", "Bank", "Credit Card"];

// Money you pay out comes from one of these.
export const LOAN_SOURCES = ["Cash", "Bank", "Credit Card"];

// Money you receive lands in one of these. Only real accounts hold a balance.
export const ACCOUNTS = ["Cash in Hand", "Bank"];

// 'lent' — you gave money to a friend and it comes back.
// 'borrowed' — you took money from someone and you pay it back.
export const LOAN_DIRECTIONS = ["lent", "borrowed"];

/** The choices for the money moving at each end of a loan. */
export function loanFlow(direction) {
  return direction === "borrowed"
    ? { openLabel: "Received in", openValues: ACCOUNTS, backLabel: "Repaid from", backValues: LOAN_SOURCES }
    : { openLabel: "Paid from", openValues: LOAN_SOURCES, backLabel: "Received in", backValues: ACCOUNTS };
}

// Categories the app writes itself when money moves with a friend.
export const LOAN_CATEGORY = {
  lent: "Lent out",
  borrowed: "Borrowed",
  returned: "Loan returned",
  repaid: "Loan repaid",
};

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

/** Shift a month key by whole months: addMonths("2026-12", 1) -> "2027-01". */
export function addMonths(key, count) {
  const [year, month] = String(key).split("-").map(Number);
  const total = year * 12 + (month - 1) + count;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `start` to `end` inclusive, oldest first. */
export function monthsFrom(start, end) {
  const months = [];
  for (let key = start; key <= end; key = addMonths(key, 1)) {
    months.push(key);
    if (months.length > 240) break;
  }
  return months;
}

/**
 * The date a rule falls due in a month, with the day pulled back to the last of
 * the month when it does not exist — the 31st in September is the 30th.
 */
export function dueDate(month, day) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(day), lastDay)).padStart(2, "0")}`;
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

/** The account an expense method draws on. Credit Card is a liability, not an account. */
export function accountForMethod(method) {
  if (method === "Cash") return "Cash in Hand";
  if (method === "Bank") return "Bank";
  return null;
}

/** Reject anything that would put junk in the loan table. Returns a clean row. */
export function validateLoan(body) {
  const direction = String(body?.direction ?? "lent").trim();
  if (!LOAN_DIRECTIONS.includes(direction)) throw new Error("Direction must be lent or borrowed.");

  const friend = String(body?.friend ?? "").trim();
  if (!friend) throw new Error("Whose loan is this? Add a name.");

  const date = String(body?.date ?? "").trim();
  if (!isIsoDate(date)) throw new Error("Date must be a real date in YYYY-MM-DD format.");

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const { openLabel, openValues } = loanFlow(direction);
  const paidFrom = String(body?.paidFrom ?? "").trim();
  if (!openValues.includes(paidFrom)) {
    throw new Error(`${openLabel} must be one of ${openValues.join(", ")}.`);
  }

  return {
    direction,
    friend: friend.slice(0, 60),
    date,
    month: monthKey(date),
    amount: Math.round(amount * 100) / 100,
    paidFrom,
    note: String(body?.note ?? "").trim().slice(0, 200),
  };
}

/**
 * Validate one repayment against what is still owed.
 * `outstanding` is the balance before this repayment (excluding the row being edited).
 */
export function validateRepayment(body, outstanding, direction = "lent") {
  const date = String(body?.date ?? "").trim();
  if (!isIsoDate(date)) throw new Error("Date must be a real date in YYYY-MM-DD format.");

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const rounded = Math.round(amount * 100) / 100;
  if (rounded > Math.round(outstanding * 100) / 100 + 0.001) {
    throw new Error(`That is more than the ${outstanding.toLocaleString("en-US")} still outstanding.`);
  }

  const { backLabel, backValues } = loanFlow(direction);
  const receivedIn = String(body?.receivedIn ?? "").trim();
  if (!backValues.includes(receivedIn)) {
    throw new Error(`${backLabel} must be one of ${backValues.join(", ")}.`);
  }

  return {
    date,
    month: monthKey(date),
    amount: rounded,
    receivedIn,
    note: String(body?.note ?? "").trim().slice(0, 200),
  };
}

/** Reject anything that would put junk in the recurring table. Returns a clean rule. */
export function validateRecurring(body) {
  const kind = String(body?.kind ?? "").trim();
  if (kind !== "income" && kind !== "expense") throw new Error("Kind must be income or expense.");

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const isIncome = kind === "income";
  const allowed = isIncome ? INCOME_ACCOUNTS : EXPENSE_METHODS;
  const account = String(body?.account ?? "").trim();
  if (!allowed.includes(account)) {
    throw new Error(`${isIncome ? "Account" : "Payment method"} must be one of ${allowed.join(", ")}.`);
  }

  const day = Number(body?.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Day must be between 1 and 31.");

  const startMonth = String(body?.startMonth ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new Error("Starting month must look like 2026-09.");

  const endMonth = String(body?.endMonth ?? "").trim();
  if (endMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)) {
    throw new Error("Ending month must look like 2026-09.");
  }
  if (endMonth && endMonth < startMonth) throw new Error("The ending month cannot be before the start.");

  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  let category = String(body?.category ?? "").trim() || "Other";
  if (!categories.includes(category)) category = "Other";

  return {
    kind,
    amount: Math.round(amount * 100) / 100,
    account,
    category,
    day,
    startMonth,
    endMonth: endMonth || null,
    note: String(body?.note ?? "").trim().slice(0, 200),
    active: body?.active === undefined ? 1 : Number(Boolean(body.active)),
  };
}

/** Outstanding amount and label for one loan. */
export function loanStatus(amount, repaid, direction = "lent") {
  const lent = Number(amount) || 0;
  const back = Math.round((Number(repaid) || 0) * 100) / 100;
  const outstanding = Math.round((lent - back) * 100) / 100;
  let status = direction === "borrowed" ? "Not paid back" : "Not repaid";
  if (outstanding <= 0) status = "Settled";
  else if (back > 0) status = direction === "borrowed" ? "Partly paid back" : "Partly repaid";
  return {
    lent,
    repaid: back,
    outstanding: Math.max(0, outstanding),
    status,
    repaidPct: lent > 0 ? Math.min(100, (back / lent) * 100) : 0,
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
  carriedForward = 0,
}) {
  const incomeTotal = sum(incomeByAccount);
  const expenseTotal = sum(expenseByMethod);

  // What last month left behind, and what this month has to work with.
  const opening = Math.round((Number(carriedForward) || 0) * 100) / 100;

  // Lending and borrowing are booked as ordinary expense and income entries, so
  // they are already inside these totals.
  const available = opening + incomeTotal;
  const balance = available - expenseTotal;

  const budgetIsCustom = customBudget !== null && customBudget !== undefined;
  const budget = budgetIsCustom ? Number(customBudget) : available;

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
    balance,
    carriedForward: opening,
    available,
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
