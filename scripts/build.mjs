// 静态站构建脚本：生成 dist/ 下的全部页面
import { mkdir, writeFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages, SITE } from '../src/site.mjs';

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

if (existsSync(path.join(ROOT, 'public'))) {
  await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
}

console.log(`[build] ${count} pages -> dist/`);

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
    <p class="ft-d">本站仅提供信息发布与展示服务，不参与实际交易、不垫资、不做担保。信息由发布者提供，请自行核实车况与权属。</p>
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
