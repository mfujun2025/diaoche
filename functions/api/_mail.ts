// 邮件发送通道 —— 抽象层，便于后期换服务商
//
// ⚠️ 为什么不用 SMTP：
//    Cloudflare Workers / Pages Functions **没有 TCP socket 能力**，
//    连不上 SMTP 的 25/465/587 端口。只能走服务商的 HTTP API。
//
// 当前实现：Resend（https://resend.com）
//   免费额度 3000 封/月、100 封/天，对小站足够；API 极简，一个 POST。
//
// 环境变量：
//   DC_RESEND_KEY     Resend API Key（re_ 开头）。**未配置时进入开发模式**
//   DC_MAIL_FROM      发件人，形如 "吊车.cn <noreply@xn--bqr649k.cn>"
//                     Resend 要求发件域名先在它后台验证 DNS（SPF/DKIM）
//   DC_MAIL_DEV_TO    开发模式下的收件人覆盖（可选）
//
// 开发模式（未配 DC_RESEND_KEY 时）：
//   不真发邮件，把「收件人 + 验证码」写进服务端日志，同时把验证码
//   放进响应体（仅当 DC_MAIL_DEV_MODE === '1' 时）。
//   ⚠️ 生产环境**绝不能**开 DC_MAIL_DEV_MODE，否则等于把验证码送给任何人。

export interface MailEnv {
  DC_RESEND_KEY?: string;
  DC_MAIL_FROM?: string;
  DC_MAIL_DEV_TO?: string;
  DC_MAIL_DEV_MODE?: string;
}

export interface SendResult {
  ok: boolean;
  /** 开发模式下为真：没真发邮件 */
  dev?: boolean;
  error?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * 发送邮件。
 *
 * 返回 true 只代表「服务商接受了」，不代表用户已收到。
 * 调用方不应据此判断邮箱是否存在 —— 那会变成邮箱枚举漏洞。
 */
export async function sendMail(
  env: MailEnv,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<SendResult> {
  const key = (env.DC_RESEND_KEY || '').trim();
  const from = (env.DC_MAIL_FROM || '').trim();

  // ── 开发模式：没配 key 就不真发，走日志 ──
  if (!key) {
    console.log(`[mail:dev] 未配置 DC_RESEND_KEY，跳过真实发送`);
    console.log(`[mail:dev] to=${to}`);
    console.log(`[mail:dev] subject=${subject}`);
    return { ok: true, dev: true };
  }

  if (!from) {
    return { ok: false, error: '未配置 DC_MAIL_FROM（发件人）' };
  }

  // 开发环境可以把所有邮件转到指定邮箱，避免误发给真实用户
  const realTo = (env.DC_MAIL_DEV_TO || '').trim() || to;

  const payload = {
    from,
    to: [realTo],
    subject,
    text,
    html,
    // 这类邮件不是营销邮件，带上 List-Unsubscribe 反而奇怪，不加。
  };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // 读错误体但**不要**把它返回给前端（可能含配置细节）
      const body = await res.text().catch(() => '');
      console.error(`[mail] Resend 返回 ${res.status}: ${body.slice(0, 300)}`);
      return { ok: false, error: `发送失败（${res.status}）` };
    }

    return { ok: true };
  } catch (e) {
    console.error('[mail] 请求异常:', e);
    return { ok: false, error: '邮件服务暂时不可用' };
  }
}

/** 是否处于开发模式（没配 key） */
export function isMailDevMode(env: MailEnv): boolean {
  return !(env.DC_RESEND_KEY || '').trim();
}
