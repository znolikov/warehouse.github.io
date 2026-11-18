/* Справочники: категории, единицы измерения, места хранения + обслуживание БД. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI, DB } = global;
  const esc = UI.esc;

  const TABS = [
    { id: 'categories', title: 'Категории' },
    { id: 'units', title: 'Единицы измерения' },
    { id: 'locations', title: 'Места хранения' },
    { id: 'service', title: 'Обслуживание' }
  ];

  function usage(table, id) {
    const s = Api.state();
    if (table === 'categories') return s.components.filter(c => c.category_id === id).length;
    if (table === 'units') return s.components.filter(c => c.unit_id === id).length;
    return s.stock.filter(x => x.location_id === id && x.quantity > 0).length;
  }

  async function edit(table, rec, refresh) {
    let body = `<div class="mb-3"><label class="form-label">Наименование <span class="req">*</span></label>
      <input class="form-control" name="name" maxlength="${table === 'units' ? 20 : 100}" value="${esc(rec ? rec.name : '')}"></div>`;
    if (table === 'units') body += `<label class="form-check"><input type="checkbox" name="allows_fraction" ${rec && rec.allows_fraction ? 'checked' : ''}> Допускается дробное количество (например, м, кг)</label>`;
    if (table === 'locations') body += `<div class="mb-3"><label class="form-label">Описание</label><textarea class="form-control" name="description">${esc(rec ? rec.description : '')}</textarea></div>`;
    const ok = await UI.modal({
      title: (rec ? 'Изменение: ' : 'Добавление: ') + TABS.find(t => t.id === table).title.toLowerCase(),
      body,
      buttons: [{ text: 'Отмена', value: null }, { text: 'Сохранить', cls: 'btn-primary', action: async m => {
        const data = UI.formData(m);
        if (rec) data.id = rec.id;
        await Api.saveDict(table, data);
        return true;
      } }]
    });
    if (ok) { UI.toast('Справочник сохранён'); refresh(); }
  }

  function renderDict(el, table) {
    const hasActive = table !== 'units';
    el.innerHTML = `<div class="card-box"><div class="card-head"><h3>${esc(TABS.find(t => t.id === table).title)}</h3>
      <div class="actions"><button class="btn btn-primary" id="add">+ Добавить</button></div></div>
      <div class="alert-box info">Записи, на которые ссылаются документы или карточки, физически не удаляются — для них применяется архивирование.</div>
      <div id="tbl"></div></div>`;
    const cols = [
      { key: 'name', title: 'Наименование', render: r => `<b>${esc(r.name)}</b>` }
    ];
    if (table === 'units') cols.push({ key: 'allows_fraction', title: 'Дробные значения', render: r => r.allows_fraction ? 'Да' : 'Нет (только целые)' });
    if (table === 'locations') cols.push({ key: 'description', title: 'Описание' });
    cols.push({ key: 'used', title: table === 'locations' ? 'Позиций с остатком' : 'Используется в карточках', num: true });
    if (hasActive) cols.push({ key: 'is_active', title: 'Статус', render: r => r.is_active ? '<span class="badge-s green">Активна</span>' : '<span class="badge-s gray">Архив</span>' });
    cols.push({ key: 'act', title: '', sortable: false, render: r => `<div class="cell-actions">
      <button class="btn btn-sm btn-outline-primary" data-edit="${r.id}">Изменить</button>
      ${hasActive ? (r.is_active ? `<button class="btn btn-sm btn-outline-secondary" data-arch="${r.id}">В архив</button>` : `<button class="btn btn-sm btn-outline-secondary" data-unarch="${r.id}">Восстановить</button>`) : ''}
      ${!r.refd ? `<button class="btn btn-sm btn-outline-danger" data-del="${r.id}">Удалить</button>` : ''}</div>` });

    const t = new UI.DataTable(el.querySelector('#tbl'), {
      columns: cols, defaultSort: { key: 'name', dir: 'asc' },
      search: { placeholder: 'Поиск…', text: r => r.name + ' ' + (r.description || '') },
      rowClass: r => hasActive && !r.is_active ? 'row-muted' : '',
      afterRender(box) {
        const get = id => Api.byId(Api.state()[table], id);
        box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(table, get(b.dataset.edit), refresh));
        const act = (sel, fn, msg) => box.querySelectorAll(sel).forEach(b => b.onclick = async () => {
          try { await fn(Number(b.dataset[Object.keys(b.dataset)[0]])); UI.toast(msg); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
        });
        act('[data-arch]', id => Api.setDictActive(table, id, false), 'Запись перенесена в архив');
        act('[data-unarch]', id => Api.setDictActive(table, id, true), 'Запись восстановлена');
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
          const r = get(b.dataset.del);
          if (!await UI.confirm('Удаление', `Удалить «${esc(r.name)}»? Запись не используется и будет удалена безвозвратно.`, 'Удалить', 'btn-danger')) return;
          try { await Api.deleteDict(table, r.id); UI.toast('Запись удалена'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
        });
      }
    });
    function refresh() {
      t.setRows(Api.state()[table].map(r => Object.assign({}, r, { used: usage(table, r.id), refd: Api.isDictUsed(table, r.id) })));
    }
    el.querySelector('#add').onclick = () => edit(table, null, refresh);
    refresh();
  }

  function renderService(el) {
    const s = Api.state();
    el.innerHTML = `<div class="grid-2">
      <div class="card-box"><div class="card-head"><h3>Согласованность остатков</h3></div>
        <p>Проверка, что регистр остатков <span class="mono">stock</span> совпадает с журналом проведённых движений.</p>
        <button class="btn btn-primary" id="chk">Проверить</button><div id="chk-res"></div></div>
      <div class="card-box"><div class="card-head"><h3>Резервное копирование</h3></div>
        <p>Выгрузка всей базы в файл JSON и восстановление из него. Данные хранятся в браузере (localStorage), поэтому регулярно сохраняйте копию.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline-primary" id="bk">${Icons.icon('download', 16)} Скачать резервную копию</button>
          <label class="btn btn-outline-secondary">${Icons.icon('upload', 16)} Восстановить из файла<input type="file" id="rs" accept="application/json,.json" hidden></label>
        </div></div>
      <div class="card-box"><div class="card-head"><h3>Демонстрационные данные</h3></div>
        <p>Сброс базы к исходному состоянию: тестовые пользователи, справочники, номенклатура и демонстрационные документы. Все внесённые изменения будут потеряны.</p>
        <button class="btn btn-danger" id="reset">Сбросить данные</button></div>
      <div class="card-box"><div class="card-head"><h3>Сведения о БД</h3></div>
        <table class="data"><tbody>
        ${DB.TABLES.map(t => `<tr><td class="mono">${t}</td><td class="num">${s[t].length} записей</td></tr>`).join('')}
        <tr><td>Версия данных</td><td class="num">${s.meta.version}</td></tr>
        </tbody></table></div>
    </div>`;
    el.querySelector('#chk').onclick = () => {
      const p = Api.checkConsistency();
      el.querySelector('#chk-res').innerHTML = p.length
        ? `<div class="alert-box error">Найдены расхождения:<ul>${p.map(x => `<li>${esc(x.component)} / ${esc(x.location)}: stock=${x.stock}, журнал=${x.journal}</li>`).join('')}</ul></div>`
        : '<div class="alert-box success">Расхождений нет: остатки согласованы с журналом движений.</div>';
    };
    el.querySelector('#bk').onclick = () => {
      const blob = new Blob([DB.exportJson()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'backup_' + UI.isoDate(new Date()) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    el.querySelector('#rs').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!await UI.confirm('Восстановление', 'Текущие данные будут заменены данными из файла. Продолжить?', 'Восстановить', 'btn-danger')) return;
      try {
        Api.require('dict.manage');
        await DB.importJson(await file.text());
        UI.toast('Данные восстановлены. Выполните вход повторно.');
        sessionStorage.clear();
        global.App.route();
      } catch (err) { UI.toast('Не удалось восстановить: ' + err.message, 'error'); }
    };
    el.querySelector('#reset').onclick = async () => {
      if (!await UI.confirm('Сброс данных', 'Все данные будут заменены демонстрационными. Это действие необратимо. Продолжить?', 'Сбросить', 'btn-danger')) return;
      try { await Api.resetDemo(); UI.toast('Данные сброшены. Войдите снова.'); location.hash = '#/login'; global.App.route(); } catch (err) { UI.toast(err.message, 'error'); }
    };
  }

  Pages.directories = {
    title: 'Справочники',
    perm: 'dict.manage',
    render(view, params) {
      const tab = TABS.some(t => t.id === params.tab) ? params.tab : 'categories';
      view.innerHTML = `<div class="tabs">${TABS.map(t => `<a class="tab ${t.id === tab ? 'active' : ''}" href="#/directories?tab=${t.id}">${esc(t.title)}</a>`).join('')}</div><div id="dir"></div>`;
      const el = view.querySelector('#dir');
      if (tab === 'service') renderService(el); else renderDict(el, tab);
    }
  };
})(window);
