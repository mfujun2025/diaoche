# 交付概述：邮箱验证码登录（替换「功能开发中」占位）

**状态**：✅ 代码已上线（提交 `b676be2` + `7acdfbd`）· ⚠️ **远程 D1 建表由 CI 自动完成**

---

## 一句话

把详情页那张「登录（开发中）」的占位卡片，换成能真正用的邮箱验证码登录。
登录后自动显示卖家联系方式，退出后重新拦截。

---

## 为什么是邮箱验证码（不是手机号 / 微信）

这三条路的**硬约束是 ICP 备案** —— 本站全链路境外节点，不做备案，这直接卡死了两条路：

| 方案 | 卡在哪 |
|---|---|
| **手机号 + 短信** | 短信通道要**企业资质**（营业执照 + 法人）；部分服务商**要求网站有备案号**才给签名；按条计费，还得自己做图形验证码防刷 |
| **微信扫码登录** | 开放平台网站应用审核**明确要求填备案号** —— 本站没备案，大概率直接驳回。认证费 300 元/年 |
| **邮箱验证码** ✅ | 零资质、零成本、无备案要求。**表结构与接口按手机号登录设计**，将来要换通道只替换发码层 |

结论：现阶段上邮箱验证码，是唯一能立刻落地且不欠技术债的选择。

---

## 数据库设计（4 张新表）

```
users        id / email_hash(UNIQUE) / created_at / last_seen / status
login_codes  id / email_hash / code_hash / ip / attempts / used / expires_at
sessions     token_hash(PK) / user_id / ua / ip / expires_at / last_used
send_log     id / kind('ip'|'email') / key / created_at      ← 限流日志
```

### ★ 隐私最小化：全程不存明文

邮箱、验证码、会话 token **一律 SHA-256 加盐后入库**。

为什么用哈希不用加密：这里**不需要还原出原文**，只需要「比对是否一致」。
加密要管密钥、要担心密钥泄露；哈希没这个负担。**能哈希就绝不明文。**

这条承诺有**硬验证**：集成测试里用 `PRAGMA table_info` 断言三张表**都没有**
`email` / `code` / `token` 明文列。不是靠自觉，是跑出来的。

### 多设备并存

每次登录新增一条 `sessions` 记录，互不踢。退出登录只删当前那条，其他设备不受影响。
会话 30 天，`token_hash` 做主键。

---

## 四个接口

| 方法 | 路径 | 作用 |
|---|---|---|
| POST | `/api/auth/send-code` | 发验证码，三重限流 |
| POST | `/api/auth/verify` | 校验码 → 首次自动注册 → 建会话 → 种 Cookie |
| GET | `/api/auth/me` | 查登录态（只返回 true/false，**不返回邮箱**） |
| POST | `/api/auth/logout` | 退出（只注销当前设备） |

### 首次登录自动注册

邮箱验证码登录的本质就是「**拥有这个邮箱 = 身份**」，不需要单独的注册表单。
用户少一步操作，转化率更高。

并发安全性：用 `INSERT OR IGNORE` + 重新查一次拿 id。
不用 `last_row_id` 是因为**该字段名在不同运行时不一致**（D1 vs node:sqlite），
查回来是唯一可靠的方式，顺带覆盖了「被并发请求抢先插入」的情况。

---

## 安全设计（逐条）

### 验证码生成

```js
// ❌ 不能这样：Math.random 是非密码学安全的伪随机，可被预测
Math.floor(Math.random() * 1000000)

// ✅ 用 getRandomValues + 拒绝采样
const MAX = 4294967296 - (4294967296 % 1000000);
do { crypto.getRandomValues(buf); v = buf[0]; } while (v >= MAX);
return String(v % 1000000).padStart(6, '0');
```
拒绝采样是为了**避免取模带来的分布偏斜**（直接 `% 1000000` 会让低位数字出现概率偏高）。

### 三重限流

