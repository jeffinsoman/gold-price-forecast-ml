// Front-end for the Income vs Expense Tracker. Talks to the Worker API under /api.

const DEFAULT_CURRENCY = "AED";

// A symbol for every account, payment method and category the API offers.
const ICONS = {
  "Cash in Hand": "💵",
  Cash: "💵",
  Bank: "🏦",
  "Credit Card": "💳",
  Salary: "💼",
  Business: "🏢",
  Freelance: "💻",
  Interest: "📈",
  Gift: "🎁",
  Food: "🍽️",
  Groceries: "🛒",
  Rent: "🏠",
  Bills: "💡",
  Transport: "🚗",
  Shopping: "🛍️",
  Health: "🩺",
  Education: "🎓",
  EMI: "📆",
  Entertainment: "🎬",
  Other: "📌",
};

const QUICK_AMOUNTS = [50, 100, 500, 1000];

const DIRECTION = {
  lent: { icon: "🤝", who: "Lent to", verb: "Lent", owes: "outstanding", back: "back", save: "Save loan" },
  borrowed: { icon: "🙏", who: "Borrowed from", verb: "Borrowed", owes: "to repay", back: "paid back", save: "Save what you took" },
};

const flowFor = (direction) => state.options.loanFlow[direction] ?? state.options.loanFlow.lent;

const icon = (name) => ICONS[name] ?? "•";

const state = {
  today: new Date().toISOString().slice(0, 10),
  currentMonth: "",
  months: [],
  options: {},
  currency: localStorage.getItem("currency") || DEFAULT_CURRENCY,
  dashMonth: "",
  txMonth: "",
};

const $ = (id) => document.getElementById(id);

function money(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${state.currency} ${rounded.toLocaleString("en-US")}`;
}

function monthLabel(key) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month] = key.split("-");
  return `${names[Number(month) - 1]} ${year}`;
}

function dayLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${day} ${monthLabel(`${year}-${month}`)}`;
}

function previousMonthLabel(key) {
  let [year, month] = key.split("-").map(Number);
  month -= 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return monthLabel(`${year}-${String(month).padStart(2, "0")}`);
}

function nextMonthLabel(key) {
  let [year, month] = key.split("-").map(Number);
  month += 1;
  if (month === 13) {
    month = 1;
    year += 1;
  }
  return monthLabel(`${year}-${String(month).padStart(2, "0")}`);
}

async function api(path, options) {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function message(element, text, ok = true) {
  element.textContent = text;
  element.className = `form-msg ${ok ? "ok" : "bad"}`;
}

function toast(text, kind = "ok") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.innerHTML = `<span aria-hidden="true">${kind === "bad" ? "⚠️" : "✅"}</span><span>${text}</span>`;
  $("toasts").append(node);
  setTimeout(() => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 300);
  }, 3200);
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Numbers count up to their new value, so a change is something you see happen. */
function setAmount(element, value) {
  const from = Number(element.dataset.value ?? 0);
  const to = Number(value) || 0;
  element.dataset.value = to;
  element.classList.toggle("negative", to < 0);

  if (reduceMotion || from === to) {
    element.textContent = money(to);
    return;
  }

  const started = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - started) / 420);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = money(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function empty(text) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = text;
  return node;
}

// -------------------------------------------------------------------
// SHARED BITS
// -------------------------------------------------------------------
function fillMonths(select, selected) {
  select.innerHTML = "";
  for (const key of state.months) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = monthLabel(key);
    option.selected = key === selected;
    select.append(option);
  }
}

function fillChoices(container, values, name, checked) {
  container.innerHTML = "";
  values.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    const isOn = checked ? value === checked : index === 0;
    label.innerHTML =
      `<input type="radio" name="${name}" value="${value}"${isOn ? " checked" : ""} />` +
      `<span>${value}</span>`;
    container.append(label);
  });
}

/** Category picker: a symbol you tap, rather than a dropdown to hunt through. */
function fillChips(container, values, name, checked) {
  container.innerHTML = "";
  values.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "chip";
    const isOn = checked ? value === checked : index === 0;
    label.innerHTML =
      `<input type="radio" name="${name}" value="${value}"${isOn ? " checked" : ""} />` +
      `<span><span class="chip-icon" aria-hidden="true">${icon(value)}</span>${value}</span>`;
    container.append(label);
  });
}

