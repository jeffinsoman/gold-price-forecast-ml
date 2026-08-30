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

function fillChoices(container, values, name) {
  container.innerHTML = "";
  values.forEach((value, index) => {
    const label = document.createElement("label");
    label.className = "choice";
    label.innerHTML =
      `<input type="radio" name="${name}" value="${value}"${index === 0 ? " checked" : ""} />` +
      `<span>${value}</span>`;
    container.append(label);
  });
}

function fillSelect(select, values) {
  select.innerHTML = values.map((value) => `<option>${value}</option>`).join("");
}

function entryTable(rows, kind, { withDelete = false, onDelete } = {}) {
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = kind === "income" ? "No income recorded here yet." : "No expenses recorded here yet.";
    return empty;
  }

  const source = kind === "income" ? "account" : "method";
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const table = document.createElement("table");
  table.innerHTML =
    `<thead><tr><th>Date</th><th>${kind === "income" ? "Account" : "Paid by"}</th>` +
    `<th>Category</th><th>Note</th><th class="amount">Amount</th>${withDelete ? "<th></th>" : ""}</tr></thead>`;

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    const due = kind === "expense" && row.date > state.today
      ? ' <span class="tag due">due</span>'
      : "";
    tr.innerHTML =
      `<td>${dayLabel(row.date)}${due}</td><td>${row[source]}</td>` +
      `<td><span class="tag">${row.category}</span></td><td>${row.note || ""}</td>` +
      `<td class="amount">${money(row.amount)}</td>`;
    if (withDelete) {
      const cell = document.createElement("td");
      const button = document.createElement("button");
      button.className = "link";
      button.textContent = "Delete";
      button.addEventListener("click", () => onDelete(row.id));
      cell.append(button);
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(body);
  wrap.append(table);
  return wrap;
}

function splitBars(container, totals, keys, kind) {
  const max = Math.max(1, ...keys.map((key) => totals[key] || 0));
  container.innerHTML = "";
  for (const key of keys) {
    const value = totals[key] || 0;
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="bar-name">${key}</span><span class="bar-value">${money(value)}</span>` +
      `<span class="bar-track"><span class="bar-fill ${kind}" style="width:${(value / max) * 100}%"></span></span>`;
    container.append(li);
  }
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

  $("tile-income").textContent = money(s.incomeTotal);
  $("tile-expense").textContent = money(s.expenseTotal);
  $("tile-upcoming").textContent = s.expenseUpcoming ? `${money(s.expenseUpcoming)} still due` : "";
  const balance = $("tile-balance");
  balance.textContent = money(s.balance);
  balance.classList.toggle("negative", s.balance < 0);
  $("tile-budget-label").textContent = s.isOverBudget ? "Over budget by" : "Budget left";
  $("tile-budget").textContent = money(s.isOverBudget ? s.overBy : s.remaining);

  const meter = $("budget-meter");
  meter.style.width = `${Math.min(100, s.budgetUsedPct)}%`;
  meter.classList.toggle("over", s.isOverBudget);
  $("budget-note").textContent = s.hasEntries
    ? `${money(s.expensePaid)} spent so far, ${money(s.expenseUpcoming)} still to come.`
    : "Add income and expenses to see this month take shape.";

  splitBars($("income-split"), s.incomeByAccount, state.options.incomeAccounts, "income");
  splitBars($("expense-split"), s.expenseByMethod, state.options.expenseMethods, "expense");

  drawTrend(data.trend);

  $("upcoming-count").textContent = data.upcoming.length;
  const upcoming = $("upcoming");
  upcoming.innerHTML = "";
  upcoming.append(
    data.upcoming.length
      ? entryTable(data.upcoming, "expense")
      : Object.assign(document.createElement("p"), {
          className: "empty",
          textContent: "Nothing future dated in this month.",
        }),
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

  const remove = (table) => async (id) => {
    await api(`/${table}/${id}`, { method: "DELETE" });
    await loadTransactions(state.txMonth);
    if (state.dashMonth === state.txMonth) await loadDashboard(state.dashMonth);
  };

  $("tx-income").replaceChildren(
    entryTable(data.income, "income", { withDelete: true, onDelete: remove("income") }),
  );
  $("tx-expenses").replaceChildren(
    entryTable(data.expenses, "expense", { withDelete: true, onDelete: remove("expense") }),
  );
}

// -------------------------------------------------------------------
// FORMS
// -------------------------------------------------------------------
async function refreshRecent() {
  const data = await api(`/month/${state.currentMonth}`);
  $("income-recent").replaceChildren(entryTable(data.income.slice(0, 8), "income"));
  $("expense-recent").replaceChildren(entryTable(data.expenses.slice(0, 8), "expense"));
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
      await afterWrite(result.summary.month);
    } catch (error) {
      message($("income-msg"), error.message, false);
    }
  });
}

function bindExpenseForm() {
  const form = $("expense-form");
  form.date.value = state.today;
  form.date.min = "";

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
  form.querySelectorAll('input[name="when"]').forEach((radio) =>
    radio.addEventListener("change", applyWhen),
  );
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
      const amount = form.amount;
      amount.value = "";
      form.note.value = "";
      await afterWrite(s.month);
    } catch (error) {
      message($("expense-msg"), error.message, false);
    }
  });
}

async function afterWrite(month) {
  const bootstrap = await api("/bootstrap");
  state.months = bootstrap.months;
  await refreshRecent();
  await loadDashboard(state.months.includes(state.dashMonth) ? state.dashMonth : month);
}

function bindBudget() {
  $("budget-save").addEventListener("click", async () => {
    try {
      const value = $("budget-input").value;
      if (value === "") throw new Error("Enter a budget amount first.");
      await api("/budget", { method: "PUT", body: JSON.stringify({ month: state.txMonth, amount: value }) });
      message($("budget-msg"), `Budget for ${monthLabel(state.txMonth)} set to ${money(value)}.`);
      await loadTransactions(state.txMonth);
      await loadDashboard(state.dashMonth);
    } catch (error) {
      message($("budget-msg"), error.message, false);
    }
  });

  $("budget-clear").addEventListener("click", async () => {
    await api("/budget", { method: "PUT", body: JSON.stringify({ month: state.txMonth, amount: null }) });
    message($("budget-msg"), "Back to using this month's income as the budget.");
    await loadTransactions(state.txMonth);
    await loadDashboard(state.dashMonth);
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
    paintBrandMark();
    localStorage.setItem("currency", state.currency);
    await loadDashboard(state.dashMonth);
    if (state.txMonth) await loadTransactions(state.txMonth);
    await refreshRecent();
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
  fillSelect($("income-categories"), state.options.incomeCategories);
  fillSelect($("expense-categories"), state.options.expenseCategories);

  bindTabs();
  bindCurrency();
  bindIncomeForm();
  bindExpenseForm();
  bindBudget();

  $("dash-month").addEventListener("change", (event) => loadDashboard(event.target.value));
  $("tx-month").addEventListener("change", (event) => loadTransactions(event.target.value));

  await loadDashboard(state.currentMonth);
  await refreshRecent();
}

boot().catch((error) => {
  $("status-card").className = "status-card bad";
  $("status-card").querySelector(".status-headline").textContent = "Could not reach the API";
  $("status-card").querySelector(".status-detail").textContent = error.message;
});
