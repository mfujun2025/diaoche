// GET /api/auth/me — 查询当前登录态
//
// 前端用它判断「要不要显示已登录」。**只返回登录与否，不返回邮箱** ——
// 邮箱在服务端只有哈希，本来也还原不出来，但接口层面也别给它留口子。
import { verifySession, json, type SessionEnv } from '../_session';

interface Env extends SessionEnv {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const decision = await verifySession(ctx.request, ctx.env);

  if (decision.action === 'needLogin') {
    return json({ ok: true, loggedIn: false });
  }

  return json({ ok: true, loggedIn: true });
};

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method === 'GET' || ctx.request.method === 'HEAD') return onRequestGet(ctx);
  return json({ ok: false, msg: '方法不允许' }, 405, { Allow: 'GET, HEAD' });
};
