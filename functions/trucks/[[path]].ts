// GET /trucks/<id>/ — 车源详情页
//
// 背景：这个站是纯静态构建（GitHub Actions 里生成 HTML），构建时**拿不到 D1 数据**，
// 所以没法在构建阶段枚举车源 id 去预生成每个详情页的静态壳。
//
// 方案：用这个 Function 做「按需渲染」——访问 /trucks/123/ 时实时查出车源，
// 把标题、描述、结构化数据（JSON-LD）直接注入 HTML 返回，正文由前端 app.js 拉接口渲染。
// 好处：
//   1. 不用为每个车源单独构建，新上架车源立即可访问
//   2. SEO 关键信息（title / description / JSON-LD）是服务端直出的，爬虫能看到
//
// ⚠️ 路由注意：_routes.json 的 include 里加了 "/trucks/*" 后，/trucks/ 本身
//    （车源大厅）也会被这个 Function 接管。所以下面必须判断：
//   只有「纯数字 id」才渲染详情页，其余一律回落到静态资源。
//   否则会把车源大厅页面搞坏。

interface Env { DB: D1Database }

const SITE_URL = 'https://xn--bqr649k.cn';

const esc = (s: unknown = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bizLabel(b: string) {
  return b === 'rent' ? '出租' : b === 'buy' ? '求购' : '转让';
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const p = ctx.params as { path?: string | string[] };
  const segs = Array.isArray(p.path) ? p.path : p.path ? [p.path] : [];

  // 只处理 /trucks/<数字>/ 这一种形态；其余（含 /trucks/ 本身）交回静态资源
  const isDetail = segs.length <= 1 && /^\d+$/.test(segs[0] || '');
  if (!isDetail) {
    return ctx.env.ASSETS ? ctx.env.ASSETS.fetch(ctx.request) : new Response('Not Found', { status: 404 });
  }

  const id = Number(segs[0]);

  let truck: any = null;
  try {
    truck = await ctx.env.DB
      .prepare(
        `SELECT id, biz_type, tonnage, brand, model, year, hours, province, city,
                price, price_unit, condition, has_accident, images, created_at
           FROM trucks
          WHERE id = ? AND status = 'approved'`
      )
      .bind(id)
      .first();
  } catch {
    truck = null;
  }

  // 车源不存在或未审核 → 返回一个「找不到」的页面（而不是裸 404，体验更好）
  if (!truck) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  let imgs: string[] = [];
  try {
    const parsed = JSON.parse(truck.images || '[]');
    if (Array.isArray(parsed)) imgs = parsed.filter((k: unknown) => typeof k === 'string' && k);
  } catch {}

  const name = `${truck.tonnage}吨 ${truck.brand}${truck.model ? ' ' + truck.model : ''}`;
  const title = `${name} ${bizLabel(truck.biz_type)} — 吊车.cn`;
  const descParts = [
    `${truck.tonnage}吨${truck.brand}${truck.model ? ' ' + truck.model : ''}`,
    truck.year ? `${truck.year}年出厂` : '',
    truck.hours ? `工时${truck.hours}` : '',
    [truck.province, truck.city].filter(Boolean).join(''),
    truck.price ? `价格${truck.price}${truck.price_unit || '万元'}` : '价格面议',
  ].filter(Boolean);
  const description = descParts.join(' · ') + '。查看车况详情与联系方式。';

  // JSON-LD：让搜索引擎理解这是商品页
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    category: '二手工程机械',
    ...(imgs.length ? { image: imgs.map((k) => `${SITE_URL}/img/${k}`) } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CNY',
      ...(truck.price ? { price: String(Math.round(Number(truck.price) * 10000)) } : {}),
      availability: 'https://schema.org/InStock',
      url: `${SITE_URL}/trucks/${truck.id}/`,
    },
  };

  return new Response(detailHtml({ title, description, name, id: truck.id, ld }), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' },
  });
};

/** 详情页外壳：SEO 信息服务端直出，正文交给 app.js 渲染 */
function detailHtml(o: { title: string; description: string; name: string; id: number; ld: unknown }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${SITE_URL}/trucks/${o.id}/">
<meta property="og:title" content="${esc(o.name)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="product">
<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="hd">
  <div class="wrap hd-in">
    <a class="logo" href="/">吊车<span>.cn</span></a>
    <nav class="nav">
      <a href="/trucks/">车源大厅</a>
      <a href="/sell/">我要卖车</a>
      <a href="/rent/">吊车出租</a>
      <a href="/price/">行情价格</a>
      <a href="/guide/">避坑指南</a>
    </nav>
  </div>
</header>
<main>
  <section class="wrap sec first" id="truck-detail" data-id="${o.id}">
    <p class="crumb"><a href="/trucks/">← 返回车源大厅</a></p>
    <p class="empty">加载中…</p>
  </section>
</main>
<footer class="ft">
  <div class="wrap">
    <p class="ft-t">吊车.cn — 二手吊车转让信息平台</p>
    <p class="ft-d">本站仅提供信息发布与展示服务，不参与实际交易、不垫资、不做担保。信息由发布者提供，请自行核实车况与权属。</p>
    <p class="ft-c">© ${new Date().getFullYear()} 吊车.cn</p>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

/** 车源不存在时的提示页 */
function notFoundHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>车源不存在 — 吊车.cn</title>
<meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="hd">
  <div class="wrap hd-in">
    <a class="logo" href="/">吊车<span>.cn</span></a>
    <nav class="nav">
      <a href="/trucks/">车源大厅</a>
      <a href="/sell/">我要卖车</a>
      <a href="/rent/">吊车出租</a>
      <a href="/price/">行情价格</a>
      <a href="/guide/">避坑指南</a>
    </nav>
  </div>
</header>
<main>
  <section class="wrap sec first narrow">
    <h1 class="h1">车源不存在</h1>
    <p class="lead">该车源可能已下架、已成交，或尚未通过审核。</p>
    <p class="more"><a class="btn" href="/trucks/">去看看其他车源</a></p>
  </section>
</main>
<footer class="ft">
  <div class="wrap">
    <p class="ft-t">吊车.cn — 二手吊车转让信息平台</p>
    <p class="ft-c">© ${new Date().getFullYear()} 吊车.cn</p>
  </div>
</footer>
</body>
</html>`;
}