| 维度 | 上限 | 挡什么 |
|---|---|---|
| 同一 IP / 每分钟 | 1 次 | 连点、简单脚本 |
| 同一 IP / 每小时 | 5 次 | 单机批量刷 |
| **同一邮箱 / 每小时** | 3 次 | **恶意骚扰他人邮箱** |

判定顺序有讲究：先挡最短窗口（每分钟），命中率最高、对正常用户打扰最小。

### 验证码规则

- 6 位数字，**10 分钟**过期
- **5 次**尝试上限（6 位共 100 万种，5 次机会下暴力破解不现实）
- 用完即标记 `used`（**防重放**）
- 发新码时把旧码标记 `used`（**避免多码并存扩大被猜面**）

### 会话 Cookie

```
dc_session=<随机token>; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure
```
- `HttpOnly` —— JS 读不到，防 XSS 偷 token
- `Secure` —— 仅 HTTPS（本地开发自动降级，否则浏览器不保存）
- `SameSite=Lax` —— 挡跨站 POST 的 CSRF，又不影响「从搜索引擎点进来」
- **库里只存 token 的哈希** —— 即便库泄露也拿不到能直接用的 Cookie

### 邮箱枚举防护

不管邮箱是否已注册，`send-code` 一律返回同样的成功响应。
否则攻击者能拿这个接口当「查这个邮箱有没有在你这注册过」的探测器。

### fail closed

- 会话查询抛异常 → 返回「要登录」，**宁可让用户重登也不误放行**
- 邮件发送失败 → 立即把该验证码作废，免得用户拿着一个永远收不到的码干等

---

## 分层架构（为了可测）

```
src/auth-core.mjs              纯逻辑：哈希 / 随机码 / Cookie / 门禁 / 限流判定
functions/api/_session.ts      会话校验，多接口共用
functions/api/_mail.ts         邮件通道抽象（Resend）
functions/api/auth/*.ts        四个接口，只做「解析请求 → 调上面 → 拼响应」
```

**为什么要分这三层**：本机 `wrangler pages dev` 的 Functions 路由不可信
（技能 §9.5.1 记录的坑）。把纯逻辑摘出来，就能在 Node 里秒级跑全量断言。

下划线开头的文件（`_session.ts` / `_mail.ts`）**不会**被当成路由，
所以放共享模块是安全的 —— 这个模式项目里已在用（`admin/_auth.ts`）。

---

## 邮件通道

用 **Resend**（免费 3000 封/月、100 封/天，对小站足够）。

