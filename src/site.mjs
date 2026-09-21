// 站点内容源：所有页面在此定义，build.mjs 渲染成静态 HTML
export const SITE = {
  name: '吊车.cn',
  url: 'https://xn--bqr649k.cn', // 吊车.cn 的 punycode 形式（已本机换算核对）
  desc: '二手吊车转让信息平台，覆盖各吨位吊车买卖、出租行情与过户避坑指南',
  slogan: '全国二手吊车转让信息平台',
  // 分享图（微信/QQ/微博/推特卡片）。绝对 URL —— 抓取器不解析相对路径
  ogImage: 'https://xn--bqr649k.cn/og.png',
  ogImageWidth: 1200,
  ogImageHeight: 630,
};

/* 文章列表占位符。
   build.mjs 扫 src/articles/*.md 后把生成的列表 HTML 替换到这里。
   为什么要占位符而不是直接把文章拼进 body：文章是数据（会增删），
   页面骨架是结构（基本不变），两者分开维护才不会每次加文章都改站点源码。 */
export const ARTICLES_PLACEHOLDER = '<!--ARTICLES-->';

/* 免责声明：全站统一文案，避免多处各写一份导致口径不一致。
   - footer 用 DISCLAIMER_SHORT
   - 车源详情页用 DISCLAIMER_FULL（逐条页面都要有，纠纷多发生在这里） */
export const DISCLAIMER_SHORT =
  '本站仅提供信息发布与展示服务，不参与实际交易、不垫资、不做担保。信息由发布者提供，请自行核实车况与权属。';

export const DISCLAIMER_FULL = [
  '本平台仅为买卖双方提供信息发布与展示服务，不参与、不担保实际交易环节。',
  '所有设备信息（含吨位、年份、工时、价格、车况等）均由发布者自主提供，平台不做实质审核与真实性背书。',
  '请在交易前务必线下验车、核实车辆权属与过户条件，切勿先付款。',
  '交易风险由买卖双方自行承担。如遇虚假信息，可通过「我要卖车」页面反馈举报。',
];

const TONNAGES = [8, 12, 16, 20, 25, 35, 50, 80, 100];
const BRANDS = ['徐工', '三一', '中联', '柳工'];
const PROVINCES = ['上海', '江苏', '浙江', '山东', '河南', '广东', '河北', '安徽'];

/* 各吨位二手吊车常见成交价区间。
   页面表格与结构化数据（FAQPage）共用这一份，避免两处各写一份走偏。
   ⚠️ 合规红线：这里是「区间参考」，不是承诺成交价，也不编造具体成交记录。 */
export const PRICE_ROWS = [
  [8, '5~10 年', '4 ~ 12', '小型车，需求稳定，适合市政与小型工地'],
  [12, '5~10 年', '6 ~ 18', '通用性较好，二手流通量最大'],
  [16, '5~10 年', '9 ~ 25', '城区作业常见吨位'],
  [25, '4~9 年', '14 ~ 42', '主力吨位，成交量集中'],
  [35, '4~9 年', '20 ~ 58', '中大型项目常用'],
  [50, '4~8 年', '32 ~ 90', '对车况与工时敏感度高'],
  [80, '3~8 年', '55 ~ 160', '设备商与大型租赁公司为主'],
  [100, '3~7 年', '80 ~ 260', '单价高，务必做第三方检测'],
];

/* 避坑指南条目。同样的理由：页面与结构化数据共用一份。
   这几条本身也是高价值问答，适合做 FAQPage 让搜索引擎展示问答摘要。 */
