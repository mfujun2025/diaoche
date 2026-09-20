// POST /api/submit — 发布车源（进审核队列）
interface Env { DB: D1Database }

const BRANDS = ['徐工', '三一', '中联', '柳工', '其他'];
const BIZ_TYPES = ['sale', 'rent', 'buy'];

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    let b: any;
    try {
      b = await ctx.request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, msg: '请求体不是合法 JSON' }), { status: 400, headers });
    }

    // —— 校验 ——
    const tonnage = Number(b.tonnage);
    const brand = String(b.brand || '').trim();
    const contact = String(b.contact || '').trim();
    const bizType = BIZ_TYPES.includes(b.biz_type) ? b.biz_type : 'sale';

    if (!Number.isFinite(tonnage) || tonnage <= 0 || tonnage > 2000) {
      return new Response(JSON.stringify({ ok: false, msg: '吨位需为 1~2000 的数字' }), { status: 400, headers });
    }
    if (!brand || brand.length > 32) {
      return new Response(JSON.stringify({ ok: false, msg: '品牌必填且不超过 32 字' }), { status: 400, headers });
    }
    if (!contact || contact.length > 64) {
      return new Response(JSON.stringify({ ok: false, msg: '联系方式必填且不超过 64 字' }), { status: 400, headers });
    }

    // —— 可选字段清洗 ——
    const num = (v: any, min: number, max: number) => {
      if (v === undefined || v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.min(Math.max(n, min), max);
    };
    const str = (v: any, max: number) => {
      if (v === undefined || v === null) return null;
      const s = String(v).trim();
      return s ? s.slice(0, max) : null;
    };

    const year = num(b.year, 1980, 2100);
    const hours = num(b.hours, 0, 500000);
    const price = num(b.price, 0, 100000000);

    await ctx.env.DB.prepare(
      `INSERT INTO trucks
        (biz_type, tonnage, brand, model, year, hours, province, city, price, price_unit, condition, has_accident, contact, images)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        bizType,
        Math.round(tonnage),
        brand,
        str(b.model, 64),
        year === null ? null : Math.round(year),
        hours === null ? null : Math.round(hours),
        str(b.province, 32),
        str(b.city, 32),
        price,
        str(b.price_unit, 8) || '万元',
        str(b.condition, 500),
        b.has_accident ? 1 : 0,
        contact,
        JSON.stringify(Array.isArray(b.images) ? b.images.slice(0, 9) : [])
      )
      .run();

    return new Response(JSON.stringify({ ok: true, msg: '提交成功，审核通过后展示' }), { status: 200, headers });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, msg: '服务器错误，请稍后重试' }), { status: 500, headers });
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
