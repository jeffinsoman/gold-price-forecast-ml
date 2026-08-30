"""Income vs Expense Tracker (monthly).

Run with:  streamlit run finance_tracker.py
"""

from datetime import date, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from finance import store

st.set_page_config(page_title="Income vs Expense Tracker", page_icon="", layout="wide")

st.markdown(
    """
<style>
:root {
    --ink: #0f172a;
    --muted: #64748b;
    --green: #16a34a;
    --red: #dc2626;
    --line: rgba(15, 23, 42, 0.12);
}
.page-title { font-size: 2.1rem; font-weight: 700; margin-bottom: 0; }
.page-sub { color: var(--muted); margin-bottom: 1.4rem; }
div[data-testid="stMetric"] {
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 18px;
    background: rgba(148, 163, 184, 0.07);
}
.status-card {
    border-radius: 14px;
    padding: 18px 22px;
    margin: 6px 0 18px 0;
    border: 1px solid var(--line);
}
.status-ok  { background: rgba(22, 163, 74, 0.12);  border-color: rgba(22, 163, 74, 0.45); }
.status-bad { background: rgba(220, 38, 38, 0.12);  border-color: rgba(220, 38, 38, 0.45); }
.status-headline { font-size: 1.5rem; font-weight: 700; margin: 0; }
.status-detail { color: var(--muted); margin: 4px 0 0 0; }
.section { font-size: 1.05rem; font-weight: 700; margin: 18px 0 6px 0; }
</style>
""",
    unsafe_allow_html=True,
)


# -------------------------------------------------------------------
# STATE
# -------------------------------------------------------------------
@st.cache_resource
def get_conn():
    return store.connect()


conn = get_conn()

if "currency" not in st.session_state:
    st.session_state.currency = "Rs"


def money(value):
    return f"{st.session_state.currency} {value:,.0f}"


def month_options():
    """Months that have data, plus the current one, newest first."""
    months = set(store.months_available(conn))
    months.add(store.month_key(date.today()))
    return sorted(months, reverse=True)


def pick_month(key):
    options = month_options()
    current = store.month_key(date.today())
    index = options.index(current) if current in options else 0
    return st.selectbox(
        "Month", options, index=index, format_func=store.month_label, key=key
    )


def to_frame(rows, kind):
    """Rows -> a display frame with friendly column names."""
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    source = "account" if kind == "income" else "method"
    df = df[["id", "date", "amount", source, "category", "note"]]
    df.columns = ["ID", "Date", "Amount", "Account" if kind == "income" else "Paid by", "Category", "Note"]
    return df


# -------------------------------------------------------------------
# DASHBOARD
# -------------------------------------------------------------------
def render_dashboard():
    st.markdown('<p class="page-title">Dashboard</p>', unsafe_allow_html=True)
    st.markdown(
        '<p class="page-sub">Month by month: what came in, what went out, and whether you are still inside the budget.</p>',
        unsafe_allow_html=True,
    )

    month = pick_month("dash_month")
    summary = store.monthly_summary(conn, month)

    css = "status-bad" if summary.is_over_budget and summary.has_entries else "status-ok"
    st.markdown(
        f"""
<div class="status-card {css}">
  <p class="status-headline">{summary.label} &nbsp;·&nbsp; Income {money(summary.income_total)}
     &nbsp;·&nbsp; Expense {money(summary.expense_total)} &nbsp;·&nbsp; {summary.status}</p>
  <p class="status-detail">{summary.status_message} &nbsp;·&nbsp;
     budget {money(summary.budget)} ({'custom' if summary.budget_is_custom else "this month's income"})
     &nbsp;·&nbsp; {summary.budget_used_pct:,.0f}% used</p>
</div>
""",
        unsafe_allow_html=True,
    )

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Income", money(summary.income_total))
    c2.metric(
        "Expense",
        money(summary.expense_total),
        delta=f"{money(summary.expense_upcoming)} upcoming",
        delta_color="off",
    )
    c3.metric("Balance", money(summary.balance))
    c4.metric(
        "Budget left" if not summary.is_over_budget else "Over budget by",
        money(summary.remaining if not summary.is_over_budget else summary.over_by),
    )

    st.progress(min(1.0, summary.budget_used_pct / 100.0))

    left, right = st.columns(2)
    with left:
        st.markdown('<p class="section">Income by account</p>', unsafe_allow_html=True)
        rows = [
            {"Account": acc, "Amount": summary.income_by_account.get(acc, 0.0)}
            for acc in store.INCOME_ACCOUNTS
        ]
        st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    with right:
        st.markdown('<p class="section">Expense by payment method</p>', unsafe_allow_html=True)
        rows = [
            {"Paid by": m, "Amount": summary.expense_by_method.get(m, 0.0)}
            for m in store.EXPENSE_METHODS
        ]
        st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)

    st.markdown('<p class="section">Money in vs money out</p>', unsafe_allow_html=True)
    render_month_chart(month)

    st.markdown('<p class="section">Last 6 months</p>', unsafe_allow_html=True)
    render_trend_chart(month)

    upcoming = [
        e for e in store.list_expenses(conn, month) if e["date"] > date.today().isoformat()
    ]
    st.markdown(
        f'<p class="section">Upcoming expenses ({len(upcoming)})</p>', unsafe_allow_html=True
    )
    if upcoming:
        st.dataframe(to_frame(upcoming, "expense").drop(columns=["ID"]), hide_index=True, use_container_width=True)
    else:
        st.caption("Nothing future dated in this month.")


