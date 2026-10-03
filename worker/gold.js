// Gold challenge: AED 200 -> AED 100,000 in 100 days on XAUUSD (Deriv).
// Pure functions only, so the plan maths can be tested without a database.

export const GOLD_START = 200;
export const GOLD_GOAL = 100000;
export const GOLD_DAYS = 100;
// 100 points at 0.01 lot = AED 3.67, so 1.00 lot = AED 367 per 100 points
// (100 points = a USD 1.00 move in the gold price).
export const AED_PER_LOT_100PTS = 367;
export const DIRECTIONS = ["Buy", "Sell"];

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** The daily growth that turns `start` into `goal` over `days`. */
export function dailyRate(start = GOLD_START, goal = GOLD_GOAL, days = GOLD_DAYS) {
  return (goal / start) ** (1 / days) - 1;
}

/** Lot size that makes `profit` AED from a single 100-point move. */
export function lotFor(profit) {
  return round(Math.max(0, profit) / AED_PER_LOT_100PTS, 4);
}

/** The 100-day table from the PDF: start, target profit, target and lot per day. */
export function buildPlan(start = GOLD_START, goal = GOLD_GOAL, days = GOLD_DAYS) {
  const rate = dailyRate(start, goal, days);
  const rows = [];
  for (let day = 1; day <= days; day += 1) {
    const open = start * (1 + rate) ** (day - 1);
    const target = start * (1 + rate) ** day;
    rows.push({
      day,
      start: round(open),
      profit: round(target - open),
      target: round(target),
      lot: lotFor(target - open),
    });
  }
  return rows;
}

/** AED made or lost by moving `lot` from `entry` to `exit`. */
export function tradePnl({ direction, lot, entry, exit }) {
  const move = direction === "Sell" ? entry - exit : exit - entry;
  // USD 1.00 move = 100 points = AED 367 per lot.
  return round(move * lot * AED_PER_LOT_100PTS);
}

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) && !Number.isNaN(Date.parse(value));
}

/** Which challenge day `date` falls on, counting the start date as day 1. */
export function challengeDay(startDate, date) {
  if (!isIsoDate(startDate) || !isIsoDate(date)) return 1;
  const diff = Math.round((Date.parse(date) - Date.parse(startDate)) / 86400000);
  return Math.min(GOLD_DAYS, Math.max(1, diff + 1));
}

