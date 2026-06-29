# Upbit Pattern API Worker

Cloudflare Worker + D1 cache for Upbit KRW market candle data.

## Storage policy

- `1h`: stores 720 hourly candles per KRW market, roughly one month.
- `1d`: stores 365 daily candles per KRW market, roughly one year.
- Candle arrays are stored as JSON in one D1 row per `market + timeframe`.
- This keeps daily writes low enough for personal free-tier use.

## Setup

1. Create a D1 database in Cloudflare.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Replace `database_id` in `wrangler.toml`.
4. Apply the schema:

```powershell
npx wrangler d1 execute upbit_pattern --file=worker/schema.sql
```

5. Deploy:

```powershell
npx wrangler deploy --config worker/wrangler.toml
```

## Endpoints

```text
GET /v1/*
```

Proxies Upbit quotation API paths.

```text
GET /api/markets
```

Refreshes KRW market metadata in D1.

```text
GET /api/refresh?limit=5
```

Refreshes stale candle data for a limited number of markets.

```text
GET /api/candles?market=KRW-BTC&timeframe=1h
GET /api/candles?market=KRW-BTC&timeframe=1d
```

Reads cached candles from D1.

```text
GET /api/status
```

Shows market count and cache status.

## Free-tier note

The cron runs every 15 minutes and refreshes only a small batch of stale markets each time. This avoids trying to update every KRW market in one Worker execution.
