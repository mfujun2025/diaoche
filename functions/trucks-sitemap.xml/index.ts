// GET /trucks-sitemap.xml — 车源详情页的动态 sitemap
//
// 为什么用动态：
//   本站是纯静态构建（GitHub Actions 里跑 build.mjs），**构建阶段拿不到 D1 数据**
//   （CI 里没有数据库凭据，也不该依赖），所以没法在构建时枚举车源 id 生成静态 sitemap。
//   而车源是随时增删的 —— 每上一条新车源就重新构建一次不现实。
//
//   所以这里实时查库，把当前所有「已审核」车源的详情页列出来。
//   好处：新上架车源立即进入 sitemap，不需要等构建。
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
  try {
    const res = await ctx.env.DB
      .prepare(`SELECT id, created_at FROM trucks WHERE status = 'approved' ORDER BY id DESC LIMIT 5000`)
      .all();
    rows = (res.results || []) as Array<{ id: number; created_at: string }>;
  } catch {
    rows = [];
  }

  const urls = rows
    .map((r) => {
      // created_at 形如 "2026-09-20 13:39:46"，截出日期部分即可
      const date = String(r.created_at || '').slice(0, 10);
      const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `\n    <lastmod>${date}</lastmod>` : '';
      return `  <url>
    <loc>${xmlEsc(`${SITE_URL}/trucks/${r.id}/`)}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
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
