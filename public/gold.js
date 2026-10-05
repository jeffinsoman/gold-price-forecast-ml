// Gold challenge page. Talks to the Worker API under /api/gold.

const $ = (id) => document.getElementById(id);
const state = { data: null, editing: null, page: "today" };

const STATUS = {
  hit: "✅ Target hit",
  covered: "✅ Covered",
  short: "🟡 Below target",
  loss: "🔻 Loss day",
  skipped: "⏭️ No trade",
  upcoming: "⏳ Upcoming",
};

function money(value, { sign = false } = {}) {
  const n = Number(value) || 0;
  const text = `AED ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n < 0) return `−${text}`;
  return sign && n > 0 ? `+${text}` : text;
}
const short = (n) => (n >= 1000 ? `${Number((n / 1000).toFixed(n >= 10000 ? 0 : 1))}k` : String(Math.round(n)));
const tone = (n) => (n > 0 ? "in" : n < 0 ? "out" : "");
const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function toast(text, kind = "ok") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = text;
  $("toasts").append(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 300);
  }, 2600);
}

/** Points a trade moved in its favour; mirrors tradePoints in worker/gold.js. */
function tradePoints({ direction, lot, entry, exit, pnl }) {
  if (entry != null && exit != null && entry !== "" && exit !== "") {
    const move = direction === "Sell" ? Number(entry) - Number(exit) : Number(exit) - Number(entry);
    return Math.round(move * 100);
  }
  return Number(lot) > 0 ? Math.round(Number(pnl) / (Number(lot) * 3.67)) : 0;
}

// ------------------------------------------------------------- rendering
function render(data) {
  state.data = data;
  renderToday(data);
  renderTrades(data);
  renderPlan(data);
  renderChart(data);
}

function renderToday(data) {
  const { today, stats } = data;
  $("day-title").textContent = `Day ${data.currentDay} of 100`;
  $("warn-growth").textContent =
    `${money(data.startBalance)} → AED 100,000 is a ${Math.round(data.goal / data.startBalance).toLocaleString("en-US")}× increase.`;
  $("eyebrow").textContent = `XAUUSD · Deriv · ${money(data.startBalance).replace(".00", "")} → AED 100,000`;
  $("balance").textContent = money(data.balance);
  $("balance-sum").textContent = `Started with ${money(data.startBalance)} · P&L ${money(data.totalPnl, { sign: true })}`;
  $("goal-fill").style.width = `${(data.logProgress * 100).toFixed(1)}%`;
  $("goal-note").textContent =
    `${(data.progress * 100).toFixed(2)}% of AED 100,000 · ${(data.logProgress * 100).toFixed(0)}% along the compounding curve`;

  const pace = $("pace");
  if (data.balance >= data.goal) {
    pace.textContent = "🏆 Goal reached!";
    pace.className = "pace ahead";
  } else if (data.daysAhead >= 0) {
    pace.textContent = data.daysAhead === 0
      ? "On plan: balance matches today's target."
      : `▲ ${data.daysAhead} day${data.daysAhead === 1 ? "" : "s"} ahead of plan (at Day ${data.onPlanDay} level).`;
    pace.className = "pace ahead";
  } else {
    pace.textContent = `▼ ${-data.daysAhead} day${data.daysAhead === -1 ? "" : "s"} behind plan` +
      (data.onPlanDay ? ` (at Day ${data.onPlanDay} level).` : " (below the Day 1 target).");
    pace.className = "pace behind";
  }

  $("today-title").textContent = `Day ${today.day} target`;
  const status = today.hit ? (today.trades ? "hit" : "covered") : today.pnl < 0 ? "loss" : today.pnl > 0 ? "short" : "upcoming";
  $("today-status").textContent = today.hit ? STATUS[status] : today.pnl ? STATUS[status] : "⏳ Not traded yet";
  $("today-status").className = `status-tag ${status}`;
  $("k-needed").textContent = today.hit ? "Done ✅" : money(today.needed);
  $("k-lot").textContent = today.hit ? "—" : today.neededTradeLot.toFixed(2);
  $("k-tp").textContent = today.hit ? "" : `TP ≈ ${today.neededTp} pts (exact ${today.neededLot.toFixed(4)})`;
  $("k-target").textContent = money(today.target);
  $("k-today").textContent = money(today.pnl, { sign: true });
  $("k-today").className = `kpi-value ${tone(today.pnl)}`;
  const span = today.target - today.openToday;
  const done = span > 0 ? Math.min(1, Math.max(0, today.pnl / span)) : 1;
  $("day-fill").style.width = `${(done * 100).toFixed(0)}%`;
  $("plan-compare").textContent = adjustNote(today, data.balance);
  const next = data.next;
  $("next-day").hidden = !next || next.day > 100;
  if (next) {
    const cut = next.targetProfit < next.profit;
    const skip = next.day - data.currentDay - 1;
    const covered = skip > 0
      ? `Day${skip > 1 ? "s" : ""} ${data.currentDay + 1}${skip > 1 ? `–${next.day - 1}` : ""} covered ✅<br>`
      : "";
    $("next-day").innerHTML =
      `${covered}<b>Next: Day ${next.day}</b> · target ${money(next.targetProfit)} · lot <b>${next.tradeLot.toFixed(2)}</b> · TP ≈ ${next.tpPoints} pts` +
      (cut ? ` <span class="was">plan ${money(next.profit)} · ${next.lot.toFixed(4)}</span>` : "");
  }

  $("s-pnl").textContent = money(data.totalPnl, { sign: true });
  $("s-pnl").className = `wallet-value ${tone(data.totalPnl) === "out" ? "out" : ""}`;
  $("s-win").textContent = stats.trades ? `${Math.round(stats.winRate * 100)}%` : "—";
  $("s-win-label").textContent = stats.trades ? `Win rate · ${stats.wins}W / ${stats.losses}L` : "Win rate";
  $("s-days").textContent = `${stats.daysHit} / ${data.currentDay}`;
  $("s-trades").textContent = String(stats.trades);

  const form = $("setup-form");
  form.startDate.value = data.startDate;
  form.startBalance.value = data.startBalance;
  if (!data.started) $("setup-card").open = true;
  previewOpening();
}

/** Why today's target differs from the PDF: profit carried in, or a gap to catch up. */
function adjustNote(today, balance) {
  const pdf = `Plan for Day ${today.day}: ${money(today.profit)} at ${today.lot.toFixed(4)} lot.`;
  const extra = balance - today.target;
  if (today.trades && extra > 0.004) {
    return `${pdf} Target beaten by ${money(extra)}, which carries forward and cuts the next day's target and lot.`;
  }
  if (today.carry > 0.004) {
    return today.targetProfit === 0
      ? `${pdf} Your extra ${money(today.carry)} from earlier days already covers it, so no trade is needed today.`
      : `${pdf} Your extra ${money(today.carry)} from earlier days cuts it to ${money(today.targetProfit)} (${today.tradeLot.toFixed(2)} lot).`;
  }
  if (today.carry < -0.004) {
    return `${pdf} You started the day ${money(-today.carry)} behind, so today's target is ${money(today.targetProfit)} to get back on plan.`;
  }
  return `${pdf} You are exactly on plan.`;
}

