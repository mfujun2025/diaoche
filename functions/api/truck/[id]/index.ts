// GET /api/truck/:id — 单个车源详情（仅 approved）
//
// 设计说明：
//   列表接口 /api/trucks 不返回 contact（联系方式），避免被爬虫批量抓走。
//   详情页只拿非敏感字段，联系方式单独走 /api/truck/:id/contact。
//
// 路由：functions/api/truck/[id]/index.ts  →  /api/truck/<id>
//       functions/api/truck/[id]/contact.ts →  /api/truck/<id>/contact

interface Env { DB: D1Database }

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const p = ctx.params as { id?: string | string[] };
  const raw = Array.isArray(p.id) ? p.id[0] : p.id;
  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0) {
    return new Response(JSON.stringify({ ok: false, msg: '参数不合法' }), { status: 400, headers: JSON_HEADERS });
  }

  try {
    // 只查 approved：待审/已驳回的车源不该被前台看到
    const row: any = await ctx.env.DB
      .prepare(
        `SELECT id, biz_type, tonnage, brand, model, year, hours, province, city,
                price, price_unit, condition, has_accident, images, created_at
           FROM trucks
          WHERE id = ? AND status = 'approved'`
      )
      .bind(id)
      .first();

    if (!row) {
      return new Response(JSON.stringify({ ok: false, msg: '车源不存在或未通过审核' }), { status: 404, headers: JSON_HEADERS });
    }

    // images 在库里是 JSON 字符串，统一解析成数组给前端
    let imgs: string[] = [];
    try {
      const parsed = JSON.parse(row.images || '[]');
      if (Array.isArray(parsed)) imgs = parsed.filter((k: unknown) => typeof k === 'string' && k);
    } catch {}

    return new Response(JSON.stringify({ ok: true, data: { ...row, images: imgs } }), {
      status: 200,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, msg: '查询失败' }), { status: 500, headers: JSON_HEADERS });
  }
};
