// 静态站构建脚本：生成 dist/ 下的全部页面
import { mkdir, writeFile, rm, cp, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages, SITE, DISCLAIMER_SHORT, ORG_NODE, ARTICLES_PLACEHOLDER } from '../src/site.mjs';
import { parseFrontmatter, renderMarkdown, plainText } from './lib/md.mjs';

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

/* 登录框（邮箱验证码） */
.d-login{margin-top:22px;border:1px solid var(--line);border-radius:var(--radius);
  background:#fff;padding:26px 20px;text-align:center}
.d-login h3{font-size:16px;margin-bottom:8px}
.d-login p{color:var(--fg2);font-size:13.5px;margin:0 0 16px}
.d-login .soon{display:inline-block;font-size:12.5px;color:#a15c00;background:#fffaf2;
  border:1px solid #f0dcc0;border-radius:20px;padding:3px 12px;margin-bottom:14px}

/* 登录表单 */
.d-login form{max-width:360px;margin:0 auto;text-align:left}
.d-field{margin-bottom:12px}
.d-field label{display:block;font-size:13px;color:var(--fg2);margin-bottom:6px}
.d-field input{width:100%;box-sizing:border-box;padding:12px 14px;font-size:15px;
  border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--fg);outline:none;
  transition:border-color .15s}
.d-field input:focus{border-color:var(--brand)}
.d-field input:disabled{background:var(--bg2);color:var(--fg2)}
.d-field input::placeholder{color:#b6bac0}
/* 验证码输入：字距拉开，方便核对数字 */
#d-code{letter-spacing:6px;font-weight:600}
.d-code-row{display:flex;gap:8px;align-items:stretch}
.d-code-row .d-field{flex:1;margin-bottom:12px}
.d-send{flex:0 0 auto;padding:0 14px;font-size:13.5px;border:1px solid var(--line);
  border-radius:8px;background:#fff;color:var(--fg);cursor:pointer;white-space:nowrap;
  transition:background .15s,border-color .15s}
.d-send:hover:not(:disabled){background:var(--bg2);border-color:var(--fg2)}
.d-send:disabled{color:var(--fg2);cursor:default;background:var(--bg2)}
.d-err{color:#b3261e;font-size:13px;margin:0 0 10px;min-height:18px}
.d-err:empty{display:none}
.d-login .btn{width:100%;margin-top:2px}
.d-login .d-alt{margin:14px 0 0;font-size:12.5px;color:var(--fg2);text-align:center}
.d-login .d-alt a{color:var(--fg2);text-decoration:underline}
.d-login .d-alt a:hover{color:var(--brand)}
/* 已登录态：显示退出入口 */
.d-me{font-size:13px;color:var(--fg2);margin:14px 0 0}
.d-me button{background:none;border:0;padding:0;color:var(--fg2);font-size:13px;
  text-decoration:underline;cursor:pointer;font-family:inherit}
.d-me button:hover{color:var(--brand)}

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

/* ── 静态资源指纹（内容哈希文件名）─────────────────────────────────
   为什么需要：
     CF Pages 对**非 HTML** 资源默认给 `Cache-Control: public, max-age=14400`，
     实测 `public/_headers` 里写 Cache-Control **改不动**（自定义头能生效，
     唯独 Cache-Control 被资源层锁死）。于是浏览器 4 小时内完全不回源，
     出现「HTML 已是新版、页面引用的 JS 还是旧版」——站长自己刷新也没用。
   解法：文件名带内容哈希。内容一变 → 文件名变 → 浏览器与 CDN 都不可能
     命中旧副本。这是前端的标准做法，且不依赖任何平台特性。
   ⚠️ 必须在渲染页面之前算好：`render()` 里要用 assets.app，
     而 `const` 不 hoist，声明晚了会踩 TDZ。 */
const assets = await fingerprintAssets(css);

/* favicon 三件套：SVG（现代浏览器，矢量清晰）+ ICO（老浏览器/采集器）+ apple-touch-icon。
   ⚠️ 必须声明在这里（render 调用之前）—— `const` 有 TDZ，声明在使用之后会直接报
   "Cannot access 'FAVICON' before initialization"。 */
const FAVICON = `<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/og.png">`;

/* 文章：扫 src/articles/*.md，每篇生成 /guide/<slug>/。
   ⚠️ 必须在这里 await，不能挪到后面懒加载 —— 下面的 sitemap 与主循环都要用，
   声明晚了会踩 TDZ（本项目已在 FAVICON 上踩过一次同类问题）。 */
const articles = await loadArticles();
const allPages = [...pages, ...articles.map(articlePage)];

let count = 0;
for (const page of allPages) {
  const outPath = path.join(DIST, page.path);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, page.layout === 'admin' ? renderAdmin(page, css) : render(page, css, articles), 'utf8');
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
//
// 这里保留**无哈希**的稳定名做兜底（万一有人只部署 functions 没跑构建，
// 页面不至于 404 裸奔）；页面真正引用的是带哈希的那一份。
await writeFile(path.join(DIST, 'style.css'), css + DETAIL_CSS, 'utf8');

// 资源清单：给 Functions 用。
// 车源详情/长尾页是 Functions 实时渲染的，它拿不到构建期的变量，
// 只能读这份 JSON 才知道当前该引哪个哈希文件。
await writeFile(path.join(DIST, 'assets.json'), JSON.stringify(assets, null, 2) + '\n', 'utf8');

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

  // 车源详情页在构建阶段查不到（CI 里没有 D1 凭据），用 sitemapindex
  // 挂上 /trucks-sitemap.xml（由 Functions 实时查库生成）。
  // 静态页清单统一由 pages-sitemap.xml 提供，这里不再重复列一遍。
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

/** 静态页 + 文章页的 URL 条目。两个 sitemap 函数共用，避免各写一份走偏。
 *  页面对象可用 priority / changefreq 覆盖默认值（文章页用 0.6 / monthly）。 */
function sitemapUrlEntries(list) {
  const today = new Date().toISOString().slice(0, 10);
  return list
    .map((p) => {
      const priority =
        p.priority ?? (p.path === 'index.html' ? '1.0' : p.path === 'trucks/index.html' ? '0.9' : '0.7');
      const changefreq =
        p.changefreq ?? (p.path === 'index.html' || p.path === 'trucks/index.html' ? 'daily' : 'weekly');
      return `  <url>
    <loc>${xmlEsc(pageUrl(p.path))}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    })
    .join('\n');
}

/** 静态页 + 文章页的 sitemap */
function renderPagesSitemap() {
  // admin 是 noindex，不列
  const list = allPages.filter((p) => p.layout !== 'admin');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrlEntries(list)}
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

/** 内容哈希文件名。
 *
 *  对 app.js / admin.js / style.css 各算一个 8 位 sha256 前缀，产出
 *  `app.<hash>.js` 这样的名字写进 dist，并把映射关系返回。
 *
 *  返回结构刻意做成「键是逻辑名、值是站点绝对路径」——Functions 里直接
 *  `assets.app` 就能拼进 HTML，不需要再拼字符串。
 *
 *  ⚠️ 哈希取自**文件内容**，不是时间戳：同一份内容在任何机器上构建都得到
 *  同一个文件名，避免 CI 每次产出不同 diff。
 */
async function fingerprintAssets(css) {
  const items = [
    { key: 'app', name: 'app.js', content: await readFile(path.join(ROOT, 'public', 'app.js')) },
    { key: 'admin', name: 'admin.js', content: await readFile(path.join(ROOT, 'public', 'admin.js')) },
    { key: 'css', name: 'style.css', content: Buffer.from(css + DETAIL_CSS, 'utf8') },
  ];

  const out = {};
  for (const it of items) {
    const ext = path.extname(it.name); // .js / .css
    const base = it.name.slice(0, -ext.length);
    const hash = createHash('sha256').update(it.content).digest('hex').slice(0, 8);
    const hashedName = `${base}.${hash}${ext}`;
    await writeFile(path.join(DIST, hashedName), it.content);
    out[it.key] = `/${hashedName}`;
  }
  console.log(`[build] 资源指纹: ${items.map((i) => out[i.key]).join('  ')}`);
  return out;
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 序列化 JSON-LD。
 *  必须转义 `<` —— 正文里若出现 `</script>` 会提前闭合标签，页面直接崩。
 *  顺手把 `&` 和 U+2028/U+2029 也转掉：前者在部分解析器里有坑，
 *  后者是 JS 的行分隔符，虽在 JSON 里合法但历史上引发过解析问题。 */
function jsonLd(node) {
  return JSON.stringify(node)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 页面 URL。首页是根，其余是去 index.html 的目录形式。 */
function pageUrl(p) {
  return p === 'index.html' ? SITE.url + '/' : `${SITE.url}/${p.replace(/index\.html$/, '')}`;
}

/** Open Graph + Twitter Card。
 *  为什么两个都写：微信/QQ/微博/小红书 读 og，推特读 twitter:*。
 *  og:image 必须是绝对 URL —— 抓取器不解析相对路径，写了相对路径等于没写。 */
function socialMeta(page) {
  const url = pageUrl(page.path);
  const ogDesc = page.ogDesc || page.description || SITE.desc;
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${esc(page.title)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE.ogImage)}">
<meta property="og:image:width" content="${SITE.ogImageWidth}">
<meta property="og:image:height" content="${SITE.ogImageHeight}">
<meta property="og:image:alt" content="${esc(SITE.slogan)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(page.title)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<meta name="twitter:image" content="${esc(SITE.ogImage)}">`;
}

function render(page, css, articles = []) {
  const { title, description, path: p, ld } = page;
  // 文章列表占位符替换。其他页面 body 里没有占位符，replace 是空操作。
  const body = String(page.body ?? '').replace(ARTICLES_PLACEHOLDER, renderArticleList(articles));
  const full = pageUrl(p);
  // 只有声明了 ld 的页面才输出结构化数据（admin 是无）
  const ldScript =
    typeof ld === 'function' ? `\n<script type="application/ld+json">${jsonLd(ld())}</script>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(full)}">
${socialMeta(page)}
${FAVICON}${ldScript}
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
<script src="${assets.app}" defer></script>
</body>
</html>`;
}

// 后台页：独立模板，不进 SEO（noindex），加载 admin.js。
// 刻意不加 og / twitter / JSON-LD —— 后台没有分享与收录价值，
// 加了反而会把后台标题泄漏到分享卡片里。
function renderAdmin(page, css) {
  const { title, body } = page;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex,nofollow">
${FAVICON}
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
<script src="${assets.admin}" defer></script>
</body>
</html>`;
}

/* ───────── 文章 ─────────
   内容放 src/articles/*.md，构建时渲染成 /guide/<slug>/。
   markdown 渲染器在 scripts/lib/md.mjs（零依赖，单测 scripts/test-md.mjs）。

   下面的函数都是 function 声明 —— 会被 hoist，所以能在顶层调用点之前定义。
   ⚠️ 但不要在函数外新增 const 再在函数里用：const 不 hoist，
   调用点在前会直接踩 TDZ（本项目已经踩过一次）。 */

/** 读全部文章。目录不存在时返回空数组 —— 文章是可选的，不该阻断构建。 */
async function loadArticles() {
  const dir = path.join(ROOT, 'src', 'articles');

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const list = [];
  for (const file of files) {
    const { meta, body } = parseFrontmatter(await readFile(path.join(dir, file), 'utf8'));
    const slug = String(meta.slug || file.replace(/\.md$/, '')).trim();
    const text = plainText(body);

    // 静默生成一个坏页面比构建失败更糟，这里直接抛
    if (!slug) throw new Error(`[build] 文章 ${file} 缺少 slug`);
    if (!text) throw new Error(`[build] 文章 ${file} 正文为空`);

    list.push({
      slug,
      title: meta.title || text.slice(0, 30),
      description: meta.description || text.slice(0, 80),
      date: meta.date || '',
      html: renderMarkdown(body),
      words: text.replace(/\s/g, '').length,
      file,
    });
  }

  // 新的在前。date 相同时按 slug 兜底排序 —— 保证每次构建产物顺序一致，
  // 否则 CI 里同一份内容会产出不同 diff。
  list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.slug.localeCompare(b.slug));

  // slug 重复会让两篇文章互相覆盖，拦下来
  const seen = new Set();
  for (const a of list) {
    if (seen.has(a.slug)) throw new Error(`[build] slug 重复：${a.slug}`);
    seen.add(a.slug);
  }
  return list;
}

/** 文章页对象，交给 render() 渲染 */
function articlePage(a) {
  return {
    path: `guide/${a.slug}/index.html`,
    title: a.title,
    description: a.description,
    ogDesc: a.description,
    ld: () => articleLd(a),
    body: articleBody(a),
    // 文章更新频率低于频道页，权重给低一档
    priority: '0.6',
    changefreq: 'monthly',
  };
}

/** title 里带了「| 吊车.cn」后缀，H1 与结构化数据不该带 */
function stripBrand(title) {
  return String(title || '').replace(/\s*\|\s*吊车\.cn\s*$/, '');
}

function articleUrl(a) {
  return `${SITE.url}/guide/${a.slug}/`;
}

function articleBody(a) {
  const h1 = stripBrand(a.title);
  const meta = [a.date, `约 ${a.words} 字`].filter(Boolean).join(' · ');
  return `<section class="wrap sec first narrow">
  <p class="crumb"><a href="/">首页</a><span>›</span><a href="/guide/">避坑指南</a></p>
  <h1 class="h1">${esc(h1)}</h1>
  <p class="tip">${esc(meta)}</p>
  <article class="article">${a.html}</article>
</section>
${relatedBlock(a)}`;
}

/** 文章底部互链。既是给读者的下一步，也是站内权重流动的通道。 */
function relatedBlock(current) {
  const others = articles.filter((x) => x.slug !== current.slug).slice(0, 3);
  if (!others.length) return '';
  return `<section class="wrap sec">
  <h2 class="h2">继续看</h2>
  <div class="posts">
${others.map(postItemHtml).join('\n')}
  </div>
</section>`;
}

/** 指南页顶部的文章列表 */
function renderArticleList(list) {
  if (!list.length) return '';
  return `<div class="posts">
${list.map(postItemHtml).join('\n')}
</div>`;
}

function postItemHtml(a) {
  return `    <a class="post-item" href="/guide/${encodeURIComponent(a.slug)}/">
      <h3>${esc(stripBrand(a.title))}</h3>
      <p>${esc(a.description)}</p>
      <div class="post-meta"><span>${esc(a.date)}</span><span>约 ${a.words} 字</span></div>
    </a>`;
}

/** 文章结构化数据：Article + BreadcrumbList。
 *  author / publisher 用 @id 引用 ORG_NODE，避免同一实体在 @graph 里展开两遍。 */
function articleLd(a) {
  const url = articleUrl(a);
  const h1 = stripBrand(a.title);
  const orgRef = { '@id': `${SITE.url}/#organization` };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: h1,
        description: a.description,
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        inLanguage: 'zh-CN',
        ...(a.date ? { datePublished: a.date, dateModified: a.date } : {}),
        author: orgRef,
        publisher: orgRef,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: `${SITE.url}/` },
          { '@type': 'ListItem', position: 2, name: '避坑指南', item: `${SITE.url}/guide/` },
          { '@type': 'ListItem', position: 3, name: h1 },
        ],
      },
      ORG_NODE,
    ],
  };
}
