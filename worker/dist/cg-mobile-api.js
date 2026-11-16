// src/aes.js
var SBOX = new Uint8Array([
  99,
  124,
  119,
  123,
  242,
  107,
  111,
  197,
  48,
  1,
  103,
  43,
  254,
  215,
  171,
  118,
  202,
  130,
  201,
  125,
  250,
  89,
  71,
  240,
  173,
  212,
  162,
  175,
  156,
  164,
  114,
  192,
  183,
  253,
  147,
  38,
  54,
  63,
  247,
  204,
  52,
  165,
  229,
  241,
  113,
  216,
  49,
  21,
  4,
  199,
  35,
  195,
  24,
  150,
  5,
  154,
  7,
  18,
  128,
  226,
  235,
  39,
  178,
  117,
  9,
  131,
  44,
  26,
  27,
  110,
  90,
  160,
  82,
  59,
  214,
  179,
  41,
  227,
  47,
  132,
  83,
  209,
  0,
  237,
  32,
  252,
  177,
  91,
  106,
  203,
  190,
  57,
  74,
  76,
  88,
  207,
  208,
  239,
  170,
  251,
  67,
  77,
  51,
  133,
  69,
  249,
  2,
  127,
  80,
  60,
  159,
  168,
  81,
  163,
  64,
  143,
  146,
  157,
  56,
  245,
  188,
  182,
  218,
  33,
  16,
  255,
  243,
  210,
  205,
  12,
  19,
  236,
  95,
  151,
  68,
  23,
  196,
  167,
  126,
  61,
  100,
  93,
  25,
  115,
  96,
  129,
  79,
  220,
  34,
  42,
  144,
  136,
  70,
  238,
  184,
  20,
  222,
  94,
  11,
  219,
  224,
  50,
  58,
  10,
  73,
  6,
  36,
  92,
  194,
  211,
  172,
  98,
  145,
  149,
  228,
  121,
  231,
  200,
  55,
  109,
  141,
  213,
  78,
  169,
  108,
  86,
  244,
  234,
  101,
  122,
  174,
  8,
  186,
  120,
  37,
  46,
  28,
  166,
  180,
  198,
  232,
  221,
  116,
  31,
  75,
  189,
  139,
  138,
  112,
  62,
  181,
  102,
  72,
  3,
  246,
  14,
  97,
  53,
  87,
  185,
  134,
  193,
  29,
  158,
  225,
  248,
  152,
  17,
  105,
  217,
  142,
  148,
  155,
  30,
  135,
  233,
  206,
  85,
  40,
  223,
  140,
  161,
  137,
  13,
  191,
  230,
  66,
  104,
  65,
  153,
  45,
  15,
  176,
  84,
  187,
  22
]);
var INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
var RCON = new Uint8Array([141, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77]);
function xtime(x) {
  return (x << 1 ^ (x & 128 ? 27 : 0)) & 255;
}
var MUL = {};
for (const m of [2, 3, 9, 11, 13, 14]) {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let r = 0;
    let x = i;
    let y = m;
    while (y) {
      if (y & 1) r ^= x;
      x = xtime(x);
      y >>= 1;
    }
    t[i] = r & 255;
  }
  MUL[m] = t;
}
function expandKey(key) {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error(`aes: bad key length ${key.length}`);
  }
  const nk = key.length >> 2;
  const nr = nk + 6;
  const total = 4 * (nr + 1);
  const w = new Uint8Array(total * 4);
  w.set(key, 0);
  const temp = new Uint8Array(4);
  for (let i = nk; i < total; i++) {
    temp[0] = w[(i - 1) * 4];
    temp[1] = w[(i - 1) * 4 + 1];
    temp[2] = w[(i - 1) * 4 + 2];
    temp[3] = w[(i - 1) * 4 + 3];
    if (i % nk === 0) {
      const t0 = temp[0];
      temp[0] = SBOX[temp[1]] ^ RCON[i / nk];
      temp[1] = SBOX[temp[2]];
      temp[2] = SBOX[temp[3]];
      temp[3] = SBOX[t0];
    } else if (nk > 6 && i % nk === 4) {
      temp[0] = SBOX[temp[0]];
      temp[1] = SBOX[temp[1]];
      temp[2] = SBOX[temp[2]];
      temp[3] = SBOX[temp[3]];
    }
    w[i * 4] = w[(i - nk) * 4] ^ temp[0];
    w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ temp[1];
    w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ temp[2];
    w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ temp[3];
  }
  return { w, nr };
}
function addRoundKey(state, w, round2) {
  const off = round2 * 16;
  for (let i = 0; i < 16; i++) state[i] ^= w[off + i];
}
function shiftRows(s) {
  let t;
  t = s[1];
  s[1] = s[5];
  s[5] = s[9];
  s[9] = s[13];
  s[13] = t;
  t = s[2];
  s[2] = s[10];
  s[10] = t;
  t = s[6];
  s[6] = s[14];
  s[14] = t;
  t = s[15];
  s[15] = s[11];
  s[11] = s[7];
  s[7] = s[3];
  s[3] = t;
}
function invShiftRows(s) {
  let t;
  t = s[13];
  s[13] = s[9];
  s[9] = s[5];
  s[5] = s[1];
  s[1] = t;
  t = s[2];
  s[2] = s[10];
  s[10] = t;
  t = s[6];
  s[6] = s[14];
  s[14] = t;
  t = s[3];
  s[3] = s[7];
  s[7] = s[11];
  s[11] = s[15];
  s[15] = t;
}
function mixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = s[i];
    const a1 = s[i + 1];
    const a2 = s[i + 2];
    const a3 = s[i + 3];
    s[i] = MUL[2][a0] ^ MUL[3][a1] ^ a2 ^ a3;
    s[i + 1] = a0 ^ MUL[2][a1] ^ MUL[3][a2] ^ a3;
    s[i + 2] = a0 ^ a1 ^ MUL[2][a2] ^ MUL[3][a3];
    s[i + 3] = MUL[3][a0] ^ a1 ^ a2 ^ MUL[2][a3];
  }
}
function invMixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const a0 = s[i];
    const a1 = s[i + 1];
    const a2 = s[i + 2];
    const a3 = s[i + 3];
    s[i] = MUL[14][a0] ^ MUL[11][a1] ^ MUL[13][a2] ^ MUL[9][a3];
    s[i + 1] = MUL[9][a0] ^ MUL[14][a1] ^ MUL[11][a2] ^ MUL[13][a3];
    s[i + 2] = MUL[13][a0] ^ MUL[9][a1] ^ MUL[14][a2] ^ MUL[11][a3];
    s[i + 3] = MUL[11][a0] ^ MUL[13][a1] ^ MUL[9][a2] ^ MUL[14][a3];
  }
}
function encryptBlock(state, w, nr) {
  addRoundKey(state, w, 0);
  for (let r = 1; r < nr; r++) {
    for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, w, r);
  }
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
  shiftRows(state);
  addRoundKey(state, w, nr);
}
function decryptBlock(state, w, nr) {
  addRoundKey(state, w, nr);
  for (let r = nr - 1; r >= 1; r--) {
    invShiftRows(state);
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
    addRoundKey(state, w, r);
    invMixColumns(state);
  }
  invShiftRows(state);
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
  addRoundKey(state, w, 0);
}
function pkcs7Pad(buf) {
  const pad = 16 - buf.length % 16;
  const out = new Uint8Array(buf.length + pad);
  out.set(buf, 0);
  out.fill(pad, buf.length);
  return out;
}
function pkcs7Unpad(buf) {
  if (!buf.length || buf.length % 16 !== 0) return buf;
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 16 || pad > buf.length) return buf;
  for (let i = buf.length - pad; i < buf.length; i++) if (buf[i] !== pad) return buf;
  return buf.subarray(0, buf.length - pad);
}
function aesEcbEncrypt(plain, key) {
  const { w, nr } = expandKey(key);
  const data = pkcs7Pad(plain);
  const out = new Uint8Array(data.length);
  const state = new Uint8Array(16);
  for (let off = 0; off < data.length; off += 16) {
    state.set(data.subarray(off, off + 16));
    encryptBlock(state, w, nr);
    out.set(state, off);
  }
  return out;
}
function aesEcbDecrypt(cipher, key) {
  if (cipher.length % 16 !== 0) throw new Error("aes: ciphertext not block-aligned");
  const { w, nr } = expandKey(key);
  const out = new Uint8Array(cipher.length);
  const state = new Uint8Array(16);
  for (let off = 0; off < cipher.length; off += 16) {
    state.set(cipher.subarray(off, off + 16));
    decryptBlock(state, w, nr);
    out.set(state, off);
  }
  return pkcs7Unpad(out);
}

