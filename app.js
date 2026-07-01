const DEFAULT_DATA_API_BASE = "https://upbit-pattern-api.anyspirit.workers.dev";
const DATA_API_BASE = resolveDataApiBase();
const API_BASE = `${DATA_API_BASE}/v1`;
const CANDLE_API_BASE = `${DATA_API_BASE}/api`;
const TRADINGVIEW_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const MEMO_KEY = "upbit-pattern-memo-cards";
const COIN_DB_KEY = "upbit-pattern-coin-db";
const CANDLE_CACHE_KEY = "upbit-pattern-candle-cache";
const HOUR_CANDLE_CACHE_MS = 20 * 60 * 1000;
const DAY_CANDLE_CACHE_MS = 6 * 60 * 60 * 1000;
const CONVERGENCE_PERIODS = [20, 60, 120, 240, 365];
const CONVERGENCE_TOLERANCE = 0.01;
const STABLE_SYMBOLS = new Set(["USDS", "USD1", "USDT", "USDC", "USDE"]);

function resolveDataApiBase() {
  const params = new URLSearchParams(window.location.search);
  const apiFromUrl = params.get("api");
  if (apiFromUrl) {
    localStorage.setItem("upbit-pattern-api-base", apiFromUrl.replace(/\/$/, ""));
    return apiFromUrl.replace(/\/$/, "");
  }
  return localStorage.getItem("upbit-pattern-api-base") || DEFAULT_DATA_API_BASE;
}

const DEFAULT_COIN_DB = window.DEFAULT_COIN_DB || {};
const COIN_GROUPS = [
  { id: "favorite", label: "관심코인" },
  { id: "major", label: "메이저코인" },
  { id: "kimchi", label: "김치코인" },
  { id: "new", label: "신규코인" },
  { id: "top20", label: "Top20코인" },
  { id: "excluded", label: "제외코인" },
  { id: "unclassified", label: "미분류" },
];

const $ = (selector) => document.querySelector(selector);

const els = {
  loadingOverlay: $("#loadingOverlay"),
  tabs: document.querySelectorAll(".tab"),
  scannerPage: $("#scannerPage"),
  coinsPage: $("#coinsPage"),
  notesPage: $("#notesPage"),
  coinGroup: $("#coinGroup"),
  keyword: $("#keyword"),
  tradeValueButtons: document.querySelectorAll("[data-trade-value]"),
  h1ConvergenceToggle: $("#h1ConvergenceToggle"),
  conditionOneToggle: $("#conditionOneToggle"),
  uptrendToggle: $("#uptrendToggle"),
  minVolumeRatio: $("#minVolumeRatio"),
  volumePeriod: $("#volumePeriod"),
  sortBy: $("#sortBy"),
  searchButton: $("#searchButton"),
  resetButton: $("#resetButton"),
  chartPanel: $("#chartPanel"),
  chartToggleButton: $("#chartToggleButton"),
  chartTitle: $("#chartTitle"),
  tradingviewChart: $("#tradingviewChart"),
  results: $("#results"),
  resultMeta: $("#resultMeta"),
  coinDbSearch: $("#coinDbSearch"),
  coinDbSummary: $("#coinDbSummary"),
  coinGroupGrid: $("#coinGroupGrid"),
  memoType: $("#memoType"),
  memoTitle: $("#memoTitle"),
  memoBody: $("#memoBody"),
  addMemoButton: $("#addMemoButton"),
  exportMemosButton: $("#exportMemosButton"),
  memoSavedAt: $("#memoSavedAt"),
  ruleMemoList: $("#ruleMemoList"),
  tipMemoList: $("#tipMemoList"),
  ruleMemoCount: $("#ruleMemoCount"),
  tipMemoCount: $("#tipMemoCount"),
};

let markets = [];
let currentRows = [];
let memoCards = readMemoCards();
let coinDb = { ...DEFAULT_COIN_DB, ...readJson(COIN_DB_KEY, {}) };
let candleCache = readJson(CANDLE_CACHE_KEY, {});

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readMemoCards() {
  const saved = readJson(MEMO_KEY, null);
  if (Array.isArray(saved)) return saved;
  return Array.isArray(window.DEFAULT_MEMO_CARDS) ? window.DEFAULT_MEMO_CARDS : [];
}

function setStatus(text, tone = "idle") {
  document.body.dataset.status = tone;
  document.body.dataset.statusText = text;
}

