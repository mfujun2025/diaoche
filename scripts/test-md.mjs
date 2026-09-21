// Markdown 渲染器纯单测（不依赖网络 / 构建产物）
//
// 为什么值得单测：这是字符串逐层替换的活，最容易出的就是
// 「先转义还是先替换」的顺序问题，以及列表/段落的边界粘包。
// 这类 bug 在页面上表现为「显示成字面量 <strong>」或「两段黏成一段」，
// 肉眼扫一遍页面不一定注意得到。
//
// 用法: node scripts/test-md.mjs
import { esc, parseFrontmatter, renderMarkdown, plainText } from './lib/md.mjs';

let pass = 0;
const fails = [];
function assert(cond, name, detail) {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
}
function eq(actual, expected, name) {
  assert(actual === expected, name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function has(hay, needle, name) {
  assert(String(hay).includes(needle), name, `输出里找不到 ${JSON.stringify(needle)}\n     实际：${hay}`);
}
function hasNot(hay, needle, name) {
  assert(!String(hay).includes(needle), name, `输出里不该出现 ${JSON.stringify(needle)}`);
}

console.log('[md] Markdown 渲染器单测\n');

/* ══════════════ 1. HTML 转义 ══════════════ */
console.log('— HTML 转义');

eq(esc('<script>'), '&lt;script&gt;', '尖括号转义');
eq(esc('a & b'), 'a &amp; b', '& 转义');
eq(esc(`"'`), '&quot;&#39;', '引号转义');
eq(esc(null), '', 'null 安全');
eq(esc(undefined), '', 'undefined 安全');

/* ══════════════ 2. frontmatter 解析 ══════════════ */
console.log('— frontmatter 解析');

const fm = parseFrontmatter(`---
title: 测试标题
slug: test-slug
date: 2026-09-21
---
正文第一行`);
eq(fm.meta.title, '测试标题', '取到 title');
eq(fm.meta.slug, 'test-slug', '取到 slug');
eq(fm.meta.date, '2026-09-21', '取到 date');
eq(fm.body.trim(), '正文第一行', '正文与元数据分离');

const noFm = parseFrontmatter('没有元数据的正文');
eq(Object.keys(noFm.meta).length, 0, '无 frontmatter 时 meta 为空对象');
eq(noFm.body.trim(), '没有元数据的正文', '无 frontmatter 时正文完整保留');

const quoted = parseFrontmatter(`---
title: "带引号的标题"
desc: '单引号也行'
---
x`);
eq(quoted.meta.title, '带引号的标题', '双引号被剥掉');
eq(quoted.meta.desc, '单引号也行', '单引号被剥掉');

const colonValue = parseFrontmatter(`---
title: 二手吊车 25 吨：价格怎么算
---
x`);
eq(colonValue.meta.title, '二手吊车 25 吨：价格怎么算', '★ 值里含冒号不截断（只按第一个冒号切）');

const crlf = parseFrontmatter('---\r\ntitle: 换行符测试\r\n---\r\n正文');
eq(crlf.meta.title, '换行符测试', '★ CRLF 换行也能解析（Windows 编辑器存的文件）');

const bom = parseFrontmatter('\uFEFF---\ntitle: BOM 测试\n---\n正文');
eq(bom.meta.title, 'BOM 测试', '★ 带 BOM 的文件也能解析');

/* ══════════════ 3. 标题 ══════════════ */
console.log('— 标题层级');

eq(renderMarkdown('## 二级'), '<h2>二级</h2>', '## → h2');
eq(renderMarkdown('### 三级'), '<h3>三级</h3>', '### → h3');
eq(renderMarkdown('#### 四级'), '<h3>四级</h3>', '#### 也降到 h3');
eq(renderMarkdown('# 一级'), '<h2>一级</h2>', '★ 正文里的 # 降级成 h2（页面 H1 由模板给）');
hasNot(renderMarkdown('# 一级\n## 二级'), '<h1>', '★ 正文绝不产出 h1（两个 H1 是 SEO 硬伤）');

/* ══════════════ 4. 段落 ══════════════ */
console.log('— 段落');

eq(renderMarkdown('一段话'), '<p>一段话</p>', '单行段落');
eq(renderMarkdown('第一行\n第二行'), '<p>第一行 第二行</p>', '连续多行合成一段');
eq(renderMarkdown('第一段\n\n第二段'), '<p>第一段</p>\n<p>第二段</p>', '空行切分两段');
eq(renderMarkdown(''), '', '空输入返回空串');
eq(renderMarkdown('   \n  \n'), '', '纯空白返回空串');

/* ══════════════ 5. 列表 ══════════════ */
console.log('— 列表');

eq(renderMarkdown('- 甲\n- 乙'), '<ul><li>甲</li><li>乙</li></ul>', '无序列表');
eq(renderMarkdown('* 甲\n* 乙'), '<ul><li>甲</li><li>乙</li></ul>', '星号也能起列表');
eq(renderMarkdown('1. 甲\n2. 乙'), '<ol><li>甲</li><li>乙</li></ol>', '有序列表');

const mixed = renderMarkdown('- 甲\n- 乙\n\n1. 丙');
has(mixed, '<ul><li>甲</li><li>乙</li></ul>', '★ 空行正确收掉无序列表');
has(mixed, '<ol><li>丙</li></ol>', '★ 列表类型切换正确（不会把丙塞进 ul）');

const listThenPara = renderMarkdown('- 甲\n\n普通段落');
has(listThenPara, '</ul>\n<p>普通段落</p>', '★ 列表后接段落，标签正确闭合');
hasNot(listThenPara, '<li>普通段落', '段落不会被当成列表项');

/* ══════════════ 6. 行内元素 ══════════════ */
console.log('— 行内元素');

eq(renderMarkdown('**加粗**'), '<p><strong>加粗</strong></p>', '加粗');
has(renderMarkdown('句子里的**重点**词'), '<strong>重点</strong>', '段中加粗');
hasNot(renderMarkdown('**加粗**'), '&lt;strong&gt;', '★ 生成的 strong 标签没有被二次转义');

eq(
  renderMarkdown('[车源大厅](/trucks/)'),
  '<p><a href="/trucks/">车源大厅</a></p>',
  '站内相对链接'
);
eq(
  renderMarkdown('[官网](https://example.com/a)'),
  '<p><a href="https://example.com/a">官网</a></p>',
  'https 外链'
);
has(
  renderMarkdown('[点我](javascript:alert(1))'),
  'href="#"',
  '★ javascript: 伪协议被拦掉'
);
has(
  renderMarkdown('[点我](data:text/html,x)'),
  'href="#"',
  '★ data: 伪协议被拦掉'
);

/* ══════════════ 7. 引用与分割线 ══════════════ */
console.log('— 引用与分割线');

eq(renderMarkdown('> 提示'), '<blockquote>提示</blockquote>', '引用块');
eq(renderMarkdown('---'), '<hr>', '分割线');
eq(renderMarkdown('----'), '<hr>', '更长的分割线');
hasNot(renderMarkdown('- 列表项'), '<hr>', '★ 单个短横线的列表项不会被误判成分割线');

/* ══════════════ 8. XSS 防护 ══════════════ */
console.log('— XSS 防护');

const xss1 = renderMarkdown('<script>alert(1)</script>');
hasNot(xss1, '<script>', '★ 正文里的 script 标签被转义');
has(xss1, '&lt;script&gt;', '转义后以字面量呈现');

const xss2 = renderMarkdown('## <img src=x onerror=alert(1)>');
hasNot(xss2, '<img', '★ 标题里的 img 标签被转义');

const xss3 = renderMarkdown('**<b>粗</b>**');
hasNot(xss3, '<b>', '★ 加粗里的原始标签被转义');

/* ══════════════ 9. plainText ══════════════ */
console.log('— 纯文本抽取');

eq(plainText('## 标题'), '标题', '去掉标题符号');
eq(plainText('**粗**'), '粗', '去掉加粗标记');
eq(plainText('[车源](/trucks/)'), '车源', '链接只留文字');
eq(plainText('---\ntitle: x\n---\n正文'), '正文', '★ 整块 frontmatter 被剥离');

/* ══════════════ 10. 组合场景 ══════════════ */
console.log('— 组合场景');

const full = renderMarkdown(
  ['## 小标题', '', '先给结论：**区间 14~42 万**。', '', '- 车龄', '- 品牌', '', '详见 [价格库](/price/)。'].join('\n')
);
has(full, '<h2>小标题</h2>', '组合：标题');
has(full, '<strong>区间 14~42 万</strong>', '组合：加粗');
has(full, '<ul><li>车龄</li><li>品牌</li></ul>', '组合：列表');
has(full, 'href="/price/"', '组合：内链');
assert(!full.includes('\n\n'), '组合：不产出多余空行');

/* ══════════════ 汇总 ══════════════ */
console.log('');
if (fails.length) {
  console.log(`❌ ${fails.length} 项失败（通过 ${pass} 项）：`);
  for (const f of fails) console.log('   ✗', f);
  process.exit(1);
}
console.log(`✅ ${pass} 项全部通过`);
