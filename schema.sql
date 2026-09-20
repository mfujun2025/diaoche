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
