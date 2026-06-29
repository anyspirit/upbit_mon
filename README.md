# Upbit Pattern Scanner

A GitHub Pages web app for filtering Upbit KRW market coins by repeatable pattern conditions.

## Features

- Scans Upbit KRW market coins
- Shows BTC/KRW price, daily change rate, daily change amount, and BTC moving-average state
- Displays TradingView charts using Binance USDT symbols
- Shows whether the latest candle is above 1H MA20, 1H MA60, 1D MA20, and 1D MA60
- Filters by price position versus each key MA and daily volume ratio
- Reuses cached candle data in browser storage to reduce repeated API calls
- Saves support and resistance levels per coin in browser storage
- Filters by support check or resistance breakout
- Provides memo tabs for trading rules and trading tips
- Exports scan results as CSV

## GitHub Pages

Publish these files to the repository root:

```text
index.html
app.js
coin-data.js
memo-data.js
styles.css
README.md
```

The live site is:

```text
https://anyspirit.github.io/upbit_mon/
```

## Notes

- The default Worker URL is managed in `app.js` as `DEFAULT_DATA_API_BASE`.
- You can override the Worker URL once with `?api=https://your-worker.workers.dev`.
- Upbit proxy calls use `${DATA_API_BASE}/v1`.
- Stored candle calls use `${DATA_API_BASE}/api/candles`.
- Charts use Binance `SYMBOLUSDT` pairs.
- Coins that do not exist on Binance may not show a TradingView chart.
- Support/resistance levels, memos, and candle cache are stored in browser `localStorage`.
- Default coin classifications are stored in `coin-data.js`.

## Worker and D1

The `worker/` folder contains a Cloudflare Worker + D1 cache design for storing KRW market candle data.

- `1h`: 720 hourly candles per KRW market
- `1d`: 365 daily candles per KRW market
- D1 stores one JSON row per `market + timeframe` to stay friendly to free-tier write limits
