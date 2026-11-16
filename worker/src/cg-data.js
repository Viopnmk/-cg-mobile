/**
 * Coinglass data layer for the mobile app: every fetcher mirrors the exact
 * upstream calls of the cg-terminal routes (ticker / kline / fp / cvd / oi /
 * bookwalls / lto / liqlevels), with limits tuned for a Worker's subrequest
 * and CPU budget.
 */

import { cgGet, cgStream, CAPI, FAPI } from "./cg-client.js";
import { fpFromBuckets, mergeFp } from "./fp.js";
import { FlowGrid, flowRows, recompute, detectDivergences, cvdKpis } from "./cvd.js";
import { volumeProfile, utcDayStart } from "./signals.js";
import { decodeBookRow, scanWallEvents } from "./wall-events.js";

export const SYMBOLS = ["ETH", "BTC", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE", "LINK", "LTC", "XAU", "XAG"];
const METALS = new Set(["XAU", "XAG", "XPT"]);
export const isSupported = (s) => SYMBOLS.includes(String(s).toUpperCase());

const q = encodeURIComponent;
const ITV_SEC = { m1: 60, m5: 300, m15: 900, h1: 3600, h4: 14400, d1: 86400 };

export function leadKey(sym) {
  return `Binance_${sym}USDT`;
}

/** Footprint venues — Coinglass agg-perp minus Hyperliquid (needs an extra
 *  price-shift kline; excluded to keep the Worker light). */
export function fpVenues(sym) {
  return [
    { id: "binance-perp", key: `Binance_${sym}USDT` },
    { id: "okx-perp", key: `OKX_${sym}-USDT-SWAP` },
    { id: "bybit-perp", key: `Bybit_${sym}USDT` },
    { id: "hyperliquid-perp", key: `Hyperliquid_${sym}-USD` },
  ];
}

export function cvdVenues(sym) {
  return [
    { key: `Binance_${sym}USDT`, venue: "Binance", kind: "perp" },
    { key: `OKX_${sym}-USDT-SWAP`, venue: "OKX", kind: "perp" },
    { key: `Bybit_${sym}USDT`, venue: "Bybit", kind: "perp" },
    { key: `Bitget_${sym}USDT_UMCBL`, venue: "Bitget", kind: "perp" },
    { key: `Binance_SPOT_${sym}USDT`, venue: "Binance", kind: "spot" },
  ];
}

export function aggExchanges(sym) {
  return METALS.has(sym) ? ["Binance"] : ["Binance", "OKX", "Gate", "Bitget", "Hyperliquid"];
}

/* ------------------------------------------------------------------ kline */

export async function kline(sym, itv, limit, ttl = 15_000) {
  const rows = await cgGet(
    `/api/v2/kline?symbol=${q(`${leadKey(sym)}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`,
    { ttl }
  );
  const arr = Array.isArray(rows) ? rows : rows?.data ?? [];
  return arr
    .map((r) => ({ ts: Number(r[0]) * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .filter((b) => b.c > 0 && Number.isFinite(b.ts));
}

/* -------------------------------------------------------------- footprint */

/**
 * Aggregated footprint bars: lead-venue OHLC + merged per-venue bucket rows.
 * Returns { bars, venues, missing } — bars[].fp = {tick, lo, b[], s[], bc[], sc[]}
 */
export async function footprint(sym, itv = "m15", limit = 64) {
  const venues = fpVenues(sym);
  // USD-quoted venues (Hyperliquid) need their prices shifted onto the lead
  // (Binance USDT) close per bar — the terminal's exact agg-perp method.
  const shiftVenues = venues.filter((v) => v.id === "hyperliquid-perp");
  const jobs = [
    kline(sym, itv, limit),
    ...venues.map((v) =>
      cgGet(`/api/orderFlow?symbol=${q(`${v.key}#order_flow`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 20_000,
      }).catch(() => null)
    ),
    ...shiftVenues.map((v) =>
      cgGet(`/api/v2/kline?symbol=${q(`${v.key}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 20_000,
      }).catch(() => null)
    ),
  ];
  const [lead, ...rest] = await Promise.all(jobs);
  const flows = rest.slice(0, venues.length);
  const shiftKlines = rest.slice(venues.length);
  const missing = [];
  const maps = flows.map((rows, i) => {
    if (!Array.isArray(rows) || !rows.length) {
      missing.push(venues[i].id);
      return new Map();
    }
    const m = new Map();
    for (const row of rows) {
      if (!Array.isArray(row) || row[0] == null) continue;
      m.set(Number(row[0]) * 1000, fpFromBuckets(row[1]));
    }
    return m;
  });

  // apply the per-bar price shift to shifted venues
  const leadClose = new Map(lead.map((b) => [b.ts, b.c]));
  shiftVenues.forEach((v, si) => {
    const idx = venues.findIndex((x) => x.id === v.id);
    const rows = shiftKlines[si];
    if (idx < 0 || !Array.isArray(rows)) return;
    const closes = new Map(rows.map((r) => [Number(r[0]) * 1000, +r[4]]));
    const shifted = new Map();
    for (const [ts, fp] of maps[idx]) {
      const vc = closes.get(ts);
      const lc = leadClose.get(ts);
      const off = vc != null && lc != null ? lc - vc : 0;
      shifted.set(ts, off && fp ? { ...fp, lo: fp.lo + off } : fp);
    }
    maps[idx] = shifted;
  });

  const bars = [];
  for (const b of lead) {
    const fs = [];
    for (const m of maps) {
      const f = m.get(b.ts);
      if (f) fs.push(f);
    }
    const fp = fs.length > 1 ? mergeFp(fs) : fs[0] ?? null;
    bars.push({ ts: b.ts, o: b.o, h: b.h, l: b.l, c: b.c, fp });
  }
  const buckets = bars.filter((b) => b.fp && b.fp.b.length).length;
  return {
    bars,
    venues: venues.map((v) => v.id).filter((id) => !missing.includes(id)),
    missing,
    buckets,
  };
}

