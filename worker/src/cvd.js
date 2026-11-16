/**
 * CVD engine — faithful port of cg-terminal/src/lib/cg/cvd.ts
 * (FlowGrid / recompute / detectDivergences / cvdKpis), which is itself a
 * 1:1 port of the Coinglass /cvd page bundle. Instruments: the highest-volume
 * perp per venue from a fixed venue set (Binance, OKX, Bybit, Bitget) — the
 * per-venue discovery call is skipped in the Worker to stay inside the
 * subrequest budget; rows come from /api/v2/kline <key>#bs_usd.
 */

export class FlowGrid {
  constructor(step, keys) {
    this.step = step;
    this.keys = keys;
    this.n = 0;
    this.T = [];
    this.O = [];
    this.H = [];
    this.L = [];
    this.C = [];
    this.idx = new Map();
    this.flows = [];
  }

  setCandles(rows) {
    for (const r of rows) {
      const t = 1000 * Number(r[0]);
      this.T.push(t);
      this.O.push(+r[1]);
      this.H.push(+r[2]);
      this.L.push(+r[3]);
      this.C.push(+r[4]);
      this.idx.set(t, this.n);
      this.n++;
    }
  }

  mergeFlow(i, rows) {
    if (!this.flows[i]) this.flows[i] = new Float64Array(this.n * 2);
    const arr = this.flows[i];
    for (const r of rows) {
      const k = this.idx.get(r.t);
      if (k == null || k * 2 + 1 >= arr.length) continue;
      arr[k * 2] = r.b;
      arr[k * 2 + 1] = r.s;
    }
  }

  getFlow(i) {
    const n = this.n;
    const b = new Float64Array(n);
    const s = new Float64Array(n);
    const arr = this.flows[i];
    if (arr) {
      for (let k = 0; k < n; k++) {
        b[k] = arr[k * 2] ?? 0;
        s[k] = arr[k * 2 + 1] ?? 0;
      }
    }
    return { b, s };
  }
}

export function flowRows(raw) {
  return raw
    .map((r) => ({ t: 1000 * Number(r[0]), b: Number(r[1]) || 0, s: Number(r[2]) || 0 }))
    .filter((r) => Number.isFinite(r.t));
}

export function recompute(grid, inst) {
  const n = grid.n;
  if (!n) return null;
  const perpIdx = [];
  const spotIdx = [];
  inst.forEach((v, i) => (v.kind === "perp" ? perpIdx : spotIdx).push(i));
  const flows = inst.map((_, i) => grid.getFlow(i));

  const pB = new Float64Array(n);
  const pS = new Float64Array(n);
  const sB = new Float64Array(n);
  const sS = new Float64Array(n);
  for (let e = 0; e < n; e++) {
    for (const i of perpIdx) {
      pB[e] += flows[i].b[e];
      pS[e] += flows[i].s[e];
    }
    for (const i of spotIdx) {
      sB[e] += flows[i].b[e];
      sS[e] += flows[i].s[e];
    }
  }
  const perp = new Float64Array(n + 1);
  const spot = new Float64Array(n + 1);
  const total = new Float64Array(n + 1);
  const delta = new Float64Array(n);
  const ratio = new Float64Array(n);
  for (let e = 0; e < n; e++) {
    perp[e + 1] = perp[e] + pB[e] - pS[e];
    spot[e + 1] = spot[e] + sB[e] - sS[e];
    total[e + 1] = perp[e + 1] + spot[e + 1];
    delta[e] = pB[e] + sB[e] - pS[e] - sS[e];
    const buy = pB[e] + sB[e];
    const all = buy + pS[e] + sS[e];
    ratio[e] = all > 0 ? buy / all : NaN;
  }
  return { n, ts: grid.T, o: grid.O, h: grid.H, l: grid.L, c: grid.C, pB, pS, sB, sS, perp, spot, total, delta, ratio };
}

export function detectDivergences(s, cvd) {
  const out = [];
  const n = s.n;
  const l = n - 2;
  const swingHighs = [];
  const swingLows = [];
  const H = s.h;
  const L = s.l;
  for (let e = 5; e + 5 <= l; e++) {
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= 5 && (isHigh || isLow); k++) {
      if (H[e - k] >= H[e] || H[e + k] > H[e]) isHigh = false;
      if (L[e - k] <= L[e] || L[e + k] < L[e]) isLow = false;
    }
    if (isHigh) swingHighs.push(e);
    if (isLow) swingLows.push(e);
  }
  const mk = (t, a, b) => {
    const c = b + 5;
    return {
      t,
      a,
      b,
      c,
      ts: s.ts[Math.min(c, n - 1)] ?? s.ts[n - 1],
      priceA: t === "bear" ? H[a] : L[a],
      priceB: t === "bear" ? H[b] : L[b],
      priceC: s.c[Math.min(c, n - 1)] ?? s.c[n - 1],
    };
  };
  for (let i = 1; i < swingHighs.length; i++) {
    const a = swingHighs[i - 1];
    const b = swingHighs[i];
    if (b - a >= 4 && b - a <= 60 && H[b] > H[a] && cvd[b + 1] < cvd[a + 1]) out.push(mk("bear", a, b));
  }
  for (let i = 1; i < swingLows.length; i++) {
    const a = swingLows[i - 1];
    const b = swingLows[i];
    if (b - a >= 4 && b - a <= 60 && L[b] < L[a] && cvd[b + 1] > cvd[a + 1]) out.push(mk("bull", a, b));
  }
  out.sort((x, y) => x.c - y.c);
  for (const d of out) {
    if (d.c + 12 <= n - 2) {
      d.r = s.c[d.c + 12] / s.c[d.c] - 1;
      d.hit = d.t === "bear" ? d.r < 0 : d.r > 0;
    }
  }
  return out;
}

export function cvdKpis(s, scope, divs) {
  const n = s.n;
  let f = 0;
  if (scope === "day") f = Math.max(0, n - Math.ceil(86_400_000 / (s.ts[1] - s.ts[0] || 900_000)));
  if (scope === "week") f = Math.max(0, n - Math.ceil((7 * 86_400_000) / (s.ts[1] - s.ts[0] || 900_000)));
  const v = n - 1;
  let pB = 0;
  let pS = 0;
  let sB = 0;
  let sS = 0;
  for (let e = f; e <= v; e++) {
    pB += s.pB[e];
    pS += s.pS[e];
    sB += s.sB[e];
    sS += s.sS[e];
  }
  const perpCvd = pB - pS;
  const spotCvd = sB - sS;
  const buy = pB + sB;
  const sell = pS + sS;
  const buyRatio = buy + sell > 0 ? buy / (buy + sell) : NaN;
  let quadrant = "partial";
  if (perpCvd >= 0 && spotCvd >= 0) quadrant = "both-buying";
  else if (perpCvd < 0 && spotCvd < 0) quadrant = "both-selling";
  else if (spotCvd >= 0) quadrant = "spot-bid";
  else quadrant = "perp-driven";
  const scored = divs.filter((d) => d.hit !== undefined);
  const lastDiv = divs.length ? divs[divs.length - 1] : null;
  return {
    scope,
    fromBar: f,
    toBar: v,
    perpBuy: pB,
    perpSell: pS,
    spotBuy: sB,
    spotSell: sS,
    perpCvd,
    spotCvd,
    buyRatio,
    quadrant,
    latestDiv: lastDiv,
    hitRate: scored.length ? { hits: scored.filter((d) => d.hit).length, total: scored.length } : null,
  };
}
