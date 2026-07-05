# Market Pulse AI 全市場異動雷達

加密貨幣、外匯與特殊品項的雙向動能雷達：

- 搜尋全部 USDT 現貨市場，深度分析成交額前 40 名
- 同時分析 5、15、30 分鐘盤面
- 整合爆量、20 根 K 突破、短線價格加速、趨勢與 MACD 加速
- 過濾低流動性及槓桿代幣
- 每分鐘掃描，達門檻時發出頁面聲音及桌面通知
- 同時計算暴漲與暴跌方向
- 外匯：EUR/USD、GBP/USD、USD/JPY、AUD/USD、USD/CAD、USD/CHF
- 特殊品項：黃金、白銀、原油、美元指數
- 四種事件模型：上漲前蓄勢、下跌前轉弱、暴漲後回撤、暴跌後反彈
- 單日波動潛力估算與 5% 機會篩選
- 槓桿僅提供對稱損益風險模擬，不代表報酬保證
- 接入 MEXC 高波動市場；依極端漲跌與成交額選幣，固定納入 B/USDT
- ATR 情境交易計畫：入場觀察區、TP1、TP2、SL、預計持有時間與失效條件
- 本機關注清單持久保存，對 Binance／MEXC 標的每分鐘獨立刷新
- 介面支援繁體中文、英文、西班牙文、日文與韓文

## 環境需求

- Node.js 18 或更新版本
- 可連線至 Binance、MEXC 與 Yahoo Finance 公開行情服務

## 本機啟動

```powershell
npm start
```
or
```powershell
cd "C:文件位置"
npm start
```
```powershell
npm start --prefix "C:文件位置"
```

瀏覽 `http://localhost:4173`。不需要 API Key。

可透過 `PORT` 環境變數調整連接埠：

```powershell
$env:PORT=8080
npm start
```

## GitHub 上傳

```powershell
git init
git add .
git commit -m "Initial release"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

專案沒有內含 API Key；市場資料均由伺服器端呼叫公開行情端點。

## 重要聲明

> 本工具僅供市場研究，不構成投資建議。
