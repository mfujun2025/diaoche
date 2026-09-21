// 大模型调用层：OpenAI 兼容协议 + 离线 mock。
//
// 为什么抽象一层：
//   - provider 可换（DeepSeek / 通义 / 智谱 / OpenAI 都是同一套 chat completions 协议）
//   - 本机没有密钥时能用 mock 把整条流水线跑通（校验、写文件、发布、日志）
//
// 只负责「按选题产出一篇符合规范的稿子」，不负责校验（校验在 validate.mjs），
// 也不负责重试策略编排（在 run.mjs）。

const MAX_OUTPUT_CHARS = 20000;

export function createGenerator(cfg) {
  if (cfg.llm.provider === 'mock') return { generate: mockGenerate(cfg), kind: 'mock' };
  return { generate: openaiGenerate(cfg), kind: 'openai-compatible' };
}

/* ─────────────────────────────────────────────────────────────
   OpenAI 兼容协议
   ───────────────────────────────────────────────────────────── */

function openaiGenerate(cfg) {
  return async function generate(topic, history) {
    const url = cfg.llm.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.llm.timeoutMs);

    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.llm.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.llm.model,
          temperature: cfg.llm.temperature,
          max_tokens: cfg.llm.maxTokens,
          messages: buildMessages(cfg, topic, history),
        }),
        signal: ac.signal,
      });

      const raw = await r.text();
      if (!r.ok) {
        throw new Error(`LLM ${r.status}：${raw.slice(0, 300)}`);
      }

      let content = '';
      try {
        content = JSON.parse(raw)?.choices?.[0]?.message?.content || '';
      } catch {
        throw new Error(`LLM 返回不是合法 JSON：${raw.slice(0, 300)}`);
      }
      if (!content.trim()) throw new Error('LLM 返回内容为空');

      return parseArticle(content, topic, cfg);
    } finally {
      clearTimeout(timer);
    }
  };
}

/* ─────────────────────────────────────────────────────────────
   Prompt
   ───────────────────────────────────────────────────────────── */

function buildMessages(cfg, topic, history) {
  const a = cfg.article;
  const links = (topic.links || []).map((l) => `\`${l}\``).join('、') || '`/guide/`';

  const constraints = `
# 任务
你是「吊车.cn」（二手吊车转让信息平台）的行业编辑。围绕下面这个选题写一篇中文原创文章。

# 选题
- 主关键词：${topic.keyword}
- 参考标题（可改写，保持同一个主关键词）：${topic.title}
- 分类：${topic.category}

# 硬约束（违反任何一条都会被判不合格）
1. 【格式】只输出一个 JSON 对象，不要前言后语、不要 Markdown 代码块围栏。
   字段：title、description、slug、keyword、body
2. 【title】${a.titleMaxChars} 字以内，必须含主关键词，**不要**带 "| 吊车.cn" 后缀（程序会自动加）
3. 【description】${a.descriptionWords[0]}~${a.descriptionWords[1]} 字，含主关键词，一句话说清这篇能解决什么问题
4. 【slug】纯 ASCII 小写、英文短横线分隔，不超过 40 字符，见名知义（如 select-25t-vs-35t）
5. 【keyword】原样返回主关键词
6. 【字数】body 的中文正文字数 ${a.minWords}~${a.maxWords} 字
7. 【可用的 Markdown 语法】只允许：## 标题、### 小标题、普通段落、- 无序列表、1. 有序列表、**加粗**、[文字](/站内路径) 链接、> 引用、--- 分割线。
   ★ 严禁：表格（|）、图片（![]）、代码块与反引号、HTML 标签、缩进嵌套列表
8. 【结构】
   - 第一个 ## 之前先写一段 ${80}~${120} 字的开篇，结论前置，不许铺垫套话
   - 正文 ${a.h2Range[0]}~${a.h2Range[1]} 个 ## 小标题，每个标题回答一个真人在搜的问题（写成问句或明确短句，不要"要点分析"这种分类名）
   - 结尾用一个 > 引用：一句免责 + 一句引导（看车源或发布车源）
9. 【内链】正文里放 ${a.internalLinks[0]}~${a.internalLinks[1]} 个站内链接，格式 [锚文字](/路径)，只能从这些里挑：${links}
10. 【关键词密度】正文中「${a.coreWord}」自然出现十几次即可（约占总字数 ${a.keywordDensity.min}%~${a.keywordDensity.max}%）；主关键词短语出现 2~3 次，不要堆砌
11. 【★ 红线】不许编造任何具体成交价、具体成交案例、虚构的检测数据。涉及价格一律写「区间参考」，不给确定数字
12. 【不许用这些套话】${(cfg.bannedPhrases || []).join('、')}
13. 【具体到能验证】写"重点查大臂有无焊接修复痕迹、转台与车架连接处的漆面色差"这种，不写"注意车况"这种废话

# 已发布过的文章标题（绝对不要重复或高度相近）
${history.length ? history.map((h) => `- ${h}`).join('\n') : '- （暂无）'}
`.trim();

  return [
    { role: 'system', content: '你是资深工程机械行业编辑，输出严格 JSON，不写多余内容。' },
    { role: 'user', content: constraints },
  ];
}