function renderTrades(data) {
  $("trades-total").textContent = money(data.totalPnl, { sign: true });
  $("trades-total").className = `card-total ${tone(data.totalPnl)}`;
  const list = $("trade-list");
  list.replaceChildren();
  if (!data.trades.length) {
    list.innerHTML = '<p class="empty">No trades yet. Log your first one above.</p>';
    return;
  }
  for (const trade of data.trades) {
    const row = document.createElement("div");
    row.className = "entry";
    const pts = tradePoints(trade);
    const prices = (trade.entry != null && trade.exit != null ? ` · ${trade.entry} → ${trade.exit}` : "") +
      ` · ${pts > 0 ? "+" : ""}${pts} pts`;
    row.innerHTML = `
      <span class="entry-icon" aria-hidden="true">${trade.direction === "Sell" ? "⬇️" : "⬆️"}</span>
      <div class="entry-main">
        <p class="entry-title">Day ${trade.day} · ${trade.direction} ${Number(trade.lot)} lot</p>
        <p class="entry-sub"></p>
      </div>
      <div class="entry-right">
        <span class="entry-amount ${tone(trade.pnl)}">${money(trade.pnl, { sign: true })}</span>
        <span class="entry-actions">
          <button class="link" data-edit="${trade.id}">Edit</button>
          <button class="link danger" data-delete="${trade.id}">Delete</button>
        </span>
      </div>`;
    row.querySelector(".entry-sub").textContent = `${trade.date}${prices}${trade.note ? ` · ${trade.note}` : ""}`;
    list.append(row);
  }
}

