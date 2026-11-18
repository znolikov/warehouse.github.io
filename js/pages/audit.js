/* Журнал действий пользователей (только администратор). */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  const ENTITY = { user: 'Пользователь', operation: 'Документ', component: 'Комплектующее', categories: 'Категория', units: 'Ед. измерения', locations: 'Место хранения', system: 'Система' };

  function detailsText(d) {
    if (!d || typeof d !== 'object') return '';
    return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('; ');
  }

  Pages.audit = {
    title: 'Журнал действий',
    perm: 'audit.view',
    render(view) {
      const s = Api.state();
      const actions = Array.from(new Set(s.audit_log.map(a => a.action))).sort().map(a => ({ id: a, name: a }));
      view.innerHTML = `<div class="card-box"><div class="card-head"><h3>Аудит действий пользователей</h3>
        <div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
        <div class="filters">
          <div class="f"><label class="form-label">Пользователь</label><select class="form-select" id="f-u">${UI.options(s.users, '', 'Все', u => u.full_name + ' (' + u.login + ')')}</select></div>
          <div class="f grow"><label class="form-label">Действие</label><select class="form-select" id="f-a">${UI.options(actions, '', 'Все действия')}</select></div>
          <div class="f"><label class="form-label">С даты</label><input type="date" class="form-control" id="f-from"></div>
          <div class="f"><label class="form-label">По дату</label><input type="date" class="form-control" id="f-to"></div>
        </div><div id="tbl"></div></div>`;
      const t = new UI.DataTable(view.querySelector('#tbl'), {
        search: { placeholder: 'Поиск по журналу…', text: r => r.action + ' ' + r.user + ' ' + r.det },
        defaultSort: { key: 'created_at', dir: 'desc' },
        columns: [
          { key: 'created_at', title: 'Дата и время', sortValue: r => r.id, render: r => `<span class="nowrap">${UI.fmtDateTime(r.created_at)}</span>` },
          { key: 'user', title: 'Пользователь' },
          { key: 'action', title: 'Действие', render: r => `<b>${esc(r.action)}</b>` },
          { key: 'entity', title: 'Объект', render: r => esc(r.entity) + (r.entity_type === 'operation' && r.entity_id && Api.byId(Api.state().operations, r.entity_id) ? ` <a href="#/operations/${r.entity_id}">#${r.entity_id}</a>` : r.entity_id ? ' #' + r.entity_id : '') },
          { key: 'det', title: 'Подробности', render: r => `<span class="muted" style="font-size:13px">${esc(r.det)}</span>` }
        ]
      });
      function rows() {
        const u = Number(view.querySelector('#f-u').value) || null;
        const a = view.querySelector('#f-a').value;
        const from = view.querySelector('#f-from').value;
        const to = view.querySelector('#f-to').value;
        return Api.listAudit().filter(x => (!u || x.user_id === u) && (!a || x.action === a) &&
          (!from || new Date(x.created_at) >= new Date(from + 'T00:00:00')) && (!to || new Date(x.created_at) <= new Date(to + 'T23:59:59')))
          .map(x => Object.assign({}, x, { user: x.user_id ? Api.userName(x.user_id) : '—', entity: ENTITY[x.entity_type] || x.entity_type || '', det: detailsText(x.details) }));
      }
      const refresh = () => t.setRows(rows());
      ['#f-u', '#f-a', '#f-from', '#f-to'].forEach(id => view.querySelector(id).addEventListener('change', refresh));
      view.querySelector('#exp').onclick = () => UI.exportXlsx('Журнал_действий_' + UI.isoDate(new Date()) + '.xlsx', [{
        name: 'Журнал действий', title: 'Журнал действий пользователей',
        headers: ['Дата и время', 'Пользователь', 'Действие', 'Объект', 'ID объекта', 'Подробности'],
        rows: t.filtered().map(r => [UI.fmtDateTime(r.created_at), r.user, r.action, r.entity, r.entity_id || '', r.det])
      }]);
      refresh();
    }
  };
})(window);
