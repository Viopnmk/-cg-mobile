/**
 * Live end-to-end test: runs the REAL Worker module in Node 22 (which has the
 * same fetch / crypto.subtle / DecompressionStream globals) and calls every
 * endpoint against live Coinglass. Nothing is mocked — this is the same code
 * path Cloudflare runs.
 *
 *   node test/live-test.mjs            # all endpoints, ETH
 *   node test/live-test.mjs BTC        # another symbol
 */

import worker from "../src/index.js";

const SYM = (process.argv[2] ?? "ETH").toUpperCase();
let failures = 0;
const rows = [];

function check(name, cond, detail = "") {
  if (cond) {
    rows.push(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    rows.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(path) {
  const t0 = performance.now();
  const res = await worker.fetch(new Request(`https://cg-mobile-api.test${path}`), {}, {});
  const ms = performance.now() - t0;
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body, ms, bytes: text.length, headers: Object.fromEntries(res.headers) };
}

const fmt = (v) => (v == null ? "—" : typeof v === "number" ? (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v.toFixed(v >= 100 ? 2 : 4)) : String(v));

console.log(`\n=== cg-mobile-api live test · ${SYM} · ${new Date().toISOString()}\n`);

/* ---------------------------------------------------------------- health */
{
  const r = await call("/api/health");
  check("health", r.status === 200 && r.body.ok === true, `${r.ms.toFixed(0)}ms`);
  check("CORS header", r.headers["access-control-allow-origin"] === "*");
}
{
  const r = await call("/api/symbols");
  check("symbols", r.status === 200 && r.body.symbols.includes("ETH") && r.body.symbols.includes("XAU"), r.body.symbols?.join(","));
}
{
  const res = await worker.fetch(
    new Request("https://cg-mobile-api.test/api/brief", { method: "OPTIONS" }),
    {},
    {}
  );
  check("OPTIONS preflight", res.status === 204 && res.headers.get("access-control-allow-methods")?.includes("GET"));
}

/* ---------------------------------------------------------------- ticker */
let px = 0;
{
  const r = await call(`/api/ticker?sym=${SYM}`);
  px = r.body.price;
  check("ticker", r.status === 200 && r.body.ok && r.body.price > 0, `price=${fmt(px)} 24h=${r.body.chg24hPct}% ${r.ms.toFixed(0)}ms`);
}

/* ----------------------------------------------------------------- kline */
{
  const r = await call(`/api/kline?sym=${SYM}&itv=m5&limit=60`);
  const bars = r.body.bars ?? [];
  check("kline m5", r.status === 200 && bars.length >= 55, `${bars.length} bars, last=${fmt(bars.at(-1)?.c)} ${r.ms.toFixed(0)}ms`);
  const gaps = bars.filter((b) => !(b.h >= b.l && b.c > 0)).length;
  check("kline sane OHLC", gaps === 0);
}

/* ------------------------------------------------------------- footprint */
{
  const r = await call(`/api/fp?sym=${SYM}&itv=m15&limit=64`);
  const b = r.body;
  const fpBars = (b.bars ?? []).filter((x) => x.fp?.b?.length);
  check("footprint", r.status === 200 && b.ok && fpBars.length >= 20, `${fpBars.length}/${(b.bars ?? []).length} bars with buckets · venues=${(b.venues ?? []).join("+")} missing=${(b.missing ?? []).join(",") || "none"} ${r.ms.toFixed(0)}ms`);
  const one = fpBars.at(-1)?.fp;
  check("footprint rows", !!one && one.b.length > 3 && one.tick > 0, `tick=${one?.tick} rows=${one?.b.length} lo=${one?.lo} buy=${one?.b.reduce((a, x) => a + x, 0).toFixed(1)} sell=${one?.s.reduce((a, x) => a + x, 0).toFixed(1)}`);
}

/* ------------------------------------------------------------------- cvd */
{
  const r = await call(`/api/cvd?sym=${SYM}&itv=m15&limit=150`);
  const k = r.body.kpis;
  check("cvd", r.status === 200 && r.body.ok && r.body.n > 100, `n=${r.body.n} perpCvd=${fmt(k?.perpCvd)} buyRatio=${k?.buyRatio}% quadrant=${k?.quadrant} ${r.ms.toFixed(0)}ms`);
  check("cvd instruments", (r.body.instruments ?? []).filter((i) => i.ok).length >= 2, (r.body.instruments ?? []).map((i) => `${i.venue}${i.kind === "spot" ? "(spot)" : ""}:${i.ok ? "ok" : "miss"}`).join(" "));
}

/* -------------------------------------------------------------------- oi */
{
  const r = await call(`/api/oi?sym=${SYM}`);
  const a = r.body.aggregate;
  check("oi", r.status === 200 && r.body.ok && a?.oiUsd > 0, `oi=${fmt(a?.oiUsd)} 1h=${a?.oiDelta1hPct}% ${r.ms.toFixed(0)}ms`);
}

/* ---------------------------------------------------------------- market */
{
  const r = await call(`/api/market?sym=${SYM}`);
  const d = r.body.auction?.day;
  check("market auction", r.status === 200 && r.body.ok && d?.poc > 0, `POC=${fmt(d?.poc)} VAH=${fmt(d?.vah)} VAL=${fmt(d?.val)} VWAP=${fmt(r.body.vwap?.vwap)} ${r.ms.toFixed(0)}ms`);
}

/* ----------------------------------------------------------------- walls */
{
  const r = await call(`/api/walls?sym=${SYM}&snapshots=2`);
  const w = r.body;
  check("walls", r.status === 200 && w.ok && w.mid > 0, `mid=${fmt(w.mid)} ±1% 买${fmt(w.depth1?.bidUsd)}/卖${fmt(w.depth1?.askUsd)} 失衡=${(w.depth1?.imb * 100)?.toFixed(1)}% 墙=${w.walls?.length} ${r.ms.toFixed(0)}ms`);
  if (w.walls?.length) console.log(`   top walls: ${w.walls.slice(0, 4).map((x) => `${x.side === "b" ? "买" : "卖"}$${(x.usd / 1e6).toFixed(1)}M@${x.price}`).join(" · ")}`);
}

/* ---------------------------------------------------------------- whales */
{
  const r = await call(`/api/whales?sym=${SYM}`);
  check("whales", r.status === 200 && r.body.ok && r.body.rows.length > 0, `${r.body.rows.length} orders · 1h ${r.body.stats?.h1?.n} · perp=${r.body.stats?.perp} spot=${r.body.stats?.spot} ${r.ms.toFixed(0)}ms`);
  if (r.body.rows?.length) console.log(`   biggest: ${r.body.rows.slice(0, 3).map((o) => `${o.ex} ${o.side === "buy" ? "买" : "卖"}$${(o.usd / 1e6).toFixed(1)}M@${o.price}`).join(" · ")}`);
}

/* ------------------------------------------------------------------- liq */
{
  const r = await call(`/api/liq?sym=${SYM}&limit=300`);
  check("liq levels", r.status === 200 && r.body.ok && r.body.above.length + r.body.below.length > 0, `above=${(r.body.above ?? []).length} below=${(r.body.below ?? []).length} ${r.ms.toFixed(0)}ms`);
}

/* ----------------------------------------------------------------- brief */
{
  const r = await call(`/api/brief?sym=${SYM}`);
  const b = r.body;
  const card = b.card ?? {};
  check("brief", r.status === 200 && b.ok === true, `${r.bytes} bytes ${r.ms.toFixed(0)}ms errors=[${(b.errors ?? []).map((e) => e.panel).join(",")}]`);
  check("brief price", b.price > 0, `${fmt(b.price)} (${b.chg24hPct}% 24h)`);
  check("card probability", card.prob >= 0 && card.prob <= 100, `prob=${card.prob}% total=${card.total} bias=${card.bias} trend=${card.trend} agree=${card.agree}/5`);
  check("card 5 factors", (card.factors ?? []).length === 5, (card.factors ?? []).map((f) => `${f.label}(${f.weight}%):${f.score}`).join(" | "));
  check("levels", !!b.levels?.long && !!b.levels?.short, `空 ${fmt(b.levels?.short?.entry)}/${fmt(b.levels?.short?.stop)} TP ${fmt(b.levels?.short?.tp1)}→${fmt(b.levels?.short?.tp2)} | 多 ${fmt(b.levels?.long?.entry)}/${fmt(b.levels?.long?.stop)} TP ${fmt(b.levels?.long?.tp1)}`);
  check("footprint signals", typeof b.fp?.line === "string" && b.fp.line.includes("足迹信号"), b.fp?.line);
  check("walls in brief", !!b.walls?.depth1, `±1% 失衡 ${(b.walls?.depth1?.imb * 100)?.toFixed(1)}% · 墙 ${b.walls?.wallCount}`);
  check("whales in brief", b.whales?.h1 != null, `1h ${b.whales?.h1?.n} 笔 买${fmt(b.whales?.h1?.buy)}/卖${fmt(b.whales?.h1?.sell)}`);
  check("oi in brief", b.oi?.aggregate?.oiUsd > 0, `1h ${b.oi?.aggregate?.oiDelta1hPct}%`);
  check("bars for chart", (b.bars5 ?? []).length >= 55 && (b.bars15 ?? []).length >= 90, `5m=${(b.bars5 ?? []).length} 15m=${(b.bars15 ?? []).length}`);

  console.log("\n──── 终端同款卡片（Worker 实时数据） ────");
  console.log(`${b.sym}USDT ${fmt(b.price)} | 趋势: ${card.trend} | 24h ${b.chg24hPct}%`);
  console.log(`AI入场概率：${card.prob}%`);
  console.log(`→ ${(card.factors ?? []).map((f) => `${f.label}(${f.weight}%):${f.score > 0 ? "+" : ""}${f.score}`).join(" | ")}`);
  console.log(`建议：${card.statusLine}`);
  const L = b.levels ?? {};
  console.log(`🟥 做空:入场${fmt(L.short?.entry)} 止损${fmt(L.short?.stop)} TP1:${fmt(L.short?.tp1)} TP2:${fmt(L.short?.tp2)}`);
  console.log(`🟩 做多:入场${fmt(L.long?.entry)} 止损${fmt(L.long?.stop)} TP:${fmt(L.long?.tp1)}`);
  console.log(b.fp?.line);
  console.log(`📌 结论:${card.conclusion}`);

  // cached second hit
  const r2 = await call(`/api/brief?sym=${SYM}`);
  check("brief cache", r2.headers["x-brief-cache"] === "hit", `${r2.ms.toFixed(0)}ms vs ${r.ms.toFixed(0)}ms`);
}

console.log("\n──── assertions ────");
for (const line of rows) console.log(line);
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL LIVE TESTS PASS");
process.exit(failures ? 1 : 0);
