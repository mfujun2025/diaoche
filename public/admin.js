// 后台审核页交互（令牌登录保护）
(function () {
  'use strict';

  const TOKEN_KEY = 'dc_admin_token';

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const STATUS_LABEL = { pending: '待审核', approved: '已通过', rejected: '已驳回' };
  const BIZ_LABEL = { sale: '转让', rent: '出租', buy: '求购' };

  let currentStatus = 'pending';

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  /** 带令牌的请求封装 */
  function api(path, init) {
    const opts = Object.assign({}, init);
    opts.headers = Object.assign(
      { 'X-Admin-Token': getToken(), Accept: 'application/json' },
      (init && init.headers) || {}
    );
    return fetch(path, opts);
  }

  function showLogin(msg) {
    document.getElementById('admin-login').hidden = false;
    document.getElementById('admin-main').hidden = true;
    const box = document.getElementById('admin-login-msg');
    if (msg) {
      box.className = 'msg err';
      box.textContent = msg;
    } else {
      box.className = 'msg';
      box.textContent = '';
    }
  }

  function showMain() {
    document.getElementById('admin-login').hidden = true;
    document.getElementById('admin-main').hidden = false;
  }

  function row(t) {
    const name = `${t.tonnage}吨 ${t.brand}${t.model ? ' ' + t.model : ''}`;
    const meta = [t.year ? t.year + '年' : '', t.hours ? t.hours + '小时' : '', [t.province, t.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(' · ');
    const price = t.price != null ? `${t.price}${t.price_unit || '万元'}` : '面议';

    const actions = [];
    if (t.status !== 'approved') actions.push(`<button class="mini ok" data-id="${t.id}" data-act="approve">通过</button>`);
    if (t.status !== 'rejected') actions.push(`<button class="mini warn" data-id="${t.id}" data-act="reject">驳回</button>`);
    actions.push(`<button class="mini del" data-id="${t.id}" data-act="delete">删除</button>`);

    return `<tr>
      <td class="c-id">#${t.id}</td>
      <td>
        <div class="c-name">${esc(name)}</div>
        <div class="c-meta">${esc(meta)}</div>
        ${t.condition ? `<div class="c-cond">${esc(t.condition)}</div>` : ''}
      </td>
      <td class="c-price">${esc(price)}</td>
      <td><span class="pill ${esc(t.status)}">${STATUS_LABEL[t.status] || t.status}</span>
          <span class="pill">${BIZ_LABEL[t.biz_type] || '转让'}</span>
          ${t.has_accident ? '<span class="pill acc">事故</span>' : ''}</td>
      <td class="c-contact">${esc(t.contact)}</td>
      <td class="c-time">${esc((t.created_at || '').slice(0, 16))}</td>
      <td class="c-act">${actions.join('')}</td>
    </tr>`;
  }

  async function load(status) {
    currentStatus = status || currentStatus;
    const box = document.getElementById('admin-body');
    const msg = document.getElementById('admin-msg');
    box.innerHTML = '<tr><td colspan="7" class="loading">加载中…</td></tr>';

    try {
      const res = await api(`/api/admin/list?status=${encodeURIComponent(currentStatus)}&limit=100`);

      if (res.status === 401) {
        // 令牌失效（被改过或清空），退回登录态
        clearToken();
        showLogin('登录状态已失效，请重新输入访问令牌。');
        return;
      }

      const j = await res.json();
      if (!j.ok) throw new Error(j.msg || '加载失败');

      msg.className = 'msg';
      msg.textContent = `待审 ${j.counts.pending} · 已通过 ${j.counts.approved} · 已驳回 ${j.counts.rejected}`;

      document.querySelectorAll('[data-tab]').forEach((el) => {
        const k = el.dataset.tab;
        const n = k === 'all' ? j.counts.pending + j.counts.approved + j.counts.rejected : j.counts[k];
        el.querySelector('.n').textContent = n ?? 0;
        el.classList.toggle('on', k === currentStatus);
      });

      box.innerHTML = j.data.length
        ? j.data.map(row).join('')
        : '<tr><td colspan="7" class="loading">该分类下暂无记录</td></tr>';
    } catch (e) {
      msg.className = 'msg err';
      msg.textContent = '加载失败，请刷新重试。';
      box.innerHTML = '<tr><td colspan="7" class="loading">加载失败</td></tr>';
    }
  }

  /** 校验令牌是否可用，可用则进主界面 */
  async function tryToken(token) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'X-Admin-Token': token, Accept: 'application/json' },
    });
    if (res.ok) return { ok: true };
    let msg = '登录失败';
    try {
      const j = await res.json();
      if (j && j.msg) msg = j.msg;
    } catch {}
    return { ok: false, msg };
  }

  window.switchTab = function (ev, status) {
    ev.preventDefault();
    load(status);
    return false;
  };

  document.addEventListener('DOMContentLoaded', () => {
    // 登录表单
    document.getElementById('admin-login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = document.getElementById('admin-token');
      const btn = ev.target.querySelector('button');
      const token = input.value.trim();
      if (!token) return;

      btn.disabled = true;
      btn.textContent = '验证中…';
      const r = await tryToken(token);
      btn.disabled = false;
      btn.textContent = '登录';

      if (r.ok) {
        setToken(token);
        input.value = '';
        showMain();
        load('pending');
      } else {
        showLogin(r.msg);
      }
    });

    // 退出
    document.getElementById('admin-logout').addEventListener('click', (ev) => {
      ev.preventDefault();
      clearToken();
      showLogin('已退出登录。');
    });

    // 审核操作
    const box = document.getElementById('admin-body');
    box.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;

      const id = Number(btn.dataset.id);
      const act = btn.dataset.act;

      if (act === 'delete' && !confirm(`确认删除 #${id}？该操作不可恢复。`)) return;

      btn.disabled = true;
      btn.textContent = '处理中';
      try {
        const res = await api('/api/admin/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: act }),
        });

        if (res.status === 401) {
          clearToken();
          showLogin('登录状态已失效，请重新输入访问令牌。');
          return;
        }

        const j = await res.json();
        if (j.ok) {
          document.getElementById('admin-msg').className = 'msg ok';
          document.getElementById('admin-msg').textContent = j.msg;
          load(currentStatus);
        } else {
          document.getElementById('admin-msg').className = 'msg err';
          document.getElementById('admin-msg').textContent = j.msg || '操作失败';
          btn.disabled = false;
          btn.textContent = '重试';
        }
      } catch {
        document.getElementById('admin-msg').className = 'msg err';
        document.getElementById('admin-msg').textContent = '网络错误';
        btn.disabled = false;
        btn.textContent = '重试';
      }
    });

    // 启动：有令牌就直接进，否则显示登录框
    if (getToken()) {
      showMain();
      load('pending');
    } else {
      showLogin('');
    }
  });
})();
