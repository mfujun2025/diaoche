// GET /api/trucks — 已审核车源列表（支持筛选）
interface Env { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  try {
    const u = new URL(ctx.request.url);
    const p = u.searchParams;

    const where: string[] = ["status = 'approved'"];
    const args: any[] = [];

    const biz = p.get('biz_type');
    if (biz && ['sale', 'rent', 'buy'].includes(biz)) { where.push('biz_type = ?'); args.push(biz); }

    const tonnage = Number(p.get('tonnage'));
    if (Number.isFinite(tonnage) && tonnage > 0) { where.push('tonnage = ?'); args.push(Math.round(tonnage)); }

    const brand = p.get('brand');
    if (brand) { where.push('brand = ?'); args.push(String(brand).slice(0, 32)); }

    const province = p.get('province');
    if (province) { where.push('province = ?'); args.push(String(province).slice(0, 32)); }

    // 分页（上限 50，防大结果集拖垮）
    const limit = Math.min(Math.max(Number(p.get('limit')) || 20, 1), 50);
    const offset = Math.max(Number(p.get('offset')) || 0, 0);

    const sql = `SELECT id, biz_type, tonnage, brand, model, year, hours, province, city,
                        price, price_unit, condition, has_accident, created_at
                 FROM trucks
                 WHERE ${where.join(' AND ')}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`;

    const { results } = await ctx.env.DB.prepare(sql).bind(...args, limit, offset).all();

    return new Response(JSON.stringify({ ok: true, total: results?.length ?? 0, data: results ?? [] }), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, msg: '查询失败' }), { status: 500, headers });
  }
};
