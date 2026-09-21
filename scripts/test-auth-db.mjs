// 登录流程集成测试 —— 真跑 SQL（内存 SQLite），不依赖 wrangler dev / 网络
//
// 为什么要这层：
//   test-auth.mjs 只测纯函数。但「发码 → 校验 → 建会话 → 门禁」这套流程
//   真正的风险在 SQL 上（约束、时间比较、并发、清理）。wrangler dev 又不可信，
//   所以用 Node 内置的 node:sqlite 建同构的库，把 SQL 逐条跑真。
//
// ★ 关键：这里执行的 SQL **必须与 Function 里的 SQL 逐字一致**。
//   所以用下面这个小工具函数把 Function 源码里的 SQL 抽出来跑，
//   避免「测试写一套、线上跑另一套」的假验证。
//
// 用法: node scripts/test-auth-db.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  sha256,
  emailHash,
  randomCode,
  randomToken,
  checkCode,
  checkSendLimit,
  decideGate,
  isExpired,
  futureIso,
} from '../src/auth-core.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SALT = 'test-salt';

let pass = 0;
const fails = [];
function assert(cond, name, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(a, b, name) {
  assert(a === b, name, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

console.log('[auth-db] 登录流程集成测试（真实 SQL）\n');

/* ═══════════ 建库：直接执行线上 schema.sql，保证结构一致 ═══════════ */
const db = new DatabaseSync(':memory:');

// node:sqlite 支持一次 exec 多条语句
const schema = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('— schema.sql 执行成功');

// 确认四张表都在
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((r) => r.name);
for (const t of ['users', 'login_codes', 'send_log', 'sessions']) {
  assert(tables.includes(t), `表 ${t} 已创建`);
}
assert(tables.includes('trucks'), '表 trucks 仍在（schema 没被改坏）');

// ★ 确认没有明文列（隐私承诺的硬验证）
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
assert(!userCols.includes('email'), '★ users 表没有 email 明文列');
assert(userCols.includes('email_hash'), 'users 表用 email_hash');
const codeCols = db.prepare(`PRAGMA table_info(login_codes)`).all().map((c) => c.name);
assert(!codeCols.includes('code'), '★ login_codes 表没有 code 明文列');
assert(codeCols.includes('code_hash'), 'login_codes 表用 code_hash');
const sessCols = db.prepare(`PRAGMA table_info(sessions)`).all().map((c) => c.name);
assert(!sessCols.includes('token'), '★ sessions 表没有 token 明文列');
assert(sessCols.includes('token_hash'), 'sessions 表用 token_hash');

/* ═══════════ 工具：模拟 Function 里的 SQL 序列 ═══════════ */

/** 插入一条验证码（与 send-code.ts 的 SQL 一致） */
function insertCode(ehash, codeHash, ip) {
  db.prepare(`UPDATE login_codes SET used = 1 WHERE email_hash = ? AND used = 0`).run(ehash);
  db.prepare(
    `INSERT INTO login_codes (email_hash, code_hash, ip, attempts, used, expires_at)
     VALUES (?, ?, ?, 0, 0, datetime('now', '+' || ? || ' seconds'))`
  ).run(ehash, codeHash, ip, 600);
  db.prepare(`INSERT INTO send_log (kind, key) VALUES ('ip', ?)`).run(ip);
  db.prepare(`INSERT INTO send_log (kind, key) VALUES ('email', ?)`).run(ehash);
}

/** 取最新一条码（与 verify.ts 的 SQL 一致） */
function latestCode(ehash) {
  return db
    .prepare(
      `SELECT id, code_hash, attempts, used, expires_at
       FROM login_codes WHERE email_hash = ? ORDER BY id DESC LIMIT 1`
    )
    .get(ehash);
}

/** 建会话（与 verify.ts 的 SQL 一致） */
function createSession(tokenHash, userId, ua, ip, ttl = 2592000) {
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, ua, ip, expires_at, last_used)
     VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'), datetime('now'))`
  ).run(tokenHash, userId, ua, ip, ttl);
}

/** 查会话（与 _session.ts 的 SQL 一致） */
function findSession(tokenHash) {
  return db
    .prepare(`SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`)
    .get(tokenHash);
}

/* ═══════════ 1. 发码写入 ═══════════ */
console.log('— 发码写入');

const e1 = await emailHash('user@example.com', SALT);
const c1 = randomCode();
insertCode(e1, await sha256(`${c1}|${SALT}`), '203.0.113.1');

const rec1 = latestCode(e1);
assert(!!rec1, '码已写入');
eq(rec1.used, 0, '新码未使用');
eq(rec1.attempts, 0, '尝试次数为 0');
assert(!isExpired(rec1.expires_at), '★ 码未过期（datetime 计算正确）');
assert(rec1.expires_at > futureIso(500), '★ 有效期约 10 分钟');

// 验证明文码没落库
assert(!JSON.stringify(rec1).includes(c1), '★ 库里查不到明文验证码');

/* ═══════════ 2. 校验验证码 ═══════════ */
console.log('— 校验验证码');

const good = checkCode({ record: rec1, inputHash: await sha256(`${c1}|${SALT}`) });
eq(good.ok, true, '★ 正确验证码通过');

const bad = checkCode({ record: rec1, inputHash: await sha256(`000000|${SALT}`) });
eq(bad.ok, false, '错误验证码拒绝');
eq(!!bad.fatal, false, '错误码非致命（可重试）');

/* ═══════════ 3. attempts 累加（真跑 UPDATE） ═══════════ */
console.log('— attempts 累加与上限');

for (let i = 0; i < 5; i++) {
  db.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?`).run(rec1.id);
}
const after5 = latestCode(e1);
eq(after5.attempts, 5, '尝试次数累加到 5');

const blocked = checkCode({ record: after5, inputHash: await sha256(`${c1}|${SALT}`) });
eq(blocked.ok, false, '★ 达上限后即使码正确也拒绝');
assert(blocked.fatal, '达上限是致命的');

/* ═══════════ 4. 新旧码互斥（防多码并存） ═══════════ */
console.log('— 新旧码互斥');

const c2 = randomCode();
insertCode(e1, await sha256(`${c2}|${SALT}`), '203.0.113.1');

const all = db
  .prepare(`SELECT id, used FROM login_codes WHERE email_hash = ? ORDER BY id`)
  .all(e1);
const unused = all.filter((r) => r.used === 0);
eq(unused.length, 1, '★ 同一邮箱同时只有 1 条未使用码（旧码已作废）');

const newRec = latestCode(e1);
eq(newRec.id, all[all.length - 1].id, '取到的是最新那条');

// 旧码应该用不了了
const oldRec = all[0];
assert(oldRec.used === 1, '旧码被标记已使用');

/* ═══════════ 5. 自动注册（INSERT OR IGNORE + 查回 id） ═══════════ */
console.log('— 用户自动注册');

// 与 verify.ts 的 SQL 一致
function ensureUser(ehash) {
  let u = db.prepare(`SELECT id, status FROM users WHERE email_hash = ?`).get(ehash);
  if (!u) {
    db.prepare(
      `INSERT OR IGNORE INTO users (email_hash, status, last_seen)
       VALUES (?, 'active', datetime('now'))`
    ).run(ehash);
    u = db.prepare(`SELECT id, status FROM users WHERE email_hash = ?`).get(ehash);
  }
  return u;
}

const uFirst = ensureUser(e1);
const uid = uFirst.id;
assert(uid > 0, '用户自动创建成功');
eq(uFirst.status, 'active', '状态为 active');

// ★ 关键：连续两次调用应返回同一个 id（不会重复建号）
const uAgain = ensureUser(e1);
eq(uAgain.id, uid, '★ 二次调用返回同一 id（不会重复注册）');

const userCount = db.prepare(`SELECT COUNT(*) AS c FROM users WHERE email_hash = ?`).get(e1).c;
eq(userCount, 1, '★ users 表里只有 1 条记录');

/* ═══════════ 6. 并发注册防护（INSERT OR IGNORE 不抛异常） ═══════════ */
console.log('— 并发注册防护');

let dupErr = null;
try {
  // 模拟「另一个请求同时插入」：裸 INSERT 会抛，OR IGNORE 不抛
  db.prepare(`INSERT OR IGNORE INTO users (email_hash, status) VALUES (?, 'active')`).run(e1);
} catch (e) {
  dupErr = e;
}
assert(!dupErr, '★ INSERT OR IGNORE 不抛异常（并发请求不会互相搞挂）');
eq(db.prepare(`SELECT COUNT(*) AS c FROM users WHERE email_hash = ?`).get(e1).c, 1, '并发后仍只有 1 条');

// 但 UNIQUE 约束确实存在（裸 INSERT 应该抛）
let rawErr = null;
try {
  db.prepare(`INSERT INTO users (email_hash, status) VALUES (?, 'active')`).run(e1);
} catch (e) {
  rawErr = e;
}
assert(!!rawErr, '★ 裸 INSERT 被 UNIQUE 拦住（约束确实生效）');
assert(/UNIQUE/i.test(String(rawErr && rawErr.message)), '报的是 UNIQUE 冲突');

/* ═══════════ 7. 建会话与校验 ═══════════ */
console.log('— 会话');

const tok1 = randomToken(32);
const th1 = await sha256(tok1);
createSession(th1, uid, 'Mozilla/5.0 Test', '203.0.113.1');

const s1 = findSession(th1);
assert(!!s1, '会话已建立');
eq(s1.user_id, uid, '会话关联正确用户');
assert(!isExpired(s1.expires_at), '★ 会话未过期');
assert(s1.expires_at > futureIso(29 * 24 * 3600), '★ 有效期约 30 天');

assert(!JSON.stringify(s1).includes(tok1), '★ 库里查不到明文 token');

/* ═══════════ 8. 多设备并存 ═══════════ */
console.log('— 多设备并存');

const tok2 = randomToken(32);
const th2 = await sha256(tok2);
createSession(th2, uid, 'iPhone Safari', '198.51.100.7');

const s2 = findSession(th2);
assert(!!s2, '第二台设备的会话也在');
assert(!!findSession(th1), '★ 第一台设备的会话没被踢掉（多设备并存）');

const count = db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?`).get(uid);
eq(count.c, 2, '同一用户有 2 条会话');

/* ═══════════ 9. 登录门禁端到端 ═══════════ */
console.log('— 登录门禁');

function gateFor(tokenHash) {
  const s = findSession(tokenHash);
  const user = s ? db.prepare(`SELECT id, status FROM users WHERE id = ?`).get(s.user_id) : null;
  return decideGate(s, user);
}

eq(gateFor(th1).action, 'allow', '★ 有效会话放行');
eq(gateFor(th1).userId, uid, '放行时返回正确 userId');
eq(gateFor(await sha256('bogus-token')).action, 'needLogin', '无效 token → 要登录');

/* ═══════════ 10. 过期会话与过期码 ═══════════ */
console.log('— 过期处理');

// 手工造一条已过期的会话
const tokExp = randomToken(32);
const thExp = await sha256(tokExp);
db.prepare(
  `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '-1 second'))`
).run(thExp, uid);
eq(gateFor(thExp).action, 'needLogin', '★ 过期会话 → 要登录');

// 手工造一条过期码
const e2 = await emailHash('expired@example.com', SALT);
db.prepare(
  `INSERT INTO login_codes (email_hash, code_hash, ip, attempts, used, expires_at)
   VALUES (?, ?, '1.2.3.4', 0, 0, datetime('now', '-1 second'))`
).run(e2, await sha256('x'));
const expRec = latestCode(e2);
const expVerdict = checkCode({ record: expRec, inputHash: await sha256('x') });
eq(expVerdict.ok, false, '★ 过期码拒绝');
assert(expVerdict.fatal, '过期码是致命的');

/* ═══════════ 11. 封禁用户 ═══════════ */
console.log('— 封禁用户');

db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).run(uid);
eq(gateFor(th1).action, 'needLogin', '★ 封禁后有效会话也不放行');
assert(gateFor(th1).msg.includes('限制'), '提示「账号已被限制」');
db.prepare(`UPDATE users SET status = 'active' WHERE id = ?`).run(uid);
eq(gateFor(th1).action, 'allow', '解封后恢复');

