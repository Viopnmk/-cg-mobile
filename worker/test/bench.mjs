/**
 * CPU/wall benchmark per endpoint (Node has no Workers CPU clock, but
 * process.cpuUsage on a cold cache still shows where time goes — and it is the
 * number to watch for the Free plan's 10 ms CPU budget).
 *
 *   node test/bench.mjs [ETH]
 */
import worker from "../src/index.js";

const SYM = (process.argv[2] ?? "ETH").toUpperCase();
const paths = [
  "/api/health",
  `/api/ticker?sym=${SYM}`,
  `/api/kline?sym=${SYM}&itv=m5&limit=60`,
  `/api/fp?sym=${SYM}&itv=m15&limit=64`,
  `/api/cvd?sym=${SYM}&itv=m15&limit=150`,
  `/api/oi?sym=${SYM}`,
  `/api/market?sym=${SYM}`,
  `/api/walls?sym=${SYM}&snapshots=2`,
  `/api/whales?sym=${SYM}`,
  `/api/liq?sym=${SYM}&limit=240`,
  `/api/brief?sym=${SYM}`,
];

console.log(`\nbench · ${SYM} · cold caches per endpoint\n`);
let totalCpu = 0;
for (const p of paths) {
  const cpa = process.cpuUsage();
  const w0 = Date.now();
  const res = await worker.fetch(new Request("https://t" + p), {}, {});
  const text = await res.text();
  const c = process.cpuUsage(cpa);
  const cpuMs = (c.user + c.system) / 1000;
  totalCpu += cpuMs;
  console.log(
    `${p.padEnd(48)} ${String(res.status).padEnd(4)} ${String(Math.round((Date.now() - w0))).padStart(5)}ms wall  ${cpuMs.toFixed(1).padStart(6)}ms cpu  ${(text.length / 1024).toFixed(0).padStart(5)}KB`
  );
}
console.log(`\ntotal cpu ${totalCpu.toFixed(0)}ms (Node includes zlib/openssl helper threads; a Worker counts main-thread CPU only)`);
