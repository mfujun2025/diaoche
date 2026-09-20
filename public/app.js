// 前端交互：车源加载、筛选、发布表单提交
(function () {
  'use strict';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BIZ_LABEL = { sale: '转让', rent: '出租', buy: '求购' };

  function truckCard(t) {
    const name = `${t.tonnage}吨 ${t.brand}${t.model ? ' ' + t.model : ''}`;
    const meta = [
      t.year ? t.year + '年' : '',
      t.hours ? t.hours + '小时' : '',
      [t.province, t.city].filter(Boolean).join(' '),
    ].filter(Boolean);
    const price =
      t.price != null ? `<span class="t-price">${t.price}${t.price_unit || '万元'}</span>` : '<span class="t-price">面议</span>';
    return `<article class="truck">
      <div class="t-top"><span class="t-name">${esc(name)}</span>${price}</div>
      <div class="t-meta">
        <span class="tag">${BIZ_LABEL[t.biz_type] || '转让'}</span>
        ${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
        ${t.has_accident ? '<span class="tag acc">有事故记录</span>' : ''}
      </div>
      ${t.condition ? `<p class="t-cond">${esc(t.condition)}</p>` : ''}
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
  function bindSellForm() {
    const form = document.getElementById('sell-form');
    if (!form) return;
    const msg = document.getElementById('sell-msg');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      payload.has_accident = fd.get('has_accident') ? 1 : 0;
      // 数字字段转 number
      ['tonnage', 'year', 'hours', 'price'].forEach((k) => {
        if (payload[k] === '' || payload[k] == null) delete payload[k];
        else payload[k] = Number(payload[k]);
      });

      msg.className = 'msg';
      msg.textContent = '提交中…';
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;

      try {
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
