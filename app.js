const API_BASE = "https://api.upbit.com/v1";
const STORAGE_KEY = "upbit-signal-watch-rules";
const NOTIFIED_KEY = "upbit-signal-watch-notified";

const $ = (selector) => document.querySelector(selector);

const els = {
  connectionStatus: $("#connectionStatus"),
  marketType: $("#marketType"),
  keyword: $("#keyword"),
  minChange: $("#minChange"),
  maxChange: $("#maxChange"),
  minTradeValue: $("#minTradeValue"),
  minPrice: $("#minPrice"),
  rsiMode: $("#rsiMode"),
  rsiValue: $("#rsiValue"),
  searchButton: $("#searchButton"),
  saveRuleButton: $("#saveRuleButton"),
  resetButton: $("#resetButton"),
  permissionButton: $("#permissionButton"),
  watchToggle: $("#watchToggle"),
  pollSeconds: $("#pollSeconds"),
  ruleCount: $("#ruleCount"),
  rules: $("#rules"),
  results: $("#results"),
  resultMeta: $("#resultMeta"),
  exportButton: $("#exportButton"),
};

let markets = [];
let currentRows = [];
let rules = readJson(STORAGE_KEY, []);
let notified = readJson(NOTIFIED_KEY, {});
let watchTimer = null;

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
    id: crypto.randomUUID(),
    marketType: els.marketType.value,
    keyword: els.keyword.value.trim(),
    minChange: numberValue(els.minChange),
    maxChange: numberValue(els.maxChange),
    minTradeValue: numberValue(els.minTradeValue),
    minPrice: numberValue(els.minPrice),
    rsiMode: els.rsiMode.value,
    rsiValue: numberValue(els.rsiValue),
  };
}

function applyRuleToForm(rule) {
  els.marketType.value = rule.marketType ?? "KRW";
  els.keyword.value = rule.keyword ?? "";
  els.minChange.value = rule.minChange ?? "";
  els.maxChange.value = rule.maxChange ?? "";
  els.minTradeValue.value = rule.minTradeValue ?? "";
  els.minPrice.value = rule.minPrice ?? "";
  els.rsiMode.value = rule.rsiMode ?? "off";
  els.rsiValue.value = rule.rsiValue ?? 30;
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
  markets = await fetchJson("/market/all?isDetails=false");
  setStatus(`${markets.length}개 마켓 준비됨`, "ok");
}

