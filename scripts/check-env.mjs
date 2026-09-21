#!/usr/bin/env node
// 部署后体检：确认关键环境变量在「运行中的部署」里真的生效。
//
// 为什么需要这个脚本：
//   本项目用的是 `wrangler pages deploy`（Direct Upload）部署。
//   CF 的 Direct Upload 部署 **不携带项目级环境变量** ——
//   变量只能在网页控制台配，且必须重新部署才生效。
//   历史上踩过坑：DC_ADMIN_KEY 变空 → 整个后台 401，但 CI 全绿，没人发现。
//
// 用法：
//   node scripts/check-env.mjs                    # 体检线上站点
//   SITE=https://xxx.pages.dev node scripts/check-env.mjs
//
// 退出码：0 = 全通过；1 = 有致命问题（CI 应该因此报红）

const SITE = process.env.SITE || 'https://xn--bqr649k.cn';

// 本机需要代理；CI（GitHub Actions）直连即可
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
if (PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(
    new ProxyAgent({
      uri: PROXY,
      requestTls: { rejectUnauthorized: false },
      proxyTls: { rejectUnauthorized: false },
    })
  );
}

let pass = 0;
const fails = [];

function ok(msg) {
  pass++;
  console.log(`  ✓ ${msg}`);
}
function bad(msg) {
  fails.push(msg);
  console.log(`  ✗ ${msg}`);
}

async function getJson(path, init = {}) {
  const r = await fetch(SITE + path, init);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON（比如 SPA 回落的 HTML） */
  }
  return { status: r.status, json, text };
}

console.log(`[check-env] 站点: ${SITE}\n`);

/* ─── 1. DC_ADMIN_KEY 必须在运行中的部署里生效 ───────────────────────
   判据：不带任何密钥调 /api/admin/list
     - 若返回「后台未配置访问密钥」→ 变量丢了（致命）
     - 若返回「缺少访问密钥」/「访问密钥不正确」→ 变量在（只是没给对） */
console.log('[1] 后台鉴权变量 DC_ADMIN_KEY');
{
  const r = await getJson('/api/admin/list');
  const msg = (r.json && r.json.msg) || r.text.slice(0, 80);

  if (msg.includes('后台未配置访问密钥')) {
    bad('★ DC_ADMIN_KEY 未生效 —— 后台完全无法登录');
    console.log('      修复：控制台 → Settings → Variables and Secrets → 填 DC_ADMIN_KEY');
    console.log('             → 然后必须重新部署一次（变量不会自动生效）');
  } else if (r.status === 401 && (msg.includes('缺少访问密钥') || msg.includes('访问密钥不正确'))) {
    ok('DC_ADMIN_KEY 已生效（接口要求密钥，说明变量读到了）');
  } else if (r.status === 200) {
    bad('★ 后台接口未鉴权就能访问 —— 密钥可能为空但校验被绕过，需立刻排查');
  } else {
    bad(`后台接口返回意外结果：${r.status} ${msg}`);
  }
}

/* ─── 2. 登录发码接口必须可用（且不能在开发模式） ───────────────── */
console.log('\n[2] 登录发码接口');
try {
  const r = await getJson('/api/auth/send-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: SITE },
    body: JSON.stringify({ email: `envcheck+${Date.now()}@example.com` }),
  });

  if (r.status === 429) {
    ok('发码接口正常（返回 429 限流，说明限流在工作）');
  } else if (r.status === 200 && r.json && r.json.ok) {
    ok('发码接口 200');
    // ★ 开发模式是安全洞：它会把验证码放进响应
    if (r.json.dev === true || r.json.devCode) {
      bad('★★ DC_MAIL_DEV_MODE 开着 —— 验证码会进响应体，任何人都能登进来！必须立刻关掉');
    } else {
      ok('DC_MAIL_DEV_MODE 未开启（正确）');
    }
  } else if (r.status === 500) {
    bad(`★ 发码接口 500 —— 很可能是 D1 表缺失。检查 CI 的 "Apply D1 schema" 步骤`);
    console.log(`      ${(r.json && r.json.msg) || ''}`);
  } else {
    bad(`发码接口异常：${r.status} ${(r.json && r.json.msg) || r.text.slice(0, 80)}`);
  }
} catch (e) {
  bad(`发码接口请求失败：${e.message}`);
}