export const GUIDE_ITEMS = [
  ['一、先看权属，再看车况', '要求卖方提供行驶证、购车发票或合格证、以及是否存在抵押/融资租赁未结清的情况。权属不清的车，价格再低也不要碰。'],
  ['二、工时表要交叉验证', '工作时间表可被调改。建议结合保养记录、液压油更换周期、支腿磨损程度做交叉判断，必要时请第三方检测。'],
  ['三、事故车的识别要点', '重点查大臂是否有焊接修复痕迹、转台与车架连接处漆面是否异常、结构件是否有补漆色差。事故车结构强度不可逆，风险高。'],
  ['四、过户流程与税费', '确认车辆可正常过户（部分地区对排放标准与外埠转入有限制）。过户前结清违章与税费，明确税费承担方，写入合同。'],
  ['五、合同要写清楚', '写明月租金/转让价、进出场费、油费、超时计费、违约责任与争议解决方式。口头承诺一律无效。'],
  ['六、付款节奏', '建议分期：定金—验车合格—过户完成—尾款。避免一次性全额支付。'],
];

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 首页 ---------- */
const homeBody = `
<section class="hero">
  <div class="wrap">
    <h1>全国二手吊车转让信息平台</h1>
    <p class="sub">按吨位、品牌、地区快速找车 · 车源由车主与设备商直发 · 不参与交易，只做信息撮合</p>
    <form class="search" onsubmit="return goSearch(event)">
      <select id="s-tonnage"><option value="">全部吨位</option>${TONNAGES.map((t) => `<option value="${t}">${t} 吨</option>`).join('')}</select>
      <select id="s-brand"><option value="">全部品牌</option>${BRANDS.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select>
      <select id="s-province"><option value="">全部地区</option>${PROVINCES.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
      <button type="submit">查找车源</button>
    </form>
    <div class="quick">
      ${TONNAGES.slice(0, 6).map((t) => `<a href="/trucks/${t}吨/">${t}吨吊车</a>`).join('')}
      <a href="/rent/" class="hl">吊车出租频道 →</a>
    </div>
  </div>
</section>

<section class="wrap sec">
  <h2 class="h2">最新车源</h2>
  <div id="truck-list" class="grid" data-limit="8">
    <p class="empty">加载中…</p>
  </div>
  <p class="more"><a href="/trucks/">查看全部车源 →</a></p>
</section>

<section class="wrap sec">
  <h2 class="h2">按吨位找车</h2>
  <div class="chips">${TONNAGES.map((t) => `<a class="chip" href="/trucks/${t}吨/">${t} 吨<span>查看车源</span></a>`).join('')}</div>
</section>

<section class="wrap sec">
  <h2 class="h2">按地区找车</h2>
  <p class="lead">二手吊车跨省价差明显，先按地区缩小范围，再比吨位与车况。</p>
  <div class="chips">${PROVINCES.map((p) => `<a class="chip" href="/trucks/${esc(p)}/">${esc(p)}<span>查看车源</span></a>`).join('')}</div>
</section>

<section class="wrap sec">
  <h2 class="h2">按品牌找车</h2>
  <div class="chips">${BRANDS.map((b) => `<a class="chip" href="/trucks/${esc(b)}/">${esc(b)}<span>查看车源</span></a>`).join('')}</div>
</section>

<section class="wrap sec">
  <h2 class="h2">为什么用吊车.cn</h2>
  <div class="cards">
    <div class="card"><h3>全国车源</h3><p>二手吊车跨省价差可达两成以上，本站按吨位与地区聚合车源，便于横向比价。</p></div>
    <div class="card"><h3>行情透明</h3><p>提供各吨位二手成交价区间与台班价参考，减少信息不对称导致的压价或高价接盘。</p></div>
    <div class="card"><h3>避坑知识</h3><p>过户流程、事故车识别、验车清单等实操内容，帮你在签字前把风险点看清。</p></div>
  </div>
</section>

<section class="cta">
  <div class="wrap cta-in">
    <div><h3>有车要卖？免费发布</h3><p>填写吨位、年份、地区与联系方式，审核通过后进入车源大厅。</p></div>
    <a class="btn" href="/sell/">我要卖车</a>
  </div>
</section>
`;

