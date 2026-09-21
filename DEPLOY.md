# 吊车.cn 上线操作手册

> 从零到上线，全程只用 **GitHub + Cloudflare**，零服务器、零第三方云。
> 仓库：`mfujun2025/diaoche`

---

## 0. 前置准备

| 项 | 说明 |
|---|---|
| GitHub 账号 | 已具备（`mfujun2025`） |
| Cloudflare 账号 | 免费注册即可，无需付费 |
| 域名 | `吊车.cn`，**必须把 NS 改到 Cloudflare**（关键前提） |
| Node.js | **≥ 22**（wrangler v4 硬性要求；GitHub Actions 里也用 22） |
| npm | 随 Node 附带（本机 10.9.7） |
| wrangler | **必须是 v4**（v3 不支持 `pages_build_output_dir`，会读不到配置） |

### 环境检查命令

```bash
node -v            # 应 ≥ v22（v20 下 wrangler 会直接报错退出）
npm -v
npx wrangler --version   # 应是 4.x
```

**本项目唯一的 npm 依赖是 `wrangler`（devDependency）**，构建与运行都是 Node 原生能力，
无任何运行时依赖 —— 这是刻意设计的，保证部署环境不挑、构建快、无供应链风险。

> ⚠️ 若 `npx wrangler --version` 显示 3.x，执行 `npm install -D wrangler@^4` 升级。
> v3 会报 "Unknown arguments" 或静默读不到 `wrangler.toml`，是实装时踩过的坑。

---

## 1. 中文域名处理（最容易踩的坑）

中文域名在**所有技术配置里必须写 punycode（ASCII）形式**，写中文会导致证书签发失败、部署报错。

本机已实测 `吊车.cn` 的转换结果：

```
吊车.cn  →  xn--bqr649k.cn
```

> 注意：上线前请在 Cloudflare 域名列表里核对一遍实际值（以 CF 显示为准）。
> 如果注册的是 `吊车.中国`，则是另一种后缀，需单独换算。

**规程：**
- Cloudflare Pages 自定义域名 → 填 punycode
- DNS 记录 → 填 punycode
- `src/site.mjs` 里的 `SITE.url` → 填 punycode（当前已是 `https://xn--bqr649k.cn`）

---

## 2. GitHub 仓库初始化

```bash
cd diaoche-cn
git init
git add .
git commit -m "init: 吊车.cn 二手吊车信息平台"
git branch -M main
git remote add origin git@github.com:mfujun2025/diaoche.git
git push -u origin main
```

> 如果本机 `git push` 被拦截（Watt Toolkit 环境），改用 GitHub Data API 的通道，或临时关掉代理软件再推。

---

## 3. Cloudflare 侧配置（按顺序执行）

### 3.1 创建 D1 数据库

Cloudflare 控制台 → **Workers & Pages → D1** → Create database

- 名称：`diaoche-db`
- 创建后复制 **Database ID**，回填到 `wrangler.toml` 的 `database_id`

然后初始化表结构（二选一）：

```bash
# 方式 A：本地执行（推荐，可在本地调试）
npx wrangler d1 execute diaoche-db --file=./schema.sql --local

# 方式 B：远程执行（部署到线上库）
npx wrangler d1 execute diaoche-db --file=./schema.sql --remote
```

> ⚠️ 线上运行必须用 `--remote`，否则 CF 线上库没有表，提交表单会 500。

### 3.2 创建 R2 存储桶（图片用）

> **当前状态：已完成**。桶名 `diaoche-images`，Pages 已绑定 `IMAGES`（production + preview）。
> Token 权限问题已解决，CI 带 R2 绑定可正常发布。

控制台 → **R2** → Create bucket → 名称 `diaoche-images`

> ⚠️ **不要给这个桶绑自定义域名**（至少中文域名别绑）。
> 实测在 punycode zone（`xn--bqr649k.cn`）上绑 R2 自定义域会报
> `Must be a valid domain on cloudflare.com zone`，即使 zone 是 Full setup、
> DNS 干净、换个 `test.` 子域名也一样，判断是 CF 的缺陷。
> 图片展示改用 Functions 代理 → 见 3.7 节。

