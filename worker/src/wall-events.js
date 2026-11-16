/**
 * Book-wall events —直译自 cg-terminal/src/lib/cg/book-walls.ts 的 WallScanner
 * （Coinglass /LiquidityHeatmap 页面引擎）：
 *
 *   decodeBookRow()  stream 行 [ts, bids[[p,q]], asks[[p,q]]] → 快照
 *                    { t, g(格宽), k0(最小桶), q(每桶数量), bb, ba, mid }
 *   rebinInto()      把快照重新分桶到目标格宽
 *   WallScanner      挂单墙探测器：±3% 内，阈值
 *                    thr = max(minUsd, min(6 × median(±1% 墙), max(top4, 1.5 × median)))，
 *                    连续 confirm 次扫描才「确认」（历史 = 2），
 *                    消失后按「价格是否被碰过」区分 被吃(fill) / 撤单(pull)。
 *
 * 这里只做「大墙异动」这一件事：吃多份历史快照（默认 40 根 15m ≈ 10 小时），
 * 输出最近的加挂 / 撤单 / 被吃事件，条数由调用方限死（默认 12 条），
 * 这样 JSON 不会因为历史快照而膨胀。
 */

/** ev(): 解一行 stream 数据。size = meta.size 格宽。 */
export function decodeBookRow(row, size) {
  if (!Array.isArray(row) || !(size > 0)) return null;
  const bids = Array.isArray(row[1]) ? row[1] : [];
  const asks = Array.isArray(row[2]) ? row[2] : [];
  let ba = Infinity;
  for (const a of asks) {
    const p = +a[0];
    if (+a[1] > 0 && p < ba) ba = p;
  }
  let bb = -Infinity;
  for (const b of bids) {
    const p = +b[0];
    if (+b[1] > 0 && p > bb && p < ba) bb = p;
  }
  if (!(bb > 0) && ba === Infinity) return null;
  if (!(bb > 0)) bb = ba - size;
  if (ba === Infinity) ba = bb + size;

  let kMin = Infinity;
  let kMax = -Infinity;
  const flat = [];
  for (const b of bids) {
    const p = +b[0];
    const q = +b[1];
    if (!(q > 0) || p > bb) continue;
    const k = Math.round(p / size);
    flat.push(k, q);
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  for (const a of asks) {
    const p = +a[0];
    const q = +a[1];
    if (!(q > 0) || p < ba) continue;
    const k = Math.round(p / size);
    flat.push(k, q);
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  if (!flat.length) return null;
  const q = new Float64Array(kMax - kMin + 1);
  for (let i = 0; i < flat.length; i += 2) q[flat[i] - kMin] += flat[i + 1];
  return { t: 1000 * Number(row[0]), g: size, k0: kMin, q, bb, ba, mid: (bb + ba) / 2 };
}

/** ek(): 把快照重新分桶到 [n, n+count)，写进 out（复用）。 */
export function rebinInto(s, grid, n, count, out) {
  out.fill(0, 0, count);
  if (!s || !s.q) return;
  const sGrid = s.g;
  if (sGrid <= 1.0000001 * grid) {
    const h = grid / sGrid;
    const lo = Math.max(s.k0, Math.floor(n * h + 1e-9));
    const hi = Math.min(s.k0 + s.q.length - 1, Math.ceil((n + count) * h) - 1);
    for (let k = lo; k <= hi; k++) {
      const v = s.q[k - s.k0];
      if (v > 0) {
        const idx = Math.floor(k / h + 1e-9) - n;
        if (idx >= 0 && idx < count) out[idx] += v;
      }
    }
  } else {
    const h = grid / sGrid;
    for (let i = 0; i < count; i++) {
      const src = Math.floor((n + i) * h + 1e-9);
      const idx = src - s.k0;
      if (idx >= 0 && idx < s.q.length) out[i] += s.q[idx] * h;
    }
  }
}

const SCRATCH = new Float64Array(30000);

/** eH：原版挂单墙探测器。事件类型沿用原版 add/fill/pull。 */
export class WallScanner {
  constructor() {
    this.st = new Map();
    this.events = [];
  }

  current() {
    return [...this.st.values()].filter((w) => w.shown).sort((a, b) => b.usd - a.usd);
  }

  scan(s, isLive, grid, minUsd, range) {
    if (!(grid > 0) || !s) return;
    const r = s.mid;
    const n = Math.floor((0.97 * r) / grid);
    const count = Math.ceil((1.03 * r) / grid) - n + 1;
    if (count > SCRATCH.length || count < 3) return;
    rebinInto(s, grid, n, count, SCRATCH);

    // 阈值：±1% 内各桶 USD 的中位数 × 6，且不超过 max(top4, 1.5×median)
    const near = [];
    const top4 = [0, 0, 0, 0];
    for (let i = 0; i < count; i++) {
      const qty = SCRATCH[i];
      if (!(qty > 0)) continue;
      const price = (n + i + 0.5) * grid;
      const usd = qty * price;
      if (Math.abs(price / r - 1) <= 0.01) near.push(usd);
      if (usd > top4[3]) {
        let e = 3;
        while (e > 0 && usd > top4[e - 1]) {
          top4[e] = top4[e - 1];
          e--;
        }
        top4[e] = usd;
      }
    }
    near.sort((a, b) => a - b);
    const median = near.length ? near[near.length >> 1] : Infinity;
    const c = Math.max(2.5, 6 / Math.sqrt(grid / grid));
    const thr = Math.max(minUsd, Math.min(median * c, Math.max(top4[3], 1.5 * median)));
    const confirm = isLive ? 3 : 2;
    const seen = new Set();
    const [loP, hiP] = range;
    const touched = (w) => (w.side === "b" ? loP < w.p + w.G : hiP >= w.p);

    for (let i = 0; i < count; i++) {
      const qty = SCRATCH[i];
      if (!qty) continue;
      const p = (n + i) * grid;
      const mid = p + grid / 2;
      const usd = qty * mid;
      const side = mid < r ? "b" : "a";
      const key = side + (n + i);
      seen.add(key);
      let w = this.st.get(key);
      if (!(usd >= thr) && !(w && usd >= 0.6 * thr)) continue;
      if (!w) {
        w = { key, side, k: n + i, p, G: grid, first: s.t, last: s.t, cf: 0, miss: 0, peak: 0, usd: 0, qty: 0, shown: false, touch: false };
        this.st.set(key, w);
      }
      w.last = s.t;
      w.cf++;
      w.miss = 0;
      w.usd = usd;
      w.qty = qty;
      if (usd > w.peak) w.peak = usd;
      w.touch = touched(w);
      if (!w.shown && w.cf >= confirm) {
        w.shown = true;
        this.pushEvent({ t: w.first, type: "add", side, p, usd, qty, mid: s.mid });
      }
    }

    for (const [key, w] of this.st) {
      if (seen.has(key)) continue;
      if (w.p < 0.97 * r || w.p > 1.03 * r) {
        this.st.delete(key);
        continue;
      }
      if (touched(w)) w.touch = true;
      if (++w.miss >= confirm) {
        this.st.delete(key);
        if (w.shown) {
          this.pushEvent({
            t: s.t,
            type: w.touch ? "fill" : "pull",
            side: w.side,
            p: w.p,
            usd: w.peak,
            qty: w.qty,
            mid: s.mid,
          });
        }
      }
    }
  }

  pushEvent(e) {
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, this.events.length - 400);
  }
}

/** 事件类型 → 前端/API 用的英文名（加挂 / 撤单 / 被吃） */
const KIND = { add: "added", fill: "eaten", pull: "pulled" };

/**
 * 每份快照的「价格区间」= 上一份快照到这一份之间的 K 线高低 ± 当前买卖一。
 * 墙消失时用这段区间判断是「被吃」（价格真的碰到过）还是「撤单」。
 * 原版只用当前节奏的一根 K 线；这里用更细（如 m5）的 K 线覆盖整个间隔，
 * 判定更准，事件含义不变。
 */
function rangesFromCandles(sorted, candles, candleStepMs) {
  const bars = [...candles].filter((c) => Number.isFinite(c.h) && Number.isFinite(c.l)).sort((a, b) => a.ts - b.ts);
  const out = [];
  let j = 0;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const from = i ? sorted[i - 1].t : s.t;
    if (!bars.length || !(candleStepMs > 0) || from === s.t) {
      out.push([s.bb, s.ba]);
      continue;
    }
    while (j < bars.length && bars[j].ts < from) j++; // skip bars that ended before this window
    let lo = s.bb;
    let hi = s.ba;
    for (let k = j; k < bars.length && bars[k].ts <= s.t - candleStepMs; k++) {
      if (bars[k].l < lo) lo = bars[k].l;
      if (bars[k].h > hi) hi = bars[k].h;
    }
    out.push([lo, hi]);
  }
  return out;
}

