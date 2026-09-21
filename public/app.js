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

  // 首页搜索
  window.goSearch = function (ev) {
    ev.preventDefault();
    const p = new URLSearchParams();
    const t = document.getElementById('s-tonnage').value;
    const b = document.getElementById('s-brand').value;
    const pr = document.getElementById('s-province').value;
    if (t) p.set('tonnage', t);
    if (b) p.set('brand', b);
    if (pr) p.set('province', pr);
    location.href = '/trucks/' + (p.toString() ? '?' + p.toString() : '');
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
              <p class="tip">本站不参与交易、不做担保。请务必先验车、核实权属与过户条件，切勿先付款。</p>
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

  /** 联系方式区：默认只显示按钮，点了才请求 */
  function contactPlaceholderHtml() {
    return `<div class="d-contact">
      <p class="hint">为保护卖家隐私，联系方式需点击后查看</p>
      <button type="button" class="btn" id="d-ct-btn">查看联系方式</button>
    </div>`;
  }

  function bindContact(root, id) {
    const btn = root.querySelector('#d-ct-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '获取中…';
      try {
        const res = await fetch(`/api/truck/${id}/contact`, { headers: { Accept: 'application/json' } });
        const json = await res.json().catch(() => ({}));

        // 需要登录 → 显示登录占位框（后期接真实登录时只改这里）
        if (res.status === 401 && json.needLogin) {
          root.querySelector('#d-contact-slot').innerHTML = loginGateHtml(json.msg);
          bindLoginGate(root);
          return;
        }
        if (!res.ok || !json.ok) {
          btn.disabled = false;
          btn.textContent = '查看联系方式';
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
      } catch {
        btn.disabled = false;
        btn.textContent = '查看联系方式';
        alert('网络错误，请稍后重试');
      }
    });
  }

  /** 登录占位框（真实登录后期再接） */
  function loginGateHtml(msg) {
    return `<div class="d-login">
      <span class="soon">功能开发中</span>
      <h3>登录后可查看联系方式</h3>
      <p>为保护卖家隐私，联系方式需登录后查看。<br>登录功能正在开发，敬请期待。</p>
      <div class="d-ct-actions">
        <button type="button" class="btn" id="d-login-btn" disabled style="opacity:.55;cursor:default">登录（开发中）</button>
        <a class="btn ghost" href="/trucks/">返回车源大厅</a>
      </div>
    </div>`;
  }

  function bindLoginGate() {
    // 占位阶段按钮为 disabled，无需绑定。
    // 后期接真实登录时：
    //   1) 去掉按钮的 disabled / 内联样式，恢复可点
    //   2) 在这里给 #d-login-btn 绑点击，弹真实登录框
    //   3) 登录成功后重新执行 bindContact 里那段获取逻辑
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
      const params = { ...parseQuery() };
      // 大厅页默认 biz=sale
      if (!params.biz_type && !list.dataset.biz && list.dataset.limit === '20') params.biz_type = 'sale';
      loadTrucks(list, params);
    }
    const detail = document.getElementById('truck-detail');
    if (detail) renderDetail(detail);
    bindSellForm();
  });
})();