def render_month_chart(month):
    incomes = store.list_income(conn, month)
    expenses = store.list_expenses(conn, month)
    if not incomes and not expenses:
        st.caption("No entries in this month yet.")
        return

    def daily(rows):
        series = {}
        for row in rows:
            series[row["date"]] = series.get(row["date"], 0.0) + float(row["amount"])
        return series

    days = sorted(set(daily(incomes)) | set(daily(expenses)))
    inc, exp = daily(incomes), daily(expenses)
    fig = go.Figure()
    fig.add_bar(x=days, y=[inc.get(d, 0) for d in days], name="Income", marker_color="#16a34a")
    fig.add_bar(x=days, y=[exp.get(d, 0) for d in days], name="Expense", marker_color="#dc2626")
    fig.update_layout(
        barmode="group", height=320, margin=dict(l=10, r=10, t=10, b=10),
        xaxis_title="", yaxis_title=st.session_state.currency,
    )
    st.plotly_chart(fig, use_container_width=True)


def render_trend_chart(month):
    year, mon = (int(p) for p in month.split("-"))
    keys = []
    for _ in range(6):
        keys.append(f"{year:04d}-{mon:02d}")
        mon -= 1
        if mon == 0:
            mon, year = 12, year - 1
    keys.reverse()

    summaries = [store.monthly_summary(conn, k) for k in keys]
    fig = go.Figure()
    labels = [s.label for s in summaries]
    fig.add_bar(x=labels, y=[s.income_total for s in summaries], name="Income", marker_color="#16a34a")
    fig.add_bar(x=labels, y=[s.expense_total for s in summaries], name="Expense", marker_color="#dc2626")
    fig.add_scatter(
        x=labels, y=[s.budget for s in summaries], name="Budget",
        mode="lines+markers", line=dict(color="#0ea5e9", dash="dash"),
    )
    fig.update_layout(
        barmode="group", height=320, margin=dict(l=10, r=10, t=10, b=10),
        xaxis_title="", yaxis_title=st.session_state.currency,
    )
    st.plotly_chart(fig, use_container_width=True)


# -------------------------------------------------------------------
# ADD INCOME
# -------------------------------------------------------------------
def render_add_income():
    st.markdown('<p class="page-title">Add income</p>', unsafe_allow_html=True)
    st.markdown('<p class="page-sub">Pick the date and where the money landed.</p>', unsafe_allow_html=True)

    with st.form("income_form", clear_on_submit=True):
        c1, c2 = st.columns(2)
        on_date = c1.date_input("Date", value=date.today())
        amount = c2.number_input("Amount", min_value=0.0, step=100.0, format="%.2f")
        account = st.radio("Received in", store.INCOME_ACCOUNTS, horizontal=True)
        c3, c4 = st.columns(2)
        category = c3.selectbox("Category", store.INCOME_CATEGORIES)
        note = c4.text_input("Note (optional)")
        submitted = st.form_submit_button("Save income", type="primary")

    if submitted:
        try:
            store.add_income(conn, on_date, amount, account, category, note)
        except ValueError as exc:
            st.error(str(exc))
        else:
            st.success(f"Income {money(amount)} into {account} on {on_date:%d %b %Y}.")

    recent = store.list_income(conn)[:10]
    if recent:
        st.markdown('<p class="section">Recent income</p>', unsafe_allow_html=True)
        st.dataframe(to_frame(recent, "income").drop(columns=["ID"]), hide_index=True, use_container_width=True)


