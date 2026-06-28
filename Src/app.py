import streamlit as st
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
from sklearn.linear_model import Lasso
from sklearn.metrics import mean_squared_error
from sklearn.preprocessing import MinMaxScaler
import plotly.graph_objects as go
import torch
import torch.nn as nn
import warnings

warnings.filterwarnings('ignore')

# -------------------------------------------------------------------
# PAGE CONFIG
# -------------------------------------------------------------------
st.set_page_config(page_title="Quant Engine", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap');

:root {
    --bg-base: #050507;
    --panel-bg: rgba(15, 18, 25, 0.8);
    --gold: #D4AF37;
    --gold-glow: rgba(212, 175, 55, 0.15);
    --cyan: #00d2ff;
    --red: #ff3b30;
    --green: #34c759;
    --border: rgba(255, 255, 255, 0.08);
}

.stApp {
    background-color: var(--bg-base);
    background-image: radial-gradient(circle at 50% 0%, var(--gold-glow), transparent 40%);
    color: #e0e0e0;
}

.terminal-header {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 3.5rem;
    color: var(--gold);
    letter-spacing: 2px;
    margin-bottom: 0;
    text-shadow: 0 0 15px var(--gold-glow);
}

.terminal-sub {
    font-family: 'Space Mono', monospace;
    font-size: 0.85rem;
    color: var(--cyan);
    letter-spacing: 1px;
    margin-bottom: 2rem;
}

div[data-testid="stMetric"] {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-top: 3px solid var(--gold);
    padding: 1rem 1.5rem;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    transition: transform 0.2s ease;
}

div[data-testid="stMetric"]:hover {
    transform: translateY(-3px);
}

div[data-testid="stMetric"] label {
    font-family: 'Space Mono', monospace;
    color: #8b949e;
    font-size: 0.8rem;
    text-transform: uppercase;
}

div[data-testid="stMetric"] div[data-testid="stMetricValue"] {
    font-family: 'Bebas Neue', sans-serif;
    color: white;
    font-size: 2.5rem;
}

[data-testid="stSidebar"] {
    background-color: #0a0c10;
    border-right: 1px solid var(--border);
}

hr {
    border-color: var(--border);
}

/* Market Summary Card */
.summary-card {
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.2rem 1.5rem;
    margin-bottom: 1rem;
}

.verdict-BULLISH { color: #34c759; font-weight: 700; }
.verdict-BEARISH { color: #ff3b30; font-weight: 700; }
.verdict-NEUTRAL { color: #00d2ff; font-weight: 700; }
.trend-UP { color: #34c759; }
.trend-DOWN { color: #ff3b30; }
.trend-FLAT { color: #8b949e; }
</style>
""", unsafe_allow_html=True)


# -------------------------------------------------------------------
# HELPERS — safe data fetching & column normalization
# -------------------------------------------------------------------
def _flatten_cols(df):
    """Ensure columns are flat strings, not MultiIndex tuples."""
    if isinstance(df.columns, pd.MultiIndex):
        # Columns are (PriceType, Ticker) — keep PriceType only
        df.columns = df.columns.get_level_values(0)
    return df


def _get_close(series_or_df):
    """Extract a clean close Series from yfinance output."""
    if isinstance(series_or_df, pd.DataFrame):
        cols = series_or_df.columns
        if isinstance(cols, pd.MultiIndex):
            # Find the Close column by checking level 0
            close_col = [c for c in cols if c[0] == 'Close']
            if close_col:
                return series_or_df[close_col[0]].squeeze()
        if 'Close' in cols:
            return series_or_df['Close'].squeeze()
        return series_or_df.iloc[:, 0].squeeze()
    return series_or_df.squeeze()


def fetch_yf(symbol, period_or_start, end=None, period=None):
    """Fetch yfinance data and return a flat DataFrame with OHLCV."""
    if period:
        raw = yf.download(symbol, period=period, progress=False)
    else:
        raw = yf.download(symbol, start=period_or_start, end=end, progress=False)

    if raw.empty:
        return raw

    # Flatten MultiIndex columns
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    return raw


def fetch_hist(symbol, period_str="2y"):
    """Fetch using Ticker.history() — already flat columns."""
    raw = yf.Ticker(symbol).history(period=period_str)
    return raw


# -------------------------------------------------------------------
# LSTM MODEL
# -------------------------------------------------------------------
class XAUUSDForecasterLSTM(nn.Module):
    def __init__(self, input_dim=1, hidden_dim=64, num_layers=2, output_dim=1):
        super(XAUUSDForecasterLSTM, self).__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size=input_dim, hidden_size=hidden_dim, num_layers=num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_dim, output_dim)

    def forward(self, x):
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).requires_grad_()
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_dim).requires_grad_()
        out, _ = self.lstm(x, (h0.detach(), c0.detach()))
        out = self.fc(out[:, -1, :])
        return out


# -------------------------------------------------------------------
# SIDEBAR CONTROLS
# -------------------------------------------------------------------
st.sidebar.markdown("<h2 style='font-family: Bebas Neue; color: #D4AF37;'> QUANT TERMINAL</h2>", unsafe_allow_html=True)

ticker = st.sidebar.text_input("Instrument Ticker", value="GC=F")
backtest_days = st.sidebar.slider("Historical Data (Days)", min_value=60, max_value=365, value=180)

st.sidebar.markdown("---")
st.sidebar.subheader("Strategy Parameters")
short_window = st.sidebar.number_input("Fast MA (Days)", min_value=5, max_value=30, value=20)
long_window = st.sidebar.number_input("Slow MA (Days)", min_value=31, max_value=100, value=50)

st.sidebar.markdown("---")
st.sidebar.subheader("Risk Management")
account_capital = st.sidebar.number_input("Total Capital ($)", min_value=1000, max_value=1000000, value=10000, step=1000)
risk_percentage = st.sidebar.slider("Risk Per Trade (%)", min_value=0.5, max_value=5.0, value=1.0, step=0.5)

st.sidebar.markdown("---")
st.sidebar.subheader("TP / SL Targets (ATR Multiplier)")
tp_mult = st.sidebar.number_input("Take Profit (x ATR)", min_value=1.0, max_value=10.0, value=3.0, step=0.5)
sl_mult = st.sidebar.number_input("Stop Loss (x ATR)", min_value=0.5, max_value=5.0, value=2.0, step=0.5)

# -------------------------------------------------------------------
# HEADER
# -------------------------------------------------------------------
st.markdown(f'<h1 class="terminal-header">{ticker} QUANTITATIVE ENGINE</h1>', unsafe_allow_html=True)
st.markdown('<div class="terminal-sub"> SYSTEM STATUS: OPERATIONAL | PREDICTIVE ANALYTICS & EXECUTION FRAMEWORK </div>', unsafe_allow_html=True)

# -------------------------------------------------------------------
# MARKET SUMMARY — fetch latest daily data for snapshot
# -------------------------------------------------------------------
with st.spinner("Loading market snapshot..."):
    end_date = datetime.today()
    start_date = end_date - timedelta(days=backtest_days + 100)

    df_raw = fetch_yf(ticker, start_date, end_date)

    # Also grab latest intraday data for summary
    df_today = fetch_yf(ticker, None, period="5d")

# -------------------------------------------------------------------
# MARKET SUMMARY CARD
# -------------------------------------------------------------------
st.markdown("---")

# Compute summary from df_raw (already loaded)
def compute_market_summary(df_full, df_today_raw, ticker_sym):
    """Build a dict of market snapshot metrics."""
    if df_full.empty:
        return None

    # Flatten if needed
    df = df_full.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    dt = df_today_raw.copy()
    if isinstance(dt.columns, pd.MultiIndex):
        dt.columns = dt.columns.get_level_values(0)

    today_close = float(df['Close'].iloc[-1])
    prev_close = float(df['Close'].iloc[-2])
    daily_change = today_close - prev_close
    daily_pct = (daily_change / prev_close) * 100

    # ATR
    df['H-L'] = df['High'] - df['Low']
    df['H-PC'] = abs(df['High'] - df['Close'].shift(1))
    df['L-PC'] = abs(df['Low'] - df['Close'].shift(1))
    df['TR'] = df[['H-L', 'H-PC', 'L-PC']].max(axis=1)
    df['ATR'] = df['TR'].rolling(window=14).mean()
    atr = float(df['ATR'].iloc[-1])

    # Moving averages (fast/slow from sidebar)
    ma_fast = df['Close'].rolling(window=short_window).mean()
    ma_slow = df['Close'].rolling(window=long_window).mean()
    ma_f = float(ma_fast.iloc[-1])
    ma_s = float(ma_slow.iloc[-1])

    # Trend
    if ma_f > ma_s:
        trend = "UPTREND"
        trend_class = "trend-UP"
    elif ma_f < ma_s:
        trend = "DOWNTREND"
        trend_class = "trend-DOWN"
    else:
        trend = "NEUTRAL"
        trend_class = "trend-FLAT"

    # Momentum — 5-day return
    ret_5d = float((df['Close'].iloc[-1] / df['Close'].iloc[-6] - 1) * 100) if len(df) >= 6 else 0
    ret_20d = float((df['Close'].iloc[-1] / df['Close'].iloc[-21] - 1) * 100) if len(df) >= 21 else 0

    # Volatility context
    atr_pct = (atr / today_close) * 100
    if atr_pct > 2:
        vol_label = "HIGH"
        vol_color = "#ff3b30"
    elif atr_pct > 1:
        vol_label = "MODERATE"
        vol_color = "#D4AF37"
    else:
        vol_label = "LOW"
        vol_color = "#34c759"

    # Daily range
    today_high = float(df['High'].iloc[-1])
    today_low = float(df['Low'].iloc[-1])

    # Macro: fetch S&P and USDX for context
    try:
        spx_raw = fetch_yf("^GSPC", None, period="5d")
        if not spx_raw.empty:
            if isinstance(spx_raw.columns, pd.MultiIndex):
                spx_raw.columns = spx_raw.columns.get_level_values(0)
            spx_pct = float((spx_raw['Close'].iloc[-1] / spx_raw['Close'].iloc[-2] - 1) * 100)
        else:
            spx_pct = None
    except Exception:
        spx_pct = None

    try:
        usd_raw = fetch_yf("DX-Y.NYB", None, period="5d")
        if not usd_raw.empty:
            if isinstance(usd_raw.columns, pd.MultiIndex):
                usd_raw.columns = usd_raw.columns.get_level_values(0)
            usd_pct = float((usd_raw['Close'].iloc[-1] / usd_raw['Close'].iloc[-2] - 1) * 100)
        else:
            usd_pct = None
    except Exception:
        usd_pct = None

    # Verdict: combine trend + momentum + volatility
    bullish_signals = 0
    bearish_signals = 0

    if ma_f > ma_s: bullish_signals += 2
    else: bearish_signals += 2

    if ret_5d > 0: bullish_signals += 1
    else: bearish_signals += 1

    if ret_20d > 0: bullish_signals += 1
    else: bearish_signals += 1

    if daily_pct > 0: bullish_signals += 1
    else: bearish_signals += 1

    if bullish_signals >= 4:
        verdict = "BULLISH"
        v_class = "verdict-BULLISH"
        v_icon = "▲"
    elif bearish_signals >= 4:
        verdict = "BEARISH"
        v_class = "verdict-BEARISH"
        v_icon = "▼"
    else:
        verdict = "NEUTRAL"
        v_class = "verdict-NEUTRAL"
        v_icon = "◆"

    return {
        "today_close": today_close,
        "daily_change": daily_change,
        "daily_pct": daily_pct,
        "today_high": today_high,
        "today_low": today_low,
        "atr": atr,
        "atr_pct": atr_pct,
        "vol_label": vol_label,
        "vol_color": vol_color,
        "ma_fast": ma_f,
        "ma_slow": ma_s,
        "trend": trend,
        "trend_class": trend_class,
        "ret_5d": ret_5d,
        "ret_20d": ret_20d,
        "spx_pct": spx_pct,
        "usd_pct": usd_pct,
        "verdict": verdict,
        "v_class": v_class,
        "v_icon": v_icon,
        "bullish_signals": bullish_signals,
        "bearish_signals": bearish_signals,
    }


summary = compute_market_summary(df_raw, df_today, ticker)

if summary:
    c0, c1, c2, c3, c4 = st.columns([2, 2, 2, 2, 2])

    # Verdict badge
    v_color_map = {"BULLISH": "#34c759", "BEARISH": "#ff3b30", "NEUTRAL": "#00d2ff"}
    v_bg = v_color_map.get(summary["verdict"], "#8b949e")

    with c0:
        st.markdown(f"""
        <div style="text-align:center;">
            <div style="font-family:'Space Mono';font-size:0.7rem;color:#8b949e;letter-spacing:1px;">MARKET VERDICT</div>
            <div style="font-family:'Bebas Neue';font-size:3rem;color:{v_bg};line-height:1;">
                {summary["v_icon"]} {summary["verdict"]}
            </div>
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;">
                {summary["bullish_signals"]} bullish · {summary["bearish_signals"]} bearish signals
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Price & change
    arrow = "▲" if summary["daily_pct"] > 0 else "▼"
    price_color = "#34c759" if summary["daily_pct"] > 0 else "#ff3b30"
    with c1:
        st.markdown(f"""
        <div style="text-align:center;">
            <div style="font-family:'Space Mono';font-size:0.7rem;color:#8b949e;letter-spacing:1px;">SPOT PRICE</div>
            <div style="font-family:'Bebas Neue';font-size:2.2rem;color:white;">${summary["today_close"]:,.2f}</div>
            <div style="font-family:'Space Mono';font-size:0.8rem;color:{price_color};">
                {arrow} {abs(summary["daily_pct"]):.2f}% ({arrow} ${abs(summary["daily_change"]):,.2f})
            </div>
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;margin-top:4px;">
                H: <span style="color:white;">${summary["today_high"]:,.2f}</span> &nbsp;|&nbsp;
                L: <span style="color:white;">${summary["today_low"]:,.2f}</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Trend
    trend_color = "#34c759" if summary["trend"] == "UPTREND" else ("#ff3b30" if summary["trend"] == "DOWNTREND" else "#8b949e")
    with c2:
        st.markdown(f"""
        <div style="text-align:center;">
            <div style="font-family:'Space Mono';font-size:0.7rem;color:#8b949e;letter-spacing:1px;">TREND</div>
            <div style="font-family:'Bebas Neue';font-size:2.2rem;color:{trend_color};">{summary["trend"]}</div>
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;">
                MA{short_window}: <span style="color:#00D2FF;">${summary["ma_fast"]:,.2f}</span><br>
                MA{long_window}: <span style="color:#FF3B30;">${summary["ma_slow"]:,.2f}</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Momentum
    mom_color_5 = "#34c759" if summary["ret_5d"] > 0 else "#ff3b30"
    mom_color_20 = "#34c759" if summary["ret_20d"] > 0 else "#ff3b30"
    with c3:
        st.markdown(f"""
        <div style="text-align:center;">
            <div style="font-family:'Space Mono';font-size:0.7rem;color:#8b949e;letter-spacing:1px;">MOMENTUM</div>
            <div style="font-family:'Space Mono';font-size:0.75rem;color:#8b949e;margin-top:4px;">
                5D Return: <span style="color:{mom_color_5};font-weight:700;">{summary["ret_5d"]:+.2f}%</span><br>
                20D Return: <span style="color:{mom_color_20};font-weight:700;">{summary["ret_20d"]:+.2f}%</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Volatility
    with c4:
        st.markdown(f"""
        <div style="text-align:center;">
            <div style="font-family:'Space Mono';font-size:0.7rem;color:#8b949e;letter-spacing:1px;">VOLATILITY</div>
            <div style="font-family:'Bebas Neue';font-size:2.2rem;color:{summary["vol_color"]};">{summary["vol_label"]}</div>
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;">
                ATR(14): <span style="color:white;">${summary["atr"]:.2f}</span><br>
                Vol/Price: <span style="color:white;">{summary["atr_pct"]:.2f}%</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Macro strip
    st.markdown("<br>", unsafe_allow_html=True)
    m0, m1, m2 = st.columns([1, 1, 1])
    with m0:
        spx_val = f'{summary["spx_pct"]:+.2f}%' if summary["spx_pct"] is not None else "N/A"
        spx_color = "#34c759" if (summary["spx_pct"] or 0) > 0 else "#ff3b30"
        st.markdown(f"""
        <div style="text-align:center; background:var(--panel-bg); border:1px solid var(--border); border-radius:8px; padding:0.8rem;">
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;letter-spacing:1px;">S&P 500</div>
            <div style="font-family:'Bebas Neue';font-size:1.4rem;color:{spx_color};">{spx_val}</div>
        </div>
        """, unsafe_allow_html=True)
    with m1:
        usd_val = f'{summary["usd_pct"]:+.2f}%' if summary["usd_pct"] is not None else "N/A"
        # USD up = gold headwind
        usd_color = "#ff3b30" if (summary["usd_pct"] or 0) > 0 else "#34c759"
        st.markdown(f"""
        <div style="text-align:center; background:var(--panel-bg); border:1px solid var(--border); border-radius:8px; padding:0.8rem;">
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;letter-spacing:1px;">USD INDEX</div>
            <div style="font-family:'Bebas Neue';font-size:1.4rem;color:{usd_color};">{usd_val}</div>
        </div>
        """, unsafe_allow_html=True)
    with m2:
        # Build a plain verdict text
        v = summary["verdict"]
        v_c = "#34c759" if v == "BULLISH" else ("#ff3b30" if v == "BEARISH" else "#00d2ff")
        detail = ""
        if v == "BULLISH":
            detail = "MA bullish · +momentum"
        elif v == "BEARISH":
            detail = "MA bearish · -momentum"
        else:
            detail = "Mixed signals"
        st.markdown(f"""
        <div style="text-align:center; background:var(--panel-bg); border:1px solid var(--border); border-radius:8px; padding:0.8rem;">
            <div style="font-family:'Space Mono';font-size:0.65rem;color:#8b949e;letter-spacing:1px;">GOLD BIAS</div>
            <div style="font-family:'Bebas Neue';font-size:1.4rem;color:{v_c};">{v}</div>
            <div style="font-family:'Space Mono';font-size:0.6rem;color:#8b949e;">{detail}</div>
        </div>
        """, unsafe_allow_html=True)

st.markdown("---")
try:
    if df_raw.empty:
        st.error(f"Execution Terminated: No data returned for '{ticker}'. Check the ticker symbol.")
    else:
        df = df_raw.copy()

        # Validate close price is in a reasonable range
        raw_close = df['Close'].iloc[-1]
        if raw_close > 100000:
            st.error(f"Data sanity check failed: Close price {raw_close:,.2f} is implausible. Please refresh — if it persists, the data source may be corrupted.")
            st.stop()

        # Technical Indicators
        df['MA_Fast'] = df['Close'].rolling(window=short_window).mean()
        df['MA_Slow'] = df['Close'].rolling(window=long_window).mean()

        # ATR
        df['H-L'] = df['High'] - df['Low']
        df['H-PC'] = abs(df['High'] - df['Close'].shift(1))
        df['L-PC'] = abs(df['Low'] - df['Close'].shift(1))
        df['TR'] = df[['H-L', 'H-PC', 'L-PC']].max(axis=1)
        df['ATR'] = df['TR'].rolling(window=14).mean()

        # Log Return
        df['Log_Return'] = np.log(df['Close'] / df['Close'].shift(1))
        df_filtered = df.tail(backtest_days).copy()

        # Crossover Signals
        df_filtered['Signal'] = np.where(df_filtered['MA_Fast'] > df_filtered['MA_Slow'], 1, -1)
        df_filtered['Strategy_Return'] = df_filtered['Log_Return'] * df_filtered['Signal'].shift(1)

        # Signal Markers
        df_filtered['Position_Changes'] = df_filtered['Signal'].diff()
        df_filtered['Buy_Markers'] = np.where(df_filtered['Position_Changes'] == 2, df_filtered['Close'], np.nan)
        df_filtered['Sell_Markers'] = np.where(df_filtered['Position_Changes'] == -2, df_filtered['Close'], np.nan)

        # TP / SL
        df_filtered['TP'] = np.where(
            df_filtered['Signal'] == 1,
            df_filtered['Close'] + tp_mult * df_filtered['ATR'],
            df_filtered['Close'] - tp_mult * df_filtered['ATR']
        )
        df_filtered['SL'] = np.where(
            df_filtered['Signal'] == 1,
            df_filtered['Close'] - sl_mult * df_filtered['ATR'],
            df_filtered['Close'] + sl_mult * df_filtered['ATR']
        )

        # Metrics
        latest_price = float(df_filtered['Close'].iloc[-1])
        current_atr = float(df_filtered['ATR'].iloc[-1])
        asset_cum_return = (np.exp(df_filtered['Log_Return'].sum()) - 1) * 100
        strategy_cum_return = (np.exp(df_filtered['Strategy_Return'].sum()) - 1) * 100

        # Drawdown
        strategy_cum_wealth = np.exp(df_filtered['Strategy_Return'].cumsum())
        peak = strategy_cum_wealth.cummax()
        drawdown = (strategy_cum_wealth - peak) / peak
        max_drawdown = drawdown.min() * 100

        # Position sizing
        cash_risk = account_capital * (risk_percentage / 100)
        sl_distance = current_atr * sl_mult
        simulated_position_size = cash_risk / sl_distance if sl_distance > 0 else 0.0

        # Current signal
        last_signal = int(df_filtered['Signal'].iloc[-1])
        last_tp = float(df_filtered['TP'].iloc[-1])
        last_sl = float(df_filtered['SL'].iloc[-1])
        signal_label = "BUY (LONG)" if last_signal == 1 else "SELL (SHORT)"
        signal_color = "normal"

        # Top-level metrics row
        m1, m2, m3, m4, m5 = st.columns(5)
        m1.metric("Spot Price", f"${latest_price:,.2f}")
        m2.metric("Signal", signal_label)
        m3.metric("Take Profit", f"${last_tp:,.2f}", f"+{(last_tp-latest_price)/latest_price*100:.2f}%")
        m4.metric("Stop Loss", f"${last_sl:,.2f}", f"{(last_sl-latest_price)/latest_price*100:.2f}%")
        m5.metric("ATR (14)", f"${current_atr:.2f}")

        st.markdown("<br>", unsafe_allow_html=True)

        tab1, tab2, tab3, tab4 = st.tabs([" Execution Chart", " Trade Targets", " Risk Sizing", " Raw Matrix"])

        with tab1:
            st.markdown("<h3 style='font-family: Bebas Neue; color: white;'>Quantitative Execution History</h3>", unsafe_allow_html=True)

            fig = go.Figure()

            # Price
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=df_filtered['Close'],
                name='Spot Price', line=dict(color='#D4AF37', width=2)
            ))

            # Moving Averages
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=df_filtered['MA_Fast'],
                name=f'Fast MA ({short_window})', line=dict(color='#00D2FF', dash='dot')
            ))
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=df_filtered['MA_Slow'],
                name=f'Slow MA ({long_window})', line=dict(color='#FF3B30', dash='dot')
            ))

            # Buy markers
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=df_filtered['Buy_Markers'],
                mode='markers', name='BUY',
                marker=dict(symbol='triangle-up', size=14, color='#34c759', line=dict(width=1, color='white'))
            ))

            # Sell markers
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=df_filtered['Sell_Markers'],
                mode='markers', name='SELL',
                marker=dict(symbol='triangle-down', size=14, color='#ff3b30', line=dict(width=1, color='white'))
            ))

            # TP line
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=[last_tp] * len(df_filtered),
                name=f'TP (${last_tp:,.2f})',
                line=dict(color='#34c759', width=1.5, dash='dash'), opacity=0.7
            ))

            # SL line
            fig.add_trace(go.Scatter(
                x=df_filtered.index, y=[last_sl] * len(df_filtered),
                name=f'SL (${last_sl:,.2f})',
                line=dict(color='#ff3b30', width=1.5, dash='dash'), opacity=0.7
            ))

            fig.update_layout(
                plot_bgcolor='rgba(0,0,0,0)',
                paper_bgcolor='rgba(0,0,0,0)',
                font_color='#8b949e',
                margin=dict(l=0, r=0, t=10, b=0),
                legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
                xaxis=dict(showgrid=True, gridcolor='rgba(255,255,255,0.05)'),
                yaxis=dict(showgrid=True, gridcolor='rgba(255,255,255,0.05)')
            )
            st.plotly_chart(fig, use_container_width=True)

        with tab2:
            st.markdown("<h3 style='font-family: Bebas Neue; color: white;'>Trade Target Levels</h3>", unsafe_allow_html=True)

            t1, t2, t3 = st.columns(3)
            tp_long = latest_price + tp_mult * current_atr
            sl_long = latest_price - sl_mult * current_atr
            tp_short = latest_price - tp_mult * current_atr
            sl_short = latest_price + sl_mult * current_atr

            with t1:
                st.markdown("**LONG POSITION**")
                st.markdown(f"Entry: **${latest_price:,.2f}**")
                st.success(f"Take Profit: **${tp_long:,.2f}**  (+{tp_mult}x ATR)")
                st.error(f"Stop Loss: **${sl_long:,.2f}**  (-{sl_mult}x ATR)")
                rr_long = (tp_long - latest_price) / max(latest_price - sl_long, 0.001)
                st.info(f"Risk/Reward: **1:{rr_long:.2f}**")

            with t2:
                st.markdown("**SHORT POSITION**")
                st.markdown(f"Entry: **${latest_price:,.2f}**")
                st.success(f"Take Profit: **${tp_short:,.2f}**  (-{tp_mult}x ATR)")
                st.error(f"Stop Loss: **${sl_short:,.2f}**  (+{sl_mult}x ATR)")
                rr_short = (latest_price - tp_short) / max(sl_short - latest_price, 0.001)
                st.info(f"Risk/Reward: **1:{rr_short:.2f}**")

            with t3:
                st.markdown("**SIGNAL SUMMARY**")
                st.markdown(f"Current Signal: **{signal_label}**")
                st.markdown(f"ATR (14): **${current_atr:.2f}**")
                st.markdown(f"TP Multiplier: **{tp_mult}x ATR**")
                st.markdown(f"SL Multiplier: **{sl_mult}x ATR**")

            st.markdown("---")
            st.markdown("**Recent Trade Signals**")
            trades = df_filtered[
                df_filtered['Buy_Markers'].notna() | df_filtered['Sell_Markers'].notna()
            ][['Close', 'ATR', 'Signal']].copy()
            trades['Type'] = trades['Signal'].map({1: 'BUY', -1: 'SELL'})
            trades['TP'] = trades.apply(
                lambda r: r['Close'] + tp_mult * r['ATR'] if r['Signal'] == 1 else r['Close'] - tp_mult * r['ATR'], axis=1
            )
            trades['SL'] = trades.apply(
                lambda r: r['Close'] - sl_mult * r['ATR'] if r['Signal'] == 1 else r['Close'] + sl_mult * r['ATR'], axis=1
            )
            disp = trades[['Type', 'Close', 'TP', 'SL']].tail(15).rename(columns={
                'Type': 'Signal', 'Close': 'Entry', 'TP': 'Take Profit', 'SL': 'Stop Loss'
            })
            disp['Entry'] = disp['Entry'].apply(lambda x: f"${x:,.2f}")
            disp['Take Profit'] = disp['Take Profit'].apply(lambda x: f"${x:,.2f}")
            disp['Stop Loss'] = disp['Stop Loss'].apply(lambda x: f"${x:,.2f}")
            st.dataframe(disp, use_container_width=True, hide_index=True)

        with tab3:
            c1, c2 = st.columns(2)
            with c1:
                st.info(f"**Allowed Cash Risk:** ${cash_risk:,.2f} per trade")
                st.markdown(f"**Stop Loss Distance:** ${sl_distance:.2f} ({sl_mult}x ATR)")
                st.markdown(f"**Position Size:** {simulated_position_size:.3f} units")
            with c2:
                st.success(f"**Simulated Position Size:** {simulated_position_size:.3f} units")
                st.markdown(f"**Capital at Risk:** ${cash_risk:,.2f}")
                st.markdown(f"**Capital Allocation:** ${simulated_position_size * latest_price:,.2f}")

        with tab4:
            st.dataframe(df_filtered[['Close', 'MA_Fast', 'MA_Slow', 'ATR', 'TP', 'SL', 'Signal', 'Strategy_Return']].tail(15), use_container_width=True)

