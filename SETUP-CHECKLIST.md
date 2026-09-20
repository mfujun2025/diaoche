# Cloudflare 配置清单与现状

> **当前状态：站点已上线 ✅，图片上传 + 显示全链路已打通 ✅**
> 线上地址：<https://xn--bqr649k.cn/>（自定义域名已生效）· <https://diaoche-cn.pages.dev/>
> 图片地址形如：`https://xn--bqr649k.cn/img/trucks/202609/xxxxxxxx.png`
>
> **图片方案已于 2026-09-20 变更**：不再依赖 R2 自定义域名（CF 对中文域名有 bug），
> 改走本站 Functions 代理 → **你不需要再做 R2 自定义域那一步了**。
>
> **剩余 1 项必须你手动做**：配 Access 保护后台（安全关键）。

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
| 环境变量 | ✅ `ENV` / `SITE_NAME` / `ADMIN_EMAILS` |
| CI 流水线 | ✅ 全绿，静态页 + Functions 均已发布 |
| 图片上传功能 | ✅ 前端选图 + 后端 `/api/upload` + 卡片显示封面 |

---

## 二、待你操作（1 项）

### ☐ 创建 Access 应用保护后台（安全关键）

⚠️ **当前 `/admin/` 和 `/api/admin/*` 是公开可访问的**（代码层白名单也因 `ADMIN_EMAILS` 为空而未生效）。
**在配好 Access 之前，不要往里面提交真实车源。**

Zero Trust → **Access → Applications → Add → Self-hosted**

**应用 A（生产域名）**

- Name：`diaoche-admin`
- Public hostname：裸域 `xn--bqr649k.cn`
- Path：`admin`
- **再加一条** Path：`api/admin`

**应用 B（预览域名 —— 千万别漏）**

- Name：`diaoche-admin-preview`
- Subdomain：`diaoche-cn`，Domain：`pages.dev`
- Path：`admin`
- **再加一条** Path：`api/admin`

> ⚠️ 只保护生产域名 = 留后门。`.pages.dev` 是公开可达的，任何人都能从那里进后台。
> Access（Zero Trust）**只能网页端配置**，API 做不了。

**策略（每个应用配一条）**：Action `Allow` → Include → **Emails** → 填你的邮箱

### ☐ 填 `ADMIN_EMAILS`（双保险）

Pages 项目 → Settings → **Variables and Secrets** → 编辑 `ADMIN_EMAILS`，填你的邮箱（多个用逗号分隔）。

> 代码里还有一层邮箱白名单校验，即使 Access 被绕过也拦得住。**目前为空 = 这层没生效。**

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

---

## 五、验收清单

按 `DEPLOY.md` 第 7 节做端到端验证，关键三项：

- 提交一条测试车源 → 前台**看不到**（pending 状态）✅ 线上已实测
- 访问 `/admin/` → **要求登录**（Access 拦截）⬜ 待 Access 配好后验
- 后台点「通过」→ 前台能看到 ✅ 本地已实测（线上待 Access 配好后可验）

---

## 当前进度

| 项 | 状态 |
| --- | --- |
| 代码推送 | ✅ 完成（`b4fa3cf`） |
| CI 流水线 | ✅ 全绿通过（含 R2 绑定） |
| Node 22 + wrangler 4 | ✅ 已修正 |
| GitHub Secrets | ✅ 已配置 |
| D1 数据库 + 建表 + 绑定 | ✅ 完成 |
| R2 桶 + 权限 + 绑定 | ✅ 完成 |
| Pages 项目 + 部署 | ✅ 已上线 |
| **自定义域名 `吊车.cn`** | ✅ **已绑定生效** |
| 图片上传 | ✅ 代码完成 + 线上实测通过 |
| **图片显示（代理方案）** | ✅ **代码完成 + 线上实测通过** |
| Access 保护后台 | ⬜ **待你配置（安全关键）** |
| `ADMIN_EMAILS` | ⬜ **待你填写**（见下方提醒） |
| 上传接口鉴权 | ⬜ 待你定策略（Access 或 Turnstile） |
| 清理线上测试数据 | ⬜ 2 条 pending 测试车源（前台不可见，无影响） |

### ⚠️ 关于 `ADMIN_EMAILS` 的提醒

当前远端变量 `ADMIN_EMAILS` 为空，本地 `.dev.vars` 里填的是 `mfujun@agent.qq.com`。

**填入前请确认这个邮箱能正常收信** —— 如果 Access 那步用同一个邮箱做登录身份，收不到验证码就进不去后台。建议换成你日常在用的邮箱。
