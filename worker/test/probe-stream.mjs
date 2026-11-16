// Probe the Coinglass liquidity-heatmap aggregate NDJSON stream (walls source)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function stream({ coin = "ETH", exchanges = "Binance,OKX,Gate,Bitget", market = "futures", interval = "m15", limit = 2 } = {}) {
  const q = new URLSearchParams({
    coin,
    exchanges,
    market,
    interval,
    limit: String(limit),
    batchSize: "10",
    endTime: String(Math.floor(Date.now() / 1000)),
  });
  const url = `https://capi.coinglass.com/liquidity-heatmap/api/liquidity/heatmap/aggregate/stream?${q}`;
  const t0 = performance.now();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Origin: "https://www.coinglass.com", Referer: "https://www.coinglass.com/", Accept: "*/*", language: "en" },
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const ms = performance.now() - t0;
  console.log(`status=${res.status} ct=${ct} bytes=${text.length} ms=${ms.toFixed(0)}`);
  if (!/ndjson/.test(ct)) {
    console.log(text.slice(0, 300));
    return null;
  }
  const lines = text.split("\n").filter(Boolean);
  console.log(`lines=${lines.length}`);
  let meta = null;
  const rows = [];
  for (const line of lines) {
    const f = JSON.parse(line);
    if (f.type === "meta") meta = f;
    else if (f.type === "batch") rows.push(...(f.data ?? []));
    else if (f.type === "data") rows.push(f.data);
    else if (f.type !== "end") console.log("frame", f.type, JSON.stringify(f).slice(0, 120));
  }
  console.log("meta", JSON.stringify(meta)?.slice(0, 160));
  console.log(`rows=${rows.length}`);
  if (rows.length) {
    const r = rows[rows.length - 1];
    console.log(`row shape: [${typeof r[0]}, bids=${r[1]?.length}, asks=${r[2]?.length}] ts=${r[0]}`);
    console.log("bid sample", JSON.stringify(r[1]?.slice(0, 3)));
    console.log("ask sample", JSON.stringify(r[2]?.slice(0, 3)));
  }
  return { meta, rows };
}

const which = process.argv[2] ?? "futures";
if (which === "futures") await stream({ exchanges: "Binance,OKX,Gate,Bitget", limit: 2 });
if (which === "one") await stream({ exchanges: "Binance", limit: 1 });
if (which === "spot") await stream({ market: "spot", exchanges: "Binance,Coinbase,OKX,Bitget,Gate", limit: 1 });
