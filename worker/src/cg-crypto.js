/**
 * Coinglass web-API crypto layer — faithful port of
 * cg-terminal/src/lib/cg/crypto.ts to Cloudflare Workers (Web Crypto + no Node
 * built-ins). Zero npm dependencies.
 *
 * Interop contract (reverse-engineered from the public web client):
 *  - Requests carry an `obe` header: base64( AES-256-ECB-PKCS7( "<unix>,<TOTP6>" ) )
 *    with a static 32-byte key, TOTP secret base32, 30 s step, HMAC-SHA1.
 *  - Requests also carry `encryption: true` and `cache-ts-v2: <ms>`.
 *  - Protected endpoints answer with:
 *      headers: user=<b64 blob>, v=<key-derivation version>
 *      body:    { code:"0", data:"<b64 ciphertext>" }
 *  - keyA = base64( sourceByV )[:16]      (v==1 -> mangled request path)
 *  - keyB = inflate( AES-decrypt(user blob, keyA) )   (quotes stripped)
 *  - payload = inflate( AES-decrypt(data, keyB) )     (quotes stripped) -> JSON
 *
 * AES-ECB: Web Crypto has no ECB mode, so the block cipher lives in ./aes.js
 * (pure JS, verified against Node's aes-*-ecb). TOTP uses crypto.subtle
 * HMAC-SHA1, inflate uses DecompressionStream — both native in Workers.
 */

import { aesEcbDecrypt, aesEcbEncrypt } from "./aes.js";

const STATIC_KEY = enc("1f68efd73f8d4921acc0dead41dd39bc"); // 32 bytes -> AES-256
const TOTP_SECRET_B32 = "I65VU7K5ZQL7WB4E";

const KEY_A_CONSTS = {
  55: "170b070da9654622",
  66: "d6537d845a964081",
  77: "863f08689c97435b",
};

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function enc(s) {
  return new TextEncoder().encode(s);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base32Decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Standard RFC 6238 TOTP: 30 s step, 6 digits, HMAC-SHA1. */
export async function totp(secretB32, tSec) {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const counter = new Uint8Array(8);
  const c = Math.floor(tSec / 30);
  // 32-bit high word stays 0 for any realistic clock
  counter[4] = (c >>> 24) & 0xff;
  counter[5] = (c >>> 16) & 0xff;
  counter[6] = (c >>> 8) & 0xff;
  counter[7] = c & 0xff;
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1000000;
  return String(code).padStart(6, "0");
}

/** Build the `obe` request header value. */
export async function makeObeToken(nowMs) {
  const secs = Math.floor((nowMs ?? Date.now()) / 1000);
  const code = await totp(TOTP_SECRET_B32, secs);
  return bytesToBase64(aesEcbEncrypt(enc(`${secs},${code}`), STATIC_KEY));
}

/**
 * One `obe` token per cache-ts window instead of one per upstream call: a
 * single /api/brief fans out to ~15 Coinglass requests and re-signing the TOTP
 * each time is pure wasted CPU on a Worker. The token stays valid for its
 * 30 s TOTP step, and the SAME cacheTs is handed to deriveKeyA(), so a v=="0"
 * response still derives its key from the exact timestamp we sent.
 */
let obeCache = { secs: 0, token: "" };
export async function obeTokenFor(cacheTs) {
  const secs = Math.floor(Number(cacheTs) / 1000);
  if (obeCache.token && obeCache.secs === secs) return obeCache.token;
  const token = await makeObeToken(Number(cacheTs));
  obeCache = { secs, token };
  return token;
}

async function inflateWith(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Mirror of zlib.inflateSync / inflateRawSync / gunzipSync fallback ladder. */
export async function tryInflate(bytes) {
  for (const fmt of ["deflate", "deflate-raw", "gzip"]) {
    try {
      const out = await inflateWith(bytes, fmt);
      if (out.length) return out;
    } catch {
      /* try next */
    }
  }
  return bytes;
}

function stripQuotes(s) {
  let out = s;
  if (out.startsWith('"')) out = out.slice(1);
  if (out.endsWith('"')) out = out.slice(0, -1);
  return out;
}

/** Their URL mangler: path segment from "/api" up to "?" (or end). */
export function mangleUrl(url) {
  const idx = url.indexOf("/api");
  if (idx === -1) return url;
  const q = url.indexOf("?");
  return q === -1 ? url.slice(idx) : url.slice(idx, q);
}

function deriveKeyA(v, cacheTs, timeHeader, url) {
  let src;
  if (v === "0") src = cacheTs;
  else if (v === "2") src = timeHeader ?? "";
  else if (v === "1") src = mangleUrl(url);
  else src = KEY_A_CONSTS[v] ?? "";
  // the web client takes the first 16 chars of the base64 string as raw key bytes
  return enc(bytesToBase64(enc(src)).slice(0, 16));
}

const dec = new TextDecoder();

/**
 * Decrypt an encrypted capi response body into the plain payload.
 * `resp` = { headers: Headers|object, bodyText }.
 */
export async function decryptCgResponse(resp, cacheTs, url) {
  const body = JSON.parse(resp.bodyText);
  if (body.code !== "0") {
    throw new Error(`upstream code ${body.code}: ${body.msg ?? "unknown"}`);
  }
  const data = body.data;
  if (typeof data !== "string") return data; // plain response

  const h = resp.headers;
  const get = (k) => (typeof h.get === "function" ? h.get(k) : h[k] ?? h[k.toLowerCase()]);
  const userBlob = get("user") ?? "";
  const v = String(get("v") ?? "0");
  const keyA = deriveKeyA(v, cacheTs, get("time") ?? null, url);
  const keyBRaw = stripQuotes(dec.decode(await tryInflate(aesEcbDecrypt(base64ToBytes(userBlob), keyA))));
  const payloadRaw = stripQuotes(dec.decode(await tryInflate(aesEcbDecrypt(base64ToBytes(data), enc(keyBRaw)))));
  try {
    return JSON.parse(payloadRaw);
  } catch {
    throw new Error(`decrypted payload is not JSON (${url}) — head: ${payloadRaw.slice(0, 80)}`);
  }
}

/** Build the standard header set the web client sends. */
export async function cgHeaders(cacheTs) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://www.coinglass.com",
    Referer: "https://www.coinglass.com/",
    Accept: "application/json",
    encryption: "true",
    "cache-ts-v2": cacheTs,
    language: "en",
    obe: await obeTokenFor(cacheTs),
  };
}
