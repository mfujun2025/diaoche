// GET /trucks-sitemap.xml — 车源详情页 + 长尾筛选页的动态 sitemap
//
// 为什么用动态：
//   本站是纯静态构建（GitHub Actions 里跑 build.mjs），**构建阶段拿不到 D1 数据**
//   （CI 里没有数据库凭据，也不该依赖），所以没法在构建时枚举车源 id 生成静态 sitemap。
//   而车源是随时增删的 —— 每上一条新车源就重新构建一次不现实。
//
//   这里实时查库，输出两类 URL：
//     ① 每条「已审核」车源的详情页 /trucks/<id>/
//     ② 有车源的筛选组合页 /trucks/25吨/ 、 /trucks/25吨/江苏/ ...
//
// ⚠️ 组合页只收录「查出来有车」的。空页会在 Function 里返回 404，
//    若把 404 塞进 sitemap，等于主动向搜索引擎报错，会拖累整站质量评分。
//
// ⚠️ _routes.json 的 include 里必须含 "/trucks-sitemap.xml"，
//    否则请求会落到静态资源查找 → 找不到 → 被 SPA 式回落吃掉（返回首页 HTML）。

interface Env { DB: D1Database }

const SITE_URL = 'https://xn--bqr649k.cn';

const xmlEsc = (s: unknown = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// 统一在 onRequest 里处理，GET 与 HEAD 共用一份逻辑。
// 只导出 onRequestGet 的话，HEAD 请求会漏到静态资源层，
// 拿到错误的 Content-Type（text/html）—— 部分爬虫会因此判定不是 XML。
export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  let rows: Array<{ id: number; created_at: string }> = [];
  let combos: Array<{ t: number | null; p: string | null; n: number; last: string }> = [];
  try {
    const res = await ctx.env.DB
      .prepare(`SELECT id, created_at FROM trucks WHERE status = 'approved' ORDER BY id DESC LIMIT 5000`)
      .all();
    rows = (res.results || []) as Array<{ id: number; created_at: string }>;

    // 按「吨位 / 地区 / 吨位+地区」三种粒度聚合，带出每组的最新时间与条数。
    // 用 UNION ALL 一次查完，避免在 Worker 里循环发多次查询（每次查询都是一次 D1 往返）。
    const agg = await ctx.env.DB
      .prepare(
        `SELECT tonnage AS t, NULL AS p, COUNT(*) AS n, MAX(created_at) AS last
           FROM trucks WHERE status = 'approved' GROUP BY tonnage
         UNION ALL
         SELECT NULL AS t, province AS p, COUNT(*) AS n, MAX(created_at) AS last
           FROM trucks WHERE status = 'approved' AND province IS NOT NULL AND province <> '' GROUP BY province
         UNION ALL
         SELECT tonnage AS t, province AS p, COUNT(*) AS n, MAX(created_at) AS last
           FROM trucks WHERE status = 'approved' AND province IS NOT NULL AND province <> ''
          GROUP BY tonnage, province`
      )
      .all();
    combos = (agg.results || []) as any[];
  } catch {
    rows = [];
    combos = [];
  }

  const urls: string[] = [];

  // ① 详情页
  for (const r of rows) {
    const date = String(r.created_at || '').slice(0, 10);
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `\n    <lastmod>${date}</lastmod>` : '';
    urls.push(`  <url>
    <loc>${xmlEsc(`${SITE_URL}/trucks/${r.id}/`)}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }

  // ② 筛选组合页（只收有车的）
  for (const c of combos) {
    if (!c || !c.n) continue;
    const segs = [c.t ? `${c.t}吨` : '', c.p || ''].filter(Boolean);
    if (!segs.length) continue;
    const date = String(c.last || '').slice(0, 10);
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `\n    <lastmod>${date}</lastmod>` : '';
    // 组合页权重低于单品页：它是聚合入口，不是成交页
    const priority = segs.length === 2 ? '0.6' : '0.7';
    urls.push(`  <url>
    <loc>${xmlEsc(`${SITE_URL}/trucks/${segs.join('/')}/`)}</loc>${lastmod}
    <changefreq>daily</changefreq>
    <priority>${priority}</priority>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;

  return new Response(ctx.request.method === 'HEAD' ? null : xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // 缓存 10 分钟：新上架车源最多 10 分钟后进 sitemap，兼顾新鲜度与回源压力
      'Cache-Control': 'public, max-age=600',
    },
  });
};