**为什么不用 SMTP**：Cloudflare Workers / Pages Functions **没有 TCP socket 能力**，
连不上 25/465/587 端口，只能走服务商的 HTTP API。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DC_RESEND_KEY` | 生产必填 | Resend API Key（`re_` 开头） |
| `DC_MAIL_FROM` | 生产必填 | 形如 `吊车.cn <noreply@xn--bqr649k.cn>`，发件域名要先在 Resend 验证 DNS |
| `DC_AUTH_SALT` | 建议填 | 邮箱哈希的全局盐。**填了之后不要再改**，改了所有已注册用户会对不上号 |
| `DC_MAIL_DEV_MODE` | 仅调试 | `1` 时把验证码放进响应体。⚠️ **生产绝不能开** —— 等于把验证码送给任何人 |

未配 `DC_RESEND_KEY` 时进入**开发模式**：不真发邮件、不返回验证码，
只在服务端日志打印。这样代码可以先行上线，不会报错，也不会泄漏。

---

## 前端改动

- `loginGateHtml()` 从占位卡片换成真实表单（邮箱 + 验证码 + 60 秒倒计时）
- **★ 登录成功后自动重试获取联系方式** —— 不让用户再点一次
- 验证码框只收数字、自动截断 6 位、输满自动聚焦登录按钮
- 验证码作废类错误（过期 / 超次数）自动清空输入并恢复发码按钮
- 已登录态显示「退出登录」，退出后还原成初始态
- 把 `loadContact()` 抽成独立函数 —— 因为登录后要复用，内联在事件回调里没法复用

---

## 验证（三层，全部通过）

### ① 纯逻辑单测 —— `scripts/test-auth.mjs` · **200 项全绿**

覆盖：邮箱规范化（含「不动 gmail 点号」这个易错点）、SHA-256 标准向量、
随机码格式与分布、Cookie 属性、ISO 字典序 == 时间序、
门禁四分支、限流顺序、验证码六种失败态、恒定时间比较、IP 打码、邮件的 HTML 转义。

### ② 真实 SQL 集成 —— `scripts/test-auth-db.mjs` · **64 项全绿**

用 Node 内置 `node:sqlite` 建同构库，**直接执行线上 `schema.sql`**，把 SQL 逐条跑真。
覆盖：发码写入、attempts 累加、新旧码互斥、自动注册幂等、
并发注册（`INSERT OR IGNORE` 不抛异常）、多设备并存、
过期清理、封禁用户、退出只删当前设备、限流 COUNT 查询、**车源表回归**。

### ③ 线上端到端 —— `scripts/cdp-auth.mjs` · 20 项通过

真浏览器跑，覆盖前两层测不到的：**Cookie 能否被浏览器真正保存并带上**、
**HttpOnly 是否真的生效**（`document.cookie` 里应看不到）、
登录后自动重试链路、前端交互、伪造 token 被拒、退出后重新被拦。

---

## ⚠️ 首轮部署踩的坑：库表缺失导致接口 500

**现象**：登录代码上线后，线上 `/api/auth/send-code` 返回 500。

**诊断过程**（对比法定位）：

| 接口 | 结果 | 原因 |
|---|---|---|
| `/api/auth/me` | **200** | 纯 Cookie 判断，**不查库**，无表也能跑 |
| `/api/auth/send-code` | **500** | 要查 `send_log` 表，表不存在直接抛异常 |

→ 单个接口 500 而同批接口正常时，先怀疑**它是不是唯一依赖了新的存储**。

**根因**：代码上线了但远程 D1 没建表，属部署流程漏洞，不是代码问题。

**修复**：CI 里部署前新增幂等建表步骤
```
d1 execute diaoche-db --file=./schema.sql --remote
```
`schema.sql` 全是 `CREATE TABLE IF NOT EXISTS`，反复执行安全。

**顺带**：CI 里也加上了跑三个测试的步骤（纯逻辑 + 内存库，不需要网络与凭据）。

---

## 副作用与兼容

- **`contact.ts` 的契约没变**：`401 + { ok:false, needLogin:true, msg }`。
  所以这次接真实登录，前端只是把占位框换成真表单，其他接口零改动。
- **零新增运行时依赖**：`node:sqlite` 是 Node 22 内置；Resend 走 `fetch`。
- 车源表、长尾页、sitemap 全部未受影响（集成测试里有回归断言）。

---

## 你需要做的（3 步）

1. **确认 CI 跑过建表**（提交 `7acdfbd` 的 workflow run 里的
   `Apply D1 schema (idempotent)` 步骤应该是绿的）。
   若想手动执行：
   ```
   npx wrangler d1 execute diaoche-db --file=./schema.sql --remote
   ```

2. **注册 Resend 并配两个环境变量**（Cloudflare Pages → Settings → Variables and Secrets）：
   - `DC_RESEND_KEY` = 你的 Resend API Key
   - `DC_MAIL_FROM` = 验证过 DNS 的发件地址
   - 建议再加 `DC_AUTH_SALT` = 一串随机值
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   配完 **Retry deployment** 一次。

3. **等 Resend 域名验证通过后**，用真实邮箱在详情页走一遍完整流程。

> 在 2 完成前，`send-code` 接口会返回成功但不真发邮件（开发模式），
> 用户永远收不到码。所以配 Resend 是让登录真正可用的**必要一步**。
