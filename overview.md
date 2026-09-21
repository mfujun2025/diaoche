# 后台 404 问题：排查结论与交付

## 一句话结论

**后台 404 不是代码问题，是 Cloudflare 的官方已知限制。** 代码侧已全部改造完并上线，剩下的 3 步在 Cloudflare 控制台，需要你手动点（我的 CF token 已失效，没权限）。

---

## 病根定案

### 官方原文

Cloudflare Pages Known Issues 页面写着：

> *"It is currently not possible to add a custom domain with a Cloudflare Access policy already enabled on that domain."*

社区里有人报**一模一样的 404**：

> *"I get a 404 page not found: `https://preview.example.com/cdn-cgi/access/authorized?nonce=etc…`
> Everything works fine if I use the address directly `preview.example.pages.dev`"*

### 机制

Access 认证完成后，必须把票（`nonce` / `state`）兑成 `CF_Authorization` cookie，**兑票路径必须落在受保护的那个主机名上**。当受保护主机名是 Pages 自定义域名时，所有 `/cdn-cgi/*` 都被 Pages 的静态资源层接管，根本到不了 Cloudflare 边缘 —— 于是必 404。

### 实测铁证

| 路径 | `xn--bqr649k.cn` | `diaoche-cn.pages.dev` |
|---|---|---|
| `/cdn-cgi/access/authorized`（兑票） | **404** | 400（到了 Access） |
| `/cdn-cgi/access/certs`（取公钥） | **404** | **200，真实 JSON** |

`certs` 这两行是定案关键：同样是 `/cdn-cgi/*`，`pages.dev` 上 CF 边缘正常处理，自定义域名上直接 404。

### 完整死循环

```
① GET xn--bqr649k.cn/admin/
   → 302 mfujun.cloudflareaccess.com/cdn-cgi/access/login/xn--bqr649k.cn
② 输邮箱验证码，认证通过
③ 跳回 xn--bqr649k.cn/cdn-cgi/access/authorized?nonce=...
   ← ❌ 死在这里
```

### 认知修正

上一轮我以为病根是「多域名应用 + Eager redirect 跨域种 cookie」。**不准确**。真正病根更基础，跟应用挂几个域名、eager redirect 开不开**都无关**。

---

## 已完成的代码改造

后台防护从 Cloudflare Access 换成**应用层访问密钥**：

| 文件 | 改动 |
|---|---|
| `functions/api/admin/_auth.ts` | 读 `X-Admin-Key` 头，与 `DC_ADMIN_KEY` 恒定时间比较；未配置则一律拒绝（fail closed） |
| `functions/api/admin/login.ts` | 新增 `POST /api/admin/login` 供前端校密钥 |
| `public/admin.js` | 登录门禁；密钥存 localStorage；401 自动弹回登录框 |
| `src/site.mjs` | 后台页拆成「登录框 + 主界面」两块 |
| `scripts/build.mjs` | 补登录框样式（含移动端） |
| `wrangler.toml` / 文档 | 变量换名 `ADMIN_TOKEN` → `DC_ADMIN_KEY`，清理旧名残留 |

### 本地实测（全绿）

```
无密钥      login=401  list=401
错密钥      login=401  {"ok":false,"msg":"访问密钥不正确"}
对密钥      login=200  list=200  Bearer=200
旧头名      X-Admin-Token=401
前台 7 页   全部 200
```

wrangler 运行日志逐条印证，行为与预期完全一致。

### 线上状态

- 提交 `65bb1f4` / `74868ff` 已推送，**CI run #22、#23 全绿**
- 新代码**已部署上线**，但 Access 仍 302 拦截 —— 代码没机会执行

---

## 待你手动做的 3 步（详见项目里的 `下一步操作.md`）

1. **控制台加 Secret** `DC_ADMIN_KEY`（值 `eyOlJRg2TfjP6CYTqLCNIWW8MNhNlmJh`，本地已用同值实测通过）
2. **删掉 Access 应用**（破坏性操作：只影响 Access 登录，前台/数据/图片都不受影响）
3. **Retry deployment**（Secret 要重新部署才注入）

做完跟我说一句，我立刻线上验证。

---

## 其他待办

| 事项 | 说明 |
|---|---|
| `www` 前缀 522 | 加 DNS：`www` CNAME → `diaoche-cn.pages.dev`，橙云开启 |
| 吊销 GitHub PAT `ghp_...SATU8` | 排查时暴露过 |
| 删除 CF token `cfut_Urh2...` / `cfut_zRdge...` | `cfut_zRdge` 已失效（9109） |
| 删线上 2 条测试车源（ID #2、#3） | 进后台就能看到 |
| `/api/upload` 与 `/img` 无鉴权 | 可选上 Turnstile |
