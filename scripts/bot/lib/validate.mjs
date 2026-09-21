// 发布前内容校验。
//
// 定位：**宁可不发，也不能发出一篇坏的**。
// 每一条规则都对应一个真会出事的坑，注释里写明「为什么查这条」。

import { renderMarkdown, plainText } from '../../lib/md.mjs';

/**
 * @param article {title,description,slug,keyword,body}
 * @param ctx { existing: [{slug,title}], today }
 */
export function validateArticle(article, cfg, ctx = { existing: [] }) {
  const a = cfg.article;
  const errors = [];
  const warnings = [];
  const body = String(article.body || '');

  // ── 1. frontmatter 字段 ────────────────────────────────────────
  for (const [k, v] of [
    ['title', article.title],
    ['description', article.description],
    ['slug', article.slug],
    ['keyword', article.keyword],
  ]) {
    if (!String(v || '').trim()) errors.push(`frontmatter 缺字段：${k}`);
  }

  // title
  const title = String(article.title || '');
  if (title.length > a.titleMaxChars) errors.push(`title ${title.length} 字，超过上限 ${a.titleMaxChars}`);
  // ★ renderFrontmatter 用「第一个英文冒号」切字段，标题里出现英文冒号会被截断
  if (title.includes(':')) errors.push('title 含英文冒号 —— frontmatter 解析会被截断，请改用中文冒号');
  if (String(article.description || '').includes(':')) {
    errors.push('description 含英文冒号 —— frontmatter 解析会被截断');
  }

  // slug：静态站在 Pages 的资源层，中文 slug 会踩 punycode / 404 的坑
  const slug = String(article.slug || '');
  if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    errors.push(`slug 不合 ASCII 短横线规范：${slug}`);
  }
  if (slug.length > 40) errors.push(`slug 超过 40 字符：${slug}`);
  if (ctx.existing?.some((e) => e.slug === slug)) {
    errors.push(`slug 与已发布文章重复：${slug}`);
  }

  // description 字数
  const descLen = plainText(String(article.description || '')).replace(/\s/g, '').length;
  if (descLen < a.descriptionWords[0] || descLen > a.descriptionWords[1]) {
    warnings.push(`description ${descLen} 字，建议 ${a.descriptionWords[0]}~${a.descriptionWords[1]}`);
  }

  // ── 2. 字数 ────────────────────────────────────────────────────
  const words = plainText(body).replace(/\s/g, '').length;
  if (words < a.minWords) errors.push(`正文 ${words} 字，低于下限 ${a.minWords}`);
  if (words > a.maxWords) errors.push(`正文 ${words} 字，超过上限 ${a.maxWords}`);

  // ── 3. 结构 ────────────────────────────────────────────────────
  const lines = body.split('\n');
  const h2 = lines.filter((l) => /^##\s+/.test(l.trim()));
  if (h2.length < a.h2Range[0] || h2.length > a.h2Range[1]) {
    errors.push(`小标题 ${h2.length} 个，要求 ${a.h2Range[0]}~${a.h2Range[1]} 个`);
  }

  // 开篇：第一个 ## 之前必须有段落（否则页面一上来就是小标题）
  const firstH2 = body.indexOf('## ');
  const lead = (firstH2 < 0 ? body : body.slice(0, firstH2)).trim();
  const leadLen = plainText(lead).replace(/\s/g, '').length;
  if (leadLen < 60) errors.push(`开篇只有 ${leadLen} 字，要求前置结论段（≥60 字）`);

  // 结尾引用
  if (!/^>\s?\S/m.test(body)) warnings.push('结尾缺少 > 引用（免责 + 引导）');

  // ── 4. 内链 ────────────────────────────────────────────────────
  const links = [...body.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)];
  const internal = links.filter((m) => m[2].startsWith('/'));
  if (links.length !== internal.length) {
    errors.push(`有 ${links.length - internal.length} 个非站内链接 —— 站点文章一律只链站内`);
  }
  if (internal.length < a.internalLinks[0] || internal.length > a.internalLinks[1]) {
    errors.push(`内链 ${internal.length} 个，要求 ${a.internalLinks[0]}~${a.internalLinks[1]} 个`);
  }

  // ── 5. 渲染器不支持的语法（写超了会原样输出，页面上火星文） ────
  const unsupported = [
    [/\n\s*\|.*\|/g, '表格'],
    [/!\[/g, '图片'],
    [/```/g, '代码块'],
    [/`[^`\n]+`/g, '行内代码'],
    [/<[a-zA-Z/][^>]*>/g, 'HTML 标签'],
    // ★ 用 [ \t] 而不是 \s —— \s 含换行，多行模式下会把「上一行空行 + 本行 -」误判成嵌套列表
    [/^[ \t]+[-*]\s+/m, '缩进嵌套列表'],
    [/^[ \t]+\d+\.\s+/m, '缩进嵌套列表'],
  ];
  for (const [re, name] of unsupported) {
    re.lastIndex = 0;
    if (re.test(body)) errors.push(`正文含渲染器不支持的语法：${name}`);
  }

  // ── 6. AI 味套话 ───────────────────────────────────────────────
  for (const bad of cfg.bannedPhrases || []) {
    if (bad && body.includes(bad)) errors.push(`命中套话黑名单：${bad}`);
  }

  // ── 7. 关键词比例 ──────────────────────────────────────────────
  const core = a.coreWord || '吊车';
  const text = plainText(body);
  const coreHits = (text.match(new RegExp(core, 'g')) || []).length;
  const density = words ? ((coreHits * core.length) / words) * 100 : 0;
  if (density < a.keywordDensity.min) {
    errors.push(`「${core}」密度 ${density.toFixed(2)}%，低于 ${a.keywordDensity.min}%`);
  } else if (density > a.keywordDensity.max) {
    errors.push(`「${core}」密度 ${density.toFixed(2)}%，高于 ${a.keywordDensity.max}%（堆砌）`);
  }

  const kw = String(article.keyword || '');
  const kwHits = kw ? (text.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
  if (kw && kwHits === 0) errors.push(`正文未出现主关键词「${kw}」`);
  if (kwHits > 5) errors.push(`主关键词出现 ${kwHits} 次，疑似堆砌`);

  // ── 8. 红线：不许编造成交价 / 成交案例 ─────────────────────────
  // 「区间参考 14~42 万」允许；「上周成交一台 28.5 万」禁止
  const fabricated = [
    [/成交[^。\n]{0,12}\d+(\.\d+)?\s*万/g, '编造具体成交价'],
    [/(上周|上月|昨日|昨天|前天)[^。\n]{0,10}(卖了|成交|收购|买走)/g, '虚构成交案例'],
  ];
  for (const [re, name] of fabricated) {
    if (re.test(body)) errors.push(`红线违规：${name}`);
  }

  // ── 9. 渲染一遍，确认没留下未解析的 markdown 残留 ───────────────
  const html = renderMarkdown(body);
  for (const residue of ['**', '|', '```']) {
    if (html.includes(residue)) errors.push(`渲染后仍残留 markdown 符号：${residue}`);
  }
  if (html.includes('<h1')) errors.push('正文出现 H1 —— 页面 H1 由模板给，两个 H1 是 SEO 硬伤');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: { words, h2: h2.length, links: internal.length, coreDensity: Number(density.toFixed(2)), kwHits },
  };
}

/** 拼 .md 全文。注意：值里不能有英文冒号（解析会被截断），这里再兜一层过滤。 */
export function toMarkdown(article, date) {
  const clean = (s) => String(s ?? '').replace(/[\r\n:]/g, ' ').replace(/\s+/g, ' ').trim();
  const title = `${clean(article.title)} | 吊车.cn`;
  return `---
title: ${title}
description: ${clean(article.description)}
slug: ${clean(article.slug)}
date: ${date}
keyword: ${clean(article.keyword)}
---

${String(article.body).trim()}
`;
}
