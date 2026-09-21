#!/usr/bin/env node
// 每日文章机器人的自测。纯逻辑 + 一次端到端演练，全部离线、不联网、不消耗 token。
//
//   node scripts/bot/../test-bot.mjs
//   node scripts/test-bot.mjs

import { rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseFrontmatter, plainText } from './lib/md.mjs';
import { loadConfig } from './bot/lib/config.mjs';
import { similarity, pickTopic, readExisting } from './bot/lib/topics.mjs';
import { validateArticle, toMarkdown } from './bot/lib/validate.mjs';
import { createLogger, today } from './bot/lib/logger.mjs';

const ROOT = process.cwd();
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
function assert(cond, msg) {
  cond ? ok(msg) : bad(msg);
}
function section(name) {
  console.log(`\n— ${name}`);
}

const cfg = await loadConfig('config/article-bot.json', ROOT);

/* ─── 1. 配置 ─────────────────────────────────────────────────── */
section('配置');
assert(cfg.topics.length >= 30, `选题池有 ${cfg.topics.length} 个（≥30）`);
assert(new Set(cfg.topics.map((t) => t.id)).size === cfg.topics.length, '选题 id 无重复');
assert(
  cfg.topics.every((t) => t.id && t.category && t.keyword && t.title),
  '每个选题都有 id / category / keyword / title'
);
assert(
  cfg.topics.every((t) => !t.links || t.links.every((l) => l.startsWith('/'))),
  '选题里的内链都是站内绝对路径'
);
{
  let threw = false;
  try {
    await loadConfig('config/not-exists.json', ROOT);
  } catch {
    threw = true;
  }
  assert(threw, '配置文件缺失时抛错而不是静默走默认');
}

/* ─── 2. 相似度 ───────────────────────────────────────────────── */
section('相似度去重');
assert(similarity('二手吊车怎么选', '二手吊车怎么选') === 1, '完全相同标题相似度 = 1');
assert(similarity('二手吊车怎么选', '今天吃什么') < 0.2, '完全不相关标题相似度 < 0.2');
{
  // 同题扩写（短标题被长标题完全包含）必须被拦住
  const s = similarity('二手吊车过户要哪些手续', '二手吊车过户要哪些手续？完整流程与材料清单');
  assert(s >= cfg.dedupe.maxTitleSimilarity, `同题扩写相似度 ${s.toFixed(2)} ≥ 阈值，能拦住`);
  assert(similarity('二手吊车怎么选', '二手吊车值多少钱') < cfg.dedupe.maxTitleSimilarity, '共用词但不同选题不会被误判为重复');
  const pool = await loadConfig('config/article-bot.json', ROOT);
  let maxInternal = 0;
  for (let i = 0; i < pool.topics.length; i++) {
    for (let j = i + 1; j < pool.topics.length; j++) {
      maxInternal = Math.max(
        maxInternal,
        similarity(pool.topics[i].title, pool.topics[j].title),
        similarity(pool.topics[i].keyword, pool.topics[j].keyword)
      );
    }
  }
  assert(maxInternal <= 0.65, `选题池内部最高相似度 ${maxInternal.toFixed(2)}（不会自己把自己剔干净）`);
}

