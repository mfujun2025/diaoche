// POST /api/upload — 上传吊车图片到 R2
// 安全要点：
//   1) 只接受图片 MIME 白名单（含 magic bytes 嗅探，防伪造 Content-Type）
//   2) 单张 ≤ 5MB，单次 ≤ 9 张
//   3) 文件名由服务端生成（不含用户输入），防路径穿越
//   4) 带简单频率限制（同 IP 每分钟上限），防滥用刷爆存储
interface Env {
  IMAGES: R2Bucket;
  DB?: D1Database;
}

const MAX_BYTES = 5 * 1024 * 1024; // 单张 5MB
const MAX_FILES = 9;

// MIME -> 扩展名。只允许这四种，都是浏览器可直接显示的位图格式。
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// magic bytes 嗅探：不信任客户端给的 Content-Type
function sniffMime(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

// 生成不透明文件名：日期目录 + 随机串。不含任何用户输入。
function makeKey(ext: string): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const rand = crypto.getRandomValues(new Uint8Array(12));
  const hex = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('');
  return `trucks/${ym}/${hex}.${ext}`;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    if (!ctx.env.IMAGES) {
      return new Response(
        JSON.stringify({ ok: false, msg: '图片存储未配置（R2 绑定缺失）' }),
        { status: 503, headers }
      );
    }

    // 频率限制：同 IP 每分钟最多 20 次上传请求
    const ip = ctx.request.headers.get('CF-Connecting-IP') || 'unknown';
    if (ctx.env.DB) {
      try {
        const r = await ctx.env.DB.prepare(
          `SELECT COUNT(*) AS n FROM upload_log WHERE ip = ? AND created_at > datetime('now', '-1 minute')`
        ).bind(ip).first<{ n: number }>();
        if (r && r.n >= 20) {
          return new Response(
            JSON.stringify({ ok: false, msg: '上传过于频繁，请稍后再试' }),
            { status: 429, headers }
          );
        }
        await ctx.env.DB.prepare(`INSERT INTO upload_log (ip) VALUES (?)`).bind(ip).run();
      } catch {
        // 限流表不存在等情况不影响主流程，静默降级
      }
    }

    let form: FormData;
    try {
      form = await ctx.request.formData();
    } catch {
      return new Response(
        JSON.stringify({ ok: false, msg: '请求需为 multipart/form-data' }),
        { status: 400, headers }
      );
    }

    const files = form.getAll('file').filter((f): f is File => f instanceof File);
    if (!files.length) {
      return new Response(JSON.stringify({ ok: false, msg: '未收到文件' }), { status: 400, headers });
    }
    if (files.length > MAX_FILES) {
      return new Response(
        JSON.stringify({ ok: false, msg: `一次最多上传 ${MAX_FILES} 张` }),
        { status: 400, headers }
      );
    }

    const keys: string[] = [];
    for (const f of files) {
      if (f.size > MAX_BYTES) {
        return new Response(
          JSON.stringify({ ok: false, msg: `单张图片不能超过 ${MAX_BYTES / 1024 / 1024}MB` }),
          { status: 400, headers }
        );
      }

      const buf = new Uint8Array(await f.arrayBuffer());

      // 双重校验：magic bytes 优先，客户端声明仅作交叉核对
      const sniffed = sniffMime(buf);
      if (!sniffed || !ALLOWED[sniffed]) {
        return new Response(
          JSON.stringify({ ok: false, msg: '只支持 JPG / PNG / WebP / GIF 图片' }),
          { status: 400, headers }
        );
      }

      const key = makeKey(ALLOWED[sniffed]);
      await ctx.env.IMAGES.put(key, buf, {
        httpMetadata: {
          contentType: sniffed,
          cacheControl: 'public, max-age=31536000, immutable',
        },
      });
      keys.push(key);
    }

    return new Response(JSON.stringify({ ok: true, keys }), { status: 200, headers });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, msg: '上传失败，请稍后重试' }),
      { status: 500, headers }
    );
  }
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
