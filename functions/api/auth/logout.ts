// POST /api/auth/logout — 退出登录（仅注销当前设备）
//
// 多设备并存策略下，这里只删当前这条会话，其他设备不受影响。
// 若以后要做「退出所有设备」，另开一个接口删 user_id 下全部记录。
import { sha256, clearSessionCookie, readCookie, COOKIE_NAME } from '../../../src/auth-core.mjs';
import { json, type SessionEnv } from '../_session';

interface Env extends SessionEnv {
  DB: D1Database;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const raw = readCookie(ctx.request.headers.get('Cookie'), COOKIE_NAME);

  if (raw) {
    try {
      const tokenHash = await sha256(raw);
      await ctx.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
    } catch (e) {
      // 删失败也照样清 Cookie —— 用户点了退出就该退出，不能因为服务端出错卡住
      console.error('[logout] 删除会话失败:', e);
    }
  }

  const isLocal = /^(127\.0\.0\.1|localhost)/.test(new URL(ctx.request.url).hostname);

  return json({ ok: true, msg: '已退出登录' }, 200, {
    'Set-Cookie': clearSessionCookie({ secure: !isLocal }),
  });
};

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return json({ ok: false, msg: '方法不允许' }, 405, { Allow: 'POST' });
};
