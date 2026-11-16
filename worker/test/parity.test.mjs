/**
 * Logic-parity test against the ORIGINAL terminal template.
 *
 * The real functions are lifted out of
 * cg-terminal/scripts/eth-5m15m-template.mjs (everything above `main`) and
 * re-exported, then fed the exact same inputs as this Worker's port
 * (src/signals.js) — bars / cvd / fp / oi / market / walls / liq taken from the
 * live Worker endpoints. Every score and every level must match exactly.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";
import { scoreStructure, scoreCvd, scoreTaker, scoreOi, computeFpSignals, buildLevels, buildCard } from "../src/signals.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const tplPath = path.join(here, "../../../cg-terminal/scripts/eth-5m15m-template.mjs");
const src = fs.readFileSync(tplPath, "utf8");
const cut = src.indexOf("/* ------------------------------------------------------------------- main */");
if (cut < 0) throw new Error("main marker not found");
const body = src.slice(0, cut) +
  "\nexport { scoreStructure, scoreCvd, scoreTaker, computeFpSignals, scoreOi, buildLevels, wallStats, depthBuckets, whaleFlow };\n";
const tmp = path.join("/tmp", `tpl-${process.pid}.mjs`);
fs.writeFileSync(tmp, body);
const T = await import(tmp);

const SYM = (process.argv[2] ?? "ETH").toUpperCase();
async function api(p) {
  const res = await worker.fetch(new Request("https://t" + p), {}, {});
  const b = await res.json();
  if (!b.ok) throw new Error(p + " → " + b.error);
  return b;
}

let fails = 0;
const eq = (name, a, b, tol = 0) => {
  const ok = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= tol : JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? "✓" : "✗"} ${name}: port=${typeof a === "number" ? a.toFixed(4) : JSON.stringify(a).slice(0, 70)} template=${typeof b === "number" ? b.toFixed(4) : JSON.stringify(b).slice(0, 70)}`);
  if (!ok) fails++;
};

console.log(`\n=== parity · ${SYM}\n`);
const [k5, k15, cvd, fp, oi, mkt, walls, brief] = await Promise.all([
  api(`/api/kline?sym=${SYM}&itv=m5&limit=60`),
  api(`/api/kline?sym=${SYM}&itv=m15&limit=96`),
  api(`/api/cvd?sym=${SYM}&itv=m15&limit=150`),
  api(`/api/fp?sym=${SYM}&itv=m15&limit=64`),
  api(`/api/oi?sym=${SYM}`),
  api(`/api/market?sym=${SYM}`),
  api(`/api/walls?sym=${SYM}&snapshots=1`),
  api(`/api/brief?sym=${SYM}`),
]);
const liq = await api(`/api/liq?sym=${SYM}&limit=300`);

const bars5 = k5.bars;
const bars15 = k15.bars;
const px = brief.price;

// --- structure scores
const a5 = scoreStructure(bars5, "5m"), b5 = T.scoreStructure(bars5, "5m");
const a15 = scoreStructure(bars15, "15m"), b15 = T.scoreStructure(bars15, "15m");
eq("5m score", a5.score, b5.score);
eq("5m parts", a5.parts, b5.parts);
eq("5m swings", a5.swings, b5.swings);
eq("5m weak levels", [a5.weakLow, a5.weakHigh], [b5.weakLow, b5.weakHigh]);
eq("15m score", a15.score, b15.score);
eq("15m parts", a15.parts, b15.parts);

// --- cvd / taker / oi
const cvdShape = { kpis: cvd.kpis, delta: cvd.delta, updatedAt: cvd.updatedAt };
eq("cvd score", scoreCvd(cvdShape, cvd.updatedAt).score, T.scoreCvd(cvdShape).score);
eq("cvd parts", scoreCvd(cvdShape, cvd.updatedAt).parts, T.scoreCvd(cvdShape).parts);
eq("taker score", scoreTaker({ bars: fp.bars }).score, T.scoreTaker({ bars: fp.bars }).score);
const px1hAgo = bars15[bars15.length - 5].c;
const px1hPct = ((px - px1hAgo) / px1hAgo) * 100;
const oiA = scoreOi(oi, px1hPct), oiB = T.scoreOi(oi, px1hPct);
eq("oi score", oiA.score, oiB.score);
eq("oi regime", oiA.regime, oiB.regime);

// --- footprint signals
const mine = computeFpSignals(fp.bars);
const theirs = T.computeFpSignals(fp.bars);
eq("fp signals count", mine.length, theirs.length);
eq("fp signals types", mine.map((g) => `${g.i}${g.t}${g.side}`), theirs.map((g) => `${g.i}${g.t}${g.side}`));

// --- walls shape for buildLevels
const bw = { model: { walls: walls.walls, events: [], strip: [], depth: walls.depth5, imbalance: walls.imbalance } };
const market = { auction: { day: mkt.auction.day }, price: { last: px } };
const liqShape = { above: liq.above, below: liq.below };
const aL = buildLevels({ px, s5: a5, s15: a15, market, liq: liqShape, walls: T.wallStats(bw, px), atr15: a15.atr, ltoClusters: [] });
const bL = T.buildLevels({ px, s5: b5, s15: b15, market, liq: liqShape, walls: T.wallStats(bw, px), atr15: b15.atr, ltoClusters: [] });
eq("short entry", aL.short.entry, bL.short.entry);
eq("short stop", aL.short.stop, bL.short.stop);
eq("short tp1/tp2", [aL.short.tp1, aL.short.tp2], [bL.short.tp1, bL.short.tp2]);
eq("long entry", aL.long.entry, bL.long.entry);
eq("long stop", aL.long.stop, bL.long.stop);
eq("long tp1/tp2", [aL.long.tp1, aL.long.tp2], [bL.long.tp1, bL.long.tp2]);

// --- final probability: port's buildCard vs the template's inline formula
const card = buildCard({
  sym: SYM, px, s5: a5, s15: a15,
  cvd: scoreCvd(cvdShape, cvd.updatedAt), taker: scoreTaker({ bars: fp.bars }), oi: oiA,
  walls: T.wallStats(bw, px), depth1: walls.depth1, whales: { anchorClusters: [] }, levels: aL,
});
const total = b5.score + b15.score + T.scoreCvd(cvdShape).score + T.scoreTaker({ bars: fp.bars }).score + oiB.score;
const m = total / 100;
const parts = [b5.score, b15.score, T.scoreCvd(cvdShape).score, T.scoreTaker({ bars: fp.bars }).score, oiB.score];
const W = [30, 30, 15, 15, 10];
const dirSign = Math.sign(total);
const agreeW = parts.reduce((a, v, i) => a + (Math.sign(v) === dirSign && v !== 0 ? W[i] : 0), 0);
const A = total === 0 ? 0 : agreeW / 100;
const prob = Math.max(0, Math.min(100, Math.round(100 * Math.pow(Math.abs(m), 0.6) * (0.75 + 0.25 * A))));
eq("total", card.total, total);
eq("probability", card.prob, prob);
eq("status", card.status, prob >= 58 && dirSign !== 0 && Math.sign(b5.score) === Math.sign(b15.score) ? (dirSign > 0 ? "long" : "short") : "wait");

// --- brief vs the card computed on the same live payload
eq("brief prob (different snapshot ok ±1)", brief.card.prob, prob, 2);

console.log(fails ? `\n${fails} MISMATCH(ES)` : "\nPARITY OK — port matches the terminal template exactly");
fs.unlinkSync(tmp);
process.exit(fails ? 1 : 0);
