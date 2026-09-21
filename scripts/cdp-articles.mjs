// 文章页 / 指南列表页的无头验证（读本地 dist，file:// 直开）
//
// 为什么用 file:// 而不是起 http 服务：常规页面的 CSS 是内联的，
// 文章页又完全服务端直出、不依赖 JS 渲染，file:// 足够。
// ⚠️ 代价：`/app.js` 这类绝对路径会 404。所以本脚本只验
//    「静态结构 + 响应式布局」，不验 JS 交互（那部分由线上 cdp-auth.mjs 覆盖）。
//
// 判据沿用项目约定：390×844 下 document.documentElement.scrollWidth === window.innerWidth
//
// 用法: node scripts/cdp-articles.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('未找到 Chrome / Edge');
  process.exit(1);
}

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(DIST)) {
  console.error('dist 不存在，先跑 node scripts/build.mjs');
  process.exit(1);
}

const PORT = 9341;
const profile = mkdtempSync(path.join(os.tmpdir(), 'cdp-art-'));
const proc = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function assert(cond, name, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  ready() {
    return new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    this.ws.close();
  }
}

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 端口未就绪');
}

const cdp = new CDP(await getWsUrl());
await cdp.ready();

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

async function evalJs(expr) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

const VIEWPORTS = [
  { name: '移动端 390×844', width: 390, height: 844, mobile: true },
  { name: '桌面 1280×900', width: 1280, height: 900, mobile: false },
];

const PAGES = [
  { name: '/guide/ 列表页', file: 'guide/index.html' },
  { name: '文章 /guide/25t-price/', file: 'guide/25t-price/index.html' },
  { name: '文章 /guide/transfer-process/', file: 'guide/transfer-process/index.html' },
  { name: '文章 /guide/hour-meter/', file: 'guide/hour-meter/index.html' },
];

console.log('[cdp-articles] 浏览器:', path.basename(CHROME));
console.log('');

for (const page of PAGES) {
  const url = pathToFileURL(path.join(DIST, page.file)).href;

  for (const vp of VIEWPORTS) {
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile },
      sessionId
    );
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(1100);

    const r = await evalJs(`(() => {
      const de = document.documentElement;
      const art = document.querySelector('.article');
      const links = art ? [...art.querySelectorAll('a')] : [];
      return {
        scrollW: de.scrollWidth,
        innerW: window.innerWidth,
        h1: (document.querySelector('h1') || {}).textContent || '',
        hasArticle: !!art,
        artH2: art ? art.querySelectorAll('h2').length : 0,
        pageH2: document.querySelectorAll('h2').length,
        lists: art ? art.querySelectorAll('ul, ol').length : 0,
        strong: art ? art.querySelectorAll('strong').length : 0,
        blockquotes: art ? art.querySelectorAll('blockquote').length : 0,
        innerLinks: links.map((a) => a.getAttribute('href')),
        postItems: document.querySelectorAll('.post-item').length,
        crumbs: document.querySelectorAll('.crumb a').length,
        navLinks: document.querySelectorAll('.nav a').length,
        hasJsonLd: !!document.querySelector('script[type="application/ld+json"]'),
      };
    })()`);

    const tag = `${page.name} @ ${vp.name}`;

    // ★ 核心判据：零横向溢出。
    // 用 <= 而不是 === —— 桌面端垂直滚动条会占掉约 15px，
    // 此时 scrollWidth 比 innerWidth 略小，那不算溢出。
    assert(
      r.scrollW <= r.innerW,
      `${tag} — 无横向溢出`,
      `scrollWidth ${r.scrollW} ≠ innerWidth ${r.innerW}`
    );
    assert(r.h1.length > 0, `${tag} — 有 H1`);
    assert(r.navLinks === 5, `${tag} — 导航 5 项`, `实际 ${r.navLinks}`);
    assert(r.hasJsonLd, `${tag} — 有 JSON-LD`);

    if (page.file.startsWith('guide/') && page.file !== 'guide/index.html') {
      // 文章页
      assert(r.hasArticle, `${tag} — .article 容器存在`);
      assert(r.artH2 >= 3, `${tag} — 正文至少 3 个 H2`, `实际 ${r.artH2}`);
      assert(r.lists >= 2, `${tag} — 正文至少 2 个列表`, `实际 ${r.lists}`);
      assert(r.strong >= 3, `${tag} — 加粗生效`, `实际 ${r.strong}`);
      assert(r.blockquotes >= 1, `${tag} — 有免责引用块`);
      assert(r.crumbs >= 2, `${tag} — 面包屑有 2 个链接`, `实际 ${r.crumbs}`);
      assert(r.postItems >= 2, `${tag} — 底部相关文章 ≥2`, `实际 ${r.postItems}`);

      // 内链必须是站内相对路径
      const bad = r.innerLinks.filter((h) => !h || !h.startsWith('/'));
      assert(bad.length === 0, `${tag} — 正文内链全是站内路径`, `异常：${bad.join(', ')}`);
      assert(r.innerLinks.length >= 3, `${tag} — 正文内链 ≥3`, `实际 ${r.innerLinks.length}`);

      // 内链目标存在性。
      // ⚠️ 跳过 /trucks/*：那是 functions/trucks/[[path]].ts 按需渲染的动态页，
      //    本地 dist 里本来就没有对应文件，硬查会全判成断链（先踩了）。
      const staticLinks = r.innerLinks.filter((h) => !h.startsWith('/trucks/'));
      const missing = staticLinks.filter((h) => !existsSync(path.join(DIST, h, 'index.html')));
      assert(missing.length === 0, `${tag} — ★ 静态内链目标真实存在`, `断链：${missing.join(', ')}`);
    } else {
      // 指南列表页：「深入阅读」+「常见问题速查」
      assert(r.postItems === 3, `${tag} — 列表显示 3 篇文章`, `实际 ${r.postItems}`);
      assert(r.pageH2 === 2, `${tag} — 两个 H2（深入阅读 / 常见问题速查）`, `实际 ${r.pageH2}`);
    }
  }
}

cdp.close();
proc.kill();

console.log('');
if (fails.length) {
  console.log(`❌ ${fails.length} 项失败（通过 ${pass} 项）：`);
  for (const f of fails) console.log('   ✗', f);
  process.exit(1);
}
console.log(`✅ ${pass} 项全部通过`);
