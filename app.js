const API_BASE = "https://upbit-api-proxy.anyspirit.workers.dev";
const TRADINGVIEW_SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

const $ = (selector) => document.querySelector(selector);

const els = {
  connectionStatus: $("#connectionStatus"),
  btcPrice: $("#btcPrice"),
  btcChangeRate: $("#btcChangeRate"),
  btcChangePrice: $("#btcChangePrice"),
  btcChartButton: $("#btcChartButton"),
  keyword: $("#keyword"),
  minChange: $("#minChange"),
  maxChange: $("#maxChange"),
  minTradeValue: $("#minTradeValue"),
  minPrice: $("#minPrice"),
  maxPrice: $("#maxPrice"),
  maMode: $("#maMode"),
  maPeriod: $("#maPeriod"),
  minVolumeRatio: $("#minVolumeRatio"),
  sortBy: $("#sortBy"),
  searchButton: $("#searchButton"),
  resetButton: $("#resetButton"),
  exportButton: $("#exportButton"),
  chartTitle: $("#chartTitle"),
  tradingviewChart: $("#tradingviewChart"),
  results: $("#results"),
  resultMeta: $("#resultMeta"),
};

let markets = [];
let currentRows = [];

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
    keyword: els.keyword.value.trim().toLowerCase(),
    minChange: numberValue(els.minChange),
    maxChange: numberValue(els.maxChange),
    minTradeValue: numberValue(els.minTradeValue),
    minPrice: numberValue(els.minPrice),
    maxPrice: numberValue(els.maxPrice),
    maMode: els.maMode.value,
    maPeriod: Number(els.maPeriod.value),
    minVolumeRatio: numberValue(els.minVolumeRatio),
    sortBy: els.sortBy.value,
  };
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Upbit API ${response.status}`);
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
  const changeRate = btc.signed_change_rate * 100;
  const changeClass = changeRate >= 0 ? "gain" : "loss";

  els.btcPrice.textContent = `${formatNumber(btc.trade_price)}원`;
  els.btcChangeRate.textContent = `${changeRate.toFixed(2)}%`;
  els.btcChangeRate.className = changeClass;
  els.btcChangePrice.textContent = `${formatSignedMoney(btc.signed_change_price)}원`;
  els.btcChangePrice.className = changeClass;
}

function marketsForRule(rule) {
  return markets.filter((market) => {
    if (!rule.keyword) return true;
    return (
      market.market.toLowerCase().includes(rule.keyword) ||
      market.korean_name.toLowerCase().includes(rule.keyword) ||
      market.english_name.toLowerCase().includes(rule.keyword)
    );
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

async function enrichRowsWithCandles(rows, rule) {
  const needsCandles = rule.maMode !== "off" || rule.minVolumeRatio !== null || rule.sortBy === "volumeRatio";
  if (!needsCandles) return rows.map((row) => ({ ...row, ma: null, volumeRatio: null }));

  const enriched = [];
  const limitedRows = rows.slice(0, 80);

  for (const row of limitedRows) {
    try {
      const count = Math.max(rule.maPeriod + 1, 21);
      const candles = await fetchJson(`/candles/minutes/60?market=${row.market}&count=${count}`);
      const ordered = candles.slice().reverse();
      const closes = ordered.map((candle) => candle.trade_price);
      const volumes = ordered.map((candle) => candle.candle_acc_trade_volume);
      const ma = average(closes.slice(-rule.maPeriod));
      const previousVolumes = volumes.slice(-21, -1);
      const volumeAverage = average(previousVolumes);
      const latestVolume = volumes.at(-1) ?? null;
      const volumeRatio = volumeAverage ? latestVolume / volumeAverage : null;
      enriched.push({ ...row, ma, volumeRatio });
      await delay(110);
    } catch {
      enriched.push({ ...row, ma: null, volumeRatio: null });
    }
  }

  return enriched;
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
    .map((ticker) => ({ ...ticker, info: marketMap.get(ticker.market) }))
    .filter((row) => {
      const changePercent = row.signed_change_rate * 100;
      if (rule.minChange !== null && changePercent < rule.minChange) return false;
      if (rule.maxChange !== null && changePercent > rule.maxChange) return false;
      if (rule.minTradeValue !== null && row.acc_trade_price_24h < rule.minTradeValue) return false;
      if (rule.minPrice !== null && row.trade_price < rule.minPrice) return false;
      if (rule.maxPrice !== null && row.trade_price > rule.maxPrice) return false;
      return true;
    })
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h);

  const enrichedRows = await enrichRowsWithCandles(baseRows, rule);
  return enrichedRows
    .filter((row) => {
      if (rule.maMode === "above" && (row.ma === null || row.trade_price < row.ma)) return false;
      if (rule.maMode === "below" && (row.ma === null || row.trade_price > row.ma)) return false;
      if (rule.minVolumeRatio !== null && (row.volumeRatio === null || row.volumeRatio < rule.minVolumeRatio)) return false;
      return true;
    })
    .sort((a, b) => compareRows(a, b, rule.sortBy));
}

function compareRows(a, b, sortBy) {
  if (sortBy === "changeRate") return b.signed_change_rate - a.signed_change_rate;
  if (sortBy === "volumeRatio") return (b.volumeRatio ?? -1) - (a.volumeRatio ?? -1);
  if (sortBy === "drawdown") return drawdown(a) - drawdown(b);
  return b.acc_trade_price_24h - a.acc_trade_price_24h;
}

function drawdown(row) {
  if (!row.high_price) return 0;
  return ((row.trade_price - row.high_price) / row.high_price) * 100;
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined) return "-";
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
    interval: "60",
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
      return `
        <tr>
          <td>
            <div class="coin-name">
              <strong>${row.info.korean_name}</strong>
              <span>${row.market} · ${row.info.english_name}</span>
            </div>
          </td>
          <td>${formatNumber(row.trade_price)}원</td>
          <td class="${changeClass}">${change.toFixed(2)}%</td>
          <td class="${changeClass}">${formatSignedMoney(row.signed_change_price)}원</td>
          <td>${formatNumber(row.acc_trade_price_24h)}</td>
          <td>${drawdown(row).toFixed(2)}%</td>
          <td>${row.ma === null ? "-" : formatNumber(row.ma)}</td>
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
      renderTradingView(marketToBinanceSymbol(market), market.replace("KRW-", "") + "USDT");
    });
  });
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
    toast("업비트 데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도해주세요.");
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

  const header = [
    "market",
    "korean_name",
    "price",
    "change_percent",
    "change_price",
    "trade_value_24h",
    "drawdown_percent",
    "moving_average",
    "volume_ratio",
  ];
  const lines = currentRows.map((row) =>
    [
      row.market,
      row.info.korean_name,
      row.trade_price,
      (row.signed_change_rate * 100).toFixed(2),
      row.signed_change_price,
      Math.round(row.acc_trade_price_24h),
      drawdown(row).toFixed(2),
      row.ma === null ? "" : row.ma.toFixed(4),
      row.volumeRatio === null ? "" : row.volumeRatio.toFixed(4),
    ].join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `upbit-krw-scan-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function resetForm() {
  els.keyword.value = "";
  els.minChange.value = "3";
  els.maxChange.value = "";
  els.minTradeValue.value = "10000000000";
  els.minPrice.value = "";
  els.maxPrice.value = "";
  els.maMode.value = "off";
  els.maPeriod.value = "20";
  els.minVolumeRatio.value = "";
  els.sortBy.value = "tradeValue";
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

renderTradingView("BINANCE:BTCUSDT", "BTCUSDT");
Promise.all([loadMarkets(), loadBitcoinSummary()]).catch((error) => {
  console.error(error);
  setStatus("연결 오류", "error");
  toast("업비트 API에 연결하지 못했습니다.");
});