/** Tap to add a round number to an amount field instead of typing it. */
function fillQuick(container, input) {
  container.innerHTML = "";
  for (const step of QUICK_AMOUNTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quick-btn";
    button.textContent = `+${step.toLocaleString("en-US")}`;
    button.addEventListener("click", () => {
      input.value = Math.round((Number(input.value) || 0) + step);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    container.append(button);
  }
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "quick-btn clear";
  clear.textContent = "clear";
  clear.addEventListener("click", () => {
    input.value = "";
    input.focus();
  });
  container.append(clear);
}

function fillSelect(select, values, selected) {
  select.innerHTML = values
    .map((value) => `<option${value === selected ? " selected" : ""}>${value}</option>`)
    .join("");
}

function entryTable(rows, kind, { actions = false, onDelete, onEdit } = {}) {
  if (!rows.length) {
    return empty(kind === "income" ? "No income recorded here yet." : "No expenses recorded here yet.");
  }

  const source = kind === "income" ? "account" : "method";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML =
    `<thead><tr><th>Date</th><th>${kind === "income" ? "Account" : "Paid by"}</th>` +
    `<th>Category</th><th>Note</th><th class="amount">Amount</th>${actions ? "<th></th>" : ""}</tr></thead>`;

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const due = kind === "expense" && row.date > state.today ? ' <span class="tag due">due</span>' : "";
    tr.innerHTML =
      `<td>${dayLabel(row.date)}${due}</td>` +
      `<td><span aria-hidden="true">${icon(row[source])}</span> ${row[source]}</td>` +
      `<td><span class="tag"><span aria-hidden="true">${icon(row.category)}</span> ${row.category}</span></td>` +
      `<td>${row.note || ""}</td>` +
      `<td class="amount">${money(row.amount)}</td>`;
    if (actions) {
      const cell = document.createElement("td");
      cell.className = "actions";
      cell.append(
        linkButton("Edit", () => onEdit(row)),
        linkButton("Delete", () => onDelete(row.id), "danger"),
      );
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function linkButton(text, onClick, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `link ${variant}`.trim();
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function splitBars(container, totals, keys, kind) {
  const max = Math.max(1, ...keys.map((key) => Math.abs(totals[key] || 0)));
  container.innerHTML = "";
  for (const key of keys) {
    const value = totals[key] || 0;
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="bar-name"><span aria-hidden="true">${icon(key)}</span> ${key}</span>` +
      `<span class="bar-value">${money(value)}</span>` +
      `<span class="bar-track"><span class="bar-fill ${value < 0 ? "expense" : kind}" ` +
      `style="width:${(Math.abs(value) / max) * 100}%"></span></span>`;
    container.append(li);
  }
}

// -------------------------------------------------------------------
// EDIT DIALOG
// -------------------------------------------------------------------
const FIELD_SETS = {
  income: (row) => [
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    { type: "radio", name: "account", label: "Received in", values: state.options.incomeAccounts, value: row.account },
    { type: "chips", name: "category", label: "Category", values: state.options.incomeCategories, value: row.category },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  expense: (row) => [
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    { type: "radio", name: "method", label: "Paid by", values: state.options.expenseMethods, value: row.method },
    { type: "chips", name: "category", label: "Category", values: state.options.expenseCategories, value: row.category },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  loan: (row) => [
    { type: "text", name: "friend", label: DIRECTION[row.direction ?? "lent"].who, value: row.friend },
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    {
      type: "radio",
      name: "paidFrom",
      label: flowFor(row.direction).openLabel,
      values: flowFor(row.direction).openValues,
      value: row.paid_from,
    },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  repayment: (row) => [
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    {
      type: "radio",
      name: "receivedIn",
      label: flowFor(row.direction).backLabel,
      values: flowFor(row.direction).backValues,
      value: row.received_in,
    },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
};

let editSubmit = null;

function openEdit({ title, kind, row, onSave }) {
  const dialog = $("edit-dialog");
  const fields = $("edit-fields");
  $("edit-title").textContent = title;
  $("edit-msg").textContent = "";
  fields.innerHTML = "";

  for (const field of FIELD_SETS[kind](row)) {
    if (field.type === "chips") {
      const set = document.createElement("fieldset");
      set.className = "field";
      set.innerHTML = `<legend>${field.label}</legend><div class="chips"></div>`;
      fillChips(set.querySelector(".chips"), field.values, field.name, field.value);
      fields.append(set);
      continue;
    }

    if (field.type === "radio") {
      const set = document.createElement("fieldset");
      set.className = "field";
      set.innerHTML = `<legend>${field.label}</legend><div class="choices"></div>`;
      fillChoices(set.querySelector(".choices"), field.values, field.name, field.value);
      fields.append(set);
      continue;
    }

    const label = document.createElement("label");
    label.className = "field";
    label.textContent = field.label;
    if (field.type === "select") {
      const select = document.createElement("select");
      select.name = field.name;
      fillSelect(select, field.values, field.value);
      label.append(select);
    } else {
      const input = document.createElement("input");
      input.type = field.type;
      input.name = field.name;
      input.value = field.value ?? "";
      if (field.type === "number") {
        input.min = "0.01";
        input.step = "0.01";
      }
      label.append(input);
    }
    fields.append(label);
  }

  editSubmit = onSave;
  dialog.showModal();
}

function bindEditDialog() {
  const dialog = $("edit-dialog");
  $("edit-cancel").addEventListener("click", () => dialog.close());
  $("edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      await editSubmit(body);
      dialog.close();
    } catch (error) {
      message($("edit-msg"), error.message, false);
    }
  });
}

// -------------------------------------------------------------------
// DASHBOARD
// -------------------------------------------------------------------
async function loadDashboard(month) {
  state.dashMonth = month;
  const data = await api(`/month/${month}`);
  state.months = data.months;
  fillMonths($("dash-month"), month);
  fillMonths($("tx-month"), state.txMonth || month);

  const s = data.summary;
  const card = $("status-card");
  card.className = `status-card ${s.isOverBudget ? "bad" : "ok"}`;
  card.querySelector(".status-headline").innerHTML =
    `<span aria-hidden="true">${s.isOverBudget ? "⚠️" : s.hasEntries ? "✅" : "🗓️"}</span> ` +
    `${s.label} · Income ${money(s.incomeTotal)} · Expense ${money(s.expenseTotal)} · ${s.status}`;
  card.querySelector(".status-detail").textContent =
    `${s.statusMessage} · budget ${money(s.budget)} (${s.budgetIsCustom ? "custom" : "carried forward + this month's income"}) · ${Math.round(s.budgetUsedPct)}% used`;

  setAmount($("tile-carried"), s.carriedForward);
  $("tile-carried-foot").textContent = `left over from ${previousMonthLabel(month)}`;
  setAmount($("tile-income"), s.incomeTotal);
  setAmount($("tile-expense"), s.expenseTotal);
  $("tile-upcoming").textContent = s.expenseUpcoming ? `${money(s.expenseUpcoming)} still due` : "";

  setAmount($("tile-balance"), s.balance);
  const sum = [`${money(s.carriedForward)}`, `+ ${money(s.incomeTotal)}`];
  if (s.loanIn) sum.push(`+ ${money(s.loanIn)} in`);
  sum.push(`− ${money(s.expenseTotal)}`);
  if (s.loanOut) sum.push(`− ${money(s.loanOut)} lent out`);
  $("tile-balance-foot").textContent = `${sum.join(" ")}, opens ${nextMonthLabel(month)}`;

  // Without a custom budget this tile would just repeat the balance.
  $("tile-budget-card").hidden = !s.budgetIsCustom;
  $("tile-budget-label").textContent = s.isOverBudget ? "Over budget by" : "Budget left";
  setAmount($("tile-budget"), s.isOverBudget ? s.overBy : s.remaining);

  const meter = $("budget-meter");
  meter.style.width = `${Math.min(100, s.budgetUsedPct)}%`;
  meter.classList.toggle("over", s.isOverBudget);
  $("budget-note").textContent = s.hasEntries
    ? `${money(s.available)} available this month, ${money(s.spent)} out so far${s.loanOut ? ` (${money(s.loanOut)} of it lent or paid back)` : ""}, ${money(s.expenseUpcoming)} still to come.`
    : `${money(s.carriedForward)} carried in. Add income and expenses to see this month take shape.`;

  // What you actually hold, plus what is out with friends.
  splitBars($("account-balances"), data.accounts.balances, state.options.accounts, "income");
  const { lent, borrowed } = data.lending;
  const parts = [];
  if (data.accounts.cardSpend) parts.push(`${money(data.accounts.cardSpend)} on the credit card`);
  if (lent.outstanding) parts.push(`🤝 ${money(lent.outstanding)} still with friends`);
  if (borrowed.outstanding) parts.push(`🙏 ${money(borrowed.outstanding)} you owe`);
  $("lending-line").textContent = parts.length
    ? `Plus ${parts.join(", ")}.`
    : "Nothing on the card, nothing owed either way.";

  splitBars($("income-split"), s.incomeByAccount, state.options.incomeAccounts, "income");
  splitBars($("expense-split"), s.expenseByMethod, state.options.expenseMethods, "expense");

  drawBreakdown(data.categories.expense, data.expenses, s.expenseTotal);
  drawTrend(data.trend);

  $("upcoming-count").textContent = data.upcoming.length;
  $("upcoming").replaceChildren(
    data.upcoming.length ? entryTable(data.upcoming, "expense") : empty("Nothing future dated in this month."),
  );
}

/** Spending by category. Tap a row to see the entries behind the number. */
function drawBreakdown(categories, entries, total) {
  const list = $("category-breakdown");
  list.innerHTML = "";
  if (!categories.length) {
    list.append(empty("Nothing spent this month yet."));
    return;
  }

  for (const row of categories) {
    const share = total > 0 ? (row.total / total) * 100 : 0;
    const item = document.createElement("li");
    item.className = "breakdown-row";
    item.innerHTML =
      `<button type="button" class="bar-name breakdown-toggle">` +
      `<span aria-hidden="true">${icon(row.category)}</span> ${row.category}` +
      `<span class="chev" aria-hidden="true">▸</span></button>` +
      `<span class="bar-value">${money(row.total)} <span class="muted small">${Math.round(share)}%</span></span>` +
      `<span class="bar-track"><span class="bar-fill expense" style="width:${share}%"></span></span>`;

    const detail = document.createElement("div");
    detail.className = "breakdown-detail";
    detail.hidden = true;
    detail.append(entryTable(entries.filter((entry) => entry.category === row.category), "expense"));
    item.append(detail);

    item.querySelector(".breakdown-toggle").addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      item.classList.toggle("open", !detail.hidden);
    });
    list.append(item);
  }
}

function drawTrend(trend) {
  const max = Math.max(1, ...trend.flatMap((row) => [row.income, row.expense]));
  const container = $("trend");
  container.innerHTML = "";
  for (const row of trend) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `trend-month${row.month === state.dashMonth ? " is-current" : ""}`;
    cell.innerHTML =
      `<div class="trend-pair">` +
      `<div class="trend-bar income" style="height:${(row.income / max) * 100}%" title="Income ${money(row.income)}"></div>` +
      `<div class="trend-bar expense" style="height:${(row.expense / max) * 100}%" title="Expense ${money(row.expense)}"></div>` +
      `</div><span class="trend-label">${row.label}</span>`;
    // Tap a month to jump the whole dashboard to it.
    cell.addEventListener("click", () => {
      if (state.months.includes(row.month)) {
        $("dash-month").value = row.month;
        loadDashboard(row.month);
      } else {
        toast(`Nothing recorded in ${row.label} yet.`, "bad");
      }
    });
    container.append(cell);
  }
}

// -------------------------------------------------------------------
// FRIENDS
// -------------------------------------------------------------------
async function loadFriends() {
  const data = await api("/loans");
  const { lent, borrowed, net } = data.totals;

  setAmount($("tile-owed-you"), lent.outstanding);
  $("tile-owed-you-foot").textContent = `${money(lent.total)} lent, ${money(lent.settled)} back`;
  setAmount($("tile-you-owe"), borrowed.outstanding);
  $("tile-you-owe-foot").textContent = `${money(borrowed.total)} taken, ${money(borrowed.settled)} paid back`;
  setAmount($("tile-net"), Math.abs(net));
  $("tile-net-foot").textContent = net > 0 ? "owed to you overall" : net < 0 ? "you owe overall" : "all square";

  const open = (rows) => rows.filter((loan) => loan.outstanding > 0);
  const openLent = open(data.lent);
  const openBorrowed = open(data.borrowed);
  const settled = data.loans.filter((loan) => loan.outstanding <= 0);

  $("loan-count-lent").textContent = openLent.length;
  $("loan-count-borrowed").textContent = openBorrowed.length;

  $("loan-list-lent").replaceChildren(
    ...(openLent.length ? openLent.map(loanCard) : [empty("Nobody owes you anything right now.")]),
  );
  $("loan-list-borrowed").replaceChildren(
    ...(openBorrowed.length ? openBorrowed.map(loanCard) : [empty("You do not owe anyone right now.")]),
  );
  $("loan-settled").replaceChildren(
    ...(settled.length ? settled.map(loanCard) : [empty("Settled loans will move here.")]),
  );
}

function loanCard(loan) {
  const style = DIRECTION[loan.direction] ?? DIRECTION.lent;
  const flow = flowFor(loan.direction);
  const card = document.createElement("div");
  card.className = `loan ${loan.direction} ${loan.outstanding <= 0 ? "settled" : ""}`;

  const head = document.createElement("div");
  head.className = "loan-head";
  head.innerHTML =
    `<div><span class="loan-name"><span aria-hidden="true">${style.icon}</span> ${loan.friend}</span>` +
    `<span class="tag ${loan.outstanding <= 0 ? "" : "due"}">${loan.status}</span>` +
    `<p class="muted small">${style.verb} ${money(loan.lent)} on ${dayLabel(loan.date)} · ` +
    `${flow.openLabel.toLowerCase()} ${icon(loan.paid_from)} ${loan.paid_from}` +
    `${loan.note ? ` · ${loan.note}` : ""}</p></div>` +
    `<div class="loan-amount"><strong>${money(loan.outstanding)}</strong><span class="muted small">${style.owes}</span></div>`;
  card.append(head);

  const meter = document.createElement("div");
  meter.className = "meter";
  meter.innerHTML = `<div class="meter-fill" style="width:${loan.repaidPct}%"></div>`;
  card.append(meter);

  const paid = document.createElement("p");
  paid.className = "muted small";
  paid.textContent = `${money(loan.repaid)} of ${money(loan.lent)} ${style.back}`;
  card.append(paid);

  if (loan.repayments.length) {
    const list = document.createElement("ul");
    list.className = "repayments";
    for (const row of loan.repayments) {
      const item = document.createElement("li");
      item.innerHTML =
        `<span>${dayLabel(row.date)} · ${money(row.amount)} ` +
        `${loan.direction === "borrowed" ? "from" : "into"} ${icon(row.received_in)} ${row.received_in}` +
        `${row.note ? ` · ${row.note}` : ""}</span>`;
      const actions = document.createElement("span");
      actions.className = "actions";
      actions.append(
        linkButton("Edit", () =>
          openEdit({
            title: loan.direction === "borrowed" ? "Edit payment" : "Edit repayment",
            kind: "repayment",
            row: { ...row, direction: loan.direction },
            onSave: async (body) => {
              await api(`/repayments/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
              toast("Repayment updated.");
              await refreshAll();
            },
          }),
        ),
        linkButton("Delete", async () => {
          await api(`/repayments/${row.id}`, { method: "DELETE" });
          toast("Repayment removed.");
          await refreshAll();
        }, "danger"),
      );
      item.append(actions);
      list.append(item);
    }
    card.append(list);
  }

  if (loan.outstanding > 0) card.append(repaymentForm(loan));

  const actions = document.createElement("div");
  actions.className = "row wrap loan-actions";
  actions.append(
    linkButton(loan.direction === "borrowed" ? "Edit" : "Edit loan", () =>
      openEdit({
        title: loan.direction === "borrowed" ? `Edit what you took from ${loan.friend}` : `Edit loan to ${loan.friend}`,
        kind: "loan",
        row: loan,
        onSave: async (body) => {
          await api(`/loans/${loan.id}`, { method: "PATCH", body: JSON.stringify({ ...body, direction: loan.direction }) });
          toast("Loan updated.");
          await refreshAll();
        },
      }),
    ),
    linkButton("Delete", async () => {
      await api(`/loans/${loan.id}`, { method: "DELETE" });
      toast(`Loan to ${loan.friend} deleted.`);
      await refreshAll();
    }, "danger"),
  );
  card.append(actions);
  return card;
}

