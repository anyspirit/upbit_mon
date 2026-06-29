CREATE TABLE IF NOT EXISTS markets (
  market TEXT PRIMARY KEY,
  korean_name TEXT NOT NULL,
  english_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candle_cache (
  market TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  candles_json TEXT NOT NULL,
  candle_count INTEGER NOT NULL,
  first_candle_at TEXT,
  last_candle_at TEXT,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (market, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_candle_cache_refreshed_at
ON candle_cache(timeframe, refreshed_at);

CREATE TABLE IF NOT EXISTS refresh_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
