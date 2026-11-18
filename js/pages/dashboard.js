/* Главная панель — разная для каждой роли (ТЗ п. 6.4.2). */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  function periodStats(state, days) {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - days + 1);
    const posted = state.operations.filter(o => o.status === 'posted' && !o.reversal_of_id && new Date(o.operation_date) >= from);
    const count = t => posted.filter(o => o.type === t && !Api.isReversed(o.id)).length;
    return { from, posted, receipts: count('receipt'), issues: count('issue'), all: posted.length };
  }

  function statCard(_unused, cls, label, value, href, danger) {
    const tag = href ? 'a' : 'div';
    return `<${tag} class="stat ${cls || 'navy'}" ${href ? `href="${href}"` : ''}>
      <div class="stat-label">${esc(label)}</div><div class="stat-value ${danger ? 'danger' : ''}">${esc(value)}</div>
    </${tag}>`;
  }

  function recentOpsHtml(state, limit) {
    const ops = state.operations.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id).slice(0, limit);
    return `<div class="card-box">
      <div class="card-head"><h3>Последние операции</h3><a href="#/operations">Все операции →</a></div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Дата</th><th>Документ</th><th>Тип</th><th>Пользователь</th></tr></thead><tbody>
      ${ops.length ? ops.map(o => `<tr>
        <td class="nowrap">${UI.fmtDate(o.operation_date)}</td>
        <td><a href="#/operations/${o.id}">${esc(o.number)}</a> ${o.status === 'draft' ? '<span class="badge-s amber">Черновик</span>' : ''}</td>
        <td>${UI.opBadge(o)}</td>
        <td>${esc(UI.shortName(Api.userName(o.created_by)))}</td></tr>`).join('')
        : '<tr><td class="empty" colspan="4">Операций пока нет</td></tr>'}
      </tbody></table></div></div>`;
  }

  function belowMinHtml() {
    const rows = Api.belowMin();
    return `<div class="card-box">
      <div class="card-head"><h3>Позиции ниже минимального остатка</h3>${rows.length ? '<a href="#/stock?deficit=1">Все →</a>' : ''}</div>
      <div class="table-wrap"><table class="data"><thead><tr><th>Наименование</th><th class="num">Остаток</th><th class="num">Мин.</th></tr></thead><tbody>
      ${rows.length ? rows.map(r => `<tr>
        <td><span class="mono">${esc(r.component.sku)}</span> ${esc(r.component.name)}</td>
        <td class="num qty-low">${UI.fmtQty(r.total, r.unit.name)}</td>
        <td class="num">${UI.fmtQty(r.component.min_stock)}</td></tr>`).join('')
        : '<tr><td class="empty" colspan="3">Все позиции выше минимального остатка</td></tr>'}
      </tbody></table></div></div>`;
  }

  function periodSelect(days) {
    return `<select class="form-select" id="dash-period" style="width:auto">
      ${[7, 30, 90, 365].map(d => `<option value="${d}" ${d === days ? 'selected' : ''}>за ${d} дн.</option>`).join('')}
    </select>`;
  }

  // ------------------------------------------------------------
  function renderAdmin(view, user, days) {
    const s = Api.state();
    const st = periodStats(s, days);
    const below = Api.belowMin().length;
    const activeUsers = s.users.filter(u => u.is_active).length;
    const auditCount = s.audit_log.filter(a => new Date(a.created_at) >= st.from).length;
    view.innerHTML = `
      <div class="card-head"><div class="muted">Сводка ${esc(periodLabel(days))}</div>${periodSelect(days)}</div>
      <div class="stats">
        ${statCard('', '', 'Всего комплектующих', s.components.filter(c => !c.is_archived).length, '#/components')}
        ${statCard('', 'green', 'Поступлений', st.receipts, '#/operations')}
        ${statCard('', 'blue', 'Выдач', st.issues, '#/operations')}
        ${statCard('', 'red', 'Низкий остаток', below, '#/stock', below > 0)}
      </div>
      <div class="grid-2 row-gap">${recentOpsHtml(s, 6)}${belowMinHtml()}</div>
      <div class="grid-3">
        <div class="card-box"><div class="card-head"><h3>Пользователи</h3><a href="#/users">Управление →</a></div>
          <p>Всего: <b>${s.users.length}</b> · активных: <b class="text-success">${activeUsers}</b> · заблокировано: <b class="text-danger">${s.users.length - activeUsers}</b></p>
          ${s.roles.map(r => `<div>${esc(r.name)}: <b>${s.users.filter(u => u.role_id === r.id).length}</b></div>`).join('')}
        </div>
        <div class="card-box"><div class="card-head"><h3>Справочники</h3><a href="#/directories">Открыть →</a></div>
          <div>Категорий: <b>${s.categories.filter(c => c.is_active).length}</b></div>
          <div>Единиц измерения: <b>${s.units.length}</b></div>
          <div>Мест хранения: <b>${s.locations.filter(c => c.is_active).length}</b></div>
        </div>
        <div class="card-box"><div class="card-head"><h3>Операции ${esc(periodLabel(days))}</h3><a href="#/audit">Журнал →</a></div>
          <div>Проведено документов: <b>${st.all}</b></div>
          <div>Черновиков: <b>${s.operations.filter(o => o.status === 'draft').length}</b></div>
          <div>Записей в журнале действий: <b>${auditCount}</b></div>
        </div>
      </div>`;
    bindPeriod(view, user);
  }

  function renderStorekeeper(view, user, days) {
    const s = Api.state();
    const st = periodStats(s, days);
    const drafts = s.operations.filter(o => o.status === 'draft');
    const below = Api.belowMin().length;
    view.innerHTML = `
      <div class="quick-actions">
        ${Object.entries(Api.OP_TYPES).map(([k, t]) => `<a class="quick" href="#/operations/new/${k}"><span class="q-ico">${Icons.icon(t.icon, 26)}</span>${esc(t.name)}</a>`).join('')}
      </div>
      <div class="card-head"><div class="muted">Показатели ${esc(periodLabel(days))}</div>${periodSelect(days)}</div>
      <div class="stats">
        ${statCard('', '', 'Всего комплектующих', s.components.filter(c => !c.is_archived).length, '#/components')}
        ${statCard('', 'green', 'Поступлений', st.receipts, '#/operations')}
        ${statCard('', 'blue', 'Выдач', st.issues, '#/operations')}
        ${statCard('', 'red', 'Низкий остаток', below, '#/stock', below > 0)}
      </div>
      <div class="grid-2 row-gap">${belowMinHtml()}
        <div class="card-box"><div class="card-head"><h3>Черновики документов</h3></div>
          <div class="table-wrap"><table class="data"><thead><tr><th>Документ</th><th>Тип</th><th>Дата</th><th></th></tr></thead><tbody>
          ${drafts.length ? drafts.map(o => `<tr><td>${esc(o.number)}</td><td>${UI.opBadge(o)}</td><td>${UI.fmtDate(o.operation_date)}</td>
            <td class="num"><a class="btn btn-sm btn-outline-primary" href="#/operations/edit/${o.id}">Открыть</a></td></tr>`).join('')
            : '<tr><td class="empty" colspan="4">Черновиков нет</td></tr>'}
          </tbody></table></div></div>
      </div>
      ${recentOpsHtml(s, 8)}`;
    bindPeriod(view, user);
  }

  function renderManager(view, user, days) {
    const s = Api.state();
    const st = periodStats(s, days);
    const below = Api.belowMin().length;
    view.innerHTML = `
      <div class="card-head"><div class="muted">Аналитика ${esc(periodLabel(days))}</div>${periodSelect(days)}</div>
      <div class="stats">
        ${statCard('', '', 'Всего комплектующих', s.components.filter(c => !c.is_archived).length, '#/components')}
        ${statCard('', 'green', 'Поступлений', st.receipts, '#/reports')}
        ${statCard('', 'blue', 'Выдач', st.issues, '#/reports')}
        ${statCard('', 'red', 'Низкий остаток', below, '#/stock', below > 0)}
      </div>
      <div class="card-box"><div class="card-head"><h3>Динамика поступлений и выдач</h3><span class="muted">количество единиц по дням</span></div>
        <div class="chart-box" id="ch-dyn"></div></div>
      <div class="grid-2 row-gap">
        <div class="card-box"><div class="card-head"><h3>Наиболее расходуемые позиции</h3></div><div class="chart-box" id="ch-top"></div></div>
        <div class="card-box"><div class="card-head"><h3>Остатки по категориям</h3><span class="muted">кол-во позиций с остатком</span></div><div class="chart-box" id="ch-cat"></div></div>
      </div>
      ${belowMinHtml()}`;
    bindPeriod(view, user);

    // данные для графиков — те же, что в отчёте «Движение комплектующего»
    const fromStr = UI.isoDate(st.from);
    const mv = Api.movements({ from: fromStr });
    const labels = [];
    const idx = {};
    for (let d = new Date(st.from); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const k = UI.isoDate(d);
      idx[k] = labels.length;
      labels.push(d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }));
    }
    const rec = new Array(labels.length).fill(0);
    const iss = new Array(labels.length).fill(0);
    const topMap = new Map();
    mv.forEach(({ op, d }) => {
      const k = UI.isoDate(new Date(op.operation_date));
      const sign = op.reversal_of_id ? -1 : 1;
      if (idx[k] === undefined) return;
      if (op.type === 'receipt') rec[idx[k]] += sign * d.quantity;
      if (op.type === 'issue') {
        iss[idx[k]] += sign * d.quantity;
        topMap.set(d.component_id, (topMap.get(d.component_id) || 0) + sign * d.quantity);
      }
    });
    UI.chart(view.querySelector('#ch-dyn'), {
      type: days > 60 ? 'line' : 'bar',
      data: { labels, datasets: [
        { label: 'Поступления', data: rec, backgroundColor: '#16a34a', borderColor: '#16a34a' },
        { label: 'Выдачи', data: iss, backgroundColor: '#3b82f6', borderColor: '#3b82f6' }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });
    const top = Array.from(topMap.entries()).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
    UI.chart(view.querySelector('#ch-top'), {
      type: 'bar',
      data: {
        labels: top.map(([cid]) => { const c = Api.byId(s.components, cid); return c ? c.name : cid; }),
        datasets: [{ label: 'Выдано', data: top.map(x => x[1]), backgroundColor: '#2a5a8f' }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });
    const catRows = s.categories.map(c => ({
      name: c.name,
      n: Api.stockReport({ category_id: c.id }).filter(r => r.total > 0).length
    })).filter(x => x.n > 0);
    UI.chart(view.querySelector('#ch-cat'), {
      type: 'doughnut',
      data: { labels: catRows.map(x => x.name), datasets: [{ data: catRows.map(x => x.n), backgroundColor: UI.palette }] },
      options: { plugins: { legend: { position: 'right' } } }
    });
  }

  function periodLabel(days) { return `за последние ${days} дн.`; }

  function bindPeriod(view, user) {
    const sel = view.querySelector('#dash-period');
    if (sel) sel.addEventListener('change', () => {
      sessionStorage.setItem('ic_dash_days', sel.value);
      Pages.dashboard.render(view, {}, user);
    });
  }

  Pages.dashboard = {
    title: 'Главная',
    perm: 'dashboard',
    render(view, params, user) {
      UI.setTitle('Добро пожаловать, ' + UI.shortName(user.full_name) + '!');
      UI.destroyCharts();
      const days = Number(sessionStorage.getItem('ic_dash_days')) || 30;
      if (user.role === Api.ROLES.ADMIN) return renderAdmin(view, user, days);
      if (user.role === Api.ROLES.STORE) return renderStorekeeper(view, user, days);
      return renderManager(view, user, days);
    }
  };
})(window);
