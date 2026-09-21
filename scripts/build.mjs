// 静态站构建脚本：生成 dist/ 下的全部页面
import { mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages, SITE, DISCLAIMER_SHORT } from '../src/site.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 后台专属样式（不污染前台）
const ADMIN_CSS = `
.hd-tag{margin-left:12px;font-size:13px;color:var(--fg2);padding:2px 10px;background:var(--bg2);border:1px solid var(--line);border-radius:20px}
.admin .sec{padding:30px 0}
.tabs{display:flex;gap:8px;margin:22px 0 18px;flex-wrap:wrap}
.tabs a{padding:9px 16px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:14px;font-weight:600}
.tabs a.on{border-color:var(--brand);color:var(--brand);background:#fff5f3}
.tabs .n{margin-left:6px;font-size:12px;color:var(--fg2);font-weight:400}
.atbl{width:100%;border-collapse:collapse;font-size:14px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.atbl th,.atbl td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.atbl th{background:var(--bg2);font-size:13px;color:var(--fg2);font-weight:600;white-space:nowrap}
.atbl tr:last-child td{border-bottom:0}
.c-id{color:var(--fg2);font-size:13px;white-space:nowrap}
.c-name{font-weight:700}
.c-meta{font-size:12.5px;color:var(--fg2)}
.c-cond{font-size:12.5px;color:var(--fg2);margin-top:5px;max-width:380px;line-height:1.5}
.c-price{color:var(--brand);font-weight:600;white-space:nowrap}
.c-contact{font-size:13px;white-space:nowrap}
.c-time{font-size:12px;color:var(--fg2);white-space:nowrap}
.c-act{white-space:nowrap}
.mini{font:inherit;font-size:13px;padding:6px 12px;margin:0 4px 4px 0;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer}
.mini.ok{border-color:#bfe3cd;color:var(--ok);background:#f4fbf6}
.mini.warn{border-color:#f0dcc0;color:#a15c00;background:#fffaf2}
.mini.del{border-color:#f5c6c0;color:#b3261e;background:#fdf6f5}
.mini:disabled{opacity:.5;cursor:default}
.pill{display:inline-block;font-size:12px;padding:2px 9px;border-radius:20px;background:var(--bg2);
  color:var(--fg2);border:1px solid var(--line);margin:0 4px 3px 0;white-space:nowrap}
.pill.approved{background:#f4fbf6;color:var(--ok);border-color:#bfe3cd}
.pill.pending{background:#fffaf2;color:#a15c00;border-color:#f0dcc0}
.pill.rejected{background:#fdf6f5;color:#b3261e;border-color:#f5c6c0}
.pill.acc{background:#fdecea;color:#b3261e;border-color:#f5c6c0}
.loading{text-align:center;color:var(--fg2);padding:34px}

/* 登录门禁 */
.login-box{max-width:420px;margin:40px auto;padding:32px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);text-align:center}
.login-box .h1{margin-bottom:8px}
.login-form{display:flex;gap:10px;margin-top:20px}
.login-form input{flex:1;min-width:0;font:inherit;font-size:15px;padding:11px 13px;border:1px solid var(--line);
  border-radius:8px;background:#fff}
.login-form input:focus{outline:none;border-color:var(--brand)}
.login-form .btn{white-space:nowrap}
.tabs .logout{margin-left:auto;color:var(--fg2);border-color:transparent;background:transparent;font-weight:400}
.tabs .logout:hover{color:#b3261e}

/* 移动端：后台表格列多，改为外层横向滚动，避免撑破页面 */
@media(max-width:720px){
  .admin .sec{padding:22px 0}
  .tabs{gap:6px;margin:16px 0 14px}
  .tabs a{padding:8px 12px;font-size:13px}
  .login-box{margin:24px auto;padding:24px 20px}
  .login-form{flex-direction:column}
  /* 表格容器：可横滑。不加负边距，避免把 .wrap 的 padding 撑破 */
  .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .atbl{min-width:640px;font-size:13px}
  .atbl th,.atbl td{padding:10px 10px}
  .c-cond{max-width:240px}
  .mini{padding:8px 12px;font-size:13px;margin:0 4px 4px 0}
}
`;

/* ── 车源详情页样式 ──────────────────────────────────────────────
   这个页面由 functions/trucks/[[path]].ts 按需渲染，走外链 style.css。
   常规页面不需要这些类，但共用同一份文件，多出来的规则无副作用。 */
