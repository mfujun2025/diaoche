# ✅ 后台 404 已解决 —— 线上验证全部通过

## 一句话

后台通了。`https://xn--bqr649k.cn/admin/` 现在能正常打开、输密钥进后台，不再 404。

---

## 线上实测结果（2026-09-21 上午，刚跑完）

| 检查项 | 结果 |
|---|---|
| `/admin/` | **200** ← 不再 302 跳 Access |
| `/api/admin/list`（无密钥） | **401** ← 门禁生效 |
| `login`（对密钥） | **200** ✅ |
| `list`（对密钥） | **200** ✅ |
| `login`（错密钥） | **401** ✅ |
| 前台 `/` `/trucks/` `/sell/` | **200** ✅ |
| `diaoche-cn.pages.dev/` | **200** ✅ |
| 车源数据拉取 | **3 条 pending（#2 #3 #4）** ✅ |

CI run **#24 success**。

---

## 病根定案

**Cloudflare 的官方已知限制**，不是配置错误。

官方 Pages Known Issues 原文：

> *"It is currently not possible to add a custom domain with a Cloudflare Access policy already enabled on that domain."*

**机制**：Access 认证完成后要把票兑成 `CF_Authorization` cookie，兑票路径必须落在受保护的主机名上。当受保护主机名是 Pages 自定义域名时，所有 `/cdn-cgi/*` 都被 Pages 静态资源层接管，到不了 Cloudflare 边缘 —— 必 404。

**铁证**（同一路径两个域名对比）：

| 路径 | `xn--bqr649k.cn` | `diaoche-cn.pages.dev` |
|---|---|---|
| `/cdn-cgi/access/authorized`（兑票） | **404** | 400（到了 Access） |
| `/cdn-cgi/access/certs`（取公钥） | **404** | **200，真实 JSON** |

`certs` 那条是定案关键：同一个 `/cdn-cgi/` 前缀，pages.dev 上 CF 边缘处理得好好的，自定义域名直接 404。

**认知修正**：之前判断为「多域名应用跨域种 cookie」导致，**不准确**。真病根更基础，跟应用挂几个域名无关。

---

## 最终方案：应用层密钥

放弃 Cloudflare Access，改在 Functions 里做密钥校验。

| 文件 | 作用 |
|---|---|
| `functions/api/admin/_auth.ts` | `verifyAdmin()` 读 `X-Admin-Key`，与 `DC_ADMIN_KEY` 恒定时间比较；未配置则一律拒绝（fail closed） |
| `functions/api/admin/login.ts` | `POST /api/admin/login` 供前端校密钥 |
| `public/admin.js` | 登录门禁；密钥存 `localStorage`；401 自动弹回登录框 |
| `src/site.mjs` | 后台页拆成「登录框 + 主界面」 |
| `scripts/build.mjs` | 登录框样式（含移动端适配） |

**进后台方式**：`https://xn--bqr649k.cn/admin/` → 输密钥 → 进审核界面。

---

## 做了什么

**代码侧（我）**
- 后台鉴权从 Access JWT 改为应用层密钥
- 变量换名 `ADMIN_TOKEN` → `DC_ADMIN_KEY`（解掉 CF 名字占用导致的「加不了 Secret」）
- 全链路本地实测 + 线上实测
- 提交 `65bb1f4` / `74868ff` / `f8cb283`，CI #22 #23 #24 全绿

**控制台侧（你）**
- 删掉 Access 应用「吊车.cn」
- 加上 Secret `DC_ADMIN_KEY`

---

## ⚠️ 一个遗留小问题

控制台里 `DC_ADMIN_KEY` **加了两条重复**（都是 Secret 类型）。目前能正常登录，说明取到的值是对的，但两条同名是隐患。

**建议**：去 `Settings → Variables and Secrets` 删掉其中一条（点最右边的垃圾桶图标）。删之前先确认能登进后台 —— 万一删错那条就得重新填一次值。

---

## 剩余待办

| 事项 | 说明 |
|---|---|
| 删重复的 `DC_ADMIN_KEY` | 见上 |
| 修 `www` 前缀 522 | 加 DNS：`www` CNAME → `diaoche-cn.pages.dev`，橙云开启 |
| 删 3 条测试车源（#2 #3 #4） | 进后台就能看到 |
| 吊销 GitHub PAT `ghp_...SATU8` | 排查时暴露过 |
| 清理 CF token `cfut_Urh2...` / `cfut_zRdge...` | 都已失效 |
| `/api/upload` 与 `/img` 无鉴权 | 可选上 Turnstile |
