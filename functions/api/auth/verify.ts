// POST /api/auth/verify — 校验验证码，换取会话 Cookie
//
// 流程：
//   1. 按 email_hash 取最新一条未使用的验证码记录
//   2. checkCode 判定（过期 / 已用 / 超尝试次数 / 码不对）
//   3. 通过则：创建用户（首次自动注册）、标记码已用、建会话、种 Cookie
//
// 设计说明：
//   - **首次登录自动注册**：邮箱验证码登录本质上就是「拥有这个邮箱 = 身份」，
//     不需要单独的注册表单。用户少一步操作，转化率更高。
//   - 会话 Cookie 是 HttpOnly，JS 拿不到，前端靠 /api/auth/me 查登录态。
//   - 失败时**累加 attempts**，防止有人拿一个码反复猜（6 位数字共 100 万种，
//     但只有 5 次机会，暴力破解不现实）。
import {
  checkCode,
  sha256,
  randomToken,
  buildSessionCookie,
  SESSION_TTL_SEC,
  emailHash,
  normalizeEmail,
  isLikelyEmail,
} from '../../../src/auth-core.mjs';
import { clientIp, uaBrief, authSalt, json, type SessionEnv } from '../_session';

interface Env extends SessionEnv {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const env = ctx.env;

  let body: { email?: string; code?: string };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ ok: false, msg: '请求格式不正确' }, 400);
  }

  const email = normalizeEmail(body.email || '');
  const code = String(body.code || '').trim();

  if (!isLikelyEmail(email)) {
    return json({ ok: false, msg: '请输入有效的邮箱地址' }, 400);
  }
  // 验证码必须是 6 位纯数字。先挡一道，避免把明显不合格式的请求打到数据库
  if (!/^\d{6}$/.test(code)) {
    return json({ ok: false, msg: '请输入 6 位数字验证码' }, 400);
  }

  const salt = authSalt(env);
  const ehash = await emailHash(email, salt);
  const ip = clientIp(ctx.request);

  try {
    /* ── 取最新一条未使用的码 ── */
    const record = await env.DB.prepare(
      `SELECT id, code_hash, attempts, used, expires_at
       FROM login_codes
       WHERE email_hash = ?
       ORDER BY id DESC
       LIMIT 1`
    )
      .bind(ehash)
      .first<{ id: number; code_hash: string; attempts: number; used: number; expires_at: string }>();

    const inputHash = await sha256(`${code}|${salt}`);
    const verdict = checkCode({ record, inputHash });

    if (!verdict.ok) {
      // 只有「码不对」才累加尝试次数；已过期/已用/超限的不必再累加
      if (!verdict.fatal && record) {
        await env.DB.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?`)
          .bind(record.id)
          .run()
          .catch(() => {});
      }
      return json({ ok: false, msg: verdict.msg, fatal: !!verdict.fatal }, 400);
    }

    /* ── 通过：标记码已用（防重放） ── */
    await env.DB.prepare(`UPDATE login_codes SET used = 1 WHERE id = ?`).bind(record!.id).run();

    /* ── 找用户，没有就自动注册 ──
       首次登录自动注册：邮箱验证码登录的本质就是「拥有这个邮箱 = 身份」，
       不需要单独的注册表单，用户少一步操作。
       （users.email_hash 有 UNIQUE 约束，并发下重复插入会失败，正好当兜底） */
    let user = await env.DB.prepare(`SELECT id, status FROM users WHERE email_hash = ?`)
      .bind(ehash)
      .first<{ id: number; status: string }>();

    if (!user) {
      // 用 INSERT OR IGNORE 而不是裸 INSERT：
      // 并发下两个请求可能同时到这里，OR IGNORE 让第二个静默跳过而不抛异常。
      await env.DB.prepare(
        `INSERT OR IGNORE INTO users (email_hash, status, last_seen)
         VALUES (?, 'active', datetime('now'))`
      )
        .bind(ehash)
        .run();

      // ★ 重新查一次拿 id，而不是从 insert 结果里抠 last_row_id ——
      //   那个字段名在不同运行时（D1 / node:sqlite）不一致，
      //   查回来是唯一可靠的方式，也顺带覆盖了「被并发请求抢先插入」的情况。
      user = await env.DB.prepare(`SELECT id, status FROM users WHERE email_hash = ?`)
        .bind(ehash)
        .first<{ id: number; status: string }>();
    }

    if (!user) return json({ ok: false, msg: '账号创建失败，请重试' }, 500);
    if (user.status !== 'active') {
      return json({ ok: false, msg: '账号已被限制，请联系管理员' }, 403);
    }

    /* ── 建会话（多设备并存：每次登录新增一条，不踢旧设备） ── */
    const token = randomToken(32);
    // ★ 库里只存 token 的哈希。泄露库也拿不到能直接用的 Cookie 值。
    const tokenHash = await sha256(token);

    await env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, ua, ip, expires_at, last_used)
       VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'), datetime('now'))`
    )
      .bind(tokenHash, user.id, uaBrief(ctx.request), ip, SESSION_TTL_SEC)
      .run();

    await env.DB.prepare(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`)
      .bind(user.id)
      .run()
      .catch(() => {});

    /* ── 顺手清理：过期会话与旧验证码（不阻塞主流程） ── */
    env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
      env.DB.prepare(`DELETE FROM login_codes WHERE expires_at < datetime('now', '-1 day')`),
      env.DB.prepare(`DELETE FROM send_log WHERE created_at < datetime('now', '-1 day')`),
    ]).catch(() => {});

    // 生产环境必须带 Secure（HTTPS only）；本地调试用 http 时要关掉，
    // 否则浏览器不会保存这个 Cookie，登录「成功」但下次请求仍无会话。
    const isLocal = /^(127\.0\.0\.1|localhost)/.test(new URL(ctx.request.url).hostname);

    return json(
      { ok: true, msg: '登录成功', userId: user.id, expiresIn: SESSION_TTL_SEC },
      200,
      { 'Set-Cookie': buildSessionCookie(token, { secure: !isLocal }) }
    );
  } catch (e) {
    console.error('[verify] 失败:', e);
    return json({ ok: false, msg: '服务暂时不可用，请稍后重试' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return json({ ok: false, msg: '方法不允许' }, 405, { Allow: 'POST' });
};
