// Front-end for the money tracker. Talks to the Worker API under /api.

const DEFAULT_CURRENCY = "AED";

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
  // Expense categories
  "ADCB Loan": "🏛️",
  "CBD EMI": "📆",
  "Mashreq EMI": "📆",
  "ADCB EMI": "📆",
  "DIB EMI": "📆",
  "Home pay": "🏠",
  Friend: "🤝",
  Food: "🍽️",
  "ADCB Outstanding": "🧾",
  "CBD Outstanding": "🧾",
  "Mashreq Outstanding": "🧾",
  Entertainment: "🎬",
  Other: "📌",
  "Active EMI ADCB": "🔁",
  "Active EMI CBD": "🔁",
  "Active EMI Mashreq": "🔁",
  "Active EMI DIB": "🔁",
  // Categories retired from the pickers, still worn by older entries
  Groceries: "🛒",
  Rent: "🏠",
  Bills: "💡",
  Transport: "🚗",
  Shopping: "🛍️",
  Health: "🩺",
  Education: "🎓",
  EMI: "📆",
};

const QUICK_AMOUNTS = [50, 100, 500, 1000];

const state = {
  today: new Date().toISOString().slice(0, 10),
  currentMonth: "",
  months: [],
  options: {},
  currency: localStorage.getItem("currency") || DEFAULT_CURRENCY,
  month: "",
  data: null,
};

const $ = (id) => document.getElementById(id);
const icon = (name) => ICONS[name] ?? "•";

function money(value) {
  const rounded = Math.round(Number(value) || 0);
  return `${state.currency} ${rounded.toLocaleString("en-US")}`;
}

function monthLabel(key) {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [year, month] = key.split("-");
  return `${names[Number(month) - 1]} ${year}`;
}

function shortMonth(key) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month] = key.split("-");
  return `${names[Number(month) - 1]} ${year}`;
}

function dayLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${day} ${shortMonth(`${year}-${month}`)}`;
}

async function api(path, options) {
  const response = await fetch(`/api${path}`, { headers: { "content-type": "application/json" }, ...options });
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
    const progress = Math.min(1, (now - started) / 450);
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
// PIECES
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

function fillChips(container, values, name, checked) {
  container.innerHTML = "";
  values.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "chip";
    const isOn = checked ? value === checked : index === 0;
    label.innerHTML =
      `<input type="radio" name="${name}" value="${value}"${isOn ? " checked" : ""} />` +
      `<span><span aria-hidden="true">${icon(value)}</span>${value}</span>`;
    container.append(label);
  });
}

/** Tap to add a round number instead of typing it. */
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

/** One row of the dashboard's income or expense list. */
function lineRow({ label, total, share, kind }) {
  const li = document.createElement("li");
  li.innerHTML =
    `<span class="line-icon" aria-hidden="true">${icon(label)}</span>` +
    `<span><span class="line-label">${label}</span></span>` +
    `<span class="line-value ${kind}">${kind === "in" ? "+" : "−"}${money(total)}</span>` +
    `<span class="line-track"><span class="${kind}" style="width:${share}%"></span></span>`;
  return li;
}

function entryRow(row, kind) {
  const income = kind === "income";
  const where = income ? row.account : row.method;
  const item = document.createElement("div");
  item.className = "entry";
  item.innerHTML =
    `<span class="line-icon" aria-hidden="true">${icon(row.category)}</span>` +
    `<div class="entry-main">` +
    `<p class="entry-title">${row.category}` +
    `${row.friend ? `<span class="tag friend">🤝 ${row.friend}</span>` : ""}` +
    `${!income && !row.paid ? '<span class="tag due">⏳ to pay</span>' : ""}</p>` +
    `<p class="entry-sub">${dayLabel(row.date)} · ${icon(where)} ${where}${row.note ? ` · ${row.note}` : ""}</p>` +
    `</div>`;

  const right = document.createElement("div");
  right.className = "entry-right";
  right.innerHTML = `<span class="entry-amount ${income ? "in" : "out"}">${income ? "+" : "−"}${money(row.amount)}</span>`;

  const actions = document.createElement("div");
  actions.className = "entry-actions";

  // An expected payment can be settled from the row it sits on.
  if (!income && !row.paid) {
    const settle = document.createElement("button");
    settle.type = "button";
    settle.className = "link";
    settle.textContent = "Mark paid";
    settle.addEventListener("click", async () => {
      await api(`/expense/${row.id}/paid`, { method: "PATCH", body: JSON.stringify({ paid: true }) });
      toast(`Paid ${money(row.amount)} by ${row.method}.`);
      await loadMonth(state.month);
    });
    actions.append(settle);
  }

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "link";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => openEdit(kind, row));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "link danger";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await api(`/${kind}/${row.id}`, { method: "DELETE" });
    toast("Entry deleted.");
    await loadMonth(state.month);
  });
  actions.append(edit, remove);
  right.append(actions);
  item.append(right);
  return item;
}

// -------------------------------------------------------------------
// EDIT DIALOG
// -------------------------------------------------------------------
let editSubmit = null;

/** The pickers plus whatever this entry already wears, so nothing is lost on edit. */
function withOwn(values, category) {
  return category && !values.includes(category) ? [...values, category] : values;
}

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
      values: withOwn(income ? state.options.incomeCategories : state.options.expenseCategories, row.category),
      value: row.category,
    },
    { type: "text", name: "friend", label: "Friend", value: row.friend ?? "" },
    { type: "text", name: "note", label: "Note", value: row.note },
  ];

  if (!income) {
    fields.splice(3, 0, {
      type: "radio",
      name: "paid",
      label: "Has it been paid?",
      values: ["Paid", "Still to pay"],
      value: row.paid ? "Paid" : "Still to pay",
    });
  }

  const holder = $("edit-fields");
  $("edit-title").textContent = income ? "Edit income" : "Edit expense";
  $("edit-msg").textContent = "";
  holder.innerHTML = "";

  for (const field of fields) {
    if (field.type === "radio" || field.type === "chips") {
      const set = document.createElement("fieldset");
      set.className = "field";
      set.innerHTML = `<legend>${field.label}</legend><div class="${field.type === "chips" ? "chips" : "choices"}"></div>`;
      (field.type === "chips" ? fillChips : fillChoices)(set.querySelector("div"), field.values, field.name, field.value);
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
    if (!income) body.paid = body.paid === "Paid" ? 1 : 0;
    const saved = await api(`/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
    toast(`Updated to ${money(saved.entry.amount)}.`);
    await loadMonth(state.month);
  };
  $("edit-dialog").showModal();
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
    option.textContent = shortMonth(key);
    option.selected = key === selected;
    select.append(option);
  }
}

