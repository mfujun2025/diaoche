/**
 * 极简 Markdown 渲染器（零依赖）。
 *
 * 为什么自己写：项目约定零依赖，唯一 npm 依赖是 wrangler。
 * 支持范围刻意收窄 —— 只做文章真正会用到的语法。
 * **不支持的就原样输出**，绝不「假装支持然后渲染错」。
 *
 * 支持：## / ### 标题、段落、- 无序列表、1. 有序列表、
 *       **加粗**、[文字](链接)、> 引用、--- 分割线
 * 不支持：表格、图片、代码块、嵌套列表（真需要时再加）
 *
 * ⚠️ 一级标题 `#` 也渲染成 h2 —— 页面 H1 由模板给，正文里出现两个 H1 是 SEO 硬伤。
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML 转义。域名 / 路由 / 正文一律走这里，防 XSS。
 *  ⚠️ 用 `??` 而不是默认参数 —— 默认参数只管 undefined，
 *  传 null 时会变成字面量字符串 "null" 渲染到页面上。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

/**
 * 行内元素渲染。
 *
 * ⚠️ 顺序不能反：必须「先整体转义，再替换语法」。
 * 反过来的话，我们自己生成的 `<strong>` 标签会被下一步转义掉，
 * 页面上直接显示成字面量 `<strong>`。
 */
function inline(s) {
  return (
    esc(s)
      // 加粗
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // 链接：只放行站内相对路径与 http(s)，其余（javascript: / data:）一律降级成 #
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
        const safe = /^(https?:\/\/|\/)/.test(href) ? href : '#';
        return `<a href="${safe}">${text}</a>`;
      })
  );
}

/**
 * 解析 frontmatter。
 * 只做 `key: value` 的扁平结构 —— 文章元数据就这几个字段，
 * 上 YAML 解析器是杀鸡用牛刀。
 */
export function parseFrontmatter(raw) {
  const text = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');

  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };

  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) meta[k] = v;
  }
  return { meta, body: m[2] };
}

/**
 * 渲染正文为 HTML 片段。
 * 单遍线性扫描，用一个 listBuf 记住当前列表状态。
 */
export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let listBuf = null; // { type: 'ul'|'ol', items: string[] }
  let paraBuf = [];

  const flushPara = () => {
    if (!paraBuf.length) return;
    out.push(`<p>${inline(paraBuf.join(' '))}</p>`);
    paraBuf = [];
  };
  const flushList = () => {
    if (!listBuf) return;
    const tag = listBuf.type;
    out.push(`<${tag}>${listBuf.items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`);
    listBuf = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    // 空行：段落与列表的分隔符
    if (!line) {
      flushPara();
      flushList();
      continue;
    }

    // 分割线
    if (/^-{3,}$/.test(line)) {
      flushPara();
      flushList();
      out.push('<hr>');
      continue;
    }

    let m;

    // 标题：1~2 个 # 出 h2，3 个以上出 h3（见文件头说明，正文不出现 h1）
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      flushList();
      const lv = m[1].length <= 2 ? 2 : 3;
      out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
      continue;
    }

    // 引用
    if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      flushList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      continue;
    }

    // 无序列表
    if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (!listBuf || listBuf.type !== 'ul') {
        flushList();
        listBuf = { type: 'ul', items: [] };
      }
      listBuf.items.push(inline(m[1]));
      continue;
    }

    // 有序列表
    if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      flushPara();
      if (!listBuf || listBuf.type !== 'ol') {
        flushList();
        listBuf = { type: 'ol', items: [] };
      }
      listBuf.items.push(inline(m[1]));
      continue;
    }

    // 普通段落行（连续多行会合成一段）
    flushList();
    paraBuf.push(line);
  }

  flushPara();
  flushList();
  return out.join('\n');
}

/** 从正文抽纯文本，用于估算字数 / 生成描述兜底。 */
export function plainText(md) {
  return String(md ?? '')
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/[#>*`\-]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
