/* 校验构建产物 head 里的结构化数据与社交标签。
   纯逻辑单测，不依赖网络与浏览器 —— 本机 wrangler / CDP 都不可靠，
   但这部分（静态页 head）完全由构建脚本决定，直接读 dist/ 断言就够。

   跑法：node scripts/test-head.mjs
*/
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

let pass = 0;
const fails = [];

function ok(name) {
  pass++;
}
function bad(name, detail) {
  fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond, name, detail) {
  if (cond) ok(name);
  else bad(name, detail);
}

/* 从 html 里抠出所有 <script type="application/ld+json"> 的内容并 parse */
function extractLd(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function metaContent(html, attr, key) {
  // attr: 'property' | 'name'
  const re = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

function canonical(html) {
  const m = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
  return m ? m[1] : null;
}

/* 页面清单：路径 + 期望的 JSON-LD 顶层类型集合 + 是否应为绝对 url */
const PAGES = [
  { file: 'index.html', url: 'https://xn--bqr649k.cn/', types: ['Organization', 'WebSite', 'ItemList', 'ItemList'] },
  { file: 'trucks/index.html', url: 'https://xn--bqr649k.cn/trucks/', types: ['CollectionPage', 'ItemList', 'Organization'] },
  { file: 'sell/index.html', url: 'https://xn--bqr649k.cn/sell/', types: ['WebPage', 'Organization'] },
  { file: 'rent/index.html', url: 'https://xn--bqr649k.cn/rent/', types: ['Service', 'Organization'] },
  { file: 'price/index.html', url: 'https://xn--bqr649k.cn/price/', types: ['FAQPage', 'Organization'] },
  { file: 'guide/index.html', url: 'https://xn--bqr649k.cn/guide/', types: ['FAQPage', 'Organization'] },
];

console.log('[head] 校验构建产物 head...\n');

for (const p of PAGES) {
  const fp = path.join(DIST, p.file);
  if (!existsSync(fp)) {
    bad(`${p.file} 存在`, '文件缺失');
    continue;
  }
  const html = await readFile(fp, 'utf8');
  const tag = p.file;

  /* ---- canonical ---- */
  assert(canonical(html) === p.url, `${tag} canonical`, `期望 ${p.url}，实际 ${canonical(html)}`);

  /* ---- og 必备标签 ---- */
  const ogRequired = [
    'og:type', 'og:site_name', 'og:locale', 'og:title',
    'og:description', 'og:url', 'og:image', 'og:image:width',
    'og:image:height', 'og:image:alt',
  ];
  for (const k of ogRequired) {
    assert(metaContent(html, 'property', k) !== null, `${tag} ${k} 存在`);
  }

  /* og:image 必须是绝对 URL —— 抓取器不解析相对路径 */
  const ogImage = metaContent(html, 'property', 'og:image');
  assert(
    !!ogImage && /^https:\/\//.test(ogImage),
    `${tag} og:image 为绝对 URL`,
    `实际 ${ogImage}`
  );

  /* og:url 必须等于 canonical */
  assert(
    metaContent(html, 'property', 'og:url') === canonical(html),
    `${tag} og:url == canonical`
  );

  /* ---- twitter ---- */
  assert(metaContent(html, 'name', 'twitter:card') === 'summary_large_image', `${tag} twitter:card`);
  ass: {
    const timg = metaContent(html, 'name', 'twitter:image');
    assert(!!timg && /^https:\/\//.test(timg), `${tag} twitter:image 为绝对 URL`);
  }

  /* ---- favicon ---- */
  assert(/rel="icon"[^>]*favicon\.svg/.test(html), `${tag} favicon.svg`);
  assert(/rel="icon"[^>]*favicon\.ico/.test(html), `${tag} favicon.ico`);
  assert(/rel="apple-touch-icon"/.test(html), `${tag} apple-touch-icon`);

  /* ---- JSON-LD ---- */
  const raws = extractLd(html);
  assert(raws.length === 1, `${tag} 恰好 1 个 ld+json script`, `实际 ${raws.length} 个`);

  if (raws.length === 0) continue;

  let parsed = null;
  try {
    parsed = JSON.parse(raws[0]);
    ok(`${tag} JSON-LD 语法合法`);
  } catch (e) {
    bad(`${tag} JSON-LD 语法合法`, e.message);
    continue;
  }

  assert(parsed['@context'] === 'https://schema.org', `${tag} @context`);

  const nodes = parsed['@graph'] || [parsed];
  const types = nodes.map((n) => n['@type']);

  assert(
    JSON.stringify(types) === JSON.stringify(p.types),
    `${tag} 实体类型序列`,
    `期望 [${p.types}]，实际 [${types}]`
  );

  /* 每个节点必须有 @type，URL 类字段必须绝对 */
  for (const n of nodes) {
    assert(!!n['@type'], `${tag} 节点有 @type`);
  }

  /* 反查所有 url 字段是否绝对 */
  const urls = [];
  (function walk(v) {
    if (!v || typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' && (k === 'url' || k === 'urlTemplate' || k === 'target')) {
        if (k === 'target') continue; // EntryPoint 对象，下面单独走
        urls.push(val);
      }
      walk(val);
    }
  })(parsed);
  assert(
    urls.every((u) => /^https:\/\//.test(u)),
    `${tag} 所有 url 字段为绝对 URL`,
    urls.filter((u) => !/^https:\/\//.test(u)).join(', ')
  );

  /* 不能出现裸的转义残留 */
  assert(
    !parsed.__raw,
    `${tag} 无未转义字符残留`
  );

  /* 无 </script> 注入风险 —— 构建脚本把 < 转成了 \u003c */
  assert(
    !/<\/script>/i.test(raws[0]),
    `${tag} 无 </script> 注入`
  );
}

/* ---- admin 页必须不带 og / JSON-LD ---- */
{
  const fp = path.join(DIST, 'admin/index.html');
  if (existsSync(fp)) {
    const html = await readFile(fp, 'utf8');
    assert(!/property="og:/.test(html), 'admin 页无 og 标签');
    assert(!/application\/ld\+json/.test(html), 'admin 页无 JSON-LD');
    assert(/name="robots"\s+content="noindex/i.test(html), 'admin 页 noindex');
    assert(/rel="icon"/.test(html), 'admin 页仍带 favicon');
  } else {
    bad('admin/index.html 存在', '文件缺失');
  }
}

/* ---- 静态资源存在性 ---- */
for (const f of ['og.png', 'favicon.svg', 'favicon.ico']) {
  assert(existsSync(path.join(DIST, f)), `静态资源 ${f} 存在`);
}

console.log(`\n[head] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[head] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[head] 全部通过 ✓');
