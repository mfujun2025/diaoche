// POST /api/admin/review — 审核车源
// body: { id: number, action: 'approve' | 'reject' | 'delete' }
import { verifyAdmin, json, type AdminEnv } from './_auth';

const ACTION_STATUS: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
};

export const onRequestPost: PagesFunction<AdminEnv> = async (ctx) => {
  const auth = verifyAdmin(ctx.request, ctx.env);
  if (!auth.ok) return json({ ok: false, msg: auth.reason }, 401);

  try {
    let b: any;
    try {
      b = await ctx.request.json();
    } catch {
      return json({ ok: false, msg: '请求体不是合法 JSON' }, 400);
    }

    const id = Number(b.id);
    const action = String(b.action || '');

    if (!Number.isInteger(id) || id <= 0) {
      return json({ ok: false, msg: 'id 非法' }, 400);
    }

    if (action === 'delete') {
      await ctx.env.DB.prepare(`DELETE FROM trucks WHERE id = ?`).bind(id).run();
      return json({ ok: true, msg: `#${id} 已删除`, by: auth.email });
    }

    const status = ACTION_STATUS[action];
    if (!status) {
      return json({ ok: false, msg: "action 需为 approve / reject / delete" }, 400);
    }

    const r = await ctx.env.DB.prepare(`UPDATE trucks SET status = ? WHERE id = ?`).bind(status, id).run();

    // D1 的 changes 反映实际影响行数，为 0 说明 id 不存在
    const changed = (r.meta as any)?.changes ?? 1;
    if (changed === 0) {
      return json({ ok: false, msg: `未找到 #${id}` }, 404);
    }

    return json({ ok: true, msg: `#${id} 已${action === 'approve' ? '通过' : '驳回'}`, by: auth.email });
  } catch (e: any) {
    return json({ ok: false, msg: '操作失败' }, 500);
  }
};