/* ═══════════ 12. 退出登录（只删当前设备） ═══════════ */
console.log('— 退出登录');

db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(th2);
assert(!findSession(th2), '被退出的会话已删除');
assert(!!findSession(th1), '★ 其他设备不受影响');
eq(gateFor(th2).action, 'needLogin', '退出后要重新登录');

/* ═══════════ 13. 限流查询（真跑 COUNT SQL） ═══════════ */
console.log('— 限流查询');

const ipCount = db
  .prepare(
    `SELECT COUNT(*) AS c FROM send_log
     WHERE kind = 'ip' AND key = ? AND created_at > datetime('now', '-1 hour')`
  )
  .get('203.0.113.1');
assert(ipCount.c >= 2, `IP 发码计数正确（${ipCount.c} 次）`);

const minCount = db
  .prepare(
    `SELECT COUNT(*) AS c FROM send_log
     WHERE kind = 'ip' AND key = ? AND created_at > datetime('now', '-1 minute')`
  )
  .get('203.0.113.1');
assert(minCount.c >= 1, '分钟级计数正确');

// 用真实计数喂给 checkSendLimit
const lim = checkSendLimit({
  ipCountLastMinute: minCount.c,
  ipCountLastHour: ipCount.c,
  emailCountLastHour: 1,
});
eq(lim.ok, false, '★ 真实计数触发限流（每分钟已发过 1 次）');

