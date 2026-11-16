# 📱 cg-mobile — 手机端实时 CG 订单流（GitHub Pages + Actions 快照版）

把 `cg-terminal` 里跑在电脑上的 5m/15m AI 概率与订单流面板，变成**手机上打开就用的网页**。

**数据链路（当前线上形态）**：GitHub Actions 每 5 分钟用 Node 直接跑 `worker/src` 里那套 Coinglass 引擎（`fetch` / `crypto.subtle` / `DecompressionStream` 在 Node 22 里原生可用，同一份代码，零重写）→ 写 `docs/data/{ETH,BTC,SOL}.json` → 提交 → GitHub Pages 直接托管。
手机上打开 `https://viopnmk.github.io/cg-mobile/` 即见 5 分钟粒度的完整卡片、盘口墙、鲸鱼大单、足迹、5m/15m K 线。

**为什么不用 Worker 实时拉**：见文末「数据源与 Cloudflare 出口」——Coinglass 的 API 主机对 Cloudflare 出口一律 403。
Worker（`worker/`）仍完整保留并已部署，可作实时通道直连（手机设置卡片里填它的地址即可切换），等哪天 Coinglass 不再封 CF 或中间加一台非 CF 转发就能直接启。
**实时那条路现在走 Vercel**：同一份 `worker/src` 套一层 Node 函数适配器（`api/[route].js`），跑在 Vercel 的 AWS Lambda 出口上，Coinglass 不封 —— 见文末「Vercel 实时中转」。

- 引擎用**纯 Web API**（`fetch` / `crypto.subtle` / `DecompressionStream`），同一份代码同时跑在 Cloudflare Workerd 与 Node 22。
  Coinglass 的 AES-**ECB** 是 Web Crypto 没有的模式，所以附了一个自带、已与 Node `aes-256-ecb` 逐字节对齐的纯 JS AES 内核（`src/aes.js`），**零 npm 依赖**。
- 卡片算法是 `scripts/eth-5m15m-template.mjs` 的**逐行移植**，并用终端原函数在同一份数据上做了**逐值比对（parity test 全绿）**。

> 状态：**已上线**。
> - 前端（主线）：<https://viopnmk.github.io/cg-mobile/> —— GitHub Pages 托管 `docs/`，数据由 `.github/workflows/refresh-cg.yml` 每 5 分钟抓 Coinglass 写成 `docs/data/*.json`。
> - 前端（同一份镜像，Workers 静态资产）：<https://cg-mobile-web.2310566637.workers.dev/>
> - Worker：<https://cg-mobile-api.2310566637.workers.dev>（账号 `2310566637@qq.com`，workers.dev 子域 `2310566637`，Free 计划，无绑定无 KV）—— 已部署，但上游被封（见下）。
>
> ⚠️ **Cloudflare 出口被 Coinglass 封禁（2026-11-17 实测）**：边界抓 `capi/fapi/open-api.coinglass.com` 一律回源 nginx `403 Forbidden`（同一份 header、同一条 URL 在本工作区 AWS 俄勒冈出口是 200），封的是 Cloudflare 出口 ASN（`cf-worker` 头无法被 Worker 覆盖，换 Workers Paid 或换机房均无效）。所以 Worker 的 `/api/brief` 现在返回 502 `upstream HTTP 403`，`/api/health` 正常。这就是换成 GitHub Actions 快照的原因。

---

## 目录

