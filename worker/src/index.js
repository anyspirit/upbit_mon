const HOUR_TARGET_COUNT = 24 * 30;
const DAY_TARGET_COUNT = 365;
const HOUR_TIMEFRAME = "1h";
const DAY_TIMEFRAME = "1d";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname.startsWith("/v1/")) {
        return withCors(await proxyUpbit(request, env));
      }

      if (url.pathname === "/api/status") {
        return json(await getStatus(env));
      }

      if (url.pathname === "/api/markets") {
        const result = await refreshMarkets(env);
        return json(result);
      }

      if (url.pathname === "/api/refresh") {
        const limit = readLimit(url, env);
        const result = await refreshStaleMarkets(env, limit);
        return json(result);
      }

      if (url.pathname === "/api/candles") {
        const market = url.searchParams.get("market");
        const timeframe = url.searchParams.get("timeframe");
        return json(await getCachedCandles(env, market, timeframe));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Unexpected error" }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshStaleMarkets(env, Number(env.REFRESH_LIMIT || 5)));
  },
};

async function proxyUpbit(request, env) {
  const sourceUrl = new URL(request.url);
  const targetUrl = buildUpbitUrl(env, sourceUrl.pathname.replace(/^\/v1/, ""));
  targetUrl.search = sourceUrl.search;

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: { Accept: "application/json" },
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function getStatus(env) {
  const marketRow = await env.DB.prepare("SELECT COUNT(*) AS count FROM markets WHERE active = 1").first();
  const cacheRows = await env.DB.prepare(
    `SELECT timeframe, COUNT(*) AS count, MIN(refreshed_at) AS oldest_refreshed_at, MAX(refreshed_at) AS newest_refreshed_at
     FROM candle_cache
     GROUP BY timeframe`
  ).all();

  return {
    markets: marketRow?.count || 0,
    caches: cacheRows.results || [],
    targets: {
      [HOUR_TIMEFRAME]: HOUR_TARGET_COUNT,
      [DAY_TIMEFRAME]: DAY_TARGET_COUNT,
    },
  };
}

async function refreshMarkets(env) {
  const markets = await upbitJson(env, "/market/all?isDetails=false");
  const krwMarkets = markets.filter((item) => item.market.startsWith("KRW-"));
  const now = new Date().toISOString();

  const statements = krwMarkets.map((item) =>
    env.DB.prepare(
      `INSERT INTO markets (market, korean_name, english_name, active, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(market) DO UPDATE SET
         korean_name = excluded.korean_name,
         english_name = excluded.english_name,
         active = 1,
         updated_at = excluded.updated_at`
    ).bind(item.market, item.korean_name, item.english_name, now)
  );

  if (statements.length > 0) {
    await env.DB.batch(statements);
  }

  return { refreshed: krwMarkets.length, updatedAt: now };
}

async function refreshStaleMarkets(env, limit) {
  await ensureMarkets(env);
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const markets = await env.DB.prepare(
    `SELECT m.market
     FROM markets m
     LEFT JOIN candle_cache h ON h.market = m.market AND h.timeframe = ?
     LEFT JOIN candle_cache d ON d.market = m.market AND d.timeframe = ?
     WHERE m.active = 1
       AND (
         h.refreshed_at IS NULL OR d.refreshed_at IS NULL OR
         h.refreshed_at < ? OR
         d.refreshed_at < ?
       )
     ORDER BY COALESCE(h.refreshed_at, '1970-01-01'), m.market
     LIMIT ?`
  )
    .bind(HOUR_TIMEFRAME, DAY_TIMEFRAME, staleBefore, staleBefore, limit)
    .all();

  const refreshed = [];
  const failed = [];

  for (const row of markets.results || []) {
    try {
      await refreshMarketCandles(env, row.market);
      refreshed.push(row.market);
      await sleep(140);
    } catch (error) {
      failed.push({ market: row.market, error: error.message || "refresh failed" });
    }
  }

  return { refreshed, failed, limit };
}

async function ensureMarkets(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM markets WHERE active = 1").first();
  if (!row || row.count === 0) {
    await refreshMarkets(env);
  }
}

async function refreshMarketCandles(env, market) {
  const [hourCandles, dayCandles] = await Promise.all([
    fetchMinuteCandles(env, market, 60, HOUR_TARGET_COUNT),
    fetchDayCandles(env, market, DAY_TARGET_COUNT),
  ]);

  await saveCandleSet(env, market, HOUR_TIMEFRAME, hourCandles);
  await saveCandleSet(env, market, DAY_TIMEFRAME, dayCandles);
}

async function fetchMinuteCandles(env, market, unit, targetCount) {
  return fetchPagedCandles(env, `/candles/minutes/${unit}`, market, targetCount);
}

async function fetchDayCandles(env, market, targetCount) {
  return fetchPagedCandles(env, "/candles/days", market, targetCount);
}

async function fetchPagedCandles(env, path, market, targetCount) {
  const candles = [];
  let to = "";

  while (candles.length < targetCount) {
    const count = Math.min(200, targetCount - candles.length);
    const query = `?market=${market}&count=${count}${to ? `&to=${encodeURIComponent(to)}` : ""}`;
    const batch = await upbitJson(env, `${path}${query}`);
    if (!Array.isArray(batch) || batch.length === 0) break;

    candles.push(...batch.map(compactCandle));
    to = batch[batch.length - 1].candle_date_time_utc;
    await sleep(120);
  }

  return candles.slice(0, targetCount).reverse();
}

function compactCandle(candle) {
  return {
    utc: candle.candle_date_time_utc,
    kst: candle.candle_date_time_kst,
    open: candle.opening_price,
    high: candle.high_price,
    low: candle.low_price,
    close: candle.trade_price,
    volume: candle.candle_acc_trade_volume,
    value: candle.candle_acc_trade_price,
  };
}

async function saveCandleSet(env, market, timeframe, candles) {
  const now = new Date().toISOString();
  const first = candles[0]?.utc || null;
  const last = candles[candles.length - 1]?.utc || null;

  await env.DB.prepare(
    `INSERT INTO candle_cache
       (market, timeframe, candles_json, candle_count, first_candle_at, last_candle_at, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(market, timeframe) DO UPDATE SET
       candles_json = excluded.candles_json,
       candle_count = excluded.candle_count,
       first_candle_at = excluded.first_candle_at,
       last_candle_at = excluded.last_candle_at,
       refreshed_at = excluded.refreshed_at`
  )
    .bind(market, timeframe, JSON.stringify(candles), candles.length, first, last, now)
    .run();
}

async function getCachedCandles(env, market, timeframe) {
  if (!market || !timeframe) {
    throw new Error("market and timeframe are required");
  }

  const row = await env.DB.prepare(
    `SELECT market, timeframe, candles_json, candle_count, first_candle_at, last_candle_at, refreshed_at
     FROM candle_cache
     WHERE market = ? AND timeframe = ?`
  )
    .bind(market, timeframe)
    .first();

  if (!row) {
    return { market, timeframe, candles: [], candleCount: 0, refreshedAt: null };
  }

  return {
    market: row.market,
    timeframe: row.timeframe,
    candles: JSON.parse(row.candles_json),
    candleCount: row.candle_count,
    firstCandleAt: row.first_candle_at,
    lastCandleAt: row.last_candle_at,
    refreshedAt: row.refreshed_at,
  };
}

async function upbitJson(env, path) {
  const response = await fetch(buildUpbitUrl(env, path), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Upbit API ${response.status}`);
  }

  return response.json();
}

function buildUpbitUrl(env, path) {
  const base = (env.UPBIT_API_BASE || "https://api.upbit.com/v1").replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${base}${normalizedPath}`);
}

function readLimit(url, env) {
  const value = Number(url.searchParams.get("limit") || env.REFRESH_LIMIT || 5);
  return Math.max(1, Math.min(20, value));
}

function json(data, status = 200) {
  return withCors(
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  );
}

function withCors(response) {
  const next = new Response(response.body, response);
  next.headers.set("Access-Control-Allow-Origin", "*");
  next.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