const DETAIL_CSS = `
.crumb{font-size:13.5px;margin-bottom:18px}
.crumb a{color:var(--fg2)}
.crumb a:hover{color:var(--brand)}

.d-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;flex-wrap:wrap;margin-bottom:20px}
.d-title{font-size:26px;letter-spacing:-.5px;margin:0 0 8px}
.d-tags{display:flex;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--fg2)}
.d-price{text-align:right;white-space:nowrap}
.d-price b{display:block;font-size:30px;color:var(--brand);line-height:1.1}
.d-price small{font-size:12.5px;color:var(--fg2)}

.d-layout{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:26px;align-items:start}
.d-gallery{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#fff}
.d-main{aspect-ratio:4/3;background:var(--bg2);position:relative}
.d-main img{width:100%;height:100%;object-fit:contain;display:block;background:#0d0f12}
.d-nav{position:absolute;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;border-radius:50%;
  background:rgba(255,255,255,.9);color:var(--fg);font-size:19px;line-height:1;cursor:pointer;
  box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center}
.d-nav:hover{background:#fff}
.d-prev{left:10px}
.d-next{right:10px}
.d-idx{position:absolute;right:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;
  font-size:12.5px;padding:3px 10px;border-radius:20px}
.d-thumbs{display:flex;gap:8px;padding:10px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.d-thumbs img{width:66px;height:50px;flex:0 0 66px;object-fit:cover;border-radius:6px;
  border:2px solid transparent;cursor:pointer;background:var(--bg2)}
.d-thumbs img.on{border-color:var(--brand)}
.d-noimg{aspect-ratio:4/3;display:flex;align-items:center;justify-content:center;
  color:var(--fg2);font-size:14px;background:var(--bg2)}

.d-panel{border:1px solid var(--line);border-radius:var(--radius);background:#fff;padding:20px}
.d-table{width:100%;border-collapse:collapse;font-size:14px}
.d-table th,.d-table td{padding:9px 0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.d-table th{color:var(--fg2);font-weight:400;width:88px;white-space:nowrap}
.d-table tr:last-child th,.d-table tr:last-child td{border-bottom:0}
.d-table .em{color:var(--brand);font-weight:600}
.d-acc{color:#b3261e;font-weight:600}

.d-block{margin-top:22px}
.d-block h2{font-size:16px;margin-bottom:10px}
.d-cond{border:1px solid var(--line);border-radius:var(--radius);background:#fff;padding:18px;
  color:var(--fg);font-size:14.5px;line-height:1.8;white-space:pre-wrap;word-break:break-word;margin:0}

/* 联系方式：默认隐藏，点按钮才请求 */
.d-contact{margin-top:22px;border:1px solid var(--line);border-radius:var(--radius);
  background:#fff;padding:20px;text-align:center}
.d-contact .hint{color:var(--fg2);font-size:13.5px;margin:0 0 14px}
.d-contact .val{font-size:22px;font-weight:700;color:var(--brand);letter-spacing:.5px;
  word-break:break-all;margin:0}
.d-contact .btn{margin:0}
.d-ct-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px}

/* 登录占位框 */
.d-login{margin-top:22px;border:1px solid var(--line);border-radius:var(--radius);
  background:#fff;padding:26px 20px;text-align:center}
.d-login h3{font-size:16px;margin-bottom:8px}
.d-login p{color:var(--fg2);font-size:13.5px;margin:0 0 16px}
.d-login .soon{display:inline-block;font-size:12.5px;color:#a15c00;background:#fffaf2;
  border:1px solid #f0dcc0;border-radius:20px;padding:3px 12px;margin-bottom:14px}

/* 详情页免责声明：贴在车源信息下方，用户不必滚到 footer 才能看到 */
.d-disclaimer{margin-top:18px;padding:16px 18px;background:var(--bg2);
  border-left:3px solid var(--line);border-radius:0 var(--radius) var(--radius) 0}
.d-disclaimer h2{font-size:13.5px;color:var(--fg2);font-weight:600;margin:0 0 8px}
.d-disclaimer ul{margin:0;padding-left:18px;color:var(--fg2);font-size:12.5px;line-height:1.75}
.d-disclaimer li{margin-bottom:4px}
.d-disclaimer li:last-child{margin-bottom:0}
.d-disclaimer strong{color:var(--fg);font-weight:600}
.d-disclaimer a{color:var(--brand);text-decoration:underline}

@media(max-width:720px){
  .d-layout{grid-template-columns:1fr;gap:18px}
  .d-head{flex-direction:column;gap:10px}
  .d-title{font-size:21px}
  .d-price{text-align:left}
  .d-price b{font-size:25px}
  .d-panel{padding:16px}
  .d-table th{width:76px}
  .d-thumbs img{width:56px;height:42px;flex:0 0 56px}
  .d-nav{width:34px;height:34px}
  .d-contact{padding:16px}
  .d-contact .val{font-size:19px}
  .d-ct-actions{flex-direction:column}
  .d-contact .btn{width:100%}
}
`;

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
const css = await readCss();

let count = 0;
for (const page of pages) {
  const outPath = path.join(DIST, page.path);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, page.layout === 'admin' ? renderAdmin(page, css) : render(page, css), 'utf8');
  count++;
}

// 车源详情页（/trucks/<id>/）是 Functions 按需渲染的，拼不出内联样式，
// 所以单独输出一份 style.css 给它外链引用。

if (existsSync(path.join(ROOT, 'public'))) {
  await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
}

