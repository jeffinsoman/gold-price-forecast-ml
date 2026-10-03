// Month roll-up rules for the income vs expense tracker.
// Pure functions: no D1, no Worker globals, so they can be unit tested directly.

export const INCOME_ACCOUNTS = ["Cash in Hand", "Bank"];
export const EXPENSE_METHODS = ["Cash", "Bank", "Credit Card"];

// Paying by credit does not move money now: the spend goes on one of these
// cards, builds up as that card's bill, and the bill is settled from the bank.
export const CARDS = ["Mashreq", "ADCB", "CBD", "DIB", "Tabby"];

// Credit spends recorded before the cards had names sit under this label, so
// their bill can still be seen and paid off.
export const LEGACY_CARD = "Credit Card";

/** The bill a credit expense belongs to - its card, or the unnamed old one. */
export function cardName(value) {
  return String(value ?? "").trim() || LEGACY_CARD;
}

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
  "ADCB Loan",
  "CBD EMI",
  "Mashreq EMI",
  "ADCB EMI",
  "DIB EMI",
  "Home pay",
  "Friend",
  "Food",
  "ADCB Outstanding",
  "CBD Outstanding",
  "Mashreq Outstanding",
  "Entertainment",
  "Other",
  "Active EMI ADCB",
  "Active EMI CBD",
  "Active EMI Mashreq",
  "Active EMI DIB",
  "Tabby",
  "Bank Loan",
];

// Money already owed somewhere, paid down month by month: a total outstanding
// and an instalment. Every plan payment is an ordinary expense carrying the
// name of the plan it pays off.
export const PLANS = ["Mashreq", "ADCB", "CBD", "DIB", "Tabby", "Bank Loan"];

// The category a plan's payments are filed under, so the month's lines read
// the way the rest of the tracker does.
export const PLAN_CATEGORY = {
  Mashreq: "Mashreq EMI",
  ADCB: "ADCB EMI",
  CBD: "CBD EMI",
  DIB: "DIB EMI",
  Tabby: "Tabby",
  "Bank Loan": "Bank Loan",
};

// Categories used before the list above. Entries already filed under them keep
// their category when edited, even though the pickers no longer offer them.
const RETIRED_CATEGORIES = [
  "Groceries",
  "Rent",
  "Bills",
  "Transport",
  "Shopping",
  "Health",
  "Education",
  "EMI",
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
  if (!categories.includes(category) && !(!isIncome && RETIRED_CATEGORIES.includes(category))) {
    category = "Other";
  }

  // A credit spend says which card it went on; nothing else carries one.
  let card = "";
  if (!isIncome && choice === "Credit Card") {
    card = String(body?.card ?? "").trim();
    if (!CARDS.includes(card)) throw new Error(`Credit must be one of ${CARDS.join(", ")}.`);
  }

  const row = {
    date,
    month: monthKey(date),
    amount: Math.round(amount * 100) / 100,
    [field]: choice,
    ...(isIncome ? {} : { card, plan: planName(body?.plan) }),
    category,
    friend: String(body?.friend ?? "").trim().slice(0, 60),
    note: String(body?.note ?? "").trim().slice(0, 200),
  };

  // Money can be settled - already received, already paid - or still on its
  // way. Only settled money moves an account balance.
  if (isIncome) row.received = isSettled(body?.received);
  else row.paid = isSettled(body?.paid);
  return row;
}

/**
 * Has the money actually moved? Anything but an explicit no counts as settled,
 * so entries written before this existed stay as they were.
 */
