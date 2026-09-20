# Cloudflare 配置清单与现状

> **当前状态：全部完成 ✅（方案已从 Access 改为应用层令牌，见第二节）**
> 站点已上线 · 图片上传 + 显示全链路已打通 · 后台令牌登录已生效
> 线上地址：<https://xn--bqr649k.cn/>（自定义域名已生效）· <https://diaoche-cn.pages.dev/>
> 图片地址形如：`https://xn--bqr649k.cn/img/trucks/202609/xxxxxxxx.png`
>
> **图片方案已于 2026-09-20 变更**：不再依赖 R2 自定义域名（CF 对中文域名有 bug），
> 改走本站 Functions 代理 → **你不需要再做 R2 自定义域那一步了**。
>
> **后台防护方案已于 2026-09-21 变更**：从 Cloudflare Access 改为**应用层令牌登录**（`ADMIN_TOKEN`）。
> 原因：Pages 自定义域名 + Access 多域名应用会导致认证回调 `/cdn-cgi/access/authorized` 返回 404，
> 认证走完却回不来。详见第二节。

---

## 一、已完成（无需操作，仅作记录）

| 项 | 结果 |
| --- | --- |
| GitHub Secrets | ✅ `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| D1 数据库 | ✅ `diaoche-db`，ID `a7eb7c3b-d557-4da8-8d8e-982a874ae3f5` |
| D1 建表 | ✅ 3 表（`trucks` / `prices` / `upload_log`）+ 4 索引 |
| D1 绑定 | ✅ Pages 项目 production + preview 双环境 |
| R2 桶 | ✅ `diaoche-images` |
| R2 权限 | ✅ Token 已含 `Workers R2 Storage / Edit` |
| R2 绑定 | ✅ Pages 项目 production + preview 双环境 |
| Pages 项目 | ✅ `diaoche-cn`，production branch = `main` |
| **自定义域名** | ✅ **`xn--bqr649k.cn` 已绑定，状态 active** |
| 环境变量 | ✅ `ENV` / `SITE_NAME` / **`ADMIN_TOKEN`** |
| CI 流水线 | ✅ 全绿，静态页 + Functions 均已发布 |
| 图片上传功能 | ✅ 前端选图 + 后端 `/api/upload` + 卡片显示封面 |
| **后台令牌登录** | ✅ **已生效（2026-09-21 实现并本地实测 10 项全通过）** |
| ~~Access 保护后台~~ | ⚠️ **已废弃**（Pages 自定义域名冲突，见第二节） |
| ~~`ADMIN_EMAILS` 白名单~~ | ⚠️ **已废弃**（Access 时代的产物，代码不再读取） |

---

## 一·五、环境变量为什么在面板里改不了

**现象**：Pages 项目 → Settings → Variables and secrets，变量都是灰的只读，点 `+ Add` 加同名变量会报 `Another variable with this name already exists in this work`。

**根因**：面板里有提示 ——

> Environment variables for this project are being managed through **wrangler.toml**.
> Only Secrets (encrypted variables) can be managed via the Dashboard.

**本项目用 `wrangler.toml` 的 `[vars]` 托管环境变量，所以面板只读。**

**改法**（唯一正确路径）：

```toml
# wrangler.toml
[vars]
ENV = "production"
SITE_NAME = "吊车.cn"
ADMIN_TOKEN = "你的随机令牌"
```

改完 commit + push，CI 部署时自动带上。

> **例外：Secrets 可以在控制台改。** 如果不想让令牌明文进仓库，用控制台
> Settings → Variables and Secrets → Add → 选 **Secret**，或命令行
> `npx wrangler pages secret put ADMIN_TOKEN --project-name diaoche-cn`。
> Secret 优先级高于 `[vars]`，同名会覆盖。
>
> 补充：本地 `.dev.vars` 是覆盖用的（已 gitignore），改完**必须重启 wrangler**，不热重载。

---

## 二、后台防护方案：应用层令牌（现行方案）

### 为什么放弃 Cloudflare Access

最初按原计划配好了 Access（应用 id `ac961fd9-c24d-4d93-ab26-071a2c4346b6`，策略 `allow-me` → Emails → `548827878@qq.com`，Destinations 4 条），
服务端也测出「4 个路径全部 302」看起来正常。**但实际登录走不通。**

**真实症状**（老孟反复反馈「输验证码后 404」）：

```
1. 访问 https://xn--bqr649k.cn/admin/
2. → 302 到 mfujun.cloudflareaccess.com/cdn-cgi/access/login/xn--bqr649k.cn?kid=...&redirect_url=%2Fadmin%2F
3. → 输邮箱 + 验证码，认证成功
4. → 回调 https://xn--bqr649k.cn/cdn-cgi/access/authorized?nonce=...&state=...
5. → ❌ 404 Not Found（Cloudflare Pages 的 404 页）
```

**根因**：把两个域名（`xn--bqr649k.cn` + `diaoche-cn.pages.dev`）放在**同一个** Access 应用里，
按官方文档属 **multi-domain application**，认证后 Access 需要靠**一串跨域重定向**逐域种 `CF_Authorization` cookie，
其中会经过 `/cdn-cgi/access/authorized`。而这个路径在**自定义域名上返回 404**。

**实测对照（决定性证据）**：

```bash
# 主域名（自定义域名）→ 404，请求被 Pages 抢走
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://xn--bqr649k.cn/cdn-cgi/access/authorized?nonce=t&state=t"
# => 404

