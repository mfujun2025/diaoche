// 发布器：把写好的 md 送到目标。
//
// 三种目标：
//   git  —— 提交到 GitHub 仓库里的 src/articles/（默认）。
//           ★ 只提交这一个文件（Git Data API 精确 tree），不会顺手把本机其他改动带上。
//           推送后现有 CI 会自动 build + deploy，文章第二天上午就在线上了。
//   http —— POST 到任意接口（CMS / 自建 API）。地址与 token 全部走环境变量。
//   dir  —— 只落盘，便于本地调试。

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { publishSecret } from './config.mjs';

export function createPublisher(cfg) {
  const target = cfg.publish.target;
  if (target === 'git') return { target, publish: publishGit(cfg) };
  if (target === 'http') return { target, publish: publishHttp(cfg) };
  if (target === 'dir') return { target, publish: publishDir(cfg) };
  throw new Error(`不支持的发布目标：${target}（可选 git / http / dir）`);
}

/* ───────────── git ───────────── */

function publishGit(cfg) {
  return async function ({ markdown, slug, date, dryRun }) {
    const g = cfg.publish.git || {};
    const repo = process.env[g.repoEnv || 'GITHUB_REPOSITORY'] || g.repoDefault;
    const branch = process.env[g.branchEnv || 'ARTICLE_BOT_BRANCH'] || g.branchDefault || 'main';
    const dir = g.dir || 'src/articles';
    const relPath = `${dir}/${slug}.md`;

    if (!repo) throw new Error('缺少仓库名（环境变量 GITHUB_REPOSITORY 或配置的 repoDefault）');

    // 1) 本地也写一份：本机调试用得上，也能被 build 直接读到
    const abs = path.join(cfg.repoRoot, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, markdown, 'utf8');

    if (dryRun) return { ok: true, dryRun: true, localPath: relPath, note: '仅写入本地，未提交' };

    const { token } = publishSecret(cfg);
    const api = await gitApi(cfg, token, repo);

    // 2) 远端是否存在同名文件 → 防重守卫（日志丢了也不至于覆盖）
    try {
      const existing = await api(`/contents/${relPath}?ref=${branch}`);
      if (existing && existing.sha) {
        return { ok: false, error: `远端已存在同名文件 ${relPath} —— 拒绝覆盖，请换 slug 重跑` };
      }
    } catch (e) {
      if (!String(e.message).includes('404')) throw e;
    }

    // 3) blob
    const blob = await api(`/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: markdown, encoding: 'utf-8' }),
    });

    // 4) 取远端分支当前树
    let baseTree = null;
    let parent = null;
    try {
      const ref = await api(`/git/refs/heads/${branch}`);
      const sha = Array.isArray(ref) ? ref[0]?.object?.sha : ref?.object?.sha;
      if (sha) {
        const c = await api(`/git/commits/${sha}`);
        baseTree = c?.tree?.sha || null;
        parent = sha;
      }
    } catch (e) {
      if (!String(e.message).includes('404')) throw e;
      throw new Error(`读取远端分支 ${branch} 失败：${e.message}`);
    }

    // 5) tree（base_tree 增量 —— 只动这一个文件）
    const tree = await api(`/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [{ path: relPath, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });

    // 6) commit
    const msg = `${g.commitMessagePrefix || '每日文章'}（${date}）：${slug}`;
    const commit = await api(`/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: msg,
        tree: tree.sha,
        parents: parent ? [parent] : [],
      }),
    });

    // 7) 移动分支指针
    await api(`/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });

    return {
      ok: true,
      localPath: relPath,
      remotePath: relPath,
      commit: commit.sha,
      url: `https://github.com/${repo}/commit/${commit.sha}`,
      branch,
    };
  };
}

async function gitApi(cfg, token, repo) {
  if (!token) throw new Error(`缺少 GitHub 写入凭据：${cfg.publish.git?.tokenEnv || 'ARTICLE_BOT_GH_TOKEN'}`);
  const base = 'https://api.github.com/repos/' + repo;

  return async function (url, init = {}) {
    const r = await fetch(base + url, {
      ...init,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'diaoche-article-bot',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const text = await r.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!r.ok) {
      throw new Error(`${init.method || 'GET'} ${url} -> ${r.status} ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  };
}

/* ───────────── http ───────────── */

function publishHttp(cfg) {
  return async function ({ article, markdown, date, dryRun }) {
    const h = cfg.publish.http || {};
    const url = process.env[h.urlEnv || 'ARTICLE_API_URL'] || h.urlDefault;
    const { token } = publishSecret(cfg);
    if (!url) throw new Error(`缺少接口地址：${h.urlEnv || 'ARTICLE_API_URL'}`);
    if (!token) throw new Error(`缺少接口鉴权：${h.tokenEnv || 'ARTICLE_API_TOKEN'}`);

    const payload = {
      title: `${article.title} | 吊车.cn`,
      slug: article.slug,
      description: article.description,
      keyword: article.keyword,
      date,
      content: markdown,
    };

    if (dryRun) return { ok: true, dryRun: true, note: `将 POST 到 ${url}`, payloadSize: JSON.stringify(payload).length };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), h.timeoutMs || 30000);
    try {
      const r = await fetch(url, {
        method: h.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      });
      const text = await r.text();
      if (!r.ok) return { ok: false, error: `接口返回 ${r.status}：${text.slice(0, 300)}` };
      return { ok: true, remotePath: url, response: text.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/* ───────────── dir ───────────── */

function publishDir(cfg) {
  return async function ({ markdown, slug }) {
    const dir = path.join(cfg.repoRoot, cfg.publish.dir?.path || 'out/articles');
    await mkdir(dir, { recursive: true });
    const abs = path.join(dir, `${slug}.md`);
    await writeFile(abs, markdown, 'utf8');
    return { ok: true, localPath: abs };
  };
}