```
cg-mobile/
├── docs/index.html          # 前端（单文件，GitHub Pages 根页；在 *.vercel.app 上自动走实时）
├── docs/data/*.json         # GitHub Actions 写的 Coinglass 快照（ETH/BTC/SOL + meta）
├── api/[route].js           # Vercel Node 函数适配器：/api/* → worker/src 的 Web Request 处理
├── vercel.json              # Vercel 路由：/ → docs/index.html、Functions 60s、/api → health
├── package.json             # 只为告诉 Vercel「Node 22 + ESM」，零依赖
├── tools/refresh.mjs        # 抓 Coinglass → docs/data（直接 import worker/src 的引擎）
├── .github/workflows/refresh-cg.yml  # 每 5 分钟跑一次 refresh，有变化就 commit
├── wrangler.site.toml       # 把 docs/ 当 Workers 静态资产托管（Pages 的镜像备份）
├── worker/
│   ├── src/index.js         # 路由 + CORS + 边缘缓存
│   ├── src/cg-crypto.js     # obe(TOTP) + AES-ECB 解密 + inflate（Web Crypto 版）
│   ├── src/aes.js           # 纯 JS AES-128/192/256（ECB + PKCS#7）
│   ├── src/cg-client.js     # TTL 缓存 / in-flight 合并 / 429 冷却 + 陈旧兜底
│   ├── src/cg-data.js       # kline / orderFlow / OI / 深度墙 / 大单 / 清算位 / whalesPanel
│   ├── src/cvd.js           # Coinglass CVD 引擎（FlowGrid/recompute/背离/KPI）
│   ├── src/fp.js            # 足迹聚合（fpFromBuckets / mergeFp）
│   ├── src/signals.js       # 5 因子打分 / 足迹信号 / 入场-止损-TP / 结论
│   ├── src/brief.js         # 一次请求组装整张卡（面板独立降级）
│   ├── dist/cg-mobile-api.js # 单文件打包版（手机网页版直接粘贴用）
│   ├── wrangler.toml        # 无绑定、无 KV，Free 计划可直接跑
│   └── test/                # aes / 现场实测 / 与终端模板 parity / 前端渲染 / 基准
├── test/vercel-adapter.test.mjs # 桩 (req,res) 跑真 api/[route].js，打真 Coinglass
├── sample-brief-ETH.json   # 一次真实 /api/brief 响应（前端字段参考）
└── README.md
```

---

## 数据怎么更新（线上主语）

```
GitHub Actions (*/5 * * * *)            GitHub Pages
        │                             ┌─────────────────────┐
        │ node tools/refresh.mjs      │ index.html          │
        │  └─ worker/src/brief.js  ── │ data/ETH.json  ←────┼── commit 回 main
        │      └─ Coinglass capi      │ data/BTC.json       │
        │                             │ data/SOL.json       │
        └── 有变化就 commit+push ────→ └─────────────────────┘
```

- 手跑一次：仓库 Actions → `refresh-cg` → Run workflow（或 `gh workflow run refresh-cg.yml`）。
- 本地手跑：`node tools/refresh.mjs`（默认 `ETH,BTC,SOL`，可 `SYMBOLS=ETH node tools/refresh.mjs`），约 3–4 秒，写完 `docs/data/`。
- 某个标的抓失败时会**保留上一份好数据**，并在 `meta.json` 里记 `ok:false`，不会把页面刷成白屏。
- 页面上的“北京时间”直接用快照里的 `builtAt`，跟手机时区无关。

---

## 上线与运维

1. **Worker（可选，实时通道）**

   ```bash
   cd cg-mobile/worker
   npx wrangler deploy          # 读 wrangler.toml（src/index.js）
   npm run bundle               # 改了 src 后重打 dist/ 单文件版
   ```
   手机在页面右上角 ⚙ 里填 Worker 根地址即可切回实时模式（留空 = 用静态快照）。
   注意：目前 Coinglass 封 Cloudflare 出口，实时模式实际不可用（见文末）。

2. **前端 + 数据（主线）**：GitHub Pages → `Deploy from a branch` → `main` / `/docs`。
   `docs/.nojekyll` 已加，Pages 不走 Jekyll，`data/*.json` 原样发布。

本地预览：先 `cd worker && npx wrangler dev`（默认 `http://127.0.0.1:8787`），再 `python3 -m http.server -d docs 8000` 打开 `http://localhost:8000`。

---

## 接口

