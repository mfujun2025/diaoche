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

    return `<article class="truck">
      ${thumb}
      <div class="t-body">
        <div class="t-top"><span class="t-name">${esc(name)}</span>${price}</div>
        <div class="t-meta">
          <span class="tag">${BIZ_LABEL[t.biz_type] || '转让'}</span>
          ${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
          ${t.has_accident ? '<span class="tag acc">有事故记录</span>' : ''}
        </div>
        ${t.condition ? `<p class="t-cond">${esc(t.condition)}</p>` : ''}
      </div>
    </article>`;
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
    bindSellForm();
  });
})();