/* ---------- 车源大厅 ---------- */
const trucksBody = `
<section class="wrap sec first">
  <h1 class="h1">车源大厅</h1>
  <p class="lead">全部车源均经人工审核后展示。信息由发布者提供，交易前请核实车况、权属与过户条件。</p>
  <form class="filter" id="filter-form" onsubmit="return applyFilter(event)">
    <select id="f-biz"><option value="sale">二手转让</option><option value="rent">出租</option><option value="buy">求购</option></select>
    <select id="f-tonnage"><option value="">全部吨位</option>${TONNAGES.map((t) => `<option value="${t}">${t} 吨</option>`).join('')}</select>
    <select id="f-brand"><option value="">全部品牌</option>${BRANDS.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}</select>
    <select id="f-province"><option value="">全部地区</option>${PROVINCES.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>
    <button type="submit">筛选</button>
  </form>
  <div id="truck-list" class="list" data-limit="20"></div>

  <div class="d-block">
    <h2>按吨位浏览</h2>
    <div class="chips">${TONNAGES.map((t) => `<a class="chip" href="/trucks/${t}吨/">${t} 吨<span>查看车源</span></a>`).join('')}</div>
  </div>
  <div class="d-block">
    <h2>按地区浏览</h2>
    <div class="chips">${PROVINCES.map((p) => `<a class="chip" href="/trucks/${esc(p)}/">${esc(p)}<span>查看车源</span></a>`).join('')}</div>
  </div>
  <div class="d-block">
    <h2>按品牌浏览</h2>
    <div class="chips">${BRANDS.map((b) => `<a class="chip" href="/trucks/${esc(b)}/">${esc(b)}<span>查看车源</span></a>`).join('')}</div>
  </div>
</section>
`;

/* ---------- 我要卖车 ---------- */
const sellBody = `
<section class="wrap sec first narrow">
  <h1 class="h1">我要卖车</h1>
  <p class="lead">免费发布车源，审核通过后展示在车源大厅。请如实填写车况，虚假信息将不予展示。</p>
  <form id="sell-form" class="form">
    <label>信息类型
      <select name="biz_type"><option value="sale">二手吊车转让</option><option value="rent">吊车出租</option><option value="buy">求购吊车</option></select>
    </label>
    <div class="row">
      <label>吨位（必填）<input name="tonnage" type="number" min="1" max="2000" required placeholder="如 25"></label>
      <label>品牌（必填）
        <select name="brand" required>${BRANDS.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}<option value="其他">其他</option></select>
      </label>
    </div>
    <div class="row">
      <label>型号<input name="model" placeholder="如 XCA25"></label>
      <label>出厂年份<input name="year" type="number" min="1980" max="2100" placeholder="如 2019"></label>
    </div>
    <div class="row">
      <label>工作小时<input name="hours" type="number" min="0" placeholder="如 6000"></label>
      <label>价格<input name="price" type="number" min="0" step="0.1" placeholder="如 42"></label>
    </div>
    <div class="row">
      <label>省份<input name="province" placeholder="如 江苏"></label>
      <label>城市<input name="city" placeholder="如 徐州"></label>
    </div>
    <label class="check"><input name="has_accident" type="checkbox"> 该车有事故/大修记录（如实勾选，便于买方判断）</label>
    <label>车况描述<textarea name="condition" rows="4" placeholder="如：19年徐工XCA25，一手车，工时6200，无事故，可过户"></textarea></label>
    <label>车况照片（选填，最多 9 张，单张 ≤ 5MB）
      <input id="f-images" type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
    </label>
    <p class="hint">支持 JPG / PNG / WebP / GIF。照片真实清晰的车源，成交率明显更高。</p>
    <div id="img-preview" class="img-preview"></div>
    <label>联系方式（必填）<input name="contact" required placeholder="手机号 / 微信号"></label>
    <button type="submit" class="btn">提交车源</button>
    <p id="sell-msg" class="msg"></p>
  </form>
</section>
`;

/* ---------- 出租频道 ---------- */
const rentBody = `
<section class="wrap sec first">
  <h1 class="h1">吊车出租频道</h1>
  <p class="lead">按城市查找吊车出租信息。台班价因吨位、地区、作业工况差异较大，页面价格仅供参考。</p>
  <div class="chips">${PROVINCES.map((p) => `<a class="chip" href="/rent/#${esc(p)}">${esc(p)}吊车出租<span>查看车源</span></a>`).join('')}</div>
  <div class="notice">
    <strong>说明：</strong>本站仅收集与展示出租信息，不承担调度与履约。长期出租业务建议签订书面合同，明确台班计价方式、进出场费、油费与超时规则。
  </div>
  <div id="truck-list" class="list" data-biz="rent" data-limit="20"></div>
</section>
`;

