# Cloudflare 配置清单与现状

> **当前状态：站点已上线 ✅，图片上传功能已发布并线上实测通过 ✅**
> 线上地址：<https://xn--bqr649k.cn/>（自定义域名已生效）· <https://diaoche-cn.pages.dev/>
> 本次提交 `b6e4668`，CI 全绿（含 R2 绑定），R2 权限问题已解决。
>
> **剩余 2 项必须你手动做**：① 给 R2 桶配自定义域名（否则图片显示不出来）② 配 Access 保护后台（安全关键）。

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

## 二、待你操作（2 项）

### ☐ 1. 给 R2 桶配自定义域名（图片功能必需）

**为什么必须配**：R2 桶默认**私有**，`<img src="...">` 直接访问会 403。上传的图片要能显示，必须绑一个公开域名。

**操作路径**：

**R2 → `diaoche-images` → Settings → Public access → Custom Domains → `+ Add`**

填：**`img.xn--bqr649k.cn`**

> - **必须 punycode 形式**，不能写中文
> - CF 会自动补 DNS 的 CNAME 记录；若提示需手动添加，把记录值发我确认
> - 配好后图片地址形如 `https://img.xn--bqr649k.cn/trucks/202609/xxxxxxxx.png`

**配完回我一声**，我验证图片能否正常访问。

---

### ☐ 2. 创建 Access 应用保护后台（安全关键）

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

### ☐ 3. 填 `ADMIN_EMAILS`（双保险）

Pages 项目 → Settings → **Variables and Secrets** → 编辑 `ADMIN_EMAILS`，填你的邮箱（多个用逗号分隔）。

> 代码里还有一层邮箱白名单校验，即使 Access 被绕过也拦得住。**目前为空 = 这层没生效。**

---

## 三、图片上传功能说明

### 用户流程

1. 在 `/sell/` 填表，选图（最多 9 张，单张 ≤5MB）
2. 前端显示缩略图，可单张删除
3. 提交时**先传图**（`POST /api/upload`）拿到 key 列表，再带着 key 提交车源
4. 车源进 `pending`，管理员审核通过后，前台卡片显示封面图 + 图片数量角标

### 安全设计

| 措施 | 说明 |
| --- | --- |
| **magic bytes 校验** | 不信任客户端 Content-Type，读文件头判断真实格式 |
| 格式白名单 | 仅 JPG / PNG / WebP / GIF |
| 大小限制 | 单张 ≤5MB |
| 数量限制 | 单次 ≤9 张 |
| **服务端生成文件名** | `trucks/YYYYMM/<24位随机>.ext`，不含任何用户输入，防路径穿越 |
| 频率限制 | 同 IP 每分钟最多 20 次上传请求（靠 `upload_log` 表） |

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
| **上传正常 PNG** | ✅ 返回 `trucks/202609/d9fbd42d....png` |
| 伪造 PNG（文本伪装成 image/png） | ✅ 拦截：`只支持 JPG / PNG / WebP / GIF 图片` |
| 6MB 超大文件 | ✅ 拦截：`单张图片不能超过 5MB` |
| 空请求（非 multipart） | ✅ 拦截：`请求需为 multipart/form-data` |
| `POST /api/submit`（带 images 数组） | ✅ 提交成功，落库为 JSON 数组 |
| 提交后前台列表 | ✅ `total: 0`（pending 审核隔离生效） |
| **R2 图片对外访问** | ❌ `img.xn--bqr649k.cn` **DNS 未解析** —— 卡在第 2 节第 1 项 |

> 结论：**代码侧全部正常**，唯一卡住图片显示的就是 R2 自定义域名那一步。

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
| 代码推送 | ✅ 完成（`b6e4668`） |
| CI 流水线 | ✅ 全绿通过（含 R2 绑定） |
| Node 22 + wrangler 4 | ✅ 已修正 |
| GitHub Secrets | ✅ 已配置 |
| D1 数据库 + 建表 + 绑定 | ✅ 完成 |
| R2 桶 + 权限 + 绑定 | ✅ 完成 |
| Pages 项目 + 部署 | ✅ 已上线 |
| **自定义域名 `吊车.cn`** | ✅ **已绑定生效** |
| 图片上传功能 | ✅ 代码完成 + **线上实测通过** |
| **R2 图片对外访问** | ⬜ **待你配自定义域名** |
| Access 保护后台 | ⬜ **待你配置（安全关键）** |
| `ADMIN_EMAILS` | ⬜ **待你填写**（注意见下方提示） |
| 上传接口鉴权 | ⬜ 待你定策略（Access 或 Turnstile） |
| 清理线上测试车源 | ⬜ 1 条 pending 测试数据（前台不可见，无影响） |

### ⚠️ 关于 `ADMIN_EMAILS` 的提醒

当前远端变量 `ADMIN_EMAILS` 为空，本地 `.dev.vars` 里填的是 `mfujun@agent.qq.com`。

**填入前请确认这个邮箱能正常收信** —— 如果 Access 那步用同一个邮箱做登录身份，收不到验证码就进不去后台。建议换成你日常在用的邮箱。
