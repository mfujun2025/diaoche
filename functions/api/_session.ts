// 登录会话校验 —— 被多个接口共用
//
// 命名以 `_` 开头：Pages Functions 里下划线开头的文件**不会**被当成路由，
// 所以放在这里不会暴露成 /api/_session 之类的端点。

import {
  COOKIE_NAME,
  readCookie,
  sha256,
  decideGate,
  emailHash,
  type GateDecision,
} from '../../src/auth-core.mjs';

export interface SessionEnv {
  DB: D1Database;
  /** 邮箱哈希用的全局盐。未配置时用固定串兜底（不理想但好过裸奔） */
  DC_AUTH_SALT?: string;
}

/** 取盐。生产环境应配 DC_AUTH_SALT，改了会让所有已注册用户对不上号。 */
export function authSalt(env: SessionEnv): string {
  return (env.DC_AUTH_SALT || 'diaoche-cn-default-salt').trim();
}

export { COOKIE_NAME, emailHash, sha256 };

/** 客户端 IP（CF 会带 CF-Connecting-IP，拿不到就用 XFF 第一段） */
export function clientIp(request: Request): string {
  const cf = request.headers.get('CF-Connecting-IP');
  if (cf) return cf.trim();
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return '0.0.0.0';
}

/** UA 摘要：只存前 120 字符，用于「登录设备管理」，不存全量 */
export function uaBrief(request: Request): string {
  return (request.headers.get('User-Agent') || '').slice(0, 120);
}

/**
 * 校验当前请求的登录态。
 *
 * 返回的 decision 与 auth-core 的 decideGate 一致，便于前端处理也便于单测。
 */
export async function verifySession(request: Request, env: SessionEnv): Promise<GateDecision & { userId?: number }> {
  const raw = readCookie(request.headers.get('Cookie'), COOKIE_NAME);
  if (!raw) return { action: 'needLogin', msg: '请先登录后再查看联系方式' };

  // ★ 库里存的是 token 的哈希，不是 token 本身。
  //   这样即便库被拖走，攻击者也拿不到能直接用的会话凭证。
  const tokenHash = await sha256(raw);

  try {
    const session = await env.DB.prepare(
      `SELECT user_id, expires_at FROM sessions WHERE token_hash = ?`
    )
      .bind(tokenHash)
      .first<{ user_id: number; expires_at: string }>();

    if (!session) return { action: 'needLogin', msg: '登录已失效，请重新登录' };

    const user = await env.DB.prepare(`SELECT id, status FROM users WHERE id = ?`)
      .bind(session.user_id)
      .first<{ id: number; status: string }>();

    const decision = decideGate(session, user);

    // 顺手更新 last_used（失败不影响主流程）
    if (decision.action === 'allow') {
      env.DB.prepare(`UPDATE sessions SET last_used = datetime('now') WHERE token_hash = ?`)
        .bind(tokenHash)
        .run()
        .catch(() => {});
    }

    return decision;
  } catch (e) {
    console.error('[auth] 会话查询失败:', e);
    // ★ 出错时 fail closed —— 宁可让用户重登，也不能误放行
    return { action: 'needLogin', msg: '登录状态校验失败，请重试' };
  }
}

/** 统一的 JSON 响应（一律不缓存） */
export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
