/**
 * CG Mobile API — Cloudflare Worker.
 *
 * A Coinglass proxy + the terminal's 5m/15m signal engine, exposed as clean
 * JSON for a phone-first frontend. Zero dependencies, Web standards only
 * (fetch / crypto.subtle / DecompressionStream), so it runs unchanged on the
 * Workers Free tier.
 *
 * Routes
 *   GET /api/health
 *   GET /api/symbols
 *   GET /api/brief?sym=ETH[&fp=64][&liq=0][&whales=0]   ← the whole AI card
 *   GET /api/ticker?sym=ETH
 *   GET /api/kline?sym=ETH&itv=m5|m15|h1&limit=60
 *   GET /api/fp?sym=ETH&itv=m15&limit=64
 *   GET /api/cvd?sym=ETH&itv=m15&limit=150
 *   GET /api/market?sym=ETH
 *   GET /api/oi?sym=ETH
 *   GET /api/walls?sym=ETH&band=5&snapshots=2
 *   GET /api/whales?sym=ETH&min=100000
 *   GET /api/liq?sym=ETH&limit=300
 */

import { buildBrief } from "./brief.js";
import {
  SYMBOLS,
  isSupported,
  kline,
  footprint,
  cvd as fetchCvd,
  openInterest,
  bookWalls,
  liqLevels,
  marketFromBars,
  leadKey,
  whalesPanel,
} from "./cg-data.js";
import { cacheStats } from "./cg-client.js";


const VERSION = "1.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extraHeaders,
    },
  });
}

const briefCache = new Map(); // key -> { at, body }
const BRIEF_TTL = 8_000;

function badSym(sym) {
  return !isSupported(sym)
    ? json({ ok: false, error: `unsupported symbol ${sym}`, supported: SYMBOLS }, 400)
    : null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }

    const sp = url.searchParams;
    const sym = String(sp.get("sym") ?? sp.get("symbol") ?? "ETH").trim().toUpperCase();

    try {
      if (path === "/" || path === "/api" || path === "/api/health") {
        return json({
          ok: true,
          name: "cg-mobile-api",
          version: VERSION,
          now: Date.now(),
          symbols: SYMBOLS,
          cache: cacheStats(),
          routes: [
            "/api/brief",
            "/api/ticker",
            "/api/kline",
            "/api/fp",
            "/api/cvd",
            "/api/market",
            "/api/oi",
            "/api/walls",
            "/api/whales",
            "/api/liq",
          ],
        });
      }


      if (path === "/api/symbols") {
        return json({ ok: true, symbols: SYMBOLS, default: "ETH" });
      }

      if (path === "/api/brief") {
        const bad = badSym(sym);
        if (bad) return bad;
        const fpLim = Math.min(Math.max(Number(sp.get("fp")) || 64, 24), 120);
        const liq = sp.get("liq") !== "0";
        const whales = sp.get("whales") !== "0";
        const key = `${sym}|${fpLim}|${liq ? 1 : 0}|${whales ? 1 : 0}`;
        const hit = briefCache.get(key);
        if (hit && Date.now() - hit.at < BRIEF_TTL) {
          return json(hit.body, 200, { "x-brief-cache": "hit", "x-brief-age-ms": String(Date.now() - hit.at) });
        }
        const body = await buildBrief(sym, { fpLim, liq, whales });
        if (body.ok) {
          briefCache.set(key, { at: Date.now(), body });
          if (briefCache.size > 40) briefCache.delete(briefCache.keys().next().value);
        }
        return json(body, body.ok ? 200 : 502, { "x-brief-cache": "miss" });
      }

      if (path === "/api/ticker") {
        const bad = badSym(sym);
        if (bad) return bad;
        const [m1, h1] = await Promise.all([kline(sym, "m1", 2, 3_000), kline(sym, "h1", 25, 15_000).catch(() => [])]);
        const lastBar = m1[m1.length - 1];
        if (!lastBar) return json({ ok: false, error: "no price" }, 502);
        const chg = h1.length >= 20 ? ((lastBar.c - h1[0].c) / h1[0].c) * 100 : null;
        return json({
          ok: true,
          sym,
          price: lastBar.c,
          chg24hPct: chg == null ? null : +chg.toFixed(2),
          dir: chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat",
          candleTs: lastBar.ts,
          fetchedAt: Date.now(),
        });
      }

      if (path === "/api/kline") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m5");
        if (!["m1", "m5", "m15", "h1", "h4", "d1"].includes(itv)) {
          return json({ ok: false, error: "invalid itv" }, 400);
        }
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 60, 10), 400);
        const bars = await kline(sym, itv, limit);
        return json({ ok: true, sym, itv, bars });
      }

      if (path === "/api/fp") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m15");
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 64, 10), 120);
        const res = await footprint(sym, itv, limit);
        return json({ ok: true, sym, itv, ...res });
      }

      if (path === "/api/cvd") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m15");
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 150, 60), 400);
        return json(await fetchCvd(sym, itv, limit));
      }

      if (path === "/api/oi") {
        const bad = badSym(sym);
        if (bad) return bad;
        return json({ sym, ...(await openInterest(sym)) });
      }

      if (path === "/api/market") {
        const bad = badSym(sym);
        if (bad) return bad;
        const [bars15, barsH1, m1] = await Promise.all([
          kline(sym, "m15", 96),
          kline(sym, "h1", 25).catch(() => []),
          kline(sym, "m1", 2, 3_000).catch(() => []),
        ]);
        const px = m1.length ? m1[m1.length - 1].c : bars15[bars15.length - 1].c;
        const mkt = marketFromBars(bars15, barsH1, px);
        return json({ ok: true, sym, price: px, ...mkt });
      }

      if (path === "/api/walls" || path === "/api/bookwalls") {
        const bad = badSym(sym);
        if (bad) return bad;
        const band = [1, 2, 3, 5].includes(Number(sp.get("band"))) ? Number(sp.get("band")) : 5;
        const snapshots = Math.min(Math.max(Number(sp.get("snapshots")) || 2, 1), 6);
        const walls = await bookWalls(sym, { band, snapshots, history: sp.get("history") === "1" });
        return json(walls);
      }

      if (path === "/api/whales" || path === "/api/lto") {
        const bad = badSym(sym);
        if (bad) return bad;
        return json(await whalesPanel(sym, { minVolUsd: Number(sp.get("min")) || 100_000 }));
      }

      if (path === "/api/liq" || path === "/api/liqlevels") {
        const bad = badSym(sym);
        if (bad) return bad;
        const tick = await kline(sym, "m1", 2, 5_000).catch(() => []);
        const px = tick.length ? tick[tick.length - 1].c : 0;
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 50), 1500);
        return json({ sym, ...(await liqLevels(sym, { limit, px })) });
      }

      return json({ ok: false, error: "not found", path }, 404);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e), path, sym }, 502);
    }
  },
};
