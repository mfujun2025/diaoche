// 配置加载：集中读取 config/article-bot.json，敏感值一律从环境变量取。
//
// 三条约定：
//   1. 配置文件里不出现任何密钥、webhook、PAT —— 只能出现「环境变量名」
//   2. xxxEnv + xxxDefault 成对出现：先读环境变量，没有就用默认值
//   3. 缺必填项就抛错退出，不给「默认值兜底」的机会 ——
//      静默用一个错地址跑起来，比直接报错难查得多

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CONFIG_PATH = 'config/article-bot.json';

/**
 * 本地密钥兜底：config/local.secrets.json（已在 .gitignore，绝不进仓库）。
 * 存在的意义是让定时任务无需在命令行里带 PAT —— 命令行参数会出现在
 * 进程列表和 shell 历史里。优先级仍是：环境变量 > 本地文件。
 */
let FILE_SECRETS = null;
const SECRETS_FILE = 'config/local.secrets.json';

async function loadFileSecrets(repoRoot) {
  if (FILE_SECRETS) return FILE_SECRETS;
  FILE_SECRETS = {};
  try {
    const raw = await readFile(path.join(repoRoot, SECRETS_FILE), 'utf8');
    const j = JSON.parse(raw);
    if (j && typeof j === 'object') FILE_SECRETS = j;
  } catch {
    // 没有这个文件是正常的（CI 走 Secrets），不报错
  }
  return FILE_SECRETS;
}

/** 读环境变量占位。`${ENV}` 形式也支持，方便配置里直接写死变量名。 */
function env(name) {
  return process.env[name] ?? FILE_SECRETS?.[name] ?? '';
}

function resolve(cfgObj, override) {
  if (!cfgObj) return '';
  // 直接给了值就用（覆盖优先）
  if (override) return override;
  const fromEnv = cfgObj.env ? env(cfgObj.env) : '';
  return fromEnv || cfgObj.default || '';
}

export async function loadConfig(configPath = process.env.ARTICLE_BOT_CONFIG || DEFAULT_CONFIG_PATH, repoRoot = process.cwd()) {
  await loadFileSecrets(repoRoot);
  const abs = path.isAbsolute(configPath) ? configPath : path.join(repoRoot, configPath);
  let raw;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new Error(
      `找不到配置文件：${configPath}\n  把 ${DEFAULT_CONFIG_PATH.replace('.json', '.example.json')} 复制一份改改即可`
    );
  }

  let file;
  try {
    file = JSON.parse(raw);
  } catch (e) {
    throw new Error(`配置文件不是合法 JSON：${configPath} —— ${e.message}`);
  }

  const cfg = {
    path: abs,
    repoRoot,
    schedule: file.schedule || { cron: '0 1 * * *', enabled: true },
    article: {
      minWords: 1000,
      maxWords: 1500,
      descriptionWords: [50, 80],
      h2Range: [3, 5],
      internalLinks: [3, 4],
      brandSuffix: '| 吊车.cn',
      keywordDensity: { min: 0.8, max: 2.8 },
      titleMaxChars: 30,
      ...(file.article || {}),
    },
    retry: { attempts: 3, backoffMs: [3000, 10000, 25000], ...(file.retry || {}) },
    dedupe: { maxTitleSimilarity: 0.62, maxKeywordSimilarity: 0.8, ...(file.dedupe || {}) },
    alert: { webhookEnv: 'ARTICLE_BOT_WEBHOOK', onFailureOnly: true, timeoutMs: 15000, ...(file.alert || {}) },
    logging: { dir: 'logs', file: 'article-bot.jsonl', maxEntries: 500, ...(file.logging || {}) },
    bannedPhrases: file.bannedPhrases || [],
    topics: file.topics || [],
    publish: file.publish || { target: 'dir' },
    llm: {
      // 环境变量优先于配置文件 —— 临时切 mock 自测时用 LLM_PROVIDER=mock 就行
      provider: process.env.LLM_PROVIDER || file.llm?.provider || 'openai-compatible',
      temperature: file.llm?.temperature ?? 0.7,
      maxTokens: file.llm?.maxTokens ?? 4096,
      timeoutMs: file.llm?.timeoutMs ?? 180000,
      baseUrl: '',
      apiKey: '',
      model: '',
    },
  };

  // LLM 三个参数：环境变量优先于 default
  const L = file.llm || {};
  cfg.llm.baseUrl = env(L.baseUrlEnv || 'LLM_BASE_URL') || L.baseUrlDefault || 'https://api.deepseek.com/v1';
  cfg.llm.apiKey = env(L.apiKeyEnv || 'LLM_API_KEY');
  cfg.llm.model = env(L.modelEnv || 'LLM_MODEL') || L.modelDefault || 'deepseek-chat';

  // 主题池必须非空，否则每天生成的东西无的放矢
  if (!cfg.topics.length) throw new Error('配置里 topics 是空的 —— 没有选题池就没法定主题');

  return cfg;
}

/** 发布目标所需的 token。按 publish.target 解析，返回 { token, tokenSource } */
export function publishSecret(cfg) {
  const t = cfg.publish.target;
  if (t === 'git') {
    const name = cfg.publish.git?.tokenEnv || 'ARTICLE_BOT_GH_TOKEN';
    // Actions 内置 token 也能用，作为兼容的第二来源
    return { token: env(name) || env('GITHUB_TOKEN'), tokenSource: name };
  }
  if (t === 'http') {
    const name = cfg.publish.http?.tokenEnv || 'ARTICLE_API_TOKEN';
    return { token: env(name), tokenSource: name };
  }
  return { token: '', tokenSource: '' };
}

/** 运行时前置检查：缺东西就报清楚，别等到跑了一半才失败。 */
export function assertReady(cfg, { allowMock = true, dryRun = false, skipLlm = false } = {}) {
  const missing = [];

  // skipLlm：人工投稿（--from-file）不调模型，不需要密钥
  if (skipLlm) {
    // pass
  } else if (cfg.llm.provider === 'mock') {
    if (!allowMock) missing.push('LLM_PROVIDER=mock 不允许在正式运行里使用');
  } else if (!cfg.llm.apiKey) {
    missing.push(`${cfg.llm.apiKeyEnv || 'LLM_API_KEY'}（大模型密钥）`);
  } else if (!cfg.llm.baseUrl) {
    missing.push('llm.baseUrlEnv（接口地址）');
  }

  // dry-run 不推推送到任何远端，凭据此时不必备齐
  if (!dryRun) {
    const { token, tokenSource } = publishSecret(cfg);
    if (cfg.publish.target === 'git' && !token) missing.push(`${tokenSource}（GitHub 写入凭据）`);
    if (cfg.publish.target === 'http') {
      if (!token) missing.push(`${tokenSource}（接口鉴权）`);
      if (!process.env[cfg.publish.http?.urlEnv || 'ARTICLE_API_URL'] && !cfg.publish.http?.urlDefault) {
        missing.push(`${cfg.publish.http?.urlEnv || 'ARTICLE_API_URL'}（接口地址）`);
      }
    }
  }

  if (missing.length) {
    throw new Error(
      `缺少必需配置/环境变量：\n  - ${missing.join('\n  - ')}\n\n` +
        `填法：本机临时用 export / PowerShell $env: 设置；长期运行请填到 GitHub Actions 的 Secrets。`
    );
  }
  return true;
}

export { resolve, env };
