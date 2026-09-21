// CDP 无头验证：head 里的 og / favicon / JSON-LD 在真实浏览器里的表现
//
// 为什么用浏览器复验一遍（curl 已经验过文本了）：
//   1. 浏览器才会真正去加载 favicon —— 能证明文件可达、类型被识别
//   2. 浏览器解析 <script type="application/ld+json">，能暴露 curl 文本比对漏掉的
//      转义/编码问题（比如 U+2028 在 JS 字符串里会截断）
//   3. 能读 document.querySelectorAll 拿到的实际 DOM，而不是正则匹配源码
//
// 用法: node scripts/cdp-head.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
console.log('[cdp-head] 浏览器:', CHROME);

const PORT = 9334;
const profile = mkdtempSync(path.join(os.tmpdir(), 'cdp-head-'));

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
    '--window-size=1280,900',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
);
console.log('[cdp-head] 浏览器 PID', proc.pid);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const wsUrl = await getWsUrl();

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

const cdp = new CDP(wsUrl);
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
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.text +
        ' :: ' +
        JSON.stringify(r.exceptionDetails.exception?.description || '')
    );
  }
  return r.result.value;
}

const TARGETS = [
  { name: '首页', url: 'https://xn--bqr649k.cn/', expectTypes: ['Organization', 'WebSite', 'ItemList', 'ItemList'] },
  { name: '车源大厅', url: 'https://xn--bqr649k.cn/trucks/', expectTypes: ['CollectionPage', 'ItemList', 'Organization'] },
  { name: '行情价格', url: 'https://xn--bqr649k.cn/price/', expectTypes: ['FAQPage', 'Organization'] },
];

let allOk = true;
const results = [];

for (const t of TARGETS) {
  await cdp.send('Page.navigate', { url: t.url }, sessionId);
  await sleep(4000);

  const r = await evalJs(`(async () => {
    /* ---- 1. 浏览器真实解析 JSON-LD ---- */
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
    let ld = null, ldError = null, ldRawLen = 0;
    if (scripts.length) {
      ldRawLen = scripts[0].textContent.length;
      try { ld = JSON.parse(scripts[0].textContent); }
      catch (e) { ldError = String(e.message); }
    }

    /* ---- 2. favicon 实际能否加载（浏览器会真发请求） ---- */
    async function probeImage(href) {
      return await new Promise((resolve) => {
        const img = new Image();
        const t = setTimeout(() => resolve({ href, ok: false, err: 'timeout' }), 8000);
        img.onload = () => { clearTimeout(t); resolve({ href, ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { clearTimeout(t); resolve({ href, ok: false, err: 'onerror' }); };
        img.src = href;
      });
    }

    const iconLinks = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
      .map((l) => ({ rel: l.getAttribute('rel'), href: l.getAttribute('href'), type: l.getAttribute('type') }));

    const ogImageHref = document.querySelector('meta[property="og:image"]')?.content || null;
    const probes = [];
    for (const href of ['/favicon.svg', '/favicon.ico', ogImageHref].filter(Boolean)) {
      probes.push(await probeImage(href));
    }

    /* ---- 3. og meta 从 DOM 读出（不是正则匹配源码） ---- */
    const og = {};
    for (const m of document.querySelectorAll('meta[property^="og:"]')) og[m.getAttribute('property')] = m.content;
    const tw = {};
    for (const m of document.querySelectorAll('meta[name^="twitter:"]')) tw[m.getAttribute('name')] = m.content;
    const canon = document.querySelector('link[rel="canonical"]')?.href || null;

    return { ld, ldError, ldRawLen, scriptCount: scripts.length, iconLinks, probes, og, tw, canon };
  })()`);

  const problems = [];

  /* JSON-LD */
  if (r.scriptCount !== 1) problems.push(`ld+json script 数 = ${r.scriptCount}（期望 1）`);
  if (r.ldError) problems.push(`JSON-LD 解析失败: ${r.ldError}`);
  if (r.ld) {
    const types = (r.ld['@graph'] || [r.ld]).map((n) => n['@type']);
    const exp = JSON.stringify(t.expectTypes);
    const act = JSON.stringify(types);
    if (exp !== act) problems.push(`实体类型 期望 ${exp} 实际 ${act}`);
  } else if (!r.ldError) {
    problems.push('未找到 JSON-LD');
  }

  /* favicon 加载 */
  for (const p of r.probes) {
    if (!p.ok) problems.push(`${p.href} 加载失败 (${p.err || '?'})`);
  }

  /* og */
  const needOg = ['og:type', 'og:title', 'og:description', 'og:url', 'og:image'];
  for (const k of needOg) if (!r.og[k]) problems.push(`缺 ${k}`);
  if (r.og['og:image'] && !/^https:\/\//.test(r.og['og:image'])) problems.push('og:image 非绝对 URL');
  if (r.og['og:url'] && r.canon && r.og['og:url'] !== r.canon) problems.push('og:url != canonical');
  if (r.tw['twitter:card'] !== 'summary_large_image') problems.push('twitter:card 不对');

  const ok = problems.length === 0;
  if (!ok) allOk = false;

  results.push({ name: t.name, ok, problems, r });
}

console.log('');
for (const res of results) {
  console.log(`${res.ok ? '✓' : '✗'} ${res.name}`);
  console.log(`    title: ${res.r.ld ? 'JSON-LD ' + res.r.ldRawLen + 'B / ' + res.r.scriptCount + ' script' : '无 JSON-LD'}`);
  for (const p of res.r.probes) {
    console.log(`    ${p.ok ? '✓' : '✗'} ${p.href} ${p.ok ? p.w + 'x' + p.h : 'FAIL:' + (p.err || '')}`);
  }
  console.log(`    canonical: ${res.r.canon}`);
  console.log(`    og:url:    ${res.r.og['og:url']}`);
  for (const p of res.problems) console.log(`    ✗ ${p}`);
}

cdp.close();
proc.kill();

console.log('');
if (allOk) {
  console.log('[cdp-head] 全部通过 ✓');
  process.exit(0);
} else {
  console.log('[cdp-head] 存在失败项 ✗');
  process.exit(1);
}