function numberValue(el) {
  if (el.value === "") return null;
  const value = Number(el.value);
  return Number.isFinite(value) ? value : null;
}

function getFormRule() {
  return {
    coinGroup: els.coinGroup.value,
    keyword: els.keyword.value.trim().toLowerCase(),
    minTradeValue: getSelectedTradeValue(),
    patternFilters: {
      convergence: els.h1ConvergenceToggle.classList.contains("active"),
      conditionOne: els.conditionOneToggle.classList.contains("active"),
      uptrend: els.uptrendToggle.classList.contains("active"),
    },
    minVolumeRatio: numberValue(els.minVolumeRatio),
    volumePeriod: Number(els.volumePeriod.value),
    sortBy: els.sortBy.value,
  };
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Data API ${response.status}`);
  return response.json();
}

async function fetchBackendJson(path) {
  const response = await fetch(`${CANDLE_API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Backend API ${response.status}`);
  return response.json();
}

async function loadMarkets() {
  setStatus("마켓 불러오는 중");
  const allMarkets = await fetchJson("/market/all?isDetails=false");
  markets = allMarkets.filter((market) => market.market.startsWith("KRW-"));
  setStatus(`${markets.length}개 KRW 마켓 준비`, "ok");
  renderCoinDb();
}

function marketsForRule(rule) {
  return markets.filter((market) => {
    const symbol = market.market.replace("KRW-", "").toUpperCase();
    if (STABLE_SYMBOLS.has(symbol)) return false;
    const meta = coinDb[market.market] ?? {};
    const keywordTarget = `${market.market} ${market.korean_name} ${market.english_name} ${meta.nickname ?? ""}`.toLowerCase();
    const groupMatch = rule.coinGroup === "all" || (meta.groups ?? []).includes(rule.coinGroup);
    const keywordMatch = !rule.keyword || keywordTarget.includes(rule.keyword);
    return groupMatch && keywordMatch;
  });
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchTickers(marketCodes) {
  const batches = chunk(marketCodes, 100);
  const results = [];
  for (const batch of batches) {
    const encoded = encodeURIComponent(batch.join(","));
    results.push(...(await fetchJson(`/ticker?markets=${encoded}`)));
  }
  return results;
}

async function fetchDayCandles(market, targetCount) {
  return fetchCachedCandles({
    key: `day:${market}:${targetCount}`,
    ttlMs: DAY_CANDLE_CACHE_MS,
    load: () => fetchStoredCandles(market, "1d", targetCount).catch(() => fetchRawDayCandles(market, targetCount)),
  });
}

async function fetchRawDayCandles(market, targetCount) {
  const candles = [];
  let to = "";

  while (candles.length < targetCount) {
    const count = Math.min(200, targetCount - candles.length);
    const path = `/candles/days?market=${market}&count=${count}${to ? `&to=${encodeURIComponent(to)}` : ""}`;
    const batch = await fetchJson(path);
    if (!Array.isArray(batch) || batch.length === 0) break;
    candles.push(...batch);
    to = batch[batch.length - 1].candle_date_time_utc;
    await delay(90);
  }

  return candles.slice(0, targetCount).reverse();
}

async function fetchMinuteCandles(market, unit, targetCount) {
  return fetchCachedCandles({
    key: `minute:${unit}:${market}:${targetCount}`,
    ttlMs: unit === 60 ? HOUR_CANDLE_CACHE_MS : 5 * 60 * 1000,
    load: () =>
      unit === 60
        ? fetchStoredCandles(market, "1h", targetCount).catch(() => fetchRawMinuteCandles(market, unit, targetCount))
        : fetchRawMinuteCandles(market, unit, targetCount),
  });
}

async function fetchStoredCandles(market, timeframe, targetCount) {
  const data = await fetchBackendJson(`/candles?market=${encodeURIComponent(market)}&timeframe=${encodeURIComponent(timeframe)}`);
  const candles = Array.isArray(data.candles) ? data.candles : [];

  if (candles.length < targetCount) {
    throw new Error(`Stored candles are not ready: ${market} ${timeframe}`);
  }

  return candles.slice(-targetCount).map(normalizeStoredCandle);
}

function normalizeStoredCandle(candle) {
  return {
    candle_date_time_utc: candle.utc,
    candle_date_time_kst: candle.kst,
    opening_price: candle.open,
    high_price: candle.high,
    low_price: candle.low,
    trade_price: candle.close,
    candle_acc_trade_volume: candle.volume,
    candle_acc_trade_price: candle.value,
  };
}

async function fetchRawMinuteCandles(market, unit, targetCount) {
  const candles = [];
  let to = "";

  while (candles.length < targetCount) {
    const count = Math.min(200, targetCount - candles.length);
    const path = `/candles/minutes/${unit}?market=${market}&count=${count}${to ? `&to=${encodeURIComponent(to)}` : ""}`;
    const batch = await fetchJson(path);
    if (!Array.isArray(batch) || batch.length === 0) break;
    candles.push(...batch);
    to = batch[batch.length - 1].candle_date_time_utc;
    await delay(90);
  }

  return candles.slice(0, targetCount).reverse();
}

async function fetchCachedCandles({ key, ttlMs, load }) {
  const cached = candleCache[key];
  const now = Date.now();

  if (cached && now - cached.savedAt < ttlMs && Array.isArray(cached.candles)) {
    return cached.candles;
  }

  const candles = await load();
  candleCache[key] = { savedAt: now, candles };
  writeCandleCache();
  return candles;
}

function writeCandleCache() {
  const entries = Object.entries(candleCache)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, 240);
  candleCache = Object.fromEntries(entries);
  writeJson(CANDLE_CACHE_KEY, candleCache);
}

async function enrichRowsWithPatternData(rows, rule) {
  const enriched = [];
  const limitedRows = rows.slice(0, 80);

  for (const row of limitedRows) {
    try {
      const [hourCandles, dayCandles] = await Promise.all([fetchMinuteCandles(row.market, 60, 365), fetchDayCandles(row.market, 60)]);
      const ma = {
        h1: calculateMovingAverages(hourCandles),
        d1: calculateMovingAverages(dayCandles),
      };
      const patterns = calculatePatterns(row.trade_price, ma);
      const volumeRatio = calculateVolumeRatio(dayCandles, rule.volumePeriod);
      enriched.push({ ...row, ma, patterns, volumeRatio });
      await delay(100);
    } catch {
      enriched.push({ ...row, ma: emptyMaSet(), patterns: emptyPatterns(), volumeRatio: null });
    }
  }

  return enriched;
}

function emptyMa() {
  return { 20: null, 60: null, 120: null, 365: null, bullStack: false, bearStack: false };
}

function emptyMaSet() {
  return { h1: emptyMa(), d1: emptyMa() };
}

function calculateMovingAverages(candles) {
  const closes = candles.map((candle) => candle.trade_price);
  const ma = {
    20: average(closes.slice(-20)),
    60: average(closes.slice(-60)),
    120: average(closes.slice(-120)),
    240: average(closes.slice(-240)),
    365: average(closes.slice(-365)),
  };
  ma.bullStack = [ma[20], ma[60], ma[120], ma[365]].every(Number.isFinite) && ma[20] > ma[60] && ma[60] > ma[120] && ma[120] > ma[365];
  ma.bearStack = [ma[20], ma[60], ma[120], ma[365]].every(Number.isFinite) && ma[20] < ma[60] && ma[60] < ma[120] && ma[120] < ma[365];
  return ma;
}

function calculatePatterns(price, ma) {
  const h1Values = CONVERGENCE_PERIODS.map((period) => ma.h1[period]);
  const hasAllH1 = h1Values.every(Number.isFinite);
  const h1Convergence = hasAllH1 && h1Values.every((value) => Math.abs((price - value) / price) <= CONVERGENCE_TOLERANCE);
  const conditionOne = isAboveMaValue(price, ma.h1[20]) && isAboveMaValue(price, ma.h1[60]) && ma.h1[20] > ma.h1[60];
  const dailyAbove = isAboveMaValue(price, ma.d1[20]) && isAboveMaValue(price, ma.d1[60]);
  const uptrend = conditionOne && dailyAbove;

  return { h1Convergence, conditionOne, uptrend };
}

function emptyPatterns() {
  return { h1Convergence: false, conditionOne: false, uptrend: false };
}

function calculateVolumeRatio(candles, period) {
  if (candles.length < period + 1) return null;
  const volumes = candles.map((candle) => candle.candle_acc_trade_volume);
  const latest = volumes.at(-1);
  const previousAverage = average(volumes.slice(-(period + 1), -1));
  return previousAverage ? latest / previousAverage : null;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMatches(rule) {
  if (markets.length === 0) await loadMarkets();
  const selectedMarkets = marketsForRule(rule);
  if (selectedMarkets.length === 0) return [];

  const marketMap = new Map(selectedMarkets.map((market) => [market.market, market]));
  const tickers = await fetchTickers(selectedMarkets.map((market) => market.market));
  const baseRows = tickers
    .map((ticker) => ({ ...ticker, info: marketMap.get(ticker.market), meta: coinDb[ticker.market] ?? {} }))
    .filter((row) => {
      if (rule.minTradeValue !== null && row.acc_trade_price_24h < rule.minTradeValue) return false;
      return true;
    })
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h);

  const enrichedRows = await enrichRowsWithPatternData(baseRows, rule);
  return enrichedRows
    .filter((row) => matchesMaRule(row, rule))
    .filter((row) => matchesVolumeRule(row, rule))
    .sort((a, b) => compareRows(a, b, rule.sortBy));
}

function matchesMaRule(row, rule) {
  if (rule.patternFilters.convergence && !row.patterns.h1Convergence) return false;
  if (rule.patternFilters.conditionOne && !row.patterns.conditionOne) return false;
  if (rule.patternFilters.uptrend && !row.patterns.uptrend) return false;
  return true;
}

function isAboveMaValue(price, value) {
  return Number.isFinite(value) && price > value;
}

function matchesVolumeRule(row, rule) {
  if (rule.minVolumeRatio === null) return true;
  return row.volumeRatio !== null && row.volumeRatio >= rule.minVolumeRatio;
}

function compareRows(a, b, sortBy) {
  if (sortBy === "changeRate") return b.signed_change_rate - a.signed_change_rate;
  if (sortBy === "volumeRatio") return (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1);
  if (sortBy === "maDistance") return maDistance(a) - maDistance(b);
  return b.acc_trade_price_24h - a.acc_trade_price_24h;
}

function maDistance(row) {
  if (!Number.isFinite(row.ma?.h1?.[20])) return Number.POSITIVE_INFINITY;
  return Math.abs((row.trade_price - row.ma.h1[20]) / row.ma.h1[20]);
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);
}

function formatSignedMoney(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function formatTradeValue(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value / 100000000).toFixed(1)}억`;
}

function marketToUpbitSymbol(market) {
  const code = market.replace("KRW-", "");
  return `UPBIT:${code}KRW`;
}

function renderTradingView(symbol, label) {
  els.chartTitle.textContent = `${label} 차트`;
  els.tradingviewChart.innerHTML = "";

  const script = document.createElement("script");
  script.src = TRADINGVIEW_SRC;
  script.async = true;
  script.innerHTML = JSON.stringify({
    autosize: true,
    symbol,
    interval: "D",
    timezone: "Asia/Seoul",
    theme: "light",
    style: "1",
    locale: "kr",
    allow_symbol_change: true,
    hide_side_toolbar: false,
    calendar: false,
    support_host: "https://www.tradingview.com",
    studies: ["MASimple@tv-basicstudies", "Volume@tv-basicstudies"],
  });

  els.tradingviewChart.appendChild(script);
}

function renderResults(rows) {
  currentRows = rows;
  if (rows.length === 0) {
    els.results.innerHTML = `<tr><td colspan="9" class="empty">조건에 맞는 코인이 없습니다.</td></tr>`;
    return;
  }

  els.results.innerHTML = rows
    .map((row) => {
      const change = row.signed_change_rate * 100;
      const changeClass = change >= 0 ? "gain" : "loss";
      const upbitUrl = `https://upbit.com/exchange?code=CRIX.UPBIT.${row.market}`;
      const nickname = row.meta.nickname ? ` · ${row.meta.nickname}` : "";
      return `
        <tr>
          <td>
            <div class="coin-name">
              <strong>${row.info.korean_name}${nickname}</strong>
              <span>${row.market} · ${row.info.english_name}</span>
            </div>
          </td>
          <td>${formatNumber(row.trade_price)}원</td>
          <td class="${changeClass}">${change.toFixed(2)}%</td>
          <td>${formatTradeValue(row.acc_trade_price_24h)}</td>
          <td>${formatPattern(row.patterns.h1Convergence)}</td>
          <td>${formatPattern(row.patterns.conditionOne)}</td>
          <td>${formatPattern(row.patterns.uptrend)}</td>
          <td>${row.volumeRatio === null ? "-" : `${row.volumeRatio.toFixed(2)}x`}</td>
          <td>
            <button type="button" data-chart="${row.market}">차트</button>
            <a href="${upbitUrl}" target="_blank" rel="noopener">업비트</a>
          </td>
        </tr>
      `;
    })
    .join("");

  els.results.querySelectorAll("[data-chart]").forEach((button) => {
    button.addEventListener("click", () => {
      const market = button.dataset.chart;
      renderTradingView(marketToUpbitSymbol(market), market.replace("KRW-", "") + "KRW");
    });
  });

}

function formatPattern(active) {
  return active ? `<span class="gain">충족</span>` : `<span class="loss">미충족</span>`;
}

async function searchNow() {
  const rule = getFormRule();
  els.searchButton.disabled = true;
  setLoading(true);
  setStatus("검색 중");
  try {
    const rows = await findMatches(rule);
    renderResults(rows);
    const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    els.resultMeta.textContent = `${rows.length}개 발견 · ${now} 기준`;
    setStatus("검색 완료", "ok");
  } catch (error) {
    console.error(error);
    toast("데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도해주세요.");
    setStatus("연결 오류", "error");
  } finally {
    els.searchButton.disabled = false;
    setLoading(false);
  }
}

function resetForm() {
  els.coinGroup.value = "all";
  els.keyword.value = "";
  setTradeValueFilter(5000000000);
  setToggle(els.h1ConvergenceToggle, false);
  setToggle(els.conditionOneToggle, false);
  setToggle(els.uptrendToggle, false);
  els.minVolumeRatio.value = "";
  els.volumePeriod.value = "20";
  els.sortBy.value = "tradeValue";
}

function toggleChart() {
  const collapsed = els.chartPanel.classList.toggle("collapsed");
  els.chartToggleButton.textContent = collapsed ? "차트 보기" : "차트 접기";
  els.chartToggleButton.setAttribute("aria-expanded", String(!collapsed));
}

function setupTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
      els.scannerPage.classList.toggle("active", tab.dataset.tab === "scanner");
      els.coinsPage.classList.toggle("active", tab.dataset.tab === "coins");
      els.notesPage.classList.toggle("active", tab.dataset.tab === "notes");
    });
  });
}