/* ---------- 行情价格 ---------- */
const priceBody = `
<section class="wrap sec first">
  <h1 class="h1">吊车行情价格库</h1>
  <p class="lead">以下为各吨位二手吊车的常见成交价区间参考（按车龄与车况浮动）。实际成交受品牌、配置、地区与市场周期影响，务必以实车验车结论为准。</p>
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th>吨位</th><th>常见车龄</th><th>价格区间（万元）</th><th class="col-note">说明</th></tr></thead>
      <tbody>
        ${PRICE_ROWS.map((r) => `<tr><td><strong>${r[0]} 吨</strong></td><td>${r[1]}</td><td class="em">${r[2]}</td><td class="col-note">${r[3]}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
  <p class="tip">价格数据为公开信息整理，随市场波动，建议以近 30 天实际成交为参考基准。</p>
</section>
`;

/* ---------- 避坑指南（文章列表 + 常见问题） ---------- */
const guideBody = `
<section class="wrap sec first">
  <h1 class="h1">二手吊车避坑指南</h1>
  <p class="lead">从选车、验车到过户的交易要点。下面几篇针对具体问题展开，比速查问答更细。</p>
  <h2 class="h2">深入阅读</h2>
  ${ARTICLES_PLACEHOLDER}
</section>

<section class="wrap sec">
  <h2 class="h2">常见问题速查</h2>
  <div class="narrow">
    ${GUIDE_ITEMS.map((x) => `<article class="art"><h3>${x[0]}</h3><p>${x[1]}</p></article>`).join('')}
  </div>
</section>
`;

/* ---------- 后台审核（访问密钥登录保护） ---------- */
const adminBody = `
<section class="wrap sec">
  <div id="admin-login" class="login-box" hidden>
    <h1 class="h1">后台登录</h1>
    <p class="lead">请输入后台访问密钥。</p>
    <p id="admin-login-msg" class="msg"></p>
    <form id="admin-login-form" class="login-form" autocomplete="off">
      <input type="password" id="admin-key" placeholder="访问密钥" autocomplete="current-password" required>
      <button type="submit" class="btn">登录</button>
    </form>
  </div>
  <div id="admin-main" hidden>
    <h1 class="h1">车源审核</h1>
    <p class="lead">新提交的车源默认进入待审队列，通过后才会在前台车源大厅展示。</p>
    <p id="admin-msg" class="msg"></p>
    <div class="tabs">
      <a href="#" data-tab="pending" class="on" onclick="return switchTab(event,'pending')">待审核<span class="n">0</span></a>
      <a href="#" data-tab="approved" onclick="return switchTab(event,'approved')">已通过<span class="n">0</span></a>
      <a href="#" data-tab="rejected" onclick="return switchTab(event,'rejected')">已驳回<span class="n">0</span></a>
      <a href="#" data-tab="all" onclick="return switchTab(event,'all')">全部<span class="n">0</span></a>
      <a href="#" id="admin-logout" class="logout">退出</a>
    </div>
    <div class="tbl-wrap">
      <table class="atbl">
        <thead><tr><th>ID</th><th>车源</th><th>价格</th><th>状态</th><th>联系方式</th><th>提交时间</th><th>操作</th></tr></thead>
        <tbody id="admin-body"></tbody>
      </table>
    </div>
  </div>
