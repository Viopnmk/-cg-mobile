/**
 * Footprint aggregation — faithful port of the fp helpers in
 * cg-terminal/src/lib/cg/cg-signals.ts (fpFromBuckets / mergeFp), which are a
 * 1:1 port of the Coinglass footprint page bundle (ea / eT / eu).
 *
 * Data: /api/orderFlow?symbol=<venue key>#order_flow&interval=m15&limit=N
 * rows = [ts, [[lowEdge, highEdge, buyBase, sellBase, ... , buyTx, sellTx]]]
 */

export function fpFromBuckets(buckets) {
  if (!Array.isArray(buckets) || !buckets.length) return null;
  let lo = Infinity;
  let tick = 0;
  for (const bk of buckets) {
    const e = Number(bk[0]);
    const l = Number(bk[1]);
    const a = Math.min(e, l);
    if (a < lo) lo = a;
    if (!tick && Math.abs(l - e) > 0) tick = Math.abs(l - e);
  }
  if (!(tick > 0) || !isFinite(lo)) return null;
  let n = 0;
  const rows = [];
  for (const bk of buckets) {
    const idx = Math.round((Math.min(Number(bk[0]), Number(bk[1])) - lo) / tick);
    if (idx + 1 > n) n = idx + 1;
    rows.push([idx, bk]);
  }
  const b = Array(Math.max(1, n)).fill(0);
  const s = Array(Math.max(1, n)).fill(0);
  const bc = Array(Math.max(1, n)).fill(0);
  const sc = Array(Math.max(1, n)).fill(0);
  for (const [idx, bk] of rows) {
    b[idx] += Number(bk[2]) || 0;
    s[idx] += Number(bk[3]) || 0;
    bc[idx] += Number(bk[8]) || 0;
    sc[idx] += Number(bk[9]) || 0;
  }
  return { tick: +tick.toPrecision(10), lo, b, s, bc, sc };
}

/** Merge several venue footprints onto the coarsest tick grid (their `eu`). */
export function mergeFp(fs) {
  const list = fs.filter((f) => !!f);
  if (!list.length) return null;
  let tick = -Infinity;
  for (const f of list) if (f.tick > tick) tick = f.tick;
  const map = new Map();
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of list) {
    for (let e = 0; e < f.b.length; e++) {
      if (!(f.b[e] || f.s[e])) continue;
      const r = Math.floor((f.lo + (e + 0.5) * f.tick) / tick + 1e-9);
      let cell = map.get(r);
      if (!cell) {
        cell = [0, 0, 0, 0];
        map.set(r, cell);
      }
      cell[0] += f.b[e];
      cell[1] += f.s[e];
      cell[2] += f.bc[e];
      cell[3] += f.sc[e];
      if (r < lo) lo = r;
      if (r > hi) hi = r;
    }
  }
  if (!map.size) return null;
  const len = hi - lo + 1;
  const b = Array(len).fill(0);
  const s = Array(len).fill(0);
  const bc = Array(len).fill(0);
  const sc = Array(len).fill(0);
  for (const [r, cell] of map) {
    const i = r - lo;
    b[i] = cell[0];
    s[i] = cell[1];
    bc[i] = cell[2];
    sc[i] = cell[3];
  }
  return { tick, lo: +(lo * tick).toPrecision(12), b, s, bc, sc };
}
