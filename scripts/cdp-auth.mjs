// CDP 无头端到端验证：登录全流程
//
// 为什么要用真浏览器跑一遍（纯逻辑单测 + SQL 集成测试都覆盖不到的部分）：
//   1. **Cookie 能否被浏览器保存并在下次请求带上** —— 这是登录能不能用的命门，
//      单测里读的是字符串，只有浏览器才知道它会不会真的存下来
//   2. **HttpOnly 是否真的生效** —— document.cookie 里应当看不到它
//   3. 登录成功后「自动重试获取联系方式」这条链路是否真的跑通
//   4. 前端表单交互（倒计时、错误提示、清空重来）是否符合预期
//
// 前提：站点已部署，且远程 D1 已执行过 schema.sql。
//       若远程缺表，脚本会明确报出来（而不是含糊地失败）。
//
// 用法: node scripts/cdp-auth.mjs
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

// 允许用环境变量覆盖：本地跑时用 http://127.0.0.1:xxxx
const SITE = process.env.AUTH_TEST_SITE || 'https://xn--bqr649k.cn';

console.log('[cdp-auth] 浏览器:', CHROME);
console.log('[cdp-auth] 站点:', SITE);

const PORT = 9335;
const profile = mkdtempSync(path.join(os.tmpdir(), 'cdp-auth-'));

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

