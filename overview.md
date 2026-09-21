# 交付概述：吊车.cn 全站 og 分享标签 + JSON-LD 结构化数据 + favicon

**状态**：✅ 已上线（提交 `246e334` → 远端 `8a6dfd9`，CI 全绿，线上实测通过）

---

## 一句话

站点的 `<head>` 原来是「裸的」—— 分享到微信/QQ 没有卡片图，搜索引擎不知道这是个什么站。
这轮把**结构化数据、社交分享标签、favicon 三件套**一次补齐，六个前台页面全覆盖。

---

## 为什么必须做

| 问题 | 后果 |
|---|---|
| 没有任何 `og:*` 标签 | 微信/QQ/微博发链接 → **纯文字，无缩略图无摘要**，点击率显著低于带卡片图的 |
| 没有任何 JSON-LD | 搜索引擎不知道这是「什么类型的站、有哪些吨位、价格行情是什么」→ 丢掉富摘要与问答位 |
| 没有 favicon | 浏览器标签页显示空白默认图标，**观感像半成品站**，也影响点击信任 |

这三样加起来是**纯增益、零风险**：不影响页面渲染、不引入依赖、不改动任何业务逻辑。

---

## 一、og 分享标签（6 个前台页全覆盖）

每个页面输出 **10 个 og + 4 个 twitter** 标签：

```
og:type / og:site_name / og:locale(zh_CN) / og:title / og:description
og:url / og:image / og:image:width / og:image:height / og:image:alt
+ twitter:card(summary_large_image) / title / description / image
```

### 三个关键决策

**① `og:image` 必须绝对 URL**
抓取器（微信、QQ、Twitter）**不解析相对路径**。写 `/og.png` 等于没有。
统一用 `https://xn--bqr649k.cn/og.png`。

**② `og:description` 与 `<meta name="description">` 分开写**

- `meta description` → 给搜索引擎看，要**塞搜索词**
- `og:description` → 给用户看，要像**一句推荐语**

首页实例：
```
meta: 二手吊车转让信息平台，覆盖各吨位吊车买卖、出租行情与过户避坑指南
og:   按吨位、品牌、地区快速找车。车源由车主与设备商直发，平台不参与交易，只做信息撮合。
```
两者写同一份是常见偷懒，但场景不同，分开更值。

**③ admin 页刻意不加** —— 后台没有分享价值，加了反而把「车源管理后台」标题泄漏到分享卡片。

---

## 二、og 图与 favicon（本地生成，产物入库）

### 为什么 `og.png` 不进 CI 构建

渲染中文需要**系统字体**。CI 跑在 `ubuntu-latest` 上，**默认没有中文字体**，
若放进 CI 构建流程，产出的 og 图会是**一排豆腐块**。

→ 改为**本地生成一次、产物提交进仓库**。`scripts/gen-assets.mjs` 保留在仓库里，
以后要改文案重跑一次即可。

### 三条产物

| 文件 | 规格 | 用途 |
|---|---|---|
| `og.png` | 1200×630 PNG / 45.6 KB | 分享卡片图（微信/QQ/微博只认位图，**不认 SVG**） |
| `favicon.svg` | 64×64 矢量 / 319 B | 现代浏览器（清晰、体积极小） |
| `favicon.ico` | 16×16 + 32×32 双尺寸 / 943 B | 老浏览器、采集器、书签栏 |

`favicon.ico` 的 ICO 容器是**手工拼的**：6 字节头 + 每图 16 字节目录项 + PNG 数据。
一共十几行代码，**不值得为此多加一个依赖**（项目坚持零依赖）。

og 图设计：品牌红底 + 主标题「全国二手吊车转让信息平台」+ 8 个吨位标签
+ 右侧「吊车.cn」色块 + 底部合规文案（不参与交易 · 信息由发布者提供）。

---

## 三、JSON-LD 结构化数据（按页面语义分工）

用 **`@graph` 组织多实体**，一页只输出一个 `<script type="application/ld+json">`。

| 页面 | 实体 | 作用 |
|---|---|---|
| 首页 | `Organization` + `WebSite` + 2×`ItemList` | 站点主体（带 logo）+ 站内搜索入口 + 吨位/地区导航 |
| 车源大厅 | `CollectionPage` + `ItemList` + `Organization` | 声明这是聚合列表，并列出条目 |
| 行情价格 | `FAQPage` + `Organization` | 价格区间转 Q&A，争搜索引擎问答摘要位 |
| 避坑指南 | `FAQPage` + `Organization` | 同上 |
| 出租 | `Service` + `Organization` | 服务实体 + `areaServed` 覆盖各省 |
| 卖车 | `WebPage` + `Organization` | 发布入口页 |
| 车源详情 | `Product`（上轮已有） | 单个车源 |

### 首页 `WebSite` 带了站内搜索

```json
"potentialAction": {
  "@type": "SearchAction",
  "target": { "urlTemplate": "https://xn--bqr649k.cn/trucks/?tonnage={search_term_string}" },
  "query-input": "required name=search_term_string"
}
```
这是 Google **Sitelinks Searchbox** 的入口 —— 搜索结果里直接出现站内搜索框。