# -------------------------------------------------------------------
# ADD EXPENSE
# -------------------------------------------------------------------
def render_add_expense():
    st.markdown('<p class="page-title">Add expense</p>', unsafe_allow_html=True)
    st.markdown(
        '<p class="page-sub">Spent today, or due later — a future date is booked into that month and shown as upcoming.</p>',
        unsafe_allow_html=True,
    )

    when = st.radio("When", ("Today", "Future date"), horizontal=True, key="expense_when")

    with st.form("expense_form", clear_on_submit=True):
        c1, c2 = st.columns(2)
        if when == "Today":
            on_date = date.today()
            c1.date_input("Date", value=on_date, disabled=True)
        else:
            on_date = c1.date_input(
                "Due date", value=date.today() + timedelta(days=1), min_value=date.today()
            )
        amount = c2.number_input("Amount", min_value=0.0, step=100.0, format="%.2f")
        method = st.radio("Paid by", store.EXPENSE_METHODS, horizontal=True)
        c3, c4 = st.columns(2)
        category = c3.selectbox("Category", store.EXPENSE_CATEGORIES)
        note = c4.text_input("Note (optional)")
        submitted = st.form_submit_button("Save expense", type="primary")

    if submitted:
        try:
            store.add_expense(conn, on_date, amount, method, category, note)
        except ValueError as exc:
            st.error(str(exc))
        else:
            summary = store.monthly_summary(conn, store.month_key(on_date))
            st.success(f"Expense {money(amount)} by {method} on {on_date:%d %b %Y}.")
            if summary.is_over_budget:
                st.error(f"{summary.label}: {summary.status} — {summary.status_message}.")
            else:
                st.info(f"{summary.label}: {summary.status} — {summary.status_message}.")

    recent = store.list_expenses(conn)[:10]
    if recent:
        st.markdown('<p class="section">Recent expenses</p>', unsafe_allow_html=True)
        st.dataframe(to_frame(recent, "expense").drop(columns=["ID"]), hide_index=True, use_container_width=True)


# -------------------------------------------------------------------
# TRANSACTIONS
# -------------------------------------------------------------------
def render_transactions():
    st.markdown('<p class="page-title">Transactions</p>', unsafe_allow_html=True)
    st.markdown('<p class="page-sub">Everything booked in one month, and the budget for it.</p>', unsafe_allow_html=True)

    month = pick_month("tx_month")
    summary = store.monthly_summary(conn, month)

    with st.expander("Budget for this month", expanded=False):
        st.caption(
            "Leave this off to compare spending against the month's income "
            f"({money(summary.income_total)}), or pin your own limit."
        )
        use_custom = st.checkbox("Use a custom budget", value=summary.budget_is_custom, key="budget_toggle")
        if use_custom:
            value = st.number_input(
                "Budget", min_value=0.0, step=500.0, value=float(summary.budget), format="%.2f"
            )
            if st.button("Save budget"):
                store.set_budget(conn, month, value)
                st.success(f"Budget for {summary.label} set to {money(value)}.")
                st.rerun()
        elif summary.budget_is_custom and st.button("Remove custom budget"):
            store.set_budget(conn, month, None)
            st.success("Back to using the month's income as the budget.")
            st.rerun()

    for kind, title, rows, deleter in (
        ("income", "Income", store.list_income(conn, month), store.delete_income),
        ("expense", "Expenses", store.list_expenses(conn, month), store.delete_expense),
    ):
        st.markdown(f'<p class="section">{title}</p>', unsafe_allow_html=True)
        if not rows:
            st.caption(f"No {title.lower()} in {summary.label}.")
            continue
        st.dataframe(to_frame(rows, kind), hide_index=True, use_container_width=True)
        c1, c2 = st.columns([3, 1])
        row_id = c1.selectbox(
            f"Delete {title.lower()} entry",
            [r["id"] for r in rows],
            format_func=lambda i, rs=rows: next(
                f"#{r['id']} · {r['date']} · {money(r['amount'])} · {r['category']}" for r in rs if r["id"] == i
            ),
            key=f"del_{kind}",
        )
        if c2.button("Delete", key=f"btn_{kind}"):
            deleter(conn, row_id)
            st.rerun()


# -------------------------------------------------------------------
# NAV
# -------------------------------------------------------------------
PAGES = {
    "Dashboard": render_dashboard,
    "Add income": render_add_income,
    "Add expense": render_add_expense,
    "Transactions": render_transactions,
}

with st.sidebar:
    st.markdown("### Money Tracker")
    page = st.radio("Go to", list(PAGES), index=0, label_visibility="collapsed")
    st.divider()
    st.session_state.currency = st.text_input("Currency symbol", value=st.session_state.currency)
    today_summary = store.monthly_summary(conn, store.month_key(date.today()))
    st.caption(f"{today_summary.label}: {today_summary.status}")
    st.caption(today_summary.status_message)

PAGES[page]()