</section>
`;

/* ───────── 结构化数据（JSON-LD） ─────────
   放在 src 而不是 build.mjs：内容与页面是一体的，改文案时要一起看。
   build.mjs 只负责序列化进 <head>。

   设计取舍：用 @graph 把多个实体放进一个 script 标签，而不是拆成多个 ——
   减少 head 体积、也方便搜索引擎整体理解站点的实体关系。 */

/** 站点主体。Organization 是「谁在运营这个站」，全站只声明一次。
 *  build.mjs 生成文章页时也要用它当 publisher，所以导出。 */
export const ORG_NODE = {
  '@type': 'Organization',
  '@id': `${SITE.url}/#organization`,
  name: SITE.name,
  url: SITE.url,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE.url}/og.png`,
    width: SITE.ogImageWidth,
    height: SITE.ogImageHeight,
  },
  description: SITE.desc,
};

/** 站点本体 + 站内搜索。SearchAction 指向车源大厅，参数名与前端实际用的一致。 */
const WEBSITE_NODE = {
  '@type': 'WebSite',
  '@id': `${SITE.url}/#website`,
  name: SITE.name,
  alternateName: '吊车网 · 二手吊车转让',
  url: SITE.url,
  description: SITE.desc,
  publisher: { '@id': `${SITE.url}/#organization` },
  inLanguage: 'zh-CN',
  potentialAction: {
    '@type': 'SearchAction',
    // 前端首页搜索跳转的是 /trucks/<吨位>/<地区>/<品牌>/ 路径形式，
    // 但参数形式 /trucks/?tonnage={x} 同样可用且更适合声明，这里用后者。
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE.url}/trucks/?tonnage={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

/** 首页：站点主体 + 站点 + 一组长尾入口。
    长尾入口用 ItemList 声明，等于把「站内有哪些可浏览的分类」直接告诉搜索引擎，
    比只靠内链爬取更明确。 */
function homeLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      ORG_NODE,
      WEBSITE_NODE,
      {
        '@type': 'ItemList',
        name: '按吨位浏览二手吊车车源',
        itemListElement: TONNAGES.map((t, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${t}吨二手吊车`,
          url: `${SITE.url}/trucks/${t}吨/`,
        })),
      },
      {
        '@type': 'ItemList',
        name: '按地区浏览二手吊车车源',
        itemListElement: PROVINCES.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${p}二手吊车`,
          url: `${SITE.url}/trucks/${p}/`,
        })),
      },
    ],
  };
}

/** 车源大厅：聚合列表页。与长尾页保持同一套语义（CollectionPage + ItemList）。 */
function trucksLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: '车源大厅 — 二手吊车转让',
        description: '按吨位、品牌、地区筛选全国二手吊车转让车源，信息经人工审核后展示。',
        url: `${SITE.url}/trucks/`,
        isPartOf: { '@id': `${SITE.url}/#website` },
        inLanguage: 'zh-CN',
      },
      /* CollectionPage 只说明「这是一页列表」，真正告诉搜索引擎「列表里有什么」
         的是 ItemList。缺了它，数据里最关键的一层就丢了 —— 别省。 */
      {
        '@type': 'ItemList',
        name: '二手吊车车源入口',
        itemListElement: [
          ...TONNAGES.map((t, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: `${t}吨二手吊车`,
            url: `${SITE.url}/trucks/${t}吨/`,
          })),
          ...PROVINCES.map((p, i) => ({
            '@type': 'ListItem',
            position: TONNAGES.length + i + 1,
            name: `${p}二手吊车`,
            url: `${SITE.url}/trucks/${p}/`,
          })),
        ],
      },
      ORG_NODE,
    ],
  };
}

/** 行情价格页：各吨位成交价区间做成 FAQ，争取搜索引擎的问答摘要位。
    ⚠️ 合规红线：一律用「区间参考」「因车况浮动」这类表述，不承诺价格、不编造成交。 */
function priceLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        name: '二手吊车各吨位价格区间',
        url: `${SITE.url}/price/`,
        mainEntity: PRICE_ROWS.map((r) => ({
          '@type': 'Question',
          name: `${r[0]}吨二手吊车大概多少钱？`,
          acceptedAnswer: {
            '@type': 'Answer',
            text:
              `${r[0]}吨二手吊车常见车龄 ${r[1]} 时，价格区间参考为 ${r[2]} 万元。` +
              `${r[3]}。实际成交受品牌、配置、工时、地区与市场周期影响，务必以实车验车结论为准。`,
          },
        })),
      },
      ORG_NODE,
    ],
  };
}

