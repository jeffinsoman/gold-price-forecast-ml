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

A small personal tracker that answers one question: **how much is left this month?**
A Worker serves the API, D1 stores the entries, and the page is plain static HTML/CSS/JS — no build
step and no framework.

### Run and deploy

```bash
npm install
npm run dev                    # http://localhost:8787, against a local D1 emulator
npm test                       # the month rules
npm run deploy                 # publishes to the Worker
```

Pushing to `main` deploys automatically through Workers Builds.

### The month

```
carried forward + income - expense = balance left   →   opens the next month
```

That is the whole model. The card at the top reads **IN CONTROL** while something is left, and
**OUT OF BUDGET** once spending passes what there was to spend:

> **Oct 2026 · Income 9,000 · Expense 10,000 · OUT OF BUDGET** — out of budget by 1,000
>
> With an expense of 5,000 instead: **IN CONTROL** — 4,000 left.

Below the card: carried forward, income, expense and the balance, then this month's income and
expenses as two lists, each row editable and deletable.

### Adding entries
**Income** — date, amount, received into **Cash in Hand** or **Bank**, a category, an optional
friend and a note.

**Expense** — date (today, or later for something due), amount, paid by **Cash**, **Bank** or
**Credit Card**, a category, an optional friend and a note.

Categories are icon chips rather than dropdowns, amounts have `+50 / +100 / +500 / +1,000` buttons,
and the currency label (AED by default) is set once in the header.

### Friends
Any entry can carry a name. Tag an expense when money goes to someone and the income when it comes
back, and the **With friends** panel nets the two per person — *AED 200 they owe*, or *settled* once
it balances. Names already used are offered as suggestions on the forms. Nothing else changes: these
are ordinary entries, counted in the month like everything else.

### Start over
The **Start over** section at the bottom of the Month page deletes every entry in every month. It
takes two taps and cannot be undone.

### Layout
| Path | What it is |
| --- | --- |
| `worker/index.js` | Worker: API routes and D1 queries |
| `worker/summary.js` | Month rules and input validation (no Worker globals, unit tested) |
| `public/` | The page, its script and its styles |
| `migrations/` | D1 schema |
| `test/` | Tests for the month rules |
| `wrangler.jsonc` | Worker name, assets binding and the D1 binding (`DB`) |

### API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Form choices, today's date, months that hold entries |
| GET | `/api/month/:month` | Summary and both lists for `2026-10` |
| POST | `/api/income` · `/api/expense` | `{ date, amount, account \| method, category, friend, note }` |
| PATCH · DELETE | `/api/income/:id` · `/api/expense/:id` | Edit or remove an entry |
| POST | `/api/reset` | `{ "confirm": "RESET" }` — empties the tracker |
