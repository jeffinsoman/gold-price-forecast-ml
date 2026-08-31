// Front-end for the Income vs Expense Tracker. Talks to the Worker API under /api.

const DEFAULT_CURRENCY = "AED";

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
      `<td>${dayLabel(row.date)}${due}</td><td>${row[source]}</td>` +
      `<td><span class="tag">${row.category}</span></td><td>${row.note || ""}</td>` +
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
      `<span class="bar-name">${key}</span><span class="bar-value">${money(value)}</span>` +
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
    { type: "select", name: "category", label: "Category", values: state.options.incomeCategories, value: row.category },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  expense: (row) => [
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    { type: "radio", name: "method", label: "Paid by", values: state.options.expenseMethods, value: row.method },
    { type: "select", name: "category", label: "Category", values: state.options.expenseCategories, value: row.category },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  loan: (row) => [
    { type: "text", name: "friend", label: "Friend", value: row.friend },
    { type: "date", name: "date", label: "Date", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    { type: "radio", name: "paidFrom", label: "Paid from", values: state.options.loanSources, value: row.paid_from },
    { type: "text", name: "note", label: "Note", value: row.note },
  ],
  repayment: (row) => [
    { type: "date", name: "date", label: "Date received", value: row.date },
    { type: "number", name: "amount", label: "Amount", value: row.amount },
    { type: "radio", name: "receivedIn", label: "Received in", values: state.options.accounts, value: row.received_in },
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
  card.querySelector(".status-headline").textContent =
    `${s.label} · Income ${money(s.incomeTotal)} · Expense ${money(s.expenseTotal)} · ${s.status}`;
  card.querySelector(".status-detail").textContent =
    `${s.statusMessage} · budget ${money(s.budget)} (${s.budgetIsCustom ? "custom" : "this month's income"}) · ${Math.round(s.budgetUsedPct)}% used`;

  $("tile-carried").textContent = money(s.carriedForward);
  $("tile-carried-foot").textContent = `left over from ${previousMonthLabel(month)}`;
  $("tile-income").textContent = money(s.incomeTotal);
  $("tile-expense").textContent = money(s.expenseTotal);
  $("tile-upcoming").textContent = s.expenseUpcoming ? `${money(s.expenseUpcoming)} still due` : "";

  const balance = $("tile-balance");
  balance.textContent = money(s.balance);
  balance.classList.toggle("negative", s.balance < 0);

  const closing = $("tile-closing");
  closing.textContent = money(s.closingBalance);
  closing.classList.toggle("negative", s.closingBalance < 0);
  $("tile-closing-foot").textContent = `opens ${nextMonthLabel(month)}`;

  $("tile-budget-label").textContent = s.isOverBudget ? "Over budget by" : "Budget left";
  $("tile-budget").textContent = money(s.isOverBudget ? s.overBy : s.remaining);

  const meter = $("budget-meter");
  meter.style.width = `${Math.min(100, s.budgetUsedPct)}%`;
  meter.classList.toggle("over", s.isOverBudget);
  $("budget-note").textContent = s.hasEntries
    ? `${money(s.carriedForward)} carried in, ${money(s.available)} available this month, ${money(s.expensePaid)} spent so far, ${money(s.expenseUpcoming)} still to come.`
    : `${money(s.carriedForward)} carried in. Add income and expenses to see this month take shape.`;

  // What you actually hold, plus what is out with friends.
  splitBars($("account-balances"), data.accounts.balances, state.options.accounts, "income");
  const lending = data.lending.totals;
  const parts = [];
  if (data.accounts.cardSpend) parts.push(`${money(data.accounts.cardSpend)} on the credit card`);
  parts.push(
    lending.outstanding
      ? `${money(lending.outstanding)} still with friends across ${data.lending.open} loan${data.lending.open === 1 ? "" : "s"}`
      : "nothing out with friends",
  );
  $("lending-line").textContent = `Plus ${parts.join(", ")}.`;

  splitBars($("income-split"), s.incomeByAccount, state.options.incomeAccounts, "income");
  splitBars($("expense-split"), s.expenseByMethod, state.options.expenseMethods, "expense");

  drawTrend(data.trend);

  $("upcoming-count").textContent = data.upcoming.length;
  $("upcoming").replaceChildren(
    data.upcoming.length ? entryTable(data.upcoming, "expense") : empty("Nothing future dated in this month."),
  );
}

function drawTrend(trend) {
  const max = Math.max(1, ...trend.flatMap((row) => [row.income, row.expense]));
  const container = $("trend");
  container.innerHTML = "";
  for (const row of trend) {
    const cell = document.createElement("div");
    cell.className = "trend-month";
    cell.innerHTML =
      `<div class="trend-pair">` +
      `<div class="trend-bar income" style="height:${(row.income / max) * 100}%" title="Income ${money(row.income)}"></div>` +
      `<div class="trend-bar expense" style="height:${(row.expense / max) * 100}%" title="Expense ${money(row.expense)}"></div>` +
      `</div><span class="trend-label">${row.label}</span>`;
    container.append(cell);
  }
}

// -------------------------------------------------------------------
// FRIENDS
// -------------------------------------------------------------------
async function loadFriends() {
  const data = await api("/loans");
  $("tile-lent").textContent = money(data.totals.lent);
  $("tile-repaid").textContent = money(data.totals.repaid);
  $("tile-outstanding").textContent = money(data.totals.outstanding);

  const open = data.loans.filter((loan) => loan.outstanding > 0);
  const settled = data.loans.filter((loan) => loan.outstanding <= 0);
  $("loan-count").textContent = open.length;

  $("loan-list").replaceChildren(
    ...(open.length ? open.map(loanCard) : [empty("Nobody owes you anything right now.")]),
  );
  $("loan-settled").replaceChildren(
    ...(settled.length ? settled.map(loanCard) : [empty("Settled loans will move here.")]),
  );
}

function loanCard(loan) {
  const card = document.createElement("div");
  card.className = `loan ${loan.outstanding <= 0 ? "settled" : ""}`;

  const head = document.createElement("div");
  head.className = "loan-head";
  head.innerHTML =
    `<div><span class="loan-name">${loan.friend}</span>` +
    `<span class="tag ${loan.outstanding <= 0 ? "" : "due"}">${loan.status}</span>` +
    `<p class="muted small">${money(loan.lent)} on ${dayLabel(loan.date)} from ${loan.paid_from}` +
    `${loan.note ? ` · ${loan.note}` : ""}</p></div>` +
    `<div class="loan-amount"><strong>${money(loan.outstanding)}</strong><span class="muted small">outstanding</span></div>`;
  card.append(head);

  const meter = document.createElement("div");
  meter.className = "meter";
  meter.innerHTML = `<div class="meter-fill" style="width:${loan.repaidPct}%"></div>`;
  card.append(meter);

  const paid = document.createElement("p");
  paid.className = "muted small";
  paid.textContent = `${money(loan.repaid)} of ${money(loan.lent)} back`;
  card.append(paid);

  if (loan.repayments.length) {
    const list = document.createElement("ul");
    list.className = "repayments";
    for (const row of loan.repayments) {
      const item = document.createElement("li");
      item.innerHTML =
        `<span>${dayLabel(row.date)} · ${money(row.amount)} into ${row.received_in}` +
        `${row.note ? ` · ${row.note}` : ""}</span>`;
      const actions = document.createElement("span");
      actions.className = "actions";
      actions.append(
        linkButton("Edit", () =>
          openEdit({
            title: "Edit repayment",
            kind: "repayment",
            row,
            onSave: async (body) => {
              await api(`/repayments/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
              await refreshAll();
            },
          }),
        ),
        linkButton("Delete", async () => {
          await api(`/repayments/${row.id}`, { method: "DELETE" });
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
    linkButton("Edit loan", () =>
      openEdit({
        title: `Edit loan to ${loan.friend}`,
        kind: "loan",
        row: loan,
        onSave: async (body) => {
          await api(`/loans/${loan.id}`, { method: "PATCH", body: JSON.stringify(body) });
          await refreshAll();
        },
      }),
    ),
    linkButton("Delete loan", async () => {
      await api(`/loans/${loan.id}`, { method: "DELETE" });
      await refreshAll();
    }, "danger"),
  );
  card.append(actions);
  return card;
}

function repaymentForm(loan) {
  const form = document.createElement("form");
  form.className = "repay-form";
  form.innerHTML =
    `<div class="grid">` +
    `<label class="field">Amount received <input type="number" name="amount" min="0.01" step="0.01" max="${loan.outstanding}" placeholder="${Math.round(loan.outstanding)}" required /></label>` +
    `<label class="field">Date <input type="date" name="date" value="${state.today}" required /></label>` +
    `</div>` +
    `<fieldset class="field"><legend>Received in</legend><div class="choices"></div></fieldset>` +
    `<div class="row wrap"><button class="primary" type="submit">Record repayment</button>` +
    `<button class="ghost" type="button">Paid in full</button></div>` +
    `<p class="form-msg"></p>`;

  fillChoices(form.querySelector(".choices"), state.options.accounts, `receivedIn-${loan.id}`);

  const submit = async (amount) => {
    const body = {
      amount,
      date: form.date.value,
      receivedIn: form.querySelector(`input[name="receivedIn-${loan.id}"]:checked`).value,
    };
    try {
      await api(`/loans/${loan.id}/repayments`, { method: "POST", body: JSON.stringify(body) });
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
    : `${s.label} compares spending against its income (${money(s.incomeTotal)}). Set your own limit to save part of it.`;
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
          await refreshAll();
        },
        onEdit: (row) =>
          openEdit({
            title: kind === "income" ? "Edit income" : "Edit expense",
            kind,
            row,
            onSave: async (body) => {
              await api(`/${kind}/${row.id}`, { method: "PATCH", body: JSON.stringify(body) });
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
      category: form.category.value,
      note: form.note.value,
    };
    try {
      const result = await api("/income", { method: "POST", body: JSON.stringify(body) });
      message($("income-msg"), `Saved ${money(result.entry.amount)} into ${result.entry.account} on ${dayLabel(result.entry.date)}.`);
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
      category: form.category.value,
      note: form.note.value,
    };
    try {
      const result = await api("/expense", { method: "POST", body: JSON.stringify(body) });
      const s = result.summary;
      message(
        $("expense-msg"),
        `Saved ${money(result.entry.amount)} by ${result.entry.method} on ${dayLabel(result.entry.date)}. ${s.label}: ${s.status} — ${s.statusMessage}.`,
        !s.isOverBudget,
      );
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      friend: form.friend.value,
      date: form.date.value,
      amount: form.amount.value,
      paidFrom: form.querySelector('input[name="paidFrom"]:checked')?.value,
      note: form.note.value,
    };
    try {
      const result = await api("/loans", { method: "POST", body: JSON.stringify(body) });
      message($("loan-msg"), `Lent ${money(result.loan.amount)} to ${result.loan.friend} from ${result.loan.paidFrom}.`);
      form.reset();
      form.date.value = state.today;
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
  fillChoices($("loan-sources"), state.options.loanSources, "paidFrom");
  fillSelect($("income-categories"), state.options.incomeCategories);
  fillSelect($("expense-categories"), state.options.expenseCategories);

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
