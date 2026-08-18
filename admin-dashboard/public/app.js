// app.js — Pixgo Admin Dashboard
// Nenhuma lógica de negócio vive aqui além de apresentação — todos os dados
// vêm de /api/* (proxy autenticado → api.pixgo.qzz.io/api/admin/*).

(() => {
  'use strict';

  const SESSION_KEY = 'pixgo_admin_dash_key';

  const PLAN_LABELS = {
    free: 'Free',
    premium: 'Mensal',
    premium_quarterly: 'Trimestral',
    premium_annual: 'Anual',
  };

  const state = {
    key: sessionStorage.getItem(SESSION_KEY) || '',
    users: { page: 1, limit: 20, total: 0, rows: [] },
    subs: { page: 1, limit: 20, total: 0, status: '', rows: [] },
  };

  // ── API ──────────────────────────────────────────────────────────────────
  async function apiCall(base, path, { method = 'GET', body, query } = {}) {
    let url = `/${base}/${path}`;
    if (query) {
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([, v]) => v !== '' && v != null)));
      const qsStr = qs.toString();
      if (qsStr) url += `?${qsStr}`;
    }
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-dashboard-key': state.key },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      logout();
      throw new Error('Sessão inválida.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Erro ${res.status}`);
    return data;
  }
  // API principal (api.pixgo.qzz.io/api/admin/*)
  const api = (path, opts) => apiCall('api', path, opts);
  // Copyright-worker (copyright.pixgo.qzz.io/admin/*) — uploads pendentes, denúncias, suporte
  const copyrightApi = (path, opts) => apiCall('copyright', path, opts);

  // ── AUTH ─────────────────────────────────────────────────────────────────
  const loginScreen = document.getElementById('login-screen');
  const appEl = document.getElementById('app');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  function showApp() {
    loginScreen.hidden = true;
    appEl.hidden = false;
    boot();
  }
  function showLogin() {
    appEl.hidden = true;
    loginScreen.hidden = false;
  }
  function logout() {
    state.key = '';
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const key = document.getElementById('login-key').value.trim();
    if (!key) return;

    const btn = loginForm.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'A validar…';

    state.key = key;
    try {
      await api('stats');
      sessionStorage.setItem(SESSION_KEY, key);
      showApp();
    } catch (err) {
      state.key = '';
      loginError.textContent = 'Key inválida ou API inacessível.';
      loginError.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

  // ── TOAST ────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ── NAV ──────────────────────────────────────────────────────────────────
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });

  function switchSection(name) {
    navItems.forEach((b) => b.classList.toggle('active', b.dataset.section === name));
    document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === `section-${name}`));
    if (name === 'overview') loadOverview();
    if (name === 'users') loadUsers();
    if (name === 'subscriptions') loadSubs();
    if (name === 'moderation') loadModeration();
    if (name === 'reports') loadReports();
    if (name === 'support') loadSupport();
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
           ' ' + d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  }
  function planPill(planId) {
    const label = PLAN_LABELS[planId] || planId || 'free';
    const cls = planId === 'free' || !planId ? 'pill-muted' : 'pill-purple';
    return `<span class="pill ${cls}">${label}</span>`;
  }
  function activePill(isActive) {
    return isActive
      ? '<span class="pill pill-green">Activo</span>'
      : '<span class="pill pill-red">Inactivo</span>';
  }
  function subStatusPill(status) {
    if (status === 'active') return '<span class="pill pill-green">Activa</span>';
    if (status === 'expired') return '<span class="pill pill-red">Expirada</span>';
    return `<span class="pill pill-muted">${status || '—'}</span>`;
  }
  function uploadStatusPill(status) {
    if (status === 'pending') return '<span class="pill pill-yellow">Em análise</span>';
    if (status === 'blocked') return '<span class="pill pill-red">Bloqueado</span>';
    if (status === 'approved') return '<span class="pill pill-green">Aprovado</span>';
    if (status === 'rejected') return '<span class="pill pill-red">Rejeitado</span>';
    return `<span class="pill pill-muted">${status || '—'}</span>`;
  }
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderPagination(containerId, pageState, onPage) {
    const el = document.getElementById(containerId);
    const pages = Math.max(1, Math.ceil(pageState.total / pageState.limit));
    el.innerHTML = `
      <span>${pageState.total} registo(s) — página ${pageState.page} de ${pages}</span>
      <div class="page-controls">
        <button ${pageState.page <= 1 ? 'disabled' : ''} data-dir="-1">Anterior</button>
        <button ${pageState.page >= pages ? 'disabled' : ''} data-dir="1">Seguinte</button>
      </div>`;
    el.querySelectorAll('button[data-dir]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pageState.page += parseInt(btn.dataset.dir, 10);
        onPage();
      });
    });
  }

  // ── OVERVIEW ─────────────────────────────────────────────────────────────
  async function loadOverview() {
    try {
      const [stats, pending, abuse, support] = await Promise.all([
        api('stats'),
        copyrightApi('pending').catch(() => ({ items: [] })),
        copyrightApi('abuse').catch(() => ({ items: [] })),
        copyrightApi('support').catch(() => ({ items: [] })),
      ]);

      const pendingCount = (pending.items || []).filter((it) => it.status === 'pending').length;

      const grid = document.getElementById('stat-grid');
      grid.innerHTML = `
        ${statCard('Utilizadores totais', stats.total_users ?? 0, 'accent')}
        ${statCard('Utilizadores activos', stats.active_users ?? 0, 'green')}
        ${statCard('Assinantes pagos', stats.paid_users ?? 0, 'purple')}
        ${statCard('Uploads em análise', pendingCount, pendingCount > 0 ? 'yellow' : '')}
        ${statCard('Denúncias recebidas', (abuse.items || []).length, '')}
        ${statCard('Pedidos de suporte', (support.items || []).length, '')}
      `;

      updateModerationBadge(pendingCount);

      const tbody = document.querySelector('#activity-table tbody');
      const activity = stats.recent_activity || [];
      tbody.innerHTML = activity.length
        ? activity.map((a) => `
          <tr>
            <td class="mono">${esc(a.action)}</td>
            <td>${esc(a.admin_type)}</td>
            <td>${a.status >= 200 && a.status < 400 ? `<span class="pill pill-green">${a.status}</span>` : `<span class="pill pill-red">${a.status}</span>`}</td>
            <td class="cell-muted">${a.duration != null ? a.duration + ' ms' : '—'}</td>
            <td class="cell-muted">${fmtDate(a.timestamp)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="5">Sem actividade recente.</td></tr>`;
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  function statCard(label, value, colorClass) {
    return `<div class="stat-card"><p class="stat-label">${label}</p><p class="stat-value ${colorClass}">${value}</p></div>`;
  }
  function updateModerationBadge(pending) {
    const badge = document.getElementById('moderation-badge');
    if (pending > 0) { badge.textContent = pending; badge.hidden = false; }
    else badge.hidden = true;
  }

  document.getElementById('refresh-overview').addEventListener('click', loadOverview);

  // ── USERS ────────────────────────────────────────────────────────────────
  async function loadUsers() {
    const tbody = document.querySelector('#users-table tbody');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">A carregar…</td></tr>`;
    try {
      const data = await api('users', { query: { page: state.users.page, limit: state.users.limit } });
      state.users.total = data.pagination.total;
      state.users.rows = data.users;

      tbody.innerHTML = data.users.length
        ? data.users.map((u) => `
          <tr class="clickable" data-username="${esc(u.username)}">
            <td class="mono">${esc(u.username)}</td>
            <td>${esc(u.name) || '—'}</td>
            <td class="cell-muted">${esc(u.email) || '—'}</td>
            <td>${planPill(u.plan_id)}</td>
            <td>${activePill(u.is_active)}</td>
            <td class="cell-muted">${fmtDate(u.created_at)}</td>
            <td><button class="btn btn-sm btn-ghost open-user" data-username="${esc(u.username)}">Ver</button></td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="7">Nenhum utilizador encontrado.</td></tr>`;

      tbody.querySelectorAll('.open-user, tr.clickable').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          openUserDrawer(el.dataset.username);
        });
      });

      renderPagination('users-pagination', state.users, loadUsers);
    } catch (err) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Erro: ${esc(err.message)}</td></tr>`;
    }
  }

  // ── USER DRAWER ──────────────────────────────────────────────────────────
  const overlay = document.getElementById('overlay');
  const userDrawer = document.getElementById('user-drawer');

  function openOverlay() { overlay.hidden = false; }
  function closeOverlayAndPanels() {
    overlay.hidden = true;
    userDrawer.hidden = true;
    document.getElementById('new-user-modal').hidden = true;
    document.getElementById('detail-modal').hidden = true;
  }
  overlay.addEventListener('click', closeOverlayAndPanels);
  document.querySelectorAll('[data-close-drawer], [data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', closeOverlayAndPanels);
  });

  async function openUserDrawer(username) {
    document.getElementById('user-drawer-title').textContent = username;
    const body = document.getElementById('user-drawer-body');
    body.innerHTML = `<p class="empty-hint">A carregar…</p>`;
    openOverlay();
    userDrawer.hidden = false;

    try {
      const [detail, usage] = await Promise.all([
        api(`users/${encodeURIComponent(username)}`),
        api(`users/${encodeURIComponent(username)}/usage`).catch(() => ({ profiles: [] })),
      ]);
      renderUserDrawer(detail, usage);
    } catch (err) {
      body.innerHTML = `<p class="empty-hint">Erro: ${esc(err.message)}</p>`;
    }
  }

  function renderUserDrawer(detail, usage) {
    const { user, profiles, subscription } = detail;
    const body = document.getElementById('user-drawer-body');

    body.innerHTML = `
      <div class="detail-block">
        <h3>Dados</h3>
        <div class="kv-list">
          <div class="kv-row"><span class="k">Nome</span><span class="v" style="font-family:inherit">${esc(user.name) || '—'}</span></div>
          <div class="kv-row"><span class="k">Email</span><span class="v" style="font-family:inherit">${esc(user.email) || '—'}</span></div>
          <div class="kv-row"><span class="k">Role</span><span class="v">${esc(user.role)}</span></div>
          <div class="kv-row"><span class="k">Estado</span><span class="v">${activePill(user.is_active)}</span></div>
          <div class="kv-row"><span class="k">Criado em</span><span class="v">${fmtDate(user.created_at)}</span></div>
          <div class="kv-row"><span class="k">Perfis</span><span class="v">${profiles.length}</span></div>
        </div>
      </div>

      <div class="detail-block">
        <h3>Editar</h3>
        <form id="edit-user-form" class="modal-form" style="padding:0;">
          <label>Nome<input type="text" name="name" value="${esc(user.name)}"></label>
          <label>Email<input type="email" name="email" value="${esc(user.email) || ''}"></label>
          <label>Role
            <select name="role">
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
            </select>
          </label>
          <label>Estado
            <select name="is_active">
              <option value="true" ${user.is_active ? 'selected' : ''}>Activo</option>
              <option value="false" ${!user.is_active ? 'selected' : ''}>Inactivo</option>
            </select>
          </label>
          <button type="submit" class="btn btn-primary">Guardar alterações</button>
        </form>
      </div>

      <div class="detail-block">
        <h3>Plano / assinatura</h3>
        <div class="kv-list" style="margin-bottom:10px;">
          <div class="kv-row"><span class="k">Plano actual</span><span class="v">${planPill(user.plan_id)}</span></div>
          ${subscription ? `
            <div class="kv-row"><span class="k">Estado assinatura</span><span class="v">${subStatusPill(subscription.status)}</span></div>
            <div class="kv-row"><span class="k">Início</span><span class="v">${fmtDate(subscription.started_at)}</span></div>
            <div class="kv-row"><span class="k">Expira</span><span class="v">${fmtDate(subscription.expires_at)}</span></div>
          ` : `<div class="kv-row"><span class="k">Assinatura</span><span class="v" style="font-family:inherit;color:var(--text-muted)">Sem registo (free)</span></div>`}
        </div>
        <form id="edit-plan-form" style="display:flex;gap:8px;">
          <select name="planId" style="flex:1;background:var(--bg-inset);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:7px 8px;">
            <option value="free" ${user.plan_id === 'free' ? 'selected' : ''}>Free</option>
            <option value="premium" ${user.plan_id === 'premium' ? 'selected' : ''}>Mensal Premium</option>
            <option value="premium_quarterly" ${user.plan_id === 'premium_quarterly' ? 'selected' : ''}>Trimestral Premium</option>
            <option value="premium_annual" ${user.plan_id === 'premium_annual' ? 'selected' : ''}>Anual Premium</option>
          </select>
          <button type="submit" class="btn btn-sm btn-ghost">Trocar</button>
        </form>
      </div>

      <div class="detail-block">
        <h3>Uso / progresso</h3>
        ${renderUsageBlock(usage)}
      </div>

      <div class="detail-block">
        <button id="delete-user-btn" class="btn btn-danger" style="width:100%;">Eliminar utilizador</button>
      </div>
    `;

    document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`users/${encodeURIComponent(user.username)}`, {
          method: 'PUT',
          body: {
            name: fd.get('name'),
            email: fd.get('email') || null,
            role: fd.get('role'),
            is_active: fd.get('is_active') === 'true',
          },
        });
        toast('Utilizador actualizado.', 'success');
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('edit-plan-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api(`users/${encodeURIComponent(user.username)}/plan`, {
          method: 'PUT',
          body: { planId: fd.get('planId') },
        });
        toast('Plano actualizado.', 'success');
        openUserDrawer(user.username);
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('delete-user-btn').addEventListener('click', async () => {
      if (!confirm(`Eliminar definitivamente "${user.username}"? Esta acção não pode ser revertida.`)) return;
      try {
        await api(`users/${encodeURIComponent(user.username)}`, { method: 'DELETE' });
        toast('Utilizador eliminado.', 'success');
        closeOverlayAndPanels();
        loadUsers();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function renderUsageBlock(usage) {
    const profiles = usage?.profiles || [];
    if (!profiles.length) return `<p class="empty-hint">Sem actividade registada.</p>`;

    return profiles.map((p) => {
      const totalItems = p.items_in_progress + p.items_completed;
      const items = (p.recent_items || []).slice(0, 5);
      return `
        <div style="margin-bottom:16px;">
          <div class="kv-row" style="margin-bottom:8px;">
            <span class="k">Perfil: ${esc(p.profile_name)}</span>
            <span class="v" style="font-family:inherit;color:var(--text-muted)">${totalItems} título(s) · última actividade ${fmtDate(p.last_activity)}</span>
          </div>
          ${items.length ? items.map((it) => `
            <div class="progress-item">
              <div class="pi-top">
                <span class="content-id">${esc(it.content_id)}</span>
                <span>${it.progress ?? 0}%</span>
              </div>
              <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(100, it.progress || 0)}%"></div></div>
            </div>
          `).join('') : '<p class="empty-hint">Sem itens recentes.</p>'}
        </div>`;
    }).join('');
  }

  // ── NEW USER MODAL ───────────────────────────────────────────────────────
  const newUserModal = document.getElementById('new-user-modal');
  document.getElementById('new-user-btn').addEventListener('click', () => {
    document.getElementById('new-user-form').reset();
    document.getElementById('new-user-error').hidden = true;
    openOverlay();
    newUserModal.hidden = false;
  });

  document.getElementById('new-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errorEl = document.getElementById('new-user-error');
    errorEl.hidden = true;
    try {
      await api('users', {
        method: 'POST',
        body: {
          username: fd.get('username'),
          password: fd.get('password'),
          name: fd.get('name'),
          email: fd.get('email') || undefined,
          role: fd.get('role'),
          plan_id: fd.get('plan_id'),
        },
      });
      toast('Utilizador criado.', 'success');
      closeOverlayAndPanels();
      loadUsers();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  });

  // ── SUBSCRIPTIONS ────────────────────────────────────────────────────────
  document.querySelectorAll('#subs-filter .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#subs-filter .filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.subs.status = chip.dataset.status;
      state.subs.page = 1;
      loadSubs();
    });
  });

  async function loadSubs() {
    const tbody = document.querySelector('#subs-table tbody');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">A carregar…</td></tr>`;
    try {
      const data = await api('subscriptions', { query: { page: state.subs.page, limit: state.subs.limit, status: state.subs.status } });
      state.subs.total = data.pagination.total;
      state.subs.rows = data.subscriptions;

      tbody.innerHTML = data.subscriptions.length
        ? data.subscriptions.map((s) => `
          <tr>
            <td class="mono">${esc(s.username)}</td>
            <td class="cell-muted">${esc(s.email) || '—'}</td>
            <td>${planPill(s.plan_id)}</td>
            <td class="mono">${s.amount_usdt != null ? s.amount_usdt + ' USDT' : '—'}</td>
            <td class="cell-muted">${esc(s.network) || '—'}</td>
            <td>${subStatusPill(s.status)}</td>
            <td class="cell-muted">${fmtDate(s.started_at)}</td>
            <td class="cell-muted">${fmtDate(s.expires_at)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="8">Nenhuma assinatura encontrada.</td></tr>`;

      renderPagination('subs-pagination', state.subs, loadSubs);
    } catch (err) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Erro: ${esc(err.message)}</td></tr>`;
    }
  }

  // ── MODERATION (uploads pendentes — copyright-worker) ───────────────────
  document.getElementById('refresh-moderation').addEventListener('click', loadModeration);

  async function loadModeration() {
    const tbody = document.querySelector('#moderation-table tbody');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">A carregar…</td></tr>`;
    try {
      const data = await copyrightApi('pending');
      const items = data.items || [];
      state.moderationRows = items;

      tbody.innerHTML = items.length
        ? items.map((it) => `
          <tr>
            <td class="clickable" data-detail="moderation" data-id="${esc(it.id)}">${esc(it.metadata?.title) || 'Sem título'}</td>
            <td class="cell-muted">${esc(it.metadata?.type) || '—'}</td>
            <td class="cell-muted">${esc(it.uploader?.username) || 'desconhecido'}</td>
            <td>${uploadStatusPill(it.status)}</td>
            <td>${it.aiFlagged ? '<span class="pill pill-yellow">Rever</span>' : '—'}</td>
            <td class="cell-muted">${fmtDate(it.createdAt)}</td>
            <td>
              ${it.status === 'pending' ? `
                <button class="btn btn-sm btn-primary" data-decide="approve" data-id="${esc(it.id)}">Aprovar</button>
                <button class="btn btn-sm btn-danger" data-decide="reject" data-id="${esc(it.id)}">Rejeitar</button>
              ` : ''}
            </td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="7">Nada em análise.</td></tr>`;

      tbody.querySelectorAll('[data-detail="moderation"]').forEach((el) => {
        el.addEventListener('click', () => openModerationDetail(el.dataset.id));
      });
      tbody.querySelectorAll('[data-decide]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await copyrightApi(`decide/${encodeURIComponent(btn.dataset.id)}/${btn.dataset.decide}`, { method: 'POST' });
            toast(btn.dataset.decide === 'approve' ? 'Upload aprovado.' : 'Upload rejeitado.', 'success');
            loadModeration();
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="7">Erro: ${esc(err.message)}</td></tr>`;
    }
  }

  function openModerationDetail(id) {
    const it = (state.moderationRows || []).find((x) => x.id === id);
    if (!it) return;
    openDetailModal(it.metadata?.title || 'Upload', `
      <div class="kv-list">
        <div class="kv-row"><span class="k">Tipo</span><span class="v">${esc(it.metadata?.type) || '—'}</span></div>
        <div class="kv-row"><span class="k">Ano</span><span class="v">${esc(it.metadata?.year) || '—'}</span></div>
        <div class="kv-row"><span class="k">Idioma</span><span class="v">${esc(it.metadata?.lang) || '—'}</span></div>
        <div class="kv-row"><span class="k">Enviado por</span><span class="v" style="font-family:inherit">${esc(it.uploader?.username) || 'desconhecido'} ${it.uploader?.email ? `(${esc(it.uploader.email)})` : ''}</span></div>
        <div class="kv-row"><span class="k">Estado</span><span class="v">${uploadStatusPill(it.status)}</span></div>
        ${it.reason ? `<div class="kv-row"><span class="k">Motivo bloqueio</span><span class="v" style="font-family:inherit">${esc(it.reason)}</span></div>` : ''}
        <div class="kv-row"><span class="k">Recebido</span><span class="v">${fmtDate(it.createdAt)}</span></div>
      </div>
      ${it.metadata?.description ? `<div class="detail-block"><h3>Descrição</h3><p style="font-size:13px;margin:0;">${esc(it.metadata.description)}</p></div>` : ''}
    `);
  }

  // ── REPORTS (denúncias — copyright-worker) ───────────────────────────────
  document.getElementById('refresh-reports').addEventListener('click', loadReports);

  async function loadReports() {
    const tbody = document.querySelector('#reports-table tbody');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="4">A carregar…</td></tr>`;
    try {
      const data = await copyrightApi('abuse');
      const items = data.items || [];
      state.reportsRows = items;

      tbody.innerHTML = items.length
        ? items.map((r) => `
          <tr class="clickable" data-id="${esc(r.id)}">
            <td class="mono">${esc(r.reporter?.username) || 'anónimo'}</td>
            <td>${esc(r.contentTitle)}</td>
            <td class="wrap">${esc(r.reason)}</td>
            <td class="cell-muted">${fmtDate(r.createdAt)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="4">Nenhuma denúncia recebida.</td></tr>`;

      tbody.querySelectorAll('tr.clickable').forEach((row) => {
        row.addEventListener('click', () => {
          const r = items.find((x) => x.id === row.dataset.id);
          if (!r) return;
          openDetailModal('Denúncia', `
            <div class="kv-list">
              <div class="kv-row"><span class="k">Denunciado por</span><span class="v" style="font-family:inherit">${esc(r.reporter?.username) || 'anónimo'}</span></div>
              <div class="kv-row"><span class="k">Conteúdo</span><span class="v" style="font-family:inherit">${esc(r.contentTitle)}</span></div>
              <div class="kv-row"><span class="k">Recebido</span><span class="v">${fmtDate(r.createdAt)}</span></div>
            </div>
            <div class="detail-block"><h3>Motivo</h3><p style="font-size:13px;margin:0;">${esc(r.reason)}</p></div>
          `);
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">Erro: ${esc(err.message)}</td></tr>`;
    }
  }

  // ── SUPPORT (copyright-worker) ────────────────────────────────────────────
  document.getElementById('refresh-support').addEventListener('click', loadSupport);

  async function loadSupport() {
    const tbody = document.querySelector('#support-table tbody');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="3">A carregar…</td></tr>`;
    try {
      const data = await copyrightApi('support');
      const items = data.items || [];
      state.supportRows = items;

      tbody.innerHTML = items.length
        ? items.map((s) => `
          <tr class="clickable" data-id="${esc(s.id)}">
            <td class="mono">${esc(s.email)}</td>
            <td class="wrap">${esc(s.message.length > 120 ? s.message.slice(0, 120) + '…' : s.message)}</td>
            <td class="cell-muted">${fmtDate(s.createdAt)}</td>
          </tr>`).join('')
        : `<tr class="empty-row"><td colspan="3">Nenhum pedido de suporte.</td></tr>`;

      tbody.querySelectorAll('tr.clickable').forEach((row) => {
        row.addEventListener('click', () => {
          const s = items.find((x) => x.id === row.dataset.id);
          if (!s) return;
          openDetailModal(s.email, `
            <div class="kv-list" style="margin-bottom:16px;">
              <div class="kv-row"><span class="k">Recebido</span><span class="v">${fmtDate(s.createdAt)}</span></div>
            </div>
            <div class="detail-block"><h3>Mensagem</h3><p style="font-size:13px;margin:0;white-space:pre-wrap;">${esc(s.message)}</p></div>
          `);
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="3">Erro: ${esc(err.message)}</td></tr>`;
    }
  }

  // ── DETAIL MODAL (genérico, só leitura) ──────────────────────────────────
  const detailModal = document.getElementById('detail-modal');
  function openDetailModal(title, bodyHtml) {
    document.getElementById('detail-modal-title').textContent = title;
    document.getElementById('detail-modal-body').innerHTML = bodyHtml;
    openOverlay();
    detailModal.hidden = false;
  }

  // ── PDF EXPORT ───────────────────────────────────────────────────────────
  function exportPDF(title, columns, rows) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(14);
    doc.text(title, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Pixgo Admin — gerado em ${new Date().toLocaleString('pt-PT')}`, 14, 22);

    doc.autoTable({
      startY: 28,
      head: [columns],
      body: rows,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [22, 27, 34], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.pdf`);
  }

  document.getElementById('export-subs-pdf').addEventListener('click', async () => {
    try {
      const data = await api('subscriptions', { query: { page: 1, limit: 500, status: state.subs.status } });
      const rows = data.subscriptions.map((s) => [
        s.username, s.email || '—', PLAN_LABELS[s.plan_id] || s.plan_id,
        s.amount_usdt != null ? `${s.amount_usdt} USDT` : '—', s.network || '—',
        s.status, fmtDate(s.started_at), fmtDate(s.expires_at),
      ]);
      exportPDF('Assinaturas', ['Utilizador', 'Email', 'Plano', 'Valor', 'Rede', 'Estado', 'Início', 'Expira'], rows);
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('export-users-pdf').addEventListener('click', async () => {
    try {
      const data = await api('users', { query: { page: 1, limit: 500 } });
      const rows = data.users.map((u) => [
        u.username, u.name || '—', u.email || '—', PLAN_LABELS[u.plan_id] || u.plan_id,
        u.is_active ? 'Activo' : 'Inactivo', fmtDate(u.created_at),
      ]);
      exportPDF('Utilizadores', ['Utilizador', 'Nome', 'Email', 'Plano', 'Estado', 'Criado em'], rows);
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('export-reports-pdf').addEventListener('click', async () => {
    try {
      const data = await copyrightApi('abuse');
      const rows = (data.items || []).map((r) => [
        r.reporter?.username || 'anónimo', r.contentTitle, r.reason, fmtDate(r.createdAt),
      ]);
      exportPDF('Denuncias', ['Denunciado por', 'Conteúdo', 'Motivo', 'Recebido'], rows);
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('export-moderation-pdf').addEventListener('click', async () => {
    try {
      const data = await copyrightApi('pending');
      const rows = (data.items || []).map((it) => [
        it.metadata?.title || 'Sem título', it.metadata?.type || '—',
        it.uploader?.username || 'desconhecido', it.status,
        it.aiFlagged ? 'Sim' : 'Não', fmtDate(it.createdAt),
      ]);
      exportPDF('Moderacao de Uploads', ['Título', 'Tipo', 'Enviado por', 'Estado', 'Sinal IA', 'Recebido'], rows);
    } catch (err) { toast(err.message, 'error'); }
  });

  document.getElementById('export-support-pdf').addEventListener('click', async () => {
    try {
      const data = await copyrightApi('support');
      const rows = (data.items || []).map((s) => [s.email, s.message, fmtDate(s.createdAt)]);
      exportPDF('Suporte', ['Email', 'Mensagem', 'Recebido'], rows);
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── BOOT ─────────────────────────────────────────────────────────────────
  function boot() {
    loadOverview();
  }

  if (state.key) showApp();
})();