function setupCoinDb() {
  els.coinDbSearch.addEventListener("input", renderCoinDb);
  renderCoinDb();
}

function renderCoinDb() {
  if (!els.coinGroupGrid) return;
  const keyword = (els.coinDbSearch.value || "").trim().toLowerCase();
  const rows = markets
    .map((market) => ({ ...market, meta: coinDb[market.market] ?? {} }))
    .filter((market) => {
      if (!keyword) return true;
      const target = `${market.market} ${market.korean_name} ${market.english_name} ${market.meta.nickname ?? ""}`.toLowerCase();
      return target.includes(keyword);
    });

  const totalClassified = Object.keys(coinDb).length;
  els.coinDbSummary.textContent = `${rows.length}개 표시 · ${totalClassified}개 분류됨`;
  els.coinGroupGrid.innerHTML = COIN_GROUPS.map((group) => renderCoinGroup(group, rows)).join("");
}

function renderCoinGroup(group, rows) {
  const items = rows.filter((market) => belongsToCoinGroup(market, group.id));
  return `
    <article class="coin-group-card">
      <div class="panel-head">
        <h2>${group.label}</h2>
        <span class="saved-at">${items.length}개</span>
      </div>
      <div class="coin-list">
        ${
          items.length === 0
            ? `<p class="empty">해당 코인이 없습니다.</p>`
            : items.map(renderCoinItem).join("")
        }
      </div>
    </article>
  `;
}

