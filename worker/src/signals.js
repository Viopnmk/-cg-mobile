/**
 * Signal engine — faithful port of cg-terminal's scripts/eth-5m15m-template.mjs
 * (the exact 5m/15m AI 概率与趋势 card) plus the pure indicator helpers from
 * src/lib/cg/indicators.ts and the footprint signal scanner from the same
 * template. Everything here is pure: numbers in, numbers out — so the Worker
 * and the Node test harness produce identical output.
 *
 * Weights (sum 100): 5m 结构 30 | 15m 结构 30 | CVD 15 | Taker 15 | OI 10
 * Each is a signed score (positive = long); AI入场概率 = |total| scaled.
 */

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
const last = (a) => a[a.length - 1];
const round = (v, d = 2) => Number(v.toFixed(d));
const sgn = (v) => (v > 0 ? `+${v}` : `${v}`);

/* ------------------------------------------------------------ indicators */

export function emaSeries(vals, period) {
  const out = new Array(vals.length).fill(NaN);
  if (!vals.length) return out;
  if (vals.length < period) {
    out.fill(mean(vals));
    return out;
  }
  const k = 2 / (period + 1);
  let prev = mean(vals.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
const emaLast = (vals, period) => last(emaSeries(vals, period));

export function atr(bars, period = 14) {
  if (bars.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  return mean(trs.slice(-period));
}

export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const ag = gain / period;
  const al = loss / period;
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

/** 摆动点（分形）: 左右各 k 根都不更高/更低 */
function pivots(bars, k = 2, lookback = 50) {
  const from = Math.max(k, bars.length - lookback);
  const highs = [];
  const lows = [];
  for (let i = from; i < bars.length - k; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isH = false;
      if (bars[j].l <= bars[i].l) isL = false;
    }
    if (isH) highs.push(i);
    if (isL) lows.push(i);
  }
  return { highs, lows };
}

/* ------------------------------------------------------------- 结构打分 */

/**
 * 30 分结构分（带符号）:
 *   EMA 排列 10 + EMA9 动量 4 + BOS/摆动序列 8 + 溢价/折价区 6 + RSI 2
 */
export function scoreStructure(bars, label) {
  const closes = bars.map((b) => b.c);
  const p = last(closes);
  const e9s = emaSeries(closes, 9);
  const e9 = last(e9s);
  const e21 = emaLast(closes, 21);
  const e55 = emaLast(closes, 55);
  const e9prev = e9s[Math.max(0, e9s.length - 6)];
  const r = rsi(closes);
  const A = atr(bars);

  const stackRaw = (p > e9 ? 1 : -1) + (e9 > e21 ? 1 : -1) + (e21 > e55 ? 1 : -1);
  const emaPts = Math.round((stackRaw / 3) * 10);
  const momPts = (p > e9 ? 2 : -2) + (e9 > e9prev ? 2 : -2);

  const { highs, lows } = pivots(bars, 2, 50);
  const Hi = highs.map((i) => ({ i, p: bars[i].h }));
  const Lo = lows.map((i) => ({ i, p: bars[i].l }));
  const lastHigh = Hi.length ? last(Hi) : null;
  const lastLow = Lo.length ? last(Lo) : null;
  let structPts = 0;
  let bosNote = "区间内";
  if (lastHigh && p > lastHigh.p) {
    structPts = 8;
    bosNote = `上破摆动高 ${round(lastHigh.p)}`;
  } else if (lastLow && p < lastLow.p) {
    structPts = -8;
    bosNote = `下破摆动低 ${round(lastLow.p)}`;
  } else if (Hi.length >= 2 && Lo.length >= 2) {
    const hh = last(Hi).p > Hi[Hi.length - 2].p;
    const hl = last(Lo).p > Lo[Lo.length - 2].p;
    if (hh && hl) {
      structPts = 4;
      bosNote = "高点抬高+低点抬高 HH/HL";
    } else if (!hh && !hl) {
      structPts = -4;
      bosNote = "高点降低+低点降低 LH/LL";
    } else {
      bosNote = "高低点交错（震荡）";
    }
  }

  const win = bars.slice(-48);
  const hi = Math.max(...win.map((b) => b.h));
  const lo = Math.min(...win.map((b) => b.l));
  const pos = hi > lo ? (p - lo) / (hi - lo) : 0.5;
  const zonePts = clamp(Math.round((0.5 - pos) * 12), -6, 6);
  const zone = pos > 0.62 ? "溢价区" : pos < 0.38 ? "折价区" : "均衡区";

  let rsiPts = 0;
  if (r >= 70) rsiPts = 1;
  else if (r > 57) rsiPts = 2;
  else if (r <= 30) rsiPts = -1;
  else if (r < 43) rsiPts = -2;

  const vols = bars.map((b) => b.v);
  const medVol = [...vols].sort((a, b) => a - b)[Math.floor(vols.length / 2)];
  const weakLow = Lo.filter((x) => x.p < p && vols[x.i] < medVol).sort((a, b) => b.i - a.i)[0] || null;
  const weakHigh = Hi.filter((x) => x.p > p && vols[x.i] < medVol).sort((a, b) => b.i - a.i)[0] || null;

  const score = clamp(emaPts + momPts + structPts + zonePts + rsiPts, -30, 30);

  return {
    label,
    score,
    parts: { emaPts, momPts, structPts, zonePts, rsiPts },
    ema: { e9, e21, e55 },
    atr: A,
    rsi: r,
    pos,
    zone,
    range: { hi, lo, eq: (hi + lo) / 2 },
    swings: { high: lastHigh?.p ?? null, low: lastLow?.p ?? null },
    weakLow: weakLow?.p ?? null,
    weakHigh: weakHigh?.p ?? null,
    note: bosNote,
  };
}

/* --------------------------------------------------------------- CVD 15 */

export function scoreCvd(cvd, updatedAt = Date.now()) {
  const k = cvd?.kpis;
  if (!k) return { score: 0, missing: true };
  const gross = (k.perpBuy || 0) + (k.perpSell || 0);
  const share = gross > 0 ? k.perpCvd / gross : 0;
  const ptsShare = clamp(Math.round(share * 300), -6, 6);

  const d = (cvd.delta || []).slice(-24);
  const absSum = sum(d.map(Math.abs));
  const dr = absSum > 0 ? sum(d) / absSum : 0;
  const ptsRecent = clamp(Math.round(dr * 6), -6, 6);
  const ptsRatio = clamp(Math.round(((k.buyRatio ?? 50) - 50) * 0.6), -3, 3);

  let ptsDiv = 0;
  const div = k.latestDiv;
  const age = div && updatedAt ? updatedAt - div.ts : Infinity;
  if (div && age < 4 * 3600_000) ptsDiv = div.type === "bear" ? -2 : 2;

  return {
    score: clamp(ptsShare + ptsRecent + ptsRatio + ptsDiv, -15, 15),
    parts: { ptsShare, ptsRecent, ptsRatio, ptsDiv },
    share,
    recentRatio: dr,
    buyRatio: k.buyRatio,
    quadrant: k.quadrant,
    perpCvd: k.perpCvd,
    spotCvd: k.spotCvd,
    div: div ? `${div.type === "bear" ? "看跌" : "看涨"}背离 @${round(div.price ?? 0)}` : null,
  };
}

/* ------------------------------------------------------------- Taker 15 */

export function scoreTaker(fp) {
  const bars = (fp?.bars || []).filter((b) => b.fp?.b?.length);
  if (!bars.length) return { score: 0, missing: true };
  const use = bars.slice(-8);
  let B = 0;
  let S = 0;
  use.forEach((b, i) => {
    const w = i >= use.length - 3 ? 2 : 1;
    B += sum(b.fp.b) * w;
    S += sum(b.fp.s) * w;
  });
  const ratio = B + S > 0 ? (B - S) / (B + S) : 0;
  const lastBar = last(bars);
  const lb = sum(lastBar.fp.b);
  const ls = sum(lastBar.fp.s);
  return {
    score: clamp(Math.round(ratio * 35), -15, 15),
    ratio,
    buyBase: B,
    sellBase: S,
    lastBar: { buy: lb, sell: ls, delta: lb - ls, ts: lastBar.ts },
    bars: use.length,
  };
}

/* ------------------------------------------------- 足迹信号 (Footprint) */

/**
 * 足迹信号引擎（与 /api/cg/fp 的 bars[].fp 同一份数据，纯本地计算）:
 *   abs 吸收 / div 发散 / sdiv 强发散 / trap 陷阱 / exh 耗尽
 * 门槛全部为滚动分位/倍数，信号在收盘后再等 1 根确认。
 */
export function computeFpSignals(X) {
  const t = X.length;
  const out = [];
  const vol = new Float64Array(t);
  for (let k = 0; k < t; k++) {
    const f = X[k].fp;
    if (!f) continue;
    let v = 0;
    for (let e = 0; e < f.b.length; e++) v += f.b[e] + f.s[e];
    vol[k] = v;
  }

  for (let l = 5; l < t - 1; l++) {
    const a = X[l].fp;
    if (!a || !vol[l]) continue;
    const win = [];
    for (let e = Math.max(0, l - 20); e < l; e++) if (vol[e]) win.push(vol[e]);
    if (win.length < 5) continue;
    win.sort((x, y) => x - y);
    if (vol[l] < 0.8 * win[win.length >> 1]) continue;

    const n = a.b.length;
    const o = vol[l];
    let delta = 0;
    let buys = 0;
    let sells = 0;
    let top = -1;
    let bot = -1;
    for (let e = 0; e < n; e++) {
      const tt = a.b[e] + a.s[e];
      delta += a.b[e] - a.s[e];
      buys += a.b[e];
      sells += a.s[e];
      if (tt > 0) {
        if (bot < 0) bot = e;
        top = e;
      }
    }
    if (top < 0) continue;
    const bar = X[l];
    const range = bar.h - bar.l;
    const closePos = range > 0 ? (bar.c - bar.l) / range : 0.5;
    const rows = top - bot + 1;

    // ---- div: 单根发散 ----
    if (bar.c > bar.o && delta < 0 && -delta >= 0.15 * o) out.push({ i: l, t: "div", side: "sell", p: bar.h, r: delta / o, ts: bar.ts });
    if (bar.c < bar.o && delta > 0 && delta >= 0.15 * o) out.push({ i: l, t: "div", side: "buy", p: bar.l, r: delta / o, ts: bar.ts });
    if (rows < 5 || range <= 0) continue;

    const zone = Math.max(2, Math.round(0.2 * rows));
    let topBuy = 0;
    let topSell = 0;
    let botBuy = 0;
    let botSell = 0;
    for (let e = top - zone + 1; e <= top; e++) {
      topBuy += a.b[e];
      topSell += a.s[e];
    }
    for (let e = bot; e < bot + zone; e++) {
      botBuy += a.b[e];
      botSell += a.s[e];
    }

    // ---- abs: 吸收 ----
    if (sells && botSell / sells >= 0.3 && botSell > 1.2 * botBuy && closePos >= 0.6)
      out.push({ i: l, t: "abs", side: "buy", p: bar.l, q: botSell, u: botSell * ((bar.h + bar.l) / 2), ts: bar.ts });
    if (buys && topBuy / buys >= 0.3 && topBuy > 1.2 * topSell && closePos <= 0.4)
      out.push({ i: l, t: "abs", side: "sell", p: bar.h, q: topBuy, u: topBuy * ((bar.h + bar.l) / 2), ts: bar.ts });

    // ---- exh: 耗尽 ----
    let hi10 = -Infinity;
    let lo10 = Infinity;
    for (let e = Math.max(0, l - 10); e < l; e++) {
      if (X[e].h > hi10) hi10 = X[e].h;
      if (X[e].l < lo10) lo10 = X[e].l;
    }
    const dz = Math.max(1, Math.round(0.1 * rows));
    let topVol = 0;
    let botVol = 0;
    for (let e = top - dz + 1; e <= top; e++) topVol += a.b[e] + a.s[e];
    for (let e = bot; e < bot + dz; e++) botVol += a.b[e] + a.s[e];
    if (bar.h > hi10 && topVol <= 0.02 * o && closePos <= 0.5) out.push({ i: l, t: "exh", side: "sell", p: bar.h, ts: bar.ts });
    if (bar.l < lo10 && botVol <= 0.02 * o && closePos >= 0.5) out.push({ i: l, t: "exh", side: "buy", p: bar.l, ts: bar.ts });

    // ---- trap: 陷阱 ----
    let hi5 = -Infinity;
    let lo5 = Infinity;
    for (let e = Math.max(0, l - 5); e < l; e++) {
      if (X[e].h > hi5) hi5 = X[e].h;
      if (X[e].l < lo5) lo5 = X[e].l;
    }
    if (bar.h > hi5 && buys && topBuy / buys >= 0.3 && topBuy > 1.5 * topSell) {
      for (let j = l + 1; j <= Math.min(l + 3, t - 2) && !(X[j].h > bar.h); j++) {
        if (X[j].c <= bar.l + 0.25 * range) {
          out.push({ i: l, t: "trap", side: "sell", p: bar.h, j, q: topBuy, u: topBuy * ((bar.h + bar.l) / 2), ts: bar.ts });
          break;
        }
      }
    }
    if (bar.l < lo5 && sells && botSell / sells >= 0.3 && botSell > 1.5 * botBuy) {
      for (let j = l + 1; j <= Math.min(l + 3, t - 2) && !(X[j].l < bar.l); j++) {
        if (X[j].c >= bar.h - 0.25 * range) {
          out.push({ i: l, t: "trap", side: "buy", p: bar.l, j, q: botSell, u: botSell * ((bar.h + bar.l) / 2), ts: bar.ts });
          break;
        }
      }
    }
  }

  // ---- sdiv: 摆动点 + 累计 Delta 背离 ----
  const cvd = new Float64Array(t);
  {
    let acc = 0;
    for (let k = 0; k < t; k++) {
      const f = X[k].fp;
      if (f) for (let e = 0; e < f.b.length; e++) acc += f.b[e] - f.s[e];
      cvd[k] = acc;
    }
  }
  let prevHigh = -1;
  let prevLow = -1;
  for (let a = 3; a <= t - 5; a++) {
    let isHigh = true;
    let isLow = true;
    for (let e = a - 3; e <= a + 3 && (isHigh || isLow); e++) {
      if (e === a) continue;
      if (e < a ? X[e].h >= X[a].h : X[e].h > X[a].h) isHigh = false;
      if (e < a ? X[e].l <= X[a].l : X[e].l < X[a].l) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    const win = [];
    for (let e = Math.max(0, a - 20); e < a; e++) if (vol[e]) win.push(vol[e]);
    win.sort((x, y) => x - y);
    const gapMin = 0.25 * (win.length ? win[win.length >> 1] : 0);
    if (isHigh) {
      if (prevHigh >= 0 && a - prevHigh <= 40 && X[a].h > X[prevHigh].h && cvd[prevHigh] - cvd[a] > gapMin)
        out.push({ i: a, t: "sdiv", side: "sell", p: X[a].h, i0: prevHigh, p0: X[prevHigh].h, dc: cvd[a] - cvd[prevHigh], ts: X[a].ts });
      prevHigh = a;
    }
    if (isLow) {
      if (prevLow >= 0 && a - prevLow <= 40 && X[a].l < X[prevLow].l && cvd[a] - cvd[prevLow] > gapMin)
        out.push({ i: a, t: "sdiv", side: "buy", p: X[a].l, i0: prevLow, p0: X[prevLow].l, dc: cvd[a] - cvd[prevLow], ts: X[a].ts });
      prevLow = a;
    }
  }

  out.sort((x, y) => x.i - y.i);
  return out;
}

export const FP_SIG_NAME = { abs: "吸收", div: "发散", sdiv: "强发散", trap: "陷阱", exh: "耗尽" };

export function fpSigNote(g) {
  const bull = g.side === "buy";
  switch (g.t) {
    case "abs":
      return bull ? "低位卖盘被吸收" : "高位买盘被吸收";
    case "div":
      return bull ? "跌但主动卖不足" : "涨但主动买不足";
    case "sdiv":
      return bull ? "低点更低CVD反升" : "高点更高CVD走低";
    case "trap":
      return bull ? "假跌破拉回，追空被套" : "假突破回落，追多被套";
    default:
      return bull ? "新低缩量卖尽" : "新高缩量买尽";
  }
}

/**
 * 近 4h 重要足迹信号（从新到旧，最多 3 组；同一根同方向合并）。
 * 返回结构化数据 + 与终端一致的一行文本。
 */
export function fpSignalSummary(sigs, px, nowMs = Date.now()) {
  const nowSec = nowMs / 1000;
  const recent = sigs.filter((g) => g.ts <= nowSec && nowSec - g.ts <= 4 * 3600);
  const head = "足迹信号(15m)：";
  if (!recent.length) {
    return { line: `${head}近4h无明显反转/吸收信号`, groups: [], count: 0, bull: 0, bear: 0, recent: [] };
  }
  const bull = recent.filter((g) => g.side === "buy").length;
  const bear = recent.length - bull;

  const groups = [];
  for (const g of [...recent].sort((a, b) => b.ts - a.ts)) {
    const key = `${g.ts}|${g.side}`;
    let grp = groups.find((x) => x.key === key);
    if (!grp) {
      grp = { key, ts: g.ts, side: g.side, items: [], usd: 0 };
      groups.push(grp);
    }
    grp.items.push(g);
    if (g.u > grp.usd) grp.usd = g.u;
  }

  const show = groups.slice(0, 3);
  const parts = show.map((grp) => {
    const names = [...new Set(grp.items.map((g) => FP_SIG_NAME[g.t] ?? g.t))].join("+");
    const notes = [...new Set(grp.items.map(fpSigNote))].join("；");
    const arrow = grp.side === "buy" ? "↑" : "↓";
    const size = grp.usd >= 1e6 ? `，$${(grp.usd / 1e6).toFixed(1)}M` : "";
    return { names, notes, arrow, size, ts: grp.ts, price: grp.items[0].p, side: grp.side, usd: grp.usd };
  });
  const line =
    `${head}${parts.map((p) => `${p.names}${p.arrow}@${p.price}（${p.notes}${p.size}）`).join("｜")}` +
    `${groups.length > show.length ? `等${groups.length}处` : ""}｜近4h ${recent.length}个(${bull}多/${bear}空)`;
  return {
    line,
    groups: parts,
    count: recent.length,
    bull,
    bear,
    recent: recent
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 12)
      .map((g) => ({
        ts: g.ts,
        type: g.t,
        name: FP_SIG_NAME[g.t] ?? g.t,
        side: g.side,
        price: g.p,
        note: fpSigNote(g),
        usd: g.u ? Math.round(g.u) : null,
        cvdGap: g.dc ? Math.round(g.dc) : null,
      })),
  };
}

/* ---------------------------------------------------------------- OI 10 */

export function scoreOi(oi, px1hPct) {
  const a = oi?.aggregate;
  if (!a || a.oiDelta1hPct == null) return { score: 0, missing: true };
  const dOi = a.oiDelta1hPct / 100;
  const dPx = (px1hPct ?? 0) / 100;
  let sign = 0;
  let strength = 1;
  let regime = "持仓中性";
  if (dOi > 0 && dPx > 0) {
    sign = 1;
    regime = "多头增仓";
  } else if (dOi > 0 && dPx < 0) {
    sign = -1;
    regime = "空头增仓";
  } else if (dOi < 0 && dPx > 0) {
    sign = 1;
    strength = 0.6;
    regime = "空头回补(轧空)";
  } else if (dOi < 0 && dPx < 0) {
    sign = -1;
    strength = 0.8;
    regime = "多头平仓(踩踏)";
  }
  const mag = Math.min(1, (Math.abs(dOi) * 100) / 1.2);
  return {
    score: Math.round(10 * mag * sign * strength),
    dOiPct: a.oiDelta1hPct,
    dOi4hPct: a.oiDelta4hPct,
    dOi24hPct: a.oiDelta24hPct,
    px1hPct,
    regime,
    oiUsd: a.oiUsd,
  };
}

/* ------------------------------------------------------------ 盘口/大单 */

export function depthBuckets(bw, pct) {
  const strip = bw?.model?.strip;
  if (!strip?.length) return null;
  const row = last(strip);
  const mid = row.mid;
  const lo = mid * (1 - pct / 100);
  const hi = mid * (1 + pct / 100);
  let bid = 0;
  let ask = 0;
  for (const [p, u] of row.cells) {
    if (p <= lo || p >= hi) continue;
    if (p < mid) bid += u;
    else if (p > mid) ask += u;
  }
  const t = bid + ask;
  return { bid, ask, imb: t > 0 ? (bid - ask) / t : 0, mid };
}

export function wallStats(bw, px) {
  const model = bw?.model;
  if (!model) return null;
  const walls = model.walls || [];
  const askAbove = walls.filter((w) => w.side === "a" && w.price > px).sort((a, b) => a.price - b.price);
  const bidBelow = walls.filter((w) => w.side === "b" && w.price < px).sort((a, b) => b.price - a.price);
  return {
    nearestAsk: askAbove[0] ?? null,
    nearestBid: bidBelow[0] ?? null,
    askAbove,
    bidBelow,
    events: (model.events || []).slice(0, 40),
    depth5: model.depth ?? null,
    imbalance: model.imbalance,
    imbalance5mAgo: model.imbalance5mAgo,
    touched: walls.filter((w) => w.touched).length,
    count: walls.length,
  };
}

export function whaleFlow(lto, px, now = Date.now()) {
  const groups = lto?.groups || [];
  const rows = [];
  for (const g of groups) {
    const ex = g.instrument?.exName ?? "?";
    const kind = g.instrument?.type === 10 ? "spot" : "perp";
    for (const o of g.list || []) {
      if (!o || !Number.isFinite(o.price) || !Number.isFinite(o.currentUsd)) continue;
      if (Math.abs(o.price / px - 1) > 0.15) continue;
      rows.push({
        ex,
        kind,
        price: o.price,
        usd: o.currentUsd,
        side: o.side === 2 ? "buy" : "sell",
        t: o.startTime ?? o.currentTime ?? 0,
        ageMs: now - (o.startTime ?? now),
      });
    }
  }
  const win = (h) => {
    const from = now - h * 3600_000;
    const r = rows.filter((x) => x.t >= from);
    const buy = sum(r.filter((x) => x.side === "buy").map((x) => x.usd));
    const sell = sum(r.filter((x) => x.side === "sell").map((x) => x.usd));
    return { n: r.length, buy, sell, net: buy - sell, rows: r };
  };
  const h1 = win(1);
  const h24 = win(24);
  const biggest = [...h24.rows].sort((a, b) => b.usd - a.usd).slice(0, 3);
  const near = h24.rows.filter((x) => Math.abs(x.price / px - 1) < 0.005);
  const clusters = new Map();
  for (const x of near) {
    const key = `${x.price.toFixed(2)}|${x.side}`;
    const c = clusters.get(key) ?? { price: x.price, side: x.side, usd: 0, n: 0 };
    c.usd += x.usd;
    c.n += 1;
    clusters.set(key, c);
  }
  const topClusters = [...clusters.values()].sort((a, b) => b.usd - a.usd).slice(0, 4);
  const wide = new Map();
  for (const x of rows.filter((r) => Math.abs(r.price / px - 1) < 0.02)) {
    const key = `${x.price.toFixed(2)}|${x.side}`;
    const c = wide.get(key) ?? { price: x.price, side: x.side, usd: 0, n: 0 };
    c.usd += x.usd;
    c.n += 1;
    wide.set(key, c);
  }
  const anchorClusters = [...wide.values()].filter((c) => c.usd >= 2e6).sort((a, b) => a.price - b.price);
  return { h1, h24, biggest, topClusters, anchorClusters, minVolUsd: lto?.minVolUsd, total: rows.length };
}

/* -------------------------------------------------------------- 价位/交易 */

export function fmtPx(p, px) {
  const d = px >= 1000 ? 2 : px >= 100 ? 2 : px >= 1 ? 3 : 5;
  return Number(p).toFixed(d);
}

export function buildLevels({ px, s5, s15, market, liq, walls, atr15, ltoClusters }) {
  const A = atr15 || px * 0.004;
  const dayAuction = market?.auction?.day ?? {};
  const anchorsUp = [];
  const anchorsDown = [];
  const push = (arr, price, tag, w = 3e6) => {
    if (Number.isFinite(price) && price > 0) arr.push({ price, tag, w });
  };

  for (const w of walls?.askAbove?.slice(0, 8) ?? []) push(anchorsUp, w.price, `卖墙$${(w.usd / 1e6).toFixed(1)}M`, w.usd);
  push(anchorsUp, s15?.swings?.high, "15m摆动高");
  push(anchorsUp, s5?.swings?.high, "5m摆动高");
  push(anchorsUp, dayAuction.vah, "日VAH");
  push(anchorsUp, dayAuction.poc, "日POC");
  push(anchorsUp, s15?.weakHigh, "弱高(待扫)");
  for (const l of (liq?.above ?? []).slice(0, 6)) push(anchorsUp, l.price, `空头清算${l.strength ?? ""}`, 2e6);
  for (const c of ltoClusters ?? []) if (c.side === "sell" && c.price > px) push(anchorsUp, c.price, `大额卖挂$${(c.usd / 1e6).toFixed(1)}M`, c.usd);

  for (const w of walls?.bidBelow?.slice(0, 8) ?? []) push(anchorsDown, w.price, `买墙$${(w.usd / 1e6).toFixed(1)}M`, w.usd);
  push(anchorsDown, s15?.swings?.low, "15m摆动低");
  push(anchorsDown, s5?.swings?.low, "5m摆动低");
  push(anchorsDown, dayAuction.val, "日VAL");
  push(anchorsDown, dayAuction.poc, "日POC");
  push(anchorsDown, s15?.weakLow, "弱低(待扫)");
  for (const l of (liq?.below ?? []).slice(0, 6)) push(anchorsDown, l.price, `多头清算${l.strength ?? ""}`, 2e6);
  for (const c of ltoClusters ?? []) if (c.side === "buy" && c.price < px) push(anchorsDown, c.price, `大额买挂$${(c.usd / 1e6).toFixed(1)}M`, c.usd);

  const pickAnchor = (list, side) => {
    const near = list.filter((a) => (side === "up" ? a.price <= px * 1.008 : a.price >= px * 0.992)).slice(0, 8);
    if (!near.length) return null;
    return [...near].sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || Math.abs(a.price - px) - Math.abs(b.price - px))[0];
  };

  const above = anchorsUp.filter((a) => a.price > px * 1.0004).sort((a, b) => a.price - b.price);
  const below = anchorsDown.filter((a) => a.price < px * 0.9996).sort((a, b) => b.price - a.price);

  // ---- 做空 ----
  const shortEntryAnchor = pickAnchor(above, "up") ?? { price: px + 0.45 * A, tag: "0.45ATR" };
  const shortEntry = shortEntryAnchor.price;
  const askWallAboveEntry = (walls?.askAbove ?? []).find((w) => w.price >= shortEntry && w.price <= shortEntry + 1.2 * A);
  const swingAboveEntry = above.find((a) => a.price > shortEntry && a.tag.includes("摆动高"));
  const shortInvalidation = Math.max(
    askWallAboveEntry ? askWallAboveEntry.price + 0.25 * A : 0,
    swingAboveEntry ? swingAboveEntry.price + 0.2 * A : 0
  );
  const shortStop = Math.min(Math.max(shortEntry + 0.55 * A, shortInvalidation, shortEntry * 1.0035), shortEntry + 1.3 * A);
  const shortRisk = shortStop - shortEntry;
  const shortTp1 = below.find((a) => a.price <= shortEntry && (shortEntry - a.price) / shortRisk >= 1.1) ?? { price: shortEntry - 1.2 * A, tag: "1.2ATR" };
  const shortTp2 = below.find((a) => a.price <= shortTp1.price - 0.7 * shortRisk) ?? {
    price: shortEntry - Math.max(2 * shortRisk, shortRisk + 0.5 * A),
    tag: "2R",
  };

  // ---- 做多 ----
  const longEntryAnchor = pickAnchor(below, "down") ?? { price: px - 0.45 * A, tag: "0.45ATR" };
  const longEntry = longEntryAnchor.price;
  const bidWallBelowEntry = (walls?.bidBelow ?? []).find((w) => w.price <= longEntry && w.price >= longEntry - 1.2 * A);
  const swingBelowEntry = below.find((a) => a.price < longEntry && a.tag.includes("摆动低"));
  const longInvalidation = Math.min(
    bidWallBelowEntry ? bidWallBelowEntry.price - 0.25 * A : Infinity,
    swingBelowEntry ? swingBelowEntry.price - 0.2 * A : Infinity
  );
  const longStop = Math.max(Math.min(longEntry - 0.55 * A, longInvalidation, longEntry * 0.9965), longEntry - 1.3 * A);
  const longRisk = longEntry - longStop;
  const longTp1 = above.find((a) => a.price >= longEntry && (a.price - longEntry) / longRisk >= 1.1) ?? { price: longEntry + 1.2 * A, tag: "1.2ATR" };
  const longTp2 = above.find((a) => a.price >= longTp1.price + 0.7 * longRisk) ?? {
    price: longEntry + Math.max(2 * longRisk, longRisk + 0.5 * A),
    tag: "2R",
  };

  return {
    atr: A,
    short: {
      entry: shortEntry,
      entryTag: shortEntryAnchor.tag,
      stop: shortStop,
      tp1: shortTp1.price,
      tp1Tag: shortTp1.tag,
      tp2: shortTp2.price,
      tp2Tag: shortTp2.tag,
      riskPct: (shortRisk / shortEntry) * 100,
      rr1: shortRisk > 0 ? (shortEntry - shortTp1.price) / shortRisk : 0,
      rr2: shortRisk > 0 ? (shortEntry - shortTp2.price) / shortRisk : 0,
    },
    long: {
      entry: longEntry,
      entryTag: longEntryAnchor.tag,
      stop: longStop,
      tp1: longTp1.price,
      tp1Tag: longTp1.tag,
      tp2: longTp2.price,
      tp2Tag: longTp2.tag,
      riskPct: (longRisk / longEntry) * 100,
      rr1: longRisk > 0 ? (longTp1.price - longEntry) / longRisk : 0,
      rr2: longRisk > 0 ? (longTp2.price - longEntry) / longRisk : 0,
    },
  };
}

/* --------------------------------------------------------- 汇总 / 卡面 */

/** 把 5 个因子合成 AI 入场概率 + 建议 + 结论（与终端模板逐字一致）。 */
export function buildCard({ sym, px, s5, s15, cvd, taker, oi, walls, depth1, whales, levels }) {
  const total = s5.score + s15.score + cvd.score + taker.score + oi.score;
  const m = total / 100;
  const W = [30, 30, 15, 15, 10];
  const parts = [s5.score, s15.score, cvd.score, taker.score, oi.score];
  const dirSign = Math.sign(total);
  const agreeW = parts.reduce((a, v, i) => a + (Math.sign(v) === dirSign && v !== 0 ? W[i] : 0), 0);
  const A = total === 0 ? 0 : agreeW / 100;
  const prob = clamp(Math.round(100 * Math.pow(Math.abs(m), 0.6) * (0.75 + 0.25 * A)), 0, 100);
  const bias = total > 0 ? "long" : total < 0 ? "short" : "flat";
  const agree = parts.filter((v) => Math.sign(v) === dirSign && v !== 0).length;
  const aligned = Math.sign(s5.score) === Math.sign(s15.score) && s5.score !== 0 && s15.score !== 0;

  let status;
  let statusLine;
  if (prob >= 58 && bias !== "flat" && aligned) {
    status = bias === "short" ? "short" : "long";
    statusLine =
      bias === "short"
        ? `🟥 做空（概率${prob}%，${agree}/5 因子同向，15m/5m 结构共振）`
        : `🟩 做多（概率${prob}%，${agree}/5 因子同向，15m/5m 结构共振）`;
    if (agree < 3) {
      statusLine = `🔴 观望（概率${prob}% 但仅 ${agree}/5 因子同向，信号不纯）`;
      status = "wait";
    }
  } else if (prob >= 52) {
    status = "wait";
    statusLine = `🔴 观望（概率${prob}%，${bias === "short" ? "偏空" : bias === "long" ? "偏多" : "中性"}，等${
      bias === "short" ? "15m 破位/反抽卖墙确认" : "15m 站稳/回踩买墙确认"
    }）`;
  } else {
    status = "wait";
    statusLine = `🔴 观望（多空因子互抵，概率仅${prob}%，等结构/订单流给出方向）`;
  }

  const trendWord =
    aligned && bias === "short"
      ? "空头共振"
      : aligned && bias === "long"
      ? "多头共振"
      : bias === "short"
      ? "震荡偏空"
      : bias === "long"
      ? "震荡偏多"
      : "震荡整理";

  const L = levels;
  const biasWord = bias === "short" ? "偏空" : bias === "long" ? "偏多" : "中性";
  const structWord = aligned ? (bias === "short" ? "5m/15m 空头共振" : "5m/15m 多头共振") : "5m 与 15m 结构分歧";
  const flowWord = taker.score < -3 ? "主动卖压主导" : taker.score > 3 ? "主动买盘主导" : "主动流均衡";
  const oiWord = oi.missing ? "" : `，OI ${oi.regime}`;
  const rsiWarn =
    bias === "short" && s5.rsi <= 32
      ? `（5m RSI ${Math.round(s5.rsi)} 超卖，勿追空）`
      : bias === "long" && s5.rsi >= 68
      ? `（5m RSI ${Math.round(s5.rsi)} 超买，勿追多）`
      : "";
  const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const wallNote =
    bias === "short" && (depth1?.imb ?? 0) > 0.1
      ? `；但±1% 买墙偏厚（${pct(depth1.imb)}），空单防插针`
      : bias === "long" && (depth1?.imb ?? 0) < -0.1
      ? `；但±1% 卖墙偏厚（${pct(depth1.imb)}），多单防假突破`
      : "";
  const concl =
    `${biasWord}（${prob}%）｜${structWord}，${flowWord}${oiWord}${rsiWarn}${wallNote}；` +
    (status === "short"
      ? `若反抽 ${fmtPx(L.short.entry, px)} 附近被卖墙压回可空，止损 ${fmtPx(L.short.stop, px)}，目标 ${fmtPx(L.short.tp1, px)}→${fmtPx(L.short.tp2, px)}；`
      : status === "long"
      ? `回踩 ${fmtPx(L.long.entry, px)} 有买墙承接可多，止损 ${fmtPx(L.long.stop, px)}，目标 ${fmtPx(L.long.tp1, px)}→${fmtPx(L.long.tp2, px)}；`
      : `暂不入场，等${bias === "short" ? `反抽 ${fmtPx(L.short.entry, px)} 遇阻` : `回踩 ${fmtPx(L.long.entry, px)} 承接`}再动；`) +
    `上方近端阻力 ${walls?.nearestAsk ? fmtPx(walls.nearestAsk.price, px) : "—"}，下方近端支撑 ${walls?.nearestBid ? fmtPx(walls.nearestBid.price, px) : "—"}。`;

  return {
    prob,
    total,
    bias,
    trend: trendWord,
    agree,
    status,
    statusLine,
    conclusion: concl,
    factors: [
      { key: "s5", label: "5m结构", weight: 30, score: s5.score, parts: s5.parts, note: s5.note, zone: s5.zone, rsi: s5.rsi },
      { key: "s15", label: "15m结构", weight: 30, score: s15.score, parts: s15.parts, note: s15.note, zone: s15.zone, rsi: s15.rsi },
      { key: "cvd", label: "CVD", weight: 15, score: cvd.score, parts: cvd.parts, missing: cvd.missing, buyRatio: cvd.buyRatio, quadrant: cvd.quadrant },
      { key: "taker", label: "Taker", weight: 15, score: taker.score, missing: taker.missing, ratio: taker.ratio },
      { key: "oi", label: "OI", weight: 10, score: oi.score, missing: oi.missing, regime: oi.regime, dOiPct: oi.dOiPct },
    ],
  };
}

/* ------------------------------------------------- 成交量剖面 (auction) */

export function volumeProfile(candles, binCount = 60) {
  const bars = candles.filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l) && c.v > 0);
  const empty = { poc: null, vah: null, val: null, high: null, low: null, volume: 0, bins: 0 };
  if (bars.length < 2) return empty;
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of bars) {
    if (c.h > hi) hi = c.h;
    if (c.l < lo) lo = c.l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return empty;
  const n = Math.max(10, Math.min(binCount, 240));
  const step = (hi - lo) / n;
  const bins = new Float64Array(n);
  for (const c of bars) {
    const a = Math.max(0, Math.floor((c.l - lo) / step));
    const b = Math.min(n - 1, Math.floor((c.h - lo) / step));
    const span = b - a + 1;
    if (span <= 0) continue;
    const per = c.v / span;
    for (let i = a; i <= b; i++) bins[i] += per;
  }
  let pocIdx = 0;
  for (let i = 1; i < n; i++) if (bins[i] > bins[pocIdx]) pocIdx = i;
  const total = bins.reduce((s, x) => s + x, 0);
  const target = 0.7 * total;
  let acc = bins[pocIdx];
  let up = pocIdx;
  let dn = pocIdx;
  while (acc < target && (up < n - 1 || dn > 0)) {
    const upVol = up < n - 1 ? bins[up + 1] : -1;
    const dnVol = dn > 0 ? bins[dn - 1] : -1;
    if (upVol >= dnVol && upVol >= 0) {
      up++;
      acc += Math.max(0, upVol);
    } else if (dnVol >= 0) {
      dn--;
      acc += Math.max(0, dnVol);
    } else break;
  }
  const priceOf = (i) => lo + (i + 0.5) * step;
  return { poc: priceOf(pocIdx), vah: priceOf(up), val: priceOf(dn), high: hi, low: lo, volume: total, bins: n };
}

export const utcDayStart = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