function marketsForRule(rule) {
  const keyword = rule.keyword.toLowerCase();
  return markets.filter((market) => {
    const [type] = market.market.split("-");
    const matchesType = rule.marketType === "ALL" || type === rule.marketType;
    const matchesKeyword =
      !keyword ||
      market.market.toLowerCase().includes(keyword) ||
      market.korean_name.toLowerCase().includes(keyword) ||
      market.english_name.toLowerCase().includes(keyword);
    return matchesType && matchesKeyword;
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

async function fetchRsiMap(rows, rule) {
  if (rule.rsiMode === "off") return new Map();

  const topRows = [...rows]
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h)
    .slice(0, 35);
  const rsiMap = new Map();

  for (const row of topRows) {
    try {
      const candles = await fetchJson(`/candles/minutes/60?market=${row.market}&count=30`);
      const closes = candles.map((candle) => candle.trade_price).reverse();
      rsiMap.set(row.market, calculateRsi(closes, 14));
      await delay(110);
    } catch {
      rsiMap.set(row.market, null);
    }
  }

  return rsiMap;
}

function calculateRsi(closes, period) {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
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
    .map((ticker) => ({ ...ticker, info: marketMap.get(ticker.market), rsi: null }))
    .filter((row) => {
      const changePercent = row.signed_change_rate * 100;
      if (rule.minChange !== null && changePercent < rule.minChange) return false;
      if (rule.maxChange !== null && changePercent > rule.maxChange) return false;
      if (rule.minTradeValue !== null && row.acc_trade_price_24h < rule.minTradeValue) return false;
      if (rule.minPrice !== null && row.trade_price < rule.minPrice) return false;
      return true;
    });

  const rsiMap = await fetchRsiMap(baseRows, rule);
  return baseRows
    .map((row) => ({ ...row, rsi: rsiMap.get(row.market) ?? null }))
    .filter((row) => {
      if (rule.rsiMode === "off") return true;
      if (row.rsi === null || rule.rsiValue === null) return false;
      if (rule.rsiMode === "below") return row.rsi <= rule.rsiValue;
      return row.rsi >= rule.rsiValue;
    })
    .sort((a, b) => b.acc_trade_price_24h - a.acc_trade_price_24h);
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);
}

function formatMoney(value, market) {
  if (market.startsWith("KRW-")) return `${formatNumber(value)}원`;
  return formatNumber(value, 8);
}

function renderResults(rows) {
  currentRows = rows;
  if (rows.length === 0) {
    els.results.innerHTML = `<tr><td colspan="7" class="empty">조건에 맞는 코인이 없습니다.</td></tr>`;
    return;
  }

  els.results.innerHTML = rows
    .map((row) => {
      const change = row.signed_change_rate * 100;
      const changeClass = change >= 0 ? "gain" : "loss";
      const drawdown = ((row.trade_price - row.high_price) / row.high_price) * 100;
      const upbitUrl = `https://upbit.com/exchange?code=CRIX.UPBIT.${row.market}`;
      return `
        <tr>
          <td>
            <div class="coin-name">
              <strong>${row.info.korean_name}</strong>
              <span>${row.market} · ${row.info.english_name}</span>
            </div>
          </td>
          <td>${formatMoney(row.trade_price, row.market)}</td>
          <td class="${changeClass}">${change.toFixed(2)}%</td>
          <td>${formatNumber(row.acc_trade_price_24h)}</td>
          <td>${drawdown.toFixed(2)}%</td>
          <td>${row.rsi === null ? "-" : row.rsi.toFixed(1)}</td>
          <td><a href="${upbitUrl}" target="_blank" rel="noopener">보기</a></td>
        </tr>
      `;
    })
    .join("");
}

function ruleDescription(rule) {
  const parts = [];
  parts.push(rule.marketType === "ALL" ? "전체 마켓" : `${rule.marketType} 마켓`);
  if (rule.keyword) parts.push(`검색어 ${rule.keyword}`);
  if (rule.minChange !== null) parts.push(`변동률 ${rule.minChange}% 이상`);
  if (rule.maxChange !== null) parts.push(`${rule.maxChange}% 이하`);
  if (rule.minTradeValue !== null) parts.push(`거래대금 ${formatNumber(rule.minTradeValue)} 이상`);
  if (rule.minPrice !== null) parts.push(`현재가 ${formatNumber(rule.minPrice)} 이상`);
  if (rule.rsiMode !== "off") parts.push(`RSI ${rule.rsiValue} ${rule.rsiMode === "below" ? "이하" : "이상"}`);
  return parts.join(" · ");
}

function renderRules() {
  els.ruleCount.textContent = `${rules.length}개`;
  els.rules.innerHTML = "";

  if (rules.length === 0) {
    els.rules.innerHTML = `<p class="empty">저장된 알림 조건이 없습니다.</p>`;
    return;
  }

  const template = $("#ruleTemplate");
  rules.forEach((rule, index) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".rule-title").textContent = `조건 ${index + 1}`;
    node.querySelector(".rule-desc").textContent = ruleDescription(rule);
    node.querySelector(".rule").addEventListener("click", () => applyRuleToForm(rule));
    node.querySelector(".delete-rule").addEventListener("click", (event) => {
      event.stopPropagation();
      rules = rules.filter((item) => item.id !== rule.id);
      writeJson(STORAGE_KEY, rules);
      renderRules();
    });
    els.rules.appendChild(node);
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

function saveCurrentRule() {
  const rule = getFormRule();
  rules = [rule, ...rules].slice(0, 12);
  writeJson(STORAGE_KEY, rules);
  renderRules();
  toast("조건을 저장했습니다.");
}

async function runWatch() {
  if (!els.watchToggle.checked || rules.length === 0) return;
  setStatus("감시 중");

  for (const rule of rules) {
    try {
      const rows = await findMatches(rule);
      if (rows.length > 0) {
        notifyRule(rule, rows);
      }
    } catch (error) {
      console.error(error);
      setStatus("감시 오류", "error");
    }
  }
}

function notifyRule(rule, rows) {
  const signature = rows.map((row) => row.market).join(",");
  if (notified[rule.id] === signature) return;
  notified[rule.id] = signature;
  writeJson(NOTIFIED_KEY, notified);

  const title = `조건 충족: ${rows.length}개 코인`;
  const body = rows
    .slice(0, 5)
    .map((row) => `${row.info.korean_name} ${((row.signed_change_rate || 0) * 100).toFixed(2)}%`)
    .join(", ");

  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
  if ("vibrate" in navigator) navigator.vibrate([180, 80, 180]);
  toast(`${title} · ${body}`);
}

function startWatch() {
  stopWatch();
  runWatch();
  const seconds = Math.max(20, Number(els.pollSeconds.value) || 60);
  watchTimer = setInterval(runWatch, seconds * 1000);
}

function stopWatch() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function exportCsv() {
  if (currentRows.length === 0) {
    toast("내보낼 검색 결과가 없습니다.");
    return;
  }
  const header = ["market", "korean_name", "price", "change_percent", "trade_value_24h", "rsi"];
  const lines = currentRows.map((row) =>
    [
      row.market,
      row.info.korean_name,
      row.trade_price,
      (row.signed_change_rate * 100).toFixed(2),
      Math.round(row.acc_trade_price_24h),
      row.rsi === null ? "" : row.rsi.toFixed(1),
    ].join(",")
  );
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `upbit-signals-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

els.searchButton.addEventListener("click", searchNow);
els.saveRuleButton.addEventListener("click", saveCurrentRule);
els.exportButton.addEventListener("click", exportCsv);
els.resetButton.addEventListener("click", () => {
  applyRuleToForm({
    marketType: "KRW",
    keyword: "",
    minChange: 3,
    maxChange: "",
    minTradeValue: 10000000000,
    minPrice: "",
    rsiMode: "off",
    rsiValue: 30,
  });
});

els.permissionButton.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("이 브라우저는 알림을 지원하지 않습니다.");
    return;
  }
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "알림이 허용되었습니다." : "알림 권한이 허용되지 않았습니다.");
});

els.watchToggle.addEventListener("change", () => {
  if (els.watchToggle.checked) {
    if (rules.length === 0) {
      toast("먼저 알림 조건을 저장해주세요.");
      els.watchToggle.checked = false;
      return;
    }
    startWatch();
  } else {
    stopWatch();
    setStatus("감시 중지");
  }
});

els.pollSeconds.addEventListener("change", () => {
  if (els.watchToggle.checked) startWatch();
});

renderRules();
loadMarkets().catch((error) => {
  console.error(error);
  setStatus("연결 오류", "error");
  toast("업비트 API에 연결하지 못했습니다.");
});