/* ─── 3. 登录态接口（不查库，用于区分「表缺失」与「整体挂掉」） ─── */
console.log('\n[3] 登录态接口 /api/auth/me');
{
  const r = await getJson('/api/auth/me');
  if (r.status === 200 && r.json && r.json.loggedIn === false) {
    ok('/api/auth/me 正常（匿名返回 loggedIn=false）');
  } else if (r.status === 200 && r.json && typeof r.json.loggedIn === 'boolean') {
    ok('/api/auth/me 正常');
  } else {
    bad(`/api/auth/me 异常：${r.status}`);
  }
}

/* ─── 4. 详情页门禁契约（401 + needLogin）───────────────────────── */
console.log('\n[4] 详情页联系方式门禁');
try {
  // 找一个真实车源 id
  const list = await getJson('/api/trucks?limit=1');
  const first = list.json && list.json.data && list.json.data[0];
  if (!first) {
    ok('暂无可测车源，跳过');
  } else {
    // ★ 必须带 Referer：contact 接口的 sameOrigin() 读的是 Referer（不是 Origin），
    //   缺了会返回 403「请求来源不合法」。这是接口的既定契约，体检要照着来。
    const c = await getJson(`/api/truck/${first.id}/contact`, {
      headers: { Accept: 'application/json', Referer: SITE + '/' },
    });
    if (c.status === 401 && c.json && c.json.needLogin === true) {
      ok('未登录取联系方式被正确拦截（401 + needLogin）');
    } else {
      bad(`门禁契约异常：${c.status} ${JSON.stringify(c.json).slice(0, 100)}`);
    }
  }
} catch (e) {
  bad(`门禁检查失败：${e.message}`);
}

/* ─── 5. 指南文章页可访问 ────────────────────────────────────────
   ⚠️ 判据不能只看状态码：Pages 的 SPA 式回落在「文件不存在」时
   同样返回 200 + 首页 HTML。必须核对页面里有没有这篇文章**独有**的文字，
   否则「文章没部署上去」会被误判成正常。 */
console.log('\n[5] 指南文章页');
try {
  const hub = await getJson('/guide/');
  if (hub.status === 200 && hub.text.includes('深入阅读') && hub.text.includes('25 吨价格参考')) {
    ok('/guide/ 列表页正常（含文章列表）');
  } else {
    bad(`/guide/ 列表页异常：${hub.status} —— 可能被回落成首页 HTML`);
  }

  const post = await getJson('/guide/25t-price/');
  const ownTitle = post.text.includes('二手吊车 25 吨价格参考');
  const ownBody = post.text.includes('决定差价的四个因素') || post.text.includes('车龄是第一位的');
  if (post.status === 200 && ownTitle && ownBody) {
    ok('文章页 /guide/25t-price/ 正常（标题与正文都属于这篇文章）');
  } else {
    bad(`★ 文章页异常：状态 ${post.status}，标题${ownTitle ? '在' : '缺'}、正文${ownBody ? '在' : '缺'}`);
    console.log('      多半是静态文件没传上去，或 SPA 回落吃掉了 /guide/<slug>/ 路径');
  }

  const sm = await getJson('/pages-sitemap.xml');
  if (sm.text.includes('/guide/25t-price/')) {
    ok('pages-sitemap.xml 已收录文章页');
  } else {
    bad('pages-sitemap.xml 里没有文章页 —— 搜索引擎发现不了');
  }
} catch (e) {
  bad(`文章页检查失败：${e.message}`);
}

