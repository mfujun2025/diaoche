# 吊车.cn · 本轮修复报告

**日期**：2026-09-21
**线上地址**：<https://xn--bqr649k.cn/> · <https://www.xn--bqr649k.cn/>

---

## 一、你上轮问的 `www` 问题 —— 已经好了

上轮 `www.xn--bqr649k.cn` 显示 🟠 Verifying，现在实测：

| 地址 | 状态 |
|---|---|
| `https://www.xn--bqr649k.cn/` | **200** ✅ |
| `https://www.xn--bqr649k.cn/trucks/` | **200** ✅ |
| `https://www.xn--bqr649k.cn/trucks/2/` | **200** ✅ |

带 `www` 和不带 `www` 都能进站，内容完全一致。**这一项不用再管了。**

---

## 二、但配好 `www` 之后，暴露了一个真 bug —— 已修

### 症状

你从 `www.` 进站，点车源 → 进详情页 → 点「查看联系方式」→ **永远失败**。

### 原因

`contact` 接口有个「来源校验」，防止别人直接扒你的联系方式。这个校验用的是**写死的域名白名单**：

```
xn--bqr649k.cn
吊车.cn
diaoche-cn.pages.dev
*.diaoche-cn.pages.dev
localhost
```

你从 `www.` 进来，浏览器带过去的来源是 `www.xn--bqr649k.cn` —— **名单里没有它，直接拦掉。**

线上实测复现：

```
Referer: https://www.xn--bqr649k.cn/trucks/2/
→ {"ok":false,"msg":"请求来源不合法"}  [403]
```

### 修法

白名单从「逐个写死域名」改成**后缀匹配**：

```
域名 == 'xn--bqr649k.cn'  或  域名 以 '.xn--bqr649k.cn' 结尾
```

这样一来 **`www` / `m` / 以后你再加任何子域，全都自动覆盖**，不会再出现「加了域名但白名单忘了配」这种事。

### 顺带确认没被绕过

后缀匹配最容易写错，写成 `以 xn--bqr649k.cn 结尾` 就会把 `evilxn--bqr649k.cn` 放进来。**三个攻击性用例全部验过**：

| 伪装来源 | 结果 |
|---|---|
| `https://evil.com/trucks/2/` | **403** ✅ |
| `https://xn--bqr649k.cn.evil.com/` | **403** ✅ |
| `https://evilxn--bqr649k.cn/` | **403** ✅ |

**写后缀匹配必须写成「等于本域 或 以 `.本域` 结尾」，前面那个点不能省。**

---

## 三、完整验证结果

**来源校验（本地 9 项 + 线上 8 项，全部正确）**

| 来源 | 期望 | 实际 |
|---|---|---|
| 无 Referer | 403 | 403 ✅ |
| `www.xn--bqr649k.cn` | 通过校验 | ✅ **本次修复的** |
| `xn--bqr649k.cn` | 通过校验 | ✅ |
| `diaoche-cn.pages.dev` | 通过校验 | ✅ |
| `abc123.diaoche-cn.pages.dev`（预发子域） | 通过校验 | ✅ |
| `localhost` / `127.0.0.1` | 通过校验 | ✅ |
| `evil.com` / `xn--bqr649k.cn.evil.com` / `evilxn--bqr649k.cn` | 403 | 403 ✅ |

> 「通过校验」后的响应是 **401 + 「请先登录后再查看联系方式」** —— 这是你要的登录门禁，不是错误。

**全站回归（线上）**

```
16 个路径全部 200   /  /trucks/  /prices/  /sell/  /news/  /about/  /contact/
                    /admin/  /robots.txt  /sitemap.xml  /app.js  /style.css
                    /trucks/2/  /trucks/3/  /trucks/4/
/trucks/99999/      404  ✅（不存在的车源仍正确报 404）
www 域 3 个路径      全部 200 ✅
contact 字段泄漏检查  ✅ 未泄漏
后台无密钥          401 ✅
```

**CI**：run **#28 success**（提交 `9fb0739`），文档补丁 `d1a3421`。

---

## 四、还剩哪些事

| 事项 | 谁来做 | 说明 |
|---|---|---|
| **接真实登录** | 你先定方案 | 短信（花钱 + 要实名）还是微信开放平台（要企业主体）。定完我这边只改 2 处代码 |
| 清理测试车源 #2 #3 #4 | **你**（进后台点删除） | 钥匙：`https://xn--bqr649k.cn/admin/` |
| 删重复的 `DC_ADMIN_KEY` | **你**（控制台） | 之前加了两条同名，留一条 |
| 吊销 GitHub PAT `ghp_...SATU8` | **你** | 排查时暴露过 |
| 删 CF token `cfut_Urh2...` / `cfut_zRdge...` | **你** | 临时排查用的 |
| `/api/upload` 无鉴权 | 以后再说 | 现在谁都能传图，不加也不会出事；要防就上 Turnstile |
| ~~修 `www` 前缀 522~~ | ✅ 完成 | 已验证 200 |