except Exception as e:
    st.error(f"System Failure: {str(e)}")

# -------------------------------------------------------------------
# MACRO RADAR
# -------------------------------------------------------------------
st.divider()
st.markdown("<h2 style='font-family: Bebas Neue; color: white;'> Global Macro Radar</h2>", unsafe_allow_html=True)

with st.spinner("Fetching macro data..."):
    try:
        macro_basket = {
            "Primary": ticker,
            "S&P 500": "^GSPC",
            "NASDAQ": "^IXIC",
            "USD Index": "DX-Y.NYB"
        }

        macro_data = pd.DataFrame()
        for name, sym in macro_basket.items():
            temp_df = fetch_yf(sym, start_date, end_date)
            if not temp_df.empty and 'Close' in temp_df.columns:
                macro_data[name] = temp_df['Close']

        macro_data.dropna(inplace=True)

        if macro_data.empty:
            st.warning("No macro data available.")
        else:
            corr_matrix = macro_data.corr()

            col_macro1, col_macro2 = st.columns([1, 2], gap="large")

            with col_macro1:
                st.markdown("<span style='font-family: Space Mono; color: #8b949e;'>CORRELATION MATRIX</span>", unsafe_allow_html=True)
                fig_corr = go.Figure(data=go.Heatmap(
                    z=corr_matrix.values, x=corr_matrix.columns, y=corr_matrix.columns,
                    colorscale='RdBu', zmin=-1, zmax=1,
                    text=np.round(corr_matrix.values, 2),
                    texttemplate="%{text}", showscale=False
                ))
                fig_corr.update_layout(
                    height=350, margin=dict(l=0, r=0, t=20, b=0),
                    plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)', font_color='white'
                )
                st.plotly_chart(fig_corr, use_container_width=True)

            with col_macro2:
                st.markdown("<span style='font-family: Space Mono; color: #8b949e;'>RELATIVE PERFORMANCE (BASE 100)</span>", unsafe_allow_html=True)
                normalized_data = (macro_data / macro_data.iloc[0]) * 100
                fig_line = go.Figure()

                for col in normalized_data.columns:
                    width = 3 if col == "Primary" else 1.5
                    dash = 'solid' if col == "Primary" else 'dot'
                    fig_line.add_trace(go.Scatter(
                        x=normalized_data.index, y=normalized_data[col],
                        mode='lines', name=col,
                        line=dict(width=width, dash=dash)
                    ))

                fig_line.update_layout(
                    height=350, margin=dict(l=0, r=0, t=20, b=0),
                    plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)', font_color='white',
                    xaxis=dict(showgrid=True, gridcolor='rgba(255,255,255,0.05)'),
                    yaxis=dict(showgrid=True, gridcolor='rgba(255,255,255,0.05)')
                )
                st.plotly_chart(fig_line, use_container_width=True)

    except Exception as e:
        st.error(f"Macro Radar Error: {str(e)}")

