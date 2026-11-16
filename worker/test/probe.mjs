import { cgHeaders, decryptCgResponse } from "../src/cg-crypto.js";

const CAPI = "https://capi.coinglass.com";

async function cgGetRaw(path, host = CAPI) {
  const url = `${host}${path}`;
  const cacheTs = String(Date.now());
  const headers = await cgHeaders(cacheTs);
  const t0 = performance.now();
  const res = await fetch(url, { headers });
  const bodyText = await res.text();
  const hdrs = {};
  res.headers.forEach((v, k) => (hdrs[k] = v));
  const ms = performance.now() - t0;
  return { url, cacheTs, status: res.status, headers: hdrs, bodyText, ms, bytes: bodyText.length };
}

const targets = process.argv.slice(2);
const paths = targets.length
  ? targets
  : [
      "/api/v2/kline?symbol=Binance_ETHUSDT%23kline&interval=m15&minLimit=false&limit=5",
      "/api/v2/kline?symbol=Binance_ETHUSDT%23bs_usd&interval=m15&minLimit=false&limit=5",
      "/api/orderFlow?symbol=Binance_ETHUSDT%23order_flow&interval=m15&minLimit=false&limit=3",
    ];

for (const p of paths) {
  try {
    const r = await cgGetRaw(p);
    const preview = r.bodyText.slice(0, 160).replace(/\n/g, " ");
    console.log(`\n=== ${p}`);
    console.log(`status=${r.status} bytes=${r.bytes} ms=${r.ms.toFixed(0)} v=${r.headers.v ?? "-"} user=${(r.headers.user ?? "").slice(0, 20)}`);
    console.log(`body: ${preview}`);
    let data;
    try {
      data = await decryptCgResponse({ headers: r.headers, bodyText: r.bodyText }, r.cacheTs, r.url);
      const s = JSON.stringify(data);
      console.log(`decrypted ok: type=${Array.isArray(data) ? "array" : typeof data} len=${s.length}`);
      console.log(`preview: ${s.slice(0, 400)}`);
    } catch (e) {
      console.log(`decrypt FAILED: ${e.message}`);
    }
  } catch (e) {
    console.log(`\n=== ${p}\nFETCH ERROR ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