| 接口 | 说明 |
|---|---|
| `GET /api/brief?sym=ETH[&fp=64][&liq=0][&whales=0]` | 整张卡：价格/24h、5 因子概率、建议、入场-止损-TP、足迹信号、盘口深度与墙、鲸鱼统计、清算位、OI、CVD、5m/15m K 线、结论文本。默认 8s 边缘缓存 |
| `GET /api/ticker?sym=ETH` | 现价 + 24h%（m1 + h1） |
| `GET /api/kline?sym=ETH&itv=m5\|m15\|h1&limit=60` | 干净 OHLCV |
| `GET /api/fp?sym=ETH&itv=m15&limit=64` | 足迹（Binance+OKX+Bybit+Hyperliquid 聚合，HL 按逐根收盘价平移到 Binance 价位） |
| `GET /api/cvd?sym=ETH&itv=m15&limit=150` | CVD：4 家永续 + Binance 现货腿、累计/逐根 delta、买卖比、象限、背离 |
| `GET /api/oi?sym=ETH` | 全场所 OI 聚合 + 1h/4h/24h 变化 |
| `GET /api/market?sym=ETH` | 日内拍卖区（POC/VAH/VAL）、8h 拍卖、日 VWAP±σ、PDH/PDL |
| `GET /api/walls?sym=ETH&snapshots=2` | Coinglass 多场所**聚合盘口**：±1%/±5% 买卖深度与失衡、阈值以上墙列表、近 ±1.2% 价位阶梯 |
| `GET /api/whales?sym=ETH&min=100000` | 大额挂单（Binance/OKX/Bybit，`type=1` 永续 / `type=10` 现货，`side 1=卖 2=买`） |
| `GET /api/liq?sym=ETH&limit=240` | 清算磁吸位（未触及清算档按价位聚簇，上方空头/下方多头） |

别名：`/api/bookwalls` = `/api/walls`、`/api/lto` = `/api/whales`、`/api/liqlevels` = `/api/liq`（跟终端命名对齐）。

全部返回 JSON，`Access-Control-Allow-Origin: *`，`OPTIONS` 预检 204。
`/api/health` 里带缓存条目数、字节数、各 host 的 429 冷却窗口。

---

## 卡片算法（与终端模板一致）

权重合计 100：**5m 结构 30 | 15m 结构 30 | CVD 15 | Taker 15 | OI 10**，每项是带符号分（正=多），
`概率 = clamp(round(100 × |Σ/100|^0.6 × (0.75 + 0.25×同向权重占比)))`；
`概率≥58 && 5m/15m 同号 && 同向因子≥3` 才给 🟥做空 / 🟩做多，否则 🔴观望。

- **结构（30）**：EMA 排列 10 + EMA9 动量 4 + BOS/摆动序列 8 + 溢价折价区 6 + RSI 2
- **CVD（15）**：累计 CVD/吃单额 ±6 + 近 24 根主动差 ±6 + 买卖比 ±3 + 背离 ±2
- **Taker（15）**：近 8 根（最近 3 根加权 2）主动买占比 ±15
- **OI（10）**：1h OI 变化 × 价格 1h 变化 → 多头增仓/空头增仓/轧空/踩踏
- **足迹信号**：吸收 `abs` / 发散 `div` / 强发散 `sdiv` / 陷阱 `trap` / 耗尽 `exh`，只显示近 4h、最多 3 组
- **入场/止损/TP**：现价 ±0.8% 内挑权重最高的锚（卖墙/买墙/摆动高低/日 VAH-VAL-POC/清算位/大额挂单），止损夹在 0.55–1.3 ATR 之间，TP1/TP2 打下方/上方承接

---

## 验证结果（都是真数据，2026-11-16 夜间）

```
① AES 内核        与 Node aes-128/192/256-ecb 逐字节一致（0/12/16/32/100/4K/64K 字节，含 obe token）
② 现场接口        ETH / BTC / XAU 三个标的，11 个接口全绿：
                  ticker 1828~1833、kline 60 根、footprint 64/64 根带足迹、
                  cvd n=150（Binance/OKX/Bybit/Bitget + 现货腿全 ok）、
                  walls ±1% 买 $2.7亿/卖 $2.8亿、whales 1h 300+ 笔、liq 上5/下5
③ 与终端 parity   用模板原函数喂同一份数据：5m 24 / 15m 23 / CVD 6 / Taker 3 / OI 5、
                  入场止损 TP 全部逐值相同，概率 74% = 74% → PARITY OK
④ 前端渲染        无浏览器 DOM/Canvas 桩跑真页面脚本：价格、概率、5 因子、双方向
                  价位、结论、足迹、墙列表、鲸鱼列表、K 线画布全部渲染，刷新/筛选正常
⑤ 真 Workerd      用 wrangler dev（真实 Workers 运行时）跑通全部 9 个接口 + 前端经 HTTP 端到端
```