function renderPlan(data) {
  $("rate-label").textContent = `${(data.rate * 100).toFixed(2)}% a day`;
  const body = $("plan-body");
  body.replaceChildren();
  for (const row of data.days) {
    const tr = document.createElement("tr");
    if (row.day === data.currentDay) tr.className = "current";
    const traded = row.pnl !== null;
    tr.innerHTML = `
      <td>${row.day}</td>
      <td>${row.start.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td>${row.profit.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td>${row.target.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td>${row.lot.toFixed(4)}</td>
      <td class="${row.targetProfit < row.profit ? "num in" : ""}">${row.targetProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td class="${row.targetLot < row.lot ? "num in" : ""}" title="exact ${row.targetLot.toFixed(4)}">${row.tradeLot.toFixed(2)}</td>
      <td>${row.tpPoints || "—"}</td>
      <td>${traded ? row.lotsUsed.map((lot) => lot.toFixed(2)).join(" + ") : "—"}</td>
      <td class="num ${traded ? tone(row.pointsMade) : ""}">${traded ? `${row.pointsMade > 0 ? "+" : ""}${row.pointsMade}` : "—"}</td>
      <td>${traded ? (row.targetPoints ? `${row.targetPoints}${row.pointsMade >= row.targetPoints ? " ✅" : ""}` : "✅") : "—"}</td>
      <td class="num ${traded ? tone(row.pnl) : ""}">${traded ? money(row.pnl, { sign: true }).replace("AED ", "") : "—"}</td>
      <td>${row.day <= data.currentDay ? row.balance.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "—"}</td>
      <td><span class="status-tag ${row.status}" title="${STATUS[row.status].split(" ").slice(1).join(" ")}">${STATUS[row.status].split(" ")[0]}</span></td>`;
    body.append(tr);
  }
}

