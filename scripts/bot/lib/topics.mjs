// 选题管理：历史读取 → 去重 → 挑今天该写哪个。
//
// ★ 去重不依赖单独的「状态文件」—— 状态文件最容易丢（改机器、删目录、CI 全新容器），
//   一丢就会把发过的题重发一遍。这里的两个真实来源：
//     1. 仓库里已存在的 src/articles/*.md（文章本体，永远和站点一致）
//     2. logs/article-bot.jsonl（执行历史，按 topicId 记）
//   两者任一命中就算「已写过」。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, plainText } from '../../lib/md.mjs';

/**
 * 标题相似度：字级 2-gram 的**覆盖率** —— 交集 ÷ 较短一方。
 *
 * ★ 为什么不用 Jaccard（交集÷并集）：
 *   标题长短差很多时 Jaccard 会被稀释。「25 吨二手吊车怎么选」和
 *   「25 吨还是 35 吨？二手汽车吊选型的关键取舍」明显是同一个选题，
 *   Jaccard 只有 0.20，覆盖率 0.9 —— 后者才符合直觉。
 *   去重要的是「宁可不发，也不能重发」，覆盖率更贴合这个偏保守的目标。
 */
export function similarity(a, b) {
  const grams = (s) => {
    const clean = String(s || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
    const set = new Set();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    if (!set.size && clean) set.add(clean);
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** 读仓库里已有文章：标题、关键词、slug、正文字数 */
export async function readExisting(cfg) {
  const dir = path.join(cfg.repoRoot, cfg.publish.git?.dir || 'src/articles');
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const out = [];
  for (const f of files) {
    const raw = await readFile(path.join(dir, f), 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    out.push({
      file: f,
      title: String(meta.title || '').replace(/\s*\|\s*吊车\.cn\s*$/, ''),
      keyword: String(meta.keyword || ''),
      slug: String(meta.slug || f.replace(/\.md$/, '')),
      date: String(meta.date || ''),
      words: plainText(body).replace(/\s/g, '').length,
    });
  }
  return out;
}

/**
 * 挑今天的选题。
 * 策略：类别轮转（用得最少的类别优先）+ 配置顺序（相同次数时按配置里的先后顺序）。
 * 确定性 —— 同样的仓库状态永远得到同一个结果，便于排查。
 */
export function pickTopic(cfg, existing, logHistory) {
  const usedIds = new Set(
    logHistory.filter((r) => r.status === 'success' && r.topicId).map((r) => r.topicId)
  );
  const existingTitles = existing.map((e) => e.title);
  const existingKeywords = existing.map((e) => e.keyword).filter(Boolean);
  const existingSlugs = new Set(existing.map((e) => e.slug));

  // 该类别历史上成功写过几篇 → 优先补冷门类别
  const catCount = {};
  for (const id of usedIds) {
    const t = cfg.topics.find((x) => x.id === id);
    if (t) catCount[t.category] = (catCount[t.category] || 0) + 1;
  }

  const rejected = [];
  const candidates = [];
  for (const t of cfg.topics) {
    if (usedIds.has(t.id)) continue;

    // 标题层面去重：和历史文章像，说明换汤不换药
    const dup = existingTitles.find((x) => similarity(x, t.title) >= cfg.dedupe.maxTitleSimilarity);
    if (dup) {
      rejected.push(`${t.id}（与已发布《${dup}》相似）`);
      continue;
    }
    const dupKw = existingKeywords.find((x) => similarity(x, t.keyword) >= cfg.dedupe.maxKeywordSimilarity);
    if (dupKw) {
      rejected.push(`${t.id}（关键词与已发布「${dupKw}」相近）`);
      continue;
    }
    candidates.push(t);
  }

  if (!candidates.length) {
    return { topic: null, rejected, note: '选题池已全部用过，请往 config 的 topics 里补充新题目' };
  }

  candidates.sort((a, b) => {
    const ca = catCount[a.category] || 0;
    const cb = catCount[b.category] || 0;
    if (ca !== cb) return ca - cb; // 类别轮转：写得少的类别优先
    return cfg.topics.indexOf(a) - cfg.topics.indexOf(b);
  });

  const topic = candidates[0];
  // slug 撞车时加序号，宁丑不重复
  let slugBase = topic.id;
  let n = 2;
  while (existingSlugs.has(slugBase)) slugBase = `${topic.id}-${n++}`;

  return { topic, slugBase, rejected, historyTitles: existingTitles };
}