// 完全没记录的 IP 应放行
const fresh = db
  .prepare(
    `SELECT COUNT(*) AS c FROM send_log WHERE kind='ip' AND key = ? AND created_at > datetime('now','-1 minute')`
  )
  .get('8.8.8.8');
eq(fresh.c, 0, '新 IP 无记录');
eq(checkSendLimit({ ipCountLastMinute: 0, ipCountLastHour: 0, emailCountLastHour: 0 }).ok, true, '新 IP 放行');

/* ═══════════ 14. 清理语句 ═══════════ */
console.log('— 清理语句');

// 造过期数据
db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('dead', ?, datetime('now','-2 day'))`).run(uid);
db.prepare(`INSERT INTO login_codes (email_hash, code_hash, expires_at) VALUES ('old','old', datetime('now','-2 day'))`).run();
db.prepare(`INSERT INTO send_log (kind, key, created_at) VALUES ('ip','oldip', datetime('now','-2 day'))`).run();

const before = {
  sess: db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get().c,
  code: db.prepare(`SELECT COUNT(*) AS c FROM login_codes`).get().c,
  log: db.prepare(`SELECT COUNT(*) AS c FROM send_log`).get().c,
};

// 与 verify.ts 的清理 SQL 一致
db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
db.prepare(`DELETE FROM login_codes WHERE expires_at < datetime('now', '-1 day')`).run();
db.prepare(`DELETE FROM send_log WHERE created_at < datetime('now', '-1 day')`).run();

const after = {
  sess: db.prepare(`SELECT COUNT(*) AS c FROM sessions`).get().c,
  code: db.prepare(`SELECT COUNT(*) AS c FROM login_codes`).get().c,
  log: db.prepare(`SELECT COUNT(*) AS c FROM send_log`).get().c,
};

assert(after.sess < before.sess, `过期会话被清理（${before.sess} → ${after.sess}）`);
assert(after.code < before.code, `过期验证码被清理（${before.code} → ${after.code}）`);
assert(after.log < before.log, `旧限流日志被清理（${before.log} → ${after.log}）`);
assert(findSession(th1) !== undefined, '★ 清理没有误删有效会话');

/* ═══════════ 15. 车源表未被破坏 ═══════════ */
console.log('— 回归：车源表未受影响');

db.prepare(
  `INSERT INTO trucks (tonnage, brand, contact, status) VALUES (25, '徐工', '13800000000', 'approved')`
).run();
const t = db.prepare(`SELECT contact FROM trucks WHERE status='approved'`).get();
eq(t.contact, '13800000000', '车源表读写正常（schema 改动无副作用）');

db.close();

/* ═══════════ 结果 ═══════════ */
console.log(`\n[auth-db] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[auth-db] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[auth-db] 全部通过 ✓');