# 预览域（Pages 系统域名）→ 400，走到了 Access（参数不合法才 400）
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://diaoche-cn.pages.dev/cdn-cgi/access/authorized?nonce=t&state=t"
# => 400

# 而 pages.dev 的 /admin/ 在无痕窗口里根本不要求登录（cookie 被会话顺带种上了）
```

**⚠️ 试过但无效的修法**：在 `_routes.json` 里加 `exclude: ["/cdn-cgi/*"]`。
官方文档明确 `exclude` 的语义是「该路径不调用 Functions」，之后**仍回落到 Pages 静态资源**，
找不到文件照样 404，**不会交回 CF 边缘处理**。

**结论**：Pages 自定义域名与 Access 的 `/cdn-cgi/*` 处理存在冲突，**改用应用层令牌彻底绕开**。

### 现行方案：`ADMIN_TOKEN` 令牌登录

**实现**：
- `functions/api/admin/_auth.ts` —— `verifyAdmin()` 读 `X-Admin-Token`（兼容 `Authorization: Bearer`），
  与 `env.ADMIN_TOKEN` 做**恒定时间比较**；**未配置令牌时一律拒绝**（fail closed，防忘配裸奔）
- `functions/api/admin/login.ts` —— `POST /api/admin/login`，供前端校验令牌
- `public/admin.js` —— 登录框 → 校验 → 存 `localStorage('dc_admin_token')` → 后续请求带令牌；带「退出」按钮
- `src/site.mjs` —— 后台页拆成 `#admin-login`（登录框）+ `#admin-main`（审核界面）两块
- `scripts/build.mjs` —— `ADMIN_CSS` 补登录框样式 + 移动端适配

**配置**：`wrangler.toml` 的 `[vars]` 里设 `ADMIN_TOKEN`；或控制台加 Secret（更安全，不进仓库）。

**本地实测（10 项全通过，2026-09-21）**：

| 测试 | 期望 | 实际 |
| --- | --- | --- |
| `/admin/` 页面可访问（门禁在前端） | 200 | ✅ 200 |
| 无令牌 `login` / `list` / `review` | 401 ×3 | ✅ 401 ×3 |
| 错令牌 `login` / `list` | 401 ×2 | ✅ 401 ×2 |
| 对令牌 `login` / `list` | 200 ×2 | ✅ 200 ×2 |
| `Authorization: Bearer` 兼容 | 200 | ✅ 200 |
| 超长令牌（500 字符） | 401 | ✅ 401 |
| 前台 6 页不受影响 | 200 ×6 | ✅ 200 ×6 |

**无头浏览器 UI 实测（6 步）**：登录框显示 → 错令牌提示「访问令牌不正确」→ 对令牌进主界面（状态栏、表格正常）→
刷新免登录（记住令牌）→ 点退出回到登录页且 localStorage 已清 → 移动端 390 宽零溢出。

### 安全代价（必须知道）

| 项 | 说明 |
| --- | --- |
| 无第二因素 | 比 Access 弱（Access 有邮箱验证码）。靠强随机令牌弥补 |
| 页面 HTML 公开 | `/admin/` 的登录框 HTML 是公开的，真正的数据在 API 后面。Access 连页面都拦 |
| 无频率限制 | 登录接口没做失败次数限制。32 位随机串暴力破解不可行，但建议后续加限流 |
| fail closed | 未配 `ADMIN_TOKEN` 时后台完全进不去 —— 这是刻意的设计，避免裸奔 |

### ⚠️ 历史坑（Access 时代，供回溯）

**在 Zero Trust 网页界面填 Destinations 时，如果「域名」和「路径」两栏被合并成一个输入框（`Switch to custom input` 模式），很容易把 `域名/admin + api/admin` 整串填进 Domain 字段。**

后果是 Access 拿这整串去匹配请求的 Host 头，**永远匹配不上 → 策略形同虚设，但界面上看起来完全正常**。

正确格式（API 层，每项必须是独立的「域名/路径」）：

```json
"self_hosted_domains": [
  "xn--bqr649k.cn/admin",
  "xn--bqr649k.cn/api/admin",
  "diaoche-cn.pages.dev/admin",
  "diaoche-cn.pages.dev/api/admin"
]
```

修复要用 `PUT /accounts/{id}/access/apps/{app_id}`，且 `PUT` 是覆盖式，必须带 `name` + `type`，
否则报 `12130 app type is missing or invalid`。

**判据**：Access 生效时未登录访问返回 **302**；返回 200 就是没拦住。

---

## 三、图片上传与显示方案

### 用户流程

1. 在 `/sell/` 填表，选图（最多 9 张，单张 ≤5MB）
2. 前端显示缩略图，可单张删除
3. 提交时**先传图**（`POST /api/upload`）拿到 key 列表，再带着 key 提交车源
4. 车源进 `pending`，管理员审核通过后，前台卡片显示封面图 + 图片数量角标

### 显示方案：Functions 代理（**不是** R2 自定义域名）

图片展示走 `functions/img/[[path]].ts`，从 R2 读流返回：

```
https://xn--bqr649k.cn/img/trucks/202609/xxxxxxxx.png
```

**为什么不用 R2 自定义域名**：在 CF 上给中文域名（punycode）zone 绑 R2 自定义域，
即使 zone 是 Full setup、DNS 记录干净，也会报
`Must be a valid domain on cloudflare.com zone`。
经排查（换子域名 `test.` 依旧报错、DNS 无残留记录、zone Active 且 Full setup）
判断为 CF 对 punycode zone 的处理缺陷。改用本站 Functions 代理彻底绕开。

**这个方案额外的好处**：
- 域名统一（都在 `吊车.cn` 下），不用多一个子域
- 以后要加防盗链、限流、水印，都在自己代码里，可控
- 免费额度：Functions 每天 10 万次请求，对当前体量绰绰有余

### 上传接口安全设计

| 措施 | 说明 |
| --- | --- |
| **magic bytes 校验** | 不信任客户端 Content-Type，读文件头判断真实格式 |
| 格式白名单 | 仅 JPG / PNG / WebP / GIF |
| 大小限制 | 单张 ≤5MB |
| 数量限制 | 单次 ≤9 张 |
| **服务端生成文件名** | `trucks/YYYYMM/<24位随机>.ext`，不含任何用户输入，防路径穿越 |
| 频率限制 | 同 IP 每分钟最多 20 次上传请求（靠 `upload_log` 表） |

### 图片读取接口安全设计

| 措施 | 说明 |
| --- | --- |
| **key 白名单** | 只允许 `trucks/` 前缀 + 安全字符，显式拒 `..` |
| 扩展名白名单 | 只映射 jpg/jpeg/png/webp/gif，其它一律 404 |
| 缓存 | `Cache-Control: immutable` 一年 + ETag，走 CF CDN，极少回源 R2 |
| 安全头 | `X-Content-Type-Options: nosniff` |

### 待办：上传接口的鉴权策略

当前 `/api/upload` **未做身份校验**，任何人都能调用。目前靠频率限制兜底。

后续建议二选一（等你定）：
- **A**：加 Access 保护（简单，但会让普通卖家也传不了图）
- **B**：加 Turnstile 人机验证（推荐，卖家用不受影响，能挡机器刷）

---

## 四、线上实测结果（2026-09-20）

已在**生产环境**跑通全链路，结果如下：

| 测试项 | 结果 |
| --- | --- |
| 首页 `https://xn--bqr649k.cn/` | ✅ HTTP 200 |
| `GET /api/trucks` | ✅ HTTP 200 |
| 预览域 `https://diaoche-cn.pages.dev/` | ✅ HTTP 200 |
| **上传正常 PNG** | ✅ 返回 `trucks/202609/96f70f41....png` |
| **`/img/` 代理读图** | ✅ HTTP 200，`image/png`，**字节与原图完全一致** |
| 图片响应头 | ✅ `nosniff` + long cache |
| 伪造 PNG（文本伪装成 image/png） | ✅ 拦截：`只支持 JPG / PNG / WebP / GIF 图片` |
| 6MB 超大文件 | ✅ 拦截：`单张图片不能超过 5MB` |
| 空请求（非 multipart） | ✅ 拦截：`请求需为 multipart/form-data` |
| `POST /api/submit`（带 images 数组） | ✅ 提交成功，落库为 JSON 数组 |
| 提交后前台列表 | ✅ `total: 0`（pending 审核隔离生效） |
| 不存在的图片 key | ✅ 404 |
| 非 `trucks/` 前缀 | ✅ 404 |
| 非图片扩展名（`.txt`） | ✅ 404 |
| ETag 条件请求 | ✅ 返回 304 |

> 结论：**上传 + 显示全链路已在生产环境验证通过。**

### 移动端实测（2026-09-20，iPhone 级视口 390×844）

用 CDP 模拟移动设备逐页体检，**全站 7 页零横向溢出**（文档宽均为 390）：

| 页面 | 文档宽 / 视口 | 页面高度 |
| --- | --- | --- |
| `/` 首页 | 390 / 390 ✅ | 2081 |
| `/trucks/` 车源大厅 | 390 / 390 ✅ | 844 |
| `/sell/` 我要卖车 | 390 / 390 ✅ | 1489 |
| `/rent/` 吊车出租 | 390 / 390 ✅ | 1000 |
| `/price/` 行情价格 | 390 / 390 ✅ | 912 |
| `/guide/` 避坑指南 | 390 / 390 ✅ | 1197 |
| `/admin/` 后台 | 390 / 390 ✅ | 844 |

> `/admin/` 里 640px 宽的后台表格在 `.tbl-wrap` 内部横滑，文档宽仍是 390 —— 属预期行为，不是溢出。

主要优化点：

- 头部：logo 居中，导航 5 项一行均分，不再横向滚动截断
- 车源卡片：单列 + 112px 小图横排（高度 1269 → 890）
- 筛选栏：4 个下拉改 **2×2 网格**，不再排成 4 行
- 表单：720px 起**保留两列**（仅 <380px 才回单列），高度 1963 → 1489（-24%）
- 价格表：移动端**隐藏「说明」列**，吨位/车龄/价格三列一屏看完
- 图片加载失败自动撤掉缩略图容器，避免裂图；价格为 0 显示「面议」而非「0万元」

---

### 后台令牌登录实测（2026-09-21，本地）

`wrangler pages dev dist --port 8788` + curl 端到端：

```
页面
  /admin/                            200 ✅（登录门禁在前端）
接口（无令牌，应 401）
  /api/admin/login                   401 ✅
  /api/admin/list                    401 ✅
  /api/admin/review                  401 ✅
接口（错令牌，应 401）
  /api/admin/login                   401 ✅  → {"ok":false,"msg":"访问令牌不正确"}
  /api/admin/list                    401 ✅
接口（对令牌，应 200）
  /api/admin/login                   200 ✅
  /api/admin/list                    200 ✅
兼容性
  Authorization: Bearer <token>      200 ✅
  超长令牌（500字符）                 401 ✅
前台（应 200，不受影响）
  / /trucks/ /sell/ /rent/ /price/ /guide/   全部 200 ✅
```

无头浏览器 UI 流程（6 步，全部通过）：
```
1. 打开 /admin/         → 登录框可见、主界面隐藏        ✅
2. 输错令牌             → 提示「访问令牌不正确」        ✅
3. 输对令牌             → 主界面显示、状态栏与表格正常  ✅
4. 刷新页面             → 免登录（记住令牌）            ✅
5. 点「退出」           → 回登录页、localStorage 已清   ✅
6. 移动端 390 宽        → 文档宽 390/390，零溢出        ✅
```

---

## 五、验收清单

按 `DEPLOY.md` 第 7 节做端到端验证，关键三项：

- 提交一条测试车源 → 前台**看不到**（pending 状态）✅ 本地已实测
- 访问 `/admin/` → **要求输入访问令牌**（无令牌调 API 返回 401）✅ **本地已实测（10 项全通过）**
- 后台点「通过」→ 前台能看到 ✅ 本地已实测

---

## 当前进度

| 项 | 状态 |
| --- | --- |
| 代码推送 | ✅ 完成 |
| CI 流水线 | ✅ 全绿通过（含 R2 绑定） |
| Node 22 + wrangler 4 | ✅ 已修正 |
| GitHub Secrets | ✅ 已配置 |
| D1 数据库 + 建表 + 绑定 | ✅ 完成 |
| R2 桶 + 权限 + 绑定 | ✅ 完成 |
| Pages 项目 + 部署 | ✅ 已上线 |
| **自定义域名 `吊车.cn`** | ✅ **已绑定生效** |
| 图片上传 | ✅ 代码完成 + 线上实测通过 |
| **图片显示（代理方案）** | ✅ **代码完成 + 线上实测通过** |
| **移动端适配** | ✅ **代码完成 + 线上实测通过（7 页零溢出）** |
| **后台令牌登录（`ADMIN_TOKEN`）** | ✅ **代码完成 + 本地实测通过（10 项 + UI 6 步）** |
| ~~Access 保护后台~~ | ⚠️ **已废弃**（Pages 自定义域名冲突） |
| ~~`ADMIN_EMAILS` 白名单~~ | ⚠️ **已废弃**（代码不再读取） |
| 上传接口鉴权 | ⬜ 待你定策略（可选 Turnstile） |
| 清理线上测试数据 | ⬜ 2 条 pending 测试车源（前台不可见，无影响） |
| 删除临时 CF token | ⬜ `cfut_Urh2...`、`cfut_zRdge...`（都已用完） |
| **修 `www` 前缀 522** | ⬜ 待加 DNS 记录（`www` CNAME → `diaoche-cn.pages.dev`，橙云） |
| **删除 Access 应用**（可选） | ⬜ Zero Trust → Access → Applications，把 `吊车.cn` 那个应用删掉（已不用） |

### 最终线上验证（2026-09-21）

```
后台（改令牌方案后应重新测）
  xn--bqr649k.cn/api/admin/list       无令牌应 401
  xn--bqr649k.cn/admin/               200，前端出登录框
前台（应 200）
  /  /trucks/  /sell/  /rent/  /price/  /guide/   全部 200
图片接口（应 404）
  /img/trucks/202609/nonexist.png     404
```

### 怎么进后台

浏览器打开 **<https://xn--bqr649k.cn/admin/>**：

1. 页面显示「后台登录」输入框
2. 填 `ADMIN_TOKEN`（在 `wrangler.toml` 的 `[vars]` 里，或你设的控制台 Secret）
3. 进入后台，可审核车源
4. 右上角「退出」可清除登录状态

> 同浏览器登录一次后免登录（令牌存在 localStorage）。换设备/清缓存需重新输。

#### ⚠️ 必须用 punycode 地址，否则会 522

**不要输中文「吊车.cn」** —— 浏览器会自动补全成 `www.吊车.cn`，而 `www` 前缀没有配置，结果就是 **522 连接超时**，看起来像后台坏了，实际根本没访问到站点。

**正确做法**：在地址栏粘贴这条（含 `https://`），浏览器不会改写 punycode：

```
https://xn--bqr649k.cn/admin/
```

如果浏览器仍然补成 `www.`，在地址栏输入 `www.吊车.cn` 等下拉提示出现时按 **Shift + Delete** 删掉那条历史记录。

**备用入口**（同一套代码，也需令牌）：

```
https://diaoche-cn.pages.dev/admin/
```

> 用的是 **One-time PIN** 方式，不需要额外配 Google/GitHub 登录。
