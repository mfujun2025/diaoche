// 查 GitHub Actions 运行状态（走与 gh-push.mjs 相同的代理通道）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN = process.argv[2];
const REPO = process.argv[3] || 'mfujun2025/diaoche';
if (!TOKEN) {
  console.error('用法: node scripts/gh-runs.mjs <TOKEN> [repo]');
  process.exit(1);
}

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';
let dispatcher;
if (PROXY) {
  const { ProxyAgent } = await import('undici');
  dispatcher = new ProxyAgent({ uri: PROXY, requestTls: { rejectUnauthorized: false }, proxyTls: { rejectUnauthorized: false } });
  console.log(`[runs] 使用代理 ${PROXY}`);
}

const url = `https://api.github.com/repos/${REPO}/actions/runs?per_page=5`;
const res = await fetch(url, {
  headers: { Authorization: `token ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'diaoche-ci' },
  ...(dispatcher ? { dispatcher } : {}),
});
console.log(`[runs] HTTP ${res.status}`);
const j = await res.json();
if (!j.workflow_runs) {
  console.log(JSON.stringify(j).slice(0, 400));
  process.exit(1);
}
for (const r of j.workflow_runs) {
  console.log(`${r.status.padEnd(12)} ${String(r.conclusion).padEnd(10)} ${r.head_sha.slice(0, 7)}  ${r.created_at}  ${r.html_url}`);
}
