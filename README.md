# Upbit Pattern Scanner

A GitHub Pages web app for filtering Upbit KRW market coins by repeatable pattern conditions.

## Features

- Scans Upbit KRW market coins
- Shows BTC/KRW price, daily change rate, daily change amount, and BTC moving-average state
- Displays TradingView charts using Binance USDT symbols
- Shows whether the latest candle is above 1H MA20, 1H MA60, 1D MA20, and 1D MA60
- Filters by price position versus each key MA and daily volume ratio
- Saves support and resistance levels per coin in browser storage
- Filters by support check or resistance breakout
- Provides memo tabs for trading rules and trading tips
- Exports scan results as CSV

## GitHub Pages

Publish these files to the repository root:

```text
index.html
app.js
memo-data.js
styles.css
README.md
```

The live site is:

```text
https://anyspirit.github.io/upbit_mon/
```

## Notes

- The data proxy URL is managed in `app.js` as `API_BASE`.
- Charts use Binance `SYMBOLUSDT` pairs.
- Coins that do not exist on Binance may not show a TradingView chart.
- Support/resistance levels and memos are stored in browser `localStorage`.
