// GET /trucks/<id>/           — 车源详情页
// GET /trucks/<吨位>/          — 吨位长尾页（如 /trucks/25吨/）
// GET /trucks/<地区>/          — 地区长尾页（如 /trucks/江苏/）
// GET /trucks/<吨位>/<地区>/    — 组合长尾页（如 /trucks/25吨/江苏/）
// GET /trucks/<吨位>/<地区>/<品牌>/ — 三段组合（如 /trucks/25吨/江苏/徐工/）
//
// ── 为什么用 Function 而不是构建时生成 ─────────────────────────────
// 本站是纯静态构建（GitHub Actions 里跑 build.mjs），构建阶段**拿不到 D1 数据**
// （CI 里没有数据库凭据，也不该有）。所以详情页与长尾页都靠这个 Function
// 按需渲染：访问时实时查库，把 title / description / canonical / JSON-LD
// 服务端直出，正文列表交给前端 app.js 拉 /api/trucks 渲染。
//
// ── 为什么长尾页必须「有车源才出」 ────────────────────────────────
// 吨位 9 种 × 地区 8 种 = 72 个组合，若全部无脑生成，绝大多数是空页。
// 搜索引擎对大批空页/近似页会判为低质量（thin content），反而拖累整站。
// 所以：查库结果为空时直接 404 + noindex。
//
// ── 路由注意 ────────────────────────────────────────────────────
// _routes.json 的 include 里有 "/trucks/*"，连 /trucks/ 本身（车源大厅）
// 也会被这个 Function 接管。所以最后必须有一道兜底：
// 认不出来的路径一律 ctx.env.ASSETS.fetch() 交回静态资源，否则会把大厅页搞坏。

interface Env { DB: D1Database; ASSETS: Fetcher }

const SITE_URL = 'https://xn--bqr649k.cn';

/* ── 静态资源指纹 ────────────────────────────────────────────────
   这些页面是实时渲染的，引用 JS/CSS 时不能写死 `/app.js`：
   CF Pages 给非 HTML 资源强缓存 4 小时（_headers 改不动），
   写死名字 = 用户最长 4 小时拿到旧版脚本。
   scripts/build.mjs 会产出 dist/assets.json（`{app,admin,css}` → 带哈希路径），
   wrangler 部署时用 esbuild 把它内联进来，所以运行时零开销。
   ⚠️ 必须先跑 `npm run build` 再部署，否则 dist/assets.json 不存在会打包失败。 */
// @ts-ignore —— JSON 模块没有类型声明，esbuild 直接内联，不需要 tsc 认账
import ASSETS_MANIFEST from '../../dist/assets.json';

const A: { app: string; admin: string; css: string } = ASSETS_MANIFEST;

/** 与前端、构建脚本共用的白名单，避免各处口径不一致 */
const TONNAGES = [8, 12, 16, 20, 25, 35, 50, 80, 100];
const PROVINCES = ['上海', '江苏', '浙江', '山东', '河南', '广东', '河北', '安徽'];
const BRANDS = ['徐工', '三一', '中联', '柳工'];