/* -------------------------------------------------------------------- cvd */

export async function cvd(sym, itv = "m15", limit = 150) {
  const venues = cvdVenues(sym);
  const stepMs = (ITV_SEC[itv] ?? 900) * 1000;
  const [priceRows, ...flows] = await Promise.all([
    cgGet(
      `/api/v2/kline?symbol=${q(`${leadKey(sym)}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`,
      { ttl: 30_000 }
    ),
    ...venues.map((v) =>
      cgGet(`/api/v2/kline?symbol=${q(`${v.key}#bs_usd`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 30_000,
      }).catch(() => null)
    ),
  ]);
  const candles = (Array.isArray(priceRows) ? priceRows : priceRows?.data ?? []).filter((r) => Number.isFinite(+r[4]));
  if (!candles.length) throw new Error("cvd: no candles");

  const grid = new FlowGrid(stepMs, venues.map((v) => v.key));
  grid.setCandles(candles);
  let anyFlow = false;
  const loaded = [];
  flows.forEach((rows, i) => {
    const arr = Array.isArray(rows) ? rows : rows?.data ?? [];
    const ok = Array.isArray(arr) && arr.length > 0;
    if (ok) anyFlow = true;
    loaded.push({ key: venues[i].key, venue: venues[i].venue, kind: venues[i].kind, ok });
    if (ok) grid.mergeFlow(i, flowRows(arr));
  });
  if (!anyFlow) throw new Error("cvd: no taker flow rows");

  const series = recompute(grid, venues);
  const divs = detectDivergences(series, series.total);
  const kpis = cvdKpis(series, "all", divs);
  const r1e6 = (x) => Math.round(x / 1e6);
  return {
    ok: true,
    itv,
    n: series.n,
    priceKey: leadKey(sym),
    instruments: loaded,
    candles: series.ts.map((t, i) => [t, series.o[i], series.h[i], series.l[i], series.c[i]]),
    delta: Array.from(series.delta, r1e6),
    perp: Array.from(series.perp.slice(1), r1e6),
    spot: Array.from(series.spot.slice(1), r1e6),
    ratio: Array.from(series.ratio, (x) => (Number.isFinite(x) ? +x.toFixed(4) : null)),
    kpis: {
      perpCvd: r1e6(kpis.perpCvd),
      spotCvd: r1e6(kpis.spotCvd),
      perpBuy: r1e6(kpis.perpBuy),
      perpSell: r1e6(kpis.perpSell),
      spotBuy: r1e6(kpis.spotBuy),
      spotSell: r1e6(kpis.spotSell),
      buyRatio: Number.isFinite(kpis.buyRatio) ? +(kpis.buyRatio * 100).toFixed(1) : null,
      quadrant: kpis.quadrant,
      latestDiv: kpis.latestDiv
        ? { type: kpis.latestDiv.t, ts: kpis.latestDiv.ts, price: +kpis.latestDiv.priceB.toFixed(2) }
        : null,
    },
    divergences: divs.slice(-6).map((d) => ({
      type: d.t,
      ts: d.ts,
      priceA: +d.priceA.toFixed(2),
      priceB: +d.priceB.toFixed(2),
      hit: d.hit ?? null,
      ret12: d.r != null ? +(d.r * 100).toFixed(2) : null,
    })),
    updatedAt: Date.now(),
  };
}

