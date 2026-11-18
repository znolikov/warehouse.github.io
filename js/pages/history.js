/* История движения: построчный журнал всех проведённых движений. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  Pages.history = {
    title: 'История движения комплектующих',
    perm: 'ops.view',
    render(view, params) {
      const s = Api.state();
      const typeOpts = Object.entries(Api.OP_TYPES).map(([k, t]) => ({ id: k, name: t.name }));
      view.innerHTML = `<div class="card-box">
        <div class="card-head"><h3>Журнал движений</h3><div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
        <div class="filters">
          <div class="f grow"><label class="form-label">Комплектующее</label><select class="form-select" id="f-c">${UI.options(s.components, params.component || '', 'Все позиции', c => c.sku + ' — ' + c.name)}</select></div>
          <div class="f"><label class="form-label">Тип</label><select class="form-select" id="f-t">${UI.options(typeOpts, '', 'Все типы')}</select></div>
          <div class="f"><label class="form-label">Место хранения</label><select class="form-select" id="f-l">${UI.options(s.locations, '', 'Все места')}</select></div>
          <div class="f"><label class="form-label">С даты</label><input type="date" class="form-control" id="f-from"></div>
          <div class="f"><label class="form-label">По дату</label><input type="date" class="form-control" id="f-to"></div>
        </div>
        <div id="tbl"></div></div>`;

      const table = new UI.DataTable(view.querySelector('#tbl'), {
        search: { placeholder: 'Поиск по документу, позиции, автору…', text: r => [r.number, r.comp, r.loc, r.author, r.receiver].join(' ') },
        defaultSort: { key: 'date', dir: 'desc' },
        emptyText: 'Движений нет',
        columns: [
          { key: 'date', title: 'Дата', sortValue: r => r.ts, render: r => `<span class="nowrap">${UI.fmtDateTime(r.date)}</span>` },
          { key: 'number', title: 'Документ', render: r => `<a href="#/operations/${r.opId}">${esc(r.number)}</a>` },
          { key: 'type', title: 'Операция', render: r => UI.opBadge(r.op) },
          { key: 'comp', title: 'Комплектующее' },
          { key: 'loc', title: 'Место хранения' },
          { key: 'delta', title: 'Изменение', num: true, render: r => `<span class="${r.delta > 0 ? 'delta-plus' : 'delta-minus'}">${r.delta > 0 ? '+' : ''}${UI.fmtQty(r.delta, r.unit)}</span>` },
          { key: 'author', title: 'Пользователь', render: r => esc(UI.shortName(r.author)) }
        ]
      });

      function rows() {
        const f = {
          component_id: view.querySelector('#f-c').value,
          type: view.querySelector('#f-t').value,
          from: view.querySelector('#f-from').value,
          to: view.querySelector('#f-to').value
        };
        const loc = Number(view.querySelector('#f-l').value) || null;
        const out = [];
        Api.movements(f).forEach(({ op, d, moves }) => moves.forEach(m => {
          if (loc && m.location_id !== loc) return;
          if (m.delta === 0) return;
          const u = Api.unitOf(d.component_id);
          out.push({
            op, opId: op.id, number: op.number, date: op.operation_date, ts: new Date(op.operation_date).getTime() * 1000 + op.id,
            comp: Api.componentLabel(d.component_id), loc: Api.locationLabel(m.location_id), delta: m.delta, unit: u ? u.name : '',
            author: Api.userName(op.created_by), receiver: op.receiver
          });
        }));
        return out;
      }
      function refresh() { table.setRows(rows()); }
      ['#f-c', '#f-t', '#f-l', '#f-from', '#f-to'].forEach(id => view.querySelector(id).addEventListener('change', refresh));
      view.querySelector('#exp').onclick = () => {
        const r = table.filtered();
        UI.exportXlsx('История_движений_' + UI.isoDate(new Date()) + '.xlsx', [{
          name: 'История движений', title: 'История движения комплектующих',
          headers: ['Дата', 'Документ', 'Операция', 'Комплектующее', 'Место хранения', 'Изменение', 'Ед. изм.', 'Пользователь'],
          rows: r.map(x => [UI.fmtDateTime(x.date), x.number, Api.OP_TYPES[x.op.type].name + (x.op.reversal_of_id ? ' (сторно)' : ''), x.comp, x.loc, x.delta, x.unit, x.author])
        }]);
      };
      refresh();
    }
  };
})(window);