/* ─── 3. 选题挑选 ─────────────────────────────────────────────── */
section('选题挑选');
{
  const { topic, slugBase } = pickTopic(cfg, [], []);
  assert(!!topic, '空历史时能选出选题');
  assert(slugBase === topic.id, 'slug 由 topic.id 决定，不受模型自由发挥影响');

  const existing = [{ title: topic.title, keyword: topic.keyword, slug: topic.id }];
  const second = pickTopic(cfg, existing, [{ status: 'success', topicId: topic.id }]);
  assert(second.topic && second.topic.id !== topic.id, '已发布过的选题不会被重复选中');

  const third = pickTopic(cfg, [], [{ status: 'success', topicId: 'select-25-vs-35' }]);
  assert(third.topic?.id !== 'select-25-vs-35', '日志里成功过的 topicId 会被跳过');

  const stable = pickTopic(cfg, [], []);
  assert(stable.topic?.id === topic.id, '同样输入得到同样结果（确定性）');

  const cats = new Set();
  let cur = [];
  const hist = [];
  for (let i = 0; i < 6; i++) {
    const p = pickTopic(cfg, cur, hist);
    if (!p.topic) break;
    cats.add(p.topic.category);
    hist.push({ status: 'success', topicId: p.topic.id });
    cur.push({ title: p.topic.title, keyword: p.topic.keyword, slug: p.topic.id });
  }
  assert(cats.size >= 4, `连续 6 次选题覆盖 ${cats.size} 个类别（类别轮转生效）`);
}

/* ─── 4. 发布前校验 ───────────────────────────────────────────── */
section('发布前校验');

const GOOD = {
  title: '支腿怎么打才安全',
  description: '吊车支腿垫板、跨距与地基要求的实用检查清单，二手吊车进场前照着做一遍。',
  slug: 'safety-outrigger-test',
  keyword: '吊车支腿操作规范',
  body: [
    '支腿打不好，其他都白搭。二手吊车进场前，先看地基能不能吃得住支腿反力，垫板面积够不够，两支腿跨距是否按说明书放到最大。这三件事没确认，力矩限制器再准也救不了倾翻。',
    '',
    '吊车支腿操作规范的核心就三件事：垫板够不够、跨距到不到位、地基吃不吃得住。',
    '',
    '## 支腿垫板多大才够？',
    '',
    '按最大支腿反力除以地基承载力估算，再乘安全系数。软土上必须加钢板或枕木扩散压力，**不要用单块木板凑合**。这一项在二手吊车随车资料里通常有对照表，找不到就按最不利取值。',
    '',
    '## 跨距必须放到说明书的最大位置吗',
    '',
    '除特殊说明允许半伸工况，否则一律放到最大。半伸作业会让整车稳定性大幅下降，是支腿类事故里最常见的诱因。',
    '',
    '- 四腿必须全部着地，严禁三条腿作业',
    '- 支腿下方不是回填土、不是井盖、不是地下室顶板',
    '- 作业中每两小时复查一次有无下沉',
    '',
    '## 支腿下沉了怎么办？',
    '',
    '立即停止作业、落钩卸载，让人员撤离后再重新打支腿。不要一边吊着一边调腿 —— 这个动作出过太多事故。有意内漏的车不适合继续干重活，建议先看[车源情况](/trucks/25吨/)或联系[专业检修](/guide/)',
    '',
    '> 本站只提供信息展示，操作请以随车说明书为准；看车请注意核对手续。有设备要出手可以到[发布车源](/sell/)登记。',
  ].join('\n'),
};

// 补足到合规字数
let padBody = GOOD.body;
let guard = 0;
while (plainText(padBody).replace(/\s/g, '').length < cfg.article.minWords + 200 && guard++ < 40) {
  padBody +=
    '\n\n还有一个容易忽略的点：二手吊车的支腿油缸可能存在内漏，肉眼不一定能看出来。停稳后观察半小时，看支腿有没有缓慢下沉；有下沉就说明单向阀或油缸密封有问题，修好再上工地。';
}

{
  const r = validateArticle({ ...GOOD, body: padBody }, cfg, { existing: [] });
  if (!r.ok) console.log('    错误：', r.errors.slice(0, 5).join(' / '));
  assert(r.ok, '合规稿件通过校验');
  assert(r.metrics.words >= cfg.article.minWords, `字数 ${r.metrics.words} 达标`);
  assert(r.metrics.links >= cfg.article.internalLinks[0], `内链 ${r.metrics.links} 个达标`);
}

