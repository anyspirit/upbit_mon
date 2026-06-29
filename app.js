const API_BASE = "https://upbit-api-proxy.anyspirit.workers.dev/v1";
const TRADINGVIEW_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
const LEVELS_KEY = "upbit-pattern-levels";
const MEMO_KEY = "upbit-pattern-memo-cards";
const COIN_DB_KEY = "upbit-pattern-coin-db";

const DEFAULT_COIN_DB = {
  "KRW-BTC": { nickname: "대장", groups: ["major", "top20"] },
  "KRW-ETH": { nickname: "이더", groups: ["major", "top20"] },
  "KRW-XRP": { nickname: "리플", groups: ["major", "top20"] },
  "KRW-SOL": { nickname: "솔라나", groups: ["major", "top20"] },
  "KRW-DOGE": { nickname: "도지", groups: ["major", "top20"] },
  "KRW-ADA": { nickname: "에이다", groups: ["major", "top20"] },
};

const $ = (selector) => document.querySelector(selector);

const els = {
  connectionStatus: $("#connectionStatus"),
  btcPrice: $("#btcPrice"),
  btcChangeRate: $("#btcChangeRate"),
  btcChangePrice: $("#btcChangePrice"),
  btcMaState: $("#btcMaState"),
  btcChartButton: $("#btcChartButton"),
  tabs: document.querySelectorAll(".tab"),
  scannerPage: $("#scannerPage"),
  notesPage: $("#notesPage"),
  coinGroup: $("#coinGroup"),
  keyword: $("#keyword"),
  minChange: $("#minChange"),
  maxChange: $("#maxChange"),
  minTradeValue: $("#minTradeValue"),
  h1Ma20Mode: $("#h1Ma20Mode"),
  h1Ma60Mode: $("#h1Ma60Mode"),
  d1Ma20Mode: $("#d1Ma20Mode"),
  d1Ma60Mode: $("#d1Ma60Mode"),
  minVolumeRatio: $("#minVolumeRatio"),
  volumePeriod: $("#volumePeriod"),
  levelMode: $("#levelMode"),
  levelTolerance: $("#levelTolerance"),
  sortBy: $("#sortBy"),
  searchButton: $("#searchButton"),
  resetButton: $("#resetButton"),
  exportButton: $("#exportButton"),
  chartTitle: $("#chartTitle"),
  tradingviewChart: $("#tradingviewChart"),
  results: $("#results"),
  resultMeta: $("#resultMeta"),
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
let levels = readJson(LEVELS_KEY, {});
let memoCards = readMemoCards();
let coinDb = { ...DEFAULT_COIN_DB, ...readJson(COIN_DB_KEY, {}) };

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
  els.connectionStatus.textContent = text;
  els.connectionStatus.dataset.tone = tone;
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
    minChange: numberValue(els.minChange),
    maxChange: numberValue(els.maxChange),
    minTradeValue: numberValue(els.minTradeValue),
    maModes: {
      h1: {
        20: els.h1Ma20Mode.value,
        60: els.h1Ma60Mode.value,
      },
      d1: {
        20: els.d1Ma20Mode.value,
        60: els.d1Ma60Mode.value,
      },
    },
    minVolumeRatio: numberValue(els.minVolumeRatio),
    volumePeriod: Number(els.volumePeriod.value),
    levelMode: els.levelMode.value,
    levelTolerance: numberValue(els.levelTolerance) ?? 0,
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

async function loadMarkets() {
  setStatus("마켓 불러오는 중");
  const allMarkets = await fetchJson("/market/all?isDetails=false");
  markets = allMarkets.filter((market) => market.market.startsWith("KRW-"));
  setStatus(`${markets.length}개 KRW 마켓 준비`, "ok");
}

async function loadBitcoinSummary() {
  const [btc] = await fetchJson("/ticker?markets=KRW-BTC");
  const candles = await fetchDayCandles("KRW-BTC", 365);
  const ma = calculateMovingAverages(candles);
  const changeRate = btc.signed_change_rate * 100;
  const changeClass = changeRate >= 0 ? "gain" : "loss";

  els.btcPrice.textContent = `${formatNumber(btc.trade_price)}원`;
  els.btcChangeRate.textContent = `${changeRate.toFixed(2)}%`;
  els.btcChangeRate.className = changeClass;
  els.btcChangePrice.textContent = `${formatSignedMoney(btc.signed_change_price)}원`;
  els.btcChangePrice.className = changeClass;
  els.btcMaState.textContent = ma.bullStack ? "정배열" : ma.bearStack ? "역배열" : "혼조";
  els.btcMaState.className = ma.bullStack ? "gain" : ma.bearStack ? "loss" : "";
}

function marketsForRule(rule) {
  return markets.filter((market) => {
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

async function enrichRowsWithPatternData(rows, rule) {
  const enriched = [];
  const limitedRows = rows.slice(0, 80);

  for (const row of limitedRows) {
    try {
      const [hourCandles, dayCandles] = await Promise.all([fetchMinuteCandles(row.market, 60, 60), fetchDayCandles(row.market, 60)]);
      const ma = {
        h1: calculateMovingAverages(hourCandles),
        d1: calculateMovingAverages(dayCandles),
      };
      const volumeRatio = calculateVolumeRatio(dayCandles, rule.volumePeriod);
      enriched.push({ ...row, ma, volumeRatio });
      await delay(100);
    } catch {
      enriched.push({ ...row, ma: emptyMaSet(), volumeRatio: null });
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
    365: average(closes.slice(-365)),
  };
  ma.bullStack = [ma[20], ma[60], ma[120], ma[365]].every(Number.isFinite) && ma[20] > ma[60] && ma[60] > ma[120] && ma[120] > ma[365];
  ma.bearStack = [ma[20], ma[60], ma[120], ma[365]].every(Number.isFinite) && ma[20] < ma[60] && ma[60] < ma[120] && ma[120] < ma[365];
  return ma;
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
      const changePercent = row.signed_change_rate * 100;
      if (rule.minChange !== null && changePercent < rule.minChange) return false;
      if (rule.maxChange !== null && changePercent > rule.maxChange) return false;
      if (rule.minTradeValue !== null && row.acc_trade_price_24h < rule.minTradeValue) return false;
      return true;
    })
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h);

  const enrichedRows = await enrichRowsWithPatternData(baseRows, rule);
  return enrichedRows
    .filter((row) => matchesMaRule(row, rule))
    .filter((row) => matchesVolumeRule(row, rule))
    .filter((row) => matchesLevelRule(row, rule))
    .sort((a, b) => compareRows(a, b, rule.sortBy));
}

function matchesMaRule(row, rule) {
  return Object.entries(rule.maModes).every(([frame, modes]) =>
    Object.entries(modes).every(([period, mode]) => {
      if (mode === "off") return true;
      const value = row.ma?.[frame]?.[period];
      if (!Number.isFinite(value)) return false;
      if (mode === "above") return row.trade_price > value;
      return row.trade_price < value;
    })
  );
}

function matchesVolumeRule(row, rule) {
  if (rule.minVolumeRatio === null) return true;
  return row.volumeRatio !== null && row.volumeRatio >= rule.minVolumeRatio;
}

function matchesLevelRule(row, rule) {
  if (rule.levelMode === "off") return true;
  const level = levels[row.market];
  const tolerance = rule.levelTolerance / 100;

  if (rule.levelMode === "breakout") {
    return Number.isFinite(level?.resistance) && row.trade_price >= level.resistance;
  }

  if (rule.levelMode === "support") {
    return (
      Number.isFinite(level?.support) &&
      row.trade_price >= level.support * (1 - tolerance) &&
      row.trade_price <= level.support * (1 + tolerance)
    );
  }

  return true;
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

function marketToBinanceSymbol(market) {
  const code = market.replace("KRW-", "");
  return `BINANCE:${code}USDT`;
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
    els.results.innerHTML = `<tr><td colspan="11" class="empty">조건에 맞는 코인이 없습니다.</td></tr>`;
    return;
  }

  els.results.innerHTML = rows
    .map((row) => {
      const change = row.signed_change_rate * 100;
      const changeClass = change >= 0 ? "gain" : "loss";
      const upbitUrl = `https://upbit.com/exchange?code=CRIX.UPBIT.${row.market}`;
      const level = levels[row.market] ?? {};
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
          <td>${formatNumber(row.acc_trade_price_24h)}</td>
          <td>${formatMaStatus(row, "h1", 20)}</td>
          <td>${formatMaStatus(row, "h1", 60)}</td>
          <td>${formatMaStatus(row, "d1", 20)}</td>
          <td>${formatMaStatus(row, "d1", 60)}</td>
          <td>${row.volumeRatio === null ? "-" : `${row.volumeRatio.toFixed(2)}x`}</td>
          <td>
            <div class="level-editor">
              <input data-level-market="${row.market}" data-level-type="support" type="number" placeholder="지지" value="${level.support ?? ""}" />
              <input data-level-market="${row.market}" data-level-type="resistance" type="number" placeholder="저항" value="${level.resistance ?? ""}" />
            </div>
          </td>
          <td>
            <button type="button" data-save-level="${row.market}">저장</button>
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
      renderTradingView(marketToBinanceSymbol(market), market.replace("KRW-", "") + "USDT");
    });
  });

  els.results.querySelectorAll("[data-save-level]").forEach((button) => {
    button.addEventListener("click", () => saveLevel(button.dataset.saveLevel));
  });
}

