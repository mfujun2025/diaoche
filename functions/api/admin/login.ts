// POST /api/admin/login — 校验后台访问密钥是否正确
// 前端登录时调一次，成功则把密钥存 localStorage；后续请求直接带 X-Admin-Key。
import { verifyAdmin, json, type AdminEnv } from './_auth';

export const onRequestPost: PagesFunction<AdminEnv> = async (ctx) => {
  const auth = verifyAdmin(ctx.request, ctx.env);
  if (!auth.ok) {
    // 针对登录场景，把「未配置」和「密钥错误」区分开，方便排错
    return json({ ok: false, msg: auth.reason }, 401);
  }
  return json({ ok: true });
};