function belongsToCoinGroup(market, groupId) {
  const meta = market.meta ?? {};
  if (groupId === "favorite") return meta.favorite === true;
  if (groupId === "excluded") return meta.excluded === true;
  if (groupId === "unclassified") return !meta.favorite && !meta.excluded && (!Array.isArray(meta.groups) || meta.groups.length === 0);
  return (meta.groups ?? []).includes(groupId);
}

function renderCoinItem(market) {
  const groups = market.meta.groups ?? [];
  const flags = [
    market.meta.favorite ? "관심" : "",
    market.meta.excluded ? "제외" : "",
    ...groups.map((group) => COIN_GROUPS.find((item) => item.id === group)?.label ?? group),
  ].filter(Boolean);

  return `
    <div class="coin-db-item">
      <div>
        <strong>${market.korean_name}</strong>
        <span>${market.market} · ${market.english_name}</span>
      </div>
      <div class="coin-db-meta">
        ${market.meta.nickname ? `<em>${market.meta.nickname}</em>` : ""}
        ${flags.map((flag) => `<small>${flag}</small>`).join("")}
      </div>
    </div>
  `;
}

function setupMemos() {
  renderMemoCards();
  els.addMemoButton.addEventListener("click", addMemoCard);
  els.exportMemosButton.addEventListener("click", exportMemoCards);
}