function formatMaStatus(row, frame, period) {
  const value = row.ma?.[frame]?.[period];
  if (!Number.isFinite(value)) return "-";
  const distance = ((row.trade_price - value) / value) * 100;
  const isAbove = row.trade_price > value;
  const label = isAbove ? "위" : "아래";
  const className = isAbove ? "gain" : "loss";
  return `<span class="${className}">${label}</span> <small>${distance > 0 ? "+" : ""}${distance.toFixed(1)}%</small>`;
}

function saveLevel(market) {
  const inputs = els.results.querySelectorAll(`[data-level-market="${market}"]`);
  const next = { ...(levels[market] ?? {}) };

  inputs.forEach((input) => {
    const value = input.value === "" ? null : Number(input.value);
    if (Number.isFinite(value)) next[input.dataset.levelType] = value;
    else delete next[input.dataset.levelType];
  });

  levels[market] = next;
  writeJson(LEVELS_KEY, levels);
  toast(`${market} 매물대를 저장했습니다.`);
}

async function searchNow() {
  const rule = getFormRule();
  els.searchButton.disabled = true;
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
  }
}

function exportCsv() {
  if (currentRows.length === 0) {
    toast("내보낼 검색 결과가 없습니다.");
    return;
  }

  const header = ["market", "korean_name", "nickname", "price", "change_percent", "trade_value_24h", "h1_ma20", "h1_ma60", "d1_ma20", "d1_ma60", "volume_ratio", "support", "resistance"];
  const lines = currentRows.map((row) => {
    const level = levels[row.market] ?? {};
    return [
      row.market,
      row.info.korean_name,
      row.meta.nickname ?? "",
      row.trade_price,
      (row.signed_change_rate * 100).toFixed(2),
      Math.round(row.acc_trade_price_24h),
      row.ma?.h1?.[20] ?? "",
      row.ma?.h1?.[60] ?? "",
      row.ma?.d1?.[20] ?? "",
      row.ma?.d1?.[60] ?? "",
      row.volumeRatio ?? "",
      level.support ?? "",
      level.resistance ?? "",
    ].join(",");
  });
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `upbit-pattern-scan-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function resetForm() {
  els.coinGroup.value = "all";
  els.keyword.value = "";
  els.minChange.value = "";
  els.maxChange.value = "";
  els.minTradeValue.value = "10000000000";
  els.h1Ma20Mode.value = "off";
  els.h1Ma60Mode.value = "off";
  els.d1Ma20Mode.value = "off";
  els.d1Ma60Mode.value = "off";
  els.minVolumeRatio.value = "";
  els.volumePeriod.value = "20";
  els.levelMode.value = "off";
  els.levelTolerance.value = "2";
  els.sortBy.value = "tradeValue";
}

function setupTabs() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
      els.scannerPage.classList.toggle("active", tab.dataset.tab === "scanner");
      els.notesPage.classList.toggle("active", tab.dataset.tab === "notes");
    });
  });
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

els.searchButton.addEventListener("click", searchNow);
els.exportButton.addEventListener("click", exportCsv);
els.resetButton.addEventListener("click", resetForm);
els.btcChartButton.addEventListener("click", () => renderTradingView("BINANCE:BTCUSDT", "BTCUSDT"));

setupTabs();
setupMemos();
renderTradingView("BINANCE:BTCUSDT", "BTCUSDT");
Promise.all([loadMarkets(), loadBitcoinSummary()]).catch((error) => {
  console.error(error);
  setStatus("연결 오류", "error");
  toast("데이터 API에 연결하지 못했습니다.");
});
