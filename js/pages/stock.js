/* Склад: текущие остатки с фильтрацией по категории, месту хранения и дефициту. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  Pages.stock = {
    title: 'Склад — текущие остатки',
    perm: 'stock.view',
    render(view, params) {
      const s = Api.state();
      view.innerHTML = `<div class="card-box">
        <div class="card-head"><h3>Остатки</h3>
          <div class="actions">
            <div class="tabs" style="margin:0;border:none">
              <button class="tab active" data-mode="sum">Суммарно</button>
              <button class="tab" data-mode="loc">По местам хранения</button>
            </div>
            <button class="btn btn-success" id="exp">${Icons.icon('download', 16)} Экспорт в Excel</button>
          </div></div>
        <div class="filters">
          <div class="f grow"><label class="form-label">Поиск</label><input class="form-control" id="f-q" type="search" placeholder="Артикул или наименование"></div>
          <div class="f"><label class="form-label">Категория</label><select class="form-select" id="f-cat">${UI.options(s.categories, '', 'Все категории')}</select></div>
          <div class="f"><label class="form-label">Место хранения</label><select class="form-select" id="f-loc">${UI.options(s.locations, '', 'Все места')}</select></div>
          <div class="f"><label class="form-check"><input type="checkbox" id="f-def" ${params.deficit ? 'checked' : ''}> Только дефицит</label></div>
        </div>
        <div id="tbl"></div></div>`;

      let mode = 'sum';
      let table = null;

      function filter() {
        return {
          query: view.querySelector('#f-q').value,
          category_id: view.querySelector('#f-cat').value,
          location_id: view.querySelector('#f-loc').value,
          deficit: view.querySelector('#f-def').checked
        };
      }

      function build() {
        const rows = Api.stockReport(filter());
        const el = view.querySelector('#tbl');
        if (mode === 'sum') {
          table = new UI.DataTable(el, {
            rows,
            defaultSort: { key: 'sku', dir: 'asc' },
            emptyText: 'Нет позиций по заданным условиям',
            rowClass: r => r.deficit ? 'row-danger' : '',
            columns: [
              { key: 'sku', title: 'Артикул', sortValue: r => r.component.sku, render: r => `<span class="mono">${esc(r.component.sku)}</span>` },
              { key: 'name', title: 'Наименование', sortValue: r => r.component.name, render: r => esc(r.component.name) },
              { key: 'cat', title: 'Категория', sortValue: r => r.category ? r.category.name : '', render: r => esc(r.category ? r.category.name : '—') },
              { key: 'locs', title: 'Места хранения', sortable: false, render: r => r.byLocation.map(x => `${esc(x.location.name)}: <b>${UI.fmtQty(x.quantity)}</b>`).join('<br>') || '<span class="muted">—</span>' },
              { key: 'min', title: 'Мин.', num: true, sortValue: r => r.component.min_stock, render: r => UI.fmtQty(r.component.min_stock) },
              { key: 'total', title: 'Итого', num: true, sortValue: r => r.total, render: r => `<b class="${r.deficit ? 'qty-low' : ''}">${UI.fmtQty(r.total, r.unit.name)}</b>` },
              { key: 'st', title: 'Статус', sortValue: r => r.deficit ? 0 : 1, render: r => r.deficit ? '<span class="badge-s red">Ниже минимума</span>' : '<span class="badge-s green">Норма</span>' }
            ]
          });
        } else {
          const flat = [];
          rows.forEach(r => r.byLocation.forEach(x => flat.push(Object.assign({}, r, { loc: x.location, qty: x.quantity }))));
          table = new UI.DataTable(el, {
            rows: flat,
            defaultSort: { key: 'loc', dir: 'asc' },
            emptyText: 'Нет остатков по заданным условиям',
            columns: [
              { key: 'loc', title: 'Место хранения', sortValue: r => r.loc.name + ' ' + r.component.sku, render: r => esc(r.loc.name) },
              { key: 'sku', title: 'Артикул', sortValue: r => r.component.sku, render: r => `<span class="mono">${esc(r.component.sku)}</span>` },
              { key: 'name', title: 'Наименование', sortValue: r => r.component.name, render: r => esc(r.component.name) },
              { key: 'cat', title: 'Категория', sortValue: r => r.category ? r.category.name : '', render: r => esc(r.category ? r.category.name : '—') },
              { key: 'qty', title: 'Количество', num: true, sortValue: r => r.qty, render: r => UI.fmtQty(r.qty, r.unit.name) }
            ]
          });
        }
      }

      view.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        view.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === b));
        mode = b.dataset.mode;
        build();
      }));
      ['#f-q', '#f-cat', '#f-loc', '#f-def'].forEach(id => view.querySelector(id).addEventListener(id === '#f-q' ? 'input' : 'change', build));
      view.querySelector('#exp').addEventListener('click', () => Pages.reports.exportStock(filter()));
      build();
    }
  };
})(window);
