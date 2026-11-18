/* Общие элементы интерфейса: таблицы с поиском/сортировкой/пагинацией,
   модальные окна, уведомления, форматирование. */
(function (global) {
  'use strict';

  const UI = {};

  UI.esc = function (v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
  const esc = UI.esc;

  UI.fmtQty = function (n, unit) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const s = Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
    return unit ? `${s} ${unit}` : s;
  };
  UI.fmtMoney = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
  };
  UI.fmtDate = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU');
  };
  UI.fmtDateTime = function (iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  /** «Опарина Наталья Сергеевна» → «Опарина Н.С.» */
  UI.shortName = function (full) {
    const p = String(full || '').trim().split(/\s+/);
    if (p.length < 2) return full || '';
    return p[0] + ' ' + p.slice(1, 3).map(x => x[0] + '.').join('');
  };
  UI.isoDate = function (d) {
    const x = d instanceof Date ? d : new Date(d);
    const pad = n => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  UI.localDateTimeValue = function (d) {
    const x = d ? new Date(d) : new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  };

  UI.options = function (list, selected, placeholder, labelFn) {
    labelFn = labelFn || (x => x.name);
    let h = placeholder !== undefined && placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : '';
    list.forEach(x => {
      h += `<option value="${esc(x.id)}"${String(x.id) === String(selected) ? ' selected' : ''}>${esc(labelFn(x))}</option>`;
    });
    return h;
  };

  UI.opBadge = function (op) {
    const t = global.Api.OP_TYPES[op.type];
    const cls = { receipt: 'green', issue: 'blue', return: 'gray', writeoff: 'red', transfer: 'amber', inventory: 'gray' }[op.type];
    return `<span class="badge-s ${cls}">${esc(t.name)}${op.reversal_of_id ? ' · сторно' : ''}</span>`;
  };
  UI.statusBadge = function (op) {
    if (op.status === 'draft') return '<span class="badge-s amber">Черновик</span>';
    if (op.reversal_of_id) return '<span class="badge-s gray">Сторно</span>';
    if (global.Api.isReversed(op.id)) return '<span class="badge-s red">Сторнирован</span>';
    return '<span class="badge-s green">Проведён</span>';
  };

  // ---------- уведомления ----------
  UI.toast = function (msg, type) {
    const root = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast-x ' + (type || 'success');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
  };

  UI.errorHtml = function (err) {
    const details = (err && err.details && err.details.length) ? '<ul>' + err.details.map(d => `<li>${esc(d)}</li>`).join('') + '</ul>' : '';
    let msg = err && err.message ? err.message : 'Произошла ошибка';
    if (err && !(err instanceof global.Api.ApiError)) {
      console.error(err);
      msg = 'Не удалось выполнить действие. Повторите попытку.'; // не раскрываем внутренние детали
    }
    return `<div class="alert-box error"><b>${esc(msg)}</b>${details}</div>`;
  };

  UI.showError = function (container, err) {
    if (container) {
      container.innerHTML = UI.errorHtml(err);
      container.hidden = false;
      container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      UI.toast((err && err.message) || 'Ошибка', 'error');
    }
  };

  // ---------- модальные окна ----------
  /**
   * UI.modal({ title, body, size, buttons: [{text, cls, value, action(modalEl) -> false чтобы не закрывать}] , onOpen })
   * Возвращает Promise со значением нажатой кнопки (или null при закрытии).
   */
  UI.modal = function (opts) {
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop-x';
      const buttons = opts.buttons || [{ text: 'Закрыть', cls: 'btn-outline-secondary', value: null }];
      wrap.innerHTML = `
        <div class="modal-x ${opts.size || ''}" role="dialog" aria-modal="true">
          <div class="modal-x-head"><h3>${esc(opts.title)}</h3><button class="modal-x-close" aria-label="Закрыть">×</button></div>
          <div class="modal-x-body">${opts.body || ''}<div class="modal-err" hidden></div></div>
          <div class="modal-x-foot">${buttons.map((b, i) => `<button class="btn ${b.cls || 'btn-outline-secondary'}" data-i="${i}">${esc(b.text)}</button>`).join('')}</div>
        </div>`;
      root.appendChild(wrap);
      const modalEl = wrap.querySelector('.modal-x');
      const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      wrap.querySelector('.modal-x-close').onclick = () => close(null);
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
      wrap.querySelectorAll('.modal-x-foot button').forEach(btn => {
        btn.onclick = async () => {
          const b = buttons[Number(btn.dataset.i)];
          if (b.action) {
            btn.disabled = true;
            try {
              const r = await b.action(modalEl);
              if (r === false) { btn.disabled = false; return; }
              close(r === undefined ? b.value : r);
            } catch (err) {
              btn.disabled = false;
              UI.showError(modalEl.querySelector('.modal-err'), err);
            }
          } else {
            close(b.value);
          }
        };
      });
      if (opts.onOpen) opts.onOpen(modalEl);
      const first = modalEl.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
      if (first) setTimeout(() => { if (!modalEl.contains(document.activeElement)) first.focus(); }, 30);
    });
  };

  UI.confirm = function (title, bodyHtml, okText, okCls) {
    return UI.modal({
      title,
      body: bodyHtml,
      buttons: [
        { text: 'Отмена', cls: 'btn-outline-secondary', value: false },
        { text: okText || 'Подтвердить', cls: okCls || 'btn-primary', value: true }
      ]
    }).then(v => v === true);
  };

  /** Считать значения формы в объект. */
  UI.formData = function (root) {
    const o = {};
    root.querySelectorAll('[name]').forEach(el => {
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else o[el.name] = el.value;
    });
    return o;
  };

  // ---------- таблица с поиском, сортировкой, пагинацией ----------
  class DataTable {
    /**
     * opts: { columns: [{key,title,render,sortValue,sortable,cls}], rows, pageSize, search: {placeholder, text(row)},
     *         emptyText, rowClass(row), toolbarExtra (html), defaultSort: {key, dir}, footer(rows) -> html }
     */
    constructor(el, opts) {
      this.el = el;
      this.o = Object.assign({ pageSize: 20, emptyText: 'Нет данных' }, opts);
      this.rows = opts.rows || [];
      this.query = '';
      this.page = 1;
      this.sort = opts.defaultSort || null;
      this.renderShell();
      this.renderBody();
    }

    setRows(rows) { this.rows = rows; this.page = 1; this.renderBody(); }

    renderShell() {
      const o = this.o;
      this.el.innerHTML = `
        ${o.search || o.toolbarExtra ? `<div class="dt-toolbar">
          ${o.search ? `<input class="form-control dt-search" type="search" placeholder="${esc(o.search.placeholder || 'Поиск…')}" aria-label="Поиск">` : ''}
          ${o.toolbarExtra || ''}
        </div>` : ''}
        <div class="table-wrap"><table class="data">
          <thead><tr>${o.columns.map((c, i) => `<th data-i="${i}" class="${c.sortable === false ? '' : 'sortable'} ${c.num ? 'num' : ''}">${esc(c.title)}<span class="sort-ind"></span></th>`).join('')}</tr></thead>
          <tbody></tbody><tfoot></tfoot>
        </table></div>
        <div class="dt-pager"></div>`;
      const s = this.el.querySelector('.dt-search');
      if (s) s.addEventListener('input', () => { this.query = s.value.toLowerCase().trim(); this.page = 1; this.renderBody(); });
      this.el.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const c = o.columns[Number(th.dataset.i)];
          const key = c.key;
          if (this.sort && this.sort.key === key) this.sort.dir = this.sort.dir === 'asc' ? 'desc' : 'asc';
          else this.sort = { key, dir: 'asc' };
          this.renderBody();
        });
      });
    }

    filtered() {
      let rows = this.rows;
      const o = this.o;
      if (this.query && o.search) {
        rows = rows.filter(r => String(o.search.text(r)).toLowerCase().includes(this.query));
      }
      if (this.sort) {
        const col = o.columns.find(c => c.key === this.sort.key);
        if (col) {
          const val = col.sortValue || (r => r[col.key]);
          const dir = this.sort.dir === 'asc' ? 1 : -1;
          rows = rows.slice().sort((a, b) => {
            const x = val(a), y = val(b);
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
            return String(x ?? '').localeCompare(String(y ?? ''), 'ru', { numeric: true }) * dir;
          });
        }
      }
      return rows;
    }

    renderBody() {
      const o = this.o;
      const rows = this.filtered();
      const pages = Math.max(1, Math.ceil(rows.length / o.pageSize));
      if (this.page > pages) this.page = pages;
      const start = (this.page - 1) * o.pageSize;
      const slice = rows.slice(start, start + o.pageSize);
      const tbody = this.el.querySelector('tbody');
      tbody.innerHTML = slice.length ? slice.map(r => `<tr class="${o.rowClass ? o.rowClass(r) : ''}">${o.columns.map(c => {
        const v = c.render ? c.render(r) : esc(r[c.key]);
        return `<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${v}</td>`;
      }).join('')}</tr>`).join('') : `<tr><td class="empty" colspan="${o.columns.length}">${esc(this.query ? 'Ничего не найдено' : o.emptyText)}</td></tr>`;
      this.el.querySelector('tfoot').innerHTML = o.footer && rows.length ? o.footer(rows) : '';
      this.el.querySelectorAll('th').forEach(th => {
        const c = o.columns[Number(th.dataset.i)];
        th.querySelector('.sort-ind').textContent = this.sort && this.sort.key === c.key ? (this.sort.dir === 'asc' ? '▲' : '▼') : '';
      });
      const pager = this.el.querySelector('.dt-pager');
      if (rows.length <= o.pageSize) {
        pager.innerHTML = rows.length ? `<span>Записей: ${rows.length}</span>` : '';
      } else {
        let btns = '';
        const add = (p, label) => { btns += `<button class="btn btn-sm btn-outline-secondary ${p === this.page ? 'current' : ''}" data-p="${p}">${label || p}</button>`; };
        if (this.page > 1) add(this.page - 1, '‹');
        for (let p = 1; p <= pages; p++) {
          if (p === 1 || p === pages || Math.abs(p - this.page) <= 2) add(p);
          else if (Math.abs(p - this.page) === 3) btns += '<span>…</span>';
        }
        if (this.page < pages) add(this.page + 1, '›');
        pager.innerHTML = `<span>Показано ${start + 1}–${start + slice.length} из ${rows.length}</span><div class="pages">${btns}</div>`;
        pager.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => { this.page = Number(b.dataset.p); this.renderBody(); });
      }
      if (o.afterRender) o.afterRender(this.el);
    }
  }
  UI.DataTable = DataTable;

  // ---------- графики ----------
  UI.charts = [];
  UI.destroyCharts = function () {
    UI.charts.forEach(c => { try { c.destroy(); } catch (e) { /* ignore */ } });
    UI.charts = [];
  };
  UI.chart = function (canvasHolder, config) {
    if (typeof global.Chart === 'undefined') {
      canvasHolder.innerHTML = '<div class="chart-fallback">Графики недоступны: библиотека Chart.js не загрузилась (нужен доступ к интернету).</div>';
      return null;
    }
    canvasHolder.innerHTML = '<canvas></canvas>';
    const c = new global.Chart(canvasHolder.querySelector('canvas'), Object.assign({ options: {} }, config, {
      options: Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, config.options || {})
    }));
    UI.charts.push(c);
    return c;
  };
  UI.palette = ['#2a5a8f', '#3b82f6', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#0891b2', '#64748b'];

  // ---------- экспорт ----------
  UI.exportXlsx = function (filename, sheets) {
    try {
      global.Api.require('export');
      global.XlsxWriter.download(filename, sheets);
      UI.toast('Файл ' + filename + ' сформирован');
    } catch (e) {
      UI.toast(e.message, 'error');
    }
  };

  UI.setTitle = function (t) {
    document.getElementById('page-title').textContent = t;
    document.title = t + ' — ИС учёта комплектующих';
  };

  global.UI = UI;
})(window);
