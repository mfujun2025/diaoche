// GET /api/admin/list — 列出车源（供后台审核用）
import { verifyAdmin, json, type AdminEnv } from './_auth';

export const onRequestGet: PagesFunction<AdminEnv> = async (ctx) => {
  const auth = verifyAdmin(ctx.request, ctx.env);
  if (!auth.ok) return json({ ok: false, msg: auth.reason }, 401);

  try {
    const u = new URL(ctx.request.url);
    const status = u.searchParams.get('status') || 'pending';
    const allowed = ['pending', 'approved', 'rejected', 'all'];
    const st = allowed.includes(status) ? status : 'pending';

    const limit = Math.min(Math.max(Number(u.searchParams.get('limit')) || 50, 1), 200);

    const sql =
      st === 'all'
        ? `SELECT * FROM trucks ORDER BY
             CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`
        : `SELECT * FROM trucks WHERE status = ? ORDER BY created_at DESC LIMIT ?`;

    const stmt = st === 'all' ? ctx.env.DB.prepare(sql).bind(limit) : ctx.env.DB.prepare(sql).bind(st, limit);

    const { results } = await stmt.all();

    // 各状态计数，供后台显示角标
    const counts = await ctx.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM trucks GROUP BY status`
    ).all();

    const c: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const r of (counts.results || []) as any[]) {
      if (r.status in c) c[r.status] = r.n;
    }

    return json({ ok: true, email: auth.email, status: st, counts: c, data: results || [] });
  } catch (e: any) {
    return json({ ok: false, msg: '查询失败' }, 500);
  }
};