function repaymentForm(loan) {
  const borrowed = loan.direction === "borrowed";
  const flow = flowFor(loan.direction);
  const form = document.createElement("form");
  form.className = "repay-form";
  form.innerHTML =
    `<div class="grid">` +
    `<label class="field">${borrowed ? "Amount paid back" : "Amount received"} <input type="number" name="amount" min="0.01" step="0.01" max="${loan.outstanding}" placeholder="${Math.round(loan.outstanding)}" required /></label>` +
    `<label class="field">Date <input type="date" name="date" value="${state.today}" required /></label>` +
    `</div>` +
    `<fieldset class="field"><legend>${flow.backLabel}</legend><div class="choices"></div></fieldset>` +
    `<div class="row wrap"><button class="primary" type="submit">${borrowed ? "Record payment" : "Record repayment"}</button>` +
    `<button class="ghost" type="button">${borrowed ? "Paid it all back" : "Paid in full"}</button></div>` +
    `<p class="form-msg"></p>`;

  fillChoices(form.querySelector(".choices"), flow.backValues, `receivedIn-${loan.id}`);

  const submit = async (amount) => {
    const body = {
      amount,
      date: form.date.value,
      receivedIn: form.querySelector(`input[name="receivedIn-${loan.id}"]:checked`).value,
    };
    try {
      await api(`/loans/${loan.id}/repayments`, { method: "POST", body: JSON.stringify(body) });
      toast(
        borrowed
          ? `${icon(body.receivedIn)} Paid ${money(amount)} back to ${loan.friend} from ${body.receivedIn}.`
          : `${icon(body.receivedIn)} ${money(amount)} back from ${loan.friend} into ${body.receivedIn}.`,
      );
      await refreshAll();
    } catch (error) {
      message(form.querySelector(".form-msg"), error.message, false);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit(form.amount.value);
  });
  form.querySelector("button.ghost").addEventListener("click", () => submit(loan.outstanding));
  return form;
}