function addMemoCard() {
  const title = els.memoTitle.value.trim();
  const body = els.memoBody.value.trim();
  if (!title || !body) {
    toast("제목과 내용을 입력해주세요.");
    return;
  }

  memoCards = [
    {
      id: crypto.randomUUID(),
      type: els.memoType.value,
      title,
      body,
      createdAt: new Date().toISOString(),
    },
    ...memoCards,
  ];
  saveMemoCards();
  els.memoTitle.value = "";
  els.memoBody.value = "";
  renderMemoCards();
}

function deleteMemoCard(id) {
  memoCards = memoCards.filter((memo) => memo.id !== id);
  saveMemoCards();
  renderMemoCards();
}

function saveMemoCards() {
  writeJson(MEMO_KEY, memoCards);
  const now = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  els.memoSavedAt.textContent = `${now} 저장됨`;
}

function renderMemoCards() {
  const rules = memoCards.filter((memo) => memo.type === "rule");
  const tips = memoCards.filter((memo) => memo.type === "tip");
  els.ruleMemoCount.textContent = `${rules.length}개`;
  els.tipMemoCount.textContent = `${tips.length}개`;
  renderMemoList(els.ruleMemoList, rules);
  renderMemoList(els.tipMemoList, tips);
}

function renderMemoList(container, items) {
  if (items.length === 0) {
    container.innerHTML = `<p class="empty">저장된 카드가 없습니다.</p>`;
    return;
  }

  container.innerHTML = items
    .map(
      (memo) => `
        <article class="memo-card">
          <div class="memo-card-head">
            <strong>${escapeHtml(memo.title)}</strong>
            <button class="icon-button" data-delete-memo="${memo.id}" type="button" title="삭제">×</button>
          </div>
          <p>${escapeHtml(memo.body).replace(/\n/g, "<br />")}</p>
          <span>${formatDate(memo.createdAt)}</span>
        </article>
      `
    )
    .join("");

  container.querySelectorAll("[data-delete-memo]").forEach((button) => {
    button.addEventListener("click", () => deleteMemoCard(button.dataset.deleteMemo));
  });
}

