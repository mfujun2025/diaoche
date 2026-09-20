# Cloudflare 控制台操作清单（可勾选）

> 目标是让 GitHub Actions 能成功部署。当前 CI 状态：**前 6 步全绿，只差最后一步的凭证**。
>
> 最后一步报错原文：
> ```
> ✘ [ERROR] In a non-interactive environment, it's necessary to set
>   a CLOUDFLARE_API_TOKEN environment variable for wrangler to work.
> ```

---

## 一、先做两件不需要 Cloudflare 的事（5 分钟）

### ☐ 1. 配 GitHub Secrets（最关键，配完 CI 就能跑通）

打开：`https://github.com/mfujun2025/diaoche/settings/secrets/actions`

点 **New repository secret**，加两条：

| Name（必须完全一致） | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 见下方第二步创建 |
| `CLOUDFLARE_ACCOUNT_ID` | 见下方第一步获取 |

> ⚠️ Name 大小写、下划线都要一模一样，写错了 CI 会报同样的错。

### ☐ 2. 获取 Account ID

Cloudflare 控制台 → 右侧栏 **Account ID** → 复制

---

## 二、创建 Cloudflare API Token

打开：`https://dash.cloudflare.com/profile/api-tokens` → **Create Token** → **Custom token**

按下表配置权限：

| 区域 | 权限 | 级别 |
|---|---|---|
| Account | Cloudflare Pages | Edit |
| Account | D1 | Edit |
| Account | Workers R2 Storage | Edit |

**Account Resources**：选你的账号
**Zone Resources**：选 `吊车.cn`（或 All zones）

创建后**立即复制**（只显示一次），填到上面的 `CLOUDFLARE_API_TOKEN`。

---

## 三、Cloudflare 侧资源创建

### ☐ 3. 建 D1 数据库

`Workers & Pages` → **D1** → Create database

- 名称：`diaoche-db`
- 创建后复制 **Database ID**

### ☐ 4. 回填 Database ID

编辑仓库里的 `wrangler.toml`，把这一行的占位符换掉：

```toml
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"   # ← 换成真实 ID
```

### ☐ 5. 线上库执行建表 SQL

```bash
npx wrangler d1 execute diaoche-db --file=./schema.sql --remote
```

> ⚠️ **必须带 `--remote`**。不带只会建本地表，线上一提交就 500。

### ☐ 6. 建 R2 存储桶

`R2` → Create bucket → 名称 `diaoche-images`

建议绑自定义子域（如 `img.xn--bqr649k.cn`）用于图片访问。
> 不要直接用 `r2.dev` 域名，有速率限制，不适合生产。

### ☐ 7. 创建 Pages 项目

`Workers & Pages` → Create → **Pages** → Connect to Git

- 仓库：`mfujun2025/diaoche`
- 分支：`main`
- Framework preset：`None`
- Build command：**留空**
- Build output directory：`dist`

> 构建交给 GitHub Actions，这里留空避免重复构建。

### ☐ 8. 绑定自定义域名

Pages 项目 → **Custom domains** → Set up a domain

填 `xn--bqr649k.cn`（**punycode 形式，不能写中文**）

---

## 四、配置后台访问控制（安全关键）

### ☐ 9. 创建两个 Access 应用

Zero Trust → **Access → Applications → Add → Self-hosted**

**应用 A（生产域名）**
- Name：`diaoche-admin`
- Public hostname：裸域 `xn--bqr649k.cn`
- Path：`admin`
- **再加一条**：Path 填 `api/admin`

**应用 B（预览域名 —— 千万别漏）**
- Name：`diaoche-admin-preview`
- Subdomain：`diaoche-cn`
- Domain：`pages.dev`
- Path：`admin`
- **再加一条**：Path 填 `api/admin`

> ⚠️ 只保护生产域名 = 留后门。`.pages.dev` 是公开可达的，任何人都能从那里进后台。

### ☐ 10. 建策略

每个应用配一条 Policy：
- Action：`Allow`
- Include → **Emails** → 填你的邮箱

### ☐ 11. 加环境变量（双保险）

Pages 项目 → Settings → **Variables and Secrets**：

| 变量 | 值 |
|---|---|
| `ADMIN_EMAILS` | 你的邮箱（多个用逗号分隔） |

> 代码里还有一层邮箱白名单校验，即使 Access 被绕过也拦得住。

---

## 五、验证

### ☐ 12. 重跑 Actions

推一次代码，或去 Actions 页面点 **Re-run all jobs**。

预期全部步骤成功，最后一步输出部署 URL。

### ☐ 13. 按 DEPLOY.md 第 7 节做端到端验证

关键三项：
- 提交一条测试车源 → 前台**看不到**（pending 状态）
- 访问 `/admin/` → 要求登录
- 后台点「通过」→ 前台能看到

---

## 当前进度

| 项 | 状态 |
|---|---|
| 代码推送 | ✅ 完成（22 文件） |
| CI 流水线 | ✅ 前 6 步全绿，只差凭证 |
| Node 22 + wrangler 4 | ✅ 已修正 |
| GitHub Secrets | ⬜ **待你配置** |
| Cloudflare 资源 | ⬜ 待创建 |
| Access 保护 | ⬜ 待配置 |
