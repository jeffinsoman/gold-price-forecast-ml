# Institutional Asset Quantitative & Predictive Engine

![Python](https://img.shields.io/badge/Python-3.9%2B-blue)
![PyTorch](https://img.shields.io/badge/Deep_Learning-PyTorch-EE4C2C)
![Streamlit](https://img.shields.io/badge/UI-Streamlit-FF4B4B)
![Status](https://img.shields.io/badge/Status-Production_Ready-success)

An institutional-grade, real-time quantitative dashboard designed to analyze and forecast financial asset volatility (default: XAUUSD / Bitcoin). This application merges algorithmic risk management, Natural Language Processing (NLP) sentiment analysis, and advanced machine learning architectures (Lasso & PyTorch LSTM) into a single unified terminal.

---


---

## Core Engine Architectures

This terminal operates on four distinct analytical layers:

### 1. Algorithmic Execution & Risk Management
* **Dynamic Position Sizing:** Automatically calculates capital allocation based on Average True Range (ATR) and defined risk percentage to preserve fund principal.
* **Crossover Logic:** Executes simulated Long/Short markers based on Fast and Slow Moving Average convergences.
* **Drawdown Matrix:** Tracks cumulative algorithmic returns against benchmark holding returns and monitors Maximum Drawdown metrics.

### 2. Real-Time NLP Sentiment Radar
* Scrapes live financial headlines using the Yahoo Finance API.
* Processes text through a pre-trained TF-IDF vectorizer and machine learning classification model to output real-time institutional market bias (**Bullish, Bearish, or Neutral**).

### 3. Predictive Machine Learning (Lasso Regression)
* Extracts 2 years of historical data and engineers lagged features (Lag 1, Lag 2, SMA 10, SMA 30).
* Employs Lasso Regression (L1 Regularization) to force optimal feature selection, aggressively penalizing irrelevant market noise to project the next day's closing price.

### 4. Deep Learning Forecaster (PyTorch LSTM)
* **Sequential Memory:** Utilizes a Long Short-Term Memory (LSTM) neural network to capture long-term non-linear dependencies in market volatility.
* **Tensor Computation:** Normalizes real-time market data, processes it through multi-layered LSTM gates, and performs out-of-sample tensor projections for future price movement.

---

## Tech Stack
* **Frontend:** Streamlit, Plotly, Seaborn (Bloomberg Terminal-inspired UI/UX)
* **Data Ingestion:** `yfinance`, Pandas, NumPy
* **Machine Learning:** Scikit-Learn, Joblib
* **Deep Learning:** PyTorch (`torch`, `torch.nn`)

---

## How to Run Locally

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/dimssrmdn01/gold-price-forecast-ml.git](https://github.com/dimssrmdn01/gold-price-forecast-ml.git)
   cd gold-price-forecast-ml
   
2. **Install dependencies:**
   ```bash
   pip install -r requirements-ml.txt
   ```

3. **Execute the pipeline sequentially:**
   ```bash
   python Src/data_loader.py
   python Src/features.py
   python Src/train.py
   python Src/evaluate.py
   ```

---

## Income vs Expense Tracker (Cloudflare Workers + D1)

A second app in this repo: a monthly personal cash-flow tracker that runs entirely on Cloudflare.
A Worker serves the API, D1 stores the entries, and the dashboard is plain static HTML/CSS/JS —
no build step, no framework, no cold-start dependencies.

### Deploy it

```bash
npm install
npx wrangler login             # once, links the Cloudflare account

npm run deploy                 # publishes to <name>.<subdomain>.workers.dev
```

### Run it locally

```bash
npm run db:local               # migrations against the local D1 emulator
npm run dev                    # http://localhost:8787
npm test                       # month roll-up and validation rules
```

The `income-expense-tracker` D1 database already exists and its id is in `wrangler.jsonc`, with
`migrations/0001_init.sql` applied. Starting over on another account? Run `npm run db:create`, paste
the id it prints into `wrangler.jsonc`, then `npm run db:remote` before deploying.

Local runs use a D1 emulator under `.wrangler/`, so nothing touches the deployed database.

The forecaster's Python dependencies live in `requirements-ml.txt`, not `requirements.txt`: Cloudflare's
build image installs any root `requirements.txt` it finds, which pulled torch and the CUDA stack into
every Worker build. The Worker needs none of it.

### Dashboard (first page)
Opens on the current month and answers one question — did this month stay inside the budget?

> **Sep 2026 · Income 9,000 · Expense 10,000 · OUT OF BUDGET** — out of budget by 1,000
>
> With an expense of 5,000 instead, the same month reads **IN CONTROL** — 4,000 left.

A custom budget can be pinned per month from the Transactions tab when you want to save part of what
is available rather than spend to the line. The dashboard also
shows income split by account, expense split by payment method, a six-month comparison, how much of
the month's spending is already paid vs still due, and the list of upcoming expenses.

Amounts show in **AED** by default; the field in the top-right switches the label to any other
currency and remembers the choice in that browser.

Every month opens with what the previous one left over, and the balance is that plus this month's
takings less its spending:

```
carried forward + money in - money out = balance left   →   opens the next month
        659     +   8,947  -    7,810  =     1,796
```

Money in is income plus anything borrowed or repaid to you; money out is spending plus anything you
lend or pay back. Lend 500 in August and the balance drops by 500 that month — the cash is not with
you — and it only reappears when the friend pays it back.

That balance is also what the month is measured against: with no custom budget the limit is
`carried forward + income`, so the card reads IN CONTROL while the balance is positive and OUT OF
BUDGET once spending eats past it.

### Add income
Date plus amount, received into one of two places:

* **Cash in Hand**
* **Bank**

### Add expense
Dated **today** or **future dated** (a bill or EMI due later). A future-dated expense is booked into
the month it falls in and shown as *upcoming* until its date arrives. Paid by:

* **Cash**
* **Bank**
* **Credit Card**

### Money with friends
Both directions, on one page:

* **🤝 I lent money** — it leaves an account (Cash, Bank or Credit Card) and comes back into
  **Cash in Hand** or **Bank**.
* **🙏 I borrowed money** — it arrives in **Cash in Hand** or **Bank** and is paid back out of Cash,
  Bank or Credit Card.

The form retitles itself as you switch, and offers only the accounts that make sense for that
direction. Repayments are separate dated rows either way, so anything can be settled in instalments,
and each loan reads *Not repaid* / *Partly repaid* / *Settled* (or *Not paid back* / *Partly paid
back* when you are the borrower). A repayment can never exceed what is outstanding, and a loan cannot
be edited below what has already moved.

Three tiles keep the score: **they owe you**, **you owe**, and the **net position** between them.
Both sides feed the account balances in **What you hold now**, and both move the month's balance:
lending and paying back a debt count as money out, borrowing and being repaid count as money in.

### Using it
Every account, payment method and category carries a symbol, and the pages are built to be tapped
rather than typed into:

* **Category chips** — pick 🍽️ Food or 🛒 Groceries with one tap instead of hunting a dropdown.
* **Quick amounts** — `+50 / +100 / +500 / +1,000` add to the amount field; `clear` resets it.
* **Where it went** — spending by category with its share of the month; tap a row to unfold the
  entries behind the number.
* **Last 6 months** — tap any month in the chart to move the whole dashboard to it.
* **Live totals** — tiles count up to their new value when something changes, and every save,
  edit or delete raises a toast confirming what happened.

### Editing
Income, expenses, loans and repayments are all editable from their lists — the pencil opens a dialog
with the same fields as the original form. Deleting a loan removes its repayments with it.

### API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Form choices, today's date, months that have entries |
| GET | `/api/month/:month` | Summary, six-month trend, entries and upcoming list for `2026-09` |
| POST | `/api/income` | `{ date, amount, account, category, note }` |
| POST | `/api/expense` | `{ date, amount, method, category, note }` |
| PATCH | `/api/income/:id` · `/api/expense/:id` | Edit an entry |
| DELETE | `/api/income/:id` · `/api/expense/:id` | Remove an entry |
| PUT | `/api/budget` | `{ month, amount }`, or `amount: null` to fall back to income |
| GET | `/api/loans` | Every loan with its repayments, outstanding balance and status |
| POST | `/api/loans` | `{ friend, date, amount, paidFrom, note }` |
| PATCH · DELETE | `/api/loans/:id` | Edit or remove a loan (and its repayments) |
| POST | `/api/loans/:id/repayments` | `{ date, amount, receivedIn, note }` — full or partial |
| PATCH · DELETE | `/api/repayments/:id` | Edit or remove one repayment |

### Layout
| Path | What it is |
| --- | --- |
| `worker/index.js` | Worker: API routes and D1 queries |
| `worker/summary.js` | Month roll-up rules and input validation (no Worker globals, unit tested) |
| `public/` | Dashboard, forms and styles served as static assets |
| `migrations/` | D1 schema: entries and budgets, then loans and repayments |
| `test/` | Tests for the budget, upcoming-expense and validation logic |
| `wrangler.jsonc` | Worker name, assets binding and the D1 binding (`DB`) |