// src/cg-crypto.js
var STATIC_KEY = enc("1f68efd73f8d4921acc0dead41dd39bc");
var TOTP_SECRET_B32 = "I65VU7K5ZQL7WB4E";
var KEY_A_CONSTS = {
  55: "170b070da9654622",
  66: "d6537d845a964081",
  77: "863f08689c97435b"
};
var B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function enc(s) {
  return new TextEncoder().encode(s);
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 32768;
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
    value = value << 5 | idx;
    bits += 5;
    if (bits >= 8) {
      out.push(value >>> bits - 8 & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
async function totp(secretB32, tSec) {
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const counter = new Uint8Array(8);
  const c = Math.floor(tSec / 30);
  counter[4] = c >>> 24 & 255;
  counter[5] = c >>> 16 & 255;
  counter[6] = c >>> 8 & 255;
  counter[7] = c & 255;
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = digest[digest.length - 1] & 15;
  const code = ((digest[offset] & 127) << 24 | digest[offset + 1] << 16 | digest[offset + 2] << 8 | digest[offset + 3]) % 1e6;
  return String(code).padStart(6, "0");
}
async function makeObeToken(nowMs) {
  const secs = Math.floor((nowMs ?? Date.now()) / 1e3);
  const code = await totp(TOTP_SECRET_B32, secs);
  return bytesToBase64(aesEcbEncrypt(enc(`${secs},${code}`), STATIC_KEY));
}
var obeCache = { secs: 0, token: "" };
async function obeTokenFor(cacheTs) {
  const secs = Math.floor(Number(cacheTs) / 1e3);
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
async function tryInflate(bytes) {
  for (const fmt of ["deflate", "deflate-raw", "gzip"]) {
    try {
      const out = await inflateWith(bytes, fmt);
      if (out.length) return out;
    } catch {
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
function mangleUrl(url) {
  const idx = url.indexOf("/api");
  if (idx === -1) return url;
  const q2 = url.indexOf("?");
  return q2 === -1 ? url.slice(idx) : url.slice(idx, q2);
}
function deriveKeyA(v, cacheTs, timeHeader, url) {
  let src;
  if (v === "0") src = cacheTs;
  else if (v === "2") src = timeHeader ?? "";
  else if (v === "1") src = mangleUrl(url);
  else src = KEY_A_CONSTS[v] ?? "";
  return enc(bytesToBase64(enc(src)).slice(0, 16));
}
var dec = new TextDecoder();
async function decryptCgResponse(resp, cacheTs, url) {
  const body = JSON.parse(resp.bodyText);
  if (body.code !== "0") {
    throw new Error(`upstream code ${body.code}: ${body.msg ?? "unknown"}`);
  }
  const data = body.data;
  if (typeof data !== "string") return data;
  const h = resp.headers;
  const get = (k) => typeof h.get === "function" ? h.get(k) : h[k] ?? h[k.toLowerCase()];
  const userBlob = get("user") ?? "";
  const v = String(get("v") ?? "0");
  const keyA = deriveKeyA(v, cacheTs, get("time") ?? null, url);
  const keyBRaw = stripQuotes(dec.decode(await tryInflate(aesEcbDecrypt(base64ToBytes(userBlob), keyA))));
  const payloadRaw = stripQuotes(dec.decode(await tryInflate(aesEcbDecrypt(base64ToBytes(data), enc(keyBRaw)))));
  try {
    return JSON.parse(payloadRaw);
  } catch {
    throw new Error(`decrypted payload is not JSON (${url}) \u2014 head: ${payloadRaw.slice(0, 80)}`);
  }
}
async function cgHeaders(cacheTs) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: "https://www.coinglass.com",
    Referer: "https://www.coinglass.com/",
    Accept: "application/json",
    encryption: "true",
    "cache-ts-v2": cacheTs,
    language: "en",
    obe: await obeTokenFor(cacheTs)
  };
}

// src/cg-client.js
var CAPI = "https://capi.coinglass.com";
var FAPI = "https://fapi.coinglass.com";
var mem = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
var cooldown = /* @__PURE__ */ new Map();
var MAX_ENTRIES = 220;
var MAX_BYTES = 24e6;
var bytesHeld = 0;
var reqTs = 0;
function currentCacheTs() {
  const now = Date.now();
  if (!reqTs || now - reqTs > 4e3) reqTs = now;
  return String(reqTs);
}
function cacheSet(url, data, bytes) {
  const prev = mem.get(url);
  if (prev) {
    bytesHeld -= prev.bytes ?? 0;
    mem.delete(url);
  }
  while (mem.size >= MAX_ENTRIES || bytesHeld + bytes > MAX_BYTES && mem.size > 0) {
    const oldest = mem.keys().next().value;
    if (oldest === void 0) break;
    bytesHeld -= mem.get(oldest)?.bytes ?? 0;
    mem.delete(oldest);
  }
  bytesHeld += bytes;
  mem.set(url, { at: Date.now(), data, bytes });
}
function cacheHit(url, at) {
  const e = mem.get(url);
  if (!e || Date.now() - e.at > at) return null;
  mem.delete(url);
  mem.set(url, e);
  return e;
}
async function rawGet(url, cacheTs) {
  const res = await fetch(url, {
    headers: await cgHeaders(cacheTs),
    signal: AbortSignal.timeout(12e3)
  });
  const bodyText = await res.text();
  const headers = {};
  res.headers.forEach((v, k) => headers[k] = v);
  return { status: res.status, headers, bodyText };
}
async function getInner(path, host, ttl, staleMs) {
  const url = `${host}${path}`;
  const fresh = ttl > 0 ? cacheHit(url, ttl) : null;
  if (fresh) return fresh.data;
  const coolUntil = cooldown.get(host) ?? 0;
  if (Date.now() < coolUntil) {
    const stale = cacheHit(url, Math.max(staleMs, 3e4));
    if (stale) return stale.data;
    throw new Error(`coinglass cooldown ${Math.round((coolUntil - Date.now()) / 1e3)}s on ${host}`);
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
    const waitMs = Math.min(Math.max(Number.isFinite(ra) && ra > 0 ? ra * 1e3 : 6e3, 3e3), 25e3);
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
    if (parsed && typeof parsed === "object" && parsed.code !== void 0 && parsed.code !== "0") {
      throw new Error(`upstream code ${parsed.code}: ${parsed.msg ?? ""}`);
    }
    data = parsed;
  }
  if (ttl > 0) cacheSet(url, data, resp.bodyText.length);
  return data;
}
async function cgGet(path, { host = CAPI, ttl = 1e4, staleMs = 18e4 } = {}) {
  const key = `${host}${path}|${ttl > 0 ? 1 : 0}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = getInner(path, host, ttl, staleMs).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
async function cgStream(url, timeoutMs = 12e3) {
  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Origin: "https://www.coinglass.com",
        Referer: "https://www.coinglass.com/",
        Accept: "*/*",
        language: "en"
      },
      signal: ctrl.signal
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
function cacheStats() {
  return { entries: mem.size, bytes: bytesHeld, cooldowns: Object.fromEntries(cooldown) };
}

// src/fp.js
function fpFromBuckets(buckets) {
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
function mergeFp(fs) {
  const list = fs.filter((f) => !!f);
  if (!list.length) return null;
  let tick = -Infinity;
  for (const f of list) if (f.tick > tick) tick = f.tick;
  const map = /* @__PURE__ */ new Map();
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

// src/cvd.js
var FlowGrid = class {
  constructor(step, keys) {
    this.step = step;
    this.keys = keys;
    this.n = 0;
    this.T = [];
    this.O = [];
    this.H = [];
    this.L = [];
    this.C = [];
    this.idx = /* @__PURE__ */ new Map();
    this.flows = [];
  }
  setCandles(rows) {
    for (const r of rows) {
      const t = 1e3 * Number(r[0]);
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
};
function flowRows(raw) {
  return raw.map((r) => ({ t: 1e3 * Number(r[0]), b: Number(r[1]) || 0, s: Number(r[2]) || 0 })).filter((r) => Number.isFinite(r.t));
}
function recompute(grid, inst) {
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
function detectDivergences(s, cvd2) {
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
      priceC: s.c[Math.min(c, n - 1)] ?? s.c[n - 1]
    };
  };
  for (let i = 1; i < swingHighs.length; i++) {
    const a = swingHighs[i - 1];
    const b = swingHighs[i];
    if (b - a >= 4 && b - a <= 60 && H[b] > H[a] && cvd2[b + 1] < cvd2[a + 1]) out.push(mk("bear", a, b));
  }
  for (let i = 1; i < swingLows.length; i++) {
    const a = swingLows[i - 1];
    const b = swingLows[i];
    if (b - a >= 4 && b - a <= 60 && L[b] < L[a] && cvd2[b + 1] > cvd2[a + 1]) out.push(mk("bull", a, b));
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
function cvdKpis(s, scope, divs) {
  const n = s.n;
  let f = 0;
  if (scope === "day") f = Math.max(0, n - Math.ceil(864e5 / (s.ts[1] - s.ts[0] || 9e5)));
  if (scope === "week") f = Math.max(0, n - Math.ceil(7 * 864e5 / (s.ts[1] - s.ts[0] || 9e5)));
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
  const scored = divs.filter((d) => d.hit !== void 0);
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
    hitRate: scored.length ? { hits: scored.filter((d) => d.hit).length, total: scored.length } : null
  };
}

// src/signals.js
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var sum = (a) => a.reduce((x, y) => x + y, 0);
var mean = (a) => a.length ? sum(a) / a.length : 0;
var last = (a) => a[a.length - 1];
var round = (v, d = 2) => Number(v.toFixed(d));
function emaSeries(vals, period) {
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
var emaLast = (vals, period) => last(emaSeries(vals, period));
function atr(bars, period = 14) {
  if (bars.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)));
  }
  return mean(trs.slice(-period));
}
function rsi(closes, period = 14) {
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
function scoreStructure(bars, label) {
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
  const emaPts = Math.round(stackRaw / 3 * 10);
  const momPts = (p > e9 ? 2 : -2) + (e9 > e9prev ? 2 : -2);
  const { highs, lows } = pivots(bars, 2, 50);
  const Hi = highs.map((i) => ({ i, p: bars[i].h }));
  const Lo = lows.map((i) => ({ i, p: bars[i].l }));
  const lastHigh = Hi.length ? last(Hi) : null;
  const lastLow = Lo.length ? last(Lo) : null;
  let structPts = 0;
  let bosNote = "\u533A\u95F4\u5185";
  if (lastHigh && p > lastHigh.p) {
    structPts = 8;
    bosNote = `\u4E0A\u7834\u6446\u52A8\u9AD8 ${round(lastHigh.p)}`;
  } else if (lastLow && p < lastLow.p) {
    structPts = -8;
    bosNote = `\u4E0B\u7834\u6446\u52A8\u4F4E ${round(lastLow.p)}`;
  } else if (Hi.length >= 2 && Lo.length >= 2) {
    const hh = last(Hi).p > Hi[Hi.length - 2].p;
    const hl = last(Lo).p > Lo[Lo.length - 2].p;
    if (hh && hl) {
      structPts = 4;
      bosNote = "\u9AD8\u70B9\u62AC\u9AD8+\u4F4E\u70B9\u62AC\u9AD8 HH/HL";
    } else if (!hh && !hl) {
      structPts = -4;
      bosNote = "\u9AD8\u70B9\u964D\u4F4E+\u4F4E\u70B9\u964D\u4F4E LH/LL";
    } else {
      bosNote = "\u9AD8\u4F4E\u70B9\u4EA4\u9519\uFF08\u9707\u8361\uFF09";
    }
  }
  const win = bars.slice(-48);
  const hi = Math.max(...win.map((b) => b.h));
  const lo = Math.min(...win.map((b) => b.l));
  const pos = hi > lo ? (p - lo) / (hi - lo) : 0.5;
  const zonePts = clamp(Math.round((0.5 - pos) * 12), -6, 6);
  const zone = pos > 0.62 ? "\u6EA2\u4EF7\u533A" : pos < 0.38 ? "\u6298\u4EF7\u533A" : "\u5747\u8861\u533A";
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
    note: bosNote
  };
}
function scoreCvd(cvd2, updatedAt = Date.now()) {
  const k = cvd2?.kpis;
  if (!k) return { score: 0, missing: true };
  const gross = (k.perpBuy || 0) + (k.perpSell || 0);
  const share = gross > 0 ? k.perpCvd / gross : 0;
  const ptsShare = clamp(Math.round(share * 300), -6, 6);
  const d = (cvd2.delta || []).slice(-24);
  const absSum = sum(d.map(Math.abs));
  const dr = absSum > 0 ? sum(d) / absSum : 0;
  const ptsRecent = clamp(Math.round(dr * 6), -6, 6);
  const ptsRatio = clamp(Math.round(((k.buyRatio ?? 50) - 50) * 0.6), -3, 3);
  let ptsDiv = 0;
  const div = k.latestDiv;
  const age = div && updatedAt ? updatedAt - div.ts : Infinity;
  if (div && age < 4 * 36e5) ptsDiv = div.type === "bear" ? -2 : 2;
  return {
    score: clamp(ptsShare + ptsRecent + ptsRatio + ptsDiv, -15, 15),
    parts: { ptsShare, ptsRecent, ptsRatio, ptsDiv },
    share,
    recentRatio: dr,
    buyRatio: k.buyRatio,
    quadrant: k.quadrant,
    perpCvd: k.perpCvd,
    spotCvd: k.spotCvd,
    div: div ? `${div.type === "bear" ? "\u770B\u8DCC" : "\u770B\u6DA8"}\u80CC\u79BB @${round(div.price ?? 0)}` : null
  };
}
function scoreTaker(fp) {
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
    bars: use.length
  };
}
function computeFpSignals(X) {
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
    if (sells && botSell / sells >= 0.3 && botSell > 1.2 * botBuy && closePos >= 0.6)
      out.push({ i: l, t: "abs", side: "buy", p: bar.l, q: botSell, u: botSell * ((bar.h + bar.l) / 2), ts: bar.ts });
    if (buys && topBuy / buys >= 0.3 && topBuy > 1.2 * topSell && closePos <= 0.4)
      out.push({ i: l, t: "abs", side: "sell", p: bar.h, q: topBuy, u: topBuy * ((bar.h + bar.l) / 2), ts: bar.ts });
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
  const cvd2 = new Float64Array(t);
  {
    let acc = 0;
    for (let k = 0; k < t; k++) {
      const f = X[k].fp;
      if (f) for (let e = 0; e < f.b.length; e++) acc += f.b[e] - f.s[e];
      cvd2[k] = acc;
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
      if (prevHigh >= 0 && a - prevHigh <= 40 && X[a].h > X[prevHigh].h && cvd2[prevHigh] - cvd2[a] > gapMin)
        out.push({ i: a, t: "sdiv", side: "sell", p: X[a].h, i0: prevHigh, p0: X[prevHigh].h, dc: cvd2[a] - cvd2[prevHigh], ts: X[a].ts });
      prevHigh = a;
    }
    if (isLow) {
      if (prevLow >= 0 && a - prevLow <= 40 && X[a].l < X[prevLow].l && cvd2[a] - cvd2[prevLow] > gapMin)
        out.push({ i: a, t: "sdiv", side: "buy", p: X[a].l, i0: prevLow, p0: X[prevLow].l, dc: cvd2[a] - cvd2[prevLow], ts: X[a].ts });
      prevLow = a;
    }
  }
  out.sort((x, y) => x.i - y.i);
  return out;
}
var FP_SIG_NAME = { abs: "\u5438\u6536", div: "\u53D1\u6563", sdiv: "\u5F3A\u53D1\u6563", trap: "\u9677\u9631", exh: "\u8017\u5C3D" };
function fpSigNote(g) {
  const bull = g.side === "buy";
  switch (g.t) {
    case "abs":
      return bull ? "\u4F4E\u4F4D\u5356\u76D8\u88AB\u5438\u6536" : "\u9AD8\u4F4D\u4E70\u76D8\u88AB\u5438\u6536";
    case "div":
      return bull ? "\u8DCC\u4F46\u4E3B\u52A8\u5356\u4E0D\u8DB3" : "\u6DA8\u4F46\u4E3B\u52A8\u4E70\u4E0D\u8DB3";
    case "sdiv":
      return bull ? "\u4F4E\u70B9\u66F4\u4F4ECVD\u53CD\u5347" : "\u9AD8\u70B9\u66F4\u9AD8CVD\u8D70\u4F4E";
    case "trap":
      return bull ? "\u5047\u8DCC\u7834\u62C9\u56DE\uFF0C\u8FFD\u7A7A\u88AB\u5957" : "\u5047\u7A81\u7834\u56DE\u843D\uFF0C\u8FFD\u591A\u88AB\u5957";
    default:
      return bull ? "\u65B0\u4F4E\u7F29\u91CF\u5356\u5C3D" : "\u65B0\u9AD8\u7F29\u91CF\u4E70\u5C3D";
  }
}
function fpSignalSummary(sigs, px, nowMs = Date.now()) {
  const nowSec = nowMs / 1e3;
  const recent = sigs.filter((g) => g.ts <= nowSec && nowSec - g.ts <= 4 * 3600);
  const head = "\u8DB3\u8FF9\u4FE1\u53F7(15m)\uFF1A";
  if (!recent.length) {
    return { line: `${head}\u8FD14h\u65E0\u660E\u663E\u53CD\u8F6C/\u5438\u6536\u4FE1\u53F7`, groups: [], count: 0, bull: 0, bear: 0, recent: [] };
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
    const notes = [...new Set(grp.items.map(fpSigNote))].join("\uFF1B");
    const arrow = grp.side === "buy" ? "\u2191" : "\u2193";
    const size = grp.usd >= 1e6 ? `\uFF0C$${(grp.usd / 1e6).toFixed(1)}M` : "";
    return { names, notes, arrow, size, ts: grp.ts, price: grp.items[0].p, side: grp.side, usd: grp.usd };
  });
  const line = `${head}${parts.map((p) => `${p.names}${p.arrow}@${p.price}\uFF08${p.notes}${p.size}\uFF09`).join("\uFF5C")}${groups.length > show.length ? `\u7B49${groups.length}\u5904` : ""}\uFF5C\u8FD14h ${recent.length}\u4E2A(${bull}\u591A/${bear}\u7A7A)`;
  return {
    line,
    groups: parts,
    count: recent.length,
    bull,
    bear,
    recent: recent.slice().sort((a, b) => b.ts - a.ts).slice(0, 12).map((g) => ({
      ts: g.ts,
      type: g.t,
      name: FP_SIG_NAME[g.t] ?? g.t,
      side: g.side,
      price: g.p,
      note: fpSigNote(g),
      usd: g.u ? Math.round(g.u) : null,
      cvdGap: g.dc ? Math.round(g.dc) : null
    }))
  };
}
function scoreOi(oi, px1hPct) {
  const a = oi?.aggregate;
  if (!a || a.oiDelta1hPct == null) return { score: 0, missing: true };
  const dOi = a.oiDelta1hPct / 100;
  const dPx = (px1hPct ?? 0) / 100;
  let sign = 0;
  let strength = 1;
  let regime = "\u6301\u4ED3\u4E2D\u6027";
  if (dOi > 0 && dPx > 0) {
    sign = 1;
    regime = "\u591A\u5934\u589E\u4ED3";
  } else if (dOi > 0 && dPx < 0) {
    sign = -1;
    regime = "\u7A7A\u5934\u589E\u4ED3";
  } else if (dOi < 0 && dPx > 0) {
    sign = 1;
    strength = 0.6;
    regime = "\u7A7A\u5934\u56DE\u8865(\u8F67\u7A7A)";
  } else if (dOi < 0 && dPx < 0) {
    sign = -1;
    strength = 0.8;
    regime = "\u591A\u5934\u5E73\u4ED3(\u8E29\u8E0F)";
  }
  const mag = Math.min(1, Math.abs(dOi) * 100 / 1.2);
  return {
    score: Math.round(10 * mag * sign * strength),
    dOiPct: a.oiDelta1hPct,
    dOi4hPct: a.oiDelta4hPct,
    dOi24hPct: a.oiDelta24hPct,
    px1hPct,
    regime,
    oiUsd: a.oiUsd
  };
}
function wallStats(bw, px) {
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
    count: walls.length
  };
}
function whaleFlow(lto, px, now = Date.now()) {
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
        ageMs: now - (o.startTime ?? now)
      });
    }
  }
  const win = (h) => {
    const from = now - h * 36e5;
    const r = rows.filter((x) => x.t >= from);
    const buy = sum(r.filter((x) => x.side === "buy").map((x) => x.usd));
    const sell = sum(r.filter((x) => x.side === "sell").map((x) => x.usd));
    return { n: r.length, buy, sell, net: buy - sell, rows: r };
  };
  const h1 = win(1);
  const h24 = win(24);
  const biggest = [...h24.rows].sort((a, b) => b.usd - a.usd).slice(0, 3);
  const near = h24.rows.filter((x) => Math.abs(x.price / px - 1) < 5e-3);
  const clusters = /* @__PURE__ */ new Map();
  for (const x of near) {
    const key = `${x.price.toFixed(2)}|${x.side}`;
    const c = clusters.get(key) ?? { price: x.price, side: x.side, usd: 0, n: 0 };
    c.usd += x.usd;
    c.n += 1;
    clusters.set(key, c);
  }
  const topClusters = [...clusters.values()].sort((a, b) => b.usd - a.usd).slice(0, 4);
  const wide = /* @__PURE__ */ new Map();
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
function fmtPx(p, px) {
  const d = px >= 1e3 ? 2 : px >= 100 ? 2 : px >= 1 ? 3 : 5;
  return Number(p).toFixed(d);
}
function buildLevels({ px, s5, s15, market, liq, walls, atr15, ltoClusters }) {
  const A = atr15 || px * 4e-3;
  const dayAuction = market?.auction?.day ?? {};
  const anchorsUp = [];
  const anchorsDown = [];
  const push = (arr, price, tag, w = 3e6) => {
    if (Number.isFinite(price) && price > 0) arr.push({ price, tag, w });
  };
  for (const w of walls?.askAbove?.slice(0, 8) ?? []) push(anchorsUp, w.price, `\u5356\u5899$${(w.usd / 1e6).toFixed(1)}M`, w.usd);
  push(anchorsUp, s15?.swings?.high, "15m\u6446\u52A8\u9AD8");
  push(anchorsUp, s5?.swings?.high, "5m\u6446\u52A8\u9AD8");
  push(anchorsUp, dayAuction.vah, "\u65E5VAH");
  push(anchorsUp, dayAuction.poc, "\u65E5POC");
  push(anchorsUp, s15?.weakHigh, "\u5F31\u9AD8(\u5F85\u626B)");
  for (const l of (liq?.above ?? []).slice(0, 6)) push(anchorsUp, l.price, `\u7A7A\u5934\u6E05\u7B97${l.strength ?? ""}`, 2e6);
  for (const c of ltoClusters ?? []) if (c.side === "sell" && c.price > px) push(anchorsUp, c.price, `\u5927\u989D\u5356\u6302$${(c.usd / 1e6).toFixed(1)}M`, c.usd);
  for (const w of walls?.bidBelow?.slice(0, 8) ?? []) push(anchorsDown, w.price, `\u4E70\u5899$${(w.usd / 1e6).toFixed(1)}M`, w.usd);
  push(anchorsDown, s15?.swings?.low, "15m\u6446\u52A8\u4F4E");
  push(anchorsDown, s5?.swings?.low, "5m\u6446\u52A8\u4F4E");
  push(anchorsDown, dayAuction.val, "\u65E5VAL");
  push(anchorsDown, dayAuction.poc, "\u65E5POC");
  push(anchorsDown, s15?.weakLow, "\u5F31\u4F4E(\u5F85\u626B)");
  for (const l of (liq?.below ?? []).slice(0, 6)) push(anchorsDown, l.price, `\u591A\u5934\u6E05\u7B97${l.strength ?? ""}`, 2e6);
  for (const c of ltoClusters ?? []) if (c.side === "buy" && c.price < px) push(anchorsDown, c.price, `\u5927\u989D\u4E70\u6302$${(c.usd / 1e6).toFixed(1)}M`, c.usd);
  const pickAnchor = (list, side) => {
    const near = list.filter((a) => side === "up" ? a.price <= px * 1.008 : a.price >= px * 0.992).slice(0, 8);
    if (!near.length) return null;
    return [...near].sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || Math.abs(a.price - px) - Math.abs(b.price - px))[0];
  };
  const above = anchorsUp.filter((a) => a.price > px * 1.0004).sort((a, b) => a.price - b.price);
  const below = anchorsDown.filter((a) => a.price < px * 0.9996).sort((a, b) => b.price - a.price);
  const shortEntryAnchor = pickAnchor(above, "up") ?? { price: px + 0.45 * A, tag: "0.45ATR" };
  const shortEntry = shortEntryAnchor.price;
  const askWallAboveEntry = (walls?.askAbove ?? []).find((w) => w.price >= shortEntry && w.price <= shortEntry + 1.2 * A);
  const swingAboveEntry = above.find((a) => a.price > shortEntry && a.tag.includes("\u6446\u52A8\u9AD8"));
  const shortInvalidation = Math.max(
    askWallAboveEntry ? askWallAboveEntry.price + 0.25 * A : 0,
    swingAboveEntry ? swingAboveEntry.price + 0.2 * A : 0
  );
  const shortStop = Math.min(Math.max(shortEntry + 0.55 * A, shortInvalidation, shortEntry * 1.0035), shortEntry + 1.3 * A);
  const shortRisk = shortStop - shortEntry;
  const shortTp1 = below.find((a) => a.price <= shortEntry && (shortEntry - a.price) / shortRisk >= 1.1) ?? { price: shortEntry - 1.2 * A, tag: "1.2ATR" };
  const shortTp2 = below.find((a) => a.price <= shortTp1.price - 0.7 * shortRisk) ?? {
    price: shortEntry - Math.max(2 * shortRisk, shortRisk + 0.5 * A),
    tag: "2R"
  };
  const longEntryAnchor = pickAnchor(below, "down") ?? { price: px - 0.45 * A, tag: "0.45ATR" };
  const longEntry = longEntryAnchor.price;
  const bidWallBelowEntry = (walls?.bidBelow ?? []).find((w) => w.price <= longEntry && w.price >= longEntry - 1.2 * A);
  const swingBelowEntry = below.find((a) => a.price < longEntry && a.tag.includes("\u6446\u52A8\u4F4E"));
  const longInvalidation = Math.min(
    bidWallBelowEntry ? bidWallBelowEntry.price - 0.25 * A : Infinity,
    swingBelowEntry ? swingBelowEntry.price - 0.2 * A : Infinity
  );
  const longStop = Math.max(Math.min(longEntry - 0.55 * A, longInvalidation, longEntry * 0.9965), longEntry - 1.3 * A);
  const longRisk = longEntry - longStop;
  const longTp1 = above.find((a) => a.price >= longEntry && (a.price - longEntry) / longRisk >= 1.1) ?? { price: longEntry + 1.2 * A, tag: "1.2ATR" };
  const longTp2 = above.find((a) => a.price >= longTp1.price + 0.7 * longRisk) ?? {
    price: longEntry + Math.max(2 * longRisk, longRisk + 0.5 * A),
    tag: "2R"
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
      riskPct: shortRisk / shortEntry * 100,
      rr1: shortRisk > 0 ? (shortEntry - shortTp1.price) / shortRisk : 0,
      rr2: shortRisk > 0 ? (shortEntry - shortTp2.price) / shortRisk : 0
    },
    long: {
      entry: longEntry,
      entryTag: longEntryAnchor.tag,
      stop: longStop,
      tp1: longTp1.price,
      tp1Tag: longTp1.tag,
      tp2: longTp2.price,
      tp2Tag: longTp2.tag,
      riskPct: longRisk / longEntry * 100,
      rr1: longRisk > 0 ? (longTp1.price - longEntry) / longRisk : 0,
      rr2: longRisk > 0 ? (longTp2.price - longEntry) / longRisk : 0
    }
  };
}
function buildCard({ sym, px, s5, s15, cvd: cvd2, taker, oi, walls, depth1, whales, levels }) {
  const total = s5.score + s15.score + cvd2.score + taker.score + oi.score;
  const m = total / 100;
  const W = [30, 30, 15, 15, 10];
  const parts = [s5.score, s15.score, cvd2.score, taker.score, oi.score];
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
    statusLine = bias === "short" ? `\u{1F7E5} \u505A\u7A7A\uFF08\u6982\u7387${prob}%\uFF0C${agree}/5 \u56E0\u5B50\u540C\u5411\uFF0C15m/5m \u7ED3\u6784\u5171\u632F\uFF09` : `\u{1F7E9} \u505A\u591A\uFF08\u6982\u7387${prob}%\uFF0C${agree}/5 \u56E0\u5B50\u540C\u5411\uFF0C15m/5m \u7ED3\u6784\u5171\u632F\uFF09`;
    if (agree < 3) {
      statusLine = `\u{1F534} \u89C2\u671B\uFF08\u6982\u7387${prob}% \u4F46\u4EC5 ${agree}/5 \u56E0\u5B50\u540C\u5411\uFF0C\u4FE1\u53F7\u4E0D\u7EAF\uFF09`;
      status = "wait";
    }
  } else if (prob >= 52) {
    status = "wait";
    statusLine = `\u{1F534} \u89C2\u671B\uFF08\u6982\u7387${prob}%\uFF0C${bias === "short" ? "\u504F\u7A7A" : bias === "long" ? "\u504F\u591A" : "\u4E2D\u6027"}\uFF0C\u7B49${bias === "short" ? "15m \u7834\u4F4D/\u53CD\u62BD\u5356\u5899\u786E\u8BA4" : "15m \u7AD9\u7A33/\u56DE\u8E29\u4E70\u5899\u786E\u8BA4"}\uFF09`;
  } else {
    status = "wait";
    statusLine = `\u{1F534} \u89C2\u671B\uFF08\u591A\u7A7A\u56E0\u5B50\u4E92\u62B5\uFF0C\u6982\u7387\u4EC5${prob}%\uFF0C\u7B49\u7ED3\u6784/\u8BA2\u5355\u6D41\u7ED9\u51FA\u65B9\u5411\uFF09`;
  }
  const trendWord = aligned && bias === "short" ? "\u7A7A\u5934\u5171\u632F" : aligned && bias === "long" ? "\u591A\u5934\u5171\u632F" : bias === "short" ? "\u9707\u8361\u504F\u7A7A" : bias === "long" ? "\u9707\u8361\u504F\u591A" : "\u9707\u8361\u6574\u7406";
  const L = levels;
  const biasWord = bias === "short" ? "\u504F\u7A7A" : bias === "long" ? "\u504F\u591A" : "\u4E2D\u6027";
  const structWord = aligned ? bias === "short" ? "5m/15m \u7A7A\u5934\u5171\u632F" : "5m/15m \u591A\u5934\u5171\u632F" : "5m \u4E0E 15m \u7ED3\u6784\u5206\u6B67";
  const flowWord = taker.score < -3 ? "\u4E3B\u52A8\u5356\u538B\u4E3B\u5BFC" : taker.score > 3 ? "\u4E3B\u52A8\u4E70\u76D8\u4E3B\u5BFC" : "\u4E3B\u52A8\u6D41\u5747\u8861";
  const oiWord = oi.missing ? "" : `\uFF0COI ${oi.regime}`;
  const rsiWarn = bias === "short" && s5.rsi <= 32 ? `\uFF085m RSI ${Math.round(s5.rsi)} \u8D85\u5356\uFF0C\u52FF\u8FFD\u7A7A\uFF09` : bias === "long" && s5.rsi >= 68 ? `\uFF085m RSI ${Math.round(s5.rsi)} \u8D85\u4E70\uFF0C\u52FF\u8FFD\u591A\uFF09` : "";
  const pct = (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
  const wallNote = bias === "short" && (depth1?.imb ?? 0) > 0.1 ? `\uFF1B\u4F46\xB11% \u4E70\u5899\u504F\u539A\uFF08${pct(depth1.imb)}\uFF09\uFF0C\u7A7A\u5355\u9632\u63D2\u9488` : bias === "long" && (depth1?.imb ?? 0) < -0.1 ? `\uFF1B\u4F46\xB11% \u5356\u5899\u504F\u539A\uFF08${pct(depth1.imb)}\uFF09\uFF0C\u591A\u5355\u9632\u5047\u7A81\u7834` : "";
  const concl = `${biasWord}\uFF08${prob}%\uFF09\uFF5C${structWord}\uFF0C${flowWord}${oiWord}${rsiWarn}${wallNote}\uFF1B` + (status === "short" ? `\u82E5\u53CD\u62BD ${fmtPx(L.short.entry, px)} \u9644\u8FD1\u88AB\u5356\u5899\u538B\u56DE\u53EF\u7A7A\uFF0C\u6B62\u635F ${fmtPx(L.short.stop, px)}\uFF0C\u76EE\u6807 ${fmtPx(L.short.tp1, px)}\u2192${fmtPx(L.short.tp2, px)}\uFF1B` : status === "long" ? `\u56DE\u8E29 ${fmtPx(L.long.entry, px)} \u6709\u4E70\u5899\u627F\u63A5\u53EF\u591A\uFF0C\u6B62\u635F ${fmtPx(L.long.stop, px)}\uFF0C\u76EE\u6807 ${fmtPx(L.long.tp1, px)}\u2192${fmtPx(L.long.tp2, px)}\uFF1B` : `\u6682\u4E0D\u5165\u573A\uFF0C\u7B49${bias === "short" ? `\u53CD\u62BD ${fmtPx(L.short.entry, px)} \u9047\u963B` : `\u56DE\u8E29 ${fmtPx(L.long.entry, px)} \u627F\u63A5`}\u518D\u52A8\uFF1B`) + `\u4E0A\u65B9\u8FD1\u7AEF\u963B\u529B ${walls?.nearestAsk ? fmtPx(walls.nearestAsk.price, px) : "\u2014"}\uFF0C\u4E0B\u65B9\u8FD1\u7AEF\u652F\u6491 ${walls?.nearestBid ? fmtPx(walls.nearestBid.price, px) : "\u2014"}\u3002`;
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
      { key: "s5", label: "5m\u7ED3\u6784", weight: 30, score: s5.score, parts: s5.parts, note: s5.note, zone: s5.zone, rsi: s5.rsi },
      { key: "s15", label: "15m\u7ED3\u6784", weight: 30, score: s15.score, parts: s15.parts, note: s15.note, zone: s15.zone, rsi: s15.rsi },
      { key: "cvd", label: "CVD", weight: 15, score: cvd2.score, parts: cvd2.parts, missing: cvd2.missing, buyRatio: cvd2.buyRatio, quadrant: cvd2.quadrant },
      { key: "taker", label: "Taker", weight: 15, score: taker.score, missing: taker.missing, ratio: taker.ratio },
      { key: "oi", label: "OI", weight: 10, score: oi.score, missing: oi.missing, regime: oi.regime, dOiPct: oi.dOiPct }
    ]
  };
}
function volumeProfile(candles, binCount = 60) {
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
var utcDayStart = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// src/wall-events.js
function decodeBookRow(row, size) {
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
    const q3 = +b[1];
    if (!(q3 > 0) || p > bb) continue;
    const k = Math.round(p / size);
    flat.push(k, q3);
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  for (const a of asks) {
    const p = +a[0];
    const q3 = +a[1];
    if (!(q3 > 0) || p < ba) continue;
    const k = Math.round(p / size);
    flat.push(k, q3);
    if (k < kMin) kMin = k;
    if (k > kMax) kMax = k;
  }
  if (!flat.length) return null;
  const q2 = new Float64Array(kMax - kMin + 1);
  for (let i = 0; i < flat.length; i += 2) q2[flat[i] - kMin] += flat[i + 1];
  return { t: 1e3 * Number(row[0]), g: size, k0: kMin, q: q2, bb, ba, mid: (bb + ba) / 2 };
}
function rebinInto(s, grid, n, count, out) {
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
var SCRATCH = new Float64Array(3e4);
var WallScanner = class {
  constructor() {
    this.st = /* @__PURE__ */ new Map();
    this.events = [];
  }
  current() {
    return [...this.st.values()].filter((w) => w.shown).sort((a, b) => b.usd - a.usd);
  }
  scan(s, isLive, grid, minUsd, range) {
    if (!(grid > 0) || !s) return;
    const r = s.mid;
    const n = Math.floor(0.97 * r / grid);
    const count = Math.ceil(1.03 * r / grid) - n + 1;
    if (count > SCRATCH.length || count < 3) return;
    rebinInto(s, grid, n, count, SCRATCH);
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
    const seen = /* @__PURE__ */ new Set();
    const [loP, hiP] = range;
    const touched = (w) => w.side === "b" ? loP < w.p + w.G : hiP >= w.p;
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
            mid: s.mid
          });
        }
      }
    }
  }
  pushEvent(e) {
    this.events.push(e);
    if (this.events.length > 600) this.events.splice(0, this.events.length - 400);
  }
};
var KIND = { add: "added", fill: "eaten", pull: "pulled" };
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
    while (j < bars.length && bars[j].ts < from) j++;
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
function scanWallEvents(snaps, { minUsd, candles = [], candleStepMs = 0, stepMs = 9e5, limit = 12, grid } = {}) {
  const sorted = [...snaps].filter(Boolean).sort((a, b) => a.t - b.t);
  if (!sorted.length) return { events: [], window: null, grid: null };
  const g = grid && grid > 0 ? grid : sorted[sorted.length - 1].g;
  const ranges = candleStepMs > 0 ? rangesFromCandles(sorted, candles, candleStepMs) : null;
  const scanner = new WallScanner();
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    scanner.scan(s, false, g, minUsd, ranges ? ranges[i] : [s.bb, s.ba]);
  }
  const last2 = sorted[sorted.length - 1];
  const dec2 = last2.mid >= 1e3 ? 2 : last2.mid >= 100 ? 2 : last2.mid >= 1 ? 3 : 5;
  const rows = scanner.events.map((e) => ({
    t: e.t,
    type: KIND[e.type] ?? e.type,
    side: e.side,
    price: +(e.p + g / 2).toFixed(dec2),
    usd: Math.round(e.usd),
    qty: +e.qty.toFixed(4),
    mid: +(e.mid ?? last2.mid).toFixed(dec2 + 1),
    distPct: +(((e.p + g / 2) / (e.mid ?? last2.mid) - 1) * 100).toFixed(2)
  })).sort((a, b) => b.t - a.t);
  const counts = { added: 0, pulled: 0, eaten: 0 };
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  const walls = scanner.current().map((w) => ({
    side: w.side,
    price: w.p + g / 2,
    usd: Math.round(w.usd),
    qty: +w.qty.toFixed(4),
    distPct: +(((w.p + g / 2) / last2.mid - 1) * 100).toFixed(2),
    firstSeen: w.first,
    ageMs: last2.t - w.first,
    touched: !!w.touch
  })).sort((a, b) => b.usd - a.usd);
  return {
    events: rows.slice(0, Math.max(1, Math.min(limit, 40))),
    counts,
    total: rows.length,
    walls,
    window: { from: sorted[0].t, to: last2.t, snapshots: sorted.length, minUsd: Math.round(minUsd), grid: g }
  };
}

// src/cg-data.js
var SYMBOLS = ["ETH", "BTC", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE", "LINK", "LTC", "XAU", "XAG"];
var METALS = /* @__PURE__ */ new Set(["XAU", "XAG", "XPT"]);
var isSupported = (s) => SYMBOLS.includes(String(s).toUpperCase());
var q = encodeURIComponent;
var ITV_SEC = { m1: 60, m5: 300, m15: 900, h1: 3600, h4: 14400, d1: 86400 };
function leadKey(sym) {
  return `Binance_${sym}USDT`;
}
function fpVenues(sym) {
  return [
    { id: "binance-perp", key: `Binance_${sym}USDT` },
    { id: "okx-perp", key: `OKX_${sym}-USDT-SWAP` },
    { id: "bybit-perp", key: `Bybit_${sym}USDT` },
    { id: "hyperliquid-perp", key: `Hyperliquid_${sym}-USD` }
  ];
}
function cvdVenues(sym) {
  return [
    { key: `Binance_${sym}USDT`, venue: "Binance", kind: "perp" },
    { key: `OKX_${sym}-USDT-SWAP`, venue: "OKX", kind: "perp" },
    { key: `Bybit_${sym}USDT`, venue: "Bybit", kind: "perp" },
    { key: `Bitget_${sym}USDT_UMCBL`, venue: "Bitget", kind: "perp" },
    { key: `Binance_SPOT_${sym}USDT`, venue: "Binance", kind: "spot" }
  ];
}
function aggExchanges(sym) {
  return METALS.has(sym) ? ["Binance"] : ["Binance", "OKX", "Gate", "Bitget", "Hyperliquid"];
}
async function kline(sym, itv, limit, ttl = 15e3) {
  const rows = await cgGet(
    `/api/v2/kline?symbol=${q(`${leadKey(sym)}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`,
    { ttl }
  );
  const arr = Array.isArray(rows) ? rows : rows?.data ?? [];
  return arr.map((r) => ({ ts: Number(r[0]) * 1e3, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).filter((b) => b.c > 0 && Number.isFinite(b.ts));
}
async function footprint(sym, itv = "m15", limit = 64) {
  const venues = fpVenues(sym);
  const shiftVenues = venues.filter((v) => v.id === "hyperliquid-perp");
  const jobs = [
    kline(sym, itv, limit),
    ...venues.map(
      (v) => cgGet(`/api/orderFlow?symbol=${q(`${v.key}#order_flow`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 2e4
      }).catch(() => null)
    ),
    ...shiftVenues.map(
      (v) => cgGet(`/api/v2/kline?symbol=${q(`${v.key}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 2e4
      }).catch(() => null)
    )
  ];
  const [lead, ...rest] = await Promise.all(jobs);
  const flows = rest.slice(0, venues.length);
  const shiftKlines = rest.slice(venues.length);
  const missing = [];
  const maps = flows.map((rows, i) => {
    if (!Array.isArray(rows) || !rows.length) {
      missing.push(venues[i].id);
      return /* @__PURE__ */ new Map();
    }
    const m = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (!Array.isArray(row) || row[0] == null) continue;
      m.set(Number(row[0]) * 1e3, fpFromBuckets(row[1]));
    }
    return m;
  });
  const leadClose = new Map(lead.map((b) => [b.ts, b.c]));
  shiftVenues.forEach((v, si) => {
    const idx = venues.findIndex((x) => x.id === v.id);
    const rows = shiftKlines[si];
    if (idx < 0 || !Array.isArray(rows)) return;
    const closes = new Map(rows.map((r) => [Number(r[0]) * 1e3, +r[4]]));
    const shifted = /* @__PURE__ */ new Map();
    for (const [ts, fp] of maps[idx]) {
      const vc = closes.get(ts);
      const lc = leadClose.get(ts);
      const off = vc != null && lc != null ? lc - vc : 0;
      shifted.set(ts, off && fp ? { ...fp, lo: fp.lo + off } : fp);
    }
    maps[idx] = shifted;
  });
  const bars = [];
  for (const b of lead) {
    const fs = [];
    for (const m of maps) {
      const f = m.get(b.ts);
      if (f) fs.push(f);
    }
    const fp = fs.length > 1 ? mergeFp(fs) : fs[0] ?? null;
    bars.push({ ts: b.ts, o: b.o, h: b.h, l: b.l, c: b.c, fp });
  }
  const buckets = bars.filter((b) => b.fp && b.fp.b.length).length;
  return {
    bars,
    venues: venues.map((v) => v.id).filter((id) => !missing.includes(id)),
    missing,
    buckets
  };
}
async function cvd(sym, itv = "m15", limit = 150) {
  const venues = cvdVenues(sym);
  const stepMs = (ITV_SEC[itv] ?? 900) * 1e3;
  const [priceRows, ...flows] = await Promise.all([
    cgGet(
      `/api/v2/kline?symbol=${q(`${leadKey(sym)}#kline`)}&interval=${itv}&minLimit=false&limit=${limit}`,
      { ttl: 3e4 }
    ),
    ...venues.map(
      (v) => cgGet(`/api/v2/kline?symbol=${q(`${v.key}#bs_usd`)}&interval=${itv}&minLimit=false&limit=${limit}`, {
        ttl: 3e4
      }).catch(() => null)
    )
  ]);
  const candles = (Array.isArray(priceRows) ? priceRows : priceRows?.data ?? []).filter((r) => Number.isFinite(+r[4]));
  if (!candles.length) throw new Error("cvd: no candles");
  const grid = new FlowGrid(stepMs, venues.map((v) => v.key));
  grid.setCandles(candles);
  let anyFlow = false;
  const loaded = [];
  flows.forEach((rows, i) => {
    const arr = Array.isArray(rows) ? rows : rows?.data ?? [];
    const ok = Array.isArray(arr) && arr.length > 0;
    if (ok) anyFlow = true;
    loaded.push({ key: venues[i].key, venue: venues[i].venue, kind: venues[i].kind, ok });
    if (ok) grid.mergeFlow(i, flowRows(arr));
  });
  if (!anyFlow) throw new Error("cvd: no taker flow rows");
  const series = recompute(grid, venues);
  const divs = detectDivergences(series, series.total);
  const kpis = cvdKpis(series, "all", divs);
  const r1e6 = (x) => Math.round(x / 1e6);
  return {
    ok: true,
    itv,
    n: series.n,
    priceKey: leadKey(sym),
    instruments: loaded,
    candles: series.ts.map((t, i) => [t, series.o[i], series.h[i], series.l[i], series.c[i]]),
    delta: Array.from(series.delta, r1e6),
    perp: Array.from(series.perp.slice(1), r1e6),
    spot: Array.from(series.spot.slice(1), r1e6),
    ratio: Array.from(series.ratio, (x) => Number.isFinite(x) ? +x.toFixed(4) : null),
    kpis: {
      perpCvd: r1e6(kpis.perpCvd),
      spotCvd: r1e6(kpis.spotCvd),
      perpBuy: r1e6(kpis.perpBuy),
      perpSell: r1e6(kpis.perpSell),
      spotBuy: r1e6(kpis.spotBuy),
      spotSell: r1e6(kpis.spotSell),
      buyRatio: Number.isFinite(kpis.buyRatio) ? +(kpis.buyRatio * 100).toFixed(1) : null,
      quadrant: kpis.quadrant,
      latestDiv: kpis.latestDiv ? { type: kpis.latestDiv.t, ts: kpis.latestDiv.ts, price: +kpis.latestDiv.priceB.toFixed(2) } : null
    },
    divergences: divs.slice(-6).map((d) => ({
      type: d.t,
      ts: d.ts,
      priceA: +d.priceA.toFixed(2),
      priceB: +d.priceB.toFixed(2),
      hit: d.hit ?? null,
      ret12: d.r != null ? +(d.r * 100).toFixed(2) : null
    })),
    updatedAt: Date.now()
  };
}
async function openInterest(sym, ttl = 3e4) {
  const raw = await cgGet(`/api/openInterest/v3/chart?symbol=${q(sym)}&type=0&timeType=2`, { ttl });
  const dataMap = raw?.dataMap && typeof raw.dataMap === "object" ? raw.dataMap : {};
  const dateList = Array.isArray(raw?.dateList) ? raw.dateList : [];
  let totalLatest = 0;
  let total1h = 0;
  let total4h = 0;
  let total24h = 0;
  const venues = [];
  for (const [name, vals] of Object.entries(dataMap)) {
    if (!Array.isArray(vals) || !vals.length) continue;
    const latest = vals[vals.length - 1] ?? 0;
    venues.push({ name, oiUsd: Math.round(latest) });
    totalLatest += latest;
    if (vals.length >= 2) total1h += vals[vals.length - 2] ?? latest;
    if (vals.length >= 5) total4h += vals[vals.length - 5] ?? latest;
    const i24 = vals.length >= 25 ? vals.length - 25 : 0;
    total24h += vals[i24] ?? latest;
  }
  if (!venues.length) return { ok: false, aggregate: null };
  venues.sort((a, b) => b.oiUsd - a.oiUsd);
  const pct = (a, b) => b > 0 ? +((a - b) / b * 100).toFixed(2) : null;
  return {
    ok: true,
    n: dateList.length,
    venues: venues.slice(0, 8).map((v) => ({ ...v, sharePct: totalLatest ? +(v.oiUsd / totalLatest * 100).toFixed(1) : null })),
    aggregate: {
      oiUsd: Math.round(totalLatest),
      oiDelta1hPct: pct(totalLatest, total1h),
      oiDelta4hPct: pct(totalLatest, total4h),
      oiDelta24hPct: pct(totalLatest, total24h)
    },
    updatedAt: Date.now()
  };
}
var venueCache = /* @__PURE__ */ new Map();
var VENUE_TTL = 36e5;
var WALL_MIN_USD = {
  BTC: 15e5,
  ETH: 8e5,
  XAU: 1e6,
  XAG: 5e5,
  SOL: 3e5,
  XRP: 3e5,
  BNB: 3e5,
  DOGE: 3e5,
  ADA: 3e5,
  AVAX: 3e5,
  LINK: 3e5,
  LTC: 3e5
};
function minWallUsd(sym) {
  return WALL_MIN_USD[sym] ?? 15e4;
}
function rejectedVenue(msg) {
  const m = /No supported \w+ heatmap pair for .+? on (.+?)\s*$/.exec(msg);
  return m ? m[1] : null;
}
function aggStreamUrl(coin, venues, { market, interval, limit }) {
  const qs = new URLSearchParams({
    coin,
    exchanges: venues.join(","),
    market,
    interval,
    limit: String(limit),
    batchSize: "10",
    endTime: String(Math.floor(Date.now() / 1e3))
  });
  return `${CAPI}/liquidity-heatmap/api/liquidity/heatmap/aggregate/stream?${qs.toString()}`;
}
async function aggStream(sym, { market = "futures", interval = "m15", limit = 2, timeoutMs = 12e3 } = {}) {
  const ck = `${sym}|${market}`;
  const hit = venueCache.get(ck);
  const cached = hit && Date.now() - hit.at < VENUE_TTL;
  let venues = cached ? [...hit.venues] : aggExchanges(sym);
  let lastErr = null;
  for (let guard = 0; guard < 6 && venues.length; guard++) {
    try {
      const stream = await cgStream(aggStreamUrl(sym, venues, { market, interval, limit }), timeoutMs);
      if (!cached || venues.join(",") !== hit.venues.join(",")) {
        venueCache.set(ck, { at: Date.now(), venues: [...venues] });
        if (venueCache.size > 64) venueCache.delete(venueCache.keys().next().value);
      }
      return { venues, stream };
    } catch (e) {
      lastErr = e;
      const bad = rejectedVenue(e instanceof Error ? e.message : "");
      if (!bad) throw e;
      const next = venues.filter((v) => v !== bad);
      if (next.length === venues.length) throw e;
      venues = next;
    }
  }
  throw lastErr ?? new Error(`walls: no heatmap venue for ${sym}`);
}
function snapshotCells(snap, bandPct = 15) {
  const out = [];
  const g = snap.g;
  const mid = snap.mid;
  for (let i = 0; i < snap.q.length; i++) {
    const qty = snap.q[i];
    if (!(qty > 0)) continue;
    const p = (snap.k0 + i) * g;
    const c = p + g / 2;
    if (Math.abs(c / mid - 1) > bandPct / 100) continue;
    out.push([p, qty * c, c < mid ? "b" : "a"]);
  }
  return out;
}
async function bookWalls(sym, { band = 5, snapshots = 2, history = true, events = true, eventSnapshots = 40, eventLimit = 12 } = {}) {
  const wantEvents = events !== false && events !== 0;
  const back = wantEvents ? Math.min(Math.max(Number(eventSnapshots) || 40, 6), 96) : 1;
  const want = Math.max(Number(snapshots) || 1, back);
  const { venues, stream } = await aggStream(sym, {
    interval: "m15",
    limit: want,
    timeoutMs: wantEvents ? 25e3 : 12e3
  });
  const snaps = stream.rows.map((r) => decodeBookRow(r, stream.size)).filter(Boolean).sort((a, b) => a.t - b.t);
  if (!snaps.length) throw new Error("walls: empty aggregate stream");
  const snap = snaps[snaps.length - 1];
  const mid = snap.mid;
  const cells = snapshotCells(snap);
  const depth = (pct) => {
    const lo = mid * (1 - pct / 100);
    const hi = mid * (1 + pct / 100);
    let bidUsd = 0;
    let askUsd = 0;
    for (const [p, usd, side] of cells) {
      const c = p + snap.g / 2;
      if (c <= lo || c >= hi) continue;
      if (side === "b") bidUsd += usd;
      else askUsd += usd;
    }
    return { bandPct: pct, bidUsd, askUsd, imb: bidUsd + askUsd > 0 ? (bidUsd - askUsd) / (bidUsd + askUsd) : 0 };
  };
  let scan = null;
  if (wantEvents && snaps.length >= 2) {
    const bars = await kline(sym, "m5", 300, 2e4).catch(() => []);
    scan = scanWallEvents(snaps, {
      minUsd: minWallUsd(sym),
      candles: bars.map((b) => ({ ts: b.ts, h: b.h, l: b.l })),
      candleStepMs: 3e5,
      limit: eventLimit
    });
  }
  const dec2 = mid >= 100 ? 2 : mid >= 1 ? 3 : 5;
  let walls = (scan?.walls ?? []).map((w) => ({ ...w, price: +w.price.toFixed(dec2) }));
  if (!walls.length) {
    const thresh = minWallUsd(sym);
    for (const [p, usd, side] of cells) {
      if (usd < thresh || Math.abs(p / mid - 1) > 0.03) continue;
      walls.push({ side, price: p, usd: Math.round(usd), qty: null, distPct: +((p / mid - 1) * 100).toFixed(2) });
    }
  }
  walls.sort((a, b) => b.usd - a.usd);
  const strip = [];
  if (history) {
    for (const s of snaps.slice(-24)) {
      const rows = [];
      for (let i = 0; i < s.q.length; i++) {
        const qty = s.q[i];
        if (!(qty > 0)) continue;
        const p = (s.k0 + i) * s.g;
        const c = p + s.g / 2;
        if (Math.abs(c / s.mid - 1) > 0.03) continue;
        rows.push([p, Math.round(qty * c)]);
      }
      strip.push({ t: s.t, mid: s.mid, cells: rows });
    }
  }
  return {
    ok: true,
    sym,
    source: "coinglass-aggregate",
    venues,
    gridStep: stream.size,
    mid,
    depth1: depth(1),
    depth5: depth(band),
    imbalance: depth(1).imb,
    walls: walls.slice(0, 14),
    events: scan?.events ?? [],
    eventCounts: scan?.counts ?? null,
    eventTotal: scan?.total ?? 0,
    eventWindow: scan?.window ?? null,
    strip,
    ladder: cells.filter(([p]) => Math.abs(p / mid - 1) <= 0.012).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([p, usd, side]) => ({ price: p, usd: Math.round(usd), side })),
    snapshots: snaps.length,
    updatedAt: snap.t
  };
}
async function largeOrders(sym, { minVolUsd = 1e5, exchanges = ["Binance", "OKX", "Bybit"] } = {}) {
  const settled = await Promise.allSettled(
    exchanges.map(
      (ex) => cgGet(`/api/largeTakerOrder/v3?exchange=${q(ex)}&symbol=${q(sym)}&market=all&limit=3000&minVolUsd=${minVolUsd}`, {
        host: FAPI,
        ttl: 25e3
      })
    )
  );
  const groups = [];
  settled.forEach((r) => {
    if (r.status === "fulfilled" && Array.isArray(r.value)) groups.push(...r.value);
  });
  return { groups, ok: groups.length > 0 };
}
async function whalesPanel(sym, { minVolUsd = 1e5 } = {}) {
  const min = Math.min(Math.max(Number(minVolUsd) || 1e5, 1e4), 5e6);
  const [tick, lto] = await Promise.all([kline(sym, "m1", 2, 5e3), largeOrders(sym, { minVolUsd: min })]);
  const px = tick.length ? tick[tick.length - 1].c : 0;
  const rows = [];
  for (const g of lto.groups) {
    const inst = g.instrument ?? {};
    for (const o of g.list ?? []) {
      if (!o || !Number.isFinite(o.price) || !Number.isFinite(o.currentUsd)) continue;
      if (px && Math.abs(o.price / px - 1) > 0.15) continue;
      rows.push({
        ex: inst.exName ?? "?",
        inst: inst.instrumentId ?? "",
        kind: inst.type === 10 ? "spot" : "perp",
        price: o.price,
        usd: Math.round(o.currentUsd),
        side: o.side === 2 ? "buy" : "sell",
        t: o.startTime ?? o.currentTime ?? 0
      });
    }
  }
  rows.sort((a, b) => b.usd - a.usd);
  const now = Date.now();
  const h1 = rows.filter((r) => r.t >= now - 36e5);
  const sum2 = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
  return {
    ok: true,
    sym,
    price: px,
    minVolUsd: min,
    rows: rows.slice(0, 80),
    stats: {
      total: rows.length,
      h1: {
        n: h1.length,
        buy: Math.round(sum2(h1.filter((r) => r.side === "buy"), (r) => r.usd)),
        sell: Math.round(sum2(h1.filter((r) => r.side === "sell"), (r) => r.usd))
      },
      perp: rows.filter((r) => r.kind === "perp").length,
      spot: rows.filter((r) => r.kind === "spot").length
    },
    updatedAt: now
  };
}
async function liqLevels(sym, { limit = 400, range = "3d", lvR = 4, px = 0 } = {}) {
  const venueKey = `Binance_${sym}USDT`;
  const raw = await cgGet(`/api/liquidationLevels/v2?symbol=${q(venueKey)}&limit=${limit}&range=${range}`, {
    ttl: 6e4
  });
  const payload = Array.isArray(raw?.data) ? raw : raw?.data?.data ? raw.data : null;
  const levels = Array.isArray(payload?.data) ? payload.data : Array.isArray(raw) ? raw : [];
  if (!levels.length) return { ok: false, above: [], below: [], venue: "Binance" };
  const now = Date.now() / 1e3;
  const open = levels.filter((l) => !l.endDate && Number.isFinite(l.price) && Number.isFinite(l.size));
  const ref = px > 0 ? px : open.length ? open[open.length - 1].price : 0;
  const grid = Math.max(ref * 15e-4, 1e-9);
  const bucket = (l) => Math.round(l.price / grid);
  const rows = /* @__PURE__ */ new Map();
  for (const l of open) {
    const side = Number(l.side) === 2 ? "above" : "below";
    const k = bucket(l);
    const key = `${k}|${side}`;
    const cur = rows.get(key) ?? { price: (k + 0.5) * grid, size: 0, side };
    cur.size += Number(l.size) || 0;
    rows.set(key, cur);
  }
  const all = [...rows.values()].filter((r) => r.price > 0 && Math.abs(r.price / ref - 1) <= lvR / 100);
  const above = all.filter((r) => r.price > ref).sort((a, b) => b.size - a.size).slice(0, 5).sort((a, b) => a.price - b.price);
  const below = all.filter((r) => r.price < ref).sort((a, b) => b.size - a.size).slice(0, 5).sort((a, b) => b.price - a.price);
  const mx = Math.max(1, ...above.map((r) => r.size), ...below.map((r) => r.size));
  const mk = (r) => ({ price: +r.price.toFixed(ref > 100 ? 2 : 4), strength: Math.round(r.size / mx * 100), size: Math.round(r.size) });
  return {
    ok: true,
    venue: "Binance",
    range,
    openRows: open.length,
    last: ref,
    above: above.map(mk),
    below: below.map(mk)
  };
}
function marketFromBars(bars15, barsH1, px, now = Date.now()) {
  const dayStart = utcDayStart(now);
  const sessionStart = now - 8 * 36e5;
  const day = volumeProfile(bars15.filter((b) => b.ts >= dayStart));
  const session = volumeProfile(bars15.filter((b) => b.ts >= sessionStart));
  const prevDay = bars15.filter((b) => b.ts < dayStart);
  const pdh = prevDay.length ? Math.max(...prevDay.map((b) => b.h)) : null;
  const pdl = prevDay.length ? Math.min(...prevDay.map((b) => b.l)) : null;
  const dayBars = bars15.filter((b) => b.ts >= dayStart && b.v > 0);
  let vwap = null;
  let sd = 0;
  if (dayBars.length) {
    let sv = 0;
    let svp = 0;
    let svp2 = 0;
    for (const c of dayBars) {
      const tp = (c.h + c.l + c.c) / 3;
      sv += c.v;
      svp += c.v * tp;
      svp2 += c.v * tp * tp;
    }
    vwap = svp / sv;
    sd = Math.sqrt(Math.max(0, svp2 / sv - vwap * vwap));
  }
  return {
    auction: { day, session },
    levels: { pdh, pdl },
    vwap: vwap ? { vwap, sd1: vwap - sd, sd1u: vwap + sd } : null,
    price: px
  };
}

// src/brief.js
var pctOf = (a, b) => b > 0 ? (a - b) / b * 100 : null;
async function buildBrief(sym, opts = {}) {
  const fpLim = Math.min(Math.max(Number(opts.fpLim) || 64, 24), 120);
  const withLiq = opts.liq !== false;
  const withWhales = opts.whales !== false;
  const errors = [];
  const settle = async (label, p) => {
    try {
      return await p;
    } catch (e) {
      errors.push({ panel: label, message: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  const [bars5, bars15, barsH1, fpRes, cvdRes, oiRes, wallsRes, liqRes, ltoRes] = await Promise.all([
    settle("kline5m", kline(sym, "m5", 60, 6e3)),
    settle("kline15m", kline(sym, "m15", 96)),
    settle("kline1h", kline(sym, "h1", 25)),
    settle("footprint", footprint(sym, "m15", fpLim)),
    settle("cvd", cvd(sym, "m15", 150)),
    settle("oi", openInterest(sym)),
    settle("walls", bookWalls(sym, { band: 5, snapshots: 1, history: false, events: true, eventSnapshots: 40, eventLimit: 12 })),
    withLiq ? settle("liq", liqLevels(sym, { limit: 240, range: "3d", px: 0 })) : Promise.resolve(null),
    withWhales ? settle("whales", largeOrders(sym, { exchanges: ["Binance"] })) : Promise.resolve(null)
  ]);
  const px = (bars5 && bars5.length ? bars5[bars5.length - 1].c : null) ?? (bars15 && bars15.length ? bars15[bars15.length - 1].c : null);
  if (!(px > 0)) {
    return { ok: false, sym, error: errors.find((e) => e.panel.startsWith("kline"))?.message ?? "no price", errors };
  }
  const decs = px >= 1e3 ? 2 : px >= 100 ? 2 : px >= 1 ? 3 : 5;
  const chg24hPct = barsH1 && barsH1.length >= 20 ? pctOf(px, barsH1[0].c) : null;
  const px1hAgo = bars15 && bars15.length >= 5 ? bars15[bars15.length - 5].c : px;
  const px1hPct = pctOf(px, px1hAgo) ?? 0;
  const s5 = bars5 && bars5.length >= 30 ? scoreStructure(bars5, "5m") : null;
  const s15 = bars15 && bars15.length >= 30 ? scoreStructure(bars15, "15m") : null;
  const fpBars = fpRes?.bars ?? [];
  const fpSigs = fpBars.length ? computeFpSignals(fpBars) : [];
  const fpSummary = fpBars.length ? fpSignalSummary(fpSigs, px) : { line: "\u8DB3\u8FF9\u4FE1\u53F7(15m)\uFF1A\u6682\u65E0\u6570\u636E", groups: [], count: 0, bull: 0, bear: 0, recent: [] };
  const cvdScore = cvdRes ? scoreCvd(fetchCvdShape(cvdRes), cvdRes.updatedAt) : { score: 0, missing: true };
  const taker = fpRes ? scoreTaker({ bars: fpBars }) : { score: 0, missing: true };
  const oiScore = oiRes ? scoreOi(oiRes, px1hPct) : { score: 0, missing: true };
  const walls = wallsRes ? wallStats(
    { model: { walls: wallsRes.walls, events: wallsRes.events ?? [], strip: [], depth: wallsRes.depth5, imbalance: wallsRes.imbalance } },
    px
  ) : null;
  const depth1 = wallsRes?.depth1 ?? null;
  const depth5 = wallsRes?.depth5 ?? null;
  const whales = ltoRes ? whaleFlow({ groups: ltoRes.groups, minVolUsd: 1e5 }, px) : null;
  const liq = liqRes ? { above: liqRes.above ?? [], below: liqRes.below ?? [] } : null;
  const market = marketFromBars(bars15 ?? [], barsH1 ?? [], px);
  const levels = s5 && s15 ? buildLevels({ px, s5, s15, market, liq, walls, atr15: s15.atr, ltoClusters: whales?.anchorClusters ?? [] }) : null;
  const card = s5 && s15 ? buildCard({ sym, px, s5, s15, cvd: cvdScore, taker, oi: oiScore, walls, depth1, whales, levels }) : { prob: null, status: "wait", statusLine: "\u{1F534} \u6570\u636E\u4E0D\u8DB3\uFF0C\u65E0\u6CD5\u7ED9\u51FA\u6982\u7387", conclusion: "", factors: [] };
  return {
    ok: true,
    sym,
    lead: leadKey(sym),
    price: px,
    decs,
    chg24hPct: chg24hPct == null ? null : +chg24hPct.toFixed(2),
    chg1hPct: +px1hPct.toFixed(2),
    candleTs: bars5 && bars5.length ? bars5[bars5.length - 1].ts : null,
    fetchedAt: Date.now(),
    card,
    fp: {
      line: fpSummary.line,
      groups: fpSummary.groups,
      count: fpSummary.count,
      bull: fpSummary.bull,
      bear: fpSummary.bear,
      recent: fpSummary.recent,
      buckets: fpRes?.buckets ?? 0,
      bars: fpBars.length,
      venues: fpRes?.venues ?? [],
      missing: fpRes?.missing ?? []
    },
    levels,
    walls: wallsRes ? {
      mid: wallsRes.mid,
      gridStep: wallsRes.gridStep,
      venues: wallsRes.venues,
      depth1: wallsRes.depth1,
      depth5: wallsRes.depth5,
      imbalance: wallsRes.imbalance,
      walls: wallsRes.walls,
      events: wallsRes.events ?? [],
      eventCounts: wallsRes.eventCounts ?? null,
      eventTotal: wallsRes.eventTotal ?? 0,
      eventWindow: wallsRes.eventWindow ?? null,
      nearestAsk: walls?.nearestAsk ?? null,
      nearestBid: walls?.nearestBid ?? null,
      wallCount: walls?.count ?? 0
    } : null,
    whales: whales ? {
      h1: { n: whales.h1.n, buy: Math.round(whales.h1.buy), sell: Math.round(whales.h1.sell), net: Math.round(whales.h1.net) },
      h24: { n: whales.h24.n, buy: Math.round(whales.h24.buy), sell: Math.round(whales.h24.sell), net: Math.round(whales.h24.net) },
      biggest: whales.biggest.map((r) => ({ ex: r.ex, kind: r.kind, price: r.price, usd: Math.round(r.usd), side: r.side, t: r.t })),
      clusters: whales.topClusters.map((c) => ({ price: c.price, side: c.side, usd: Math.round(c.usd), n: c.n })),
      anchors: whales.anchorClusters.map((c) => ({ price: c.price, side: c.side, usd: Math.round(c.usd), n: c.n })),
      total: whales.total,
      minVolUsd: whales.minVolUsd ?? 1e5,
      venues: ["Binance"]
    } : null,
    liq,
    oi: oiRes ? { aggregate: oiRes.aggregate, venues: oiRes.venues } : null,
    cvd: cvdRes ? {
      kpis: cvdRes.kpis,
      divergences: cvdRes.divergences,
      delta: cvdRes.delta.slice(-48),
      instruments: cvdRes.instruments,
      n: cvdRes.n
    } : null,
    market: {
      auction: market.auction,
      vwap: market.vwap,
      levels: market.levels
    },
    bars5: (bars5 ?? []).map((b) => [b.ts, +b.o.toFixed(decs + 1), +b.h.toFixed(decs + 1), +b.l.toFixed(decs + 1), +b.c.toFixed(decs + 1), Math.round(b.v)]),
    bars15: (bars15 ?? []).map((b) => [b.ts, +b.o.toFixed(decs + 1), +b.h.toFixed(decs + 1), +b.l.toFixed(decs + 1), +b.c.toFixed(decs + 1), Math.round(b.v)]),
    errors,
    updatedAt: Date.now()
  };
}
function fetchCvdShape(c) {
  return { kpis: c.kpis, delta: c.delta ?? [], updatedAt: c.updatedAt };
}

// src/index.js
var VERSION = "1.0.0";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extraHeaders
    }
  });
}
var briefCache = /* @__PURE__ */ new Map();
var BRIEF_TTL = 8e3;
function badSym(sym) {
  return !isSupported(sym) ? json({ ok: false, error: `unsupported symbol ${sym}`, supported: SYMBOLS }, 400) : null;
}
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "method not allowed" }, 405);
    }
    const sp = url.searchParams;
    const sym = String(sp.get("sym") ?? sp.get("symbol") ?? "ETH").trim().toUpperCase();
    try {
      if (path === "/" || path === "/api" || path === "/api/health") {
        return json({
          ok: true,
          name: "cg-mobile-api",
          version: VERSION,
          now: Date.now(),
          symbols: SYMBOLS,
          cache: cacheStats(),
          routes: [
            "/api/brief",
            "/api/ticker",
            "/api/kline",
            "/api/fp",
            "/api/cvd",
            "/api/market",
            "/api/oi",
            "/api/walls",
            "/api/whales",
            "/api/liq"
          ]
        });
      }
      if (path === "/api/symbols") {
        return json({ ok: true, symbols: SYMBOLS, default: "ETH" });
      }
      if (path === "/api/brief") {
        const bad = badSym(sym);
        if (bad) return bad;
        const fpLim = Math.min(Math.max(Number(sp.get("fp")) || 64, 24), 120);
        const liq = sp.get("liq") !== "0";
        const whales = sp.get("whales") !== "0";
        const key = `${sym}|${fpLim}|${liq ? 1 : 0}|${whales ? 1 : 0}`;
        const hit = briefCache.get(key);
        if (hit && Date.now() - hit.at < BRIEF_TTL) {
          return json(hit.body, 200, { "x-brief-cache": "hit", "x-brief-age-ms": String(Date.now() - hit.at) });
        }
        const body = await buildBrief(sym, { fpLim, liq, whales });
        if (body.ok) {
          briefCache.set(key, { at: Date.now(), body });
          if (briefCache.size > 40) briefCache.delete(briefCache.keys().next().value);
        }
        return json(body, body.ok ? 200 : 502, { "x-brief-cache": "miss" });
      }
      if (path === "/api/ticker") {
        const bad = badSym(sym);
        if (bad) return bad;
        const [m1, h1] = await Promise.all([kline(sym, "m1", 2, 3e3), kline(sym, "h1", 25, 15e3).catch(() => [])]);
        const lastBar = m1[m1.length - 1];
        if (!lastBar) return json({ ok: false, error: "no price" }, 502);
        const chg = h1.length >= 20 ? (lastBar.c - h1[0].c) / h1[0].c * 100 : null;
        return json({
          ok: true,
          sym,
          price: lastBar.c,
          chg24hPct: chg == null ? null : +chg.toFixed(2),
          dir: chg == null ? "flat" : chg > 0 ? "up" : chg < 0 ? "down" : "flat",
          candleTs: lastBar.ts,
          fetchedAt: Date.now()
        });
      }
      if (path === "/api/kline") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m5");
        if (!["m1", "m5", "m15", "h1", "h4", "d1"].includes(itv)) {
          return json({ ok: false, error: "invalid itv" }, 400);
        }
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 60, 10), 400);
        const bars = await kline(sym, itv, limit);
        return json({ ok: true, sym, itv, bars });
      }
      if (path === "/api/fp") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m15");
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 64, 10), 120);
        const res = await footprint(sym, itv, limit);
        return json({ ok: true, sym, itv, ...res });
      }
      if (path === "/api/cvd") {
        const bad = badSym(sym);
        if (bad) return bad;
        const itv = String(sp.get("itv") ?? "m15");
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 150, 60), 400);
        return json(await cvd(sym, itv, limit));
      }
      if (path === "/api/oi") {
        const bad = badSym(sym);
        if (bad) return bad;
        return json({ sym, ...await openInterest(sym) });
      }
      if (path === "/api/market") {
        const bad = badSym(sym);
        if (bad) return bad;
        const [bars15, barsH1, m1] = await Promise.all([
          kline(sym, "m15", 96),
          kline(sym, "h1", 25).catch(() => []),
          kline(sym, "m1", 2, 3e3).catch(() => [])
        ]);
        const px = m1.length ? m1[m1.length - 1].c : bars15[bars15.length - 1].c;
        const mkt = marketFromBars(bars15, barsH1, px);
        return json({ ok: true, sym, price: px, ...mkt });
      }
      if (path === "/api/walls" || path === "/api/bookwalls") {
        const bad = badSym(sym);
        if (bad) return bad;
        const band = [1, 2, 3, 5].includes(Number(sp.get("band"))) ? Number(sp.get("band")) : 5;
        const snapshots = Math.min(Math.max(Number(sp.get("snapshots")) || 2, 1), 6);
        const events = sp.get("events") !== "0";
        const eventSnapshots = Math.min(Math.max(Number(sp.get("back")) || 40, 6), 96);
        const eventLimit = Math.min(Math.max(Number(sp.get("elimit")) || 12, 1), 40);
        const walls = await bookWalls(sym, {
          band,
          snapshots,
          history: sp.get("history") === "1",
          events,
          eventSnapshots,
          eventLimit
        });
        return json(walls);
      }
      if (path === "/api/whales" || path === "/api/lto") {
        const bad = badSym(sym);
        if (bad) return bad;
        return json(await whalesPanel(sym, { minVolUsd: Number(sp.get("min")) || 1e5 }));
      }
      if (path === "/api/liq" || path === "/api/liqlevels") {
        const bad = badSym(sym);
        if (bad) return bad;
        const tick = await kline(sym, "m1", 2, 5e3).catch(() => []);
        const px = tick.length ? tick[tick.length - 1].c : 0;
        const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 50), 1500);
        return json({ sym, ...await liqLevels(sym, { limit, px }) });
      }
      return json({ ok: false, error: "not found", path }, 404);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e), path, sym }, 502);
    }
  }
};
export {
  index_default as default
};