function drawLines(container, rows, kind, emptyText) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(empty(emptyText));
    return;
  }
  const max = Math.max(...rows.map((row) => row.total));
  for (const row of rows) {
    container.append(lineRow({ ...row, share: (row.total / max) * 100, kind }));
  }
}

function drawFriends(rows) {
  const list = $("friends-list");
  list.replaceChildren();
  if (!rows.length) {
    list.append(empty("No names on any entry yet. Add one when money moves between you and a friend."));
    $("friends-net").textContent = "";
    return;
  }

  const net = rows.reduce((sum, row) => sum + row.net, 0);
  $("friends-net").textContent = net === 0 ? "all square" : `${money(Math.abs(net))} ${net > 0 ? "owed to you" : "you owe"}`;
  $("friends-net").className = `card-total ${net >= 0 ? "in" : "out"}`;

  const max = Math.max(1, ...rows.map((row) => Math.abs(row.net)));
  for (const row of rows) {
    const settled = row.net === 0;
    const theyOwe = row.net > 0;
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="line-icon" aria-hidden="true">🤝</span>` +
      `<span><span class="line-label">${row.friend}</span>` +
      `<span class="line-sub">${money(row.out)} out · ${money(row.back)} back</span></span>` +
      `<span class="line-value ${settled ? "" : theyOwe ? "in" : "out"}">` +
      `${settled ? "settled" : money(Math.abs(row.net))}</span>` +
      `<span class="line-track"><span class="${theyOwe ? "in" : "out"}" ` +
      `style="width:${(Math.abs(row.net) / max) * 100}%"></span></span>`;
    list.append(li);
  }
}

async function loadMonth(month) {
  state.month = month;
  const data = await api(`/month/${month}`);
  state.data = data;
  state.months = data.months;
  fillMonths(month);

  const s = data.summary;
  $("month-title").textContent = monthLabel(month);
  $("eyebrow").textContent = month === state.currentMonth ? "This month" : "Looking back at";

  // Hero: the one number the whole app is for.
  const hero = $("hero");
  hero.classList.toggle("over", s.isOverBudget);
  setAmount($("hero-balance"), s.balance);
  $("hero-sum").textContent = `${money(s.incomeTotal)} in − ${money(s.expenseTotal)} out`;
  setAmount($("hero-income"), s.incomeTotal);
  setAmount($("hero-expense"), s.expenseTotal);
  $("hero-bar-fill").style.width = `${Math.min(100, s.usedPct)}%`;
  const stillToPay = s.expensePending ? ` ${money(s.expensePending)} of it is still to pay.` : "";
  $("hero-note").textContent = s.hasEntries
    ? (s.isOverBudget
        ? `${s.statusMessage} — spending passed what came in this month.`
        : `${s.statusMessage}. ${Math.round(s.usedPct)}% of this month's income is spent.`) + stillToPay
    : "Nothing recorded yet. Add some income or an expense to start the month.";

  // Wallets: what is actually there, counting every month up to this one.
  const accounts = data.accounts;
  setAmount($("wallet-cash"), accounts.balances["Cash in Hand"]);
  setAmount($("wallet-bank"), accounts.balances.Bank);

  // The card is a bill, not an account: charges sit pending until the bank pays them.
  const card = accounts.card;
  setAmount($("wallet-card"), card.pending);
  $("wallet-card-sub").textContent = card.charged
    ? `${money(card.charged)} charged · ${money(card.paid)} paid`
    : "nothing charged yet";
  $("card-wallet").hidden = card.charged === 0 && card.pending === 0;

  const settle = $("card-settle");
  settle.hidden = card.pendingAllTime <= 0;
  $("card-form").amount.max = card.pendingAllTime;
  $("card-form").amount.placeholder = Math.round(card.pendingAllTime);
  $("card-payments").replaceChildren(
    ...(data.cardPayments.length
      ? data.cardPayments.map(cardPaymentRow)
      : [empty("No card payments in this month.")]),
  );

  const opening = accounts.opening ?? {};
  const openingForm = $("opening-form");
  openingForm.elements["Cash in Hand"].value = opening["Cash in Hand"] || "";
  openingForm.elements.Bank.value = opening.Bank || "";

  const started = (opening["Cash in Hand"] || 0) + (opening.Bank || 0);
  $("wallet-note").textContent =
    `Running totals to the end of ${shortMonth(month)}` +
    (started ? ` · ${money(started)} opening balance included` : "") +
    (card.pending > 0 ? ` · the card bill is paid from the bank` : "");

  // Dashboard lines.
  drawLines($("dash-income"), data.incomeLines, "in", "No income this month yet.");
  drawLines($("dash-expense"), data.expenseLines, "out", "No expenses this month yet.");
  $("dash-income-total").textContent = `+${money(s.incomeTotal)}`;
  $("dash-expense-total").textContent = `−${money(s.expenseTotal)}`;
  $("dash-expense-sub").textContent = s.expensePending
    ? `${money(s.expensePaid)} paid · ${money(s.expensePending)} still to pay`
    : s.expenseTotal
      ? "all paid"
      : "";

  // Expected payments: recorded, but nothing has left an account yet.
  const toPay = data.toPay ?? [];
  $("to-pay-card").hidden = toPay.length === 0;
  $("to-pay-total").textContent = `−${money(s.expensePending)}`;
  $("to-pay").replaceChildren(...toPay.map((row) => entryRow(row, "expense")));

  const balance = $("dash-balance");
  balance.textContent = money(s.balance);
  balance.className = `card-total ${s.balance < 0 ? "negative" : ""}`;
  $("dash-balance-note").textContent = `${money(s.incomeTotal)} income − ${money(s.expenseTotal)} expense. ${shortMonth(month)} stands on its own; next month starts fresh.`;

  // The two lists, on their own tabs.
  $("income-total").textContent = `+${money(s.incomeTotal)}`;
  $("expense-total").textContent = `−${money(s.expenseTotal)}`;
  $("income-list").replaceChildren(
    ...(data.income.length ? data.income.map((row) => entryRow(row, "income")) : [empty("Nothing yet this month.")]),
  );
  $("expense-list").replaceChildren(
    ...(data.expenses.length ? data.expenses.map((row) => entryRow(row, "expense")) : [empty("Nothing yet this month.")]),
  );

  drawFriends(data.friends ?? []);
}

function cardPaymentRow(row) {
  const item = document.createElement("div");
  item.className = "entry";
  item.innerHTML =
    `<span class="line-icon" aria-hidden="true">💳</span>` +
    `<div class="entry-main"><p class="entry-title">Card payment</p>` +
    `<p class="entry-sub">${dayLabel(row.date)} · from 🏦 Bank${row.note ? ` · ${row.note}` : ""}</p></div>`;

  const right = document.createElement("div");
  right.className = "entry-right";
  right.innerHTML = `<span class="entry-amount">${money(row.amount)}</span>`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "link danger";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await api(`/card-payments/${row.id}`, { method: "DELETE" });
    toast("Card payment removed.");
    await loadMonth(state.month);
  });
  right.append(remove);
  item.append(right);
  return item;
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
      ...(kind === "expense" ? { paid: form.querySelector('input[name="paid"]:checked')?.value } : {}),
    };
    try {
      const result = await api(`/${kind}`, { method: "POST", body: JSON.stringify(body) });
      const where = result.entry[field];
      const who = result.entry.friend ? ` ${kind === "income" ? "from" : "to"} ${result.entry.friend}` : "";
      const pending = kind === "expense" && !result.entry.paid;
      const text = pending
        ? `⏳ ${money(result.entry.amount)} to pay by ${where}${who}`
        : `${icon(where)} ${money(result.entry.amount)} ${kind === "income" ? "into" : "by"} ${where}${who}`;
      message($(`${kind}-msg`), `${text}. ${result.summary.statusMessage}.`, !result.summary.isOverBudget);
      toast(`${text}. ${result.summary.statusMessage}.`, result.summary.isOverBudget ? "bad" : "ok");
      form.reset();
      form.date.value = state.today;
      await loadMonth(state.month);
    } catch (error) {
      message($(`${kind}-msg`), error.message, false);
    }
  });
}