/** 避坑指南：六条实操要点做成 FAQ，这类问答在搜索结果里容易拿到摘要位。 */
function guideLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        name: '二手吊车交易避坑要点',
        url: `${SITE.url}/guide/`,
        mainEntity: GUIDE_ITEMS.map((x) => ({
          '@type': 'Question',
          name: String(x[0]).replace(/^[一二三四五六七八九十]+、/, ''),
          acceptedAnswer: { '@type': 'Answer', text: x[1] },
        })),
      },
      ORG_NODE,
    ],
  };
}

/** 出租频道：服务型页面，用 Service 描述比 CollectionPage 更贴切。 */
function rentLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: '吊车出租信息查询',
        serviceType: '吊车租赁信息发布与查询',
        description: '按省市查找吊车出租信息与台班价参考。本站仅收集与展示出租信息，不承担调度与履约。',
        url: `${SITE.url}/rent/`,
        areaServed: PROVINCES.map((p) => ({ '@type': 'AdministrativeArea', name: p })),
        provider: { '@id': `${SITE.url}/#organization` },
      },
      ORG_NODE,
    ],
  };
}

/** 我要卖车：发布入口，用 WebPage + 明确的用途说明（Google 对表单页有单独的引导政策）。 */
function sellLd() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: '我要卖车 — 免费发布二手吊车车源',
        description: '免费发布二手吊车转让、出租、求购信息，审核通过后展示在车源大厅。',
        url: `${SITE.url}/sell/`,
        isPartOf: { '@id': `${SITE.url}/#website` },
        inLanguage: 'zh-CN',
      },
      ORG_NODE,
    ],
  };
}

export const pages = [
  {
    path: 'index.html',
    title: '吊车.cn — 全国二手吊车转让信息平台',
    description: SITE.desc,
    // 分享文案与 meta description 分开写：前者要像一句话推荐，后者要有搜索词
    ogDesc: '按吨位、品牌、地区快速找车。车源由车主与设备商直发，平台不参与交易，只做信息撮合。',
    ld: homeLd,
    body: homeBody,
  },
  {
    path: 'trucks/index.html',
    title: '车源大厅 — 二手吊车转让 | 吊车.cn',
    description: '按吨位、品牌、地区筛选全国二手吊车转让车源，信息经人工审核后展示。',
    ogDesc: '全国二手吊车转让车源，按吨位、地区、品牌筛选，人工审核后展示。',
    ld: trucksLd,
    body: trucksBody,
  },
  {
    path: 'sell/index.html',
    title: '我要卖车 — 免费发布车源 | 吊车.cn',
    description: '免费发布二手吊车转让、出租、求购信息，审核通过后展示在车源大厅。',
    ogDesc: '免费发布二手吊车转让、出租、求购信息，审核通过后展示在车源大厅。',
    ld: sellLd,
    body: sellBody,
  },
  {
    path: 'rent/index.html',
    title: '吊车出租 — 按城市查找 | 吊车.cn',
    description: '按省市查找吊车出租信息与台班价参考。',
    ogDesc: '按省市查找吊车出租信息与台班价参考，覆盖全国主要工程机械活跃省份。',
    ld: rentLd,
    body: rentBody,
  },
  {
    path: 'price/index.html',
    title: '吊车行情价格库 — 各吨位二手成交价参考 | 吊车.cn',
    description: '8~100 吨二手吊车成交价区间参考，月度更新。',
    ogDesc: '8~100 吨二手吊车成交价区间参考。数据为公开信息整理，随市场波动。',
    ld: priceLd,
    body: priceBody,
  },
  {
    path: 'guide/index.html',
    title: '二手吊车避坑指南 | 吊车.cn',
    description: '权属核验、工时表交叉验证、事故车识别、过户流程与合同要点。',
    ogDesc: '权属核验、工时表交叉验证、事故车识别、过户流程与合同要点，签合同前先看这篇。',
    ld: guideLd,
    body: guideBody,
  },
  { path: 'admin/index.html', title: '内容审核后台 | 吊车.cn', description: '', body: adminBody, layout: 'admin' },
];
