/**
 * Frontend render test WITHOUT a browser: a tiny DOM/canvas stub runs the real
 * inline script from docs/index.html, with fetch() wired straight into the
 * Worker module (so the data is live Coinglass). Catches typos, missing
 * fields and render crashes before the page ever reaches a phone.
 *
 *   node test/frontend-render.test.mjs
 */

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../../docs/index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no inline <script> found");

/* ------------------------------------------------------------- DOM stub */
class ClassList {
  constructor(el) { this.el = el; this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, on) { if (on === undefined) this.set.has(c) ? this.set.delete(c) : this.set.add(c); else on ? this.set.add(c) : this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  get value() { return [...this.set].join(" "); }
}
class Style {
  constructor() { this._ = {}; }
  setProperty(k, v) { this._[k] = v; }
  getPropertyValue(k) { return this._[k]; }
}
class El {
  constructor(tag = "div", id = "") {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this._innerHTML = "";
    this.textContent = "";
    this._className = "";
    this.classList = new ClassList(this);
    this.style = new Style();
    this.dataset = {};
    this.listeners = {};
    this.value = "";
    this.disabled = false;
    this.clientWidth = 360;
    this.clientHeight = 238;
    this.width = 0;
    this.height = 0;
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get className() { return this.classList.value; }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  dispatch(t, ev = {}) { for (const fn of this.listeners[t] || []) fn({ target: this, ...ev }); }
  scrollIntoView() {}
  focus() {}
  animate() { return { cancel() {} }; }
  closest() { return this; }
  querySelectorAll() { return []; }
  getContext() {
    const noop = () => {};
    return {
      setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
      fillRect: noop, fillText: noop, arc: noop, closePath: noop, fill: noop, save: noop, restore: noop,
      measureText: () => ({ width: 20 }), setLineDash: noop,
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    };
  }
}

const registry = new Map();
function getEl(id) {
  if (!registry.has(id)) registry.set(id, new El("div", id));
  return registry.get(id);
}

/* document/window */
const doc = {
  hidden: false,
  title: "",
  getElementById: getEl,
  createElement: (t) => new El(t),
  addEventListener: () => {},
  body: new El("body"),
};
const win = {
  devicePixelRatio: 2,
  addEventListener: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)),
  clearTimeout,
  setInterval: (fn, ms) => setInterval(fn, Math.max(ms, 1000)),
  clearInterval,
};

/* fetch → the real Worker. CGM_BASE=http://127.0.0.1:8787 runs against a live
 * `wrangler dev` instead of the in-process module (same page, real HTTP). */
const BASE = process.env.CGM_BASE || "https://cg-mobile-api.test";
const overHttp = BASE.startsWith("http://") || BASE.startsWith("https://127");
let fetchCount = 0;
async function fakeFetch(url) {
  fetchCount++;
  const u = String(url);
  const p = u.startsWith(BASE) ? u.slice(BASE.length) : u;
  const res = overHttp ? await fetch(BASE + p) : await worker.fetch(new Request(BASE + p), {}, {});
  const text = await res.text();
  return { ok: res.ok, status: res.status, text: async () => text, json: async () => JSON.parse(text) };
}

const store = new Map([["cgm.worker", BASE], ["cgm.sym", process.argv[2] || "ETH"], ["cgm.refresh", "0"]]);
const sandbox = {
  document: doc,
  window: win,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  fetch: fakeFetch,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  AbortController,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Promise,
  isFinite,
  isNaN,
  parseInt,
  parseFloat,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: "docs/index.html:inline" });

/* ------------------------------------------------------------- run/check */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails++;
};

// boot with a stored worker URL → loadAll runs on script start
await wait(6000);

const price = getEl("price").textContent;
const prob = getEl("probVal").textContent;
const factors = getEl("factors").children.length;
const levels = getEl("levels").innerHTML;
const status = getEl("aiStatus").textContent;
const conclusion = getEl("conclusion").innerHTML;
const walls = getEl("wallList").children.length;
const whales = getEl("wlist").children.length;
const footprint = getEl("fpLine").textContent;

check("fetch used the worker", fetchCount >= 2, `${fetchCount} calls`);
check("price rendered", /^[\d.,]+$/.test(price), price);
check("24h change rendered", /%$/.test(getEl("chg").textContent), getEl("chg").textContent);
check("probability rendered", /%$/.test(prob), prob);
check("status line", status.length > 4, status);
check("5 factor rows", factors === 5, String(factors));
check("levels rendered", levels.includes("入场") && levels.includes("止损") && levels.includes("TP1"));
check("conclusion rendered", conclusion.includes("结论") && conclusion.length > 30, conclusion.replace(/<[^>]+>/g, "").slice(0, 90) + "…");
check("footprint line", footprint.includes("足迹信号"), footprint.slice(0, 70) + "…");
check("wall list", walls > 0, `${walls} rows`);
check("whale list", whales > 0, `${whales} rows`);
check("whale 1h stats", /笔/.test(getEl("w1n").textContent), getEl("w1n").textContent);
check("depth ±1%", getEl("d1bid").textContent !== "—", `${getEl("d1bid").textContent} / ${getEl("d1ask").textContent}`);
check("chart drew", getEl("chart").width > 0, `${getEl("chart").width}×${getEl("chart").height}px`);

// interactions: kline switch, whale filter, refresh
getEl("kseg").dispatch("click", { target: { closest: () => ({ dataset: { k: "m5" }, classList: new ClassList({}) }) } });
getEl("wtabs").dispatch("click", { target: { closest: () => ({ dataset: { k: "perp" }, classList: new ClassList({}) }) } });
await wait(200);
check("perpetual filter", getEl("wlist").children.length > 0, `${getEl("wlist").children.length} rows`);

const before = fetchCount;
getEl("refreshBtn").dispatch("click");
await wait(6000);
check("manual refresh re-fetched", fetchCount > before, `${before} → ${fetchCount}`);
check("price still rendered", /^[\d.,]+$/.test(getEl("price").textContent), getEl("price").textContent);
check("no error banner", !getEl("banner").classList.contains("show"), getEl("banner").innerHTML.slice(0, 80));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nFRONTEND RENDER OK");
process.exit(fails ? 1 : 0);