const cases = [
  ['正文太短', 'body', '太短了', (e) => e.some((x) => x.includes('低于下限'))],
  ['含表格', 'body', padBody + '\n| 吨位 | 价格 |\n| --- | --- |\n', (e) => e.some((x) => x.includes('表格'))],
  ['含图片', 'body', padBody + '\n![配图](/og.png)\n', (e) => e.some((x) => x.includes('图片'))],
  ['含代码块', 'body', padBody + '\n```js\nconsole.log(1)\n```\n', (e) => e.some((x) => x.includes('代码块'))],
  ['含 HTML 标签', 'body', padBody + '\n<div class="x">广告</div>\n', (e) => e.some((x) => x.includes('HTML'))],
  ['缺 slug', 'slug', '', (e) => e.some((x) => x.includes('缺字段：slug'))],
  ['slug 含中文', 'slug', '二手吊车', (e) => e.some((x) => x.includes('ASCII'))],
  ['title 含英文冒号', 'title', '支腿:怎么打', (e) => e.some((x) => x.includes('英文冒号'))],
  ['命中套话黑名单', 'body', padBody + '\n综上所述，以上就是全部内容。', (e) => e.some((x) => x.includes('套话'))],
  ['编造成交价', 'body', padBody + '\n上周成交一台，成交价 28.5 万。', (e) => e.some((x) => x.includes('红线'))],
  ['slug 重复', 'slug', 'hour-meter', (e) => e.some((x) => x.includes('重复'))],
];
for (const [name, field, value, check] of cases) {
  const draft = { ...GOOD, slug: 'safety-outrigger-test', title: GOOD.title, body: padBody };
  draft[field] = value;
  const r = validateArticle(draft, cfg, { existing: [{ slug: 'hour-meter' }] });
  assert(!r.ok && check(r.errors), `拦截：${name}`);
}

