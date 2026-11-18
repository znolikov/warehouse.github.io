/* Номенклатура: карточки комплектующих, поиск по артикулу и наименованию. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  function formHtml(s, c) {
    c = c || { min_stock: 0 };
    const cats = s.categories.filter(x => x.is_active || x.id === c.category_id);
    return `<form class="form-grid" onsubmit="return false">
      <div><label class="form-label">Артикул <span class="req">*</span></label>
        <input name="sku" class="form-control" maxlength="50" value="${esc(c.sku || '')}" required></div>
      <div><label class="form-label">Мин. остаток <span class="req">*</span></label>
        <input name="min_stock" class="form-control" inputmode="decimal" value="${esc(c.min_stock)}" required></div>
      <div class="span-all"><label class="form-label">Наименование <span class="req">*</span></label>
        <input name="name" class="form-control" maxlength="255" value="${esc(c.name || '')}" required></div>
      <div><label class="form-label">Категория <span class="req">*</span></label>
        <select name="category_id" class="form-select">${UI.options(cats, c.category_id, '— выберите —')}</select></div>
      <div><label class="form-label">Единица измерения <span class="req">*</span></label>
        <select name="unit_id" class="form-select">${UI.options(s.units, c.unit_id, '— выберите —', u => u.name + (u.allows_fraction ? ' (дробное)' : ''))}</select></div>
    </form>`;
  }

  async function edit(c, refresh) {
    const s = Api.state();
    const res = await UI.modal({
      title: c ? 'Карточка: ' + c.sku : 'Новое комплектующее',
      body: formHtml(s, c),
      buttons: [
        { text: 'Отмена', value: null },
        { text: 'Сохранить', cls: 'btn-primary', action: async m => {
          const data = UI.formData(m);
          if (c) data.id = c.id;
          await Api.saveComponent(data);
          return true;
        } }
      ]
    });
    if (res) { UI.toast(c ? 'Карточка обновлена' : 'Комплектующее добавлено'); refresh(); }
  }

  function showCard(c) {
    const s = Api.state();
    const unit = Api.byId(s.units, c.unit_id);
    const rows = s.stock.filter(x => x.component_id === c.id && x.quantity > 0);
    UI.modal({
      title: c.sku + ' — ' + c.name,
      size: 'lg',
      body: `<div class="doc-summary"><dl>
        <dt>Категория</dt><dd>${esc((Api.byId(s.categories, c.category_id) || {}).name)}</dd>
        <dt>Единица</dt><dd>${esc(unit.name)}</dd>
        <dt>Мин. остаток</dt><dd>${UI.fmtQty(c.min_stock, unit.name)}</dd>
        <dt>Общий остаток</dt><dd class="${Api.totalStock(c.id) < c.min_stock ? 'qty-low' : ''}"><b>${UI.fmtQty(Api.totalStock(c.id), unit.name)}</b></dd>
        <dt>Статус</dt><dd>${c.is_archived ? 'В архиве' : 'Активна'}</dd></dl></div>
        <h4 style="margin-bottom:8px">Остатки по местам хранения</h4>
        <table class="data"><thead><tr><th>Место хранения</th><th class="num">Количество</th></tr></thead><tbody>
        ${rows.length ? rows.map(r => `<tr><td>${esc(Api.locationLabel(r.location_id))}</td><td class="num">${UI.fmtQty(r.quantity, unit.name)}</td></tr>`).join('') : '<tr><td class="empty" colspan="2">Нет остатков</td></tr>'}
        </tbody></table>
        <p style="margin-top:14px"><a href="#/reports?tab=movement&component=${c.id}" class="js-close-go">Открыть движение по позиции →</a></p>`,
      onOpen(m) { m.querySelector('.js-close-go').addEventListener('click', () => m.closest('.modal-backdrop-x').remove()); }
    });
  }

  Pages.components = {
    title: 'Номенклатура',
    perm: 'components.view',
    render(view, params) {
      const canEdit = Api.can('components.edit');
      const s0 = Api.state();
      view.innerHTML = `<div class="card-box">
        <div class="card-head"><h3>Карточки комплектующих</h3>
          <div class="actions">${canEdit ? '<button class="btn btn-primary" id="add-c">+ Добавить комплектующее</button>' : ''}</div></div>
        <div class="filters">
          <div class="f"><label class="form-label">Категория</label><select class="form-select" id="f-cat">${UI.options(s0.categories, params.category || '', 'Все категории')}</select></div>
          <div class="f"><label class="form-check"><input type="checkbox" id="f-arch"> Показать архивные</label></div>
          <div class="f"><label class="form-check"><input type="checkbox" id="f-def"> Только дефицит</label></div>
        </div>
        <div id="tbl"></div></div>`;

      const table = new UI.DataTable(view.querySelector('#tbl'), {
        search: { placeholder: 'Поиск по артикулу или наименованию…', text: r => r.sku + ' ' + r.name },
        defaultSort: { key: 'sku', dir: 'asc' },
        emptyText: 'Комплектующие не найдены',
        rowClass: r => r.is_archived ? 'row-muted' : (r.total < r.min_stock ? 'row-danger' : ''),
        columns: [
          { key: 'sku', title: 'Артикул', render: r => `<span class="mono">${esc(r.sku)}</span>` },
          { key: 'name', title: 'Наименование', render: r => `<a href="#" data-view="${r.id}">${esc(r.name)}</a>` },
          { key: 'cat', title: 'Категория' },
          { key: 'unit', title: 'Ед.' },
          { key: 'min_stock', title: 'Мин. остаток', num: true, render: r => UI.fmtQty(r.min_stock) },
          { key: 'total', title: 'Остаток', num: true, render: r => `<span class="${r.total < r.min_stock && !r.is_archived ? 'qty-low' : ''}">${UI.fmtQty(r.total)}</span>` },
          { key: 'status', title: 'Статус', render: r => r.is_archived ? '<span class="badge-s gray">Архив</span>' : (r.total < r.min_stock ? '<span class="badge-s red">Дефицит</span>' : '<span class="badge-s green">Активна</span>') },
          ...(canEdit ? [{ key: 'act', title: '', sortable: false, render: r => `<div class="cell-actions">
            <button class="btn btn-sm btn-outline-primary" data-edit="${r.id}">Изменить</button>
            ${r.is_archived ? `<button class="btn btn-sm btn-outline-secondary" data-unarch="${r.id}">Восстановить</button>`
              : `<button class="btn btn-sm btn-outline-danger" data-arch="${r.id}">В архив</button>`}</div>` }] : [])
        ],
        afterRender(el) {
          el.querySelectorAll('[data-view]').forEach(a => a.onclick = e => { e.preventDefault(); showCard(Api.byId(Api.state().components, a.dataset.view)); });
          el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(Api.byId(Api.state().components, b.dataset.edit), refresh));
          el.querySelectorAll('[data-arch]').forEach(b => b.onclick = async () => {
            const c = Api.byId(Api.state().components, b.dataset.arch);
            if (!await UI.confirm('Архивирование', `Перенести «${esc(c.name)}» в архив? Карточка не удаляется и останется в истории документов.`, 'В архив', 'btn-danger')) return;
            try { await Api.setComponentArchived(c.id, true); UI.toast('Позиция перенесена в архив'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
          });
          el.querySelectorAll('[data-unarch]').forEach(b => b.onclick = async () => {
            try { await Api.setComponentArchived(Number(b.dataset.unarch), false); UI.toast('Позиция восстановлена'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
          });
        }
      });

      function refresh() {
        const s = Api.state();
        const cat = view.querySelector('#f-cat').value;
        const arch = view.querySelector('#f-arch').checked;
        const def = view.querySelector('#f-def').checked;
        const rows = s.components
          .filter(c => (arch || !c.is_archived) && (!cat || c.category_id === Number(cat)))
          .map(c => Object.assign({}, c, {
            cat: (Api.byId(s.categories, c.category_id) || {}).name || '—',
            unit: (Api.byId(s.units, c.unit_id) || {}).name || '',
            total: Api.totalStock(c.id)
          }))
          .filter(c => !def || (c.total < c.min_stock && !c.is_archived));
        table.setRows(rows);
      }
      ['#f-cat', '#f-arch', '#f-def'].forEach(id => view.querySelector(id).addEventListener('change', refresh));
      const addBtn = view.querySelector('#add-c');
      if (addBtn) addBtn.onclick = () => edit(null, refresh);
      refresh();
    }
  };
})(window);
