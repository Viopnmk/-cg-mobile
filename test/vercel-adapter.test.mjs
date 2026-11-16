/**
 * Vercel adapter test WITHOUT Vercel: mocks Node's (req, res) pair and calls the
 * real api/[route].js handler, which runs the real worker/src/index.js against
 * LIVE Coinglass. Same code path AWS Lambda runs, so a pass here means the
 * deployed function returns real data.
 *
 *   node test/vercel-adapter.test.mjs            # ETH
 *   node test/vercel-adapter.test.mjs BTC
 */

import dynamicHandler from "../api/[route].js";
import explicitBrief from "../api/brief.js";
import explicitHealth from "../api/health.js";

const SYM = (process.argv[2] ?? "ETH").toUpperCase();
const HOST = "cg-mobile-demo.vercel.app";

let failures = 0;
const rows = [];

function check(name, cond, detail = "") {
  if (cond) rows.push(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    rows.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Minimal IncomingMessage: headers + async-iterable body. */
class MockReq {
  constructor(path, { method = "GET", body = null, headers = {}, routeParam = true } = {}) {
    this.url = path;
    // Vercel fills req.query with the dynamic segment plus the URL's params
    const m = /^\/api(?:\/([^/?#]+))?(?:\?(.*))?$/.exec(path);
    this.query = {};
    if (m && m[1] && routeParam) this.query.route = decodeURIComponent(m[1]);
    for (const [k, v] of new URLSearchParams(m && m[2] ? m[2] : "")) this.query[k] = v;
    this.method = method;
    this.headers = {
      host: HOST,
      "x-forwarded-host": HOST,
      "x-forwarded-proto": "https",
      "user-agent": "vercel-adapter-test",
      ...headers,
    };
    this._body = body == null ? [] : [Buffer.from(body)];
  }
  async *[Symbol.asyncIterator]() {
    for (const c of this._body) yield c;
  }
}

/** Minimal ServerResponse: records what the function wrote. */
class MockRes {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.headersSent = false;
    this.body = Buffer.alloc(0);
    this.finished = false;
  }
  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
  }
  getHeader(k) {
    return this.headers[k.toLowerCase()];
  }
  end(buf) {
    this.headersSent = true;
    this.finished = true;
    if (buf) this.body = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
  json() {
    try {
      return JSON.parse(this.body.toString("utf8"));
    } catch {
      return null;
    }
  }
}

async function call(path, opts, entry = dynamicHandler) {
  const req = new MockReq(path, opts);
  const res = new MockRes();
  const t0 = performance.now();
  await entry(req, res);
  const ms = performance.now() - t0;
  return { status: res.statusCode, headers: res.headers, body: res.json(), raw: res.body.toString("utf8"), ms };
}

console.log(`\n=== cg-mobile Vercel adapter test · ${SYM} · ${new Date().toISOString()}\n`);

/* --------------------------------------------------------------- health */
{
  const r = await call("/api/health");
  check("health 200", r.status === 200, `${r.ms.toFixed(0)}ms`);
  check("health payload", r.body?.ok === true && r.body?.name === "cg-mobile-api", JSON.stringify(r.body?.version));
  check("CORS *", r.headers["access-control-allow-origin"] === "*");
  check("json content-type", String(r.headers["content-type"]).includes("application/json"));
  check("content-length set", Number(r.headers["content-length"]) === r.raw.length);
}

/* ------------------------------------------------------------ preflight */
{
  const r = await call("/api/brief", { method: "OPTIONS" });
  check("OPTIONS 204", r.status === 204, `${r.ms.toFixed(0)}ms`);
  check("preflight methods", String(r.headers["access-control-allow-methods"]).includes("GET"));
}

/* ------------------------------------------------------- errors / routes */
{
  const r = await call("/api/nope");
  check("unknown route 404", r.status === 404 && r.body?.ok === false);
  const b = await call("/api/brief?sym=ZZZ");
  check("bad symbol 400", b.status === 400 && /unsupported symbol/.test(b.body?.error ?? ""));
}

/* ------------------------------------------------------- THE BIG ONE */
{
  const r = await call(`/api/brief?sym=${SYM}`);
  const b = r.body ?? {};
  check("brief 200", r.status === 200 && b.ok === true, `${r.ms.toFixed(0)}ms · ${r.raw.length} bytes`);

  // real market data, not a placeholder
  check("price is a live number", typeof b.price === "number" && b.price > 0, String(b.price));
  check("symbol echoed", b.sym === SYM);
  check("5m/15m card present", !!b.card && typeof b.card.prob === "number", `${b.card?.statusLine ?? "—"} · ${b.card?.prob ?? "—"}%`);
  check("card has 5 factors", Array.isArray(b.card?.factors) && b.card.factors.length === 5);
  check("5m bars", Array.isArray(b.bars5) && b.bars5.length > 10, `${b.bars5?.length ?? 0} bars`);
  check("15m bars", Array.isArray(b.bars15) && b.bars15.length > 10, `${b.bars15?.length ?? 0} bars`);
  check("footprint panel", !!b.fp, `${b.fp?.venues?.length ?? 0} venues`);
  check("orderbook walls", !!b.walls, `${b.walls?.mid ? "mid " + b.walls.mid : ""} ${b.walls?.venues?.length ?? 0} venues`);
  {
    const ev = b.walls?.events ?? [];
    const kinds = new Set(ev.map((e) => e.type));
    const okType = [...kinds].every((k) => ["added", "pulled", "eaten"].includes(k));
    const okRow = ev.every(
      (e) => ["b", "a"].includes(e.side) && e.price > 0 && e.usd > 0 && e.t > 0
    );
    check(
      "wall events (大墙异动)",
      ev.length > 0 && ev.length <= 12 && okType && okRow,
      `${ev.length} events · ${["added", "eaten", "pulled"].map((k) => `${k} ${(b.walls?.eventCounts ?? {})[k] ?? 0}`).join(" / ")} · total ${b.walls?.eventTotal ?? 0}`
    );
    check(
      "wall events window",
      !!b.walls?.eventWindow && b.walls.eventWindow.snapshots >= 6 && b.walls.eventWindow.to > b.walls.eventWindow.from,
      b.walls?.eventWindow
        ? `${b.walls.eventWindow.snapshots} snapshots · ${Math.round((b.walls.eventWindow.to - b.walls.eventWindow.from) / 3600000)}h · min $${Math.round(b.walls.eventWindow.minUsd / 1e3)}k`
        : "—"
    );
    const sorted = ev.every((e, i) => i === 0 || ev[i - 1].t >= e.t);
    check("wall events newest first", sorted);
  }
  check("levels (entry/stop)", !!b.levels && !!b.levels.long && !!b.levels.short, `ATR ${b.levels?.atr ?? "—"}`);
  check("whales panel", (b.whales?.h24?.n ?? 0) > 0 && (b.whales?.biggest?.length ?? 0) > 0, `24h ${b.whales?.h24?.n ?? 0} orders · net ${b.whales?.h24?.net ?? "—"} · top ${b.whales?.biggest?.[0]?.ex ?? "—"}`);
  check("liquidation panel", (b.liq?.above?.length ?? 0) + (b.liq?.below?.length ?? 0) > 0, `${(b.liq?.above?.length ?? 0) + (b.liq?.below?.length ?? 0)} levels (${b.liq?.above?.[0]?.price ?? "—"}↑ / ${b.liq?.below?.[0]?.price ?? "—"}↓)`);
  check("no panel errors", (b.errors ?? []).length === 0, (b.errors ?? []).map((e) => e.panel).join(",") || "none");
  check("builtAt timestamp", typeof (b.updatedAt ?? b.builtAt ?? b.fetchedAt) === "number");
  check("under 60s maxDuration", r.ms < 55000, `${(r.ms / 1000).toFixed(1)}s`);
}

/* --------------------------------------------------- live /api/walls */
{
  const r = await call(`/api/walls?sym=${SYM}&band=5`);
  const b = r.body ?? {};
  check(
    "/api/walls 200 + events",
    r.status === 200 && b.ok === true && (b.events?.length ?? 0) > 0,
    `${r.ms.toFixed(0)}ms · ${r.raw.length} bytes · ${b.events?.length ?? 0} events · venues ${(b.venues ?? []).length}`
  );
  check("/api/walls has depth + walls", !!b.depth1 && !!b.depth5 && (b.walls?.length ?? 0) > 0, `walls ${b.walls?.length ?? 0}`);
}

/* --------------------------------------------------- a second endpoint */
{
  const r = await call(`/api/ticker?sym=${SYM}`);
  check("ticker 200", r.status === 200 && r.body?.ok === true, `${r.body?.price}`);
}

/* ------------------------------- explicit entry files (brief / health) */
{
  // these two were matched by a static filename, so Vercel leaves req.query.route
  // unset: the adapter must recover /api/brief from req.url alone.
  const b = await call(`/api/brief?sym=${SYM}`, { routeParam: false }, explicitBrief);
  check("api/brief.js entry (no route param)", b.status === 200 && b.body?.ok === true, `${b.status} · ${b.body?.price}`);
  const h = await call("/api/health", { routeParam: false }, explicitHealth);
  check("api/health.js entry", h.status === 200 && h.body?.name === "cg-mobile-api");
}

/* ------------------------------------------------ host header forwarded */
{
  const r = await call("/api/health", { headers: { host: "foo.example.com", "x-forwarded-host": "cg-mobile-x.vercel.app" } });
  check("adapter tolerates host headers", r.status === 200);
}

console.log(rows.join("\n"));
console.log(`\n${failures ? `✗ ${failures} check(s) failed` : "✓ all checks passed"} (${rows.length} checks)\n`);
process.exit(failures ? 1 : 0);