# -------------------------------------------------------------------
# ML & DL ENGINES
# -------------------------------------------------------------------
st.divider()
st.markdown("<h2 style='font-family: Bebas Neue; color: white;'> Predictive Architectures</h2>", unsafe_allow_html=True)

col_ai1, col_ai2 = st.columns(2, gap="large")

with col_ai1:
    with st.container(border=True):
        st.markdown("<h3 style='font-family: Space Mono; color: #00d2ff;'> Lasso Regression</h3>", unsafe_allow_html=True)
        with st.spinner("Configuring ML model..."):
            try:
                hist = fetch_hist(ticker, "2y")
                if hist.empty:
                    st.warning("No historical data available for Lasso model.")
                else:
                    df_ml = pd.DataFrame()
                    df_ml['Close'] = hist['Close']
                    df_ml['Lag_1'] = df_ml['Close'].shift(1)
                    df_ml['Lag_2'] = df_ml['Close'].shift(2)
                    df_ml['SMA_10'] = df_ml['Close'].rolling(window=10).mean()
                    df_ml['SMA_30'] = df_ml['Close'].rolling(window=30).mean()
                    df_ml.dropna(inplace=True)

                    X = df_ml[['Lag_1', 'Lag_2', 'SMA_10', 'SMA_30']]
                    y = df_ml['Close']
                    split_idx = int(len(df_ml) * 0.8)
                    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
                    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

                    model_ml = Lasso(alpha=0.1)
                    model_ml.fit(X_train, y_train)

                    predictions = model_ml.predict(X_test)
                    rmse = np.sqrt(mean_squared_error(y_test, predictions))
                    next_day_pred = model_ml.predict(X.iloc[-1].values.reshape(1, -1))[0]

                    l1, l2 = st.columns(2)
                    l1.metric("Next-Day Forecast", f"${next_day_pred:,.2f}")
                    l2.metric("RMSE", f"${rmse:,.2f}")
            except Exception as e:
                st.error(f"ML Error: {e}")

