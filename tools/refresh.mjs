#!/usr/bin/env node
/**
 * Coinglass snapshot builder — the GitHub Actions half of cg-mobile.
 *
 * The Cloudflare Worker cannot reach Coinglass (their API answers 403 to
 * Cloudflare egress), but a GitHub-hosted runner can. So this script runs the
 * *same* engine as the Worker — `worker/src/brief.js` + `worker/src/cg-data.js`,
 * zero re-implementation — and writes the result as static JSON that GitHub
 * Pages serves next to index.html:
 *
 *   docs/data/<SYM>.json    the /api/brief payload (plus `whalesFull`, the
 *                           /api/whales payload, so the page needs no 2nd call)
 *   docs/data/meta.json     when this ran, per-symbol price/probability/errors
 *
 * Run:  node tools/refresh.mjs                 (default ETH,BTC,SOL)
 *       SYMBOLS=ETH node tools/refresh.mjs
 *
 * Exit code is 0 when at least one symbol was written; 1 when nothing could be
 * fetched (so a red workflow run means "Coinglass is unreachable", not noise).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrief } from "../worker/src/brief.js";
import { isSupported, whalesPanel } from "../worker/src/cg-data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "docs", "data");
const CADENCE_MIN = Number(process.env.REFRESH_CADENCE_MIN || 5);

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

function beijing(ms) {
  // "2026-11-17 01:45:12" in Asia/Shanghai, independent of the runner's TZ
  const d = new Date(ms + 8 * 3600_000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
    " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds())
  );
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** One symbol: brief (everything the card needs) + the whales panel. */
async function snapshot(sym) {
  const t0 = Date.now();
  const brief = await buildBrief(sym, { fpLim: 64 });
  const whalesFull = await whalesPanel(sym, { minVolUsd: 100_000 }).catch((e) => ({
    ok: false,
    sym,
    error: String(e?.message || e),
    rows: [],
    stats: {},
  }));
  const ms = Date.now() - t0;
  return {
    ...brief,
    whalesFull,
    source: "coinglass",
    builtAt: Date.now(),
    buildMs: ms,
    refresh: { mode: "github-actions", cadenceMin: CADENCE_MIN },
  };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("Node 18+ with global fetch is required (Node 22 on Actions).");
  }
  const syms = String(process.env.SYMBOLS || "ETH,BTC,SOL")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .filter(isSupported);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const meta = {
    updatedAt: null,
    updatedAtMs: null,
    beijing: null,
    cadenceMin: CADENCE_MIN,
    cadenceLabel: "GitHub Actions 自动刷新（每 5 分钟）",
    source: "coinglass",
    generator: "tools/refresh.mjs",
    symbols: {},
  };

  let written = 0;

  for (const sym of syms) {
    const file = path.join(OUT_DIR, `${sym}.json`);
    let data = null;
    let err = null;
    for (let attempt = 1; attempt <= 2 && !data; attempt++) {
      try {
        const snap = await snapshot(sym);
        if (!snap.ok) throw new Error(snap.error || "brief not ok");
        data = snap;
      } catch (e) {
        err = e;
        if (attempt === 1) await SLEEP(2500); // one polite retry
      }
    }

    if (data) {
      await fs.writeFile(file, JSON.stringify(data) + "\n");
      written++;
      meta.symbols[sym] = {
        ok: true,
        price: data.price,
        prob: data.card?.prob ?? null,
        status: data.card?.status ?? null,
        buildMs: data.buildMs,
        errors: (data.errors || []).map((e) => e.panel),
        beijing: beijing(data.fetchedAt || data.builtAt),
      };
      console.log(
        `${sym}: ok  price=${data.price}  prob=${meta.symbols[sym].prob}%  ` +
          `panels=${Object.keys(data).length}  ${data.buildMs}ms  ` +
          (meta.symbols[sym].errors.length ? `partial(${meta.symbols[sym].errors.join(",")})` : "all panels")
      );
    } else {
      // keep the previous good file: a rate-limited run must not blank the site
      const prev = await readJson(file);
      meta.symbols[sym] = {
        ok: false,
        error: String(err?.message || err),
        keptPrevious: Boolean(prev),
        previousBeijing: prev ? beijing(prev.fetchedAt || prev.builtAt) : null,
      };
      console.warn(`${sym}: FAILED ${err?.message || err}${prev ? " (kept previous snapshot)" : ""}`);
    }
    await SLEEP(800); // politeness between symbols
  }

  const nowMs = Date.now();
  meta.updatedAt = new Date(nowMs).toISOString();
  meta.updatedAtMs = nowMs;
  meta.beijing = beijing(nowMs);
  await fs.writeFile(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`meta: ${meta.beijing} (北京时间)  written=${written}/${syms.length}`);
  if (written === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("refresh failed:", e);
  process.exitCode = 1;
});
