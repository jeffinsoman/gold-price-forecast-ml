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
   pip install -r requirements.txt
   ```

3. **Execute the pipeline sequentially:**
   ```bash
   python Src/data_loader.py
   python Src/features.py
   python Src/train.py
   python Src/evaluate.py
   ```

---

## Income vs Expense Tracker (Monthly)

A second, self-contained Streamlit app in this repo for tracking personal cash flow month by month.

```bash
streamlit run finance_tracker.py
```

Entries are stored locally in `finance_tracker.db` (SQLite, created on first run and git-ignored).

### Dashboard (first page)
Opens on the current month and answers one question — did this month stay inside the budget?

> **Sep 2026 · Income 9,000 · Expense 10,000 · OUT OF BUDGET** — out of budget by 1,000
>
> With an expense of 5,000 instead, the same month reads **IN CONTROL** — 4,000 left.

The budget for a month is that month's income by default, so spending more than you earned turns
the card red. A custom budget can be pinned per month from the Transactions page. The dashboard
also shows income split by account, expense split by payment method, day-by-day bars, a six-month
trend, and the list of expenses still due later in the month.

### Add income
Date plus amount, received into one of two places:

* **Cash in Hand**
* **Bank**

### Add expense
Dated **today** or **future dated** (a bill or EMI due later). A future-dated expense is booked into
the month it falls in and shown on the dashboard as *upcoming* until its date arrives. Paid by:

* **Cash**
* **Bank**
* **Credit Card**

### Layout
| Path | What it is |
| --- | --- |
| `finance_tracker.py` | Streamlit UI: Dashboard, Add income, Add expense, Transactions |
| `finance/store.py` | SQLite storage and the monthly roll-up rules (standard library only) |
| `tests/test_finance_store.py` | Tests for the budget, upcoming-expense and split logic |

```bash
python -m unittest discover -s tests
```
