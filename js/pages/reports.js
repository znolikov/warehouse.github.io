/* Отчёты (ТЗ п. 6.4.5) с графиками Chart.js и экспортом в XLSX.
   Графики строятся по тем же данным и фильтрам, что и таблицы отчётов. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  const TABS = [
    { id: 'stock', title: 'Текущие остатки' },
    { id: 'movement', title: 'Движение комплектующего' },
    { id: 'receivers', title: 'Выдача по получателям' },
    { id: 'belowmin', title: 'Ниже минимального остатка' }
  ];

  const stamp = () => UI.isoDate(new Date());
  const monthAgo = () => { const d = new Date(); d.setDate(d.getDate() - 30); return UI.isoDate(d); };

  // ---------------- Текущие остатки ----------------
  function stockData(filter) {
    const s = Api.state();
    const rows = Api.stockReport(filter);
    const locs = s.locations.filter(l => !filter.location_id || l.id === Number(filter.location_id))
      .filter(l => rows.some(r => r.byLocation.some(x => x.location.id === l.id)));
    return { rows, locs };
  }

  Pages.reports = {
    title: 'Отчёты',
    perm: 'reports',

    exportStock(filter) {
      const { rows, locs } = stockData(filter);
      UI.exportXlsx('Текущие_остатки_' + stamp() + '.xlsx', [{
        name: 'Текущие остатки', title: 'Отчёт «Текущие остатки» на ' + UI.fmtDateTime(new Date()),
        headers: ['Артикул', 'Наименование', 'Категория', 'Ед. изм.', ...locs.map(l => l.name), 'Итого', 'Мин. остаток', 'Ниже минимума'],
        rows: rows.map(r => [r.component.sku, r.component.name, r.category ? r.category.name : '', r.unit.name,
          ...locs.map(l => { const x = r.byLocation.find(b => b.location.id === l.id); return x ? x.quantity : 0; }),
          r.total, r.component.min_stock, r.deficit ? 'Да' : 'Нет'])
      }]);
    },

    render(view, params) {
      const tab = TABS.some(t => t.id === params.tab) ? params.tab : 'stock';
      view.innerHTML = `<div class="tabs">${TABS.map(t => `<a class="tab ${t.id === tab ? 'active' : ''}" href="#/reports?tab=${t.id}">${esc(t.title)}</a>`).join('')}</div><div id="rep"></div>`;
      const el = view.querySelector('#rep');
      ({ stock: renderStock, movement: renderMovement, receivers: renderReceivers, belowmin: renderBelowMin })[tab](el, params);
    }
  };

  function renderStock(el) {
    const s = Api.state();
    el.innerHTML = `<div class="card-box">
      <div class="card-head"><h3>Текущие остатки</h3><div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
      <div class="filters">
        <div class="f"><label class="form-label">Категория</label><select class="form-select" id="f-cat">${UI.options(s.categories, '', 'Все категории')}</select></div>
        <div class="f"><label class="form-label">Место хранения</label><select class="form-select" id="f-loc">${UI.options(s.locations, '', 'Все места')}</select></div>
        <div class="f"><label class="form-check"><input type="checkbox" id="f-def"> Только дефицит</label></div>
      </div>
      <div class="chart-box row-gap" id="chart"></div>
      <div id="tbl"></div></div>`;
    const filter = () => ({ category_id: el.querySelector('#f-cat').value, location_id: el.querySelector('#f-loc').value, deficit: el.querySelector('#f-def').checked });
    function build() {
      const { rows, locs } = stockData(filter());
      new UI.DataTable(el.querySelector('#tbl'), {
        rows,
        defaultSort: { key: 'sku', dir: 'asc' },
        emptyText: 'Нет данных',
        rowClass: r => r.deficit ? 'row-danger' : '',
        columns: [
          { key: 'sku', title: 'Артикул', sortValue: r => r.component.sku, render: r => `<span class="mono">${esc(r.component.sku)}</span>` },
          { key: 'name', title: 'Наименование', sortValue: r => r.component.name, render: r => esc(r.component.name) },
          { key: 'unit', title: 'Ед.', sortable: false, render: r => esc(r.unit.name) },
          ...locs.map(l => ({ key: 'l' + l.id, title: l.name, num: true, sortValue: r => (r.byLocation.find(b => b.location.id === l.id) || { quantity: 0 }).quantity,
            render: r => { const x = r.byLocation.find(b => b.location.id === l.id); return x ? UI.fmtQty(x.quantity) : '<span class="muted">0</span>'; } })),
          { key: 'total', title: 'Итого', num: true, sortValue: r => r.total, render: r => `<b class="${r.deficit ? 'qty-low' : ''}">${UI.fmtQty(r.total)}</b>` },
          { key: 'min', title: 'Мин.', num: true, sortValue: r => r.component.min_stock, render: r => UI.fmtQty(r.component.min_stock) }
        ]
      });
      UI.destroyCharts();
      const top = rows.slice().sort((a, b) => a.component.sku.localeCompare(b.component.sku)).slice(0, 25);
      UI.chart(el.querySelector('#chart'), {
        type: 'bar',
        data: { labels: top.map(r => r.component.sku), datasets: [
          { label: 'Остаток', data: top.map(r => r.total), backgroundColor: top.map(r => r.deficit ? '#dc2626' : '#2a5a8f') },
          { label: 'Минимальный остаток', data: top.map(r => r.component.min_stock), backgroundColor: '#cbd5e1' }
        ] },
        options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
      });
    }
    ['#f-cat', '#f-loc', '#f-def'].forEach(id => el.querySelector(id).addEventListener('change', build));
    el.querySelector('#exp').onclick = () => Pages.reports.exportStock(filter());
    build();
  }

  // ---------------- Движение комплектующего ----------------
  function movementData(f) {
    const mv = Api.movements(f);
    const sum = new Map();
    const blank = () => ({ receipt: 0, issue: 0, return: 0, writeoff: 0, transfer: 0, inventory: 0, net: 0 });
    mv.forEach(({ op, d, moves }) => {
      const r = sum.get(d.component_id) || blank();
      const sign = op.reversal_of_id ? -1 : 1;
      if (op.type === 'inventory') r.inventory = Api.r3(r.inventory + sign * (d.actual_quantity - d.book_quantity));
      else r[op.type] = Api.r3(r[op.type] + sign * d.quantity);
      r.net = Api.r3(r.net + moves.reduce((a, m) => a + m.delta, 0));
      sum.set(d.component_id, r);
    });
    return { mv, summary: Array.from(sum.entries()).map(([cid, r]) => Object.assign({ cid, label: Api.componentLabel(cid), unit: (Api.unitOf(cid) || {}).name }, r)) };
  }

  function renderMovement(el, params) {
    const s = Api.state();
    el.innerHTML = `<div class="card-box">
      <div class="card-head"><h3>Движение комплектующего за период</h3><div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
      <div class="filters">
        <div class="f grow"><label class="form-label">Комплектующее</label><select class="form-select" id="f-c">${UI.options(s.components, params.component || '', 'Все позиции', c => c.sku + ' — ' + c.name)}</select></div>
        <div class="f"><label class="form-label">С даты</label><input type="date" class="form-control" id="f-from" value="${monthAgo()}"></div>
        <div class="f"><label class="form-label">По дату</label><input type="date" class="form-control" id="f-to" value="${stamp()}"></div>
      </div>
      <div class="chart-box row-gap" id="chart"></div>
      <h4 style="margin-bottom:8px">Сводка по позициям</h4><div id="tbl" class="row-gap"></div>
      <h4 style="margin-bottom:8px">Документы</h4><div id="tbl2"></div></div>`;
    const f = () => ({ component_id: el.querySelector('#f-c').value, from: el.querySelector('#f-from').value, to: el.querySelector('#f-to').value });
    const num = (k, t) => ({ key: k, title: t, num: true, render: r => r[k] ? UI.fmtQty(r[k]) : '<span class="muted">0</span>' });
    function build() {
      const { mv, summary } = movementData(f());
      new UI.DataTable(el.querySelector('#tbl'), {
        rows: summary, defaultSort: { key: 'label', dir: 'asc' }, emptyText: 'Движений за период нет',
        columns: [
          { key: 'label', title: 'Комплектующее' }, { key: 'unit', title: 'Ед.' },
          num('receipt', 'Поступило'), num('issue', 'Выдано'), num('return', 'Возвращено'), num('writeoff', 'Списано'),
          num('transfer', 'Перемещено'), { key: 'inventory', title: 'Инвентар.', num: true, render: r => r.inventory ? (r.inventory > 0 ? '+' : '') + UI.fmtQty(r.inventory) : '<span class="muted">0</span>' },
          { key: 'net', title: 'Изменение', num: true, render: r => `<b class="${r.net > 0 ? 'delta-plus' : r.net < 0 ? 'delta-minus' : ''}">${r.net > 0 ? '+' : ''}${UI.fmtQty(r.net)}</b>` }
        ]
      });
      new UI.DataTable(el.querySelector('#tbl2'), {
        rows: mv, defaultSort: { key: 'date', dir: 'desc' }, emptyText: 'Документов нет',
        columns: [
          { key: 'date', title: 'Дата', sortValue: r => new Date(r.op.operation_date).getTime(), render: r => UI.fmtDateTime(r.op.operation_date) },
          { key: 'num', title: 'Документ', sortValue: r => r.op.number, render: r => `<a href="#/operations/${r.op.id}">${esc(r.op.number)}</a>` },
          { key: 'type', title: 'Операция', sortValue: r => r.op.type, render: r => UI.opBadge(r.op) },
          { key: 'c', title: 'Комплектующее', sortValue: r => Api.componentLabel(r.d.component_id), render: r => esc(Api.componentLabel(r.d.component_id)) },
          { key: 'm', title: 'Движение', sortable: false, render: r => r.moves.filter(m => m.delta).map(m => `${esc(Api.locationLabel(m.location_id))}: <span class="${m.delta > 0 ? 'delta-plus' : 'delta-minus'}">${m.delta > 0 ? '+' : ''}${UI.fmtQty(m.delta)}</span>`).join('<br>') || '<span class="muted">без изменений</span>' },
          { key: 'u', title: 'Пользователь', sortValue: r => Api.userName(r.op.created_by), render: r => esc(UI.shortName(Api.userName(r.op.created_by))) }
        ]
      });
      UI.destroyCharts();
      const keys = ['receipt', 'issue', 'return', 'writeoff', 'transfer'];
      const totals = keys.map(k => summary.reduce((a, r) => a + r[k], 0));
      UI.chart(el.querySelector('#chart'), {
        type: 'bar',
        data: { labels: keys.map(k => Api.OP_TYPES[k].name), datasets: [{ label: 'Количество единиц', data: totals, backgroundColor: ['#16a34a', '#3b82f6', '#64748b', '#dc2626', '#f59e0b'] }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }
    ['#f-c', '#f-from', '#f-to'].forEach(id => el.querySelector(id).addEventListener('change', build));
    el.querySelector('#exp').onclick = () => {
      const fl = f();
      const { mv, summary } = movementData(fl);
      const period = `${fl.from ? UI.fmtDate(fl.from) : 'начала'} — ${fl.to ? UI.fmtDate(fl.to) : 'сегодня'}`;
      UI.exportXlsx('Движение_комплектующих_' + stamp() + '.xlsx', [
        { name: 'Сводка', title: 'Движение комплектующих за период ' + period,
          headers: ['Комплектующее', 'Ед. изм.', 'Поступило', 'Выдано', 'Возвращено', 'Списано', 'Перемещено', 'Инвентаризация (±)', 'Изменение остатка'],
          rows: summary.map(r => [r.label, r.unit, r.receipt, r.issue, r.return, r.writeoff, r.transfer, r.inventory, r.net]) },
        { name: 'Документы', title: 'Документы за период ' + period,
          headers: ['Дата', 'Документ', 'Операция', 'Комплектующее', 'Количество', 'Откуда', 'Куда', 'Получатель / причина', 'Пользователь'],
          rows: mv.map(({ op, d }) => [UI.fmtDateTime(op.operation_date), op.number, Api.OP_TYPES[op.type].name + (op.reversal_of_id ? ' (сторно)' : ''),
            Api.componentLabel(d.component_id), op.type === 'inventory' ? Api.r3(d.actual_quantity - d.book_quantity) : d.quantity,
            d.source_location_id ? Api.locationLabel(d.source_location_id) : '', d.destination_location_id ? Api.locationLabel(d.destination_location_id) : '',
            op.receiver || op.reason || '', Api.userName(op.created_by)]) }
      ]);
    };
    build();
  }

  // ---------------- Выдача по получателям ----------------
  function renderReceivers(el) {
    el.innerHTML = `<div class="card-box">
      <div class="card-head"><h3>Выдача по получателям / подразделениям</h3><div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
      <div class="filters">
        <div class="f"><label class="form-label">С даты</label><input type="date" class="form-control" id="f-from" value="${monthAgo()}"></div>
        <div class="f"><label class="form-label">По дату</label><input type="date" class="form-control" id="f-to" value="${stamp()}"></div>
      </div>
      <div class="chart-box row-gap" id="chart"></div>
      <div id="tbl"></div></div>`;
    const f = () => ({ from: el.querySelector('#f-from').value, to: el.querySelector('#f-to').value });
    function build() {
      const rows = Api.issuesByReceiver(f());
      new UI.DataTable(el.querySelector('#tbl'), {
        rows, defaultSort: { key: 'receiver', dir: 'asc' }, emptyText: 'Выдач за период нет',
        search: { placeholder: 'Поиск по получателю или позиции…', text: r => r.receiver + ' ' + Api.componentLabel(r.component_id) },
        columns: [
          { key: 'receiver', title: 'Получатель / подразделение', render: r => `<b>${esc(r.receiver)}</b>` },
          { key: 'comp', title: 'Комплектующее', sortValue: r => Api.componentLabel(r.component_id), render: r => esc(Api.componentLabel(r.component_id)) },
          { key: 'issued', title: 'Выдано', num: true, render: r => UI.fmtQty(r.issued, (Api.unitOf(r.component_id) || {}).name) },
          { key: 'returned', title: 'Возвращено', num: true, render: r => UI.fmtQty(r.returned) },
          { key: 'net', title: 'Итого израсходовано', num: true, render: r => `<b>${UI.fmtQty(r.net)}</b>` },
          { key: 'docs', title: 'Документов', num: true }
        ]
      });
      UI.destroyCharts();
      const byRec = new Map();
      rows.forEach(r => byRec.set(r.receiver, (byRec.get(r.receiver) || 0) + r.docs));
      UI.chart(el.querySelector('#chart'), {
        type: 'bar',
        data: { labels: Array.from(byRec.keys()), datasets: [{ label: 'Строк выдачи (документ × позиция)', data: Array.from(byRec.values()), backgroundColor: '#3b82f6' }] },
        options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } }
      });
    }
    ['#f-from', '#f-to'].forEach(id => el.querySelector(id).addEventListener('change', build));
    el.querySelector('#exp').onclick = () => {
      const fl = f();
      UI.exportXlsx('Выдача_по_получателям_' + stamp() + '.xlsx', [{
        name: 'Выдача по получателям', title: `Выдача по получателям за период ${UI.fmtDate(fl.from)} — ${UI.fmtDate(fl.to)}`,
        headers: ['Получатель / подразделение', 'Артикул', 'Наименование', 'Ед. изм.', 'Выдано', 'Возвращено', 'Итого израсходовано', 'Документов'],
        rows: Api.issuesByReceiver(fl).map(r => { const c = Api.byId(Api.state().components, r.component_id); return [r.receiver, c.sku, c.name, (Api.unitOf(c.id) || {}).name, r.issued, r.returned, r.net, r.docs]; })
      }]);
    };
    build();
  }

  // ---------------- Ниже минимального остатка ----------------
  function renderBelowMin(el) {
    const rows = Api.belowMin().map(r => Object.assign(r, { need: Api.r3(r.component.min_stock - r.total) }));
    el.innerHTML = `<div class="card-box">
      <div class="card-head"><h3>Позиции ниже минимального остатка</h3><div class="actions"><button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button></div></div>
      ${rows.length ? '' : '<div class="alert-box success">Все позиции выше минимального остатка.</div>'}
      <div class="chart-box row-gap" id="chart"></div>
      <div id="tbl"></div></div>`;
    new UI.DataTable(el.querySelector('#tbl'), {
      rows, defaultSort: { key: 'need', dir: 'desc' }, emptyText: 'Дефицитных позиций нет', rowClass: () => 'row-danger',
      columns: [
        { key: 'sku', title: 'Артикул', sortValue: r => r.component.sku, render: r => `<span class="mono">${esc(r.component.sku)}</span>` },
        { key: 'name', title: 'Наименование', sortValue: r => r.component.name, render: r => esc(r.component.name) },
        { key: 'cat', title: 'Категория', sortValue: r => r.category ? r.category.name : '', render: r => esc(r.category ? r.category.name : '') },
        { key: 'total', title: 'Остаток', num: true, render: r => `<span class="qty-low">${UI.fmtQty(r.total, r.unit.name)}</span>` },
        { key: 'min', title: 'Мин. остаток', num: true, sortValue: r => r.component.min_stock, render: r => UI.fmtQty(r.component.min_stock) },
        { key: 'need', title: 'Не хватает', num: true, render: r => `<b>${UI.fmtQty(r.need, r.unit.name)}</b>` }
      ]
    });
    UI.chart(el.querySelector('#chart'), {
      type: 'bar',
      data: { labels: rows.map(r => r.component.name), datasets: [
        { label: 'Остаток', data: rows.map(r => r.total), backgroundColor: '#dc2626' },
        { label: 'Минимальный остаток', data: rows.map(r => r.component.min_stock), backgroundColor: '#cbd5e1' }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });
    el.querySelector('#exp').onclick = () => UI.exportXlsx('Ниже_минимального_остатка_' + stamp() + '.xlsx', [{
      name: 'Ниже минимума', title: 'Позиции ниже минимального остатка на ' + UI.fmtDateTime(new Date()),
      headers: ['Артикул', 'Наименование', 'Категория', 'Ед. изм.', 'Остаток', 'Минимальный остаток', 'Не хватает'],
      rows: rows.map(r => [r.component.sku, r.component.name, r.category ? r.category.name : '', r.unit.name, r.total, r.component.min_stock, r.need])
    }]);
  }
})(window);
