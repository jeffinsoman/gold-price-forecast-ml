import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPlan, challengeDay, challengeState, dailyRate, lotFor, tradePnl, validateTrade } from "../worker/gold.js";

test("the plan matches the PDF table", () => {
  const plan = buildPlan();
  assert.equal(plan.length, 100);
  assert.deepEqual(plan[0], { day: 1, start: 200, profit: 12.82, target: 212.82, lot: 0.0349 });
  assert.deepEqual(plan[1], { day: 2, start: 212.82, profit: 13.65, target: 226.47, lot: 0.0372 });
  assert.deepEqual(plan[54], { day: 55, start: 5734.21, profit: 367.66, target: 6101.88, lot: 1.0018 });
  assert.deepEqual(plan[92], { day: 93, start: 60825.04, profit: 3899.97, target: 64725.01, lot: 10.6266 });
  assert.equal(plan[99].target, 100000);
  assert.ok(Math.abs(dailyRate() - 0.0641) < 0.0001);
});

test("lot and P&L use AED 367 per lot per 100 points", () => {
  assert.equal(lotFor(367), 1);
  assert.equal(tradePnl({ direction: "Buy", lot: 0.01, entry: 2650, exit: 2651 }), 3.67);
  assert.equal(tradePnl({ direction: "Sell", lot: 0.05, entry: 2650, exit: 2652 }), -36.7);
});

test("challenge day counts from the start date", () => {
  assert.equal(challengeDay("2026-10-01", "2026-10-01"), 1);
  assert.equal(challengeDay("2026-10-01", "2026-10-03"), 3);
  assert.equal(challengeDay("2026-10-01", "2027-06-01"), 100);
});

test("trades are checked, and P&L comes from prices when blank", () => {
  const row = validateTrade({ date: "2026-10-03", day: "1", direction: "Buy", lot: "0.04", entry: "2650", exit: "2651", pnl: "" });
  assert.equal(row.pnl, 14.68);
  assert.throws(() => validateTrade({ date: "2026-10-03", day: 1, lot: 0.04, pnl: "" }), /Profit/);
  assert.throws(() => validateTrade({ date: "2026-10-03", day: 101, lot: 0.04, pnl: 5 }), /Day/);
});

test("state compares the balance with the plan", () => {
  const trades = [
    { day: 1, pnl: 15 },
    { day: 2, pnl: -5 },
  ];
  const s = challengeState({ trades, startDate: "2026-10-01", today: "2026-10-02" });
  assert.equal(s.balance, 210);
  assert.equal(s.currentDay, 2);
  assert.equal(s.days[0].status, "hit");
  assert.equal(s.days[1].status, "loss");
  assert.equal(s.today.needed, 16.47);
  assert.equal(s.onPlanDay, 0);
  assert.equal(s.daysAhead, -2);
  assert.equal(s.stats.winRate, 0.5);
});

test("profit over a target cuts the next days' targets and lots", () => {
  // Day 1 makes AED 30 against a 12.82 target: balance 230.
  const s = challengeState({ trades: [{ day: 1, pnl: 30 }], startDate: "2026-10-01", today: "2026-10-01" });
  assert.equal(s.days[0].status, "hit");
  // Day 2's plan ends at 226.47, already passed, so it needs nothing.
  assert.equal(s.days[1].targetProfit, 0);
  assert.equal(s.days[1].status, "covered");
  // Day 3 ends at 240.99: 10.99 to make instead of the PDF's 14.52.
  assert.equal(s.days[2].targetProfit, 10.99);
  assert.equal(s.days[2].targetLot, 0.0299);
  assert.equal(s.days[2].profit, 14.52);
  assert.deepEqual(s.next, { day: 3, targetProfit: 10.99, targetLot: 0.0299, profit: 14.52, lot: 0.0396 });
  // Further out the plan is back to the PDF numbers.
  assert.equal(s.days[3].targetProfit, s.days[3].profit);
});

test("today's target uses the balance the day opened with", () => {
  const s = challengeState({ trades: [{ day: 1, pnl: 20 }], startDate: "2026-10-01", today: "2026-10-02" });
  // Opened day 2 with 220 against a 226.47 target.
  assert.equal(s.today.targetProfit, 6.47);
  assert.equal(s.today.carry, 7.18);
  assert.equal(s.today.needed, 6.47);
});