{
  // 核心词密度过低
  const low = padBody.replace(/吊车/g, '设备');
  const r = validateArticle({ ...GOOD, slug: 'x-density', body: low }, cfg, { existing: [] });
  assert(!r.ok && r.errors.some((e) => e.includes('密度')), '拦截：核心词密度过低');
}
{
  // 小标题数量不足（去掉所有 ##）
  const noH2 = padBody.replace(/^## .*$/gm, '');
  const r = validateArticle({ ...GOOD, slug: 'x-h2', body: noH2 }, cfg, { existing: [] });
  assert(!r.ok && r.errors.some((e) => e.includes('小标题')), '拦截：小标题数量不足');
}
{
  // 列表缩进会被判嵌套 —— 但正常列表不能误伤
  const r = validateArticle({ ...GOOD, slug: 'x-list', body: padBody }, cfg, { existing: [] });
  assert(r.ok, '正常无缩进列表不被误判为嵌套列表');
}
{
  const r = validateArticle({ ...GOOD, slug: 'x-nested', body: padBody + '\n  - 子项\n' }, cfg, { existing: [] });
  assert(!r.ok && r.errors.some((e) => e.includes('嵌套')), '拦截：缩进嵌套列表');
}

/* ─── 5. Markdown 往返 ────────────────────────────────────────── */
section('Markdown 往返');
{
  const md = toMarkdown({ ...GOOD, body: padBody }, '2026-09-21');
  const { meta, body } = parseFrontmatter(md);
  assert(meta.slug === GOOD.slug, 'frontmatter 的 slug 能被正确解析');
  assert(meta.keyword === GOOD.keyword, 'frontmatter 的 keyword 能被正确解析');
  assert(meta.date === '2026-09-21', 'frontmatter 的 date 能被正确解析');
  assert(String(meta.title).endsWith('| 吊车.cn'), 'title 自动带上站点后缀');
  assert(!String(meta.title).includes('| 吊车.cn | 吊车.cn'), 'title 不会被重复加后缀');
  assert(body.trim().startsWith('支腿'), '正文紧跟 frontmatter 之后');
}
{
  // 标题里带英文冒号会被 toMarkdown 兜一层，避免解析被截断（GDP ）
  const md = toMarkdown({ ...GOOD, title: '支腿:怎么打', body: padBody }, '2026-09-21');
  const { meta } = parseFrontmatter(md);
  assert(!String(meta.title).startsWith('支腿:'), 'title 里的英文冒号被清理后再写入');
}

/* ─── 6. 日志 ─────────────────────────────────────────────────── */
section('日志');
const tmpRoot = path.join(ROOT, '.tmp-bot-test');
await rm(tmpRoot, { recursive: true, force: true });
await mkdir(tmpRoot, { recursive: true });
{
  const logCfg = { ...cfg, repoRoot: tmpRoot };
  const logger = createLogger(logCfg, { quiet: true });
  await logger.log({ status: 'success', topicId: 't1', slug: 'a-b', words: 1200, attempts: 1 });
  await logger.log({ level: 'error', status: 'generate-failed', topicId: 't2', error: '炸了' });

  const all = await logger.history();
  assert(all.length === 2, '日志写了 2 条');
  assert(all[0].status === 'success' && all[1].status === 'generate-failed', '成功与失败都能记录');
  assert(all[1].error === '炸了', '失败原因被记录');
  assert(all[0].date === today(), '按北京时间归档日期');

  // 坏行不能让整个日志读不出来
  const { appendFile } = await import('node:fs/promises');
  await appendFile(logger.file, '{坏行\n', 'utf8');
  const after = await logger.history();
  assert(after.length === 2, '日志里的坏行被跳过，不影响读取');
}

/* ─── 7. 端到端演练（mock 生成 + dir 目标）──────────────────────── */
section('端到端演练（离线）');
{
  const tmpCfgPath = path.join(tmpRoot, 'config.json');
  const base = JSON.parse(await readFile(path.join(ROOT, 'config/article-bot.json'), 'utf8'));
  base.publish = { target: 'dir', dir: { path: '.tmp-bot-test/out' } };
  base.logging = { dir: '.tmp-bot-test/logs', file: 'article-bot.jsonl', maxEntries: 500 };
  base.retry = { attempts: 2, backoffMs: [10, 10] };
  await writeFile(tmpCfgPath, JSON.stringify(base, null, 2), 'utf8');

  const env = { ...process.env, LLM_PROVIDER: 'mock' };
  const r = spawnSync(
    process.execPath,
    ['scripts/bot/run.mjs', '--dry-run', '--no-build', `--config=${path.relative(ROOT, tmpCfgPath).replace(/\\/g, '/')}`],
    { cwd: ROOT, env, encoding: 'utf8' }
  );
  const out = String(r.stdout || '') + String(r.stderr || '');
  assert(r.status === 0, `全流程演练退出码 0（实际 ${r.status}）`);
  if (r.status !== 0) console.log(out.slice(-800));
  assert(/演练完成|未推送/.test(out), '输出明确标记了 dry-run');

  try {
    const files = (await (await import('node:fs/promises')).readdir(path.join(tmpRoot, 'out')));
    assert(files.length === 1 && files[0].endsWith('.md'), `产出 1 篇 md（${files[0]}）`);
    const md = await readFile(path.join(tmpRoot, 'out', files[0]), 'utf8');
    const { meta, body } = parseFrontmatter(md);
    assert(!!meta.slug && !!meta.date && !!meta.keyword, '产出文件的 frontmatter 完整');
    const words = plainText(body).replace(/\s/g, '').length;
    assert(words >= cfg.article.minWords && words <= cfg.article.maxWords, `产出正文字数合规（${words}）`);
  } catch (e) {
    bad(`产出检查失败：${e.message}`);
  }
}

await rm(tmpRoot, { recursive: true, force: true });

console.log(`\n[bot-test] 通过 ${pass} 项`);
if (fails.length) {
  console.log(`[bot-test] 失败 ${fails.length} 项：`);
  for (const f of fails) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('[bot-test] 全部通过 ✓');