// -------------------------------------------------------------------
// TRANSACTIONS
// -------------------------------------------------------------------
async function loadTransactions(month) {
  state.txMonth = month;
  const data = await api(`/month/${month}`);
  state.months = data.months;
  fillMonths($("tx-month"), month);

  const s = data.summary;
  $("budget-help").textContent = s.budgetIsCustom
    ? `${s.label} uses a custom budget of ${money(s.budget)}.`
    : `${s.label} compares spending against what it has to work with — ${money(s.carriedForward)} carried forward plus ${money(s.incomeTotal)} income, so ${money(s.available)}. Set your own limit to save part of it.`;
  $("budget-input").value = s.budgetIsCustom ? s.budget : "";
  $("budget-clear").classList.toggle("hidden", !s.budgetIsCustom);
  $("budget-msg").textContent = "";

  for (const [kind, target, rows] of [
    ["income", "tx-income", data.income],
    ["expense", "tx-expenses", data.expenses],
  ]) {
    $(target).replaceChildren(
      entryTable(rows, kind, {
        actions: true,
        onDelete: async (id) => {
          await api(`/${kind}/${id}`, { method: "DELETE" });
          toast(`Deleted that ${kind === "income" ? "income" : "expense"} entry.`);
          await refreshAll();
        },
        onEdit: (row) =>
          openEdit({
            title: kind === "income" ? "Edit income" : "Edit expense",
            kind,
            row,
            onSave: async (body) => {
              const saved = await api(`/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
              toast(`${icon(saved.entry.account ?? saved.entry.method)} Updated to ${money(saved.entry.amount)}.`);
              await refreshAll();
            },
          }),
      }),
    );
  }
}

// -------------------------------------------------------------------
// FORMS
// -------------------------------------------------------------------
async function refreshRecent() {
  const data = await api(`/month/${state.currentMonth}`);
  $("income-recent").replaceChildren(entryTable(data.income.slice(0, 8), "income"));
  $("expense-recent").replaceChildren(entryTable(data.expenses.slice(0, 8), "expense"));
}

/** Everything on screen depends on the same numbers, so redraw the lot. */
async function refreshAll() {
  const bootstrap = await api("/bootstrap");
  state.months = bootstrap.months;
  await loadDashboard(state.months.includes(state.dashMonth) ? state.dashMonth : state.currentMonth);
  if (state.txMonth) await loadTransactions(state.txMonth);
  await loadFriends();
  await refreshRecent();
}

function bindIncomeForm() {
  const form = $("income-form");
  form.date.value = state.today;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      date: form.date.value,
      amount: form.amount.value,
      account: form.querySelector('input[name="account"]:checked')?.value,
      category: form.querySelector('input[name="category"]:checked')?.value,
      note: form.note.value,
    };
    try {
      const result = await api("/income", { method: "POST", body: JSON.stringify(body) });
      const text = `${icon(result.entry.account)} Saved ${money(result.entry.amount)} into ${result.entry.account} on ${dayLabel(result.entry.date)}.`;
      message($("income-msg"), text);
      toast(text);
      form.reset();
      form.date.value = state.today;
      await refreshAll();
    } catch (error) {
      message($("income-msg"), error.message, false);
    }
  });
}

function bindExpenseForm() {
  const form = $("expense-form");
  form.date.value = state.today;

  const applyWhen = () => {
    const future = form.querySelector('input[name="when"]:checked').value === "future";
    form.date.min = future ? state.today : "";
    form.date.readOnly = !future;
    if (!future) form.date.value = state.today;
    else if (form.date.value <= state.today) {
      const next = new Date(`${state.today}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      form.date.value = next.toISOString().slice(0, 10);
    }
  };
  form.querySelectorAll('input[name="when"]').forEach((radio) => radio.addEventListener("change", applyWhen));
  applyWhen();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      date: form.date.value,
      amount: form.amount.value,
      method: form.querySelector('input[name="method"]:checked')?.value,
      category: form.querySelector('input[name="category"]:checked')?.value,
      note: form.note.value,
    };
    try {
      const result = await api("/expense", { method: "POST", body: JSON.stringify(body) });
      const s = result.summary;
      const text = `${icon(result.entry.method)} Saved ${money(result.entry.amount)} by ${result.entry.method} on ${dayLabel(result.entry.date)}.`;
      message($("expense-msg"), `${text} ${s.label}: ${s.status} — ${s.statusMessage}.`, !s.isOverBudget);
      toast(`${text} ${s.statusMessage}.`, s.isOverBudget ? "bad" : "ok");
      form.amount.value = "";
      form.note.value = "";
      await refreshAll();
    } catch (error) {
      message($("expense-msg"), error.message, false);
    }
  });
}

function bindLoanForm() {
  const form = $("loan-form");
  form.date.value = state.today;

  const direction = () => form.querySelector('input[name="direction"]:checked').value;

  // Lending and borrowing move money opposite ways, so the form retitles itself.
  const applyDirection = () => {
    const which = direction();
    const flow = flowFor(which);
    $("loan-friend-label").textContent = DIRECTION[which].who;
    $("loan-account-legend").textContent = flow.openLabel;
    $("loan-submit").textContent = DIRECTION[which].save;
    fillChips($("loan-sources"), flow.openValues, "paidFrom");
  };
  form.querySelectorAll('input[name="direction"]').forEach((radio) =>
    radio.addEventListener("change", applyDirection),
  );
  applyDirection();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const which = direction();
    const body = {
      direction: which,
      friend: form.friend.value,
      date: form.date.value,
      amount: form.amount.value,
      paidFrom: form.querySelector('input[name="paidFrom"]:checked')?.value,
      note: form.note.value,
    };
    try {
      const result = await api("/loans", { method: "POST", body: JSON.stringify(body) });
      const loan = result.loan;
      const text =
        loan.direction === "borrowed"
          ? `🙏 Borrowed ${money(loan.amount)} from ${loan.friend} into ${loan.paidFrom}.`
          : `🤝 Lent ${money(loan.amount)} to ${loan.friend} from ${loan.paidFrom}.`;
      message($("loan-msg"), text);
      toast(text);
      form.reset();
      form.date.value = state.today;
      applyDirection();
      await refreshAll();
    } catch (error) {
      message($("loan-msg"), error.message, false);
    }
  });
}

function bindBudget() {
  $("budget-save").addEventListener("click", async () => {
    try {
      const value = $("budget-input").value;
      if (value === "") throw new Error("Enter a budget amount first.");
      await api("/budget", { method: "PUT", body: JSON.stringify({ month: state.txMonth, amount: value }) });
      message($("budget-msg"), `Budget for ${monthLabel(state.txMonth)} set to ${money(value)}.`);
      await refreshAll();
    } catch (error) {
      message($("budget-msg"), error.message, false);
    }
  });

  $("budget-clear").addEventListener("click", async () => {
    await api("/budget", { method: "PUT", body: JSON.stringify({ month: state.txMonth, amount: null }) });
    message($("budget-msg"), "Back to using this month's income as the budget.");
    await refreshAll();
  });
}

// -------------------------------------------------------------------
// BOOT
// -------------------------------------------------------------------
function bindTabs() {
  $("tabs").addEventListener("click", async (event) => {
    const tab = event.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".page").forEach((page) =>
      page.classList.toggle("hidden", page.id !== `page-${tab.dataset.page}`),
    );
    if (tab.dataset.page === "transactions") await loadTransactions(state.txMonth || state.currentMonth);
    if (tab.dataset.page === "dashboard") await loadDashboard(state.dashMonth || state.currentMonth);
    if (tab.dataset.page === "friends") await loadFriends();
    if (tab.dataset.page === "income" || tab.dataset.page === "expense") await refreshRecent();
  });
}

