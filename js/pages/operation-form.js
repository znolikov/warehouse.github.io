/* Форма складского документа: поступление, выдача, возврат, списание,
   перемещение, инвентаризация. Черновик → проверка → подтверждение → проведение. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  const HINTS = {
    receipt: 'Укажите место хранения и добавьте поступившие комплектующие. Количество должно быть больше нуля.',
    issue: 'Выберите место хранения, позиции и получателя. Доступный остаток проверяется в момент проведения.',
    return: 'Укажите позиции и место хранения. При связи с исходной выдачей нельзя вернуть больше невозвращённого количества.',
    writeoff: 'Укажите место хранения, позиции и обязательную причину списания.',
    transfer: 'Выберите исходное и целевое места хранения. Общий остаток на складе не меняется.',
    inventory: 'Выберите место хранения, затем введите фактическое количество. Система рассчитает разницу и оформит корректировку.'
  };

  Pages.operationForm = {
    title: 'Документ',
    perm: 'ops.create',
    render(view, params) {
      const s = Api.state();
      let op = null;
      let type = params.type;
      let lines = [];
      if (params.id) {
        op = Api.byId(s.operations, params.id);
        if (!op) { view.innerHTML = '<div class="card-box empty-state">Документ не найден.</div>'; return; }
        if (op.status !== 'draft') {
          view.innerHTML = `<div class="card-box"><div class="alert-box error"><b>Проведённый документ нельзя редактировать.</b> Исправление выполняется сторнированием.</div><a class="btn btn-primary" href="#/operations/${op.id}">Открыть документ</a></div>`;
          return;
        }
        type = op.type;
        lines = Api.detailsOf(op.id).map(d => ({ component_id: d.component_id, quantity: d.quantity, unit_price: d.unit_price, actual_quantity: d.actual_quantity }));
      }
      if (!Api.OP_TYPES[type]) { location.hash = '#/operations'; return; }
      const T = Api.OP_TYPES[type];
      UI.setTitle((op ? 'Черновик: ' : 'Новый документ: ') + T.name);

      const d0 = op ? (Api.detailsOf(op.id)[0] || {}) : {};
      const hdr = {
        number: op ? op.number : '',
        operation_date: op ? op.operation_date : new Date().toISOString(),
        comment: op ? op.comment : '',
        receiver: op ? op.receiver : '',
        reason: op ? op.reason : '',
        issue_id: op ? op.issue_id : (params.issue ? Number(params.issue) : null),
        location_id: d0.destination_location_id || d0.source_location_id || '',
        source_location_id: d0.source_location_id || '',
        destination_location_id: d0.destination_location_id || ''
      };
      const locs = s.locations.filter(l => l.is_active);
      const comps = s.components.filter(c => !c.is_archived).sort((a, b) => a.sku.localeCompare(b.sku, 'ru'));
      const issues = s.operations.filter(o => o.type === 'issue' && o.status === 'posted' && !o.reversal_of_id && !Api.isReversed(o.id))
        .sort((a, b) => new Date(b.operation_date) - new Date(a.operation_date));
      const receivers = Array.from(new Set(s.operations.filter(o => o.receiver).map(o => o.receiver)));

      // если возврат по выдаче — подставить место и позиции
      if (type === 'return' && hdr.issue_id && !op) {
        const iss = Api.byId(s.operations, hdr.issue_id);
        if (iss) {
          const det = Api.detailsOf(iss.id);
          hdr.location_id = (det[0] || {}).source_location_id || '';
          lines = det.map(d => ({ component_id: d.component_id, quantity: '' })).filter(l => Api.returnedLeft(iss.id, l.component_id) > 0);
        }
      }
      if (!lines.length) lines.push({ component_id: '', quantity: '', unit_price: '', actual_quantity: '' });

      const reasonIsCustom = hdr.reason && !Api.WRITEOFF_REASONS.includes(hdr.reason);

      let headerFields = `<div><label class="form-label">Дата и время <span class="req">*</span></label>
        <input type="datetime-local" class="form-control" name="operation_date" value="${UI.localDateTimeValue(hdr.operation_date)}"></div>`;
      if (type === 'receipt') {
        headerFields += `<div><label class="form-label">Номер документа</label>
          <input class="form-control" name="number" maxlength="50" value="${esc(op ? op.number : '')}" placeholder="необязательно (присвоится автоматически)"></div>`;
      }
      if (type === 'transfer') {
        headerFields += `<div><label class="form-label">Исходное место <span class="req">*</span></label>
          <select class="form-select" name="source_location_id">${UI.options(locs, hdr.source_location_id, '— выберите —')}</select></div>
          <div><label class="form-label">Целевое место <span class="req">*</span></label>
          <select class="form-select" name="destination_location_id">${UI.options(locs, hdr.destination_location_id, '— выберите —')}</select></div>`;
      } else {
        headerFields += `<div><label class="form-label">Место хранения <span class="req">*</span></label>
          <select class="form-select" name="location_id">${UI.options(locs, hdr.location_id, '— выберите —')}</select></div>`;
      }
      if (type === 'issue') {
        headerFields += `<div class="span-2"><label class="form-label">Получатель / подразделение <span class="req">*</span></label>
          <input class="form-control" name="receiver" maxlength="150" list="receivers" value="${esc(hdr.receiver)}" placeholder="Например: Цех сборки №1">
          <datalist id="receivers">${receivers.map(r => `<option value="${esc(r)}">`).join('')}</datalist></div>`;
      }
      if (type === 'return') {
        headerFields += `<div class="span-2"><label class="form-label">Исходная выдача</label>
          <select class="form-select" name="issue_id">${UI.options(issues, hdr.issue_id, '— без связи с выдачей —', o => `${o.number} · ${UI.fmtDate(o.operation_date)} · ${o.receiver}`)}</select>
          <div class="form-hint">Если указать выдачу, система не позволит вернуть больше выданного за вычетом прошлых возвратов.</div></div>`;
      }
      if (type === 'writeoff') {
        headerFields += `<div><label class="form-label">Причина <span class="req">*</span></label>
          <select class="form-select" name="reason_select">
            <option value="">— выберите —</option>
            ${Api.WRITEOFF_REASONS.map(r => `<option ${(!reasonIsCustom && hdr.reason === r) || (reasonIsCustom && r === 'Иная причина') ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select></div>
          <div id="reason-custom" ${reasonIsCustom || hdr.reason === 'Иная причина' ? '' : 'hidden'}><label class="form-label">Уточните причину <span class="req">*</span></label>
          <input class="form-control" name="reason_text" maxlength="255" value="${esc(reasonIsCustom ? hdr.reason : '')}"></div>`;
      }
      headerFields += `<div class="span-all"><label class="form-label">Комментарий</label>
        <textarea class="form-control" name="comment" maxlength="2000" rows="2">${esc(hdr.comment)}</textarea></div>`;

      view.innerHTML = `<div class="card-box">
        <div class="card-head"><h3>${esc(T.name)}${op ? ' № ' + esc(op.number) : ''}</h3>
          <div class="actions"><a class="btn btn-outline-secondary" href="${op ? '#/operations/' + op.id : '#/operations'}">Отмена</a></div></div>
        <div class="alert-box info">${esc(HINTS[type])}</div>
        <form id="doc-form" onsubmit="return false" novalidate>
          <div class="form-grid">${headerFields}</div>
          <h4 style="margin:22px 0 10px">Позиции документа</h4>
          <div class="table-wrap"><table class="data lines-table"><thead><tr id="lines-head"></tr></thead><tbody id="lines-body"></tbody></table></div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="btn btn-outline-primary btn-sm" id="add-line">+ Добавить позицию</button>
            ${type === 'inventory' ? '<button type="button" class="btn btn-outline-secondary btn-sm" id="fill-all">Заполнить всеми позициями места хранения</button>' : ''}
          </div>
          <div id="form-err" hidden></div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline-secondary" id="save-draft">Сохранить черновик</button>
            <button type="button" class="btn btn-success" id="post-doc">Провести документ</button>
          </div>
        </form></div>`;

      const form = view.querySelector('#doc-form');
      const errBox = view.querySelector('#form-err');
      const val = name => { const el = form.querySelector(`[name="${name}"]`); return el ? el.value : ''; };
      const currentLoc = () => type === 'transfer' ? Number(val('source_location_id')) : Number(val('location_id'));
      const currentIssue = () => type === 'return' ? Number(val('issue_id')) || null : null;

      function head() {
        let h = '<th>Комплектующее <span class="req">*</span></th>';
        if (type === 'inventory') h += '<th class="num">Учётное</th><th class="num">Фактическое <span class="req">*</span></th><th class="num">Разница</th>';
        else {
          h += '<th class="num">Количество <span class="req">*</span></th>';
          if (type === 'receipt') h += '<th class="num">Учётная цена, ₽</th>';
          h += `<th class="num">${type === 'return' && currentIssue() ? 'Можно вернуть' : type === 'receipt' || type === 'return' ? 'Сейчас в месте' : 'Доступно'}</th>`;
        }
        h += '<th></th>';
        view.querySelector('#lines-head').innerHTML = h;
      }

      function infoFor(l) {
        const cid = Number(l.component_id);
        const loc = currentLoc();
        if (!cid) return '<span class="muted">—</span>';
        const u = Api.unitOf(cid);
        if (type === 'return' && currentIssue()) {
          const left = Api.returnedLeft(currentIssue(), cid, op ? op.id : null);
          return `<span class="${Number(l.quantity) > left ? 'qty-low' : ''}">${UI.fmtQty(left, u && u.name)}</span>`;
        }
        if (!loc) return '<span class="muted">выберите место</span>';
        const q = Api.stockQty(cid, loc);
        const low = (type === 'issue' || type === 'writeoff' || type === 'transfer') && Number(l.quantity) > q;
        return `<span class="${low ? 'qty-low' : ''}">${UI.fmtQty(q, u && u.name)}</span>`;
      }

      function rowHtml(l, i) {
        const cid = Number(l.component_id);
        const u = cid ? Api.unitOf(cid) : null;
        const step = u && !u.allows_fraction ? '1' : '0.001';
        let h = `<td><select class="form-select" data-f="component_id" data-i="${i}">${UI.options(comps, l.component_id, '— выберите —', c => `${c.sku} — ${c.name} (${(Api.byId(s.units, c.unit_id) || {}).name})`)}</select></td>`;
        if (type === 'inventory') {
          const loc = currentLoc();
          const book = cid && loc ? Api.stockQty(cid, loc) : null;
          const act = l.actual_quantity === '' || l.actual_quantity == null ? null : Number(String(l.actual_quantity).replace(',', '.'));
          const diff = book !== null && act !== null && !isNaN(act) ? Api.r3(act - book) : null;
          h += `<td class="num">${book === null ? '—' : UI.fmtQty(book, u && u.name)}</td>
            <td class="qcol"><input class="form-control" type="number" min="0" step="${step}" data-f="actual_quantity" data-i="${i}" value="${esc(l.actual_quantity ?? '')}"></td>
            <td class="num ${diff > 0 ? 'delta-plus' : diff < 0 ? 'delta-minus' : ''}">${diff === null ? '—' : (diff > 0 ? '+' : '') + UI.fmtQty(diff)}</td>`;
        } else {
          h += `<td class="qcol"><input class="form-control" type="number" min="0" step="${step}" data-f="quantity" data-i="${i}" value="${esc(l.quantity ?? '')}"></td>`;
          if (type === 'receipt') h += `<td class="pcol"><input class="form-control" type="number" min="0" step="0.01" data-f="unit_price" data-i="${i}" value="${esc(l.unit_price ?? '')}"></td>`;
          h += `<td class="num">${infoFor(l)}</td>`;
        }
        h += `<td class="num"><button type="button" class="btn btn-sm btn-outline-danger" data-del="${i}" title="Удалить строку" ${lines.length === 1 ? 'disabled' : ''}>${Icons.icon('x', 14)}</button></td>`;
        return `<tr>${h}</tr>`;
      }

      function renderLines() {
        head();
        const body = view.querySelector('#lines-body');
        body.innerHTML = lines.map(rowHtml).join('');
        body.querySelectorAll('[data-f]').forEach(el => {
          const ev = el.tagName === 'SELECT' ? 'change' : 'input';
          el.addEventListener(ev, () => {
            lines[Number(el.dataset.i)][el.dataset.f] = el.value;
            if (el.tagName === 'SELECT') renderLines();
            else updateInfo(Number(el.dataset.i));
          });
          if (el.tagName !== 'SELECT') el.addEventListener('change', () => renderLines());
        });
        body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); renderLines(); });
      }

      function updateInfo(i) {
        // лёгкое обновление без потери фокуса: только информационная ячейка
        const tr = view.querySelectorAll('#lines-body tr')[i];
        if (!tr) return;
        if (type === 'inventory') {
          const l = lines[i];
          const cid = Number(l.component_id); const loc = currentLoc();
          const cells = tr.querySelectorAll('td');
          if (cid && loc && l.actual_quantity !== '') {
            const diff = Api.r3(Number(String(l.actual_quantity).replace(',', '.')) - Api.stockQty(cid, loc));
            cells[3].textContent = isNaN(diff) ? '—' : (diff > 0 ? '+' : '') + UI.fmtQty(diff);
            cells[3].className = 'num ' + (diff > 0 ? 'delta-plus' : diff < 0 ? 'delta-minus' : '');
          }
        } else {
          const cells = tr.querySelectorAll('td');
          cells[cells.length - 2].innerHTML = infoFor(lines[i]);
        }
      }

      form.addEventListener('change', e => {
        const n = e.target.name;
        if (['location_id', 'source_location_id', 'issue_id'].includes(n)) {
          if (n === 'issue_id' && currentIssue()) {
            const iss = Api.byId(Api.state().operations, currentIssue());
            const det = Api.detailsOf(iss.id);
            const locSel = form.querySelector('[name=location_id]');
            if (locSel && !locSel.value && det[0]) locSel.value = det[0].source_location_id;
            const hasAny = lines.some(l => l.component_id);
            if (!hasAny) lines = det.map(d => ({ component_id: d.component_id, quantity: '' })).filter(l => Api.returnedLeft(iss.id, l.component_id) > 0);
            if (!lines.length) lines.push({ component_id: '', quantity: '' });
          }
          renderLines();
        }
        if (n === 'reason_select') {
          view.querySelector('#reason-custom').hidden = e.target.value !== 'Иная причина';
        }
      });

      view.querySelector('#add-line').onclick = () => { lines.push({ component_id: '', quantity: '', unit_price: '', actual_quantity: '' }); renderLines(); };
      const fillAll = view.querySelector('#fill-all');
      if (fillAll) fillAll.onclick = () => {
        const loc = currentLoc();
        if (!loc) { UI.toast('Сначала выберите место хранения', 'error'); return; }
        const st = Api.state().stock.filter(x => x.location_id === loc && x.quantity > 0);
        const existing = new Set(lines.map(l => Number(l.component_id)).filter(Boolean));
        lines = lines.filter(l => l.component_id);
        st.forEach(x => { if (!existing.has(x.component_id) && !Api.byId(Api.state().components, x.component_id).is_archived) lines.push({ component_id: x.component_id, actual_quantity: '' }); });
        if (!lines.length) { lines.push({ component_id: '', actual_quantity: '' }); UI.toast('В выбранном месте нет остатков', 'info'); }
        renderLines();
      };

      function collect() {
        const data = {
          id: op ? op.id : undefined,
          type,
          number: type === 'receipt' ? val('number') : (op ? op.number : ''),
          operation_date: val('operation_date') ? new Date(val('operation_date')).toISOString() : '',
          comment: val('comment'),
          location_id: val('location_id'),
          source_location_id: val('source_location_id'),
          destination_location_id: val('destination_location_id'),
          receiver: val('receiver'),
          issue_id: currentIssue(),
          reason: '',
          lines: lines.map(l => ({ component_id: Number(l.component_id) || null, quantity: l.quantity, unit_price: l.unit_price, actual_quantity: l.actual_quantity }))
        };
        if (type === 'writeoff') {
          const sel = val('reason_select');
          data.reason = sel === 'Иная причина' ? (val('reason_text').trim() || '') : sel;
          if (sel === 'Иная причина' && !data.reason) data.reason = '';
        }
        return data;
      }

      function markRequired() {
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        const req = ['operation_date', type === 'transfer' ? 'source_location_id' : 'location_id'];
        if (type === 'transfer') req.push('destination_location_id');
        if (type === 'issue') req.push('receiver');
        if (type === 'writeoff') req.push(val('reason_select') === 'Иная причина' ? 'reason_text' : 'reason_select');
        req.forEach(n => { const el = form.querySelector(`[name="${n}"]`); if (el && !el.value.trim()) el.classList.add('is-invalid'); });
        form.querySelectorAll('#lines-body [data-f="component_id"], #lines-body [data-f="quantity"], #lines-body [data-f="actual_quantity"]').forEach(el => {
          if (!el.value) el.classList.add('is-invalid');
        });
      }

      view.querySelector('#save-draft').onclick = async () => {
        errBox.hidden = true;
        markRequired();
        try {
          const saved = await Api.saveDraft(collect());
          UI.toast('Черновик ' + saved.number + ' сохранён');
          location.hash = '#/operations/' + saved.id;
        } catch (e) { UI.showError(errBox, e); }
      };

      view.querySelector('#post-doc').onclick = async () => {
        errBox.hidden = true;
        markRequired();
        const data = collect();
        try {
          if (!await Pages.confirmPost(data)) return;
          const posted = await Api.post(data);
          UI.toast('Документ ' + posted.number + ' успешно проведён. Он доступен в истории.');
          location.hash = '#/operations/' + posted.id;
        } catch (e) { UI.showError(errBox, e); }
      };

      renderLines();
    }
  };
})(window);