> ⚠️ 改 token 权限后，**必须同步更新 GitHub Secret** `CLOUDFLARE_API_TOKEN`，
> 否则 CI 用的还是旧 token，依然没权限。

### 3.3 创建 Cloudflare Pages 项目

> **当前状态：已创建**，项目名 `diaoche-cn`，production branch = `main`。

控制台 → **Workers & Pages → Create → Pages → Connect to Git**

- 选择仓库：`mfujun2025/diaoche`
- 分支：`main`
- 构建命令：**留空**（构建交给 GitHub Actions，避免重复构建）
- 构建输出目录：`dist`

> 到这里其实已经能自动部署了。但为了更可控，我们**用 GitHub Actions 触发部署**（第 4 步），
> 上面的 Pages 项目创建后，只需保留项目本身，构建可以交给 Actions。

**如果走 Actions 部署，Pages 项目的构建设置填成：**
- Framework preset：`None`
- Build command：留空
- Build output directory：`dist`

### 3.4 创建 API Token（给 Actions 用）

My Profile → **API Tokens → Create Token → Custom token**

权限最小集：

| 权限 | 级别 |
|---|---|
| Account → Cloudflare Pages | Edit |
| Account → D1 | Edit |
| Account → Workers R2 Storage | Edit |

创建后保存 Token（只显示一次）。同时从右侧栏复制 **Account ID**。

### 3.5 绑定自定义域名

Pages 项目 → **Custom domains → Set up a domain**

- 填入：`xn--bqr649k.cn`
- 如果域名 NS 已在 Cloudflare，会自动创建 CNAME 记录并签发证书（1~5 分钟）

同时绑定 `www`：
- 加 `www.xn--bqr649k.cn`，或在 Cloudflare 用 Redirect Rule 把 www 301 到裸域

### 3.6 保护后台：访问密钥（`DC_ADMIN_KEY`）

后台地址：`https://xn--bqr649k.cn/admin/`

**方案：应用层密钥登录。** 打开后台会先看到登录框，输入 `DC_ADMIN_KEY` 才进得去；密钥存在浏览器 localStorage，所有 admin 接口请求带 `X-Admin-Key` 头，服务端用**恒定时间比较**校验。

#### 为什么不用 Cloudflare Access

最初用的是 Access（邮箱 + 验证码），但实测踩到一个**无法绕过的坑**：

> **Cloudflare Pages 自定义域名 + Access 多域名应用 = 认证回调 404**

具体表现：把一个 Access 应用同时挂在 `xn--bqr649k.cn` 和 `diaoche-cn.pages.dev` 上时（官方称为 multi-domain application），
认证完成后 Access 需要靠一串跨域重定向逐域种 cookie，其中会经过：

```
https://xn--bqr649k.cn/cdn-cgi/access/authorized?nonce=...&state=...
```

实测这个路径在**自定义域名上返回 404**（Pages 的 404 页），而在 `pages.dev` 上返回 400（正常走到 Access）。
结果：认证走完却回不来，浏览器停在 404 页面。

对照数据：

```
xn--bqr649k.cn/admin/        => 302 要求登录，但登录后卡在 404
diaoche-cn.pages.dev/admin   => 正常放行（无痕窗口实测：不要求登录）
```

**结论：Pages 自定义域名与 Access 的 `/cdn-cgi/*` 处理存在冲突，改用应用层密钥彻底绕开。**

> 注意：`exclude: ["/cdn-cgi/*"]` **解决不了这个问题** —— 官方文档明确 `exclude` 的语义是「该路径不调用 Functions」，
> 之后仍回落到 Pages 静态资源，找不到文件照样 404，不会交给 CF 边缘处理。

#### 配置步骤

**第一步：设密钥**

`wrangler.toml` 的 `[vars]`（明文，仓库可见）：

```toml
[vars]
ENV = "production"
SITE_NAME = "吊车.cn"
DC_ADMIN_KEY = "你的随机密钥"
```

**更安全的做法**是用加密 Secret（不进仓库、不可读回）：

```bash
# 方式一：命令行
npx wrangler pages secret put DC_ADMIN_KEY --project-name diaoche-cn

# 方式二：控制台
Workers & Pages → diaoche-cn → Settings → Variables and Secrets → Add → Secret
```

