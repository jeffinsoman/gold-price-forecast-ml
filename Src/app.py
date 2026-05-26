import streamlit as st
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta

# Setup Konfigurasi Halaman Dashboard
st.set_page_config(page_title="XAUUSD Quant Trading Bot", page_icon="📈", layout="wide")

st.title("📈 XAUUSD Algorithmic Trading Bot & Dashboard")
st.markdown("Developed by **Dimas Arya Ramadhan** | Powered by XGBoost & Streamlit")
st.write("---")

# 1. Sidebar - Parameter Input dari User
st.sidebar.header("⚙️ Strategy Parameters")
initial_capital = st.sidebar.number_input("Initial Capital ($)", min_value=100, max_value=100000, value=10000, step=500)
ticker_symbol = "GC=F" # Gold Futures

# Ambil data terbaru secara Live dari Yahoo Finance
@st.cache_data(ttl=3600) # Simpan di cache selama 1 jam agar hemat kuota API
def load_live_data():
    end_date = datetime.today().strftime('%Y-%m-%d')
    start_date = (datetime.today() - timedelta(days=365*2)).strftime('%Y-%m-%d') # Ambil data 2 tahun terakhir
    data = yf.download(ticker_symbol, start=start_date, end=end_date)
    
    # SOLUSI: Bersihkan Multi-index atau suffix nama ticker jika ada
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = data.columns.get_level_values(0)
    else:
        data.columns = [col.replace(f' {ticker_symbol}', '').strip() for col in data.columns]
        
    return data

try:
    raw_data = load_live_data()
    
    # 2. Kolom Ringkasan Harga Hari Ini (Metrik Utama)
    latest_close = float(raw_data['Close'].iloc[-1])
    prev_close = float(raw_data['Close'].iloc[-2])
    price_change = latest_close - prev_close
    pct_change = (price_change / prev_close) * 100

    col1, col2, col3 = st.columns(3)
    col1.metric("Live Gold Price (XAUUSD)", f"${latest_close:,.2f}")
    col2.metric("Daily Change ($)", f"${price_change:+.2f}", f"{pct_change:+.2f}%")
    
    # 3. Load Model XGBoost yang Sudah Dituning
    model_path = "models/xgboost_model_tuned.pkl"
    with open(model_path, 'rb') as f:
        model = pickle.load(f)
        
    # Re-engineer features untuk baris data paling baru
    df_features = raw_data.copy()
    df_features['SMA_10'] = df_features['Close'].rolling(window=10).mean()
    df_features['SMA_30'] = df_features['Close'].rolling(window=30).mean()
    rolling_std = df_features['Close'].rolling(window=20).std()
    df_features['BB_Width'] = (rolling_std * 4) / df_features['Close'].rolling(window=20).mean()
    df_features['Log_Return'] = np.log(df_features['Close'] / df_features['Close'].shift(1))
    df_features['Lag_1'] = df_features['Log_Return'].shift(1)
    df_features['Lag_2'] = df_features['Log_Return'].shift(2)
    df_features.dropna(inplace=True)
    
    # Ambil urutan fitur yang pas sesuai training data model
    feature_columns = ['Close', 'High', 'Low', 'Open', 'Volume', 'SMA_10', 'SMA_30', 'BB_Width', 'Lag_1', 'Lag_2']
    X_matrix = df_features[feature_columns]
    
    # Ambil baris terakhir untuk prediksi besok
    latest_features = X_matrix.iloc[[-1]]
    
    # Prediksi Signal
    prediction = model.predict(latest_features)[0]
    prob = model.predict_proba(latest_features)[0]
    confidence = prob[1] if prediction == 1 else prob[0]
    
    if prediction == 1:
        col3.metric("Next Day Signal", "🚀 BUY / LONG", f"Confidence: {confidence*100:.1f}%")
    else:
        col3.metric("Next Day Signal", "📉 SELL / SHORT", f"Confidence: {confidence*100:.1f}%")

    st.write("---")
    
    # 4. Bagian Grafik Performa (Backtest & Market Chart)
    tab1, tab2 = st.tabs(["📊 Strategy Backtest Performance", "📉 Price Chart & Technicals"])
    
    with tab1:
        st.subheader("Simulated Equity Curve")
        
        # Simulasi Trading sederhana pada data historis yang tersedia
        df_features['Signal'] = model.predict(X_matrix)
        df_features['Position'] = np.where(df_features['Signal'] == 1, 1, -1)
        df_features['Strategy_Return'] = df_features['Position'] * df_features['Log_Return']
        
        df_features['Cum_Buy_Hold'] = np.exp(df_features['Log_Return'].cumsum())
        df_features['Cum_Strategy'] = np.exp(df_features['Strategy_Return'].cumsum())
        
        # Hitung Nilai Dolar Akhir Portfolio
        final_bh_val = initial_capital * df_features['Cum_Buy_Hold'].iloc[-1]
        final_strat_val = initial_capital * df_features['Cum_Strategy'].iloc[-1]
        
        # Plotting menggunakan Matplotlib
        fig, ax = plt.subplots(figsize=(10, 4))
        ax.plot(df_features.index, initial_capital * df_features['Cum_Buy_Hold'], label="Buy & Hold (Gold)", color="gray", linestyle="--")
        ax.plot(df_features.index, initial_capital * df_features['Cum_Strategy'], label="XGBoost Strategy", color="gold", linewidth=2)
        ax.set_ylabel("Portfolio Value ($)")
        ax.legend()
        ax.grid(True, alpha=0.3)
        
        st.pyplot(fig)
        
        # Metrik Hasil Akhir Simulasi
        sub_col1, sub_col2 = st.columns(2)
        sub_col1.write(f"**Final Buy & Hold Value:** ${final_bh_val:,.2f}")
        sub_col2.write(f"**Final XGBoost Strategy Value:** ${final_strat_val:,.2f}")

    with tab2:
        st.subheader("Gold Historical Price with Moving Averages")
        fig2, ax2 = plt.subplots(figsize=(10, 4))
        ax2.plot(df_features.index, df_features['Close'], label="Close Price", color="white", alpha=0.6)
        ax2.plot(df_features.index, df_features['SMA_10'], label="SMA 10", color="cyan")
        ax2.plot(df_features.index, df_features['SMA_30'], label="SMA 30", color="magenta")
        ax2.set_ylabel("Price ($)")
        ax2.legend()
        ax2.grid(True, alpha=0.2)
        plt.style.use('dark_background') 
        st.pyplot(fig2)

except Exception as e:
    st.error(f"Gagal memuat data atau model: {e}")