function exportMemoCards() {
  const source = `window.DEFAULT_MEMO_CARDS = ${JSON.stringify(memoCards, null, 2)};\n`;
  const blob = new Blob([source], { type: "application/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "memo-data.js";
  link.click();
  URL.revokeObjectURL(url);
}

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return entities[char];
  });
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function setLoading(active) {
  els.loadingOverlay.classList.toggle("active", active);
  els.loadingOverlay.setAttribute("aria-hidden", String(!active));
}

els.searchButton.addEventListener("click", searchNow);
els.resetButton.addEventListener("click", resetForm);
els.chartToggleButton.addEventListener("click", toggleChart);
els.tradeValueButtons.forEach((button) => {
  button.addEventListener("click", () => setTradeValueFilter(Number(button.dataset.tradeValue)));
});
els.h1ConvergenceToggle.addEventListener("click", () => setToggle(els.h1ConvergenceToggle, !els.h1ConvergenceToggle.classList.contains("active")));
els.conditionOneToggle.addEventListener("click", () => setToggle(els.conditionOneToggle, !els.conditionOneToggle.classList.contains("active")));
els.uptrendToggle.addEventListener("click", () => setToggle(els.uptrendToggle, !els.uptrendToggle.classList.contains("active")));

setupTabs();
setupCoinDb();
setupMemos();
renderTradingView("BINANCE:BTCUSDT", "BTCUSDT");
loadMarkets().catch((error) => {
  console.error(error);
  setStatus("연결 오류", "error");
  toast("데이터 API에 연결하지 못했습니다.");
});

function setTradeValueFilter(value) {
  els.tradeValueButtons.forEach((button) => {
    const active = Number(button.dataset.tradeValue) === value;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function getSelectedTradeValue() {
  const selected = [...els.tradeValueButtons].find((button) => button.classList.contains("active"));
  return selected ? Number(selected.dataset.tradeValue) : null;
}

function setToggle(button, active) {
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", String(active));
}