> Secrets 优先级高于 `[vars]`，同名会覆盖。

密钥建议用密码管理器生成 32 位以上随机串，例如：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

**第二步：重新部署**（改 `wrangler.toml` 需 push 触发 CI；改 Secret 需重新部署一次才生效）

**第三步：验证**

```bash
# 无密钥 → 应 401
curl -s -o /dev/null -w "%{http_code}\n" https://xn--bqr649k.cn/api/admin/list

# 错密钥 → 应 401
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Admin-Key: wrong" https://xn--bqr649k.cn/api/admin/list

# 对密钥 → 应 200
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-Admin-Key: 你的随机密钥" https://xn--bqr649k.cn/api/admin/list
```

浏览器访问 `https://xn--bqr649k.cn/admin/` → 出现「后台登录」→ 输入密钥 → 进入审核界面。
登录一次后同浏览器免登录，右上角「退出」可清除。

#### 安全说明（务必知道代价）

| 项 | 说明 |
| --- | --- |
| **fail closed** | `DC_ADMIN_KEY` 未配置时，**所有 admin 接口一律拒绝**（不会裸奔）。代价：忘配则后台进不去，需重新部署 |
| **恒定时间比较** | 防时序攻击，避免逐位比较泄露密钥内容 |
| **无频率限制** | 目前登录接口没有失败次数限制。密钥是 32 位随机串，暴力破解不可行，但建议后续加限流 |
| **密钥在 localStorage** | 仅防 XSS 场景足够（本站无用户输入渲染到后台页）。比 Access 弱在：没有第二因素 |
| **页面本身不加密** | `/admin/` 的 HTML 是公开的（登录框），真正的数据在 API 后面。这点比 Access 弱（Access 连页面都拦） |
| **`/api/upload` 与 `/img`** | **不在保护范围**，仍无鉴权（见待办） |

**如果哪天要回到 Access**：单域名应用（一个应用只挂一个域名）不会触发上述冲突，可以先把 `diaoche-cn.pages.dev` 单独做成一个应用验证。

#### 已废弃的环境变量

`ADMIN_EMAILS` 已不再使用（那是 Access 时代的邮箱白名单）。可以留着不管，代码不再读取。

---

### 3.7 图片访问：Functions 代理

> **当前状态：已完成**。图片地址形如 `https://xn--bqr649k.cn/img/trucks/202609/xxxxxxxx.png`

#### 为什么不用 R2 自定义域名

在 CF 控制台给 R2 桶绑自定义域名时（R2 → 桶 → Settings → Public access → Custom Domains），
在中文域名（punycode）zone 上会稳定报：

```
Must be a valid domain on cloudflare.com zone (example.com, sub.example.com)
```

**已排查排除的因素**：

| 怀疑点 | 实际情况 |
|---|---|
| 输入带隐藏字符 | ❌ 换 `test.xn--bqr649k.cn` 手打同样报错 |
| DNS 有残留错误记录 | ❌ DNS 只有 2 条正确记录，无 `img` 残留 |
| zone 不在该账号 | ❌ zone 在账号内且 Active |
| zone 是部分接入 | ❌ DNS Setup 显示 **Full** |

结论：判断为 CF 对 punycode zone 的 R2 自定义域校验缺陷。**改用 Functions 代理绕开。**

#### 实现

`functions/img/[[path]].ts` —— catch-all 路由，从 R2 读流返回：

```ts
const segs = ctx.params.path;                    // ["trucks","202609","abc.png"]
const key = [].concat(segs).join('/');
if (!/^trucks\/[A-Za-z0-9._\/-]+$/.test(key)) return 404;  // 白名单，拒 .. 与其它前缀
const obj = await ctx.env.IMAGES.get(key);
return new Response(obj.body, {
  headers: {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: obj.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  },
});
```

配套改动：

- `public/_routes.json` → `include: ["/api/*", "/img/*"]`（**必须加，否则请求到不了 Function**）
- `public/app.js` → `IMG_BASE = '/img'`（相对路径，同域无 CORS）

#### 这个方案的好处

