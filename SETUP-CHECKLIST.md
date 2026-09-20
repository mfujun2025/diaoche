# Cloudflare 控制台操作清单（可勾选）

> **当前状态：站点已上线 ✅**
> 线上地址：https://diaoche-cn.pages.dev/
> CI 全绿（10/10 步骤），D1 已建表，API 与审核隔离已实测通过。
>
> **剩余 2 项必须你手动做**：① 绑自定义域名 ② 配 Access 保护后台（安全关键）。

---

## 一、已完成（无需操作，仅作记录）

| 项 | 结果 |
|---|---|
| GitHub Secrets | ✅ `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 已写入 |
| D1 数据库 | ✅ `diaoche-db`，ID `a7eb7c3b-d557-4da8-8d8e-982a874ae3f5` |
| D1 建表 | ✅ 2 表（`trucks` / `prices`）+ 3 索引 |
| D1 绑定 | ✅ 已配置到 Pages 项目（production + preview 双环境） |
| Pages 项目 | ✅ `diaoche-cn`，production branch = `main` |
| 环境变量 | ✅ `ENV` / `SITE_NAME` / `ADMIN_EMAILS` 已配置 |
| CI 流水线 | ✅ 全绿，静态页 + Functions 均已发布 |

**实测验证结果（线上，非本地）**：

| 测试 | 结果 |
|---|---|
| 首页 `GET /` | HTTP 200 |
| 车源列表 `GET /api/trucks` | `{"ok":true,"total":0,"data":[]}` |
| 带筛选 `?biz_type=sale&tonnage=25` | 正常返回 |
| 提交 `POST /api/submit` | `{"ok":true,"msg":"提交成功，审核通过后展示"}` |
| 校验：吨位 9999 | 400 `吨位需为 1~2000 的数字` |
| 校验：缺联系方式 | 400 `联系方式必填且不超过 64 字` |
| **审核隔离** | 提交后进库为 `pending`，前台列表仍 `total: 0` ✅ |
| 后台 `GET /api/admin/list`（无 JWT） | 401 `未通过 Cloudflare Access 认证` |
| 后台（伪造 JWT） | 401 `身份令牌解析失败` |
| 测试数据 | 已清理，`trucks` 表 count = 0 |

---

## 二、待你操作（2 项）

### ☐ 1. 绑定自定义域名（不做则只能用 .pages.dev）

Pages 项目 → **Custom domains** → Set up a domain

填 `xn--bqr649k.cn`（**punycode 形式，不能写中文**）

> `吊车.cn` 的 DNS 必须已托管在 Cloudflare 下（NS 指向 CF）。若还没接入，先去域名注册商改 NS。

---

### ☐ 2. 创建 Access 应用保护后台（安全关键，不做则后台裸奔）

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
- Subdomain：`diaoche-cn`
- Domain：`pages.dev`
- Path：`admin`
- **再加一条** Path：`api/admin`

> ⚠️ 只保护生产域名 = 留后门。`.pages.dev` 是公开可达的，任何人都能从那里进后台。

**策略（每个应用配一条）**

- Action：`Allow`
- Include → **Emails** → 填你的邮箱

### ☐ 3. 填 `ADMIN_EMAILS`（双保险）

Pages 项目 → Settings → **Variables and Secrets** → 编辑 `ADMIN_EMAILS`，填你的邮箱（多个用逗号分隔）。

> 代码里还有一层邮箱白名单校验，即使 Access 被绕过也拦得住。**目前为空 = 这层没生效。**

---

## 三、后置项：R2 图片存储（当前已禁用）

**为什么禁用**：CF API Token 缺 `Workers R2 Storage / Edit` 权限，部署时 Functions 发布失败：

```
✘ [ERROR] Failed to publish your Function.
  R2 bucket 'diaoche-images' not found.
```

**影响**：零。项目 `functions/` 代码零引用 `env.IMAGES`，前端图片上传也未接。

**恢复步骤**：

1. 编辑 CF API Token，加权限 `Account / Workers R2 Storage / Edit`
2. 建桶：控制台 `R2` → Create bucket → 名称 `diaoche-images`
3. **同步更新 GitHub Secret** `CLOUDFLARE_API_TOKEN`（否则 CI 仍无权限）
4. 取消 `wrangler.toml` 中 R2 段的注释，推送

> 建议绑自定义子域（如 `img.xn--bqr649k.cn`）用于图片访问。
> 不要直接用 `r2.dev` 域名，有速率限制，不适合生产。

---

## 四、验收（全部完成后）

按 `DEPLOY.md` 第 7 节做端到端验证，关键三项：

- 提交一条测试车源 → 前台**看不到**（pending 状态）
- 访问 `/admin/` → **要求登录**（Access 拦截）
- 后台点「通过」→ 前台能看到

> 前两项已在 `.pages.dev` 上实测通过（审核隔离 + 接口鉴权）。
> 第三项需要 Access 配好后，用你邮箱登录后台才能验。

---

## 当前进度

| 项 | 状态 |
| --- | --- |
| 代码推送 | ✅ 完成 |
| CI 流水线 | ✅ **全绿通过** |
| Node 22 + wrangler 4 | ✅ 已修正 |
| GitHub Secrets | ✅ 已配置 |
| D1 数据库 + 建表 | ✅ 已创建并绑定 |
| Pages 项目 + 首次部署 | ✅ **已上线** |
| 站点功能实测 | ✅ 10 项通过 |
| 自定义域名 | ⬜ **待你配置** |
| Access 保护 | ⬜ **待你配置（安全关键）** |
| `ADMIN_EMAILS` | ⬜ **待你填写** |
| R2 图片存储 | ⬜ 后置（需补 token 权限） |
