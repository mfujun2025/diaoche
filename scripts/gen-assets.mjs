// 生成站点分享图（og:image）与 favicon
//
// 为什么不放进 build.mjs 的常规构建流程：
//   渲染中文需要系统字体，而 CI（ubuntu-latest）默认没有中文字体，
//   放进 CI 会产不出图或渲染成豆腐块。所以本地生成一次，产物作为
//   静态资源提交进仓库 —— CI 只负责拷贝，不依赖字体环境。
//
// 用法: node scripts/gen-assets.mjs
//
// 依赖 sharp：它是 wrangler 的传递依赖，此处按「可选工具依赖」使用，
// 不写进 package.json 的 devDependencies（避免多一个直接依赖）。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'public');

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('[gen] 需要 sharp：npm i --no-save sharp');
  process.exit(1);
}

// 品牌配色，与 src/style.css 的 :root 保持一致
const BRAND = '#c8341f';
const BRAND2 = '#e04a30';
const FG = '#1a1d21';
const FG2 = '#5c6670';
const BG2 = '#f6f8fa';
const LINE = '#e3e8ee';

/* ─────── og:image 1200×630 ───────
   微信/QQ/微博/推特的分享卡片标准尺寸。
   设计取向：一眼看出是什么站、能办什么事，不放装饰性图形。 */
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="hero" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${BG2}"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#hero)"/>
  <rect x="0" y="0" width="1200" height="8" fill="${BRAND}"/>

  <!-- 站点标识 -->
  <text x="88" y="128" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="44" font-weight="700" fill="${FG}">吊车<tspan fill="${BRAND}">.cn</tspan></text>
  <text x="88" y="170" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="20" fill="${FG2}">二手吊车转让信息平台</text>

  <line x1="88" y1="206" x2="1112" y2="206" stroke="${LINE}" stroke-width="1"/>

  <!-- 主标题 -->
  <text x="88" y="306" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="64" font-weight="700" fill="${FG}">全国二手吊车</text>
  <text x="88" y="384" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="64" font-weight="700" fill="${BRAND}">转让信息平台</text>

  <!-- 三个卖点 -->
  <g font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="24" fill="${FG2}">
    <text x="88" y="440">按吨位 · 品牌 · 地区快速找车</text>
    <text x="88" y="476">车源由车主与设备商直发</text>
  </g>

  <!-- 吨位标签条 -->
  <g font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="23" font-weight="600" fill="${BRAND}">
    ${[8, 12, 16, 25, 35, 50, 80, 100]
      .map((t, i) => {
        const x = 88 + i * 108;
        return `<rect x="${x}" y="518" width="92" height="44" rx="10" fill="#ffffff" stroke="${LINE}"/>
    <text x="${x + 46}" y="547" text-anchor="middle">${t}吨</text>`;
      })
      .join('\n    ')}
  </g>

  <!-- 右侧强调块 -->
  <rect x="948" y="288" width="164" height="164" rx="26" fill="${BRAND}"/>
  <text x="1030" y="368" text-anchor="middle"
        font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="46" font-weight="700" fill="#ffffff">吊车</text>
  <text x="1030" y="414" text-anchor="middle"
        font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="31" font-weight="700" fill="#ffffff" opacity="0.92">.cn</text>

  <!-- 底部合规口径 -->
  <line x1="88" y1="586" x2="1112" y2="586" stroke="${LINE}" stroke-width="1"/>
  <text x="88" y="612" font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="18" fill="${FG2}">仅提供信息发布与展示服务，不参与实际交易 · 信息由发布者提供</text>
</svg>`;

/* ─────── favicon ───────
   站点简称是「吊」，用它做图标最直观。 */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="${BRAND}"/>
  <text x="32" y="45" text-anchor="middle"
        font-family="Microsoft YaHei, PingFang SC, sans-serif"
        font-size="38" font-weight="700" fill="#ffffff">吊</text>
</svg>`;

await mkdir(OUT, { recursive: true });

// og:image —— PNG（微信/QQ/微博只认位图，不认 SVG）
const ogPng = await sharp(Buffer.from(ogSvg))
  .png({ compressionLevel: 9, palette: false }) // 不量化调色板，避免文字边缘出现色带
  .toBuffer();
await writeFile(path.join(OUT, 'og.png'), ogPng);
console.log(`[gen] og.png          ${(ogPng.length / 1024).toFixed(1)} KB  1200x630`);

// favicon.svg —— 现代浏览器直接支持，矢量清晰
await writeFile(path.join(OUT, 'favicon.svg'), faviconSvg, 'utf8');
console.log('[gen] favicon.svg     ' + Buffer.byteLength(faviconSvg) + ' B');

// favicon.ico —— 兼容老浏览器/老采集器。用 32x32 PNG 即可被现代浏览器接受，
// 但真正的 .ico 容器兼容性最好，这里用 sharp 出 32x32 PNG 后手工包 ICO 头。
const fav32 = await sharp(Buffer.from(faviconSvg)).resize(32, 32).png().toBuffer();
const fav16 = await sharp(Buffer.from(faviconSvg)).resize(16, 16).png().toBuffer();
const ico = buildIco([
  { size: 16, png: fav16 },
  { size: 32, png: fav32 },
]);
await writeFile(path.join(OUT, 'favicon.ico'), ico);
console.log(`[gen] favicon.ico     ${ico.length} B  (16+32)`);

/**
 * 手工拼 ICO 容器。
 * ICO 结构：6 字节头 + 每个图像 16 字节目录项 + 图像数据（可直接内嵌 PNG）。
 * 之所以不用现成库：这是十几行的事，不值得多一个依赖。
 */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  let offset = 6 + dirSize;

  const dirs = [];
  for (const img of images) {
    const d = Buffer.alloc(16);
    d.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width（0 表示 256）
    d.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    d.writeUInt8(0, 2); // 调色板数
    d.writeUInt8(0, 3); // reserved
    d.writeUInt16LE(1, 4); // 颜色平面数
    d.writeUInt16LE(32, 6); // 位深
    d.writeUInt32LE(img.png.length, 8); // 数据长度
    d.writeUInt32LE(offset, 12); // 数据偏移
    dirs.push(d);
    offset += img.png.length;
  }

  return Buffer.concat([header, ...dirs, ...images.map((i) => i.png)]);
}