// 额外输出一份独立 CSS 文件。
// 常规页面仍然把 CSS 内联在 <style> 里（少一次请求，首屏更快）；
// 这份 style.css 是给「按需渲染」的车源详情页用的 —— 那个页面由
// functions/trucks/[[path]].ts 实时生成，拼不出内联样式，只能外链。
await writeFile(path.join(DIST, 'style.css'), css + DETAIL_CSS, 'utf8');

// ── SEO 基础文件 ────────────────────────────────────────────────
// 这两个文件必须存在于 dist 根目录，否则会被 Pages 的 SPA 式回落
// 吃掉（返回首页 HTML 而不是 404），爬虫拿不到任何抓取指引。
//
// 注意：_routes.json 只 include /api/*、/img/*、/trucks/*，不含这两个路径，
// 所以它们走静态资源直出 CDN，不会经过 Functions，性能最好。
await writeFile(path.join(DIST, 'robots.txt'), renderRobots(), 'utf8');
await writeFile(path.join(DIST, 'sitemap.xml'), renderSitemap(), 'utf8');
await writeFile(path.join(DIST, 'pages-sitemap.xml'), renderPagesSitemap(), 'utf8');

console.log(`[build] ${count} pages -> dist/`);

/** robots.txt：允许抓取全部前台，禁掉后台与筛选参数页 */
function renderRobots() {
  return `User-agent: *
Allow: /

# 后台是密钥登录的，不需要被收录
Disallow: /admin/

# 筛选参数页是同一批车源的重复视图，交给 sitemap 里的规范页收录
Disallow: /*?*

Sitemap: ${SITE.url}/sitemap.xml
`;
}

/** sitemap.xml：静态页 + 全部已审核车源详情页
 *
 * ⚠️ 车源详情页在构建阶段**查不到**（CI 里没有 D1 凭据），所以这里没法枚举。
 *    改用 <sitemapindex> 指向一个动态 sitemap：/trucks-sitemap.xml
 *    由 functions/trucks-sitemap.xml.ts 实时查库生成。
 *    好处是新上架车源不需要重新构建就能被收录。 */
function renderSitemap() {
  const today = new Date().toISOString().slice(0, 10);

  // 只收录前台可索引页；admin 是 noindex，不列
  const staticPages = pages.filter((p) => p.layout !== 'admin');

  const urls = staticPages.map((p) => {
    const loc = p.path === 'index.html' ? `${SITE.url}/` : `${SITE.url}/${p.path.replace(/index\.html$/, '')}`;
    // 首页权重最高，车源大厅次之
    const priority = p.path === 'index.html' ? '1.0' : p.path === 'trucks/index.html' ? '0.9' : '0.7';
    const changefreq = p.path === 'index.html' || p.path === 'trucks/index.html' ? 'daily' : 'weekly';
    return `  <url>
    <loc>${xmlEsc(loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });

  // 车源详情页由动态 sitemap 提供，这里用 sitemapindex 挂上去
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${xmlEsc(SITE.url + '/pages-sitemap.xml')}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${xmlEsc(SITE.url + '/trucks-sitemap.xml')}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>
`;
}

/** 静态页部分的 sitemap，内容与 /sitemap.xml 的静态部分一致 */
function renderPagesSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = pages.filter((p) => p.layout !== 'admin');
  const urls = staticPages.map((p) => {
    const loc = p.path === 'index.html' ? `${SITE.url}/` : `${SITE.url}/${p.path.replace(/index\.html$/, '')}`;
    const priority = p.path === 'index.html' ? '1.0' : p.path === 'trucks/index.html' ? '0.9' : '0.7';
    const changefreq = p.path === 'index.html' || p.path === 'trucks/index.html' ? 'daily' : 'weekly';
    return `  <url>
    <loc>${xmlEsc(loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

function xmlEsc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

async function readCss() {
  const { readFile } = await import('node:fs/promises');
  return readFile(path.join(ROOT, 'src', 'style.css'), 'utf8');
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(page, css) {
  const { title, description, body, path: p } = page;
  const full = p === 'index.html' ? SITE.url : `${SITE.url}/${p}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(full)}">
<style>${css}</style>
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
<main>${body}</main>
<footer class="ft">
  <div class="wrap">
    <p class="ft-t">吊车.cn — 二手吊车转让信息平台</p>
    <p class="ft-d">${esc(DISCLAIMER_SHORT)}</p>
    <p class="ft-c">© ${new Date().getFullYear()} 吊车.cn</p>
  </div>
</footer>
<script src="/app.js" defer></script>
</body>
</html>`;
}

// 后台页：独立模板，不进 SEO（noindex），加载 admin.js
function renderAdmin(page, css) {
  const { title, body } = page;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex,nofollow">
<style>${css}${ADMIN_CSS}</style>
</head>
<body class="admin">
<header class="hd">
  <div class="wrap hd-in">
    <a class="logo" href="/">吊车<span>.cn</span></a>
    <span class="hd-tag">内容审核后台</span>
  </div>
</header>
<main>${body}</main>
<script src="/admin.js" defer></script>
</body>
</html>`;
}
