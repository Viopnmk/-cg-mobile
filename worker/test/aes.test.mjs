import crypto from "node:crypto";
import { aesEcbEncrypt, aesEcbDecrypt } from "../src/aes.js";

let fails = 0;
function eq(name, a, b) {
  const ok = Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  if (!ok) {
    fails++;
    console.log(`✗ ${name}\n  got ${Buffer.from(a).toString("hex").slice(0, 96)}\n  exp ${Buffer.from(b).toString("hex").slice(0, 96)}`);
  } else console.log(`✓ ${name}`);
}

for (const keyLen of [16, 24, 32]) {
  for (const n of [0, 12, 16, 32, 100, 4096, 65536]) {
    const key = crypto.randomBytes(keyLen);
    const plain = crypto.randomBytes(n);
    const node = crypto.createCipheriv(`aes-${keyLen * 8}-ecb`, key, null);
    node.setAutoPadding(true);
    const ref = Buffer.concat([node.update(plain), node.final()]);
    const mine = aesEcbEncrypt(plain, key);
    eq(`enc key${keyLen * 8} n=${n}`, mine, ref);
    const back = aesEcbDecrypt(mine, key);
    eq(`dec key${keyLen * 8} n=${n}`, back, plain);
    // cross-check decrypt of node ciphertext
    eq(`dec-node key${keyLen * 8} n=${n}`, aesEcbDecrypt(ref, key), plain);
  }
}

// The exact Coinglass `obe` shape: "1763....,123456" (12 bytes) under the static key.
const STATIC_KEY = Buffer.from("1f68efd73f8d4921acc0dead41dd39bc", "utf8");
const plain = Buffer.from("1763304000,123456", "utf8");
const nodeEnc = crypto.createCipheriv("aes-256-ecb", STATIC_KEY, null);
nodeEnc.setAutoPadding(true);
const ref = Buffer.concat([nodeEnc.update(plain), nodeEnc.final()]);
eq("obe token", aesEcbEncrypt(plain, STATIC_KEY), ref);
console.log(ref.toString("base64"));

// Speed probe (what the worker will actually do on payloads)
const big = crypto.randomBytes(512 * 1024);
const t0 = performance.now();
aesEcbEncrypt(big, STATIC_KEY);
const encMs = performance.now() - t0;
const t1 = performance.now();
aesEcbDecrypt(aesEcbDecrypt(big, STATIC_KEY).length % 16 === 0 ? big : big, STATIC_KEY);
console.log(`encrypt 512KB: ${encMs.toFixed(1)} ms`);

console.log(fails ? `\n${fails} FAILURES` : "\nALL AES TESTS PASS");
process.exit(fails ? 1 : 0);