// ------------------------------------------------------------- chart
function renderChart(data) {
  const box = $("chart");
  // Drawn at the box's real width so the labels stay readable on a phone.
  const W = Math.max(300, box.clientWidth || 640), H = W < 500 ? 230 : 280, L = 40, R = 16, T = 12, B = 26;
  const lo = Math.log10(Math.min(data.startBalance, ...data.days.slice(0, data.currentDay).map((d) => d.balance)) * 0.9);
  const hi = Math.log10(data.goal * 1.1);
  const x = (day) => L + ((day) / 100) * (W - L - R);
  const y = (v) => T + (1 - (Math.log10(Math.max(v, 1)) - lo) / (hi - lo)) * (H - T - B);

  const planPts = [[0, data.startBalance], ...data.days.map((d) => [d.day, d.target])];
  const actualPts = [[0, data.startBalance], ...data.days.slice(0, data.currentDay).map((d) => [d.day, d.balance])];
  const path = (pts) => pts.map(([d, v], i) => `${i ? "L" : "M"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join("");

  const ticks = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].filter((v) => Math.log10(v) >= lo && Math.log10(v) <= hi);
  const grid = ticks.map((v) => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` +
    `<text class="axis-label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`).join("");
  const xTicks = (W < 500 ? [1, 50, 100] : [1, 25, 50, 75, 100]).map((d) =>
    `<text class="axis-label" x="${x(d)}" y="${H - 6}" text-anchor="middle">Day ${d}</text>`).join("");
  const last = actualPts[actualPts.length - 1];

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance against the 100-day plan, log scale">
      ${grid}${xTicks}
      <path class="plan-line" d="${path(planPts)}"/>
      <path class="actual-line" d="${path(actualPts)}"/>
      <circle class="actual-dot" r="4.5" cx="${x(last[0])}" cy="${y(last[1])}"/>
      <text class="end-label" x="${x(100)}" y="${y(data.goal) - 8}" text-anchor="end">AED 100k goal</text>
      <text class="end-label" x="${x(last[0]) + 8}" y="${y(last[1]) + 16}">You</text>
      <line class="cross" id="cross" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>
    <div class="tooltip" id="tip" hidden></div>`;

  const svg = box.querySelector("svg");
  const tip = $("tip");
  const cross = $("cross");
  const move = (event) => {
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const day = Math.min(100, Math.max(1, Math.round(((px - L) / (W - L - R)) * 100)));
    const row = data.days[day - 1];
    cross.setAttribute("x1", x(day));
    cross.setAttribute("x2", x(day));
    cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<b>Day ${day}</b><i class="plan"></i>Plan ${money(row.target)}` +
      (day <= data.currentDay ? `<br><i></i>You ${money(row.balance)}` : "");
    const left = (x(day) / W) * rect.width;
    tip.style.left = `${Math.min(rect.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2))}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  $("hit").addEventListener("pointermove", move);
  $("hit").addEventListener("pointerdown", move);
  $("hit").addEventListener("pointerleave", hide);
}

// ------------------------------------------------------------- trade form
function suggestedDay(date) {
  const start = state.data?.startDate;
  if (!start || !date) return state.data?.currentDay ?? 1;
  const diff = Math.round((Date.parse(date) - Date.parse(start)) / 86400000);
  return Math.min(100, Math.max(1, diff + 1));
}

function resetTradeForm() {
  const form = $("trade-form");
  form.reset();
  state.editing = null;
  form.date.value = todayIso();
  form.day.value = suggestedDay(form.date.value);
  $("trade-submit").textContent = "Save trade";
  $("trade-cancel").classList.add("hidden");
}

function updatePnlHint() {
  const form = $("trade-form");
  const { lot, entry, exit, pnl } = form;
  if (pnl.value === "" && lot.value && entry.value && exit.value) {
    const dir = form.direction.value === "Sell" ? -1 : 1;
    const value = (Number(exit.value) - Number(entry.value)) * dir * Number(lot.value) * 367;
    $("pnl-hint").textContent = `From prices: ${money(value, { sign: true })}`;
  } else {
    $("pnl-hint").textContent = "Leave blank to work it out from entry and exit.";
  }
}

/** What the plan becomes from the opening balance being typed, before it is saved. */
function previewOpening() {
  const opening = Number($("setup-form").startBalance.value);
  const out = $("opening-preview");
  if (!(opening > 0) || opening >= 100000) {
    out.textContent = opening >= 100000 ? "Opening balance must be below AED 100,000." : "";
    return;
  }
  const rate = (100000 / opening) ** (1 / 100) - 1;
  const profit = opening * rate;
  out.innerHTML =
    `From ${money(opening)}: <b>${(rate * 100).toFixed(2)}% a day</b> · Day 1 target ${money(profit)} at <b>${(profit / 367).toFixed(4)} lot</b>`;
}

function setPage(page) {
  state.page = page;
  document.body.classList.toggle("wide", page === "plan");
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("is-active", tab.dataset.page === page);
  for (const section of document.querySelectorAll(".page")) section.classList.toggle("hidden", section.id !== `page-${page}`);
  if (page === "plan") document.querySelector("#plan-body tr.current")?.scrollIntoView({ block: "center" });
}

function wire() {
  $("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) setPage(tab.dataset.page);
  });

  const setup = $("setup-form");
  setup.startBalance.addEventListener("input", previewOpening);
  $("opening-quick").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-amount]");
    if (!chip) return;
    setup.startBalance.value = chip.dataset.amount;
    previewOpening();
  });
  $("edit-opening").addEventListener("click", () => {
    setPage("today");
    $("setup-card").open = true;
    $("setup-card").scrollIntoView({ behavior: "smooth", block: "start" });
    setup.startBalance.focus();
  });

  $("setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      render(await api("gold/settings", {
        method: "PUT",
        body: { startDate: form.startDate.value, startBalance: form.startBalance.value },
      }));
      $("setup-card").open = false;
      resetTradeForm();
      toast(`Opening balance ${money(state.data.startBalance)} saved. Plan updated.`);
    } catch (error) {
      toast(error.message, "bad");
    }
  });

  const form = $("trade-form");
  form.date.addEventListener("change", () => { form.day.value = suggestedDay(form.date.value); });
  form.addEventListener("input", updatePnlHint);
  $("use-lot").addEventListener("click", () => {
    const t = state.data?.today;
    const lot = t && (t.hit ? state.data.next?.tradeLot : t.neededTradeLot);
    if (lot) form.lot.value = lot.toFixed(2);
    updatePnlHint();
  });
  $("trade-cancel").addEventListener("click", resetTradeForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    const editing = state.editing;
    try {
      render(await api(editing ? `gold/trades/${editing}` : "gold/trades", { method: editing ? "PATCH" : "POST", body }));
      resetTradeForm();
      updatePnlHint();
      $("trade-msg").textContent = "";
      const t = state.data.today;
      toast(editing ? "Trade updated." : t.hit ? `Saved. Day ${t.day} target hit ✅` : `Saved. ${money(t.needed)} still to go today.`);
    } catch (error) {
      $("trade-msg").textContent = error.message;
      $("trade-msg").className = "form-msg bad";
    }
  });

  $("trade-list").addEventListener("click", async (event) => {
    const del = event.target.closest("[data-delete]");
    const edit = event.target.closest("[data-edit]");
    if (del) {
      if (!confirm("Delete this trade?")) return;
      try {
        render(await api(`gold/trades/${del.dataset.delete}`, { method: "DELETE" }));
        toast("Trade deleted.");
      } catch (error) {
        toast(error.message, "bad");
      }
    }
    if (edit) {
      const trade = state.data.trades.find((t) => String(t.id) === edit.dataset.edit);
      if (!trade) return;
      state.editing = trade.id;
      for (const key of ["date", "day", "lot", "entry", "exit", "pnl", "note"]) form[key].value = trade[key] ?? "";
      form.direction.value = trade.direction;
      $("trade-submit").textContent = "Update trade";
      $("trade-cancel").classList.remove("hidden");
      form.scrollIntoView({ behavior: "smooth" });
    }
  });
}

async function start() {
  wire();
  let resizing;
  window.addEventListener("resize", () => {
    clearTimeout(resizing);
    resizing = setTimeout(() => state.data && renderChart(state.data), 150);
  });
  try {
    render(await api("gold"));
  } catch (error) {
    toast(error.message, "bad");
  }
  resetTradeForm();
}

start();
