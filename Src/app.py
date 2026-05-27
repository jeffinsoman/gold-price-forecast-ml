import streamlit as st
import yfinance as tf
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime, timedelta

# Pengaturan dasar halaman Streamlit
st.set_page_config(page_title="XAUUSD Quant Trading Engine", layout="wide")

st.title("XAUUSD Quantitative Trading & Predictive Engine")
st.markdown("Automated algorithmic forecasting model for Gold Futures using quantitative feature engineering.")

# -------------------------------------------------------------------
# SIDEBAR - CONFIGURATION
# -------------------------------------------------------------------
st.sidebar.header("Strategy Configurations")
ticker = st.sidebar.text_input("Asset Ticker", value="GC=F") # Gold Futures
backtest_days = st.sidebar.slider("Backtest Window (Days)", min_value=30, max_value=365, value=180)

# Fetch Data Live via yFinance
@st.cache_data(ttl=3600)
def load_gold_data(symbol, days):
    end_date = datetime.today()
    start_date = end_date - timedelta(days=days + 60) # Ambil ekstra hari untuk kalkulasi MA
    df = tf.download(symbol, start=start_date, end=end_date)
    return df

try:
    df_raw = load_gold_data(ticker, backtest_days)
    
    if df_raw.empty:
        st.error("Failed to retrieve data. Please check the ticker symbol or connection.")
    else:
        # -------------------------------------------------------------------
        # FEATURE ENGINEERING & QUANTSTRAT
        # -------------------------------------------------------------------
        df = df_raw.copy()
        
        # Kalkulasi Indikator Teknis (Fitur Kuantitatif)
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA50'] = df['Close'].rolling(window=50).mean()
        
        # Logika Sinyal Kuantitatif (Golden Cross / Death Cross)
        df['Signal'] = 0
        df.loc[df['MA20'] > df['MA50'], 'Signal'] = 1  # Buy Signal
        df.loc[df['MA20'] <= df['MA50'], 'Signal'] = -1 # Sell Signal
        
        # Menghitung return harian aset dan return strategi
        df['Asset_Return'] = df['Close'].pct_change()
        df['Strategy_Return'] = df['Asset_Return'] * df['Signal'].shift(1)
        
        # Filter berdasarkan window backtest yang dipilih user
        df_filtered = df.tail(backtest_days).copy()
        
        # -------------------------------------------------------------------
        # METRICS CALCULATION (UPGRADE: ADVANCED FINANCIAL METRICS)
        # -------------------------------------------------------------------
        latest_price = float(df_filtered['Close'].iloc[-1])
        price_change = float(df_filtered['Close'].iloc[-1] - df_filtered['Close'].iloc[0])
        pct_change = (price_change / float(df_filtered['Close'].iloc[0])) * 100
        
        # Kalkulasi Performa Strategi Algoritmik
        total_strategy_return = (df_filtered['Strategy_Return'] + 1).prod() - 1
        win_trades = df_filtered[df_filtered['Strategy_Return'] > 0].shape[0]
        total_trades = df_filtered[df_filtered['Signal'].diff() != 0].shape[0]
        win_rate = (win_trades / total_trades * 100) if total_trades > 0 else 0.0
        
        # Menampilkan Ringkasan Metrik di Atas Dashboard
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Latest XAUUSD Price", f"${latest_price:,.2f}")
        with col2:
            st.metric("Asset Period Return", f"{pct_change:+.2f}%")
        with col3:
            st.metric("Algorithmic Strategy Return", f"{total_strategy_return * 100:+.2f}%")
        with col4:
            st.metric("Strategy Win Rate", f"{win_rate:.1f}%")
            
        st.markdown("---")
        
        # -------------------------------------------------------------------
        # GRAPHICAL ANALYTICS VISUALIZATION
        # -------------------------------------------------------------------
        st.subheader("Market Trend & Technical Moving Averages")
        
        sns.set_theme(style="darkgrid")
        fig, ax = plt.subplots(figsize=(14, 6))
        ax.plot(df_filtered.index, df_filtered['Close'], label='XAUUSD Close Price', color='#D4AF37', linewidth=2)
        ax.plot(df_filtered.index, df_filtered['MA20'], label='Fast Moving Average (20 MA)', color='#1E90FF', linestyle='--')
        ax.plot(df_filtered.index, df_filtered['MA50'], label='Slow Moving Average (50 MA)', color='#FF4500', linestyle='--')
        
        ax.set_title("Quantitative Moving Average Crossover Backtest Strategy Evaluation", fontsize=14, fontweight='bold', pad=15)
        ax.set_xlabel("Timeline", fontsize=11)
        ax.set_ylabel("Price in USD", fontsize=11)
        ax.legend(loc='upper left', frameon=True)
        plt.xticks(rotation=15)
        
        st.pyplot(fig)
        
        # -------------------------------------------------------------------
        # LIVE SIGNAL FORECAST
        # -------------------------------------------------------------------
        st.subheader("Current Predictive Signal Analysis")
        current_signal = df_filtered['Signal'].iloc[-1]
        
        if current_signal == 1:
            st.success("BULLISH TREND DETECTED: Algorithmic system issues a BUY / HOLD directive based on mathematical crossover confirmation.")
        else:
            st.error("BEARISH TREND DETECTED: Algorithmic system issues a LIQUIDATE / SHORT directive based on mathematical crossover confirmation.")
            
except Exception as e:
    st.error(f"An unexpected system error occurred during execution: {str(e)}")