- 不依赖 R2 自定义域，绕开 CF 缺陷
- 域名统一（都在 `吊车.cn` 下），不用多个子域
- 以后加防盗链、限流、水印都在自己代码里
- 免费额度：Functions 每天 10 万次请求，当前体量绰绰有余

#### 注意事项

- 免费额度用尽后 Functions 会停，图片就 404。用 `Cache-Control: immutable` 让 CDN 扛住绝大部分请求
- key 白名单**必须保留**，否则可通过构造 key 读取桶内其它对象

---

## 4. GitHub Secrets 配置

仓库 → **Settings → Secrets and variables → Actions → New repository secret**

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 3.4 创建的 Token |
| `CLOUDFLARE_ACCOUNT_ID` | 3.4 复制的 Account ID |

配好后，向 `main` 推一次代码，Actions 会自动构建并部署。

---

## 5. 发布流程

```
本地改代码
   ↓
git add . && git commit -m "xxx"
   ↓
git push origin main
   ↓
GitHub Actions 自动触发（约 1~2 分钟）
   ↓
构建 dist/ → 部署到 Cloudflare Pages
   ↓
全球 CDN 生效（30~60 秒）
   ↓
预览地址：https://<commit-hash>.diaoche-cn.pages.dev
生产地址：https://吊车.cn
```

**回滚**：Cloudflare Pages → Deployments → 选任意历史版本 → Rollback，秒级生效。

---

## 6. 本地开发与调试

```bash
# 首次准备
npm install              # 安装依赖（主要是 wrangler）
npm run db:init:local    # 建本地 D1 表

# 纯静态预览（不含 API，用于调样式）
npm run dev              # → http://localhost:8080

# 带 Functions + D1 的完整本地环境（推荐，能测真实业务流）
npm run preview          # → wrangler pages dev dist
```

> ⚠️ 本地调 API 必须用 `npm run preview`，`npm run dev` 只是静态服务器，`/api/*` 会 404。

### 本地覆盖环境变量

`wrangler.toml` 的 `[vars]` 是生产默认值。本地要改（比如测白名单），复制模板：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填你的邮箱
```

**改完必须重启 `wrangler pages dev` 才生效**（热重载不覆盖变量）。`.dev.vars` 已在 `.gitignore` 中，不会误提交。

### 本地数据的位置

本地 D1 数据存在 `.wrangler/state/` 下，与线上库完全隔离。
本地测试造的数据不会影响线上，清空用：

```bash
npx wrangler d1 execute diaoche-db --local --command "DELETE FROM trucks"
```

---

## 7. 部署验证（已实测）

本项目所有接口已在本机用 `wrangler pages dev` 完整跑通，18 项测试全通过。部署后可照此清单复验。

### 7.1 基础连通性

```bash
B=https://your-domain        # 换成你的域名
for p in / /trucks/ /sell/ /rent/ /price/ /guide/ /admin/ ; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' $B$p)  $p"
done
# 预期：全部 200（/admin/ 会 302 跳 Access 登录页，也算正常）
```

### 7.2 提交接口

```bash
# 正常提交 → 预期 {"ok":true,...}
curl -s -X POST $B/api/submit -H 'Content-Type: application/json' \
  -d '{"tonnage":25,"brand":"徐工","contact":"13800000000"}'

# 缺必填 → 预期 HTTP 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/submit \
  -H 'Content-Type: application/json' -d '{"brand":"徐工"}'

# 吨位越界 → 预期 HTTP 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST $B/api/submit \
  -H 'Content-Type: application/json' -d '{"tonnage":99999,"brand":"徐工","contact":"138"}'
```

### 7.3 审核隔离（最关键的一项）

```bash
# 刚提交的车源不应出现在前台列表（因为还是 pending）
curl -s "$B/api/trucks" 
# 预期：刚提交的那条不在 data 里