const esc = (s: unknown = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function bizLabel(b: string) {
  return b === 'rent' ? '出租' : b === 'buy' ? '求购' : '转让';
}

/* ────────────── 路径段解析 ────────────── */

interface Seg {
  kind: 'tonnage' | 'province' | 'brand';
  value: string; // 展示用（如 "25吨" / "江苏"）
  raw: string;   // 查询用（如 "25" / "江苏"）
}

/** 解析单个路径段；认不出来返回 null */
function parseSeg(raw: string): Seg | null {
  const s = raw.trim();
  if (!s) return null;

  // 吨位：25 / 25吨 / 25t / 25T
  const m = s.match(/^(\d{1,4})\s*(?:吨|t|T)?$/);
  if (m) {
    const n = Number(m[1]);
    // 只认白名单里的吨位，避免 /trucks/12345吨/ 这类垃圾页被生成
    if (TONNAGES.includes(n)) return { kind: 'tonnage', value: `${n}吨`, raw: String(n) };
    return null;
  }

  // 地区：兼容「江苏」「江苏省」「上海市」
  const prov = s.replace(/[省市]$/, '');
  if (PROVINCES.includes(prov)) return { kind: 'province', value: prov, raw: prov };

  // 品牌
  if (BRANDS.includes(s)) return { kind: 'brand', value: s, raw: s };

  return null;
}

interface Query {
  tonnage?: string;
  province?: string;
  brand?: string;
}

/** 解析整条路径。返回 null 表示不是可识别的长尾页 → 交回静态资源 */
function parsePath(segs: string[]): Query | null {
  if (segs.length < 1 || segs.length > 3) return null;

  const q: Query = {};
  const seen = new Set<string>();

  for (const seg of segs) {
    const p = parseSeg(seg);
    if (!p) return null;
    // 同一维度出现两次（如 /trucks/25吨/35吨/）视为非法
    if (seen.has(p.kind)) return null;
    seen.add(p.kind);
    if (p.kind === 'tonnage') q.tonnage = p.raw;
    else if (p.kind === 'province') q.province = p.raw;
    else q.brand = p.raw;
  }

  return Object.keys(q).length ? q : null;
}

/** 规范路径：固定按「吨位 / 地区 / 品牌」顺序拼
 *  避免同一筛选组合对应多个 URL（/trucks/江苏/25吨/ 与 /trucks/25吨/江苏/），
 *  否则会分散权重、形成重复内容。 */
function canonPath(q: Query): string {
  const parts = [
    q.tonnage ? `${q.tonnage}吨` : '',
    q.province || '',
    q.brand || '',
  ].filter(Boolean);
  return parts.join('/');
}

/** 页面标题中的人类可读描述，如「25吨 江苏 徐工」 */
function humanKey(q: Query): string {
  return [q.tonnage ? `${q.tonnage}吨` : '', q.province || '', q.brand || ''].filter(Boolean).join(' ');
}

/* ────────────── 入口 ────────────── */

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const p = ctx.params as { path?: string | string[] };
  // 中文路径会被 urlencoded（/trucks/25吨/ → /trucks/25%E5%90%A8/），必须解码
  const segs = (Array.isArray(p.path) ? p.path : p.path ? [p.path] : [])
    .map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    })
    .filter((s) => s !== '');

  const fallback = () =>
    ctx.env.ASSETS ? ctx.env.ASSETS.fetch(ctx.request) : new Response('Not Found', { status: 404 });

  // 形态一：/trucks/<纯数字>/ → 车源详情页
  if (segs.length === 1 && /^\d+$/.test(segs[0])) {
    return renderDetail(ctx, Number(segs[0]));
  }

  // 形态二：/trucks/<吨位|地区|品牌>[/...] → 长尾筛选页
  const q = parsePath(segs);
  if (q) {
    return renderListPage(ctx, q, segs);
  }

  // 形态三：其余（含 /trucks/ 本身 = 车源大厅）→ 静态资源
  return fallback();
};

/* ────────────── 长尾筛选页 ────────────── */

