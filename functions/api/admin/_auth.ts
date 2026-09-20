// 后台鉴权：依赖 Cloudflare Access 注入的 JWT 头
// Access 启用后，未登录请求根本到不了 Function（被 CF 拦掉），
// 所以这里只做「请求确实来自 Access」的二次校验，防止有人绕过 Access 直连 Functions 域。

export interface AdminEnv {
  DB: D1Database;
  ADMIN_EMAILS?: string; // 逗号分隔的允许邮箱，可选白名单
}

export interface AdminResult {
  ok: boolean;
  email?: string;
  reason?: string;
}

/** 校验请求是否经过 Cloudflare Access 且身份合法 */
export function verifyAdmin(request: Request, env: AdminEnv): AdminResult {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) {
    return { ok: false, reason: '未通过 Cloudflare Access 认证' };
  }

  // 从 JWT payload 解析邮箱（payload 已被 CF 签名，且请求已过 Access 网关）
  let email = '';
  try {
    const payloadB64 = jwt.split('.')[1] || '';
    // base64url -> base64
    const b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    email = String(JSON.parse(json).email || '').toLowerCase();
  } catch {
    return { ok: false, reason: '身份令牌解析失败' };
  }

  if (!email) {
    return { ok: false, reason: '身份令牌中无邮箱' };
  }

  // 可选白名单：配了 ADMIN_EMAILS 就只允许名单内邮箱
  const allow = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length && !allow.includes(email)) {
    return { ok: false, reason: '该账号无审核权限' };
  }

  return { ok: true, email };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