复跑：`cd worker && node test/aes.test.mjs && node test/live-test.mjs ETH`
（另有 `test/parity.test.mjs`、`test/frontend-render.test.mjs`、`test/bench.mjs`；
`CGM_BASE=http://127.0.0.1:8787 node test/frontend-render.test.mjs` 可走真实 HTTP）

---

## 已知限制（都做了优雅降级，不会白屏）

- **CPU/子请求预算**：`/api/brief` 一次要 ~10 个上游请求、约 600KB。Free 计划 10ms CPU、50 子请求；
  冷启动偏重时可能触发 1102，前端会**自动降级**为 `&liq=0&whales=0` 的轻量卡并提示，重活留给单独接口。
  想要稳定全量模式：Workers Paid（$5/月，30s CPU）或把刷新间隔调到 30s。
- **Coinglass 限流**：命中 429 会按 `Retry-After` 冷却该 host 并回陈旧数据（≤180s），不会抖成白屏。
- **盘口墙**：走聚合流最新 1–2 个快照（不含历史事件流），所以“加挂/撤单事件”没做；阈值
  ETH $800k / BTC $1.5M / XAU $1M，±3% 内取最大 14 个。
- **鲸鱼挂单**：卡片里只取 Binance（省请求），`/api/whales` 面板取 3 家；永续/现货用 `type` 区分。
- **清算位**：只用 Binance 一家的 `liquidationLevels/v2`（limit 240，3 天），不是 4 家合并。
- **Hyperliquid**：足迹用逐根收盘价平移对齐 Binance，墙/清算不含 HL。
- **静态快照新鲜度**：主线（GitHub Pages + Actions）每 5 分钟抓一次，卡片上的“数据 HH:MM:SS 北京”就是快照生成时刻；GitHub 的定时任务在高峰时可能延后几分钟，所以实际间隔常在 5–10 分钟。5m/15m 结构不受影响，但**不是 tick 级实时**。
- **既要实时又要 Coinglass 全保真**：Cloudflare 出口被封，所以走非 Cloudflare 出口 —— 已落地的是 Vercel Node 函数（AWS Lambda，方案 D）。
- 全部为行情参考，**不是投资建议**。

---

## 数据源与 Cloudflare 出口（2026-11-17）

Coinglass 的 API 主机对 Cloudflare 出口做了封禁，Worker 直连必然 403。可走的路线：

| 方案 | 数据新鲜度 | Coinglass 保真 | 需要什么 |
|---|---|---|---|
| A. 数据层改成 OKX + Hyperliquid | 实时（15s） | 部分丢失（四所聚合足迹/CVD、清算位、聚合墙精度） | 重写 `src/cg-data.js` 一层 |
| B. **GitHub Actions 每 5 分钟抓一次写 `docs/data/*.json`，GitHub Pages 直接托管（已上线，主线）** | 5–10 分钟 | 100%（现有引擎原样跑在 Node 22） | 只需 GitHub（免费公开仓库 Actions） |
| C. 中间加一台非 Cloudflare 出口的转发（Deno Deploy / Val Town / Render…），Worker 恢复实时 | 实时 | 100% | 一个第三方账号（需用户同意） |
| D. **Vercel Serverless Function（Node 22 → AWS Lambda 出口）跑同一份 `worker/src`（已加，`api/[route].js`）** | 实时（15s） | 100% | 一个 Vercel 账号（GitHub 登录，Hobby 免费） |

---

## Vercel 实时中转（2026-11-17 新增）

背景：Coinglass 封的是 **Cloudflare 出口**，AWS 不封（本工作区就是 AWS 俄勒冈，实测 200）。
Vercel 的 **Edge Function** 跑在 Cloudflare 网络上（不能用），但 **Node.js Serverless Function** 跑在 **AWS Lambda** 上 —— 所以同一份 `worker/src` 原样搬过去就能拿回 100% 保真的实时数据，不需要换数据层、不需要重写引擎。

### 它怎么工作

```
浏览器  https://<项目>.vercel.app/api/brief?sym=ETH
             │  （*.vercel.app 上页面不再读 data/*.json，而是同源调 /api）
             ▼
api/[route].js   Node 22 Serverless Function（AWS Lambda）
   1. origin  + req.query.route + req.url 的 query  →  拼回 /api/brief?sym=ETH
   2. new Request(url, { method, headers })        →  Web Fetch 标准请求
   3. worker.fetch(request, process.env, ctx)      →  worker/src 原封不动地跑
   4. status / headers（含 CORS）/ body            →  写回 res
```

