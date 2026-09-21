# 交付概述：吊车.cn「吨位 × 地区」长尾路径页

**状态**：✅ 已上线（提交 `2a6842b` + `a7ffc8d`，GitHub Actions 全绿，Cloudflare Pages 已部署）

---

## 一句话

把原来的**参数筛选页**（`/trucks/?tonnage=25&province=江苏`）升级成**静态路径页**（`/trucks/25吨/江苏/`），
让每个「吨位 × 地区 × 品牌」组合成为一条独立 URL、独立标题、独立结构化数据的**可收录页面**。

---

## 为什么必须做

原来的参数页有三个硬伤：

1. `robots.txt` 里 `Disallow: /*?*` 把参数页**全部屏蔽了** —— 一条都收不进去
2. 同一批车源对应无数 URL（参数顺序、默认值差异）→ 权重分散
3. 没有独立 title / canonical → 搜索引擎不认它是独立页面

改路径页后，**数据一行没加，页面数量翻了几倍**。

---

## 支持的 URL 形态

| 形态 | 示例 | 备注 |
|---|---|---|
| 吨位 | `/trucks/25吨/` | 兼容 `25` / `25t` / `25T` |
| 地区 | `/trucks/江苏/` | 兼容 `江苏省` / `上海市` |
| 品牌 | `/trucks/徐工/` | |
| **吨位+地区** | `/trucks/25吨/江苏/` | **主战场**，长尾词最精准 |
| 吨位+地区+品牌 | `/trucks/25吨/江苏/徐工/` | 有车才出 |

**乱序访问自动归一**：`/trucks/江苏/25吨/` 的 canonical 指向 `/trucks/25吨/江苏/`，不产生重复内容。

---

## 四条核心设计决策

### ① 空组合一律 404，绝不进 sitemap

9 个吨位 × 8 个地区 × 4 个品牌 = **288 个组合**，绝大多数没车。

无脑全生成 → 搜索引擎判为 thin content（低质量页）→ **反而拖累整站评分**。

所以查库结果为 0 时返回 404 + `noindex,nofollow`，**且绝不写进 sitemap**。

### ② canonical 固定维度顺序

避免 `/trucks/江苏/25吨/` 和 `/trucks/25吨/江苏/` 被当成两个页面分散权重。

### ③ 结构化数据语义分离

- 详情页 → `Product`（告诉搜索引擎「这是一个商品」）
- 列表页 → `CollectionPage` + `ItemList`（告诉它「这是聚合列表，第 1 项是什么」）

### ④ 内链织成网

- 首页 / 车源大厅：各输出吨位 / 地区 / 品牌三组一级入口
- 每个长尾页：输出「同层级换一个维度」的 8-12 个链接
- 每个详情页：向上链接到它所属的吨位页 / 地区页 / 组合页

搜索引擎能从任意一个入口爬遍全部长尾页。

---

## 改动的文件

| 文件 | 改动 |
|---|---|
| `functions/trucks/[[path]].ts` | **重写**。详情页 + 长尾页合并分流；新增 `parseSeg` / `parsePath` / `canonPath` / `buildRelated` |
| `functions/trucks-sitemap.xml/index.ts` | 新增长尾组合页聚合（`UNION ALL` 一次查完三种粒度） |
| `src/site.mjs` | 首页 / 车源大厅加三组长尾内链；搜索框目标改为路径页 |
| `public/app.js` | 新增 `parseDataQuery()`；`goSearch()` 改跳路径页 |
| `src/style.css` | 新增 `.crumb` 面包屑样式 |
| `scripts/test-longtail.mjs` | **新增**。19 条路径解析断言 |
| `scripts/cdp-check.mjs` | **新增**。CDP 无头读 DOM 断言 4 个页面 |
| `scripts/gh-runs.mjs` | **新增**。查 Actions 状态（本机 `gh` 不可用） |
| `交付报告-长尾路径页.md` | 完整交付报告 |

---

## 线上实测结果

### 状态码

| URL | 状态 | 判定 |
|---|---|---|
| `/trucks/25吨/江苏/` | 200 | ✅ 有车 |
| `/trucks/25吨/` | 200 | ✅ 有车 |
| `/trucks/江苏/` | 200 | ✅ 有车 |
| `/trucks/徐工/` | 200 | ✅ 有车 |
| `/trucks/35吨/` | **404** | ✅ 无车，正确排除 |
| `/trucks/25吨/山东/` | **404** | ✅ 组合不匹配 |
| `/trucks/`（大厅） | 200 | ✅ 未被破坏 |
| `/trucks/2/`（详情页） | 200 | ✅ 未被破坏 |
| `/trucks-sitemap.xml` | 200 XML | ✅ 8 条（3 详情 + 5 组合页） |

### SEO 信息（`/trucks/25吨/江苏/`）

```
title:     25吨 江苏 二手吊车转让车源（共2条） — 吊车.cn
canonical: https://xn--bqr649k.cn/trucks/25吨/江苏/     ← 规范顺序
og:url:    同上
JSON-LD:   CollectionPage, numberOfItems=2
           ListItem[1] → /trucks/3/  「25吨 徐工 QY25K5」
           ListItem[2] → /trucks/2/  「25吨 徐工 QY25K5」
```

### CDP 无头 DOM 断言（4/4 通过）

```
长尾页 /trucks/25吨/江苏/   卡片 2 张 · 内链 8 个    ✓
长尾页 /trucks/25吨/        卡片 3 张 · 内链 8 个    ✓
车源大厅 /trucks/           卡片 3 张 · 内链 21 个   ✓
详情页 /trucks/2/           正文 + 免责声明 · 内链 4 个 ✓
```

---

## 本轮最大教训

### ⚠️ 本机 `wrangler pages dev` 不可信，别拿它验证 Functions 路由

**症状**：本地 `/api/*` 返回正确 JSON，**但 `/trucks/*` 一律返回首页 HTML**。
加 `_routes.json` 的 `exclude` 也没用。

**同一个 commit 部署到线上后完全正常。**

→ **正确验证策略**：
1. 纯逻辑单测（把解析函数摘出来跑断言，秒级反馈）
2. 直接推线上实测
3. CDP 无头读 DOM

这条已写进技能 `cf-pages-full-deploy` §9.5.1。

### 其他踩坑

- 本机 `curl` 走代理全部失败（exit 35）→ 改用 Node `undici.ProxyAgent`
- 对象键顺序会干扰测试断言 → 改用排序后逐键比较
- 中文路径必须先 `decodeURIComponent`

---

## 已固化到技能

`cf-pages-full-deploy` 新增：

- **§9.5.1** 本机 wrangler dev 不可信（含正确验证策略）
- **§9.5.2** curl 代理失败改用 Node undici
- **§13** 长尾路径页标准打法（完整的可复用方法论）
- **§11** 自检清单补 4 条

---

## 顺带发现（建议老孟处理）

线上 D1 现有 3 条车源，**其中 id=2 与 id=3 是完全重复的测试数据**
（都是 25吨徐工 QY25K5 / 2019 / 江苏南京 / 38万），id=4 的车况描述是乱码测试文本。

删掉后长尾页与 sitemap 会**自动收缩，不需要重新构建**。

---

## 下一步（P2，未开工）

- 首页补 JSON-LD（现 0 处）
- 首页补 og 标签（现完全没有）
