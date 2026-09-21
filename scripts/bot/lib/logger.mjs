// 执行日志 + 告警。
//
// 日志用 JSONL（每行一条 JSON）—— 人能直接看，脚本能用 jq 查，
// 追加写不会像 JSON 数组那样因为一条写坏就整个文件报废。

import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function today(d = new Date()) {
  // 站点时区是北京时间，按北京日期归档文件名，不然凌晨跑的文章会记到前一天
  const s = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return s.slice(0, 10);
}

export function createLogger(cfg, { quiet = false } = {}) {
  const dir = path.join(cfg.repoRoot, cfg.logging.dir);
  const file = path.join(dir, cfg.logging.file);
  let ready = false;

  async function ensureDir() {
    if (ready) return;
    await mkdir(dir, { recursive: true });
    ready = true;
  }

  function say(line) {
    if (!quiet) console.log(line);
  }

  /** 写一条日志。level: info | warn | error */
  async function log(entry) {
    await ensureDir();
    const rec = {
      ts: new Date().toISOString(),
      date: today(),
      level: entry.level || 'info',
      status: entry.status || 'unknown',
      topicId: entry.topicId || '',
      title: entry.title || '',
      slug: entry.slug || '',
      words: entry.words || 0,
      target: cfg.publish.target,
      attempts: entry.attempts || 0,
      durationMs: entry.durationMs || 0,
      error: entry.error || '',
      dryRun: entry.dryRun === true,
    };
    await appendFile(file, JSON.stringify(rec) + '\n', 'utf8');

    const tag = rec.level === 'error' ? '✗' : rec.level === 'warn' ? '!' : '✓';
    say(
      `[log] ${tag} ${rec.date} ${rec.status.padEnd(10)} ${rec.slug || rec.topicId} ` +
        `${rec.words ? rec.words + '字' : ''}${rec.error ? ' — ' + rec.error : ''}`
    );
    return rec;
  }

  /** 读全部历史记录（坏行跳过，不因为一条脏数据整个崩） */
  async function history() {
    let raw = '';
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* 忽略坏行 */
      }
    }
    return out;
  }

  /** 日志裁剪：超过 maxEntries 条就只保留最后 N 条 */
  async function trim() {
    const all = await history();
    if (all.length <= cfg.logging.maxEntries) return;
    const kept = all.slice(-cfg.logging.maxEntries);
    await ensureDir();
    await writeFile(file, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }

  /**
   * 告警推送。支持飞书与企业微信机器人 —— 两者的 webhook 都是 POST JSON，
   * 只是字段名不同，这里按「有 msg_type 就按飞书格式，否则按企业微信的 text」兼容。
   */
  async function alert(title, detail) {
    const url = cfg.alert.webhookEnv ? process.env[cfg.alert.webhookEnv] || '' : '';
    if (!url) {
      say(`[alert] 未配置 ${cfg.alert.webhookEnv || 'ARTICLE_BOT_WEBHOOK'}，只写日志不推送`);
      return false;
    }

    const text = `【吊车.cn 每日文章】${title}\n${detail}\n时间：${new Date().toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
    })}`;

    // 企业微信识别 markdown 的 content；飞书识别 text
    const body = {
      msgtype: 'markdown',
      markdown: { content: text },
      msg_type: 'text',
      content: { text },
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.alert.timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const okish = r.status >= 200 && r.status < 300;
      say(`[alert] 推送${okish ? '成功' : '失败'}：${r.status}`);
      return okish;
    } catch (e) {
      say(`[alert] 推送异常：${e.message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  return { log, history, trim, alert, file };
}