/** 从 LLM 输出里抠出 JSON。模型爱加 ```json 围栏，也可能前后带废话。 */
function parseArticle(content, topic, cfg) {
  let text = String(content).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error(`LLM 输出里找不到 JSON 对象：${text.slice(0, 200)}`);
  }

  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`LLM 输出的 JSON 解析失败：${e.message} —— ${text.slice(0, 200)}`);
  }

  if (String(obj.body || '').length > MAX_OUTPUT_CHARS) {
    throw new Error(`LLM 输出正文过长（${obj.body.length} 字符），疑似跑飞`);
  }

  return normalize(obj, topic, cfg);
}

/** 补齐字段、去掉模型可能自行加的后缀、修常见小毛病 */
function normalize(obj, topic, cfg) {
  const suffix = cfg.article.brandSuffix || '';
  let title = String(obj.title || topic.title || '').trim();
  // 模型经常自己把站点后缀加上，剥掉，由程序统一加，避免变成「| 吊车.cn | 吊车.cn」
  if (suffix && title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();

  return {
    title,
    description: String(obj.description || '').trim(),
    slug: sanitizeSlug(obj.slug, topic),
    keyword: String(obj.keyword || topic.keyword || '').trim() || topic.keyword,
    body: String(obj.body || '').replace(/\r\n/g, '\n').trim(),
  };
}

function sanitizeSlug(slug, topic) {
  let s = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!s) {
    // 兜底：用 slug_id 生成一个肯定合法的
    s = String(topic.id || 'article').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }
  return s;
}

/* ─────────────────────────────────────────────────────────────
   Mock：离线生成，用于自测与 CI 冒烟
   ★ 只用于流水线验证，内容是无意义的模板文本，不要真发出去
   ───────────────────────────────────────────────────────────── */

function mockGenerate(cfg) {
  return async function generate(topic, history) {
    const a = cfg.article;
    const target = Math.round((a.minWords + a.maxWords) / 2);
    const links = topic.links?.length ? topic.links : ['/guide/'];
    const kw = topic.keyword;

    const sections = [
      `先说结论：${topic.title.replace(/[？?]$/, '')}这件事，判断标准只有三条 —— 工况能不能覆盖、一年能出多少台班、当地能不能进场许可。三者都对得上才谈价格。`,
      `很多买家把注意力全放在价格上，忽略了${kw}背后的使用频次。设备是拿来干活的，闲置成本往往比买贵几万更贵。`,
      `二手设备的个体差异极大：同型号、同年份，一台常年干轻活，一台长期满负荷，三年下来车况能差出一整个档次。所以看车时必须逐台判断，不能只对型号报价。`,
    ];

    const h2s = [
      `${kw}：先分清是「能不能干」还是「值不值得干」`,
      `现场最容易忽略的三处检查`,
      `算清这台车一年能出多少台班`,
    ];

    const bullets = [
      '大臂有无焊接修复痕迹，焊缝是否均匀、有无补漆色差',
      '转台与车架连接处的螺栓力矩与漆面状态',
      '液压系统是否渗漏，油温高不高',
    ];

    const bodyParts = [];
    bodyParts.push(
      `${sections[0]}\n\n这里的判断不需要复杂公式：把过去一年实际接到的活列出来，按吨位和作业半径归类，再看哪一段区间是高频。高频区间决定了该买什么档位的车，而不是反过来。\n\n${sections[1]}`
    );

    bodyParts.push(
      `## ${h2s[0]}\n\n${sections[1]}\n\n实际走访中常见的情况是：买家冲着某个吨位去，到了现场发现活根本用不到这么大的车，或者更糟 —— 车到了现场进不去。所以在决定之前，先把常干的那几类活写清楚，甚至可以列一张表：作业半径、起重量、场地条件、进场道路宽度。\n\n参考本站的[${keywordTail(kw)}车源](${links[0]})，能看到这一档设备的实际挂牌情况；价格区间则看[行情参考](${links[links.length - 1]})。`
    );

    bodyParts.push(`## ${h2s[1]}\n\n${sections[2]}\n\n具体怎么查：`);
    bodyParts.push(bullets.map((b) => `- ${b}`).join('\n'));

    bodyParts.push(
      `## ${h2s[2]}\n\n台班量决定一切。把固定成本（保险、年检、司机工资、停放）除以预计出场天数，得到每天的保本线，再和市场台班价对比。这里的每一行数字都要按你自己的实际情况填，别人的账不能照抄。\n\n需要外租补充的季节，可以看[吊车出租](${links[1 % links.length] || '/rent/'})里的车源情况。`
    );

    bodyParts.push(
      `> 本站只提供信息展示，价格均为区间参考、不成交承诺。看车请核对行驶证与发票、确认有无抵押；付款建议分批，过户完成再付尾款。有车要出？到[发布车源](/sell/)登记。`
    );

    let body = bodyParts.join('\n\n');

    // 补足字数：按需要重复填充（mock 专用，真实模型不需要）
    const core = a.coreWord || '吊车';
    while (plainLen(body) < target) {
      body += `\n\n还需要提醒一点：${core}属于特种设备，操作与检验都有强制要求。手续不全的车再便宜也不能碰，后续的过户与年检会一直卡着。${sections[2]}`;
    }

    return {
      title: topic.title,
      description: `${topic.title.replace(/[？?]$/, '')}。从工况、台班量与进场条件三个角度讲清判断依据，附现场检查要点。`.slice(0, a.descriptionWords[1]),
      slug: sanitizeSlug(topic.id, topic),
      keyword: kw,
      body,
    };
  };
}

function keywordTail(kw) {
  const m = String(kw || '').match(/二手吊车|吊车/);
  return m ? m[0] + '相关' : '吊车相关';
}

function plainLen(md) {
  return String(md).replace(/\s/g, '').length;
}
