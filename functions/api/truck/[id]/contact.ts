// GET /api/truck/:id/contact — 查看车源联系方式
//
// 登录门禁：**已接入真实登录**（邮箱验证码，见 /api/auth/*）
// ------------------------------------------------------------------
// 契约保持不变：未登录返回 401 + { ok:false, needLogin:true, msg }，
// 前端据此弹登录框。所以这次接真实登录，前端只需把占位框换成真实表单。
//
// 会话校验逻辑集中在 functions/api/_session.ts 的 verifySession()，
// 本文件只负责「调它 → 决定放行还是 401」。

import { verifySession, json, type SessionEnv } from '../../_session';

interface Env extends SessionEnv {
  DB: D1Database;
}

/** 简单的来源校验：只接受本站自有域名发起的请求（挡掉最粗糙的直连爬取） */
function sameOrigin(request: Request): boolean {
  const ref = request.headers.get('Referer') || '';
  if (!ref) return false; // 无 Referer 一律拒绝（浏览器同源 fetch 一定会带）
  try {
    // 去掉端口，统一小写
    const host = new URL(ref).host.split(':')[0].toLowerCase();

    // 本地开发（wrangler pages dev）
    if (host === '127.0.0.1' || host === 'localhost') return true;

    // 本站自有域名：用后缀匹配，这样 www / m / 任意子域都自动覆盖，
    // 不会再出现「加了 www 域名但白名单漏配」这类问题。
    const OWNED = ['xn--bqr649k.cn', 'diaoche-cn.pages.dev'];
    return OWNED.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const p = ctx.params as { id?: string | string[] };
  const raw = Array.isArray(p.id) ? p.id[0] : p.id;
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, msg: '参数不合法' }, 400);
  }

  // 来源校验：不在白名单直接 403
  if (!sameOrigin(ctx.request)) {
    return json({ ok: false, msg: '请求来源不合法' }, 403);
  }

  // 登录门禁（真实校验）
  const decision = await verifySession(ctx.request, ctx.env);
  if (decision.action === 'needLogin') {
    // 前端据 needLogin 弹登录框
    return json({ ok: false, needLogin: true, msg: decision.msg }, 401);
  }

  try {
    const row: any = await ctx.env.DB
      .prepare(`SELECT contact FROM trucks WHERE id = ? AND status = 'approved'`)
      .bind(id)
      .first();

    if (!row) {
      return json({ ok: false, msg: '车源不存在' }, 404);
    }

    // 联系方式绝不缓存
    return json({ ok: true, data: { contact: row.contact || '' } }, 200);
  } catch (e) {
    console.error('[contact] 查询失败:', e);
    return json({ ok: false, msg: '查询失败' }, 500);
  }
};