- 为什么文件名是 `api/[route].js` 而不是 `api/[...path].js`：**Vercel 只在 Next.js 里支持 catch-all 路由**，
  普通项目的 `/api` 目录只支持单段动态路由（官方向答里明确说过），写 `[...path].js` 反而会让 `/api/brief` 404。
  Worker 的 12 个路由（含别名）全部是 `/api/` 后的**单段**，所以一个 `[route].js` 就全接了；
  以后若要加多段路由，再加一个 `api/xxx/[route].js` 即可。
- `export const config = { maxDuration: 60 }`：冷缓存时一张全量 brief 要串几跳上游，Hobby 上限 60 秒。
- `vercel.json` 只做三件事：`/` → `docs/index.html`（根域名直接就是页面）、`/data/*` → `docs/data/*`（留一条静态兵底）、`/api` → `/api/health`。
- 前端检测：`location.hostname` 命中 `*.vercel.app` 就自动进实时模式（15 秒刷新、右上角亮「Vercel 实时」），
  不用在设置里填任何地址；同一份页面在 GitHub Pages 上仍然读 5 分钟快照，两边都能用。

### 部署（1 键，无需填任何环境变量/构建参数）

1. 打开 <https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2FViopnmk%2Fcg-mobile> （登录用 GitHub 即可）。
   或在 <https://vercel.com/new> 里选 `Viopnmk/cg-mobile` → Import。
2. 项目名随意（默认 `cg-mobile`），Framework 选 **Other**，Root Directory 保持 `./`，
   Build Command / Output Directory / Install Command **全部留空**（零依赖、无构建）。
3. Deploy。30–60 秒后打开 `https://<项目>.vercel.app/` —— 页面自己就是实时档，无须切换。
   （万一根域名打开是 404（rewrite 没生效），用 `https://<项目>.vercel.app/docs/` 打开，是同一份页面，同样自动实时。）

> 没登录过 Vercel 会先跳注册页：点 **Continue with GitHub** → 授权 → 自动接回 Import 流程（仓库已是 public，不用额外授权范围）。

部署后自检（任一条能对上就说明通了）：

```bash
curl -s https://<项目>.vercel.app/api/health            # {"ok":true,...}，带 access-control-allow-origin: *
curl -s "https://<项目>.vercel.app/api/brief?sym=ETH" | head -c 200   # {"ok":true,"sym":"ETH","price":...}
curl -s https://<项目>.vercel.app/api/brief?sym=ZZZ    # 400 unsupported symbol
```

### 本地验证（不部署也能确认）

```bash
node test/vercel-adapter.test.mjs        # 桩 (req,res) → 真 api/[route].js → 真 Coinglass
node test/vercel-adapter.test.mjs BTC    # 换标的
```

2026-11-17 实测结果（ETH，实时行情）：health 200 / OPTIONS 204 / 404 / 400 全部符合；
`/api/brief` **200，约 16 KB，0.7–0.8 秒**，价格 1822.12、5 因子卡 32%、60 根 5m + 96 根 15m、
足迹 4 场所、盘口墙 5 场所、鲸鱼 24h 212 笔、清算位上下各 5 档、`errors: []`；CORS `*`、
`content-type: application/json`、`content-length` 都正确。共 26 项检查全绿。
前端侧用 DOM 桩跑真页面脚本也验过：`CGM_VERCEL=1 node worker/test/frontend-render.test.mjs`
→ 自动实时模式、同源 `/api` 调用、“Vercel 实时”徽标、价格/概率/5 因子/墙/鲸鱼/图表全渲染。

### 注意

- 冷启动 0.5–1.5 秒；第一次请求慢一点是正常的，之后同实例内有 8 秒 brief 缓存。
- 免费 Hobby 额度对个人 15 秒刷一次的用量来说绰绰有余；要更稳（并发/时长）再升 Pro。
- Vercel 上的仓库根目录会被当静态站发出去（源码本来就是公开仓库），只有 `api/` 变函数，没有密钥。
- 不想用 Vercel 了：`docs/` 那份 GitHub Pages 页面一行没动，依旧是 5 分钟快照。
