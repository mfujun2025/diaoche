// POST /api/auth/send-code — 发送登录验证码
//
// 安全考量（按重要性排序）：
//   1. **邮箱枚举防护**：不管邮箱是否已注册，一律返回同样的成功响应。
//      否则攻击者能拿接口当「查这个邮箱有没有在你这注册过」的探测器。
//   2. **三重限流**：IP 每分钟 / IP 每小时 / 邮箱每小时。
//      不做限流的话，有人写个脚本就能把邮件额度刷爆、或恶意骚扰他人邮箱。
//   3. **验证码只存哈希**：库泄露也拿不到码。
//   4. 旧码作废：同一邮箱发新码时把旧的标记 used，避免多码并存被猜。
//
// 路由：functions/api/auth/send-code.ts → /api/auth/send-code
import {
  CODE_TTL_SEC,
  normalizeEmail,
  isLikelyEmail,
  emailHash,
  sha256,
  randomCode,
  checkSendLimit,
  buildCodeMail,
} from '../../../src/auth-core.mjs';
import { sendMail, type MailEnv } from '../_mail';
import { clientIp, authSalt, json, type SessionEnv } from '../_session';

interface Env extends SessionEnv, MailEnv {
  DB: D1Database;
}

const SITE_NAME = '吊车.cn';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const env = ctx.env;
  const ip = clientIp(ctx.request);

  /* ── 解析请求体 ── */
  let body: { email?: string };
  try {
    body = await ctx.request.json();
  } catch {
    return json({ ok: false, msg: '请求格式不正确' }, 400);
  }

  const email = normalizeEmail(body.email || '');
  if (!isLikelyEmail(email)) {
    return json({ ok: false, msg: '请输入有效的邮箱地址' }, 400);
  }

  const salt = authSalt(env);
  const ehash = await emailHash(email, salt);

  try {
    /* ── 限流检查（三条 SQL 一次拿完，别来回跑） ── */
    const [minRow, hourIpRow, hourEmailRow] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM send_log
         WHERE kind = 'ip' AND key = ? AND created_at > datetime('now', '-1 minute')`
      )
        .bind(ip)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM send_log
         WHERE kind = 'ip' AND key = ? AND created_at > datetime('now', '-1 hour')`
      )
        .bind(ip)
        .first<{ c: number }>(),
      env.DB.prepare(
        `SELECT COUNT(*) AS c FROM send_log
         WHERE kind = 'email' AND key = ? AND created_at > datetime('now', '-1 hour')`
      )
        .bind(ehash)
        .first<{ c: number }>(),
    ]);

    const limit = checkSendLimit({
      ipCountLastMinute: minRow?.c || 0,
      ipCountLastHour: hourIpRow?.c || 0,
      emailCountLastHour: hourEmailRow?.c || 0,
    });

    if (!limit.ok) {
      // 限流是唯一会暴露「这个 IP/邮箱被限了」的情况，但那不泄露账号是否存在
      return json({ ok: false, msg: limit.msg }, 429);
    }

    /* ── 生成验证码并存哈希 ── */
    const code = randomCode();
    const codeHash = await sha256(`${code}|${salt}`);

    // 旧码作废：同一邮箱的多条未用码并存会扩大被猜中的面
    await env.DB.prepare(
      `UPDATE login_codes SET used = 1 WHERE email_hash = ? AND used = 0`
    )
      .bind(ehash)
      .run();

    await env.DB.prepare(
      `INSERT INTO login_codes (email_hash, code_hash, ip, attempts, used, expires_at)
       VALUES (?, ?, ?, 0, 0, datetime('now', '+' || ? || ' seconds'))`
    )
      .bind(ehash, codeHash, ip, CODE_TTL_SEC)
      .run();

    /* ── 记限流日志 ── */
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO send_log (kind, key) VALUES ('ip', ?)`).bind(ip),
      env.DB.prepare(`INSERT INTO send_log (kind, key) VALUES ('email', ?)`).bind(ehash),
    ]);

    /* ── 发邮件 ── */
    const mail = buildCodeMail(code, Math.floor(CODE_TTL_SEC / 60), ip, SITE_NAME);
    const sent = await sendMail(env, email, mail.subject, mail.text, mail.html);

    if (!sent.ok) {
      // 发送失败就把这条码作废，免得用户拿着一个永远收不到的码等
      await env.DB.prepare(`UPDATE login_codes SET used = 1 WHERE email_hash = ? AND used = 0`)
        .bind(ehash)
        .run()
        .catch(() => {});
      return json({ ok: false, msg: sent.error || '验证码发送失败，请稍后重试' }, 502);
    }

    /* ──★ 开发模式：把验证码一并返回，方便调试 ──
       ⚠️ 只有显式设置 DC_MAIL_DEV_MODE === '1' 才返回。
          生产环境绝不可开 —— 那等于把验证码送给任何人。 */
    const devMode = (env.DC_MAIL_DEV_MODE || '').trim() === '1' && sent.dev;

    return json({
      ok: true,
      msg: '验证码已发送，请查收邮件（含垃圾箱）',
      ttlSec: CODE_TTL_SEC,
      ...(devMode ? { devCode: code, dev: true } : {}),
    });
  } catch (e) {
    console.error('[send-code] 失败:', e);
    return json({ ok: false, msg: '服务暂时不可用，请稍后重试' }, 500);
  }
};

// 只允许 POST；其他方法明确拒绝，避免被当 GET 缓存
export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return json({ ok: false, msg: '方法不允许' }, 405, { Allow: 'POST' });
};