function bindOpeningForm() {
  const form = $("opening-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    try {
      const result = await api("/opening", { method: "PUT", body: JSON.stringify(body) });
      const text = `Opening balance saved: ${money(result.opening["Cash in Hand"])} cash, ${money(result.opening.Bank)} bank.`;
      message($("opening-msg"), text);
      toast(text);
      await loadMonth(state.month);
    } catch (error) {
      message($("opening-msg"), error.message, false);
    }
  });
}

function bindCardForm() {
  const form = $("card-form");
  form.date.value = state.today;

  const send = async (amount) => {
    try {
      const result = await api("/card-payments", {
        method: "POST",
        body: JSON.stringify({ amount, date: form.date.value, note: form.note.value }),
      });
      const left = result.accounts.card.pendingAllTime;
      const text = `💳 Paid ${money(result.payment.amount)} off the card from the bank.`;
      message($("card-msg"), `${text} ${left > 0 ? `${money(left)} still pending.` : "Nothing pending now."}`);
      toast(text);
      form.reset();
      form.date.value = state.today;
      await loadMonth(state.month);
    } catch (error) {
      message($("card-msg"), error.message, false);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send(form.amount.value);
  });
  $("card-full").addEventListener("click", () => send(Number(form.amount.max)));
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
    message($("reset-msg"), `Cleared ${result.cleared} entries. Starting fresh.`);
    toast("Everything cleared.");
    await boot();
  });
}

// -------------------------------------------------------------------
// BOOT
// -------------------------------------------------------------------
function bindTabs() {
  $("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (!tab) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".page").forEach((page) =>
      page.classList.toggle("hidden", page.id !== `page-${tab.dataset.page}`),
    );
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
}

function bindCurrency() {
  const input = $("currency");
  input.value = state.currency;
  input.addEventListener("change", async () => {
    state.currency = input.value.trim() || DEFAULT_CURRENCY;
    input.value = state.currency;
    localStorage.setItem("currency", state.currency);
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
  state.month = state.months.includes(state.month) ? state.month : bootstrap.currentMonth;
  $("friend-names").innerHTML = (bootstrap.friends ?? []).map((name) => `<option value="${name}"></option>`).join("");

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
    bindOpeningForm();
    bindCardForm();
    bindReset();
    $("month-picker").addEventListener("change", (event) => loadMonth(event.target.value));
  }

  await loadMonth(state.month);
}

boot().catch((error) => {
  $("hero-note").textContent = `Could not reach the API: ${error.message}`;
});