async function ev(expr) {
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

let pass = 0;
const fails = [];
function assert(cond, name, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail !== undefined ? ` — ${detail}` : ''}`);
}

/* ══════════════════════════════════════════════════════
   0. 前置：远程 D1 有没有建表
   ══════════════════════════════════════════════════════ */
console.log('\n[0] 前置检查：接口可用性');

await cdp.send('Page.navigate', { url: SITE + '/trucks/' }, sessionId);
await sleep(2500);

// 用一个明显不合法的邮箱打 /api/auth/send-code，看返回什么：
//   - 400「请输入有效的邮箱地址」→ 表结构没问题（走到了参数校验）
//   - 500「服务暂时不可用」      → 很可能远程 D1 没建表
const probe = await ev(`(async () => {
  const r = await fetch('/api/auth/send-code', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email: 'not-an-email' })
  });
  return { status: r.status, body: await r.json().catch(()=>({})) };
})()`);

assert(probe.status === 400, '发码接口参数校验返回 400', `实际 ${probe.status} ${JSON.stringify(probe.body)}`);

if (probe.status === 500) {
  console.log('\n  ⚠️ 接口 500 —— 大概率是远程 D1 还没执行 schema.sql。');
  console.log('     请先跑：npx wrangler d1 execute diaoche-db --file=./schema.sql --remote');
}

/* ══════════════════════════════════════════════════════
   1. 打开一个真实车源详情页，确认登录框能出来
   ══════════════════════════════════════════════════════ */
console.log('\n[1] 详情页门禁');

// 先找一个存在的车源 id
const truckId = await ev(`(async () => {
  const r = await fetch('/api/trucks');
  const j = await r.json().catch(()=>({}));
  const list = (j.data && (j.data.items || j.data)) || [];
  const first = Array.isArray(list) ? list[0] : null;
  return first ? (first.id || null) : null;
})()`);

assert(!!truckId, '至少存在 1 条已审核车源', `拿到 id=${truckId}`);

if (!truckId) {
  console.log('\n  没有可测车源，后续测试跳过。');
  cdp.close();
  proc.kill();
  process.exit(1);
}

await cdp.send('Page.navigate', { url: `${SITE}/trucks/${truckId}/` }, sessionId);
await sleep(3000);

// 点「查看联系方式」→ 应出现登录框
const gateShown = await ev(`(async () => {
  const btn = document.querySelector('#d-ct-btn');
  if (!btn) return { err: '找不到 #d-ct-btn' };
  btn.click();
  await new Promise(r => setTimeout(r, 2200));
  const box = document.querySelector('.d-login');
  const form = document.querySelector('#d-login-form');
  return {
    hasBox: !!box,
    hasForm: !!form,
    hasEmail: !!document.querySelector('#d-email'),
    hasCode: !!document.querySelector('#d-code'),
    hasSend: !!document.querySelector('#d-send'),
    hasSubmit: !!document.querySelector('#d-login-btn'),
    sendText: (document.querySelector('#d-send')||{}).textContent,
    stillSoon: !!document.querySelector('.d-login .soon')
  };
})()`);

assert(gateShown.hasBox, '登录框已显示');
assert(gateShown.hasForm, '登录表单已渲染');
assert(gateShown.hasEmail, '有邮箱输入框');
assert(gateShown.hasCode, '有验证码输入框');
assert(gateShown.hasSend, '有获取验证码按钮');
assert(gateShown.hasSubmit, '有登录按钮');
assert(!gateShown.stillSoon, '★ 不再有「功能开发中」标记');
assert(
  String(gateShown.sendText).includes('获取验证码'),
  '发码按钮文案正确',
  gateShown.sendText
);

/* ══════════════════════════════════════════════════════
   2. 前端交互：验证码框只收数字、邮箱为空时提示
   ══════════════════════════════════════════════════════ */
console.log('\n[2] 前端表单交互');

const interact = await ev(`(async () => {
  const email = document.querySelector('#d-email');
  const code = document.querySelector('#d-code');
  const err = document.querySelector('#d-err');
  const send = document.querySelector('#d-send');

  // 空邮箱点发码 → 应提示
  send.click();
  await new Promise(r => setTimeout(r, 300));
  const emptyMsg = err ? err.textContent : '';

  // 验证码框输入字母 → 应被过滤掉
  code.value = 'a1b2c3';
  code.dispatchEvent(new Event('input', {bubbles:true}));
  const filtered = code.value;

  // 超长输入应被截断到 6 位
  code.value = '1234567890';
  code.dispatchEvent(new Event('input', {bubbles:true}));
  const truncated = code.value;

  return { emptyMsg, filtered, truncated };
})()`);

assert(
  interact.emptyMsg.includes('邮箱'),
  '空邮箱点发码有提示',
  interact.emptyMsg
);
assert(interact.filtered === '123', '★ 验证码框过滤非数字', `实际 "${interact.filtered}"`);
assert(interact.truncated === '123456', '★ 验证码框截断到 6 位', `实际 "${interact.truncated}"`);

/* ══════════════════════════════════════════════════════
   3. 未登录时 contact 接口应 401 + needLogin
   ══════════════════════════════════════════════════════ */
console.log('\n[3] 未登录门禁');

const unauth = await ev(`(async () => {
  const r = await fetch('/api/truck/${truckId}/contact', { headers: {Accept:'application/json'} });
  return { status: r.status, body: await r.json().catch(()=>({})) };
})()`);

assert(unauth.status === 401, '未登录访问联系方式返回 401', `实际 ${unauth.status}`);
assert(unauth.body.needLogin === true, '★ 返回 needLogin 标记（前端契约）');
assert(!JSON.stringify(unauth.body).includes('138'), '★ 401 响应里不含联系方式');

/* ══════════════════════════════════════════════════════
   4. 未登录时 /api/auth/me 应 loggedIn:false
   ══════════════════════════════════════════════════════ */
console.log('\n[4] 登录态查询');

const meAnon = await ev(`(async () => {
  const r = await fetch('/api/auth/me');
  return { status: r.status, body: await r.json().catch(()=>({})) };
})()`);
assert(meAnon.status === 200, 'me 接口返回 200');
assert(meAnon.body.loggedIn === false, '未登录时 loggedIn=false');

/* ══════════════════════════════════════════════════════
   5. 伪造会话 Cookie 应被拒绝
   ══════════════════════════════════════════════════════ */
console.log('\n[5] 伪造会话');

const forged = await ev(`(async () => {
  document.cookie = 'dc_session=fake-token-should-not-work; path=/';
  const r = await fetch('/api/truck/${truckId}/contact', { headers: {Accept:'application/json'} });
  const b = await r.json().catch(()=>({}));
  // 清掉伪造的
  document.cookie = 'dc_session=; Max-Age=0; path=/';
  return { status: r.status, needLogin: b.needLogin === true };
})()`);

assert(forged.status === 401, '★ 伪造 token 被拒绝（401）', `实际 ${forged.status}`);
assert(forged.needLogin, '伪造 token 仍返回 needLogin');

/* ══════════════════════════════════════════════════════
   6. 完整登录流程（开发模式下拿码 → 登录 → 自动看到联系方式）
   ══════════════════════════════════════════════════════ */
console.log('\n[6] 完整登录流程');

// 只有在服务端开了 DC_MAIL_DEV_MODE 时才拿得到 devCode。
// 没开的话，这里只能验证「发码成功但拿不到码」，并明确告知。
const testEmail = `authtest+${Date.now()}@example.com`;

const sent = await ev(`(async () => {
  const r = await fetch('/api/auth/send-code', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email: ${JSON.stringify(testEmail)} })
  });
  return { status: r.status, body: await r.json().catch(()=>({})) };
})()`);

assert(sent.status === 200, '发码请求成功（200）', `实际 ${sent.status} ${JSON.stringify(sent.body)}`);
assert(sent.body.ok === true, '发码返回 ok');
console.log(
  `     devCode: ${sent.body.devCode ? sent.body.devCode : '（未开启开发模式，无法自动登录）'}`
);

if (sent.body.devCode) {
  // —— 有码，走完整登录 ——
  const login = await ev(`(async () => {
    const r = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: ${JSON.stringify(testEmail)}, code: ${JSON.stringify(sent.body.devCode)} })
    });
    const b = await r.json().catch(()=>({}));
    // ★ 关键：HttpOnly cookie 不该被 JS 读到
    const jsVisible = document.cookie.includes('dc_session');
    return { status: r.status, body: b, jsVisible };
  })()`);

  assert(login.status === 200, '登录成功（200）', `${login.status} ${JSON.stringify(login.body)}`);
  assert(login.body.ok === true, '登录返回 ok');
  assert(login.body.userId > 0, '返回了 userId');
  assert(login.jsVisible === false, '★ 会话 Cookie 对 JS 不可见（HttpOnly 生效）');

  // 登录态确认
  const meIn = await ev(`(async () => {
    const r = await fetch('/api/auth/me');
    return await r.json().catch(()=>({}));
  })()`);
  assert(meIn.loggedIn === true, '★ 登录后 me 返回 loggedIn=true');

  // 带会话取联系方式
  const contact = await ev(`(async () => {
    const r = await fetch('/api/truck/${truckId}/contact', { headers: {Accept:'application/json'} });
    return { status: r.status, body: await r.json().catch(()=>({})) };
  })()`);
  assert(contact.status === 200, '★ 登录后能取到联系方式（200）', `实际 ${contact.status}`);
  assert(!!(contact.body.data && contact.body.data.contact), '联系方式非空');

  /* ── 7. 界面上的自动重试 ── */
  console.log('\n[7] 界面端到端');

  await cdp.send('Page.navigate', { url: `${SITE}/trucks/${truckId}/` }, sessionId);
  await sleep(3000);

  const uiFlow = await ev(`(async () => {
    const btn = document.querySelector('#d-ct-btn');
    if (!btn) return { err: '找不到按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 2500));
    return {
      // 已登录 → 应该直接显示联系方式，不再是登录框
      hasContact: !!document.querySelector('.d-contact .val'),
      contactText: (document.querySelector('.d-contact .val')||{}).textContent || '',
      stillLogin: !!document.querySelector('.d-login'),
      hasLogout: !!document.querySelector('#d-logout')
    };
  })()`);

  assert(uiFlow.hasContact, '★ 已登录时直接显示联系方式（不再要求登录）', JSON.stringify(uiFlow));
  assert(!uiFlow.stillLogin, '已登录时不再显示登录框');
  assert(uiFlow.hasLogout, '显示「退出登录」入口');
  assert(
    String(uiFlow.contactText).trim().length > 0,
    '联系方式内容非空'
  );

  /* ── 8. 退出登录 ── */
  console.log('\n[8] 退出登录');

  const logout = await ev(`(async () => {
    const r = await fetch('/api/auth/logout', { method: 'POST' });
    const b = await r.json().catch(()=>({}));
    const me = await (await fetch('/api/auth/me')).json().catch(()=>({}));
    return { status: r.status, body: b, loggedInAfter: me.loggedIn };
  })()`);

  assert(logout.status === 200, '退出接口 200');
  assert(logout.loggedInAfter === false, '★ 退出后 me 返回 loggedIn=false');

  // 退出后 contact 应重新要求登录
  const afterOut = await ev(`(async () => {
    const r = await fetch('/api/truck/${truckId}/contact', { headers: {Accept:'application/json'} });
    const b = await r.json().catch(()=>({}));
    return { status: r.status, needLogin: b.needLogin === true };
  })()`);

  assert(afterOut.status === 401, '★ 退出后联系方式重新被拦（401）');
  assert(afterOut.needLogin, '退出后返回 needLogin');
} else {
  console.log('     ⏭  跳过完整登录流程（服务端未开 DC_MAIL_DEV_MODE）');
  console.log('        要自动跑完整流程，临时设环境变量 DC_MAIL_DEV_MODE=1 后重试');
}

/* ══════════════════════════════════════════════════════
   结果
   ══════════════════════════════════════════════════════ */
cdp.close();
proc.kill();

console.log(`\n[cdp-auth] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[cdp-auth] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[cdp-auth] 全部通过 ✓');