### ★ 本轮修掉的一个真问题

车源大厅原本只输出了 `CollectionPage` + `Organization`，**漏了 `ItemList`**。

`CollectionPage` 只说明「**这是一页列表**」，真正告诉搜索引擎「**列表里有什么**」的是 `ItemList`。
少了它，数据里最值钱的一层就丢了。已补上（吨位 9 项 + 地区 8 项）。

### 防注入

`jsonLd()` 对 `<` `>` `&` 以及 `U+2028` / `U+2029` 做转义，
杜绝 `</script>` 提前闭合标签导致的 XSS 与解析中断。

---

## 四、顺手修的

| 问题 | 修法 |
|---|---|
| 首页 canonical 多出 `/index.html` | 抽出 `pageUrl()`，首页返回根路径 |
| `socialMeta()` 里三个分支全一样的无意义三元表达式 | 简化为常量 |

---

## 五、验证

### 本地：`scripts/test-head.mjs`（新建）—— **172 项断言全绿**

逐页校验：JSON-LD 能被 `JSON.parse`、实体类型序列、`@context`、
所有 `url` 字段为绝对 URL、`</script>` 注入检查、
og 十项齐全、`og:image` 为绝对 URL、`og:url == canonical`、
favicon 三件套、admin 页无 og 无 JSON-LD 且 `noindex`。

### 线上实测（curl 等价，Node undici）

```
首页 HTTP 200 / 20168 字节
og 标签 10 个全部正确，twitter 4 个，favicon 3 个
canonical = https://xn--bqr649k.cn/
JSON-LD 解析成功 · @graph 4 实体 · 2476 字节
  - Organization (logo 1200x630)
  - WebSite (SearchAction → /trucks/?tonnage={search_term_string})
  - ItemList (9 项)   ← 吨位
  - ItemList (8 项)   ← 地区

/trucks/ /sell/ /rent/ /price/ /guide/  全部 200，og 各 10 个，JSON-LD 全部可解析
og:image Content-Type = image/png / 46730B / PNG 魔数 89504e47 ✅ / 1200x630
favicon.svg = image/svg+xml ✅   favicon.ico = image/vnd.microsoft.icon ✅
robots.txt = text/plain ✅      sitemap.xml = application/xml ✅
```

### 浏览器端：`scripts/cdp-head.mjs`（新建）—— 3/3 通过

curl 只能验文本，**浏览器才能证明文件真能加载**。CDP 无头读真实 DOM：

```
✓ 首页       JSON-LD 2476B / 1 script   favicon.svg 64x64 ✓  favicon.ico 32x32 ✓  og.png 1200x630 ✓
✓ 车源大厅   JSON-LD 2166B / 1 script   favicon 双双加载 ✓   og.png 1200x630 ✓
✓ 行情价格   JSON-LD 1818B / 1 script   favicon 双双加载 ✓   og.png 1200x630 ✓
```

---

## 六、教训

### `build.mjs` 的 TDZ 陷阱

`build.mjs` 是「**先跑顶层循环、后声明函数**」的结构：
第 168 行的 `for` 循环里调用 `render()`，而 `FAVICON` 常量写在后面。

`function` 声明会**提升**，`const` **不会**。所以报：

```
ReferenceError: Cannot access 'FAVICON' before initialization
```

**修法**：把 `const FAVICON` 提到 `readCss()` 之后、循环之前。
（第一次尝试只把它挪到 `pageUrl()` 上方不够 —— 循环在文件更前面。）

---

## 七、改动的文件

| 文件 | 改动 |
|---|---|
| `scripts/gen-assets.mjs` | **新增**。用 sharp 从 SVG 生成 og.png / favicon 三件套 |
| `scripts/test-head.mjs` | **新增**。172 项 head 断言 |
| `scripts/cdp-head.mjs` | **新增**。CDP 无头验证 head 在浏览器里的真实表现 |
| `src/site.mjs` | 扩 `SITE` 常量；抽出 `PRICE_ROWS` / `GUIDE_ITEMS`；新增 7 个结构化数据生成器 |
| `scripts/build.mjs` | 新增 `jsonLd()` / `pageUrl()` / `socialMeta()`；`render()` 注入 og+ld+favicon |
| `public/og.png` | **新增** 1200×630 分享图 |
| `public/favicon.svg` / `.ico` | **新增** favicon 双件套 |

---

## 八、副作用与说明

- **零新增运行时依赖**。`sharp` 是 `wrangler` 的传递依赖，只在本地生成资源时用，不进运行时。
- **不改变任何页面渲染**，不影响已有功能。
- **不影响长尾页与 sitemap** —— 这两块是 Function 按需渲染，各自输出自己的 JSON-LD。

---

## 下一步

- **接真实登录**（短信 / 微信开放平台）—— 只需改 `requireLogin()` 一处，等老孟定方案
- `/api/upload` 与 `/img` 目前无鉴权（可选加 Turnstile）