with col_ai2:
    with st.container(border=True):
        st.markdown("<h3 style='font-family: Space Mono; color: #b026ff;'> PyTorch LSTM Core</h3>", unsafe_allow_html=True)
        if st.button("INITIALIZE TENSOR COMPUTATION", use_container_width=True):
            with st.spinner("Training LSTM (50 epochs)..."):
                try:
                    seq_length = 10
                    raw_dl = fetch_yf(ticker, None, period="2y")

                    if raw_dl.empty or 'Close' not in raw_dl.columns:
                        st.warning("No data available for LSTM training.")
                    else:
                        scaler = MinMaxScaler(feature_range=(0, 1))
                        scaled_data = scaler.fit_transform(raw_dl[['Close']].values)

                        X_dl, y_dl = [], []
                        for i in range(len(scaled_data) - seq_length):
                            X_dl.append(scaled_data[i:(i + seq_length), 0])
                            y_dl.append(scaled_data[i + seq_length, 0])

                        X_tensor = torch.FloatTensor(np.array(X_dl).reshape(-1, seq_length, 1))
                        y_tensor = torch.FloatTensor(np.array(y_dl).reshape(-1, 1))

                        model_dl = XAUUSDForecasterLSTM()
                        criterion = nn.MSELoss()
                        optimizer = torch.optim.Adam(model_dl.parameters(), lr=0.01)

                        progress = st.progress(0)
                        for epoch in range(50):
                            model_dl.train()
                            optimizer.zero_grad()
                            loss = criterion(model_dl(X_tensor), y_tensor)
                            loss.backward()
                            optimizer.step()
                            progress.progress((epoch + 1) / 50)

                        model_dl.eval()
                        with torch.no_grad():
                            pred_scaled = model_dl(X_tensor[-1:].clone().detach())

                        lstm_pred = scaler.inverse_transform(pred_scaled.numpy())[0][0]
                        lstm_actual = float(raw_dl['Close'].iloc[-1])

                        d1, d2 = st.columns(2)
                        d1.metric("Actual Price", f"${lstm_actual:,.2f}")
                        d2.metric("LSTM Forecast", f"${lstm_pred:,.2f}", f"{lstm_pred - lstm_actual:+.2f} USD")
                except Exception as e:
                    st.error(f"PyTorch Error: {e}")