async function renderListPage(ctx: PagesFunction<Env>, q: Query, segs: string[]) {
  const canonical = `${SITE_URL}/trucks/${canonPath(q)}/`;

  // ① 先查总数。空结果 → 404 + noindex（不生成低质量空页）
  let total = 0;
  let items: any[] = [];
  try {
    const where: string[] = ["status = 'approved'"];
    const args: any[] = [];
    if (q.tonnage) { where.push('tonnage = ?'); args.push(Number(q.tonnage)); }
    if (q.province) { where.push('province = ?'); args.push(q.province); }
    if (q.brand) { where.push('brand = ?'); args.push(q.brand); }
    const w = where.join(' AND ');

    const cnt = await ctx.env.DB.prepare(`SELECT COUNT(*) AS n FROM trucks WHERE ${w}`).bind(...args).first();
    total = Number((cnt as any)?.n || 0);

    if (total > 0) {
      // 首页列出前 20 条，既给爬虫真实内容，也让用户进来就有车看
      const res = await ctx.env.DB
        .prepare(
          `SELECT id, biz_type, tonnage, brand, model, year, hours, province, city,
                  price, price_unit, condition, has_accident, created_at
             FROM trucks
            WHERE ${w}
            ORDER BY created_at DESC
            LIMIT 20`
        )
        .bind(...args)
        .all();
      items = (res.results || []) as any[];
    }
  } catch {
    total = 0;
  }

  if (!total) {
    return new Response(emptyListHtml(q), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // ② 组合页加厚：把「同吨位其他地区」「同地区其他吨位」列出来做内链，
  //    既方便用户跳转，也让爬虫能从任一长尾页爬到其他长尾页。
  const related = buildRelated(q);

  const key = humanKey(q);
  const title = `${key} 二手吊车转让车源（共${total}条） — 吊车.cn`;
  const description =
    `吊车.cn 收录 ${key} 二手吊车转让车源 ${total} 条，含年份、工时、价格与所在地区。` +
    `信息由发布者提供，交易前请线下验车、核实权属。`;

  // JSON-LD：CollectionPage + ItemList，让搜索引擎理解这是「聚合列表页」
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: canonical,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: total,
      itemListElement: items.slice(0, 20).map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE_URL}/trucks/${t.id}/`,
        name: `${t.tonnage}吨 ${t.brand}${t.model ? ' ' + t.model : ''}`,
      })),
    },
  };

  return new Response(
    listHtml({ title, description, canonical, key, total, q, related, ld, hasHigher: segs.length > 1 }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // 车源随时增删，缓存 5 分钟：兼顾回源压力与新鲜度
        'Cache-Control': 'public, max-age=300',
      },
    }
  );
}

/** 相关长尾页内链：给「同层级、换一个维度」的入口，让爬虫从任一长尾页走到其他长尾页 */
function buildRelated(q: Query): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];

  if (q.brand) {
    // 品牌页 → 换品牌
    BRANDS.filter((b) => b !== q.brand).forEach((b) => out.push({ label: `${b}吊车`, href: `/trucks/${b}/` }));
  } else if (q.province) {
    // 地区页（含「吨位+地区」）→ 同地区换吨位
    TONNAGES.filter((t) => String(t) !== q.tonnage).forEach((t) =>
      out.push({ label: `${t}吨吊车`, href: `/trucks/${t}吨/${q.province}/` })
    );
  } else if (q.tonnage) {
    // 吨位页 → 同吨位换地区
    PROVINCES.forEach((p) => out.push({ label: `${p}${q.tonnage}吨`, href: `/trucks/${q.tonnage}吨/${p}/` }));
  }

  // 兜底：什么都推不出来时，给吨位与地区的平级入口
  if (!out.length) {
    TONNAGES.slice(0, 6).forEach((t) => out.push({ label: `${t}吨吊车`, href: `/trucks/${t}吨/` }));
    PROVINCES.slice(0, 4).forEach((p) => out.push({ label: `${p}吊车`, href: `/trucks/${p}/` }));
  }

  return out.slice(0, 12);
}

/* ────────────── HTML 模板 ────────────── */

const HEAD_COMMON = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${A.css}">`;

const HEADER = `<header class="hd">
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
</header>`;

const FOOTER = `<footer class="ft">
  <div class="wrap">
    <p class="ft-t">吊车.cn — 二手吊车转让信息平台</p>
    <p class="ft-d">本站仅提供信息发布与展示服务，不参与实际交易、不垫资、不做担保。信息由发布者提供，请自行核实车况与权属。</p>
    <p class="ft-c">© ${new Date().getFullYear()} 吊车.cn</p>
  </div>
</footer>`;

/** 长尾筛选页外壳：SEO 信息 + 首屏车源卡片服务端直出，后续分页由 app.js 接管 */
function listHtml(o: {
  title: string;
  description: string;
  canonical: string;
  key: string;
  total: number;
  q: Query;
  related: Array<{ label: string; href: string }>;
  ld: unknown;
  hasHigher: boolean;
}) {
  const crumb = [
    '<a href="/trucks/">车源大厅</a>',
    o.hasHigher ? `<span>/</span> <span>${esc(o.key)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${HEAD_COMMON}
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${esc(o.canonical)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(o.canonical)}">
<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
${HEADER}
<main>
  <section class="wrap sec first">
    <p class="crumb">${crumb}</p>
    <h1 class="h1">${esc(o.key)} 二手吊车转让</h1>
    <p class="lead">共 <strong>${o.total}</strong> 条车源。信息由发布者提供，交易前请核实车况、权属与过户条件。</p>

    <div id="truck-list" class="list" data-limit="20" data-query="${esc(
      Object.entries(o.q)
        .map(([k, v]) => `${k}=${v}`)
        .join('&')
    )}">
      <p class="empty">加载中…</p>
    </div>

    ${
      o.related.length
        ? `<div class="d-block"><h2>相关车源</h2><div class="chips">${o.related
            .map((r) => `<a class="chip" href="${esc(r.href)}">${esc(r.label)}</a>`)
            .join('')}</div></div>`
        : ''
    }

    <div class="d-block">
      <h2>选购提示</h2>
      <div class="notice">
        <strong>验车要点：</strong>先看权属（行驶证、发票、是否抵押），再看车况（大臂焊接痕迹、转台与车架连接处漆面、工时表交叉验证）。
        付款建议分批：定金 → 验车合格 → 过户完成 → 尾款。
      </div>
    </div>
  </section>
</main>
${FOOTER}
<script src="${A.app}" defer></script>
</body>
</html>`;
}

/** 该组合暂无车源：404 + noindex，不参与收录 */
function emptyListHtml(q: Query) {
  const key = humanKey(q);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${HEAD_COMMON}
<title>${esc(key)} 暂无车源 — 吊车.cn</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body>
${HEADER}
<main>
  <section class="wrap sec first narrow">
    <h1 class="h1">${esc(key)} 暂无在售车源</h1>
    <p class="lead">这个筛选条件下暂时没有已审核的车源。可以换个吨位或地区看看，也可以免费发布你的车源。</p>
    <p class="more">
      <a class="btn" href="/trucks/">浏览全部车源</a>
      <a class="btn ghost" href="/sell/">我要卖车</a>
    </p>
  </section>
</main>
${FOOTER}
</body>
</html>`;
}

/* ────────────── 车源详情页 ────────────── */

async function renderDetail(ctx: PagesFunction<Env>, id: number) {
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

  // 详情页 → 长尾页的向上内链，帮助爬虫发现筛选页
  const upLinks: Array<{ label: string; href: string }> = [];
  if (truck.tonnage) upLinks.push({ label: `${truck.tonnage}吨吊车`, href: `/trucks/${truck.tonnage}吨/` });
  if (truck.province) upLinks.push({ label: `${truck.province}吊车`, href: `/trucks/${truck.province}/` });
  if (truck.tonnage && truck.province)
    upLinks.push({ label: `${truck.tonnage}吨 ${truck.province}`, href: `/trucks/${truck.tonnage}吨/${truck.province}/` });
  if (truck.brand) upLinks.push({ label: `${truck.brand}吊车`, href: `/trucks/${truck.brand}/` });

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

  return new Response(
    detailHtml({ title, description, name, id: truck.id, ld, upLinks }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' },
    }
  );
}

/** 详情页外壳：SEO 信息服务端直出，正文交给 app.js 渲染 */
function detailHtml(o: {
  title: string;
  description: string;
  name: string;
  id: number;
  ld: unknown;
  upLinks: Array<{ label: string; href: string }>;
}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${HEAD_COMMON}
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${SITE_URL}/trucks/${o.id}/">
<meta property="og:title" content="${esc(o.name)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:type" content="product">
<meta property="og:url" content="${SITE_URL}/trucks/${o.id}/">
<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>
</head>
<body>
${HEADER}
<main>
  <section class="wrap sec first" id="truck-detail" data-id="${o.id}">
    <p class="crumb"><a href="/trucks/">← 返回车源大厅</a></p>
    <p class="empty">加载中…</p>
  </section>
  ${
    o.upLinks.length
      ? `<section class="wrap" style="padding-bottom:40px">
    <div class="d-block"><h2>同类车源</h2><div class="chips">${o.upLinks
      .map((l) => `<a class="chip" href="${esc(l.href)}">${esc(l.label)}<span>查看车源</span></a>`)
      .join('')}</div></div>
  </section>`
      : ''
  }
</main>
${FOOTER}
<script src="${A.app}" defer></script>
</body>
</html>`;
}

/** 车源不存在时的提示页 */
function notFoundHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${HEAD_COMMON}
<title>车源不存在 — 吊车.cn</title>
<meta name="robots" content="noindex,nofollow">
</head>
<body>
${HEADER}
<main>
  <section class="wrap sec first narrow">
    <h1 class="h1">车源不存在</h1>
    <p class="lead">该车源可能已下架、已成交，或尚未通过审核。</p>
    <p class="more"><a class="btn" href="/trucks/">去看看其他车源</a></p>
  </section>
</main>
${FOOTER}
</body>
</html>`;
}