/* ─── 6. 静态资源指纹（内容哈希文件名）─────────────────────────────
   踩过的坑（2026-09-21）：CF Pages 对**非 HTML** 资源默认给
     Cache-Control: public, max-age=14400
   浏览器 4 小时内完全不会回源。于是出现「HTML 已是新版、页面里引的
   JS 还是旧版」的组合 —— 站长本人在自己浏览器上看到登录功能仍显示
   「登录（开发中）」的旧占位卡片，普通刷新怎么刷都没用。
   试过 public/_headers 写 Cache-Control：自定义头能生效，
   唯独 Cache-Control 被资源层锁死，改不动。
   最终方案：文件名带内容哈希（app.<hash>.js），内容一变 URL 就变，
   旧副本不可能被命中。这里守住三件事：清单存在、清单里的文件真能取到、
   页面引用的就是清单里的那一份（构建产物与 Functions 没走偏）。 */
console.log('\n[6] 静态资源指纹');
const HASHED = /^\/(app|admin|style)\.[0-9a-f]{8}\.(js|css)$/;
let manifest = null;
try {
  const m = await getJson('/assets.json');
  manifest = m.json;
  if (!manifest) {
    bad(`★ /assets.json 取不到或不是 JSON（${m.status}）—— Functions 无法确定该引哪个资源`);
  } else {
    const keys = ['app', 'admin', 'css'];
    const badKeys = keys.filter((k) => !HASHED.test(String(manifest[k] || '')));
    if (badKeys.length) {
      bad(`★ assets.json 里 ${badKeys.join('、')} 不是合法的哈希路径：${JSON.stringify(manifest)}`);
    } else {
      ok(`assets.json 正常（${keys.map((k) => manifest[k]).join('  ')}）`);
    }
  }
} catch (e) {
  bad(`assets.json 检查失败：${e.message}`);
}

if (manifest) {
  // 1) 清单里的文件必须真能取到（构建产物有没有传上去）
  for (const [k, url] of Object.entries(manifest)) {
    try {
      const r = await fetch(SITE + url);
      if (r.status === 200) {
        ok(`${url} 可访问（200）`);
      } else {
        bad(`★ ${url} 访问失败：${r.status} —— 构建产物没传上去`);
      }
    } catch (e) {
      bad(`${url} 请求失败：${e.message}`);
    }
  }

  // 2) 静态页引用的必须是清单里那一份。
  //    引用了旧名字 = 用户可能拿到 4 小时前的旧脚本。
  try {
    const home = await getJson('/');
    if (home.text.includes(`src="${manifest.app}"`)) {
      ok('首页引用的 JS 与清单一致');
    } else if (home.text.includes('src="/app.js"')) {
      bad('★ 首页还在引无哈希的 /app.js —— 改动可能延迟 4 小时才生效');
    } else {
      bad('★ 首页引用的 JS 与 assets.json 对不上（构建产物不同步）');
    }
  } catch (e) {
    bad(`首页引用检查失败：${e.message}`);
  }

  // 3) Functions 渲染的页面（车源详情/长尾页）也要一致
  try {
    const list = await getJson('/api/trucks?limit=1');
    const first = list.json && list.json.data && list.json.data[0];
    const p = first ? `/trucks/${first.id}/` : null;
    if (!p) {
      ok('暂无车源，跳过详情页引用检查');
    } else {
      const r = await getJson(p);
      const hasCss = r.text.includes(`href="${manifest.css}"`);
      const hasApp = r.text.includes(`src="${manifest.app}"`);
      if (hasCss && hasApp) {
        ok(`车源详情页引用的 CSS/JS 与清单一致（${p}）`);
      } else {
        bad(`★ ${p} 引用不同步：CSS ${hasCss ? '对' : '错'}、JS ${hasApp ? '对' : '错'}`);
        console.log('      Functions 读的是 dist/assets.json —— 构建与部署必须同一份产物');
      }
    }
  } catch (e) {
    bad(`详情页引用检查失败：${e.message}`);
  }
}

/* ─── 结果 ─────────────────────────────────────────────────────── */
console.log(`\n[check-env] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[check-env] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  console.log('\n❌ 部署后体检未通过');
  process.exit(1);
}
console.log('[check-env] 全部通过 ✓');
