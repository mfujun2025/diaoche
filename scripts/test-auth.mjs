// 登录核心逻辑纯单测（不依赖网络 / D1 / wrangler）
//
// 为什么要这样测：本机 wrangler pages dev 的 Functions 路由不可信（技能 §9.5.1）。
// 把纯逻辑摘出来在 Node 里跑，秒级反馈，且能覆盖服务端不好构造的边界。
//
// 用法: node scripts/test-auth.mjs
import {
  normalizeEmail,
  isLikelyEmail,
  emailHash,
  sha256,
  randomCode,
  randomToken,
  buildSessionCookie,
  clearSessionCookie,
  readCookie,
  nowIso,
  futureIso,
  isExpired,
  decideGate,
  checkSendLimit,
  checkCode,
  safeEqual,
  maskIp,
  buildCodeMail,
  CODE_MAX_ATTEMPTS,
  SESSION_TTL_SEC,
} from '../src/auth-core.mjs';

let pass = 0;
const fails = [];
function assert(cond, name, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(actual, expected, name) {
  assert(actual === expected, name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

console.log('[auth] 登录核心逻辑单测\n');

/* ══════════════ 1. 邮箱规范化与校验 ══════════════ */
console.log('— 邮箱规范化与校验');

eq(normalizeEmail('  Foo@Example.COM  '), 'foo@example.com', 'trim + 小写');
eq(normalizeEmail('a.b+tag@gmail.com'), 'a.b+tag@gmail.com', '★ 不动 gmail 的点号与加号（套用到别家会误判）');
eq(normalizeEmail(null), '', 'null 安全');

assert(isLikelyEmail('user@example.com'), '普通邮箱');
assert(isLikelyEmail('first.last@sub.example.co.uk'), '多级域名');
assert(isLikelyEmail('a+tag@example.cn'), '带加号');
assert(isLikelyEmail('13312345678@163.com'), '手机号式邮箱');
assert(isLikelyEmail('  SPACES@example.com  '), '带空格（先 trim）');

assert(!isLikelyEmail(''), '空串');
assert(!isLikelyEmail('noat.com'), '没有 @');
assert(!isLikelyEmail('a@@b.com'), '两个 @');
assert(!isLikelyEmail('@example.com'), '缺本地部分');
assert(!isLikelyEmail('a@'), '缺域名');
assert(!isLikelyEmail('a@nodot'), '域名没有点');
assert(!isLikelyEmail('a@example.c'), '顶级域只有 1 字符');
assert(!isLikelyEmail('a b@example.com'), '本地部分含空格');
assert(!isLikelyEmail('a..b@example.com'), '连续点号');
assert(!isLikelyEmail('x@example.com'.repeat(30)), '超长');
assert(!isLikelyEmail('用户@example.com'), '中文（本方案不做国际化邮箱）');

/* ══════════════ 2. 哈希 ══════════════ */
console.log('— 哈希');

const h1 = await emailHash('User@Example.com', 'saltA');
const h2 = await emailHash('  user@example.com ', 'saltA');
eq(h1, h2, '★ 同一邮箱不同写法 → 同哈希（否则会重复建号）');

const h3 = await emailHash('user@example.com', 'saltB');
assert(h1 !== h3, '★ 不同盐 → 不同哈希（防彩虹表）');

// SHA-256 已知向量
eq(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256("abc") 标准向量');
eq(await sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'SHA-256("") 标准向量');

assert((await sha256('x')).length === 64, '哈希是 64 位 hex');

// 明文绝不出现在哈希里
assert(!h1.includes('user'), '★ 哈希里不含原文片段');

/* ══════════════ 3. 随机数 ══════════════ */
console.log('— 随机数');

// 验证码：格式、范围、分布
let min = 999999, max = -1;
const seen = new Set();
for (let i = 0; i < 3000; i++) {
  const c = randomCode();
  assert(/^\d{6}$/.test(c), '验证码是 6 位数字（含前导零）', c);
  const n = Number(c);
  if (n < min) min = n;
  if (n > max) max = n;
  seen.add(c);
  if (i > 100) break; // 格式检查做 100 次够了
}
assert(/^\d{6}$/.test(randomCode()), '6 位格式');
assert(seen.size > 90, `★ 随机性：100 次生成出现 ${seen.size} 个不同值（不该有重复）`);

// 拒绝采样：大量样本应覆盖到 0 和 999999 附近
let lo = 0, hi = 0;
for (let i = 0; i < 20000; i++) {
  const n = Number(randomCode());
  if (n < 10000) lo++;
  if (n > 989999) hi++;
}
assert(lo > 100 && hi > 100, `分布覆盖两端（低位 ${lo} / 高位 ${hi}）`);

// token
const t1 = randomToken(), t2 = randomToken();
assert(t1 !== t2, '两次 token 不同');
assert(t1.length >= 40, `token 长度足够（${t1.length}）`);
assert(/^[A-Za-z0-9_-]+$/.test(t1), 'token 是 base64url 安全字符');

/* ══════════════ 4. Cookie ══════════════ */
console.log('— Cookie');

const ck = buildSessionCookie('tok123');
assert(ck.includes('dc_session=tok123'), '带 token');
assert(/HttpOnly/.test(ck), '★ HttpOnly（JS 读不到，防 XSS 偷 token）');
assert(/SameSite=Lax/.test(ck), '★ SameSite=Lax');
assert(/Secure/.test(ck), '★ Secure（HTTPS only）');
assert(/Max-Age=2592000/.test(ck), `Max-Age = 30 天（${SESSION_TTL_SEC}s）`);
assert(!/Domain=/.test(ck), '不设 Domain（默认当前域，避免子域串用）');

const ckLocal = buildSessionCookie('tok', { secure: false });
assert(!/Secure/.test(ckLocal), '本地开发可关 Secure');

const clr = clearSessionCookie();
assert(/dc_session=;/.test(clr) && /Max-Age=0/.test(clr), '清除 cookie 写法正确');

eq(readCookie('a=1; dc_session=abc; b=2'), 'abc', '从 Cookie 头取值');
eq(readCookie('dc_session=abc'), 'abc', '只有一个');
eq(readCookie('a=1'), null, '没有则 null');
eq(readCookie(null), null, 'null 安全');
eq(readCookie('xdc_session=wrong'), null, '★ 不误匹配后缀同名（前缀必须完整对齐）');
eq(readCookie('dc_session=a=b=c'), 'a=b=c', '值里含 = 也能取全');

/* ══════════════ 5. 时间 ══════════════ */
console.log('— 时间');

assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(nowIso()), 'nowIso 格式符合 SQLite datetime', nowIso());
assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(futureIso(600)), 'futureIso 格式');

assert(isExpired(futureIso(-10)), '过去的已过期');
assert(!isExpired(futureIso(600)), '未来的未过期');
assert(isExpired(null), 'null 视为过期（fail closed）');
assert(isExpired(undefined), 'undefined 视为过期');
assert(isExpired(''), '空串视为过期');

// 字典序 == 时间序（设计依赖这一点）
const a = futureIso(100), b = futureIso(200);
assert(a < b, '★ ISO 字符串字典序与时间序一致（可直接用于 SQL 比较）');

/* ══════════════ 6. 登录门禁 ══════════════ */
console.log('— 登录门禁判定');

const goodSession = { user_id: 7, expires_at: futureIso(600) };
const goodUser = { id: 7, status: 'active' };

eq(decideGate(goodSession, goodUser).action, 'allow', '正常会话放行');
eq(decideGate(goodSession, goodUser).userId, 7, '返回正确 userId');

eq(decideGate(null, goodUser).action, 'needLogin', '无会话 → 要登录');
assert(decideGate(null, goodUser).msg.includes('登录'), '提示语含「登录」');

eq(decideGate({ user_id: 7, expires_at: futureIso(-1) }, goodUser).action, 'needLogin', '★ 会话过期 → 要登录');

eq(decideGate(goodSession, null).action, 'needLogin', '★ 会话在但用户被删 → 要登录');
eq(decideGate(goodSession, { id: 7, status: 'banned' }).action, 'needLogin', '★ 用户被封禁 → 要登录');

/* ══════════════ 7. 发码限流 ══════════════ */
console.log('— 发码限流');

eq(checkSendLimit({ ipCountLastMinute: 0, ipCountLastHour: 0, emailCountLastHour: 0 }).ok, true, '全新 → 放行');

const blockedMin = checkSendLimit({ ipCountLastMinute: 1, ipCountLastHour: 0, emailCountLastHour: 0 });
eq(blockedMin.ok, false, '★ 每分钟超限 → 拒绝');
assert(blockedMin.msg.includes('频繁'), '提示「频繁」');

assert(!checkSendLimit({ ipCountLastMinute: 0, ipCountLastHour: 99, emailCountLastHour: 0 }).ok, '每小时 IP 超限');
assert(!checkSendLimit({ ipCountLastMinute: 0, ipCountLastHour: 0, emailCountLastHour: 99 }).ok, '★ 每邮箱超限（防骚扰他人）');

// 顺序：短窗口优先
const multi = checkSendLimit({ ipCountLastMinute: 5, ipCountLastHour: 5, emailCountLastHour: 5 });
assert(multi.msg.includes('频繁'), '多个都超时优先报最短窗口');

/* ══════════════ 8. 验证码校验 ══════════════ */
console.log('— 验证码校验');

const codeRec = { code_hash: 'HASH_A', attempts: 0, used: 0, expires_at: futureIso(600) };

eq(checkCode({ record: codeRec, inputHash: 'HASH_A' }).ok, true, '正确验证码通过');

const wrong = checkCode({ record: codeRec, inputHash: 'HASH_B' });
eq(wrong.ok, false, '错误验证码拒绝');
assert(!wrong.fatal, '错误码不算致命（还能重试）');
assert(wrong.msg.includes('不正确'), '提示「不正确」');

const noRec = checkCode({ record: null, inputHash: 'HASH_A' });
eq(noRec.ok, false, '无记录拒绝');
assert(noRec.fatal, '无记录是致命的');

assert(checkCode({ record: { ...codeRec, used: 1 }, inputHash: 'HASH_A' }).fatal, '★ 已使用 → 致命（防重放）');
assert(checkCode({ record: { ...codeRec, expires_at: futureIso(-1) }, inputHash: 'HASH_A' }).fatal, '★ 已过期 → 致命');
assert(checkCode({ record: { ...codeRec, attempts: CODE_MAX_ATTEMPTS }, inputHash: 'HASH_A' }).fatal, `★ 尝试达上限(${CODE_MAX_ATTEMPTS}) → 致命`);

// 边界：上限前一次仍可试
eq(checkCode({ record: { ...codeRec, attempts: CODE_MAX_ATTEMPTS - 1 }, inputHash: 'HASH_A' }).ok, true, '上限前一次仍可成功');

// 致命优先于码错误判断
const usedWrong = checkCode({ record: { ...codeRec, used: 1 }, inputHash: 'HASH_B' });
assert(usedWrong.fatal, '已使用 + 码错 → 报致命而不是报码错');

/* ══════════════ 9. 恒定时间比较 ══════════════ */
console.log('— 恒定时间比较');

assert(safeEqual('abc', 'abc'), '相同为真');
assert(!safeEqual('abc', 'abd'), '不同为假');
assert(!safeEqual('abc', 'ab'), '★ 长度不同直接假（不逐位比）');
assert(!safeEqual('', 'a'), '空串安全');
assert(safeEqual('', ''), '两个空串为真');

/* ══════════════ 10. IP 打码 ══════════════ */
console.log('— IP 打码');

eq(maskIp('203.0.113.45'), '203.0.*.*', 'IPv4 保留前两段');
eq(maskIp('2001:db8::1'), '2001:db8:***', 'IPv6 保留前两段');
eq(maskIp(''), '未知', '空值');
eq(maskIp('garbage'), '***', '非法格式');

/* ══════════════ 11. 邮件正文 ══════════════ */
console.log('— 邮件正文');

const mail = buildCodeMail('123456', 10, '203.0.113.45', '吊车.cn');
assert(mail.subject.includes('123456'), '主题含验证码（用户不点开也能看到）');
assert(mail.subject.includes('吊车.cn'), '主题含站名（防钓鱼混淆）');
assert(mail.text.includes('123456'), '正文含验证码');
assert(mail.text.includes('10 分钟'), '正文含有效期');
assert(mail.text.includes('忽略'), '★ 正文含「非本人操作请忽略」提示');
assert(!mail.text.includes('203.0.113.45'), '★ 正文里的 IP 已打码');
assert(mail.html.includes('123456'), 'HTML 版含验证码');
assert(mail.html.includes('<!DOCTYPE html>'), 'HTML 结构完整');
assert(!/立即|马上|点击领取|限时/.test(mail.subject + mail.text), '★ 不用营销词（避免进垃圾箱）');

// 注入防护
const evil = buildCodeMail('<script>alert(1)</script>', 10, '1.2.3.4', '<b>站</b>');
assert(!evil.html.includes('<script>'), '★ 验证码内容里的标签被转义');
assert(!evil.html.includes('<b>站</b>'), '★ 站名里的标签被转义');
assert(evil.html.includes('&lt;script&gt;'), '确实转义成了实体');

/* ══════════════ 结果 ══════════════ */
console.log(`\n[auth] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[auth] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[auth] 全部通过 ✓');