# 后台接口未登录 → 预期 HTTP 401
curl -s -o /dev/null -w '%{http_code}\n' "$B/api/admin/list"
```

### 7.4 完整闭环

1. 打开 `/sell/` 提交一条测试车源
2. 访问 `/admin/` → 输邮箱验证码登录
3. 待审列表点「通过」
4. 回到 `/trucks/` → 该车源应出现
5. 后台点「驳回」→ 前台应消失

**跑完记得删掉测试数据**（后台点「删除」即可）。

---

## 8. 常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| 证书签发失败 / 域名不可访问 | 域名写了中文 | 全部改 punycode |
| 提交表单返回 500 | 线上 D1 没建表 | `npx wrangler d1 execute diaoche-db --file=./schema.sql --remote` |
| Actions 报 wrangler 权限不足 | Token 权限缺失 | 补 `Pages:Edit` + `D1:Edit` |
| 车源列表一直"加载中" | `/api/trucks` 404 | 确认 `functions/api/` 目录被识别，本地用 `npm run preview` |
| 提交后前台看不到 | 状态是 `pending` | 去 `/admin/` 审核通过 |
| 打开 `/admin/` 只有登录框，进不去 | `DC_ADMIN_KEY` 没配或输错 | 三个接口都试：无密钥/错密钥应 401，对密钥应 200。未配密钥时接口**全部拒绝**（fail closed），需在 `wrangler.toml` 或控制台 Secret 里补上再重新部署 |
| 登录后立刻又弹回登录框 | localStorage 里的密钥失效 | 密钥被改过 → 重新输入新的。或浏览器禁用了 localStorage |
| 忘了 `DC_ADMIN_KEY` 是什么 | 明文变量可读回 | `wrangler.toml` 里能直接看到。若改用 Secret 则无法读回，只能重设 |
| 控制台 Variables 全是灰的、改不了也加不了 | 环境变量由 `wrangler.toml` 托管 | 改 `wrangler.toml` 的 `[vars]`，推上去由 CI 生效。**但 Secrets 可以在控制台加**（不受此限制） |
| **访问 `www.吊车.cn` 返回 522** | **浏览器把 `吊车.cn` 自动补成了 `www.`，而 `www` 没有 DNS 记录** | 加一条 `www` CNAME → `diaoche-cn.pages.dev`（橙云开）。访问后台请直接粘贴 punycode 地址 `https://xn--bqr649k.cn/admin/`，浏览器不会改写 punycode |
| ~~打开 `/admin/` 直接可见，没要登录~~ | ~~Access 没配~~ | **已改用应用层密钥，此行保留仅作历史参考** |
| ~~Access 认证后停在 404~~ | ~~Pages 自定义域名与 Access 的 `/cdn-cgi/*` 冲突~~ | **已改用应用层密钥绕开。详见 3.6** |
| **`wrangler pages dev` 报 "Unknown arguments" 或读不到 wrangler.toml** | **wrangler 是 v3，不支持 `pages_build_output_dir`** | **`npm install -D wrangler@^4`** |
| **Actions 报 "Wrangler requires at least Node.js v22.0.0"** | **workflow 里 `setup-node` 设成了 20** | **改成 `node-version: '22'`**（这是实测踩到的，v4 硬性要求 Node ≥22） |
| Actions 报 `npx canceled due to missing packages` | workflow 缺 `npm ci` | 在 Build 之前加 `- run: npm ci` |
| `npm run preview` 里 POST 返回 502 | 服务被前台 shell 回收 | 用独立终端跑，别用 `&` 后台启动后立刻返回 |
| 改了 `.dev.vars` 但变量没变 | wrangler 不热重载变量 | 重启 `wrangler pages dev` |
| `npx wrangler pages deploy` 报 unknown `--dry-run` | 该参数不存在 | 用 `wrangler pages dev` 本地验证即可 |

### 车源审核

新提交的车源 `status = 'pending'`，不会出现在前台。**推荐用后台页面审核**：

> 访问 `https://xn--bqr649k.cn/admin/` → 输入 `DC_ADMIN_KEY` → 在待审列表点「通过 / 驳回 / 删除」即可。

备用方式（命令行，适合批量）：

```bash
npx wrangler d1 execute diaoche-db --remote \
  --command "UPDATE trucks SET status='approved' WHERE id=1"
```

---

## 9. 免费额度对照

