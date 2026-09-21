// 邮箱验证码登录 —— 核心逻辑层（纯 JS，无 TS 标注）
//
// ⚠️ 为什么把逻辑抽到这个文件而不是写在 Function 里：
//    本机 `wrangler pages dev` 的 Functions 路由不可信（见技能 §9.5.1），
//    把纯逻辑摘出来就能用 Node 直接跑单测，秒级反馈、不依赖任何服务。
//    Function 文件只做「解析请求 → 调这里 → 拼响应」。
//
// 设计要点：
//   - 全程不存明文：邮箱、验证码、会话 token 一律 SHA-256 加盐后入库
//   - 验证码 6 位数字，10 分钟过期，尝试 5 次作废
//   - 会话 30 天，多设备并存（每设备一条 sessions 记录）

/* ────────────────────────── 常量 ────────────────────────── */

export const CODE_TTL_SEC = 10 * 60; // 验证码有效期 10 分钟
export const CODE_MAX_ATTEMPTS = 5; // 超过则作废，防暴力猜 6 位数字
export const SESSION_TTL_SEC = 30 * 24 * 3600; // 会话 30 天

/** 单个 IP 每小时最多发几次码（防有人写脚本刷爆邮件额度） */
export const SEND_LIMIT_PER_IP_PER_HOUR = 5;
/** 单个邮箱每小时最多发几次码（防有人被恶意骚扰） */
export const SEND_LIMIT_PER_EMAIL_PER_HOUR = 3;
/** 同一 IP 每分钟最多发几次（挡连点与脚本） */
export const SEND_LIMIT_PER_IP_PER_MINUTE = 1;

export const COOKIE_NAME = 'dc_session';

/* ────────────────────────── 哈希工具 ────────────────────────── */

/** 十六进制编码（Workers 与 Node 都有 TextEncoder，不用 Buffer） */
function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** SHA-256，返回 hex。Workers 与 Node 都原生支持 crypto.subtle */
export async function sha256(input) {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

/** 邮箱哈希：规范化后加盐，避免彩虹表直接反查常见邮箱 */
export async function emailHash(email, salt) {
  return sha256(`${normalizeEmail(email)}|${salt}`);
}

/**
 * 邮箱规范化。
 * ⚠️ 只做 trim + 小写，**不要**去掉 gmail 的 "." 或 "+" 后缀 ——
 * 那是 gmail 独有的规则，套用到别的域名会误判成同一个邮箱。
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** 邮箱格式粗校验：够用即可，别写复杂正则反而误杀合法地址 */
export function isLikelyEmail(email) {
  const e = normalizeEmail(email);
  if (e.length < 6 || e.length > 254) return false;
  if (e.includes('..')) return false;
  // 只允许一个 @，且两侧都非空，域名部分至少有一个点
  const parts = e.split('@');
  if (parts.length !== 2) return false;
  const local = parts[0];
  const domain = parts[1];
  if (!local || !domain) return false;
  if (!/^[a-z0-9._%+-]+$/.test(local)) return false;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
  return true;
}

/* ────────────────────────── 随机数与验证码 ────────────────────────── */

/** 生成随机 token（会话用）。base64url，足够抗爆破 */
export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 生成 6 位数字验证码。
 *
 * ⚠️ 不能用 `Math.floor(Math.random() * 1000000)` ——
 *    Math.random 是**非密码学安全**的伪随机，可被预测。
 *    这里用 getRandomValues 做「拒绝采样」，避免取模带来的分布偏斜。
 */
export function randomCode() {
  const buf = new Uint32Array(1);
  // 拒绝采样：2^32 = 4294967296，取能被 1000000 整除的最大区间，
  // 落在区间外的重摇，保证 0~999999 每个数概率严格相等
  const MAX = 4294967296 - (4294967296 % 1000000);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = buf[0];
  } while (v >= MAX);
  return String(v % 1000000).padStart(6, '0');
}

/* ────────────────────────── 会话 Cookie ────────────────────────── */

/** 拼 Set-Cookie 字符串 */
export function buildSessionCookie(token, attrs = {}) {
  const maxAge = attrs.maxAge === undefined ? SESSION_TTL_SEC : attrs.maxAge;
  const secure = attrs.secure === undefined ? true : attrs.secure;
  const p = attrs.path || '/';
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Path=${p}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    // SameSite=Lax：既能挡住跨站 POST 的 CSRF，又不影响「从搜索引擎点进来」这种导航
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** 清除会话的 Cookie（值置空 + Max-Age=0） */
export function clearSessionCookie(attrs = {}) {
  return buildSessionCookie('', { ...attrs, maxAge: 0 });
}

/** 从 Cookie 头里取指定名字的值 */
export function readCookie(cookieHeader, name = COOKIE_NAME) {
  if (!cookieHeader) return null;
  for (const seg of cookieHeader.split(';')) {
    const i = seg.indexOf('=');
    if (i < 0) continue;
    if (seg.slice(0, i).trim() !== name) continue;
    return seg.slice(i + 1).trim();
  }
  return null;
}

/* ────────────────────────── 时间工具 ────────────────────────── */

/** 当前 ISO 时间（秒精度，与 SQLite datetime('now') 同格式，方便比较） */
export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace('T', ' ').slice(0, 19);
}

