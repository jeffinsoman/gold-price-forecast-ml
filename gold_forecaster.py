import pandas as pd
import numpy as np
import sqlite3
from sklearn.linear_model import Lasso
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
from datetime import datetime, timedelta

# ==========================================
# 1. DATABASE & PERSISTENCE LAYER
# ==========================================
def init_forecast_db():
    conn = sqlite3.connect('gold_forecast.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS model_evaluation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            model_name TEXT,
            mse_validation REAL,
            r2_score REAL,
            next_day_forecast REAL
        )
    ''')
    conn.commit()
    conn.close()

def save_evaluation_to_sql(model_name, mse, r2, forecast):
    conn = sqlite3.connect('gold_forecast.db')
    cursor = conn.cursor()
    waktu_sekarang = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute('''
        INSERT INTO model_evaluation_logs (timestamp, model_name, mse_validation, r2_score, next_day_forecast)
        VALUES (?, ?, ?, ?, ?)
    ''', (waktu_sekarang, model_name, mse, r2, forecast))
    conn.commit()
    conn.close()

def fetch_model_history_report():
    conn = sqlite3.connect('gold_forecast.db')
    df = pd.read_sql_query("SELECT * FROM model_evaluation_logs ORDER BY id DESC", conn)
    conn.close()
    return df

# Inisialisasi skema tabel SQL
init_forecast_db()

# ==========================================
# 2. GENERATE TIME-SERIES DATASET (GOLD MARKET)
# ==========================================
np.random.seed(42)
banyak_hari = 200
waktu_awal = datetime.now() - timedelta(days=banyak_hari)
tanggal_list = [(waktu_awal + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(banyak_hari)]

# Simulasi harga emas dengan tren naik + noise acak
harga_dasar = 1200000 
tren = np.linspace(0, 150000, banyak_hari)
noise = np.random.normal(0, 12000, banyak_hari)
harga_emas = harga_dasar + tren + noise

df_emas = pd.DataFrame({'Tanggal': tanggal_list, 'Harga_IDR': harga_emas})

# Feature Engineering: Membuat Fitur Lag (Harga 1, 2, dan 3 hari lalu)
df_emas['Lag_1'] = df_emas['Harga_IDR'].shift(1)
df_emas['Lag_2'] = df_emas['Harga_IDR'].shift(2)
df_emas['Lag_3'] = df_emas['Harga_IDR'].shift(3)
df_emas.dropna(inplace=True)

# ==========================================
# 3. CORE TRAINING & VALIDATION PIPELINE
# ==========================================
X = df_emas[['Lag_1', 'Lag_2', 'Lag_3']]
y = df_emas['Harga_IDR']

X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, shuffle=False)

# Menggunakan model Lasso Regression untuk mereduksi overfitting fitur lag
model_lasso = Lasso(alpha=1.0)
model_lasso.fit(X_train, y_train)

# Validasi Performa Model
y_pred = model_lasso.predict(X_val)
eval_mse = mean_squared_error(y_val, y_pred)
eval_r2 = r2_score(y_val, y_pred)

# Prediksi Harga Emas untuk Hari Esok
data_terakhir = np.array([[df_emas['Harga_IDR'].iloc[-1], df_emas['Harga_IDR'].iloc[-2], df_emas['Harga_IDR'].iloc[-3]]])
prediksi_esok = model_lasso.predict(data_terakhir)[0]

# ==========================================
# 4. DATABASE INTEGRATION EXECUTION
# ==========================================
save_evaluation_to_sql('Lasso Regression', round(eval_mse, 2), round(eval_r2, 4), round(prediksi_esok, 2))

print("=== 🪙 COMODITY FORECASTING & EVALUATION ENGINE ===")
print(f"Total Sampel Historis Pasar: {len(df_emas)} Hari Terhitung")
print(f"Model Algoritma Terpilih   : Lasso Regression")
print(f"Hasil Prediksi Hari Esok   : Rp {round(prediksi_esok, 2):,}")

print("\n--- 📊 VALIDATION PERFORMANCE METRICS ---")
print(f"Mean Squared Error (MSE) : {round(eval_mse, 2):,}")
print(f"R-Squared ($R^2$) Score      : {round(eval_r2, 4)}")

print("\n" + "="*60)
print("🔍 LIVE QUERY: RIWAYAT EVALUASI MODEL DARI DATABASE SQL")
print("="*60)

# Tarik data dari database lokal untuk pembuktian data persistence
df_report = fetch_model_history_report()
print(df_report.head(5).to_string(index=False))