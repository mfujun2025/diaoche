// GET /api/truck/:id/contact — 查看车源联系方式
//
// ⚠️ 登录门禁（当前为占位状态）
// ------------------------------------------------------------------
// 产品要求：看联系方式必须登录。真实登录（短信/微信）后期再接。
// 现在把判断集中在这一个函数里，后期接真登录时**只改 requireLogin() 即可**，
// 前端无需重构（前端只认 401 + { needLogin: true }）。
//
// 后期接真登录的做法：
//   1. 引入校验函数（如 verifyUser(request, env) 读 Cookie/Header 里的用户令牌）
//   2. 把下面的 LOGIN_ENABLED 改成 true
//   3. 前端收到 needLogin 时弹真实登录框，登录成功后重新请求本接口
//
// 命名说明：不用 COOKIE/SESSION 等重名字，避免与 CF 保留变量冲突。

interface Env {
  DB: D1Database;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * 登录校验（占位实现）
 *
 * 当前：直接返回「需要登录」，让前端弹登录框占位。
 * 后期：替换为真实校验，通过则返回 { ok: true, uid: '...' }。
 */
function requireLogin(_request: Request, _env: Env): { ok: false; msg: string } | { ok: true; uid?: string } {
  // ⬇️ 后期接真登录：在这里读 Cookie / Header 校验用户身份
  //    校验通过就 return { ok: true, uid }
  return { ok: false, msg: '请先登录后再查看联系方式' };
}

/** 简单的来源校验：只接受同源页面发起的请求（挡掉最粗糙的直连爬取） */
function sameOrigin(request: Request): boolean {
  const ref = request.headers.get('Referer') || '';
  if (!ref) return false; // 无 Referer 一律拒绝（浏览器同源 fetch 一定会带）
  try {
    const host = new URL(ref).host;
    return (
      // 生产域名（punycode + 中文域名两种形态）
      host === 'xn--bqr649k.cn' ||
      host === '吊车.cn' ||
      // Pages 预览域（含带 commit 前缀的子域）
      host === 'diaoche-cn.pages.dev' ||
      host.endsWith('.diaoche-cn.pages.dev') ||
      // 本地开发（wrangler pages dev）
      host.startsWith('127.0.0.1:') ||
      host.startsWith('localhost:')
    );
  } catch {
    return false;
  }
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const p = ctx.params as { id?: string | string[] };
  const raw = Array.isArray(p.id) ? p.id[0] : p.id;
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ ok: false, msg: '参数不合法' }), { status: 400, headers: JSON_HEADERS });
  }

  // 来源校验：不在白名单直接 403
  if (!sameOrigin(ctx.request)) {
    return new Response(JSON.stringify({ ok: false, msg: '请求来源不合法' }), { status: 403, headers: JSON_HEADERS });
  }

  // 登录门禁
  const auth = requireLogin(ctx.request, ctx.env);
  if (!auth.ok) {
    // 前端据 needLogin 弹登录框
    return new Response(JSON.stringify({ ok: false, needLogin: true, msg: auth.msg }), { status: 401, headers: JSON_HEADERS });
  }

  try {
    const row: any = await ctx.env.DB
      .prepare(`SELECT contact FROM trucks WHERE id = ? AND status = 'approved'`)
      .bind(id)
      .first();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, msg: '车源不存在' }), { status: 404, headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ ok: true, data: { contact: row.contact || '' } }), {
      status: 200,
      // 联系方式绝不缓存
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, msg: '查询失败' }), { status: 500, headers: JSON_HEADERS });
  }
};
