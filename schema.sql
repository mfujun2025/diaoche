-- 吊车.cn 数据库结构
-- 执行：npm run db:init  （远程）/ npm run db:init:local （本地）

CREATE TABLE IF NOT EXISTS trucks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  biz_type     TEXT    NOT NULL DEFAULT 'sale',  -- sale=二手转让 / rent=出租 / buy=求购
  tonnage      INTEGER NOT NULL,                 -- 吨位
  brand        TEXT    NOT NULL,                 -- 品牌
  model        TEXT,                             -- 型号
  year         INTEGER,                          -- 出厂年份
  hours        INTEGER,                          -- 工作小时
  province     TEXT,                             -- 省
  city         TEXT,                             -- 市
  price        REAL,                             -- 价格（转让价/台班价）
  price_unit   TEXT    DEFAULT '万元',            -- 价格单位
  condition    TEXT,                             -- 车况描述
  has_accident INTEGER DEFAULT 0,                -- 是否事故车 0否1是
  contact      TEXT    NOT NULL,                 -- 联系方式
  images       TEXT,                             -- JSON 数组，存 R2 key
  status       TEXT    DEFAULT 'pending',        -- pending/approved/rejected
  created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trucks_filter  ON trucks(biz_type, tonnage, brand, province, status);
CREATE INDEX IF NOT EXISTS idx_trucks_status  ON trucks(status, created_at DESC);

-- 行情价格库（月度更新）
CREATE TABLE IF NOT EXISTS prices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tonnage     INTEGER NOT NULL,
  brand       TEXT,
  year_from   INTEGER,
  year_to     INTEGER,
  price_low   REAL,
  price_high  REAL,
  period      TEXT,                              -- 数据期，如 2026-09
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prices_tonnage ON prices(tonnage, period);

-- 图片上传限流日志（防滥用，定期清理旧记录即可）
CREATE TABLE IF NOT EXISTS upload_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_upload_log_ip ON upload_log(ip, created_at);

-- ════════════════════════════════════════════════════════════════════
-- 用户登录体系（邮箱验证码）
-- ════════════════════════════════════════════════════════════════════
--
-- 设计原则（与老孟确认过）：
--   1. 隐私最小化：**不存明文邮箱**。存 SHA-256(email + 全局盐)，
--      万一库泄露，攻击者也拿不到原始邮箱。同理验证码也只存哈希。
--   2. 多设备并存：每个设备一条 session 记录，互不踢。后期可做「登录设备管理」。
--   3. 所有「临时数据」都要能自动清理，别让 login_codes 无限膨胀。
--
-- 为什么用哈希而不是加密：这里**不需要还原出原文**，只需要「比对是否一致」。
-- 加密要管密钥、要担心密钥泄露；哈希没有这个负担。能哈希就绝不明文。

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash  TEXT    NOT NULL UNIQUE,           -- SHA-256(email + SALT)，不存明文
  created_at  TEXT    DEFAULT (datetime('now')),
  last_seen   TEXT,                              -- 最近一次登录时间
  status      TEXT    DEFAULT 'active'           -- active / banned
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email_hash);

-- 登录验证码（短期有效，用完即删）
CREATE TABLE IF NOT EXISTS login_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash   TEXT    NOT NULL,
  code_hash    TEXT    NOT NULL,                 -- 验证码本身也哈希，防「看到库就知道码」
  ip           TEXT,                             -- 记录发码 IP，用于限流排查
  attempts     INTEGER DEFAULT 0,                -- 已尝试次数，超过上限直接作废（防暴力猜 6 位数字）
  used         INTEGER DEFAULT 0,                -- 1=已使用，防重放
  expires_at   TEXT    NOT NULL,                 -- ISO 时间，10 分钟
  created_at   TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_codes_lookup  ON login_codes(email_hash, used, expires_at);
CREATE INDEX IF NOT EXISTS idx_login_codes_ip      ON login_codes(ip, created_at);

-- 发码限流日志（按 IP 和邮箱分别限，防刷爆邮件额度）
CREATE TABLE IF NOT EXISTS send_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                      -- 'ip' | 'email'
  key        TEXT NOT NULL,                      -- IP 或 email_hash
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_send_log_key ON send_log(kind, key, created_at);

-- 会话表（多设备并存：每设备一条，互不影响）
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,                -- SHA-256(原始 token)，泄露库也拿不到可用 token
  user_id    INTEGER NOT NULL,
  ua         TEXT,                               -- User-Agent 摘要，供「登录设备管理」用
  ip         TEXT,
  expires_at TEXT    NOT NULL,                   -- 30 天
  created_at TEXT    DEFAULT (datetime('now')),
  last_used  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