/** 未来 n 秒的 ISO 时间 */
export function futureIso(sec) {
  return new Date(Date.now() + sec * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', ' ')
    .slice(0, 19);
}

/** 是否已过期（比较 ISO 字符串。格式统一，字典序 == 时间序） */
export function isExpired(iso) {
  if (!iso) return true;
  return iso <= nowIso();
}

/* ────────────────────────── 登录门禁判定（纯函数，便于单测） ────────────────────────── */

/**
 * 根据会话与用户查询结果决定放行还是要求登录。
 *
 * 抽成纯函数的好处：不用起服务就能把所有分支（无会话/不存在/过期/被禁）测一遍。
 */
export function decideGate(session, user) {
  if (!session) return { action: 'needLogin', msg: '请先登录后再查看联系方式' };
  if (isExpired(session.expires_at)) return { action: 'needLogin', msg: '登录已过期，请重新登录' };
  if (!user) return { action: 'needLogin', msg: '账号不存在，请重新登录' };
  if (user.status !== 'active') return { action: 'needLogin', msg: '账号已被限制，请联系管理员' };
  return { action: 'allow', userId: user.id };
}

/* ────────────────────────── 限流判定（纯函数） ────────────────────────── */

/**
 * 发码前的限流判定。
 * 顺序有讲究：先挡最短窗口（每分钟），命中率最高、对正常用户打扰最小。
 */
export function checkSendLimit(n) {
  if (n.ipCountLastMinute >= SEND_LIMIT_PER_IP_PER_MINUTE) {
    return { ok: false, msg: '操作过于频繁，请 1 分钟后再试' };
  }
  if (n.ipCountLastHour >= SEND_LIMIT_PER_IP_PER_HOUR) {
    return { ok: false, msg: '当前网络发送次数过多，请稍后再试' };
  }
  if (n.emailCountLastHour >= SEND_LIMIT_PER_EMAIL_PER_HOUR) {
    return { ok: false, msg: '该邮箱发送次数过多，请稍后再试' };
  }
  return { ok: true };
}

/**
 * 验证码校验判定（纯函数）。
 * 返回值区分「码不对」与「码已作废」，前端提示更准。
 */
export function checkCode(params) {
  const record = params.record;
  const inputHash = params.inputHash;
  if (!record) return { ok: false, msg: '验证码已失效，请重新获取', fatal: true };
  if (record.used) return { ok: false, msg: '验证码已使用，请重新获取', fatal: true };
  if (isExpired(record.expires_at)) return { ok: false, msg: '验证码已过期，请重新获取', fatal: true };
  if (record.attempts >= CODE_MAX_ATTEMPTS) {
    return { ok: false, msg: '尝试次数过多，请重新获取验证码', fatal: true };
  }
  if (record.code_hash !== inputHash) {
    return { ok: false, msg: '验证码不正确' };
  }
  return { ok: true };
}

/** 恒定时间字符串比较，避免逐位比较泄露信息 */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ────────────────────────── 邮件正文 ────────────────────────── */

/** 把 IP 打码，别把完整 IP 写进邮件正文（用户可能转发） */
export function maskIp(ip) {
  if (!ip) return '未知';
  if (ip.includes(':')) {
    // IPv6 只留前两段
    return ip.split(':').slice(0, 2).join(':') + ':***';
  }
  const p = ip.split('.');
  if (p.length !== 4) return '***';
  return `${p[0]}.${p[1]}.*.*`;
}

/** 生成验证码邮件。文案保持克制 —— 不用「立即点击」这类容易被判营销的词。 */
export function buildCodeMail(code, ttlMin, ip, siteName) {
  const subject = `【${siteName}】登录验证码：${code}`;
  const text = [
    `您的登录验证码是：${code}`,
    '',
    `验证码 ${ttlMin} 分钟内有效。`,
    '如果这不是您本人的操作，请忽略本邮件，您的账号不会被登录。',
    '',
    `请求来源：${maskIp(ip)}`,
    '',
    `—— ${siteName}（本邮件由系统自动发送，请勿直接回复）`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6f7;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #eceef0">
    <div style="height:4px;background:#c8341f"></div>
    <div style="padding:28px 30px 8px">
      <div style="font-size:19px;font-weight:700;color:#1a1a1a">${escapeHtml(siteName)}</div>
      <div style="font-size:13px;color:#8a8f99;margin-top:4px">二手吊车转让信息平台</div>
      <div style="height:1px;background:#eceef0;margin:20px 0"></div>
      <div style="font-size:14px;color:#444">您的登录验证码是：</div>
      <div style="font-size:34px;font-weight:700;color:#c8341f;letter-spacing:6px;margin:14px 0 18px">${escapeHtml(code)}</div>
      <div style="font-size:13px;color:#666;line-height:1.8">
        验证码 <b>${ttlMin} 分钟</b>内有效。<br>
        如果这不是您本人的操作，请忽略本邮件，您的账号不会被登录。
      </div>
      <div style="font-size:12px;color:#a0a4ab;margin-top:18px">请求来源：${escapeHtml(maskIp(ip))}</div>
    </div>
    <div style="padding:18px 30px;background:#fafbfc;font-size:12px;color:#a0a4ab;border-top:1px solid #eceef0">
      本邮件由系统自动发送，请勿直接回复。<br>
      本站仅提供信息发布与展示服务，不参与实际交易。
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