| 服务 | 免费额度 | 本站消耗预估 |
|---|---|---|
| GitHub Actions | 公开库无限 / 私有 2000 分钟/月 | 每次构建约 1 分钟 |
| Cloudflare Pages | 500 次构建/月、无限带宽 | 够用 |
| Cloudflare D1 | 5GB 存储、500 万行读/天 | 车源量级完全够 |
| Cloudflare R2 | 10GB 存储 | 约可放数千张图 |

**总成本：0 元/月（不含域名年费）。**

---

## 10. 上线检查清单

- [ ] `吊车.cn` NS 已改到 Cloudflare
- [ ] punycode 已核对，`SITE.url`、Pages 域名一致
- [ ] D1 已建库，`database_id` 已回填 `wrangler.toml`
- [ ] 线上库已执行 `schema.sql`（`--remote`）
- [ ] GitHub Secrets 两个已配置
- [ ] Actions 首次构建成功
- [ ] 首页 / 车源大厅 / 卖车表单三个页面可正常访问
- [ ] 提交一条测试车源 → D1 里能查到
- [ ] **`DC_ADMIN_KEY` 已设置（`wrangler.toml` 的 `[vars]` 或控制台 Secret），访问 `/admin/` 会要求输入密钥**
- [ ] **无密钥访问 `/api/admin/list` 返回 401**
- [ ] 在 `/admin/` 点「通过」→ 前台车源大厅能看到该车源
- [ ] 移动端（手机）打开首页，排版正常

---

## 11. 免备案部署说明（本项目采用）

本方案 **不需要 ICP 备案**，原因和代价如下。

### 为什么不需要备案

备案（ICP）的触发条件是**服务器位于中国大陆境内**。本项目：

- 托管：Cloudflare Pages → 全球边缘节点，**不含中国大陆节点**
- 数据库：Cloudflare D1 → 境外
- 对象存储：Cloudflare R2 → 境外
- 构建：GitHub Actions → 境外

全链路没有一个中国大陆服务器，因此**不触发备案要求**。域名 NS 改到 Cloudflare 后由 CF 解析，也无需在注册商侧提交备案。

> 注意：域名本身在谁家注册、是否 `.cn` 后缀，都不决定要不要备案；**决定因素是服务器在哪**。

### 代价（要提前接受）

| 项 | 影响 |
|---|---|
| 国内访问速度 | 无大陆节点，**延迟比国内云高**（通常 100~250ms），无 CDN 加速则更明显 |
| 访问稳定性 | 跨境链路波动，部分地区/运营商可能偶发慢或不稳 |
| 移动端体验 | 4G/5G 下首屏比国内站慢，需靠静态化 + 内联样式缓解（本项目已做） |
| 微信内打开 | 未备案域名在微信内可能被拦截或提示风险，**分享裂变受限** |
| 部分平台推广 | 百度推广、抖音等国内投放渠道通常要求备案 |

### 优化建议（不备案的前提下）

1. **前端尽量做静态化**：本项目已是纯静态 + 样式内联，无 JS 框架开销，这是免备案方案下最优的形态
2. **图片走 R2 + Functions 代理**（`/img/<key>`），可开启 Cloudflare 的自动压缩（Polish / WebP）
3. **优先做 SEO 长尾**，不依赖微信裂变和国内信息流投放
4. **若后期必须国内加速**：可评估 Cloudflare 的中国网络服务（企业版付费），或改为国内云 + 备案 —— 但那就推翻了当前的零成本架构，需重新权衡

### 结论

**当前阶段（冷启动、做 SEO 内容期）免备案完全可行，成本 0 元。** 等站真正起量、需要做国内投放和微信传播时，再评估是否迁到国内节点并备案。

---

## 12. 合规提醒（重要）

1. **平台定位**：本站为信息服务，不参与交易、不垫资、不做担保 —— footer 已明示，勿删。
2. **不编造车源与成交价**：行情价格页已标注"公开信息整理，仅供参考"。切勿伪造真实成交数据。
3. **信息审核**：垃圾信息、虚假车源及时下架，保留审核记录。
4. **后台必须加 Access**：`/admin/` 暴露等于把车源库交给任何人，见 3.6。
5. **不涉及经营性业务**：目前无在线支付、无交易担保，属信息发布范畴；若后期加在线支付或交易撮合收费，业务性质会变化，需重新评估合规要求。