/**
 * 用多份历史快照扫出大墙异动。
 *
 * @param snaps   decodeBookRow() 的快照数组（任意顺序）
 * @param opts.minUsd       该币的最小墙 USD
 * @param opts.candles      [{ts,h,l}] K 线，用于「是否被价格碰过」判定
 * @param opts.candleStepMs K 线周期（毫秒，给了才用 candles）
 * @param opts.stepMs       快照间隔（默认 15 分钟）
 * @param opts.limit        返回的最近事件条数上限（默认 12）
 * @param opts.grid         扫描格宽（默认取最后一份快照的 g）
 */
export function scanWallEvents(snaps, { minUsd, candles = [], candleStepMs = 0, stepMs = 900_000, limit = 12, grid } = {}) {
  const sorted = [...snaps].filter(Boolean).sort((a, b) => a.t - b.t);
  if (!sorted.length) return { events: [], window: null, grid: null };
  const g = grid && grid > 0 ? grid : sorted[sorted.length - 1].g;
  const ranges = candleStepMs > 0 ? rangesFromCandles(sorted, candles, candleStepMs) : null;
  const scanner = new WallScanner();
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    scanner.scan(s, false, g, minUsd, ranges ? ranges[i] : [s.bb, s.ba]);
  }

  const last = sorted[sorted.length - 1];
  const dec = last.mid >= 1000 ? 2 : last.mid >= 100 ? 2 : last.mid >= 1 ? 3 : 5;
  const rows = scanner.events
    .map((e) => ({
      t: e.t,
      type: KIND[e.type] ?? e.type,
      side: e.side,
      price: +(e.p + g / 2).toFixed(dec),
      usd: Math.round(e.usd),
      qty: +e.qty.toFixed(4),
      mid: +(e.mid ?? last.mid).toFixed(dec + 1),
      distPct: +((((e.p + g / 2) / (e.mid ?? last.mid)) - 1) * 100).toFixed(2),
    }))
    .sort((a, b) => b.t - a.t);

  const counts = { added: 0, pulled: 0, eaten: 0 };
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;

  // 扫描器认下的「当前挂单墙」（连续 confirm 次都在），按金额排序
  const walls = scanner
    .current()
    .map((w) => ({
      side: w.side,
      price: w.p + g / 2,
      usd: Math.round(w.usd),
      qty: +w.qty.toFixed(4),
      distPct: +(((w.p + g / 2) / last.mid - 1) * 100).toFixed(2),
      firstSeen: w.first,
      ageMs: last.t - w.first,
      touched: !!w.touch,
    }))
    .sort((a, b) => b.usd - a.usd);

  return {
    events: rows.slice(0, Math.max(1, Math.min(limit, 40))),
    counts,
    total: rows.length,
    walls,
    window: { from: sorted[0].t, to: last.t, snapshots: sorted.length, minUsd: Math.round(minUsd), grid: g },
  };
}