/* --------------------------------------------------------------------- oi */

export async function openInterest(sym, ttl = 30_000) {
  const raw = await cgGet(`/api/openInterest/v3/chart?symbol=${q(sym)}&type=0&timeType=2`, { ttl });
  const dataMap = raw?.dataMap && typeof raw.dataMap === "object" ? raw.dataMap : {};
  const dateList = Array.isArray(raw?.dateList) ? raw.dateList : [];
  let totalLatest = 0;
  let total1h = 0;
  let total4h = 0;
  let total24h = 0;
  const venues = [];
  for (const [name, vals] of Object.entries(dataMap)) {
    if (!Array.isArray(vals) || !vals.length) continue;
    const latest = vals[vals.length - 1] ?? 0;
    venues.push({ name, oiUsd: Math.round(latest) });
    totalLatest += latest;
    if (vals.length >= 2) total1h += vals[vals.length - 2] ?? latest;
    if (vals.length >= 5) total4h += vals[vals.length - 5] ?? latest;
    const i24 = vals.length >= 25 ? vals.length - 25 : 0;
    total24h += vals[i24] ?? latest;
  }
  if (!venues.length) return { ok: false, aggregate: null };
  venues.sort((a, b) => b.oiUsd - a.oiUsd);
  const pct = (a, b) => (b > 0 ? +(((a - b) / b) * 100).toFixed(2) : null);
  return {
    ok: true,
    n: dateList.length,
    venues: venues.slice(0, 8).map((v) => ({ ...v, sharePct: totalLatest ? +((v.oiUsd / totalLatest) * 100).toFixed(1) : null })),
    aggregate: {
      oiUsd: Math.round(totalLatest),
      oiDelta1hPct: pct(totalLatest, total1h),
      oiDelta4hPct: pct(totalLatest, total4h),
      oiDelta24hPct: pct(totalLatest, total24h),
    },
    updatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ walls */

/**
 * 聚合盘口 stream（Coinglass /LiquidityHeatmap 的 aggregate 模式）。
 *
 * 每个币真正支持盘口的场所不同：只要请求里有一个场所没有该币的 heatmap 对，
 * 整个 stream 就会报错（`No supported futures heatmap pair for SOL on Bitget`），
 * 所以照原版做法把被点名的场所剔掉再试（SOL/BNB/XRP/ADA/AVAX/DOGE/LINK/LTC
 * 都会踩这个坑），成功的场所组合缓存 1 小时。
 */
const venueCache = new Map(); // `${sym}|${market}` -> { at, venues }
const VENUE_TTL = 3600_000;

const WALL_MIN_USD = {
  BTC: 1_500_000,
  ETH: 800_000,
  XAU: 1_000_000,
  XAG: 500_000,
  SOL: 300_000,
  XRP: 300_000,
  BNB: 300_000,
  DOGE: 300_000,
  ADA: 300_000,
  AVAX: 300_000,
  LINK: 300_000,
  LTC: 300_000,
};

export function minWallUsd(sym) {
  return WALL_MIN_USD[sym] ?? 150_000;
}

function rejectedVenue(msg) {
  const m = /No supported \w+ heatmap pair for .+? on (.+?)\s*$/.exec(msg);
  return m ? m[1] : null;
}

function aggStreamUrl(coin, venues, { market, interval, limit }) {
  const qs = new URLSearchParams({
    coin,
    exchanges: venues.join(","),
    market,
    interval,
    limit: String(limit),
    batchSize: "10",
    endTime: String(Math.floor(Date.now() / 1000)),
  });
  return `${CAPI}/liquidity-heatmap/api/liquidity/heatmap/aggregate/stream?${qs.toString()}`;
}

async function aggStream(sym, { market = "futures", interval = "m15", limit = 2, timeoutMs = 12_000 } = {}) {
  const ck = `${sym}|${market}`;
  const hit = venueCache.get(ck);
  const cached = hit && Date.now() - hit.at < VENUE_TTL;
  let venues = cached ? [...hit.venues] : aggExchanges(sym);
  let lastErr = null;
  for (let guard = 0; guard < 6 && venues.length; guard++) {
    try {
      const stream = await cgStream(aggStreamUrl(sym, venues, { market, interval, limit }), timeoutMs);
      if (!cached || venues.join(",") !== hit.venues.join(",")) {
        venueCache.set(ck, { at: Date.now(), venues: [...venues] });
        if (venueCache.size > 64) venueCache.delete(venueCache.keys().next().value);
      }
      return { venues, stream };
    } catch (e) {
      lastErr = e;
      const bad = rejectedVenue(e instanceof Error ? e.message : "");
      if (!bad) throw e;
      const next = venues.filter((v) => v !== bad);
      if (next.length === venues.length) throw e;
      venues = next;
    }
  }
  throw lastErr ?? new Error(`walls: no heatmap venue for ${sym}`);
}

/** 一份快照 → [桶起点价, usd, side]，只留 ±band%（和原版 cells 一个意思） */
function snapshotCells(snap, bandPct = 15) {
  const out = [];
  const g = snap.g;
  const mid = snap.mid;
  for (let i = 0; i < snap.q.length; i++) {
    const qty = snap.q[i];
    if (!(qty > 0)) continue;
    const p = (snap.k0 + i) * g;
    const c = p + g / 2;
    if (Math.abs(c / mid - 1) > bandPct / 100) continue;
    out.push([p, qty * c, c < mid ? "b" : "a"]);
  }
  return out;
}

/**
 * ±band% 深度 + 当前挂单墙 + 大墙异动，全部来自 Coinglass 的聚合盘口 stream
 * （他们 /LiquidityHeatmap 页面的 aggregate 模式，多场所按价格对齐合并）。
 *
 *   snapshots       只算深度时需要的快照数（其实 1 份就够）
 *   events          是否扫「大墙异动」（默认开）
 *   eventSnapshots  为扫异动往回吃多少份 15m 快照（默认 40 ≈ 10 小时）
 *   eventLimit      最近事件返回条数上限（默认 12，防止 JSON 膨胀）
 */
export async function bookWalls(
  sym,
  { band = 5, snapshots = 2, history = true, events = true, eventSnapshots = 40, eventLimit = 12 } = {}
) {
  const wantEvents = events !== false && events !== 0;
  const back = wantEvents ? Math.min(Math.max(Number(eventSnapshots) || 40, 6), 96) : 1;
  const want = Math.max(Number(snapshots) || 1, back);
  const { venues, stream } = await aggStream(sym, {
    interval: "m15",
    limit: want,
    timeoutMs: wantEvents ? 25_000 : 12_000,
  });
  const snaps = stream.rows
    .map((r) => decodeBookRow(r, stream.size))
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  if (!snaps.length) throw new Error("walls: empty aggregate stream");
  const snap = snaps[snaps.length - 1];
  const mid = snap.mid;
  const cells = snapshotCells(snap);

  const depth = (pct) => {
    const lo = mid * (1 - pct / 100);
    const hi = mid * (1 + pct / 100);
    let bidUsd = 0;
    let askUsd = 0;
    for (const [p, usd, side] of cells) {
      const c = p + snap.g / 2;
      if (c <= lo || c >= hi) continue;
      if (side === "b") bidUsd += usd;
      else askUsd += usd;
    }
    return { bandPct: pct, bidUsd, askUsd, imb: bidUsd + askUsd > 0 ? (bidUsd - askUsd) / (bidUsd + askUsd) : 0 };
  };

  // 大墙异动：照原版 WallScanner 扫历史快照；「碰价」用 m5 K 线覆盖整个间隔
  let scan = null;
  if (wantEvents && snaps.length >= 2) {
    const bars = await kline(sym, "m5", 300, 20_000).catch(() => []);
    scan = scanWallEvents(snaps, {
      minUsd: minWallUsd(sym),
      candles: bars.map((b) => ({ ts: b.ts, h: b.h, l: b.l })),
      candleStepMs: 300_000,
      limit: eventLimit,
    });
  }

  const dec = mid >= 100 ? 2 : mid >= 1 ? 3 : 5;
  // 当前挂单墙：优先用扫描器确认过的墙（连续 2 次扫描都在），没有就退回单快照阈值表
  let walls = (scan?.walls ?? []).map((w) => ({ ...w, price: +w.price.toFixed(dec) }));
  if (!walls.length) {
    const thresh = minWallUsd(sym);
    for (const [p, usd, side] of cells) {
      if (usd < thresh || Math.abs(p / mid - 1) > 0.03) continue;
      walls.push({ side, price: p, usd: Math.round(usd), qty: null, distPct: +((p / mid - 1) * 100).toFixed(2) });
    }
  }
  walls.sort((a, b) => b.usd - a.usd);

  // 紧凑密度带（图表叠加用）：±3% 桶，只留最近 24 份快照
  const strip = [];
  if (history) {
    for (const s of snaps.slice(-24)) {
      const rows = [];
      for (let i = 0; i < s.q.length; i++) {
        const qty = s.q[i];
        if (!(qty > 0)) continue;
        const p = (s.k0 + i) * s.g;
        const c = p + s.g / 2;
        if (Math.abs(c / s.mid - 1) > 0.03) continue;
        rows.push([p, Math.round(qty * c)]);
      }
      strip.push({ t: s.t, mid: s.mid, cells: rows });
    }
  }

  return {
    ok: true,
    sym,
    source: "coinglass-aggregate",
    venues,
    gridStep: stream.size,
    mid,
    depth1: depth(1),
    depth5: depth(band),
    imbalance: depth(1).imb,
    walls: walls.slice(0, 14),
    events: scan?.events ?? [],
    eventCounts: scan?.counts ?? null,
    eventTotal: scan?.total ?? 0,
    eventWindow: scan?.window ?? null,
    strip,
    ladder: cells
      .filter(([p]) => Math.abs(p / mid - 1) <= 0.012)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 60)
      .map(([p, usd, side]) => ({ price: p, usd: Math.round(usd), side })),
    snapshots: snaps.length,
    updatedAt: snap.t,
  };
}

/* ------------------------------------------------------- large orders (lto) */

function normLtoOrders(groups, px, minVolUsd) {
  const out = [];
  for (const g of groups) {
    const inst = g.instrument ?? {};
    const kind = inst.type === 10 ? "spot" : "perp";
    for (const o of g.list ?? []) {
      if (!o || !Number.isFinite(o.price) || !Number.isFinite(o.currentUsd)) continue;
      if (Math.abs(o.price / px - 1) > 0.15) continue;
      out.push({
        ex: inst.exName ?? "?",
        inst: inst.instrumentId ?? "",
        kind,
        price: o.price,
        usd: Math.round(o.currentUsd),
        side: o.side === 2 ? "buy" : "sell", // 1 = ask(sell), 2 = bid(buy)
        openMs: o.startTime ?? o.currentTime ?? 0,
      });
    }
  }
  return out.filter((o) => o.usd >= minVolUsd).sort((a, b) => b.usd - a.usd);
}

export async function largeOrders(sym, { minVolUsd = 100_000, exchanges = ["Binance", "OKX", "Bybit"] } = {}) {
  const settled = await Promise.allSettled(
    exchanges.map((ex) =>
      cgGet(`/api/largeTakerOrder/v3?exchange=${q(ex)}&symbol=${q(sym)}&market=all&limit=3000&minVolUsd=${minVolUsd}`, {
        host: FAPI,
        ttl: 25_000,
      })
    )
  );
  const groups = [];
  settled.forEach((r) => {
    if (r.status === "fulfilled" && Array.isArray(r.value)) groups.push(...r.value);
  });
  return { groups, ok: groups.length > 0 };
}

/* ---------------------------------------------------------- whales panel */

/**
 * The `/api/whales` payload: aggregated large resting orders across venues,
 * sorted by size and clipped to +-15% of the last price, plus 1h buy/sell flow
 * stats. Shared by the Worker route and the snapshot script (tools/refresh.mjs)
 * so both emit exactly the same shape.
 */
export async function whalesPanel(sym, { minVolUsd = 100_000 } = {}) {
  const min = Math.min(Math.max(Number(minVolUsd) || 100_000, 10_000), 5_000_000);
  const [tick, lto] = await Promise.all([kline(sym, "m1", 2, 5_000), largeOrders(sym, { minVolUsd: min })]);
  const px = tick.length ? tick[tick.length - 1].c : 0;
  const rows = [];
  for (const g of lto.groups) {
    const inst = g.instrument ?? {};
    for (const o of g.list ?? []) {
      if (!o || !Number.isFinite(o.price) || !Number.isFinite(o.currentUsd)) continue;
      if (px && Math.abs(o.price / px - 1) > 0.15) continue;
      rows.push({
        ex: inst.exName ?? "?",
        inst: inst.instrumentId ?? "",
        kind: inst.type === 10 ? "spot" : "perp",
        price: o.price,
        usd: Math.round(o.currentUsd),
        side: o.side === 2 ? "buy" : "sell",
        t: o.startTime ?? o.currentTime ?? 0,
      });
    }
  }
  rows.sort((a, b) => b.usd - a.usd);
  const now = Date.now();
  const h1 = rows.filter((r) => r.t >= now - 3600_000);
  const sum = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
  return {
    ok: true,
    sym,
    price: px,
    minVolUsd: min,
    rows: rows.slice(0, 80),
    stats: {
      total: rows.length,
      h1: {
        n: h1.length,
        buy: Math.round(sum(h1.filter((r) => r.side === "buy"), (r) => r.usd)),
        sell: Math.round(sum(h1.filter((r) => r.side === "sell"), (r) => r.usd)),
      },
      perp: rows.filter((r) => r.kind === "perp").length,
      spot: rows.filter((r) => r.kind === "spot").length,
    },
    updatedAt: now,
  };
}

/* ------------------------------------------------------------ liq levels */

/**
 * 清算磁吸位: cluster the un-hit liquidationLevels/v2 rows onto a price grid and
 * rank by summed size per side (their keyLevels, reduced to one venue/grid).
 */
export async function liqLevels(sym, { limit = 400, range = "3d", lvR = 4, px = 0 } = {}) {
  const venueKey = `Binance_${sym}USDT`;
  const raw = await cgGet(`/api/liquidationLevels/v2?symbol=${q(venueKey)}&limit=${limit}&range=${range}`, {
    ttl: 60_000,
  });
  const payload = Array.isArray(raw?.data) ? raw : raw?.data?.data ? raw.data : null;
  const levels = Array.isArray(payload?.data) ? payload.data : Array.isArray(raw) ? raw : [];
  if (!levels.length) return { ok: false, above: [], below: [], venue: "Binance" };
  const now = Date.now() / 1000;
  const open = levels.filter((l) => !l.endDate && Number.isFinite(l.price) && Number.isFinite(l.size));
  const ref = px > 0 ? px : open.length ? open[open.length - 1].price : 0;
  const grid = Math.max(ref * 0.0015, 1e-9);
  const bucket = (l) => Math.round(l.price / grid);
  const rows = new Map(); // `${bucket}|${side}` -> {price, size}
  for (const l of open) {
    const side = Number(l.side) === 2 ? "above" : "below"; // 2 = shorts above, 1 = longs below
    const k = bucket(l);
    const key = `${k}|${side}`;
    const cur = rows.get(key) ?? { price: (k + 0.5) * grid, size: 0, side };
    cur.size += Number(l.size) || 0;
    rows.set(key, cur);
  }
  const all = [...rows.values()].filter((r) => r.price > 0 && Math.abs(r.price / ref - 1) <= lvR / 100);
  const above = all.filter((r) => r.price > ref).sort((a, b) => b.size - a.size).slice(0, 5).sort((a, b) => a.price - b.price);
  const below = all.filter((r) => r.price < ref).sort((a, b) => b.size - a.size).slice(0, 5).sort((a, b) => b.price - a.price);
  const mx = Math.max(1, ...above.map((r) => r.size), ...below.map((r) => r.size));
  const mk = (r) => ({ price: +r.price.toFixed(ref > 100 ? 2 : 4), strength: Math.round((r.size / mx) * 100), size: Math.round(r.size) });
  return {
    ok: true,
    venue: "Binance",
    range,
    openRows: open.length,
    last: ref,
    above: above.map(mk),
    below: below.map(mk),
  };
}

/* ---------------------------------------------------------------- market */

/** Auction (session/day) + EMA/RSI + day VWAP from the m15/h1 klines we hold. */
export function marketFromBars(bars15, barsH1, px, now = Date.now()) {
  const dayStart = utcDayStart(now);
  const sessionStart = now - 8 * 3600_000;
  const day = volumeProfile(bars15.filter((b) => b.ts >= dayStart));
  const session = volumeProfile(bars15.filter((b) => b.ts >= sessionStart));
  // previous UTC day high/low
  const prevDay = bars15.filter((b) => b.ts < dayStart);
  const pdh = prevDay.length ? Math.max(...prevDay.map((b) => b.h)) : null;
  const pdl = prevDay.length ? Math.min(...prevDay.map((b) => b.l)) : null;
  // day VWAP ±σ
  const dayBars = bars15.filter((b) => b.ts >= dayStart && b.v > 0);
  let vwap = null;
  let sd = 0;
  if (dayBars.length) {
    let sv = 0;
    let svp = 0;
    let svp2 = 0;
    for (const c of dayBars) {
      const tp = (c.h + c.l + c.c) / 3;
      sv += c.v;
      svp += c.v * tp;
      svp2 += c.v * tp * tp;
    }
    vwap = svp / sv;
    sd = Math.sqrt(Math.max(0, svp2 / sv - vwap * vwap));
  }
  return {
    auction: { day, session },
    levels: { pdh, pdl },
    vwap: vwap ? { vwap, sd1: vwap - sd, sd1u: vwap + sd } : null,
    price: px,
  };
}
