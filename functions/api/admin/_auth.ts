// 后台鉴权：令牌登录（不依赖 Cloudflare Access）
//
// 背景：Cloudflare Pages 自定义域名 + Access 多域名应用存在冲突，
// `/cdn-cgi/access/authorized` 在自定义域名上会 404，导致认证回调失败。
// 改用应用层令牌：前端登录一次存 localStorage，之后所有 admin 请求带 X-Admin-Token 头。
//
// 环境变量：
//   ADMIN_TOKEN  必填。后台登录口令，建议 32 位以上随机串。
//                未配置时后台接口一律拒绝（fail closed），避免忘配导致裸奔。

export interface AdminEnv {
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

export interface AdminResult {
  ok: boolean;
  reason?: string;
}

/** 恒定时间字符串比较，避免按字符逐位比较泄露长度/内容 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 校验请求携带的后台令牌 */
export function verifyAdmin(request: Request, env: AdminEnv): AdminResult {
  const expected = (env.ADMIN_TOKEN || '').trim();

  // 未配置令牌时一律拒绝：宁可后台进不去，也不能裸奔
  if (!expected) {
    return { ok: false, reason: '后台未配置访问令牌，请先设置 ADMIN_TOKEN' };
  }

  // 优先读自定义头；兼容 Authorization: Bearer <token>
  let got = (request.headers.get('X-Admin-Token') || '').trim();
  if (!got) {
    const auth = request.headers.get('Authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) got = m[1].trim();
  }

  if (!got) {
    return { ok: false, reason: '缺少访问令牌' };
  }

  if (!safeEqual(got, expected)) {
    return { ok: false, reason: '访问令牌不正确' };
  }

  return { ok: true };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 后台接口一律不缓存
      'Cache-Control': 'no-store',
    },
  });
}
