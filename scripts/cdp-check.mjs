// CDP 无头验证：长尾页的前端列表渲染
//
// 本机 agent-browser 被 SIGTERM 拦截，但 Chrome 二进制可以直接用。
// 这个脚本用 CDP 读 DOM 做断言 —— 比肉眼看截图可靠。
//
// 用法: node scripts/cdp-check.mjs
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
console.log('[cdp] 浏览器:', CHROME);

const PORT = 9333;
const profile = mkdtempSync(path.join(os.tmpdir(), 'cdp-'));

const args = [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--window-size=1280,900',
  'about:blank',
];

const proc = spawn(CHROME, args, { stdio: 'ignore', detached: false });
console.log('[cdp] 浏览器 PID', proc.pid);

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
console.log('[cdp] WS', wsUrl);

// 极简 CDP 客户端
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

// 新建 target
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + JSON.stringify(r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

const TARGETS = [
  { name: '长尾页 /trucks/25吨/江苏/', url: 'https://xn--bqr649k.cn/trucks/25%E5%90%A8/%E6%B1%9F%E8%8B%8F/' },
  { name: '长尾页 /trucks/25吨/', url: 'https://xn--bqr649k.cn/trucks/25%E5%90%A8/' },
  { name: '车源大厅 /trucks/', url: 'https://xn--bqr649k.cn/trucks/' },
  { name: '详情页 /trucks/2/', url: 'https://xn--bqr649k.cn/trucks/2/' },
];

let allOk = true;

for (const t of TARGETS) {
  await cdp.send('Page.navigate', { url: t.url }, sessionId);
  await sleep(3500);

  const report = await evalJs(`(() => {
    const list = document.getElementById('truck-list');
    const detail = document.getElementById('truck-detail');
    const cards = document.querySelectorAll('.truck');
    const h1 = document.querySelector('h1');
    const empty = document.querySelector('#truck-list .empty, #truck-detail .empty');
    const disc = document.querySelector('.d-disclaimer');
    const chips = document.querySelectorAll('.chip');
    return {
      title: document.title,
      h1: h1 ? h1.textContent.trim() : null,
      hasList: !!list,
      dataQuery: list ? list.dataset.query : null,
      cardCount: cards.length,
      emptyText: empty ? empty.textContent.trim().slice(0,40) : null,
      detailRendered: detail ? document.querySelectorAll('#truck-detail .d-head').length : -1,
      hasDisclaimer: !!disc,
      chipCount: chips.length,
      firstCardText: cards.length ? cards[0].textContent.replace(/\\s+/g,' ').trim().slice(0,80) : null,
    };
  })()`);

  console.log('\n──────── ' + t.name + ' ────────');
  console.log(JSON.stringify(report, null, 2));

  // 断言
  const isDetail = t.url.includes('/trucks/2/');
  if (isDetail) {
    const ok = report.detailRendered === 1 && report.hasDisclaimer;
    console.log(ok ? '  ✓ 详情页正文 + 免责声明 正常' : '  ✗ 详情页渲染异常');
    allOk = allOk && ok;
  } else {
    const ok = report.cardCount > 0;
    console.log(ok ? `  ✓ 列表渲染出 ${report.cardCount} 张卡片` : `  ✗ 列表未渲染（empty="${report.emptyText}"）`);
    allOk = allOk && ok;
  }
}

console.log('\n════════ 总结: ' + (allOk ? '全部通过 ✓' : '存在失败 ✗') + ' ════════');

cdp.close();
try { proc.kill(); } catch {}
await sleep(300);
process.exit(allOk ? 0 : 1);
