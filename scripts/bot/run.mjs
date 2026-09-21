#!/usr/bin/env node
// 每日文章机器人：选题 → 生成 → 校验 → 构建验证 → 发布 → 记日志。
//
// 用法：
//   node scripts/bot/run.mjs                      # 正常跑一篇并发到目标
//   node scripts/bot/run.mjs --dry-run            # 全流程但不推送（只写本地 + 校验）
//   LLM_PROVIDER=mock node scripts/bot/run.mjs --dry-run   # 离线自测，不花 token
//   node scripts/bot/run.mjs --list-topics        # 看还剩哪些选题
//   node scripts/bot/run.mjs --topic=select-25-vs-35 --force
//
// 退出码：0 成功 / 1 业务失败（生成或发布） / 2 配置或使用方式错误

import { unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseFrontmatter } from '../lib/md.mjs';

import { loadConfig, assertReady } from './lib/config.mjs';
import { createLogger, today } from './lib/logger.mjs';
import { setupProxy } from './lib/net.mjs';
import { createGenerator } from './lib/llm.mjs';
import { readExisting, pickTopic } from './lib/topics.mjs';
import { validateArticle, toMarkdown } from './lib/validate.mjs';
import { createPublisher } from './lib/publish.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || '';

const DRY_RUN = flag('dry-run');
const NO_BUILD = flag('no-build');
const FORCE = flag('force');
const WANT_TOPIC = opt('topic');
const FROM_FILE = opt('from-file');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const proxy = await setupProxy();
  const cfg = await loadConfig(opt('config') || undefined);

  if (flag('list-topics')) {
    const existing = await readExisting(cfg);
    const logger = createLogger(cfg, { quiet: true });
    const { rejected } = pickTopic(cfg, existing, await logger.history());
    console.log(`已发布 ${existing.length} 篇，选题池 ${cfg.topics.length} 个`);
    for (const e of existing) console.log(`  - ${e.slug}  ${e.title}`);
    console.log(`\n已剔除 ${rejected.length} 个重复/相似的题：`);
    for (const r of rejected) console.log(`  × ${r}`);
    return 0;
  }

  if (!cfg.schedule.enabled) {
    console.log('[bot] schedule.enabled=false，跳过本次运行');
    return 0;
  }

  // --from-file：人工撰写的稿件，跳过 LLM，但照旧走校验 / 构建 / 发布 / 记日志
  if (FROM_FILE) return publishManuscript(cfg, FROM_FILE);

  // 正式运行不许用 mock —— mock 文章发上线是事故
  assertReady(cfg, { allowMock: DRY_RUN, dryRun: DRY_RUN });
  if (cfg.llm.provider === 'mock' && !DRY_RUN) {
    throw new Error('LLM_PROVIDER=mock 只能配合 --dry-run 自测使用');
  }

  const logger = createLogger(cfg);
  if (proxy) console.log(`[bot] 使用代理 ${proxy}`);
  console.log(`[bot] 配置 ${path.relative(cfg.repoRoot, cfg.path)}  目标=${cfg.publish.target}  provider=${cfg.llm.provider}${DRY_RUN ? '  (dry-run)' : ''}`);

  const t0 = Date.now();
  const existing = await readExisting(cfg);
  const history = await logger.history();
  const { topic, slugBase, note } = await pickOne(cfg, existing, history);

  if (!topic) {
    await logger.log({ level: 'error', status: 'no-topic', error: note || '无可用选题' });
    await logger.alert('没有可用选题', note || '请往 config/article-bot.json 的 topics 里补充新题目');
    console.error(`[bot] ✗ ${note}`);
    return 1;
  }

  console.log(`[bot] 选题：${topic.id}（${topic.category}）${topic.title}`);

  const generator = createGenerator(cfg);
  const historyTitles = [...existing.map((e) => e.title), ...history.filter((r) => r.title).map((r) => r.title)];

  let article = null;
  let lastErrors = [];
  let attempts = 0;

  for (let i = 0; i < cfg.retry.attempts; i++) {
    attempts = i + 1;
    try {
      const draft = await generator.generate(topic, historyTitles.slice(-30));
      // slug 由我们按 topic.id 统一定，避免模型自由发挥撞车
      draft.slug = slugBase;
      const result = validateArticle(draft, cfg, { existing });
      console.log(
        `[bot] 第 ${attempts} 次生成：${result.metrics.words} 字 / H2 ${result.metrics.h2} 个 / 内链 ${result.metrics.links} 个 / 核心词密度 ${result.metrics.coreDensity}%`
      );
      if (result.ok) {
        article = draft;
        break;
      }
      lastErrors = result.errors;
      console.warn(`[bot] 校验未通过（${result.errors.length} 项）：`);
      for (const e of result.errors.slice(0, 6)) console.warn(`      - ${e}`);
    } catch (e) {
      lastErrors = [e.message];
      console.warn(`[bot] 第 ${attempts} 次调用失败：${e.message}`);
    }

    const wait = cfg.retry.backoffMs[Math.min(i, cfg.retry.backoffMs.length - 1)];
    if (i < cfg.retry.attempts - 1) {
      console.log(`[bot] ${wait}ms 后重试…`);
      await sleep(wait);
    }
  }

  if (!article) {
    const detail = lastErrors.slice(0, 6).join('；');
    await logger.log({ level: 'error', status: 'generate-failed', topicId: topic.id, title: topic.title, attempts, durationMs: Date.now() - t0, error: detail });
    await logger.alert('生成失败', `选题 ${topic.id}：${detail}`);
    console.error(`[bot] ✗ ${cfg.retry.attempts} 次均未通过校验：${detail}`);
    return 1;
  }

  // ── 写本地 + 构建验证 ──────────────────────────────────────────
  const date = today();
  const markdown = toMarkdown(article, date);

  const publisher = createPublisher(cfg);
  const localAbs = await publisher.writeLocal({ markdown, slug: article.slug, date });
  const relPath = localAbs ? path.relative(cfg.repoRoot, localAbs) : '(远端接口，不落盘)';
  if (localAbs) console.log(`[bot] 已写入 ${relPath}`);

  if (!NO_BUILD && localAbs) {
    try {
      execFileSync(process.execPath, [path.join(cfg.repoRoot, 'scripts', 'build.mjs')], {
        cwd: cfg.repoRoot,
        stdio: 'pipe',
      }).toString();
      console.log('[bot] 构建验证通过（新文章能被正常渲染）');
    } catch (e) {
      const msg = String(e.stderr || e.message).slice(0, 300);
      await unlink(localAbs).catch(() => {});
      await logger.log({ level: 'error', status: 'build-failed', topicId: topic.id, title: article.title, slug: article.slug, attempts, durationMs: Date.now() - t0, error: msg });
      await logger.alert('构建失败（已撤回草稿）', `${relPath}：${msg}`);
      console.error(`[bot] ✗ 构建失败，已删除草稿 ${relPath}\n${msg}`);
      return 1;
    }
  }

  // ── 发布 ──────────────────────────────────────────────────────
  let pub;
  try {
    pub = await publisher.publish({ article, markdown, slug: article.slug, date, dryRun: DRY_RUN, force: FORCE });
  } catch (e) {
    pub = { ok: false, error: e.message };
  }

  const durationMs = Date.now() - t0;

  if (!pub.ok) {
    await logger.log({ level: 'error', status: 'publish-failed', topicId: topic.id, title: article.title, slug: article.slug, attempts, durationMs, error: pub.error || '未知', dryRun: DRY_RUN });
    await logger.alert('发布失败', `${article.slug}：${pub.error || '未知原因'}`);
    console.error(`[bot] ✗ 发布失败：${pub.error}`);
    console.error('      草稿已留在本地，修好后可直接手动推送，不会重复生成');
    return 1;
  }

  await logger.log({
    level: 'info',
    status: DRY_RUN ? 'dry-run' : 'success',
    topicId: topic.id,
    title: article.title,
    slug: article.slug,
    words: validateArticle(article, cfg, { existing }).metrics.words,
    attempts,
    durationMs,
    dryRun: DRY_RUN,
  });
  await logger.trim();

  console.log(`[bot] ✓ ${DRY_RUN ? '演练完成（未推送）' : '已发布'}  ${pub.url || pub.remotePath || pub.localPath || ''}`);
  if (!DRY_RUN && cfg.publish.target === 'git') {
    console.log('      已提交到仓库，CI 会在几分钟内自动构建并部署到线上');
  }
  return 0;
}