function paintBrandMark() {
  const mark = $("brand-mark");
  mark.textContent = state.currency;
  mark.classList.toggle("wide", state.currency.length > 1);
}

function bindCurrency() {
  const input = $("currency");
  input.value = state.currency;
  paintBrandMark();
  input.addEventListener("change", async () => {
    state.currency = input.value.trim() || DEFAULT_CURRENCY;
    input.value = state.currency;
    localStorage.setItem("currency", state.currency);
    paintBrandMark();
    await refreshAll();
  });
}

async function boot() {
  const bootstrap = await api("/bootstrap");
  state.today = bootstrap.today;
  state.currentMonth = bootstrap.currentMonth;
  state.months = bootstrap.months;
  state.options = bootstrap.options;
  state.dashMonth = bootstrap.currentMonth;
  state.txMonth = bootstrap.currentMonth;

  fillChoices($("income-accounts"), state.options.incomeAccounts, "account");
  fillChoices($("expense-methods"), state.options.expenseMethods, "method");
  fillChips($("income-categories"), state.options.incomeCategories, "category");
  fillChips($("expense-categories"), state.options.expenseCategories, "category");
  fillQuick(document.querySelector('[data-quick="income"]'), $("income-form").amount);
  fillQuick(document.querySelector('[data-quick="expense"]'), $("expense-form").amount);
  fillQuick(document.querySelector('[data-quick="loan"]'), $("loan-form").amount);

  bindTabs();
  bindCurrency();
  bindEditDialog();
  bindIncomeForm();
  bindExpenseForm();
  bindLoanForm();
  bindBudget();

  $("dash-month").addEventListener("change", (event) => loadDashboard(event.target.value));
  $("tx-month").addEventListener("change", (event) => loadTransactions(event.target.value));

  await loadDashboard(state.currentMonth);
  await loadFriends();
  await refreshRecent();
}

boot().catch((error) => {
  $("status-card").className = "status-card bad";
  $("status-card").querySelector(".status-headline").textContent = "Could not reach the API";
  $("status-card").querySelector(".status-detail").textContent = error.message;
});