export function isSettled(value) {
  if (value === undefined || value === null || value === "") return 1;
  if (typeof value === "string") {
    return ["0", "false", "no", "pending", "unpaid", "expected"].includes(value.toLowerCase()) ? 0 : 1;
  }
  return value ? 1 : 0;
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
 * One month on its own terms:
 *
 *   income - expense = balance
 *
 * Each month starts fresh; nothing is carried in from the one before.
 * Spending more than came in reads as OUT OF BUDGET.
 */
export function summarize({
  month,
  incomeTotal = 0,
  expenseTotal = 0,
  expensePending = 0,
  incomePending = 0,
}) {
  const income = Math.round((Number(incomeTotal) || 0) * 100) / 100;
  const expense = Math.round((Number(expenseTotal) || 0) * 100) / 100;
  const pending = Math.round((Number(expensePending) || 0) * 100) / 100;
  const awaited = Math.round((Number(incomePending) || 0) * 100) / 100;
  const balance = income - expense;
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
  if (income > 0) usedPct = (expense / income) * 100;
  else if (expense > 0) usedPct = 100;

  return {
    month,
    label: monthLabel(month),
    incomeTotal: income,
    incomePending: awaited,
    incomeReceived: Math.round((income - awaited) * 100) / 100,
    expenseTotal: expense,
    expensePending: pending,
    expensePaid: Math.round((expense - pending) * 100) / 100,
    balance,
    hasEntries,
    isOverBudget,
    status,
    statusMessage,
    usedPct,
  };
}

/** The month's entries as lines to read down: one per category, biggest first. */
export function lines(rows) {
  const totals = new Map();
  for (const row of rows) {
    const label = String(row.category ?? "Other");
    totals.set(label, (totals.get(label) ?? 0) + (Number(row.amount) || 0));
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * What is actually in each account at a point in time.
 *
 *   cash = opening cash + income received in cash - expenses paid in cash
 *   bank = opening bank + income received in bank - expenses paid from bank
 *                       - whatever has been paid off the credit card
 *
 * A credit card is not an account you hold money in: charging it owes the card,
 * and that bill is settled from the bank later. So card spending is kept apart
 * as `card.pending` until it is paid.
 *
 * Money still on its way moves nothing at all - pass only settled rows.
 */
export function accountBalances({
  incomeRows = [],
  expenseRows = [],
  opening = {},
  billsPaid = {},
} = {}) {
  const round = (value) => Math.round(value * 100) / 100;
  const balances = Object.fromEntries(
    INCOME_ACCOUNTS.map((account) => [account, round(Number(opening[account]) || 0)]),
  );
  const charged = Object.fromEntries(CARDS.map((card) => [card, 0]));

  for (const row of incomeRows) {
    if (row.account in balances) balances[row.account] += Number(row.total ?? row.amount) || 0;
  }
  for (const row of expenseRows) {
    const amount = Number(row.total ?? row.amount) || 0;
    if (row.method === "Cash") balances["Cash in Hand"] -= amount;
    else if (row.method === "Bank") balances.Bank -= amount;
    else if (row.method === "Credit Card") {
      const card = cardName(row.card);
      charged[card] = (charged[card] ?? 0) + amount;
    }
  }

  // A card paid off that has no charges left here still shows, so its payment
  // is accounted for.
  for (const card of Object.keys(billsPaid)) {
    if (!(card in charged) && Number(billsPaid[card])) charged[card] = 0;
  }

  // Settling a bill is the moment the money leaves the bank.
  const bills = Object.keys(charged).map((card) => {
    const paid = round(Number(billsPaid[card]) || 0);
    balances.Bank -= paid;
    return { card, charged: round(charged[card]), paid, pending: round(charged[card] - paid) };
  });

  for (const account of Object.keys(balances)) balances[account] = round(balances[account]);

  return {
    balances,
    bills,
    billsPending: round(bills.reduce((sum, bill) => sum + bill.pending, 0)),
    total: round(Object.values(balances).reduce((sum, value) => sum + value, 0)),
  };
}

/**
 * One plan: what was owed to start with, what the month's instalment is, and
 * how much of it the expenses filed against the plan have paid off.
 */
export function planState({ name = "", outstanding = 0, monthly = 0, paidRows = [], month } = {}) {
  const round = (value) => Math.round(value * 100) / 100;
  const mine = paidRows.filter((row) => (row.plan ?? name) === name);
  const paid = round(mine.reduce((sum, row) => sum + (Number(row.total ?? row.amount) || 0), 0));
  const thisMonth = round(
    mine
      .filter((row) => row.month === month)
      .reduce((sum, row) => sum + (Number(row.total ?? row.amount) || 0), 0),
  );
  const total = round(Number(outstanding) || 0);
  const due = round(Number(monthly) || 0);
  return {
    name,
    outstanding: total,
    monthly: due,
    paid,
    left: round(Math.max(total - paid, 0)),
    paidThisMonth: thisMonth,
    stillDueThisMonth: round(Math.max(Math.min(due, round(total - paid)) - thisMonth, 0)),
  };
}

/** Every plan, in order, with the totals across them. */
export function planTotals({ settings = {}, paidRows = [], month } = {}) {
  const round = (value) => Math.round(value * 100) / 100;
  const list = PLANS.map((name) =>
    planState({
      name,
      outstanding: settings[name]?.outstanding,
      monthly: settings[name]?.monthly,
      paidRows,
      month,
    }),
  );
  const sum = (key) => round(list.reduce((total, plan) => total + plan[key], 0));
  return {
    list,
    outstanding: sum("outstanding"),
    left: sum("left"),
    dueThisMonth: sum("stillDueThisMonth"),
    paidThisMonth: sum("paidThisMonth"),
  };
}

/** The two numbers behind each plan, both plain and never negative. */
export function validatePlans(body) {
  const read = (raw, label) => {
    const amount = raw === "" || raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be zero or more.`);
    return Math.round(amount * 100) / 100;
  };

  const plans = {};
  for (const name of PLANS) {
    const given = body?.[name] ?? {};
    plans[name] = {
      outstanding: read(given.outstanding, `${name} total outstanding`),
      monthly: read(given.monthly, `${name} monthly payment`),
    };
  }
  return plans;
}

/** The plan an expense pays off, if it pays one off at all. */
export function planName(value) {
  const name = String(value ?? "").trim();
  if (!name) return "";
  if (!PLANS.includes(name)) throw new Error(`Plan must be one of ${PLANS.join(", ")}.`);
  return name;
}

/** An opening balance is a plain number per account, and may be negative. */
export function validateOpening(body) {
  const opening = {};
  for (const account of INCOME_ACCOUNTS) {
    const raw = body?.[account];
    const amount = raw === "" || raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(amount)) throw new Error(`Opening balance for ${account} must be a number.`);
    opening[account] = Math.round(amount * 100) / 100;
  }
  return opening;
}

/** A payment off a card bill: money leaving the bank to settle that card. */
export function validateBillPayment(body, pending) {
  const card = String(body?.card ?? body?.method ?? CARDS[0]).trim();
  if (!CARDS.includes(card) && card !== LEGACY_CARD) {
    throw new Error(`Credit must be one of ${CARDS.join(", ")}.`);
  }

  const date = String(body?.date ?? "").trim();
  if (!isIsoDate(date)) throw new Error("Date must be a real date in YYYY-MM-DD format.");

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");

  const rounded = Math.round(amount * 100) / 100;
  if (pending !== undefined && rounded > Math.round(pending * 100) / 100 + 0.001) {
    throw new Error(`Only ${pending.toLocaleString("en-US")} is pending on ${card}.`);
  }

  return {
    card,
    date,
    month: monthKey(date),
    amount: rounded,
    note: String(body?.note ?? "").trim().slice(0, 200),
  };
}

function format(value) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