# -------------------------------------------------------------------
# BACKTESTING
# -------------------------------------------------------------------
st.divider()
st.markdown("<h2 style='font-family: Bebas Neue; color: white;'> 5-Year Strategy Backtest</h2>", unsafe_allow_html=True)

with st.spinner("Running historical backtest..."):
    try:
        import vectorbt as vbt

        bt_data = fetch_yf(ticker, None, period="5y")

        if bt_data.empty or 'Close' not in bt_data.columns:
            st.warning("No data available for backtesting.")
        else:
            price_series = bt_data['Close']

            fast_ma = vbt.MA.run(price_series, short_window)
            slow_ma = vbt.MA.run(price_series, long_window)
            entries = fast_ma.ma_crossed_above(slow_ma)
            exits = fast_ma.ma_crossed_below(slow_ma)

            portfolio = vbt.Portfolio.from_signals(price_series, entries, exits, init_cash=account_capital, fees=0.001)

            col_bt1, col_bt2, col_bt3, col_bt4 = st.columns(4)
            col_bt1.metric("Total Return", f"{portfolio.total_return() * 100:.2f}%")
            col_bt2.metric("Net Profit", f"${portfolio.total_profit():,.2f}")
            col_bt3.metric("Win Rate", f"{portfolio.trades.win_rate() * 100:.2f}%")
            col_bt4.metric("Max Drawdown", f"{portfolio.max_drawdown() * 100:.2f}%")

            fig_bt = portfolio.plot()
            fig_bt.update_layout(
                height=500, template="plotly_dark",
                margin=dict(l=0, r=0, t=20, b=0),
                plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)'
            )
            st.plotly_chart(fig_bt, use_container_width=True)

    except ImportError:
        st.warning("Install 'vectorbt' to enable backtesting.")
    except Exception as e:
        st.error(f"Backtest Error: {str(e)}")
