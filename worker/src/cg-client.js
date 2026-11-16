/**
 * Coinglass transport for Cloudflare Workers.
 * Faithful subset of cg-terminal/src/lib/cg/client.ts: TTL cache, in-flight
 * coalescing, host-level 429 cooldown with bounded stale-serve, encrypted +
 * plain response handling.
 */

import { cgHeaders, decryptCgResponse } from "./cg-crypto.js";

export const CAPI = "https://capi.coinglass.com";
export const FAPI = "https://fapi.coinglass.com";

/** isolate-local caches (Workers keep a module instance warm between requests) */
const mem = new Map(); // url -> { at, data, bytes }
const inflight = new Map(); // url|ttl -> Promise
const cooldown = new Map(); // host -> untilMs
const MAX_ENTRIES = 220;
const MAX_BYTES = 24_000_000;
let bytesHeld = 0;

/**
 * One cache-ts per ~4 s window, shared by every upstream call in a burst:
 * the OBE token is then signed once (not per request) and v=="0" key
 * derivation stays self-consistent because the same value is passed to
 * decryptCgResponse().
 */
let reqTs = 0;
function currentCacheTs() {
  const now = Date.now();
  if (!reqTs || now - reqTs > 4000) reqTs = now;
  return String(reqTs);
}

function cacheSet(url, data, bytes) {
  const prev = mem.get(url);
  if (prev) {
    bytesHeld -= prev.bytes ?? 0;
    mem.delete(url);
  }
  while (mem.size >= MAX_ENTRIES || (bytesHeld + bytes > MAX_BYTES && mem.size > 0)) {
    const oldest = mem.keys().next().value;
    if (oldest === undefined) break;
    bytesHeld -= mem.get(oldest)?.bytes ?? 0;
    mem.delete(oldest);
  }
  bytesHeld += bytes;
  mem.set(url, { at: Date.now(), data, bytes });
}

function cacheHit(url, at) {
  const e = mem.get(url);
  if (!e || Date.now() - e.at > at) return null;
  // true-LRU: re-insert at the tail
  mem.delete(url);
  mem.set(url, e);
  return e;
}

async function rawGet(url, cacheTs) {
  const res = await fetch(url, {
    headers: await cgHeaders(cacheTs),
    signal: AbortSignal.timeout(12_000),
  });
  const bodyText = await res.text();
  const headers = {};
  res.headers.forEach((v, k) => (headers[k] = v));
  return { status: res.status, headers, bodyText };
}

async function getInner(path, host, ttl, staleMs) {
  const url = `${host}${path}`;
  const fresh = ttl > 0 ? cacheHit(url, ttl) : null;
  if (fresh) return fresh.data;

  const coolUntil = cooldown.get(host) ?? 0;
  if (Date.now() < coolUntil) {
    const stale = cacheHit(url, Math.max(staleMs, 30_000));
    if (stale) return stale.data;
    throw new Error(`coinglass cooldown ${Math.round((coolUntil - Date.now()) / 1000)}s on ${host}`);
  }

  const cacheTs = currentCacheTs();
  let resp;
  try {
    resp = await rawGet(url, cacheTs);
  } catch (e) {
    const stale = cacheHit(url, staleMs);
    if (stale) return stale.data;
    throw e;
  }

  if (resp.status === 429) {
    const ra = Number(resp.headers["retry-after"]);
    const waitMs = Math.min(Math.max(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 6000, 3000), 25_000);
    cooldown.set(host, Math.max(cooldown.get(host) ?? 0, Date.now() + waitMs));
    const stale = cacheHit(url, staleMs);
    if (stale) return stale.data;
    throw new Error(`coinglass HTTP 429 for ${path}`);
  }
  if (resp.status !== 200) {
    const stale = cacheHit(url, staleMs);
    if (stale) return stale.data;
    throw new Error(`upstream HTTP ${resp.status} for ${path}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(resp.bodyText);
  } catch {
    throw new Error(`upstream returned non-JSON for ${path}`);
  }
  let data;
  if (parsed && typeof parsed === "object" && "data" in parsed && typeof parsed.data !== "string") {
    if (parsed.code !== "0" && Number(parsed.code) !== 0) {
      throw new Error(`upstream code ${parsed.code}: ${parsed.msg ?? ""}`);
    }
    data = parsed.data;
  } else if (parsed && typeof parsed === "object" && typeof parsed.data === "string") {
    data = await decryptCgResponse(resp, cacheTs, url);
  } else {
    // e.g. {"code":"0","msg":"success","success":true} with no data
    if (parsed && typeof parsed === "object" && parsed.code !== undefined && parsed.code !== "0") {
      throw new Error(`upstream code ${parsed.code}: ${parsed.msg ?? ""}`);
    }
    data = parsed;
  }
  if (ttl > 0) cacheSet(url, data, resp.bodyText.length);
  return data;
}

/**
 * GET a capi/fapi path and return the decrypted payload.
 * Concurrent identical misses are coalesced; ttl===0 skips the write cache.
 */
export async function cgGet(path, { host = CAPI, ttl = 10_000, staleMs = 180_000 } = {}) {
  const key = `${host}${path}|${ttl > 0 ? 1 : 0}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = getInner(path, host, ttl, staleMs).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Plain NDJSON stream read (liquidity-heatmap aggregate). No encryption. */
export async function cgStream(url, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Origin: "https://www.coinglass.com",
        Referer: "https://www.coinglass.com/",
        Accept: "*/*",
        language: "en",
      },
      signal: ctrl.signal,
    });
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    if (!res.ok || !/ndjson/.test(ct)) {
      let code = "";
      let msg = "";
      try {
        const j = JSON.parse(text);
        code = String(j.code ?? "");
        msg = j.msg ?? "";
      } catch {
        /* ignore */
      }
      throw new Error(`heatmap stream ${res.status} code=${code} ${msg}`.trim());
    }
    let meta = null;
    const rows = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let f;
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
      if (f.type === "meta") {
        if (String(f.code) !== "0") throw new Error(`stream code ${f.code}: ${f.msg ?? ""}`);
        meta = { size: Number(f.size), max: Number(f.max ?? 0) };
      } else if (f.type === "batch") {
        for (const r of f.data ?? []) rows.push(r);
      } else if (f.type === "data") {
        rows.push(f.data);
      } else if (f.type === "error") {
        throw new Error(`stream error ${f.code}: ${f.msg ?? ""}`);
      }
    }
    if (!meta) throw new Error("stream meta missing");
    return { rows, size: meta.size, max: meta.max };
  } finally {
    clearTimeout(kill);
  }
}

export function cacheStats() {
  return { entries: mem.size, bytes: bytesHeld, cooldowns: Object.fromEntries(cooldown) };
}
