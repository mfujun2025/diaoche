// CDP 验证：后台 /admin/ 能真的登录进去
//
// 背景：曾发生 DC_ADMIN_KEY 变空导致后台全挂、而 CI 全绿的事故。
// 这个脚本用真浏览器走完整登录流程，确认后台确实可用。
//
// 用法: ADMIN_KEY=xxx node scripts/cdp-admin.mjs
//       （ADMIN_KEY 不给则只验证「不再报未配置密钥」）
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SITE = process.env.SITE || 'https://xn--bqr649k.cn';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

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
console.log('[cdp-admin] 浏览器:', CHROME);
console.log('[cdp-admin] 站点:', SITE);

const PORT = 9336;
const profile = mkdtempSync(path.join(os.tmpdir(), 'cdp-admin-'));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('CDP 未就绪');
}

// 极简 CDP 客户端
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) {
        const h = this.handlers.get(m.method);
        if (h) h(m.params);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  on(method, fn) {
    this.handlers.set(method, fn);
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

let pass = 0;
const fails = [];
const ok = (m) => {
  pass++;
  console.log(`  ✓ ${m}`);
};
const bad = (m) => {
  fails.push(m);
  console.log(`  ✗ ${m}`);
};

const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
const url = await wsUrl();
const ws = new WebSocket(url);
await new Promise((r) => (ws.onopen = r));
const cdp = new CDP(ws);

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

const ev = async (expr) => {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression: expr, awaitPromise: true, returnByValue: true },
    sessionId
  );
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval 失败');
  return r.result.value;
};

/* ─── 1. 后台登录页：不能再出现「未配置访问密钥」 ─── */
console.log('\n[1] 后台登录页状态');
await cdp.send('Page.navigate', { url: `${SITE}/admin/` }, sessionId);
await sleep(3500);

const pageState = await ev(`(() => {
  const body = document.body.innerText || '';
  return {
    hasUnconfigured: body.includes('未配置访问密钥'),
    hasLoginForm: !!document.querySelector('input[type=password]'),
    text: body.slice(0, 200)
  };
})()`);

if (pageState.hasUnconfigured) {
  bad('★ 页面仍显示「未配置访问密钥」—— DC_ADMIN_KEY 依然没生效');
} else {
  ok('页面不再报「未配置访问密钥」');
}

if (pageState.hasLoginForm) {
  ok('后台登录表单存在');
} else {
  bad('找不到后台登录表单');
}

/* ─── 2. 用密钥实际登录 ─── */
if (ADMIN_KEY) {
  console.log('\n[2] 实际登录');
  const login = await ev(`(async () => {
    const input = document.querySelector('input[type=password]');
    if (!input) return { err: '无密码框' };
    input.value = ${JSON.stringify(ADMIN_KEY)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find(b => /登\\s*录/.test(b.textContent));
    if (!btn) return { err: '无登录按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 3000));
    const body = document.body.innerText || '';
    return {
      // ★ 判据用「有没有进入审核后台」，不要用「密码框有没有消失」——
      //   登录后页面可能仍保留输入框，那样会误判失败。
      hasAdminPanel: body.includes('内容审核后台') || body.includes('车源审核'),
      hasStats: /待审\\s*\\d+/.test(body),
      hasLogout: body.includes('退出'),
      hasUnconfigured: body.includes('未配置访问密钥'),
      text: body.slice(0, 300)
    };
  })()`);

  if (login.err) {
    bad(`登录操作失败：${login.err}`);
  } else if (login.hasUnconfigured) {
    bad('★ 登录后仍报「未配置访问密钥」');
  } else if (login.hasAdminPanel && login.hasLogout) {
    ok('★ 登录成功，已进入审核后台（后台完全可用）');
    if (login.hasStats) ok('后台统计数据正常渲染');
  } else {
    bad(`登录未成功。页面文本：${login.text.slice(0, 150)}`);
  }
} else {
  console.log('\n[2] 实际登录 —— 跳过（未提供 ADMIN_KEY 环境变量）');
}

/* ─── 结果 ─── */
cdp.close();
proc.kill();

console.log(`\n[cdp-admin] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[cdp-admin] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[cdp-admin] 全部通过 ✓');