/**
 * 人工投稿：--from-file <md> 走完整管线，只是不调模型。
 * 用途：模型还没配好时的过渡、或人工改过的稿子想走同一条校验/发布链路。
 */
async function publishManuscript(cfg, file) {
  const abs = path.resolve(cfg.repoRoot, file);
  const raw = await readFile(abs, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const article = {
    title: String(meta.title || '').replace(/\s*\|\s*吊车\.cn\s*$/, '').trim(),
    description: String(meta.description || '').trim(),
    slug: String(meta.slug || path.basename(file, '.md')).trim(),
    keyword: String(meta.keyword || '').trim(),
    body: String(body || '').trim(),
  };

  assertReady(cfg, { skipLlm: true, dryRun: DRY_RUN });
  const logger = createLogger(cfg);
  // 稿件往往已经落在文章目录里（写完再跑这条命令），
  // 得把它自己从「已发布」里摘掉，否则永远判成 slug 重复
  const self = path.basename(file);
  const existing = (await readExisting(cfg)).filter((e) => e.file !== self);
  const t0 = Date.now();

  console.log(`[bot] 人工投稿 ${path.relative(cfg.repoRoot, abs)}  目标=${cfg.publish.target}${DRY_RUN ? '  (dry-run)' : ''}`);

  const result = validateArticle(article, cfg, { existing });
  console.log(
    `[bot] 校验：${result.metrics.words} 字 / H2 ${result.metrics.h2} 个 / 内链 ${result.metrics.links} 个 / 核心词密度 ${result.metrics.coreDensity}%`
  );
  for (const w of result.warnings) console.warn(`      ! ${w}`);
  if (!result.ok) {
    for (const e of result.errors) console.error(`      - ${e}`);
    await logger.log({ level: 'error', status: 'validate-failed', slug: article.slug, title: article.title, error: result.errors.slice(0, 6).join('；') });
    await logger.alert('人工稿件未通过校验', `${article.slug}：${result.errors.slice(0, 3).join('；')}`);
    return 1;
  }

  const date = String(meta.date || today());
  const markdown = toMarkdown(article, date);
  const publisher = createPublisher(cfg);
  const localAbs = await publisher.writeLocal({ markdown, slug: article.slug, date });
  if (localAbs) console.log(`[bot] 已写入 ${path.relative(cfg.repoRoot, localAbs)}`);

  if (!NO_BUILD && localAbs) {
    try {
      execFileSync(process.execPath, [path.join(cfg.repoRoot, 'scripts', 'build.mjs')], { cwd: cfg.repoRoot, stdio: 'pipe' }).toString();
      console.log('[bot] 构建验证通过');
    } catch (e) {
      const msg = String(e.stderr || e.message).slice(0, 300);
      await unlink(localAbs).catch(() => {});
      await logger.log({ level: 'error', status: 'build-failed', slug: article.slug, title: article.title, error: msg });
      await logger.alert('构建失败（已撤回草稿）', `${article.slug}：${msg}`);
      console.error(`[bot] ✗ 构建失败，已删除草稿\n${msg}`);
      return 1;
    }
  }

  let pub;
  try {
    pub = await publisher.publish({ article, markdown, slug: article.slug, date, dryRun: DRY_RUN, force: FORCE });
  } catch (e) {
    pub = { ok: false, error: e.message };
  }
  const durationMs = Date.now() - t0;

  if (!pub.ok) {
    await logger.log({ level: 'error', status: 'publish-failed', slug: article.slug, title: article.title, durationMs, error: pub.error || '未知' });
    await logger.alert('发布失败', `${article.slug}：${pub.error || '未知原因'}`);
    console.error(`[bot] ✗ 发布失败：${pub.error}`);
    return 1;
  }

  await logger.log({
    level: 'info',
    status: DRY_RUN ? 'dry-run' : 'success',
    topicId: 'manual',
    title: article.title,
    slug: article.slug,
    words: result.metrics.words,
    attempts: 1,
    durationMs,
    dryRun: DRY_RUN,
  });
  await logger.trim();
  console.log(`[bot] ✓ ${DRY_RUN ? '演练完成（未推送）' : '已发布'}  ${pub.url || pub.remotePath || pub.localPath || ''}`);
  return 0;
}

async function pickOne(cfg, existing, history) {
  if (WANT_TOPIC) {
    const topic = cfg.topics.find((t) => t.id === WANT_TOPIC);
    if (!topic) throw new Error(`配置里没有 id 为 ${WANT_TOPIC} 的选题`);
    const exists = existing.find((e) => e.slug === topic.id);
    if (exists && !FORCE) throw new Error(`${topic.id} 看起来已发过（${exists.title}）。确认要重写请加 --force`);
    return { topic, slugBase: topic.id };
  }
  return pickTopic(cfg, existing, history);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`\n[bot] 启动失败：${e.message}`);
    process.exit(2);
  });
