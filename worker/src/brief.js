/**
 * Brief assembler — the whole 5m/15m AI card in one payload, exactly the
 * fields the terminal template prints, with each panel degrading
 * independently (a 429 on one upstream never blanks the card).
 */

import {
  kline,
  footprint,
  cvd as fetchCvd,
  openInterest,
  bookWalls,
  largeOrders,
  liqLevels,
  marketFromBars,
  leadKey,
} from "./cg-data.js";
import {
  scoreStructure,
  scoreCvd,
  scoreTaker,
  scoreOi,
  computeFpSignals,
  fpSignalSummary,
  wallStats,
  whaleFlow,
  buildLevels,
  buildCard,
} from "./signals.js";

const pctOf = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);

export async function buildBrief(sym, opts = {}) {
  const fpLim = Math.min(Math.max(Number(opts.fpLim) || 64, 24), 120);
  const withLiq = opts.liq !== false;
  const withWhales = opts.whales !== false;
  const errors = [];

  const settle = async (label, p) => {
    try {
      return await p;
    } catch (e) {
      errors.push({ panel: label, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  const [bars5, bars15, barsH1, fpRes, cvdRes, oiRes, wallsRes, liqRes, ltoRes] = await Promise.all([
    settle("kline5m", kline(sym, "m5", 60, 6_000)),
    settle("kline15m", kline(sym, "m15", 96)),
    settle("kline1h", kline(sym, "h1", 25)),
    settle("footprint", footprint(sym, "m15", fpLim)),
    settle("cvd", fetchCvd(sym, "m15", 150)),
    settle("oi", openInterest(sym)),
    settle("walls", bookWalls(sym, { band: 5, snapshots: 1, history: false, events: true, eventSnapshots: 40, eventLimit: 12 })),
    withLiq ? settle("liq", liqLevels(sym, { limit: 240, range: "3d", px: 0 })) : Promise.resolve(null),
    withWhales ? settle("whales", largeOrders(sym, { exchanges: ["Binance"] })) : Promise.resolve(null),
  ]);

  // The forming 5m bar's close IS the live price on this API (the same bar the
  // terminal reads), so no extra m1 round-trip is needed for freshness.
  const px =
    (bars5 && bars5.length ? bars5[bars5.length - 1].c : null) ??
    (bars15 && bars15.length ? bars15[bars15.length - 1].c : null);
  if (!(px > 0)) {
    return { ok: false, sym, error: errors.find((e) => e.panel.startsWith("kline"))?.message ?? "no price", errors };
  }
  const decs = px >= 1000 ? 2 : px >= 100 ? 2 : px >= 1 ? 3 : 5;

  const chg24hPct = barsH1 && barsH1.length >= 20 ? pctOf(px, barsH1[0].c) : null;
  const px1hAgo = bars15 && bars15.length >= 5 ? bars15[bars15.length - 5].c : px;
  const px1hPct = pctOf(px, px1hAgo) ?? 0;

  const s5 = bars5 && bars5.length >= 30 ? scoreStructure(bars5, "5m") : null;
  const s15 = bars15 && bars15.length >= 30 ? scoreStructure(bars15, "15m") : null;

  const fpBars = fpRes?.bars ?? [];
  const fpSigs = fpBars.length ? computeFpSignals(fpBars) : [];
  const fpSummary = fpBars.length ? fpSignalSummary(fpSigs, px) : { line: "足迹信号(15m)：暂无数据", groups: [], count: 0, bull: 0, bear: 0, recent: [] };
  const cvdScore = cvdRes ? scoreCvd(fetchCvdShape(cvdRes), cvdRes.updatedAt) : { score: 0, missing: true };
  const taker = fpRes ? scoreTaker({ bars: fpBars }) : { score: 0, missing: true };
  const oiScore = oiRes ? scoreOi(oiRes, px1hPct) : { score: 0, missing: true };

  const walls = wallsRes
    ? wallStats(
        { model: { walls: wallsRes.walls, events: wallsRes.events ?? [], strip: [], depth: wallsRes.depth5, imbalance: wallsRes.imbalance } },
        px
      )
    : null;
  const depth1 = wallsRes?.depth1 ?? null;
  const depth5 = wallsRes?.depth5 ?? null;
  const whales = ltoRes ? whaleFlow({ groups: ltoRes.groups, minVolUsd: 100_000 }, px) : null;
  const liq = liqRes ? { above: liqRes.above ?? [], below: liqRes.below ?? [] } : null;
  const market = marketFromBars(bars15 ?? [], barsH1 ?? [], px);

  const levels = s5 && s15 ? buildLevels({ px, s5, s15, market, liq, walls, atr15: s15.atr, ltoClusters: whales?.anchorClusters ?? [] }) : null;
  const card =
    s5 && s15
      ? buildCard({ sym, px, s5, s15, cvd: cvdScore, taker, oi: oiScore, walls, depth1, whales, levels })
      : { prob: null, status: "wait", statusLine: "🔴 数据不足，无法给出概率", conclusion: "", factors: [] };

  return {
    ok: true,
    sym,
    lead: leadKey(sym),
    price: px,
    decs,
    chg24hPct: chg24hPct == null ? null : +chg24hPct.toFixed(2),
    chg1hPct: +px1hPct.toFixed(2),
    candleTs: bars5 && bars5.length ? bars5[bars5.length - 1].ts : null,
    fetchedAt: Date.now(),
    card,
    fp: {
      line: fpSummary.line,
      groups: fpSummary.groups,
      count: fpSummary.count,
      bull: fpSummary.bull,
      bear: fpSummary.bear,
      recent: fpSummary.recent,
      buckets: fpRes?.buckets ?? 0,
      bars: fpBars.length,
      venues: fpRes?.venues ?? [],
      missing: fpRes?.missing ?? [],
    },
    levels,
    walls: wallsRes
      ? {
          mid: wallsRes.mid,
          gridStep: wallsRes.gridStep,
          venues: wallsRes.venues,
          depth1: wallsRes.depth1,
          depth5: wallsRes.depth5,
          imbalance: wallsRes.imbalance,
          walls: wallsRes.walls,
          events: wallsRes.events ?? [],
          eventCounts: wallsRes.eventCounts ?? null,
          eventTotal: wallsRes.eventTotal ?? 0,
          eventWindow: wallsRes.eventWindow ?? null,
          nearestAsk: walls?.nearestAsk ?? null,
          nearestBid: walls?.nearestBid ?? null,
          wallCount: walls?.count ?? 0,
        }
      : null,
    whales: whales
      ? {
          h1: { n: whales.h1.n, buy: Math.round(whales.h1.buy), sell: Math.round(whales.h1.sell), net: Math.round(whales.h1.net) },
          h24: { n: whales.h24.n, buy: Math.round(whales.h24.buy), sell: Math.round(whales.h24.sell), net: Math.round(whales.h24.net) },
          biggest: whales.biggest.map((r) => ({ ex: r.ex, kind: r.kind, price: r.price, usd: Math.round(r.usd), side: r.side, t: r.t })),
          clusters: whales.topClusters.map((c) => ({ price: c.price, side: c.side, usd: Math.round(c.usd), n: c.n })),
          anchors: whales.anchorClusters.map((c) => ({ price: c.price, side: c.side, usd: Math.round(c.usd), n: c.n })),
          total: whales.total,
          minVolUsd: whales.minVolUsd ?? 100_000,
          venues: ["Binance"],
        }
      : null,
    liq,
    oi: oiRes ? { aggregate: oiRes.aggregate, venues: oiRes.venues } : null,
    cvd: cvdRes
      ? {
          kpis: cvdRes.kpis,
          divergences: cvdRes.divergences,
          delta: cvdRes.delta.slice(-48),
          instruments: cvdRes.instruments,
          n: cvdRes.n,
        }
      : null,
    market: {
      auction: market.auction,
      vwap: market.vwap,
      levels: market.levels,
    },
    bars5: (bars5 ?? []).map((b) => [b.ts, +b.o.toFixed(decs + 1), +b.h.toFixed(decs + 1), +b.l.toFixed(decs + 1), +b.c.toFixed(decs + 1), Math.round(b.v)]),
    bars15: (bars15 ?? []).map((b) => [b.ts, +b.o.toFixed(decs + 1), +b.h.toFixed(decs + 1), +b.l.toFixed(decs + 1), +b.c.toFixed(decs + 1), Math.round(b.v)]),
    errors,
    updatedAt: Date.now(),
  };
}

/** cvd route → the shape scoreCvd() expects ({ kpis, delta }) */
function fetchCvdShape(c) {
  return { kpis: c.kpis, delta: c.delta ?? [], updatedAt: c.updatedAt };
}
