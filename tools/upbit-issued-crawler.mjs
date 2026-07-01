import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const UPBIT_MARKETS_URL = "https://api.upbit.com/v1/market/all?isDetails=false";
const OUTPUT_PATH = path.resolve("data/upbit-issued-at.json");
const LIMIT = Number(process.env.LIMIT || 0);
const HEADLESS = process.env.HEADLESS !== "false";

async function main() {
  const markets = await loadKrwMarkets();
  const targets = LIMIT > 0 ? markets.slice(0, LIMIT) : markets;
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ locale: "ko-KR" });
  const results = {};

  for (const market of targets) {
    const url = `https://www.upbit.com/exchange?code=CRIX.UPBIT.${market.market}`;
    console.log(`[${market.market}] open ${url}`);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await clickInfoTab(page);

      const issuedAtText = await extractIssuedAtText(page);
      results[market.market] = {
        market: market.market,
        koreanName: market.korean_name,
        englishName: market.english_name,
        issuedAtText,
        source: url,
        crawledAt: new Date().toISOString(),
      };
      console.log(`[${market.market}] 최초발행: ${issuedAtText || "not found"}`);
    } catch (error) {
      results[market.market] = {
        market: market.market,
        koreanName: market.korean_name,
        englishName: market.english_name,
        issuedAtText: null,
        source: url,
        error: error.message,
        crawledAt: new Date().toISOString(),
      };
      console.warn(`[${market.market}] failed: ${error.message}`);
    }

    await delay(1200);
  }

  await browser.close();
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`saved ${OUTPUT_PATH}`);
}

async function loadKrwMarkets() {
  const response = await fetch(UPBIT_MARKETS_URL);
  if (!response.ok) throw new Error(`Upbit market API ${response.status}`);
  const markets = await response.json();
  return markets.filter((market) => market.market.startsWith("KRW-"));
}

async function clickInfoTab(page) {
  const candidates = [
    page.getByRole("tab", { name: /정보/ }),
    page.getByRole("button", { name: /정보/ }),
    page.getByText("정보", { exact: true }),
  ];

  for (const locator of candidates) {
    try {
      await locator.first().click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      return;
    } catch {
      // Try the next selector.
    }
  }
}

async function extractIssuedAtText(page) {
  return page.evaluate(() => {
    const normalize = (value) => value?.replace(/\s+/g, " ").trim() || "";
    const nodes = [...document.querySelectorAll("body *")];
    const label = nodes.find((node) => normalize(node.textContent) === "최초발행" || normalize(node.textContent).includes("최초발행"));
    if (!label) return null;

    const parent = label.closest("li, tr, dl, div, section") || label.parentElement;
    const parentText = normalize(parent?.textContent);
    const directText = parentText.replace("최초발행", "").trim();
    if (directText) return directText;

    const next = label.nextElementSibling;
    return normalize(next?.textContent) || null;
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