function number(value, label, { allowBlank = false } = {}) {
  if (allowBlank && (value === "" || value === null || value === undefined)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

/** Check a trade from the form. P&L is worked out from the prices when left blank. */
export function validateTrade(body) {
  if (!isIsoDate(body?.date)) throw new Error("Date must look like 2026-10-03.");
  const day = number(body.day, "Day");
  if (!Number.isInteger(day) || day < 1 || day > GOLD_DAYS) throw new Error(`Day must be between 1 and ${GOLD_DAYS}.`);
  const direction = DIRECTIONS.includes(body.direction) ? body.direction : "Buy";
  const lot = number(body.lot, "Lot");
  if (lot <= 0) throw new Error("Lot must be more than 0.");
  const entry = number(body.entry, "Entry price", { allowBlank: true });
  const exit = number(body.exit, "Exit price", { allowBlank: true });

  let pnl = number(body.pnl, "Profit / loss", { allowBlank: true });
  if (pnl === null) {
    if (entry === null || exit === null) throw new Error("Profit / loss must be a number, or give entry and exit prices.");
    pnl = tradePnl({ direction, lot, entry, exit });
  }

  return {
    date: body.date,
    day,
    direction,
    lot: round(lot, 4),
    entry,
    exit,
    pnl: round(pnl),
    note: String(body.note ?? "").trim().slice(0, 200),
  };
}

export function validateGoldSettings(body) {
  if (!isIsoDate(body?.startDate)) throw new Error("Start date must look like 2026-10-03.");
  const startBalance = number(body.startBalance ?? GOLD_START, "Starting balance");
  if (startBalance <= 0) throw new Error("Starting balance must be more than 0.");
  return { startDate: body.startDate, startBalance: round(startBalance) };
}

/**
 * Where the challenge stands: balance after each day against the plan, today's
 * target, and the lot that would make it from the balance actually held.
 */
export function challengeState({ trades, startBalance = GOLD_START, startDate, today }) {
  const plan = buildPlan(startBalance);
  const rate = dailyRate(startBalance);
  const byDay = new Map();
  for (const trade of trades) {
    const entry = byDay.get(trade.day) ?? { pnl: 0, count: 0 };
    entry.pnl += Number(trade.pnl) || 0;
    entry.count += 1;
    byDay.set(trade.day, entry);
  }

  const lastTradedDay = Math.max(0, ...byDay.keys());
  const currentDay = Math.max(challengeDay(startDate, today), Math.min(GOLD_DAYS, lastTradedDay || 1));

  const totalPnl = trades.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
  const current = round(startBalance + totalPnl);

  // Each day's goal is the PDF's end-of-day balance. Profit above a target
  // carries forward: the next day only has to make up the gap from what is
  // actually held, so its target and lot shrink (to nothing when covered).
  // Days still to come assume each target is hit exactly from here on.
  let balance = startBalance;
  const days = plan.map((row) => {
    const traded = byDay.get(row.day);
    const open = row.day <= currentDay ? balance : Math.max(current, row.start);
    if (traded) balance += traded.pnl;
    // Not ahead of the PDF: its own figure, so rounding never drifts by a fils.
    const targetProfit = open > row.start ? round(Math.max(0, row.target - open)) : open < row.start ? round(row.target - open) : row.profit;
    const covered = targetProfit === 0;
    let status;
    if (traded) status = balance >= row.target ? "hit" : traded.pnl >= 0 ? "short" : "loss";
    else if (covered) status = "covered";
    else status = row.day < currentDay ? "skipped" : "upcoming";
    return {
      ...row,
      actualStart: round(open),
      // Positive when ahead of the PDF at the start of the day.
      carry: round(open - row.start),
      targetProfit,
      targetLot: targetProfit === row.profit ? row.lot : lotFor(targetProfit),
      pnl: traded ? round(traded.pnl) : null,
      trades: traded?.count ?? 0,
      balance: round(balance),
      status,
    };
  });

  const today_ = days[currentDay - 1];
  const todayPnl = round(byDay.get(currentDay)?.pnl ?? 0);
  const openToday = round(current - todayPnl);
  // What is still missing from today's target after today's trades so far.
  const needed = round(Math.max(0, today_.target - current));
  // Staying on the same compounding pace from today's real starting balance.
  const paceProfit = round(openToday * rate);
  // The furthest plan day whose target the balance has already passed.
  const onPlanDay = plan.filter((row) => row.target <= current).length;
  // The first day after today that still needs a trade, with its reduced target.
  const next = days.slice(currentDay).find((row) => row.targetProfit > 0) ?? null;
  const wins = trades.filter((trade) => Number(trade.pnl) > 0).length;

  return {
    rate,
    goal: GOLD_GOAL,
    startBalance,
    startDate,
    balance: current,
    totalPnl: round(totalPnl),
    progress: Math.min(1, Math.max(0, current / GOLD_GOAL)),
    // Growth is compounding, so log progress shows how far along the curve you are.
    logProgress: current <= startBalance ? 0 : Math.min(1, Math.log(current / startBalance) / Math.log(GOLD_GOAL / startBalance)),
    currentDay,
    onPlanDay,
    daysAhead: onPlanDay - currentDay,
    today: {
      ...today_,
      pnl: todayPnl,
      openToday,
      needed,
      neededLot: lotFor(needed),
      paceProfit,
      paceLot: lotFor(paceProfit),
      hit: current >= today_.target,
    },
    next: next && { day: next.day, targetProfit: next.targetProfit, targetLot: next.targetLot, profit: next.profit, lot: next.lot },
    stats: {
      trades: trades.length,
      wins,
      losses: trades.filter((trade) => Number(trade.pnl) < 0).length,
      winRate: trades.length ? wins / trades.length : 0,
      best: trades.length ? round(Math.max(...trades.map((t) => Number(t.pnl) || 0))) : 0,
      worst: trades.length ? round(Math.min(...trades.map((t) => Number(t.pnl) || 0))) : 0,
      daysHit: days.filter((row) => row.status === "hit").length,
    },
    days,
  };
}
