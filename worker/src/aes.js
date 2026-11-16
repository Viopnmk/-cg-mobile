/**
 * Minimal AES (128/192/256) in pure JS — ECB block mode + PKCS#7.
 *
 * WHY THIS EXISTS: Coinglass encrypts both its `obe` request header and its
 * protected API responses with AES-**ECB**. Web Crypto (`crypto.subtle`) has
 * no ECB mode and no raw block primitive, so a faithful Cloudflare-Workers
 * port cannot use it for the payloads. This module is a self-contained,
 * dependency-free AES core (verified byte-for-byte against Node's
 * `crypto.createCipheriv("aes-256-ecb")` in worker/test/aes.test.mjs).
 *
 * Only what Coinglass needs is implemented: ECB over whole blocks, PKCS#7
 * padding on/off, zero IV semantics.
 */

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = new Uint8Array([0x8d, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);

function xtime(x) {
  return ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
}

const MUL = {};
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
    t[i] = r & 0xff;
  }
  MUL[m] = t;
}

function mul(a, b) {
  let r = 0;
  let x = a;
  let y = b;
  while (y) {
    if (y & 1) r ^= x;
    x = xtime(x);
    y >>= 1;
  }
  return r & 0xff;
}

/** Expand a raw key into round-key bytes (column-major, w[i] words back to back). */
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
      // RotWord + SubWord + Rcon
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

function addRoundKey(state, w, round) {
  const off = round * 16;
  for (let i = 0; i < 16; i++) state[i] ^= w[off + i];
}

function shiftRows(s) {
  // row r = s[r], s[4+r], s[8+r], s[12+r] ; shift left by r
  let t;
  t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; s[2] = s[10]; s[10] = t;
  t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
}

function invShiftRows(s) {
  let t;
  t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
  t = s[2]; s[2] = s[10]; s[10] = t;
  t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
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
  const pad = 16 - (buf.length % 16);
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

/** AES-ECB encrypt with PKCS#7 padding. */
export function aesEcbEncrypt(plain, key) {
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

/** AES-ECB decrypt; PKCS#7 padding removed when valid. */
export function aesEcbDecrypt(cipher, key) {
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

/** AES-ECB decrypt keeping padding bytes (some blobs are not PKCS#7-padded). */
export function aesEcbDecryptRaw(cipher, key) {
  if (cipher.length % 16 !== 0) throw new Error("aes: ciphertext not block-aligned");
  const { w, nr } = expandKey(key);
  const out = new Uint8Array(cipher.length);
  const state = new Uint8Array(16);
  for (let off = 0; off < cipher.length; off += 16) {
    state.set(cipher.subarray(off, off + 16));
    decryptBlock(state, w, nr);
    out.set(state, off);
  }
  return out;
}
