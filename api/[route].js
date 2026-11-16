/**
 * Vercel Serverless Function adapter — Node.js runtime (AWS Lambda, NOT edge).
 *
 * Why not Edge: Vercel Edge Functions run on Cloudflare's network, and Coinglass
 * blocks those egress IPs. Node.js functions run on AWS Lambda, which Coinglass
 * allows, so the exact same worker/src/* proxy + 5m/15m brief engine runs here
 * with zero changes.
 *
 * The Worker (worker/src/index.js) speaks the Web Fetch API: it takes a standard
 * `Request` and returns a `Response`. This file is the thin translation layer
 * between that and Node's (IncomingMessage, ServerResponse):
 *
 *   https://<project>.vercel.app/api/brief?sym=ETH
 *     -> new Request("https://<project>.vercel.app/api/brief?sym=ETH")
 *     -> worker.fetch(request, process.env, ctx)
 *     -> status / headers / body copied back onto res (CORS included)
 *
 * Routing: the filename is a single dynamic segment — `api/[route].js` — which
 * Vercel supports for plain (non-Next) projects, and which covers every route
 * the Worker exposes (all are one segment after /api/: brief, ticker, kline, fp,
 * cvd, market, oi, walls, whales, liq, symbols, health). A `[...catchAll].js`
 * file would NOT work here: Vercel only implements catch-all segments inside
 * Next.js, so /api/brief would 404.
 *
 * Zero dependencies. One optional env var:
 *   CG_DEBUG=1  -> adds an x-cg-adapter header with the upstream round trip time
 */

import worker from "../worker/src/index.js";

// A cold Coinglass brief can take several seconds (kline + footprint + CVD +
// orderbook + liquidation levels, in parallel). Hobby allows 60 s.
export const config = { maxDuration: 60 };

/** Hop-by-hop headers a Web Request must not carry. */
const SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function origin(req) {
  const rawHost = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const host = String(rawHost).split(",")[0].trim();
  const rawProto = req.headers["x-forwarded-proto"] || "https";
  const proto = String(rawProto).split(",")[0].trim();
  return `${proto}://${host}`;
}

/** The Worker's own path for this request: /api/<route>. */
function pathOf(req) {
  const route = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route;
  if (route) return `/api/${route}`;
  return (req.url || "/").split("?")[0] || "/";
}

/** Original query string, so /api/brief?sym=ETH&liq=0 reaches the Worker intact. */
function queryOf(req) {
  const raw = String(req.url || "");
  const at = raw.indexOf("?");
  if (at >= 0) return raw.slice(at);
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (key === "route") continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v != null) q.append(key, String(v));
    }
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function toHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || SKIP_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, String(v));
    else headers.set(key, String(value));
  }
  return headers;
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function fail(res, status, error) {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("access-control-allow-origin", "*");
  res.end(JSON.stringify({ ok: false, error }));
}

export default async function handler(req, res) {
  const started = Date.now();
  const url = origin(req) + pathOf(req) + queryOf(req);

  let request;
  try {
    const body = await readBody(req);
    const init = { method: req.method || "GET", headers: toHeaders(req) };
    if (body && body.length) init.body = body;
    request = new Request(url, init);
  } catch (e) {
    return fail(res, 400, `bad request: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ctx = { waitUntil() {}, passThroughOnException() {} };

  let response;
  try {
    response = await worker.fetch(request, process.env, ctx);
  } catch (e) {
    return fail(res, 502, `adapter: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    res.statusCode = response.status;
    for (const [key, value] of response.headers) {
      if (key.toLowerCase() === "set-cookie") continue; // handled below
      res.setHeader(key, value);
    }
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader("set-cookie", cookies);
    if (process.env.CG_DEBUG === "1") {
      res.setHeader("x-cg-adapter", `vercel-node ${Date.now() - started}ms`);
    }
    const buf = Buffer.from(await response.arrayBuffer());
    res.setHeader("content-length", String(buf.length));
    res.end(buf);
  } catch (e) {
    fail(res, 502, `adapter: ${e instanceof Error ? e.message : String(e)}`);
  }
}
