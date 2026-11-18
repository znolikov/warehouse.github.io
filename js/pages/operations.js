/* Складские документы: список, просмотр, проведение черновика, сторно. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  /** Где проходит движение — краткое описание для списка. */
  function placeOf(op, details) {
    const d = details[0];
    if (!d) return '—';
    if (op.type === 'transfer') return `${esc(Api.locationLabel(d.source_location_id))} → ${esc(Api.locationLabel(d.destination_location_id))}`;
    return esc(Api.locationLabel(d.destination_location_id || d.source_location_id));
  }

  /** Сводка документа (используется и в окне подтверждения проведения). */
  Pages.opSummaryHtml = function (header, details, opts) {
    opts = opts || {};
    const s = Api.state();
    const t = Api.OP_TYPES[header.type];
    const d0 = details[0] || {};
    const unitName = cid => { const u = Api.unitOf(cid); return u ? u.name : ''; };
    let place = '';
    if (header.type === 'transfer') place = `<dt>Откуда</dt><dd>${esc(Api.locationLabel(d0.source_location_id))}</dd><dt>Куда</dt><dd>${esc(Api.locationLabel(d0.destination_location_id))}</dd>`;
    else place = `<dt>Место хранения</dt><dd>${esc(Api.locationLabel(d0.destination_location_id || d0.source_location_id))}</dd>`;
    const isInv = header.type === 'inventory';
    const sign = header.reversal_of_id ? -1 : 1;
    const cols = isInv
      ? '<th>Комплектующее</th><th class="num">Учётное</th><th class="num">Фактическое</th><th class="num">Разница</th>'
      : `<th>Комплектующее</th><th class="num">Количество</th>${header.type === 'receipt' ? '<th class="num">Цена</th><th class="num">Сумма</th>' : ''}${opts.showStock ? '<th class="num">Остаток после</th>' : ''}`;
    let total = 0;
    const rows = details.map(d => {
      const u = unitName(d.component_id);
      if (isInv) {
        const diff = Api.r3((d.actual_quantity - d.book_quantity) * sign);
        return `<tr><td>${esc(Api.componentLabel(d.component_id))}</td><td class="num">${UI.fmtQty(d.book_quantity, u)}</td>
          <td class="num">${UI.fmtQty(d.actual_quantity, u)}</td>
          <td class="num ${diff > 0 ? 'delta-plus' : diff < 0 ? 'delta-minus' : ''}">${diff > 0 ? '+' : ''}${UI.fmtQty(diff, u)}</td></tr>`;
      }
      const sum = d.unit_price != null ? d.unit_price * d.quantity : null;
      if (sum) total += sum;
      let after = '';
      if (opts.showStock) {
        const moves = Api.lineMoves(header, d);
        after = '<td class="num">' + moves.map(m => {
          const cur = Api.stockQty(m.component_id, m.location_id);
          const nv = Api.r3(cur + m.delta);
          return `<span class="${nv < 0 ? 'qty-low' : ''}">${UI.fmtQty(cur)} → <b>${UI.fmtQty(nv)}</b></span>`;
        }).join('<br>') + '</td>';
      }
      return `<tr><td>${esc(Api.componentLabel(d.component_id))}</td><td class="num">${UI.fmtQty(d.quantity, u)}</td>
        ${header.type === 'receipt' ? `<td class="num">${d.unit_price != null ? UI.fmtMoney(d.unit_price) : '—'}</td><td class="num">${sum != null ? UI.fmtMoney(sum) : '—'}</td>` : ''}${after}</tr>`;
    }).join('');
    const issue = header.issue_id ? Api.byId(s.operations, header.issue_id) : null;
    return `<div class="doc-summary"><dl>
        <dt>Тип операции</dt><dd><b>${esc(t.name)}</b>${header.reversal_of_id ? ' (сторно)' : ''}</dd>
        ${header.number ? `<dt>Номер</dt><dd>${esc(header.number)}</dd>` : ''}
        <dt>Дата</dt><dd>${UI.fmtDateTime(header.operation_date)}</dd>
        ${place}
        ${header.receiver ? `<dt>Получатель</dt><dd>${esc(header.receiver)}</dd>` : ''}
        ${header.reason ? `<dt>Причина</dt><dd>${esc(header.reason)}</dd>` : ''}
        ${issue ? `<dt>Исходная выдача</dt><dd><a href="#/operations/${issue.id}">${esc(issue.number)}</a> (${esc(issue.receiver)})</dd>` : ''}
        ${header.comment ? `<dt>Комментарий</dt><dd>${esc(header.comment)}</dd>` : ''}
        <dt>Позиций</dt><dd>${details.length}</dd>
      </dl>
      <div class="table-wrap"><table class="data"><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody>
      ${header.type === 'receipt' && total ? `<tfoot><tr><td colspan="3">Итого</td><td class="num">${UI.fmtMoney(total)}</td>${opts.showStock ? '<td></td>' : ''}</tr></tfoot>` : ''}
      </table></div></div>`;
  };

  /** Подтверждение проведения со сводкой. Возвращает true/false. */
  Pages.confirmPost = function (input) {
    let pv;
    try { pv = Api.preview(input); } catch (e) { return Promise.reject(e); }
    const header = Object.assign({}, pv.header, { number: input.number || pv.header.number || '(будет присвоен)' });
    return UI.modal({
      title: 'Подтверждение проведения',
      size: 'lg',
      body: `<div class="alert-box info">Проверьте сводку. После проведения документ станет неизменяемым — исправление возможно только сторнированием.</div>` +
        Pages.opSummaryHtml(header, pv.details, { showStock: header.type !== 'inventory' }),
      buttons: [
        { text: 'Вернуться к редактированию', value: false },
        { text: 'Провести документ', cls: 'btn-success', value: true }
      ]
    }).then(v => v === true);
  };

  // ------------------------------------------------------------------
  Pages.operations = {
    title: 'Складские документы',
    perm: 'ops.view',
    render(view, params) {
      const canCreate = Api.can('ops.create');
      const typeOpts = Object.entries(Api.OP_TYPES).map(([k, t]) => ({ id: k, name: t.name }));
      view.innerHTML = `
        ${canCreate ? `<div class="card-box"><div class="card-head" style="margin:0"><h3>Новый документ</h3>
          <div class="doc-types">${Object.entries(Api.OP_TYPES).map(([k, t]) => `<a class="btn btn-outline-primary" href="#/operations/new/${k}">${Icons.icon(t.icon, 16)} ${esc(t.name)}</a>`).join('')}</div></div></div>` : ''}
        <div class="card-box">
          <div class="card-head"><h3>Журнал документов</h3></div>
          <div class="filters">
            <div class="f"><label class="form-label">Тип</label><select class="form-select" id="f-type">${UI.options(typeOpts, params.type || '', 'Все типы')}</select></div>
            <div class="f"><label class="form-label">Статус</label><select class="form-select" id="f-st">
              <option value="">Все</option><option value="posted">Проведён</option><option value="draft">Черновик</option><option value="reversed">Сторнирован / сторно</option></select></div>
            <div class="f"><label class="form-label">С даты</label><input type="date" class="form-control" id="f-from"></div>
            <div class="f"><label class="form-label">По дату</label><input type="date" class="form-control" id="f-to"></div>
          </div>
          <div id="tbl"></div>
        </div>`;

      const table = new UI.DataTable(view.querySelector('#tbl'), {
        search: { placeholder: 'Поиск по номеру, получателю, комментарию…', text: r => [r.number, r.receiver, r.comment, r.reason, r.author].join(' ') },
        defaultSort: { key: 'date', dir: 'desc' },
        emptyText: 'Документов нет',
        columns: [
          { key: 'date', title: 'Дата', sortValue: r => new Date(r.operation_date).getTime() * 1000 + r.id, render: r => `<span class="nowrap">${UI.fmtDateTime(r.operation_date)}</span>` },
          { key: 'number', title: 'Номер', render: r => `<a href="#/operations/${r.id}"><b>${esc(r.number)}</b></a>` },
          { key: 'type', title: 'Тип', render: r => UI.opBadge(r) },
          { key: 'status', title: 'Статус', sortValue: r => r.status, render: r => UI.statusBadge(r) },
          { key: 'place', title: 'Место / получатель', sortable: false, render: r => r.place + (r.receiver ? `<br><span class="muted">${esc(r.receiver)}</span>` : '') + (r.reason ? `<br><span class="muted">${esc(r.reason)}</span>` : '') },
          { key: 'lines', title: 'Поз.', num: true },
          { key: 'author', title: 'Автор', render: r => esc(UI.shortName(r.author)) },
          { key: 'act', title: '', sortable: false, render: r => `<div class="cell-actions">
              <a class="btn btn-sm btn-outline-secondary" href="#/operations/${r.id}">Открыть</a>
              ${canCreate && r.status === 'draft' ? `<a class="btn btn-sm btn-outline-primary" href="#/operations/edit/${r.id}">Изменить</a>` : ''}</div>` }
        ]
      });

      function refresh() {
        const s = Api.state();
        const type = view.querySelector('#f-type').value;
        const st = view.querySelector('#f-st').value;
        const from = view.querySelector('#f-from').value;
        const to = view.querySelector('#f-to').value;
        const rows = s.operations.filter(o => {
          if (type && o.type !== type) return false;
          if (st === 'posted' && (o.status !== 'posted' || o.reversal_of_id || Api.isReversed(o.id))) return false;
          if (st === 'draft' && o.status !== 'draft') return false;
          if (st === 'reversed' && !(o.reversal_of_id || Api.isReversed(o.id))) return false;
          const d = new Date(o.operation_date);
          if (from && d < new Date(from + 'T00:00:00')) return false;
          if (to && d > new Date(to + 'T23:59:59')) return false;
          return true;
        }).map(o => {
          const det = Api.detailsOf(o.id);
          return Object.assign({}, o, { lines: det.length, place: placeOf(o, det), author: Api.userName(o.created_by) });
        });
        table.setRows(rows);
      }
      ['#f-type', '#f-st', '#f-from', '#f-to'].forEach(id => view.querySelector(id).addEventListener('change', refresh));
      refresh();
    }
  };

  // ------------------------------------------------------------------
  Pages.operationView = {
    title: 'Документ',
    perm: 'ops.view',
    render(view, params) {
      const s = Api.state();
      const op = Api.byId(s.operations, params.id);
      if (!op) { view.innerHTML = '<div class="card-box empty-state">Документ не найден. <a href="#/operations">К списку</a></div>'; return; }
      UI.setTitle(Api.OP_TYPES[op.type].name + ' № ' + op.number);
      const det = Api.detailsOf(op.id);
      const canCreate = Api.can('ops.create');
      const reversal = s.operations.find(o => o.reversal_of_id === op.id);
      const original = op.reversal_of_id ? Api.byId(s.operations, op.reversal_of_id) : null;
      const returns = op.type === 'issue' ? s.operations.filter(o => o.type === 'return' && o.issue_id === op.id && o.status === 'posted' && !o.reversal_of_id) : [];
      const canReverse = canCreate && op.status === 'posted' && !op.reversal_of_id && !reversal;

      view.innerHTML = `
        <div class="card-box">
          <div class="card-head"><h3>${UI.opBadge(op)} № ${esc(op.number)} ${UI.statusBadge(op)}</h3>
            <div class="actions">
              <a class="btn btn-outline-secondary" href="#/operations">${Icons.icon('back', 16)} К списку</a>
              ${canCreate && op.status === 'draft' ? `
                <a class="btn btn-outline-primary" href="#/operations/edit/${op.id}">Изменить</a>
                <button class="btn btn-outline-danger" id="del">Удалить черновик</button>
                <button class="btn btn-success" id="post">Провести</button>` : ''}
              ${canCreate && op.type === 'issue' && op.status === 'posted' && !op.reversal_of_id && !reversal ? `<a class="btn btn-outline-primary" href="#/operations/new/return?issue=${op.id}">${Icons.icon('return', 16)} Оформить возврат</a>` : ''}
              ${canReverse ? '<button class="btn btn-outline-danger" id="rev">Сторнировать</button>' : ''}
            </div></div>
          <div id="op-err" hidden></div>
          ${op.status === 'posted' ? '<div class="alert-box info">Проведённый документ нельзя редактировать или удалить. Исправление выполняется отдельной сторнирующей или корректирующей операцией.</div>' : '<div class="alert-box warn">Черновик не влияет на остатки до проведения.</div>'}
          ${Pages.opSummaryHtml(op, det)}
          <div class="doc-summary" style="margin-top:16px"><dl>
            <dt>Автор</dt><dd>${esc(Api.userName(op.created_by))}</dd>
            <dt>Создан</dt><dd>${UI.fmtDateTime(op.created_at)}</dd>
            <dt>Проведён</dt><dd>${op.posted_at ? UI.fmtDateTime(op.posted_at) : '—'}</dd>
            ${original ? `<dt>Сторно документа</dt><dd><a href="#/operations/${original.id}">${esc(original.number)}</a></dd>` : ''}
            ${reversal ? `<dt>Сторнирован</dt><dd>документом <a href="#/operations/${reversal.id}">${esc(reversal.number)}</a> от ${UI.fmtDateTime(reversal.operation_date)}</dd>` : ''}
            ${returns.length ? `<dt>Возвраты</dt><dd>${returns.map(r => `<a href="#/operations/${r.id}">${esc(r.number)}</a>${Api.isReversed(r.id) ? ' (сторнирован)' : ''}`).join(', ')}</dd>` : ''}
          </dl></div>
        </div>`;

      const errBox = view.querySelector('#op-err');
      const post = view.querySelector('#post');
      if (post) post.onclick = async () => {
        try {
          const first = det[0] || {};
          const input = Object.assign({}, op, {
            location_id: first.destination_location_id || first.source_location_id,
            source_location_id: first.source_location_id,
            destination_location_id: first.destination_location_id,
            lines: det.map(d => ({ component_id: d.component_id, quantity: d.quantity, unit_price: d.unit_price, actual_quantity: d.actual_quantity }))
          });
          if (!await Pages.confirmPost(input)) return;
          await Api.postExisting(op.id);
          UI.toast('Документ ' + op.number + ' проведён');
          global.App.route();
        } catch (e) { UI.showError(errBox, e); }
      };
      const del = view.querySelector('#del');
      if (del) del.onclick = async () => {
        if (!await UI.confirm('Удаление черновика', `Удалить черновик № ${esc(op.number)}?`, 'Удалить', 'btn-danger')) return;
        try { await Api.deleteDraft(op.id); UI.toast('Черновик удалён'); location.hash = '#/operations'; } catch (e) { UI.showError(errBox, e); }
      };
      const rev = view.querySelector('#rev');
      if (rev) rev.onclick = async () => {
        const res = await UI.modal({
          title: 'Сторнирование документа ' + op.number,
          body: `<p>Будет создан новый документ «СТ-${esc(op.number)}» с обратными движениями. Исходный документ не изменяется. Повторное сторнирование будет невозможно.</p>
            <label class="form-label">Комментарий / основание</label><textarea class="form-control" name="comment" placeholder="Например: ошибка в количестве"></textarea>`,
          buttons: [
            { text: 'Отмена', value: null },
            { text: 'Сторнировать', cls: 'btn-danger', action: async m => { const r = await Api.reverse(op.id, m.querySelector('[name=comment]').value); return r; } }
          ]
        });
        if (res) { UI.toast('Создан сторнирующий документ ' + res.number); location.hash = '#/operations/' + res.id; }
      };
    }
  };
})(window);
