// GET /img/<任意深度的 key> — 从 R2 读取图片并返回
//
// 文件名用 [[path]] 是 CF Pages Functions 的 catch-all 语法，可匹配任意深度路径：
//   /img/trucks/202609/abc123.png  ->  path = ["trucks", "202609", "abc123.png"]
//
// 为什么用 Functions 代理而不是 R2 自定义域名：
//   CF 的 R2 自定义域在中文域名（punycode）zone 上校验失败，
//   报 "Must be a valid domain on cloudflare.com zone"。走 Functions 绕开。
//
// 路由：/_routes.json 需 include "/img/*"，否则请求到不了这里。
//
// 安全与性能要点：
//   - key 白名单校验：只允许 trucks/ 前缀 + 安全字符，防路径穿越
//   - 长效 Cache-Control 让 CF CDN 缓存，大幅减少回源 R2
//   - ETag 透传，支持 304 条件请求

interface Env { IMAGES: R2Bucket }

// 只允许：trucks/ 开头，后接字母数字 / 斜杠 / 点 / 横线 / 下划线
const KEY_RE = /^trucks\/[A-Za-z0-9._/-]+$/;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  // catch-all 参数：params.path 是路径段数组
  const segs = ctx.params.path;
  const parts = Array.isArray(segs) ? segs : segs ? [segs] : [];
  const key = parts.map((s) => decodeURIComponent(s)).join('/');

  // —— 安全校验 ——
  if (!key || !KEY_RE.test(key) || key.includes('..')) {
    return new Response('Not Found', { status: 404 });
  }

  const ext = (key.split('.').pop() || '').toLowerCase();
  const mime = EXT_MIME[ext];
  if (!mime) {
    return new Response('Not Found', { status: 404 });
  }

  if (!ctx.env.IMAGES) {
    return new Response('Image storage not configured', { status: 503 });
  }

  // —— 取对象 ——
  let obj: R2ObjectBody | null;
  try {
    obj = await ctx.env.IMAGES.get(key);
  } catch {
    return new Response('Storage error', { status: 502 });
  }
  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  // —— 条件请求：客户端带的 ETag 与当前一致 → 304 ——
  const etag = obj.httpEtag;
  if (ctx.request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': mime,
    // key 里含随机串，内容不会变 → 可长缓存
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  };
  if (obj.size) headers['Content-Length'] = String(obj.size);

  return new Response(obj.body, { status: 200, headers });
};
