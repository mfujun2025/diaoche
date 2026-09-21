// 前端交互：车源加载、筛选、发布表单提交
(function () {
  'use strict';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BIZ_LABEL = { sale: '转让', rent: '出租', buy: '求购' };
  // 图片走本站 Functions 代理（functions/img/[[path]].ts），不依赖 R2 自定义域
  const IMG_BASE = '/img';

  function truckCard(t) {
    const name = `${t.tonnage}吨 ${t.brand}${t.model ? ' ' + t.model : ''}`;
    const meta = [
      t.year ? t.year + '年' : '',
      t.hours ? t.hours + '小时' : '',
      [t.province, t.city].filter(Boolean).join(' '),
    ].filter(Boolean);
    // 价格为 0 / 空时显示「面议」，避免出现「0万元」这种无效信息
    const hasPrice = t.price != null && Number(t.price) > 0;
    const price = hasPrice
      ? `<span class="t-price">${t.price}${t.price_unit || '万元'}</span>`
      : '<span class="t-price">面议</span>';

    // 图片：只取第一张做封面，key 由服务端生成，但仍做一次转义
    let imgs = [];
    try {
      imgs = Array.isArray(t.images) ? t.images : JSON.parse(t.images || '[]');
    } catch {}
    imgs = (imgs || []).filter((k) => typeof k === 'string' && k);
    // onerror：图片取不到时整块撤掉，避免出现丑陋的裂图占位
    const thumb = imgs.length
      ? `<div class="t-thumb"><img src="${IMG_BASE}/${esc(imgs[0])}" alt="${esc(name)}" loading="lazy" onerror="this.closest('.t-thumb').remove()">${
          imgs.length > 1 ? `<span class="t-count">${imgs.length} 图</span>` : ''
        }</div>`
      : '';

    // 整块卡片可点击 → 跳详情页 /trucks/<id>/
    return `<a class="truck" href="/trucks/${t.id}/">
      ${thumb}
      <div class="t-body">
        <div class="t-top"><span class="t-name">${esc(name)}</span>${price}</div>
        <div class="t-meta">
          <span class="tag">${BIZ_LABEL[t.biz_type] || '转让'}</span>
          ${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
          ${t.has_accident ? '<span class="tag acc">有事故记录</span>' : ''}
        </div>
        ${t.condition ? `<p class="t-cond">${esc(t.condition)}</p>` : ''}
        <span class="t-more">查看详情 →</span>
      </div>
    </a>`;
  }

  function parseQuery() {
    const q = new URLSearchParams(location.search);
    const o = {};
    ['biz_type', 'tonnage', 'brand', 'province'].forEach((k) => {
      const v = q.get(k);
      if (v) o[k] = v;
    });
    return o;
  }

  /** 从元素的 data-query 里读出服务端写好的筛选条件
   *  长尾路径页（/trucks/25吨/江苏/）的筛选条件在路径里，不在查询串里，
   *  所以由服务端把结果写进 data-query，前端照着查一次库。 */
  function parseDataQuery(el) {
    const raw = el.dataset.query || '';
    if (!raw) return {};
    const o = {};
    new URLSearchParams(raw).forEach((v, k) => {
      if (v) o[k] = v;
    });
    return o;
  }

  async function loadTrucks(el, params) {
    if (!el) return;
    const limit = el.dataset.limit || '20';
    const bizDefault = el.dataset.biz || '';
    const qs = new URLSearchParams({ limit, ...(bizDefault ? { biz_type: bizDefault } : {}), ...params });
    el.innerHTML = '<p class="empty">加载中…</p>';
    try {
      const res = await fetch('/api/trucks?' + qs.toString(), { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!json.ok) throw new Error(json.msg || '加载失败');
      if (!json.data.length) {
        el.innerHTML = '<p class="empty">暂无可展示车源。欢迎<a href="/sell/">免费发布</a>。</p>';
        return;
      }
      el.innerHTML = json.data.map(truckCard).join('');
    } catch (e) {
      el.innerHTML = '<p class="empty">车源加载失败，请稍后刷新。</p>';
    }
  }

  // 首页搜索：跳「静态路径页」而不是参数页。
  // 原因：路径页是可收录的规范页（/trucks/25吨/江苏/），参数页已被 robots 屏蔽，
  // 把用户与爬虫都往路径页引，权重才集中。
  window.goSearch = function (ev) {
    ev.preventDefault();
    const t = document.getElementById('s-tonnage').value;
    const b = document.getElementById('s-brand').value;
    const pr = document.getElementById('s-province').value;

    const segs = [];
    if (t) segs.push(t + '吨');
    if (pr) segs.push(pr);
    if (b) segs.push(b);

    if (segs.length) {
      location.href = '/trucks/' + segs.map(encodeURIComponent).join('/') + '/';
      return false;
    }

    // 什么都不选 → 直接回车源大厅
    location.href = '/trucks/';
    return false;
  };

  // 车源大厅筛选
  window.applyFilter = function (ev) {
    ev.preventDefault();
    const p = new URLSearchParams();
    const biz = document.getElementById('f-biz').value;
    const t = document.getElementById('f-tonnage').value;
    const b = document.getElementById('f-brand').value;
    const pr = document.getElementById('f-province').value;
    if (biz) p.set('biz_type', biz);
    if (t) p.set('tonnage', t);
    if (b) p.set('brand', b);
    if (pr) p.set('province', pr);
    location.search = p.toString() ? '?' + p.toString() : '';
    return false;
  };

  /* ───────── 车源详情页 ─────────
     页面外壳由 functions/trucks/[[path]].ts 服务端渲染（带 SEO 信息），
     这里负责拉接口把正文填进去、以及图片轮播和「查看联系方式」。 */
  function renderDetail(el) {
    const id = Number(el.dataset.id);
    if (!id) return;

    fetch('/api/truck/' + id, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json) => {
        if (!json.ok) throw new Error(json.msg || '加载失败');
        const t = json.data;
        const name = `${t.tonnage}吨 ${t.brand}${t.model ? ' ' + t.model : ''}`;
        const hasPrice = t.price != null && Number(t.price) > 0;
        const meta = [
          t.year ? t.year + ' 年出厂' : '',
          t.hours ? '工时 ' + t.hours + ' 小时' : '',
          [t.province, t.city].filter(Boolean).join(' ') || '',
        ].filter(Boolean);

        el.innerHTML = `
          <p class="crumb"><a href="/trucks/">← 返回车源大厅</a></p>
          <div class="d-head">
            <div>
              <h1 class="d-title">${esc(name)}</h1>
              <div class="d-tags">
                <span class="tag">${BIZ_LABEL[t.biz_type] || '转让'}</span>
                ${t.has_accident ? '<span class="tag acc">有事故/大修记录</span>' : ''}
              </div>
            </div>
            <div class="d-price">
              <b>${hasPrice ? esc(t.price) + esc(t.price_unit || '万元') : '面议'}</b>
              <small>${hasPrice ? '卖家报价，可议' : '价格请与卖家协商'}</small>
            </div>
          </div>

          <div class="d-layout">
            <div>
              ${galleryHtml(t.images, name)}
              ${
                t.condition
                  ? `<div class="d-block"><h2>车况描述</h2><p class="d-cond">${esc(t.condition)}</p></div>`
                  : ''
              }
            </div>
            <div>
              <div class="d-panel">
                <table class="d-table">
                  <tr><th>吨位</th><td><strong>${esc(t.tonnage)} 吨</strong></td></tr>
                  <tr><th>品牌</th><td>${esc(t.brand)}${t.model ? ' ' + esc(t.model) : ''}</td></tr>
                  ${t.year ? `<tr><th>出厂年份</th><td>${esc(t.year)} 年</td></tr>` : ''}
                  ${t.hours ? `<tr><th>工作小时</th><td>${esc(t.hours)} 小时</td></tr>` : ''}
                  ${meta[2] ? `<tr><th>所在地区</th><td>${esc(meta[2])}</td></tr>` : ''}
                  <tr><th>价格</th><td class="em">${hasPrice ? esc(t.price) + esc(t.price_unit || '万元') : '面议'}</td></tr>
                  <tr><th>事故记录</th><td class="${t.has_accident ? 'd-acc' : ''}">${t.has_accident ? '有' : '无'}</td></tr>
                </table>
              </div>
              <div id="d-contact-slot">${contactPlaceholderHtml()}</div>
              ${disclaimerHtml()}
            </div>
          </div>
        `;

        bindGallery(el);
        bindContact(el, id);
      })
      .catch(() => {
        el.innerHTML =
          '<p class="crumb"><a href="/trucks/">← 返回车源大厅</a></p>' +
          '<p class="empty">车源加载失败，可能已下架。<a href="/trucks/">看看其他车源</a>。</p>';
      });
  }

  /** 图片区：大图 + 缩略图切换；无图时给个占位 */
  function galleryHtml(images, name) {
    const imgs = (Array.isArray(images) ? images : []).filter((k) => typeof k === 'string' && k);
    if (!imgs.length) {
      return '<div class="d-gallery"><div class="d-noimg">该车源未上传照片</div></div>';
    }
    const thumbs = imgs
      .map((k, i) => `<img src="${IMG_BASE}/${esc(k)}" alt="${esc(name)} 第${i + 1}张" data-i="${i}" class="${i === 0 ? 'on' : ''}">`)
      .join('');
    return `<div class="d-gallery">
      <div class="d-main">
        <img id="d-img" src="${IMG_BASE}/${esc(imgs[0])}" alt="${esc(name)}">
        ${imgs.length > 1 ? `
          <button type="button" class="d-nav d-prev" aria-label="上一张">‹</button>
          <button type="button" class="d-nav d-next" aria-label="下一张">›</button>
          <span class="d-idx" id="d-idx">1 / ${imgs.length}</span>` : ''}
      </div>
      ${imgs.length > 1 ? `<div class="d-thumbs">${thumbs}</div>` : ''}
    </div>`;
  }

  function bindGallery(root) {
    const main = root.querySelector('#d-img');
    if (!main) return;
    const list = Array.from(root.querySelectorAll('.d-thumbs img'));
    const idxEl = root.querySelector('#d-idx');
    if (!list.length) return;
    let cur = 0;

    const show = (i) => {
      cur = (i + list.length) % list.length;
      main.src = list[cur].src;
      list.forEach((im, k) => im.classList.toggle('on', k === cur));
      if (idxEl) idxEl.textContent = `${cur + 1} / ${list.length}`;
    };

    list.forEach((im) => im.addEventListener('click', () => show(Number(im.dataset.i))));
    const prev = root.querySelector('.d-prev');
    const next = root.querySelector('.d-next');
    if (prev) prev.addEventListener('click', () => show(cur - 1));
    if (next) next.addEventListener('click', () => show(cur + 1));
  }

  /* 详情页免责声明
     为什么逐条详情页都要有（而不是只在 footer 写一份）：
     用户是从搜索引擎直接落到某条车源页的，未必会滚到底看 footer；
     而纠纷恰恰最容易发生在这类页面上。所以声明必须贴着车源信息出现。
     文案口径与 src/site.mjs 的 DISCLAIMER_FULL 保持一致。 */
  function disclaimerHtml() {
    return `<div class="d-disclaimer">
      <h2>免责声明</h2>
      <ul>
        <li>本平台仅为买卖双方提供信息发布与展示服务，<strong>不参与、不担保实际交易环节</strong>。</li>
        <li>所有设备信息（含吨位、年份、工时、价格、车况等）均由发布者自主提供，平台不做实质审核与真实性背书。</li>
        <li>请在交易前务必<strong>线下验车</strong>、核实车辆权属与过户条件，<strong>切勿先付款</strong>。</li>
        <li>交易风险由买卖双方自行承担。如遇虚假信息，可通过<a href="/sell/">「我要卖车」页面</a>反馈举报。</li>
      </ul>
    </div>`;
  }

  /**
   * 获取并展示联系方式。
   *
   * 抽成独立函数，因为「登录成功后要自动再试一次」——
   * 把逻辑内联在事件回调里就没法复用了。
   */
  async function loadContact(root, id, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '获取中…';
    }
    try {
      const res = await fetch(`/api/truck/${id}/contact`, {
        headers: { Accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));

      // 需要登录 → 显示登录框
      if (res.status === 401 && json.needLogin) {
        root.querySelector('#d-contact-slot').innerHTML = loginGateHtml(json.msg);
        bindLoginGate(root, id);
        return;
      }
      if (!res.ok || !json.ok) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '查看联系方式';
        }
        alert(json.msg || '获取失败，请稍后重试');
        return;
      }

      root.querySelector('#d-contact-slot').innerHTML = `<div class="d-contact">
        <p class="hint">卖家联系方式</p>
        <p class="val">${esc(json.data.contact)}</p>
        <div class="d-ct-actions">
          <button type="button" class="btn" id="d-ct-copy">复制号码</button>
        </div>
        <p class="tip" style="margin:14px 0 0">联系时请说明来自「吊车.cn」，并注意核实对方身份。</p>
        <p class="d-me">已登录 · <button type="button" id="d-logout">退出登录</button></p>
      </div>`;

      const copyBtn = root.querySelector('#d-ct-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(json.data.contact);
            copyBtn.textContent = '已复制 ✓';
            setTimeout(() => (copyBtn.textContent = '复制号码'), 1800);
          } catch {
            copyBtn.textContent = '请长按号码复制';
          }
        });
      }

      const outBtn = root.querySelector('#d-logout');
      if (outBtn) {
        outBtn.addEventListener('click', async () => {
          outBtn.disabled = true;
          try {
            await fetch('/api/auth/logout', { method: 'POST' });
          } catch {
            /* 失败也照样刷新，服务端可能已经清了 */
          }
          // 退出后回到「点按钮才显示」的初始态
          root.querySelector('#d-contact-slot').innerHTML = contactPlaceholderHtml();
          bindContact(root, id);
        });
      }
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '查看联系方式';
      }
      alert('网络错误，请稍后重试');
    }
  }

  function bindContact(root, id) {
    const btn = root.querySelector('#d-ct-btn');
    if (!btn) return;
    btn.addEventListener('click', () => loadContact(root, id, btn));
  }

  /** 联系方式区域的初始态（退出登录后要还原成这个） */
  function contactPlaceholderHtml() {
    return `<div class="d-contact">
      <p class="hint">联系方式由发布者提供，查看前需登录</p>
      <div class="d-ct-actions">
        <button type="button" class="btn" id="d-ct-btn">查看联系方式</button>
      </div>
      <p class="tip" style="margin:14px 0 0">登录仅用于防止信息被批量抓取，不会公开您的邮箱。</p>
    </div>`;
  }

  /** 登录框（邮箱验证码） */
  function loginGateHtml(msg) {
    return `<div class="d-login">
      <h3>登录后可查看联系方式</h3>
      <p>${esc(msg || '为保护卖家隐私，联系方式需登录后查看。')}<br>登录仅用于防止信息被批量抓取，不会公开您的邮箱。</p>
      <form id="d-login-form" novalidate>
        <div class="d-field">
          <label for="d-email">邮箱</label>
          <input type="email" id="d-email" name="email" autocomplete="email"
                 placeholder="you@example.com" required>
        </div>
        <div class="d-code-row">
          <div class="d-field">
            <label for="d-code">验证码</label>
            <input type="text" id="d-code" name="code" inputmode="numeric" maxlength="6"
                   autocomplete="one-time-code" placeholder="6 位数字" required>
          </div>
          <button type="button" class="d-send" id="d-send">获取验证码</button>
        </div>
        <p class="d-err" id="d-err" role="alert"></p>
        <button type="submit" class="btn" id="d-login-btn">登录</button>
      </form>
      <p class="d-alt">
        首次登录将自动创建账号 · <a href="/trucks/">返回车源大厅</a>
      </p>
    </div>`;
  }

  function bindLoginGate(root, id) {
    const form = root.querySelector('#d-login-form');
    const emailEl = root.querySelector('#d-email');
    const codeEl = root.querySelector('#d-code');
    const sendBtn = root.querySelector('#d-send');
    const submitBtn = root.querySelector('#d-login-btn');
    const errEl = root.querySelector('#d-err');
    if (!form || !emailEl || !codeEl || !sendBtn || !submitBtn) return;

    let countdown = 0;
    let timer = null;

    function showErr(msg) {
      errEl.textContent = msg || '';
    }

    /** 倒计时：顺便防连点，比单纯禁用按钮的体验好（用户知道还要等多久） */
    function startCountdown(sec) {
      countdown = sec;
      sendBtn.disabled = true;
      sendBtn.textContent = `${countdown} 秒后重发`;
      timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          clearInterval(timer);
          timer = null;
          sendBtn.disabled = false;
          sendBtn.textContent = '重新获取';
          return;
        }
        sendBtn.textContent = `${countdown} 秒后重发`;
      }, 1000);
    }

    sendBtn.addEventListener('click', async () => {
      showErr('');
      const email = emailEl.value.trim();
      if (!email) {
        showErr('请先填写邮箱');
        emailEl.focus();
        return;
      }

      sendBtn.disabled = true;
      sendBtn.textContent = '发送中…';
      try {
        const res = await fetch('/api/auth/send-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok) {
          showErr(json.msg || '发送失败，请稍后重试');
          sendBtn.disabled = false;
          sendBtn.textContent = '获取验证码';
          return;
        }

        startCountdown(60);
        codeEl.focus();

        // 开发模式：验证码直接写在响应里，帮测试者拿到码
        if (json.devCode) {
          showErr('');
          codeEl.value = json.devCode;
          const tip = root.querySelector('#d-err');
          tip.style.color = '#a15c00';
          tip.textContent = `开发模式：验证码已自动填入（${json.devCode}）`;
        } else {
          showErr('验证码已发送，请查收邮件（含垃圾箱）');
          const tip = root.querySelector('#d-err');
          tip.style.color = '#2e7d32';
        }
      } catch {
        showErr('网络错误，请稍后重试');
        sendBtn.disabled = false;
        sendBtn.textContent = '获取验证码';
      }
    });

    // 验证码框：只留数字，输入 6 位自动聚焦登录按钮
    codeEl.addEventListener('input', () => {
      codeEl.value = codeEl.value.replace(/\D/g, '').slice(0, 6);
      if (codeEl.value.length === 6) submitBtn.focus();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showErr('');

      const email = emailEl.value.trim();
      const code = codeEl.value.trim();

      if (!email) {
        showErr('请输入邮箱');
        emailEl.focus();
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        showErr('请输入 6 位数字验证码');
        codeEl.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '登录中…';
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code }),
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.ok) {
          showErr(json.msg || '登录失败，请重试');
          submitBtn.disabled = false;
          submitBtn.textContent = '登录';
          // 验证码作废类错误（过期/超次数）→ 清空输入并恢复发码按钮
          if (json.fatal) {
            codeEl.value = '';
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
            sendBtn.disabled = false;
            sendBtn.textContent = '重新获取';
          }
          return;
        }

        // ★ 登录成功 → 直接重新拉联系方式，不用用户再点一次
        await loadContact(root, id, null);
      } catch {
        showErr('网络错误，请稍后重试');
        submitBtn.disabled = false;
        submitBtn.textContent = '登录';
      }
    });
  }

  // 发布表单
  const MAX_IMG = 9;
  const MAX_SIZE = 5 * 1024 * 1024;

  function bindImagePicker() {
    const input = document.getElementById('f-images');
    const box = document.getElementById('img-preview');
    if (!input || !box) return;
    let files = [];

    function render() {
      box.innerHTML = files
        .map((f, i) => {
          const url = URL.createObjectURL(f);
          return `<div class="thumb">
            <img src="${url}" alt="预览 ${i + 1}">
            <button type="button" class="thumb-x" data-i="${i}" aria-label="删除">×</button>
          </div>`;
        })
        .join('');
      box.querySelectorAll('.thumb-x').forEach((b) => {
        b.addEventListener('click', () => {
          files.splice(Number(b.dataset.i), 1);
          syncInput();
          render();
        });
      });
    }

    // 把 FileList 同步回 input（用 DataTransfer），保证 reset() 能清空
    function syncInput() {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      input.files = dt.files;
    }

    input.addEventListener('change', () => {
      const picked = Array.from(input.files || []);
      const tooBig = picked.filter((f) => f.size > MAX_SIZE);
      const notImg = picked.filter((f) => !/^image\/(jpeg|png|webp|gif)$/.test(f.type));

      if (notImg.length) {
        alert('只支持 JPG / PNG / WebP / GIF 图片');
      }
      if (tooBig.length) {
        alert(`有 ${tooBig.length} 张超过 5MB，已忽略`);
      }

      const ok = picked.filter((f) => f.size <= MAX_SIZE && /^image\/(jpeg|png|webp|gif)$/.test(f.type));
      files = files.concat(ok).slice(0, MAX_IMG);
      if (files.length + ok.length > MAX_IMG) alert(`最多 ${MAX_IMG} 张`);

      syncInput();
      render();
    });

    // 供提交时调用：清空预览
    window.__resetImages = () => {
      files = [];
      syncInput();
      render();
    };

    return () => files;
  }

  function bindSellForm() {
    const form = document.getElementById('sell-form');
    if (!form) return;
    const msg = document.getElementById('sell-msg');
    const getFiles = bindImagePicker();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      // 图片字段不参与 JSON 序列化，单独走上传接口
      fd.delete('file');
      const payload = Object.fromEntries(fd.entries());
      payload.has_accident = fd.get('has_accident') ? 1 : 0;
      // 数字字段转 number
      ['tonnage', 'year', 'hours', 'price'].forEach((k) => {
        if (payload[k] === '' || payload[k] == null) delete payload[k];
        else payload[k] = Number(payload[k]);
      });

      msg.className = 'msg';
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;

      try {
        // 1) 先传图片（若有）
        const picked = (typeof getFiles === 'function' ? getFiles() : []) || [];
        if (picked.length) {
          msg.textContent = `上传图片中…（0/${picked.length}）`;
          const up = new FormData();
          picked.forEach((f) => up.append('file', f));
          const upRes = await fetch('/api/upload', { method: 'POST', body: up });
          const upJson = await upRes.json();
          if (!upJson.ok) {
            msg.className = 'msg err';
            msg.textContent = upJson.msg || '图片上传失败';
            btn.disabled = false;
            return;
          }
          payload.images = upJson.keys;
        }

        // 2) 提交车源
        msg.textContent = '提交中…';
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.ok) {
          msg.className = 'msg ok';
          msg.textContent = json.msg || '提交成功';
          form.reset();
          if (window.__resetImages) window.__resetImages();
        } else {
          msg.className = 'msg err';
          msg.textContent = json.msg || '提交失败';
        }
      } catch (e) {
        msg.className = 'msg err';
        msg.textContent = '网络错误，请稍后重试';
      } finally {
        btn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const list = document.getElementById('truck-list');
    if (list) {
      // 优先级：URL 查询串（用户点筛选） > data-query（长尾路径页的服务端条件）
      const params = { ...parseDataQuery(list), ...parseQuery() };
      // 大厅页默认 biz=sale（长尾页不设默认，避免把出租/求购车源滤掉）
      if (!params.biz_type && !list.dataset.biz && list.dataset.limit === '20' && !list.dataset.query)
        params.biz_type = 'sale';
      loadTrucks(list, params);
    }
    const detail = document.getElementById('truck-detail');
    if (detail) renderDetail(detail);
    bindSellForm();
  });
})();
