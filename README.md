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

## Money — an income vs expense tracker (Cloudflare Workers + D1)

Four tabs, one question: **how much is left this month?**
A Worker serves the API, D1 stores the entries, and the page is plain static HTML/CSS/JS — no build
step and no framework.

```bash
npm install
npm run dev      # http://localhost:8787, against a local D1 emulator
npm test         # the month rules
npm run deploy   # publishes to the Worker
```

Pushing to `main` deploys automatically through Workers Builds.

### 🏠 Dashboard
* **Cash in hand** and **Bank**, counted from every entry up to the end of the month shown. Credit
  card spending is reported separately, because a card is a bill rather than an account.
* **Income** and **Expense**, each as a short list of lines — one per category, biggest first, with a
  bar for its share.
* **Balance** — `income − expense`, and nothing else. Each month stands on its own; next month starts
  fresh.

### 💰 Income · 🧾 Expense
Date, amount, where it came in or went out (Cash in Hand / Bank, or Cash / Bank / Credit Card), a
category, an optional friend and a note. Below the form, that month's entries, each editable and
deletable.

### 🤝 Friends
Put a name on an expense when money goes out to someone, and on the income when it comes back. The
tab nets the two per person across every month — *AED 500 owed to you*, or *settled*.

### Design notes
The palette is a two-pole pair — teal-green for money in, coral for money out, indigo for controls —
with separate steps for dark mode rather than an automatic flip. Both sets were checked with the
dataviz validator (lightness band, chroma floor, colour-blind separation, contrast against the
surface): light `#0ea47f / #e2563f / #5b5bd6` at ΔE 9.2 deutan, dark `#10a683 / #e8674f / #7375d8` at
ΔE 9.6. Money in and out are never told apart by colour alone — every figure carries a sign, a label
and an icon. Amounts are tabular-figure, the tab bar sits under the thumb on a phone and at the top
on a wide screen, and motion respects `prefers-reduced-motion`.

### Start over
At the foot of the Dashboard: deletes every entry in every month, two taps, no undo.

### Layout
| Path | What it is |
| --- | --- |
| `worker/index.js` | Worker: API routes and D1 queries |
| `worker/summary.js` | Month rules, lines, balances and validation (unit tested) |
| `public/` | The page, its script and its styles |
| `migrations/` | D1 schema |
| `test/` | Tests for the month rules |

### API
| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/bootstrap` | Form choices, today's date, months, known friends |
| GET | `/api/month/:month` | Summary, lines, account balances, entries and friends |
| POST | `/api/income` · `/api/expense` | `{ date, amount, account \| method, category, friend, note }` |
| PATCH · DELETE | `/api/income/:id` · `/api/expense/:id` | Edit or remove an entry |
| POST | `/api/reset` | `{ "confirm": "RESET" }` — empties the tracker |
