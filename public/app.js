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

const state = {
  today: new Date().toISOString().slice(0, 10),
  currentMonth: "",
  months: [],
  options: {},
  currency: localStorage.getItem("currency") || DEFAULT_CURRENCY,
  month: "",
};

const $ = (id) => document.getElementById(id);
const icon = (name) => ICONS[name] ?? "•";

function money(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${state.currency} ${rounded.toLocaleString("en-US")}`;
}

function monthLabel(key) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month] = key.split("-");
  return `${names[Number(month) - 1]} ${year}`;
}

function shiftMonth(key, count) {
  const [year, month] = key.split("-").map(Number);
  const total = year * 12 + (month - 1) + count;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function dayLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${day} ${monthLabel(`${year}-${month}`)}`;
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
function fillChoices(container, values, name, checked) {
  container.innerHTML = "";
  values.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    const isOn = checked ? value === checked : index === 0;
    label.innerHTML =
      `<input type="radio" name="${name}" value="${value}"${isOn ? " checked" : ""} />` +
      `<span><span aria-hidden="true">${icon(value)}</span> ${value}</span>`;
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

function linkButton(text, onClick, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `link ${variant}`.trim();
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function entryTable(rows, kind) {
  if (!rows.length) {
    return empty(kind === "income" ? "No income recorded in this month." : "No expenses recorded in this month.");
  }

  const source = kind === "income" ? "account" : "method";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML =
    `<thead><tr><th>Date</th><th>${kind === "income" ? "Account" : "Paid by"}</th>` +
    `<th>Category</th><th>Friend</th><th>Note</th><th class="amount">Amount</th><th></th></tr></thead>`;

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const due = kind === "expense" && row.date > state.today ? ' <span class="tag due">due</span>' : "";
    tr.innerHTML =
      `<td>${dayLabel(row.date)}${due}</td>` +
      `<td><span aria-hidden="true">${icon(row[source])}</span> ${row[source]}</td>` +
      `<td><span class="tag"><span aria-hidden="true">${icon(row.category)}</span> ${row.category}</span></td>` +
      `<td>${row.friend ? `<span class="tag friend">🤝 ${row.friend}</span>` : ""}</td>` +
      `<td>${row.note || ""}</td>` +
      `<td class="amount">${money(row.amount)}</td>`;

    const cell = document.createElement("td");
    cell.className = "actions";
    cell.append(
      linkButton("Edit", () => openEdit(kind, row)),
      linkButton("Delete", async () => {
        await api(`/${kind}/${row.id}`, { method: "DELETE" });
        toast(`Deleted that ${kind} entry.`);
        await loadMonth(state.month);
      }, "danger"),
    );
    tr.append(cell);
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

// -------------------------------------------------------------------
// EDIT DIALOG
// -------------------------------------------------------------------
let editSubmit = null;

function openEdit(kind, row) {
  const income = kind === "income";
  const fields = [
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    {
      type: "radio",
      name: income ? "account" : "method",
      label: income ? "Received in" : "Paid by",
      values: income ? state.options.incomeAccounts : state.options.expenseMethods,
      value: income ? row.account : row.method,
    },
    {
      type: "chips",
      name: "category",
      label: "Category",
      values: income ? state.options.incomeCategories : state.options.expenseCategories,
      value: row.category,
    },
    { type: "text", name: "friend", label: "Friend", value: row.friend ?? "" },
    { type: "text", name: "note", label: "Note", value: row.note },
  ];

  const dialog = $("edit-dialog");
  const holder = $("edit-fields");
  $("edit-title").textContent = income ? "Edit income" : "Edit expense";
  $("edit-msg").textContent = "";
  holder.innerHTML = "";

  for (const field of fields) {
    if (field.type === "radio" || field.type === "chips") {
      const set = document.createElement("fieldset");
      set.className = "field";
      set.innerHTML = `<legend>${field.label}</legend><div class="${field.type === "chips" ? "chips" : "choices"}"></div>`;
      const target = set.querySelector("div");
      (field.type === "chips" ? fillChips : fillChoices)(target, field.values, field.name, field.value);
      holder.append(set);
      continue;
    }

    const label = document.createElement("label");
    label.className = "field";
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = field.type;
    input.name = field.name;
    input.value = field.value ?? "";
    if (field.type === "number") {
      input.min = "0.01";
      input.step = "0.01";
    }
    label.append(input);
    holder.append(label);
  }

  editSubmit = async (body) => {
    const saved = await api(`/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    toast(`Updated to ${money(saved.entry.amount)}.`);
    await loadMonth(state.month);
  };
  dialog.showModal();
}

function bindEditDialog() {
  const dialog = $("edit-dialog");
  $("edit-cancel").addEventListener("click", () => dialog.close());
  $("edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target).entries());
    try {
      await editSubmit(body);
      dialog.close();
    } catch (error) {
      message($("edit-msg"), error.message, false);
    }
  });
}

// -------------------------------------------------------------------
// THE MONTH
// -------------------------------------------------------------------
function fillMonths(selected) {
  const select = $("month-picker");
  select.innerHTML = "";
  for (const key of state.months) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = monthLabel(key);
    option.selected = key === selected;
    select.append(option);
  }
}

async function loadMonth(month) {
  state.month = month;
  const data = await api(`/month/${month}`);
  state.months = data.months;
  fillMonths(month);

  const s = data.summary;
  const card = $("status-card");
  card.className = `status-card ${s.isOverBudget ? "bad" : "ok"}`;
  card.querySelector(".status-headline").innerHTML =
    `<span aria-hidden="true">${s.isOverBudget ? "⚠️" : s.hasEntries ? "✅" : "🗓️"}</span> ` +
    `${s.label} · Income ${money(s.incomeTotal)} · Expense ${money(s.expenseTotal)} · ${s.status}`;
  card.querySelector(".status-detail").textContent = s.statusMessage;

  setAmount($("tile-carried"), s.carriedForward);
  $("tile-carried-foot").textContent = `left over from ${monthLabel(shiftMonth(month, -1))}`;
  setAmount($("tile-income"), s.incomeTotal);
  setAmount($("tile-expense"), s.expenseTotal);
  setAmount($("tile-balance"), s.balance);
  $("tile-balance-foot").textContent =
    `${money(s.carriedForward)} + ${money(s.incomeTotal)} − ${money(s.expenseTotal)}, opens ${monthLabel(shiftMonth(month, 1))}`;

  const meter = $("meter");
  meter.style.width = `${Math.min(100, s.usedPct)}%`;
  meter.classList.toggle("over", s.isOverBudget);
  $("month-note").textContent = s.hasEntries
    ? `${money(s.available)} available this month, ${Math.round(s.usedPct)}% of it spent.`
    : `${money(s.carriedForward)} carried in. Add income and expenses to see this month take shape.`;

  drawFriends(data.friends ?? []);

  $("income-count").textContent = data.income.length;
  $("expense-count").textContent = data.expenses.length;
  $("month-income").replaceChildren(entryTable(data.income, "income"));
  $("month-expenses").replaceChildren(entryTable(data.expenses, "expense"));
}

/** Who is holding your money, and who you have squared up with. */
function drawFriends(rows) {
  const panel = $("friends-panel");
  panel.hidden = rows.length === 0;
  if (!rows.length) return;

  $("friends-count").textContent = rows.filter((row) => row.net !== 0).length;

  const max = Math.max(1, ...rows.map((row) => Math.abs(row.net)));
  const list = document.createElement("ul");
  list.className = "bars";

  for (const row of rows) {
    const settled = row.net === 0;
    const theyOwe = row.net > 0;
    const item = document.createElement("li");
    item.innerHTML =
      `<span class="bar-name"><span aria-hidden="true">🤝</span> ${row.friend}</span>` +
      `<span class="bar-value">${settled ? "settled" : money(Math.abs(row.net))}` +
      `<span class="muted small"> ${settled ? "" : theyOwe ? "they owe" : "you owe"}</span></span>` +
      `<span class="bar-track"><span class="bar-fill ${theyOwe ? "income" : "expense"}" ` +
      `style="width:${(Math.abs(row.net) / max) * 100}%"></span></span>` +
      `<span class="muted small friend-detail">${money(row.out)} out · ${money(row.back)} back</span>`;
    list.append(item);
  }
  $("friends-list").replaceChildren(list);
}

// -------------------------------------------------------------------
// FORMS
// -------------------------------------------------------------------
function bindEntryForm(kind) {
  const form = $(`${kind}-form`);
  const field = kind === "income" ? "account" : "method";
  form.date.value = state.today;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      date: form.date.value,
      amount: form.amount.value,
      [field]: form.querySelector(`input[name="${field}"]:checked`)?.value,
      category: form.querySelector('input[name="category"]:checked')?.value,
      friend: form.friend.value,
      note: form.note.value,
    };
    try {
      const result = await api(`/${kind}`, { method: "POST", body: JSON.stringify(body) });
      const where = result.entry[field];
      const who = result.entry.friend ? ` ${kind === "income" ? "from" : "to"} ${result.entry.friend}` : "";
      const text = `${icon(where)} Saved ${money(result.entry.amount)} ${kind === "income" ? "into" : "by"} ${where}${who} on ${dayLabel(result.entry.date)}.`;
      message($(`${kind}-msg`), `${text} ${result.summary.label}: ${result.summary.statusMessage}.`, !result.summary.isOverBudget);
      toast(`${text} ${result.summary.statusMessage}.`, result.summary.isOverBudget ? "bad" : "ok");
      form.reset();
      form.date.value = state.today;
      await loadMonth(state.month);
    } catch (error) {
      message($(`${kind}-msg`), error.message, false);
    }
  });
}

/** Two taps to wipe the tracker, never one. */
function bindReset() {
  const button = $("reset-btn");
  let armed = false;

  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "Tap again to delete everything";
      button.classList.add("armed");
      message($("reset-msg"), "This cannot be undone.", false);
      setTimeout(() => {
        armed = false;
        button.textContent = "Delete everything";
        button.classList.remove("armed");
        $("reset-msg").textContent = "";
      }, 5000);
      return;
    }

    const result = await api("/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) });
    armed = false;
    button.textContent = "Delete everything";
    button.classList.remove("armed");
    message($("reset-msg"), `Cleared ${result.cleared} entr${result.cleared === 1 ? "y" : "ies"}. Starting fresh.`);
    toast("Everything cleared.");
    await boot();
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
    if (tab.dataset.page === "month") await loadMonth(state.month || state.currentMonth);
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
    await loadMonth(state.month);
  });
}

let wired = false;

async function boot() {
  const bootstrap = await api("/bootstrap");
  state.today = bootstrap.today;
  state.currentMonth = bootstrap.currentMonth;
  state.months = bootstrap.months;
  state.options = bootstrap.options;
  $("friend-names").innerHTML = (bootstrap.friends ?? [])
    .map((name) => `<option value="${name}"></option>`)
    .join("");
  state.month = state.months.includes(state.month) ? state.month : bootstrap.currentMonth;

  fillChoices($("income-accounts"), state.options.incomeAccounts, "account");
  fillChoices($("expense-methods"), state.options.expenseMethods, "method");
  fillChips($("income-categories"), state.options.incomeCategories, "category");
  fillChips($("expense-categories"), state.options.expenseCategories, "category");

  if (!wired) {
    wired = true;
    fillQuick(document.querySelector('[data-quick="income"]'), $("income-form").amount);
    fillQuick(document.querySelector('[data-quick="expense"]'), $("expense-form").amount);
    bindTabs();
    bindCurrency();
    bindEditDialog();
    bindEntryForm("income");
    bindEntryForm("expense");
    bindReset();
    $("month-picker").addEventListener("change", (event) => loadMonth(event.target.value));
  }

  await loadMonth(state.month);
}

boot().catch((error) => {
  $("status-card").className = "status-card bad";
  $("status-card").querySelector(".status-headline").textContent = "Could not reach the API";
  $("status-card").querySelector(".status-detail").textContent = error.message;
});
