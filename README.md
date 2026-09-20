# 吊车.cn

面向全国市场的**二手吊车转让信息平台**。部署架构：GitHub（源码 + Actions 构建）+ Cloudflare Pages（托管 + Functions + D1 + R2），零服务器、零第三方云。

仓库：`mfujun2025/diaoche`

## 方向定位

三者不是单选，是主次结构：

| 方向 | 定位 | 理由 |
|---|---|---|
| **二手吊车转让** | **主轴（主站）** | 客单价高（8万~100万+/台）、全国化需求、信息不透明有利润空间 |
| 吊车出租 | 辅轴（流量入口 `/rent/`） | 搜索量最大，但地域化极强，个人站难与 58/铁甲争本地词 |
| 新吊车出售 | 不自己做（内容栏目） | B端慢生意，认品牌，个人站拿不到厂家授权与垫资能力 |

## 站点板块

| 路径 | 板块 | 作用 |
|---|---|---|
| `/` | 首页 | 搜索入口 + 最新车源 + 吨位导航 |
| `/trucks/` | 车源大厅 | 核心成交场景，多条件筛选 |
| `/sell/` | 我要卖车 | 供给端入口，表单提交进审核队列 |
| `/rent/` | 吊车出租 | 流量入口，按省份聚合 |
| `/price/` | 行情价格库 | 8~100 吨成交价区间，SEO + 信任背书 |
| `/guide/` | 避坑指南 | 长尾 SEO，权属/工时/事故车/过户/合同 |
| `/admin/` | **审核后台** | **受 Cloudflare Access 保护**，审核/驳回/删除车源 |

## 技术栈

- **构建**：Node.js 原生脚本（`scripts/build.mjs`），把 `src/site.mjs` 中的页面定义渲染为静态 HTML，样式内联输出
- **托管**：Cloudflare Pages（全球 CDN）
- **API**：Cloudflare Pages Functions（`functions/api/submit.ts`、`functions/api/trucks.ts`）
- **数据库**：D1（SQLite），表结构见 `schema.sql`
- **对象存储**：R2（图片，二期接入）
- **CI/CD**：GitHub Actions（`.github/workflows/deploy.yml`）
- **后台鉴权**：Cloudflare Access（Zero Trust）+ 代码层邮箱白名单双保险

## 部署特性

- **免 ICP 备案**：全链路境外节点（Cloudflare + GitHub），不触发备案要求
- **零成本**：GitHub Actions + Cloudflare 免费额度完全覆盖，0 元/月（不含域名年费）
- **前台不受鉴权影响**：`_routes.json` 限定只有 `/api/*` 走 Functions，静态页直出 CDN

## 常用命令

```bash
npm run build         # 构建静态站 → dist/
npm run dev           # 本地静态预览 http://localhost:8080（不含 API）
npm run preview       # 带 Functions + D1 的完整本地环境
npm run db:init:local # 建本地 D1 表
npm run db:init       # 建线上 D1 表（--remote）
```

## 关键约定

1. **中文域名一律用 punycode**：`吊车.cn` → `xn--bqr649k.cn`（本机已换算核对）
2. **车源默认 `pending` 状态**，人工审核改 `approved` 后才在前台展示
3. **所有 D1 查询走 `.bind()` 参数绑定**，防 SQL 注入
4. **前端展示统一 `esc()` 转义**，防 XSS
5. **平台定位为信息服务**：不参与交易、不垫资、不做担保，footer 声明不可删

## 上线

- **操作清单（可勾选，照着做即可）**：见 [SETUP-CHECKLIST.md](./SETUP-CHECKLIST.md)
- **完整说明（含原理与排错）**：见 [DEPLOY.md](./DEPLOY.md)

## 环境要求

| 项 | 版本 |
|---|---|
| Node.js | **≥ 22**（wrangler v4 硬性要求） |
| wrangler | **v4**（v3 读不到 `wrangler.toml` 的 `pages_build_output_dir`） |
