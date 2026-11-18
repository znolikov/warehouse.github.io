/* =====================================================================
   Слой бизнес-логики («серверная часть»).

   Каждая функция, изменяющая данные или отдающая защищённые сведения,
   сама проверяет авторизацию, активность учётной записи и права роли
   (матрица 6.4.3 ТЗ). Поэтому даже при прямом переходе по адресу или
   вызове функции из консоли браузера запрещённое действие не выполнится —
   скрытие кнопок в интерфейсе не является единственной защитой.
   ===================================================================== */
(function (global) {
  'use strict';

  const DB = global.DB;

  const ROLES = {
    ADMIN: 'Администратор',
    STORE: 'Кладовщик',
    MANAGER: 'Руководитель'
  };

  /** Матрица разграничения прав доступа (ТЗ, п. 6.4.3). */
  const PERMS = {
    'profile': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'dashboard': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'users.manage': [ROLES.ADMIN],
    'dict.manage': [ROLES.ADMIN],
    'components.view': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'components.edit': [ROLES.ADMIN, ROLES.STORE],
    'stock.view': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'ops.create': [ROLES.STORE],
    'ops.view': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'audit.view': [ROLES.ADMIN],
    'reports': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER],
    'export': [ROLES.ADMIN, ROLES.STORE, ROLES.MANAGER]
  };

  const OP_TYPES = {
    receipt: { name: 'Поступление', prefix: 'ПР', icon: 'receipt' },
    issue: { name: 'Выдача', prefix: 'ВД', icon: 'issue' },
    return: { name: 'Возврат', prefix: 'ВЗ', icon: 'return' },
    writeoff: { name: 'Списание', prefix: 'СП', icon: 'writeoff' },
    transfer: { name: 'Перемещение', prefix: 'ПМ', icon: 'transfer' },
    inventory: { name: 'Инвентаризация', prefix: 'ИН', icon: 'inventory' }
  };

  const STATUSES = { draft: 'Черновик', posted: 'Проведён' };

  const WRITEOFF_REASONS = ['Брак', 'Утеря', 'Повреждение', 'Истёк срок годности', 'Иная причина'];

  class ApiError extends Error {
    constructor(message, code, details) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 400;
      this.details = details || [];
    }
  }

  const SESSION_KEY = 'ic_session_user';

  // ------------------------------------------------------------------
  // Вспомогательные функции
  // ------------------------------------------------------------------
  const r3 = x => Math.round((Number(x) + Number.EPSILON) * 1000) / 1000;
  const nowIso = () => new Date().toISOString();
  const byId = (arr, id) => arr.find(x => x.id === Number(id));

  function toNum(v) {
    if (v === null || v === undefined || v === '') return NaN;
    return Number(String(v).replace(',', '.').trim());
  }

  function roleName(state, roleId) {
    const r = byId(state.roles, roleId);
    return r ? r.name : '';
  }

  function sessionUserId() {
    try { return Number(sessionStorage.getItem(SESSION_KEY)) || null; } catch (e) { return null; }
  }

  function userFromState(state) {
    const id = sessionUserId();
    if (!id) return null;
    const u = byId(state.users, id);
    if (!u || !u.is_active) return null;
    return Object.assign({}, u, { role: roleName(state, u.role_id) });
  }

  function can(user, perm) {
    return !!user && (PERMS[perm] || []).includes(user.role);
  }

  /** Проверка прав на «сервере». */
  function requireIn(state, perm) {
    const u = userFromState(state);
    if (!u) throw new ApiError('Требуется авторизация. Войдите в систему.', 401);
    if (perm && !can(u, perm)) throw new ApiError('Отсутствие доступа: действие недоступно для роли «' + u.role + '».', 403);
    return u;
  }

  function audit(state, userId, action, entityType, entityId, details) {
    state.audit_log.push({
      id: DB.nextId(state, 'audit_log'),
      user_id: userId || null,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      created_at: nowIso(),
      details: details || {}
    });
  }

  function stockRow(state, componentId, locationId) {
    return state.stock.find(s => s.component_id === componentId && s.location_id === locationId);
  }

  function stockQty(state, componentId, locationId) {
    const s = stockRow(state, componentId, locationId);
    return s ? s.quantity : 0;
  }

  function totalStock(state, componentId) {
    return r3(state.stock.filter(s => s.component_id === componentId).reduce((a, s) => a + s.quantity, 0));
  }

  function componentLabel(state, id) {
    const c = byId(state.components, id);
    return c ? `${c.sku} — ${c.name}` : '#' + id;
  }

  function locationLabel(state, id) {
    const l = byId(state.locations, id);
    return l ? l.name : '—';
  }

  function unitOf(state, componentId) {
    const c = byId(state.components, componentId);
    return c ? byId(state.units, c.unit_id) : null;
  }

  function isReversed(state, opId) {
    return state.operations.some(o => o.reversal_of_id === opId && o.status === 'posted');
  }

  function detailsOf(state, opId) {
    return state.operation_details.filter(d => d.operation_id === opId);
  }

  // ------------------------------------------------------------------
  // Движения по остаткам
  // ------------------------------------------------------------------
  /** Изменения остатков, которые даёт одна строка проведённого документа. */
  function lineMoves(op, d) {
    const sign = op.reversal_of_id ? -1 : 1;
    const m = [];
    switch (op.type) {
      case 'receipt':
      case 'return':
        m.push([d.destination_location_id, d.quantity]); break;
      case 'issue':
      case 'writeoff':
        m.push([d.source_location_id, -d.quantity]); break;
      case 'transfer':
        m.push([d.source_location_id, -d.quantity], [d.destination_location_id, d.quantity]); break;
      case 'inventory':
        m.push([d.destination_location_id, r3(d.actual_quantity - d.book_quantity)]); break;
      default: break;
    }
    return m.map(([loc, q]) => ({ component_id: d.component_id, location_id: loc, delta: r3(q * sign) }));
  }

  /** Применение движений к регистру stock с запретом отрицательных остатков. */
  function applyMoves(state, moves) {
    const agg = new Map();
    moves.forEach(m => {
      const k = m.component_id + ':' + m.location_id;
      agg.set(k, r3((agg.get(k) || 0) + m.delta));
    });
    const errors = [];
    agg.forEach((delta, k) => {
      const [cid, lid] = k.split(':').map(Number);
      const cur = stockQty(state, cid, lid);
      if (r3(cur + delta) < 0) {
        const u = unitOf(state, cid);
        errors.push(`Недостаточно остатка: «${componentLabel(state, cid)}» в месте «${locationLabel(state, lid)}» — доступно ${fmt(cur)} ${u ? u.name : ''}, требуется ${fmt(-delta)}.`);
      }
    });
    if (errors.length) throw new ApiError('Недостаточно остатка', 409, errors);
    agg.forEach((delta, k) => {
      if (delta === 0) return;
      const [cid, lid] = k.split(':').map(Number);
      let row = stockRow(state, cid, lid);
      if (!row) {
        row = { id: DB.nextId(state, 'stock'), component_id: cid, location_id: lid, quantity: 0 };
        state.stock.push(row);
      }
      row.quantity = r3(row.quantity + delta);
      if (row.quantity < 0) throw new ApiError('Нарушено ограничение CHECK (quantity >= 0)', 409);
    });
  }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
  }

  // ------------------------------------------------------------------
  // Проверка и нормализация складского документа
  // ------------------------------------------------------------------
  function returnedQtyForIssue(state, issueId, componentId, excludeOpId) {
    return r3(state.operations
      .filter(o => o.type === 'return' && o.issue_id === issueId && o.status === 'posted' &&
        !o.reversal_of_id && !isReversed(state, o.id) && o.id !== excludeOpId)
      .reduce((sum, o) => sum + detailsOf(state, o.id)
        .filter(d => d.component_id === componentId)
        .reduce((a, d) => a + d.quantity, 0), 0));
  }

  function issuedQty(state, issueId, componentId) {
    return r3(detailsOf(state, issueId).filter(d => d.component_id === componentId).reduce((a, d) => a + d.quantity, 0));
  }

  /**
   * Проверяет входные данные документа и возвращает нормализованный
   * заголовок и строки. При ошибках бросает ApiError со списком ошибок.
   */
  function validateDoc(state, input, opts) {
    opts = opts || {};
    const errors = [];
    const type = input.type;
    if (!OP_TYPES[type]) throw new ApiError('Неизвестный тип операции');

    const date = input.operation_date ? new Date(input.operation_date) : new Date();
    if (isNaN(date.getTime())) errors.push('Укажите корректную дату документа.');

    const checkLocation = (id, label) => {
      const loc = byId(state.locations, id);
      if (!id || !loc) { errors.push(`Выберите ${label}.`); return null; }
      if (!loc.is_active) errors.push(`Место хранения «${loc.name}» неактивно.`);
      return loc.id;
    };

    let locationId = null, srcId = null, dstId = null;
    if (type === 'transfer') {
      srcId = checkLocation(Number(input.source_location_id), 'исходное место хранения');
      dstId = checkLocation(Number(input.destination_location_id), 'целевое место хранения');
      if (srcId && dstId && srcId === dstId) errors.push('Исходное и целевое места хранения должны различаться.');
    } else {
      locationId = checkLocation(Number(input.location_id), 'место хранения');
    }

    const receiver = (input.receiver || '').trim();
    if (type === 'issue' && !receiver) errors.push('Укажите получателя или подразделение.');
    if (receiver.length > 150) errors.push('Получатель — не более 150 символов.');

    const reason = (input.reason || '').trim();
    if (type === 'writeoff' && !reason) errors.push('Причина списания обязательна.');
    if (reason.length > 255) errors.push('Причина — не более 255 символов.');

    const number = (input.number || '').trim();
    if (number.length > 50) errors.push('Номер документа — не более 50 символов.');

    let issueId = null;
    if (type === 'return' && input.issue_id) {
      const iss = byId(state.operations, input.issue_id);
      if (!iss || iss.type !== 'issue' || iss.status !== 'posted' || iss.reversal_of_id) {
        errors.push('Исходная выдача не найдена или не проведена.');
      } else if (isReversed(state, iss.id)) {
        errors.push('Исходная выдача сторнирована — возврат по ней невозможен.');
      } else {
        issueId = iss.id;
      }
    }

    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) errors.push('Добавьте хотя бы одну позицию в документ.');
    const seen = new Set();
    const details = [];
    lines.forEach((ln, i) => {
      const n = i + 1;
      const comp = byId(state.components, ln.component_id);
      if (!comp) { errors.push(`Строка ${n}: выберите комплектующее.`); return; }
      if (comp.is_archived) errors.push(`Строка ${n}: комплектующее «${comp.name}» в архиве.`);
      if (seen.has(comp.id)) errors.push(`Строка ${n}: позиция «${comp.name}» указана в документе дважды.`);
      seen.add(comp.id);
      const unit = byId(state.units, comp.unit_id);
      const det = {
        component_id: comp.id,
        quantity: null,
        unit_price: null,
        source_location_id: null,
        destination_location_id: null,
        actual_quantity: null,
        book_quantity: null
      };
      if (type === 'inventory') {
        const actual = toNum(ln.actual_quantity);
        if (isNaN(actual)) errors.push(`Строка ${n}: введите фактическое количество.`);
        else if (actual < 0) errors.push(`Строка ${n}: фактическое количество не может быть отрицательным.`);
        else if (unit && !unit.allows_fraction && !Number.isInteger(actual)) errors.push(`Строка ${n}: для единицы «${unit.name}» допускается только целое количество.`);
        const book = stockQty(state, comp.id, locationId);
        det.actual_quantity = r3(actual);
        det.book_quantity = book;
        det.quantity = r3(Math.abs(actual - book));
        det.source_location_id = locationId;
        det.destination_location_id = locationId;
      } else {
        const q = toNum(ln.quantity);
        if (isNaN(q) || q <= 0) errors.push(`Строка ${n}: количество должно быть больше нуля.`);
        else if (unit && !unit.allows_fraction && !Number.isInteger(q)) errors.push(`Строка ${n}: для единицы «${unit.name}» допускается только целое количество.`);
        else if (q > 1e10) errors.push(`Строка ${n}: слишком большое количество.`);
        det.quantity = r3(q);
        if (type === 'receipt' && ln.unit_price !== '' && ln.unit_price !== null && ln.unit_price !== undefined) {
          const p = toNum(ln.unit_price);
          if (isNaN(p) || p < 0) errors.push(`Строка ${n}: цена не может быть отрицательной.`);
          else det.unit_price = Math.round(p * 100) / 100;
        }
        if (type === 'receipt' || type === 'return') det.destination_location_id = locationId;
        if (type === 'issue' || type === 'writeoff') det.source_location_id = locationId;
        if (type === 'transfer') { det.source_location_id = srcId; det.destination_location_id = dstId; }

        if (type === 'return' && issueId && !isNaN(q)) {
          const issued = issuedQty(state, issueId, comp.id);
          if (issued === 0) {
            errors.push(`Строка ${n}: позиция «${comp.name}» не входила в исходную выдачу.`);
          } else {
            const left = r3(issued - returnedQtyForIssue(state, issueId, comp.id, opts.excludeOpId));
            if (q > left) errors.push(`Строка ${n}: нельзя вернуть больше выданного. По выдаче осталось к возврату ${fmt(left)} ${unit ? unit.name : ''}.`);
          }
        }
      }
      details.push(det);
    });

    if (errors.length) throw new ApiError('Проверьте данные документа', 422, errors);

    return {
      header: {
        type,
        number,
        operation_date: isNaN(date.getTime()) ? nowIso() : date.toISOString(),
        comment: (input.comment || '').trim().slice(0, 2000),
        reason: type === 'writeoff' ? reason : '',
        receiver: type === 'issue' ? receiver : '',
        issue_id: type === 'return' ? issueId : null
      },
      details
    };
  }

  function nextNumber(state, type) {
    const prefix = OP_TYPES[type].prefix;
    const count = state.operations.filter(o => o.type === type && !o.reversal_of_id).length + 1;
    let num;
    let i = count;
    do { num = `${prefix}-${String(i).padStart(5, '0')}`; i++; }
    while (state.operations.some(o => o.number === num));
    return num;
  }

  function writeDetails(state, opId, details) {
    state.operation_details = state.operation_details.filter(d => d.operation_id !== opId);
    details.forEach(d => state.operation_details.push(Object.assign({ id: DB.nextId(state, 'operation_details'), operation_id: opId }, d)));
  }

  /** Сохранение черновика (новый или изменение существующего). */
  function saveDraftIn(state, user, input) {
    const { header, details } = validateDoc(state, input, { excludeOpId: input.id ? Number(input.id) : null });
    let op;
    if (input.id) {
      op = byId(state.operations, input.id);
      if (!op) throw new ApiError('Документ не найден', 404);
      if (op.status !== 'draft') throw new ApiError('Проведённый документ нельзя изменять. Оформите сторно или корректировку.', 409);
      if (op.type !== header.type) throw new ApiError('Тип документа менять нельзя', 409);
      Object.assign(op, header, { number: header.number || op.number });
      audit(state, user.id, 'Изменение черновика', 'operation', op.id, { number: op.number });
    } else {
      op = Object.assign({
        id: DB.nextId(state, 'operations'),
        status: 'draft',
        created_by: user.id,
        created_at: nowIso(),
        posted_at: null,
        reversal_of_id: null
      }, header);
      op.number = header.number || nextNumber(state, header.type);
      state.operations.push(op);
      audit(state, user.id, 'Создание черновика', 'operation', op.id, { number: op.number, type: op.type });
    }
    writeDetails(state, op.id, details);
    return op;
  }

  /** Проведение документа: документ + строки + stock + аудит в одной транзакции. */
  function postIn(state, user, opId) {
    const op = byId(state.operations, opId);
    if (!op) throw new ApiError('Документ не найден', 404);
    if (op.status !== 'draft') throw new ApiError('Документ уже проведён', 409);
    // повторная проверка непосредственно в момент проведения
    const input = Object.assign({}, op, {
      location_id: null, source_location_id: null, destination_location_id: null,
      lines: detailsOf(state, op.id).map(d => ({
        component_id: d.component_id, quantity: d.quantity, unit_price: d.unit_price,
        actual_quantity: d.actual_quantity
      }))
    });
    const first = detailsOf(state, op.id)[0] || {};
    if (op.type === 'transfer') {
      input.source_location_id = first.source_location_id;
      input.destination_location_id = first.destination_location_id;
    } else {
      input.location_id = first.destination_location_id || first.source_location_id;
    }
    const { details } = validateDoc(state, input, { excludeOpId: op.id });
    writeDetails(state, op.id, details);
    const moves = [];
    details.forEach(d => moves.push(...lineMoves(op, d)));
    applyMoves(state, moves);
    op.status = 'posted';
    op.posted_at = nowIso();
    audit(state, user.id, 'Проведение документа', 'operation', op.id, { number: op.number, type: op.type, lines: details.length });
    return op;
  }

  function reverseIn(state, user, opId, comment) {
    const op = byId(state.operations, opId);
    if (!op) throw new ApiError('Документ не найден', 404);
    if (op.status !== 'posted') throw new ApiError('Сторнировать можно только проведённый документ', 409);
    if (op.reversal_of_id) throw new ApiError('Сторнирующий документ нельзя сторнировать повторно', 409);
    if (isReversed(state, op.id)) throw new ApiError('Документ уже сторнирован. Повторное сторнирование запрещено.', 409);
    if (op.type === 'issue') {
      const hasReturns = state.operations.some(o => o.type === 'return' && o.issue_id === op.id &&
        o.status === 'posted' && !o.reversal_of_id && !isReversed(state, o.id));
      if (hasReturns) throw new ApiError('По выдаче есть проведённые возвраты. Сначала сторнируйте их.', 409);
    }
    const rev = {
      id: DB.nextId(state, 'operations'),
      number: 'СТ-' + op.number,
      type: op.type,
      status: 'posted',
      operation_date: nowIso(),
      created_by: user.id,
      created_at: nowIso(),
      posted_at: nowIso(),
      comment: (comment || '').trim() || ('Сторно документа ' + op.number),
      reason: op.reason,
      receiver: op.receiver,
      issue_id: op.issue_id || null,
      reversal_of_id: op.id
    };
    state.operations.push(rev);
    const det = detailsOf(state, op.id).map(d => {
      const c = Object.assign({}, d);
      delete c.id; delete c.operation_id;
      return c;
    });
    writeDetails(state, rev.id, det);
    const moves = [];
    det.forEach(d => moves.push(...lineMoves(rev, d)));
    applyMoves(state, moves);
    audit(state, user.id, 'Сторнирование документа', 'operation', rev.id, { number: rev.number, original: op.number });
    return rev;
  }

  // ------------------------------------------------------------------
  // Публичный API
  // ------------------------------------------------------------------
  const Api = {
    ROLES, PERMS, OP_TYPES, STATUSES, WRITEOFF_REASONS, ApiError,
    fmt, r3, byId,

    // ---------- чтение ----------
    state() { return DB.read(); },
    currentUser() { return userFromState(DB.read()); },
    can(perm) { return can(userFromState(DB.read()), perm); },
    require(perm) { return requireIn(DB.read(), perm); },

    stockQty(componentId, locationId) { return stockQty(DB.read(), Number(componentId), Number(locationId)); },
    totalStock(componentId) { return totalStock(DB.read(), componentId); },
    isReversed(opId) { return isReversed(DB.read(), opId); },
    detailsOf(opId) { return detailsOf(DB.read(), opId); },
    lineMoves,
    componentLabel(id) { return componentLabel(DB.read(), id); },
    locationLabel(id) { return locationLabel(DB.read(), id); },
    unitOf(cid) { return unitOf(DB.read(), cid); },
    userName(id) { const u = byId(DB.read().users, id); return u ? u.full_name : '—'; },
    roleName(id) { return roleName(DB.read(), id); },
    returnedLeft(issueId, componentId, excludeOpId) {
      const s = DB.read();
      return r3(issuedQty(s, issueId, componentId) - returnedQtyForIssue(s, issueId, componentId, excludeOpId));
    },

    // ---------- авторизация ----------
    async login(login, password) {
      login = (login || '').trim();
      let ok = null;
      await DB.tx(state => {
        const u = state.users.find(x => x.login.toLowerCase() === login.toLowerCase());
        if (!u || !global.Sha.checkPassword(password || '', u.password_hash)) {
          audit(state, u ? u.id : null, 'Неудачная попытка входа', 'user', u ? u.id : null, { login });
          return;
        }
        if (!u.is_active) {
          audit(state, u.id, 'Вход заблокированного пользователя отклонён', 'user', u.id, {});
          ok = 'blocked';
          return;
        }
        u.last_login_at = nowIso();
        audit(state, u.id, 'Вход в систему', 'user', u.id, {});
        ok = u;
      });
      if (ok === 'blocked') throw new ApiError('Учётная запись заблокирована. Обратитесь к администратору.', 403);
      if (!ok) throw new ApiError('Неверный логин или пароль', 401);
      sessionStorage.setItem(SESSION_KEY, String(ok.id));
      return userFromState(DB.read());
    },

    async logout() {
      const u = userFromState(DB.read());
      if (u) await DB.tx(state => audit(state, u.id, 'Выход из системы', 'user', u.id, {}));
      sessionStorage.removeItem(SESSION_KEY);
    },

    async changePassword(oldPw, newPw) {
      return DB.tx(state => {
        const me = requireIn(state, 'profile');
        const u = byId(state.users, me.id);
        if (!global.Sha.checkPassword(oldPw || '', u.password_hash)) throw new ApiError('Текущий пароль указан неверно', 422);
        validatePassword(newPw);
        u.password_hash = global.Sha.hashPassword(newPw);
        u.must_change_password = false;
        audit(state, u.id, 'Смена пароля', 'user', u.id, {});
      });
    },

    // ---------- пользователи ----------
    listUsers() {
      const s = DB.read();
      requireIn(s, 'users.manage');
      return s.users.map(u => {
        const c = Object.assign({}, u, { role: roleName(s, u.role_id) });
        delete c.password_hash;
        return c;
      });
    },

    async saveUser(input) {
      return DB.tx(state => {
        const me = requireIn(state, 'users.manage');
        const errors = [];
        const login = (input.login || '').trim();
        const fullName = (input.full_name || '').trim();
        const roleId = Number(input.role_id);
        if (!input.id) {
          if (!/^[A-Za-z0-9_.-]{3,50}$/.test(login)) errors.push('Логин: 3–50 символов, латиница, цифры, «_», «.», «-».');
          if (state.users.some(u => u.login.toLowerCase() === login.toLowerCase())) errors.push('Пользователь с таким логином уже существует.');
          try { validatePassword(input.password); } catch (e) { errors.push(e.message); }
        }
        if (!fullName) errors.push('Укажите ФИО.');
        if (fullName.length > 150) errors.push('ФИО — не более 150 символов.');
        if (!byId(state.roles, roleId)) errors.push('Выберите роль.');
        if (errors.length) throw new ApiError('Проверьте данные пользователя', 422, errors);
        if (input.id) {
          const u = byId(state.users, input.id);
          if (!u) throw new ApiError('Пользователь не найден', 404);
          if (u.id === me.id && roleId !== u.role_id) throw new ApiError('Нельзя изменить роль собственной учётной записи', 409);
          const before = { full_name: u.full_name, role: roleName(state, u.role_id) };
          u.full_name = fullName;
          u.role_id = roleId;
          audit(state, me.id, 'Изменение пользователя', 'user', u.id, { login: u.login, before, after: { full_name: fullName, role: roleName(state, roleId) } });
          return u;
        }
        const u = {
          id: DB.nextId(state, 'users'),
          login,
          password_hash: global.Sha.hashPassword(input.password),
          full_name: fullName,
          role_id: roleId,
          is_active: true,
          must_change_password: true,
          created_at: nowIso()
        };
        state.users.push(u);
        audit(state, me.id, 'Создание пользователя', 'user', u.id, { login, role: roleName(state, roleId) });
        return u;
      });
    },

    async setUserActive(id, active) {
      return DB.tx(state => {
        const me = requireIn(state, 'users.manage');
        const u = byId(state.users, id);
        if (!u) throw new ApiError('Пользователь не найден', 404);
        if (u.id === me.id) throw new ApiError('Нельзя заблокировать собственную учётную запись', 409);
        u.is_active = !!active;
        audit(state, me.id, active ? 'Разблокировка пользователя' : 'Блокировка пользователя', 'user', u.id, { login: u.login });
      });
    },

    async resetPassword(id, newPw) {
      return DB.tx(state => {
        const me = requireIn(state, 'users.manage');
        const u = byId(state.users, id);
        if (!u) throw new ApiError('Пользователь не найден', 404);
        validatePassword(newPw);
        u.password_hash = global.Sha.hashPassword(newPw);
        u.must_change_password = true;
        audit(state, me.id, 'Сброс пароля', 'user', u.id, { login: u.login });
      });
    },

    // ---------- справочники ----------
    async saveDict(table, input) {
      if (!['categories', 'units', 'locations'].includes(table)) throw new ApiError('Неизвестный справочник');
      return DB.tx(state => {
        const me = requireIn(state, 'dict.manage');
        const name = (input.name || '').trim();
        const max = table === 'units' ? 20 : 100;
        const errors = [];
        if (!name) errors.push('Укажите наименование.');
        if (name.length > max) errors.push(`Наименование — не более ${max} символов.`);
        if (state[table].some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== Number(input.id))) errors.push('Запись с таким наименованием уже существует.');
        if (errors.length) throw new ApiError('Проверьте данные', 422, errors);
        let rec;
        if (input.id) {
          rec = byId(state[table], input.id);
          if (!rec) throw new ApiError('Запись не найдена', 404);
          rec.name = name;
        } else {
          rec = { id: DB.nextId(state, table), name };
          if (table !== 'units') rec.is_active = true;
          state[table].push(rec);
        }
        if (table === 'units') {
          const used = state.components.some(c => c.unit_id === rec.id);
          const af = !!input.allows_fraction;
          if (input.id && used && rec.allows_fraction && !af) {
            throw new ApiError('Единица уже используется — запретить дробные значения нельзя', 409);
          }
          rec.allows_fraction = af;
        }
        if (table === 'locations') rec.description = (input.description || '').trim();
        audit(state, me.id, input.id ? 'Изменение справочника' : 'Добавление в справочник', table, rec.id, { name });
        return rec;
      });
    },

    async setDictActive(table, id, active) {
      return DB.tx(state => {
        const me = requireIn(state, 'dict.manage');
        const rec = byId(state[table], id);
        if (!rec) throw new ApiError('Запись не найдена', 404);
        if (!active && table === 'locations' && state.stock.some(s => s.location_id === rec.id && s.quantity > 0)) {
          throw new ApiError('В месте хранения есть остатки — архивирование невозможно', 409);
        }
        rec.is_active = !!active;
        audit(state, me.id, active ? 'Восстановление из архива' : 'Архивирование записи справочника', table, rec.id, { name: rec.name });
      });
    },

    isDictUsed(table, id) {
      const s = DB.read();
      id = Number(id);
      if (table === 'categories') return s.components.some(c => c.category_id === id);
      if (table === 'units') return s.components.some(c => c.unit_id === id);
      if (table === 'locations') return s.stock.some(x => x.location_id === id) ||
        s.operation_details.some(d => d.source_location_id === id || d.destination_location_id === id);
      return true;
    },

    async deleteDict(table, id) {
      const used = this.isDictUsed(table, id);
      return DB.tx(state => {
        const me = requireIn(state, 'dict.manage');
        if (used) throw new ApiError('Запись используется в документах или карточках — физическое удаление запрещено, примените архивирование', 409);
        const rec = byId(state[table], id);
        if (!rec) throw new ApiError('Запись не найдена', 404);
        state[table] = state[table].filter(x => x.id !== rec.id);
        audit(state, me.id, 'Удаление записи справочника', table, rec.id, { name: rec.name });
      });
    },

    // ---------- номенклатура ----------
    async saveComponent(input) {
      return DB.tx(state => {
        const me = requireIn(state, 'components.edit');
        const errors = [];
        const sku = (input.sku || '').trim();
        const name = (input.name || '').trim();
        const minStock = toNum(input.min_stock === '' ? 0 : input.min_stock);
        if (!sku) errors.push('Укажите артикул.');
        if (sku.length > 50) errors.push('Артикул — не более 50 символов.');
        if (state.components.some(c => c.sku.toLowerCase() === sku.toLowerCase() && c.id !== Number(input.id))) {
          errors.push(`Артикул «${sku}» уже существует. Проверьте существующую карточку — артикул должен быть уникальным.`);
        }
        if (!name) errors.push('Укажите наименование.');
        if (name.length > 255) errors.push('Наименование — не более 255 символов.');
        const cat = byId(state.categories, input.category_id);
        if (!cat) errors.push('Выберите категорию.');
        else if (!cat.is_active && (!input.id || byId(state.components, input.id).category_id !== cat.id)) errors.push('Категория в архиве.');
        const unit = byId(state.units, input.unit_id);
        if (!unit) errors.push('Выберите единицу измерения.');
        if (isNaN(minStock) || minStock < 0) errors.push('Минимальный остаток — число не меньше нуля.');
        else if (unit && !unit.allows_fraction && !Number.isInteger(minStock)) errors.push(`Для единицы «${unit.name}» минимальный остаток должен быть целым.`);
        if (input.id) {
          const c = byId(state.components, input.id);
          if (c && unit && c.unit_id !== unit.id && state.operation_details.some(d => d.component_id === c.id)) {
            errors.push('По позиции есть операции — менять единицу измерения нельзя.');
          }
        }
        if (errors.length) throw new ApiError('Проверьте данные карточки', 422, errors);
        let c;
        if (input.id) {
          c = byId(state.components, input.id);
          if (!c) throw new ApiError('Комплектующее не найдено', 404);
          Object.assign(c, { sku, name, category_id: cat.id, unit_id: unit.id, min_stock: r3(minStock) });
          audit(state, me.id, 'Изменение карточки комплектующего', 'component', c.id, { sku });
        } else {
          c = { id: DB.nextId(state, 'components'), sku, name, category_id: cat.id, unit_id: unit.id, min_stock: r3(minStock), is_archived: false, created_at: nowIso() };
          state.components.push(c);
          audit(state, me.id, 'Создание карточки комплектующего', 'component', c.id, { sku, name });
        }
        return c;
      });
    },

    async setComponentArchived(id, archived) {
      return DB.tx(state => {
        const me = requireIn(state, 'components.edit');
        const c = byId(state.components, id);
        if (!c) throw new ApiError('Комплектующее не найдено', 404);
        if (archived) {
          if (totalStock(state, c.id) > 0) throw new ApiError('Архивирование невозможно: по позиции есть активный остаток', 409);
          const hasDraft = state.operations.some(o => o.status === 'draft' && detailsOf(state, o.id).some(d => d.component_id === c.id));
          if (hasDraft) throw new ApiError('Архивирование невозможно: позиция есть в незавершённых документах (черновиках)', 409);
        }
        c.is_archived = !!archived;
        audit(state, me.id, archived ? 'Архивирование комплектующего' : 'Восстановление комплектующего', 'component', c.id, { sku: c.sku });
      });
    },

    // ---------- складские документы ----------
    async saveDraft(input) {
      return DB.tx(state => saveDraftIn(state, requireIn(state, 'ops.create'), input));
    },

    /** Сохранить (если нужно) и провести — всё в одной транзакции. */
    async post(input) {
      return DB.tx(state => {
        const user = requireIn(state, 'ops.create');
        const op = saveDraftIn(state, user, input);
        return postIn(state, user, op.id);
      });
    },

    async postExisting(opId) {
      return DB.tx(state => postIn(state, requireIn(state, 'ops.create'), Number(opId)));
    },

    async deleteDraft(opId) {
      return DB.tx(state => {
        const me = requireIn(state, 'ops.create');
        const op = byId(state.operations, opId);
        if (!op) throw new ApiError('Документ не найден', 404);
        if (op.status !== 'draft') throw new ApiError('Проведённый документ нельзя удалить. Оформите сторно.', 409);
        state.operations = state.operations.filter(o => o.id !== op.id);
        state.operation_details = state.operation_details.filter(d => d.operation_id !== op.id);
        audit(state, me.id, 'Удаление черновика', 'operation', op.id, { number: op.number });
      });
    },

    async reverse(opId, comment) {
      return DB.tx(state => reverseIn(state, requireIn(state, 'ops.create'), Number(opId), comment));
    },

    /** Предварительный расчёт (для сводки перед проведением). */
    preview(input) {
      const s = DB.read();
      requireIn(s, 'ops.create');
      return validateDoc(s, input, { excludeOpId: input.id ? Number(input.id) : null });
    },

    // ---------- журнал ----------
    listAudit() {
      const s = DB.read();
      requireIn(s, 'audit.view');
      return s.audit_log.slice();
    },

    // ---------- отчёты ----------
    /** Все движения по проведённым документам (журнал движений). */
    movements(filter) {
      const s = DB.read();
      requireIn(s, 'ops.view');
      filter = filter || {};
      const from = filter.from ? new Date(filter.from + 'T00:00:00') : null;
      const to = filter.to ? new Date(filter.to + 'T23:59:59') : null;
      const res = [];
      s.operations.filter(o => o.status === 'posted').forEach(op => {
        const d0 = new Date(op.operation_date);
        if (from && d0 < from) return;
        if (to && d0 > to) return;
        if (filter.type && op.type !== filter.type) return;
        detailsOf(s, op.id).forEach(d => {
          if (filter.component_id && d.component_id !== Number(filter.component_id)) return;
          const moves = lineMoves(op, d);
          const inQty = moves.filter(m => m.delta > 0).reduce((a, m) => a + m.delta, 0);
          const outQty = moves.filter(m => m.delta < 0).reduce((a, m) => a - m.delta, 0);
          res.push({ op, d, moves, inQty: r3(inQty), outQty: r3(outQty) });
        });
      });
      res.sort((a, b) => new Date(b.op.operation_date) - new Date(a.op.operation_date) || b.op.id - a.op.id);
      return res;
    },

    /** Остатки по местам хранения. */
    stockReport(filter) {
      const s = DB.read();
      requireIn(s, 'stock.view');
      filter = filter || {};
      const rows = [];
      s.components.filter(c => !c.is_archived || totalStock(s, c.id) > 0).forEach(c => {
        if (filter.category_id && c.category_id !== Number(filter.category_id)) return;
        const q = (filter.query || '').toLowerCase().trim();
        if (q && !c.sku.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return;
        const total = totalStock(s, c.id);
        const deficit = total < c.min_stock;
        if (filter.deficit && !deficit) return;
        const unit = byId(s.units, c.unit_id);
        const cat = byId(s.categories, c.category_id);
        const locs = s.stock.filter(x => x.component_id === c.id && x.quantity > 0 &&
          (!filter.location_id || x.location_id === Number(filter.location_id)));
        if (filter.location_id && !locs.length) return;
        rows.push({
          component: c, unit, category: cat, total, deficit,
          byLocation: locs.map(x => ({ location: byId(s.locations, x.location_id), quantity: x.quantity }))
        });
      });
      return rows;
    },

    belowMin() {
      return this.stockReport({ deficit: true }).filter(r => !r.component.is_archived);
    },

    issuesByReceiver(filter) {
      const s = DB.read();
      requireIn(s, 'reports');
      const mv = this.movements(Object.assign({}, filter, { type: 'issue' }));
      const map = new Map();
      mv.forEach(({ op, d }) => {
        const sign = op.reversal_of_id ? -1 : 1;
        const key = (op.receiver || '—') + '|' + d.component_id;
        const row = map.get(key) || { receiver: op.receiver || '—', component_id: d.component_id, issued: 0, returned: 0, docs: new Set() };
        row.issued = r3(row.issued + sign * d.quantity);
        row.docs.add(op.reversal_of_id || op.id);
        map.set(key, row);
      });
      // возвраты, связанные с выдачами
      s.operations.filter(o => o.type === 'return' && o.status === 'posted' && o.issue_id).forEach(o => {
        const iss = byId(s.operations, o.issue_id);
        if (!iss) return;
        const sign = o.reversal_of_id ? -1 : 1;
        detailsOf(s, o.id).forEach(d => {
          const key = (iss.receiver || '—') + '|' + d.component_id;
          const row = map.get(key);
          if (row) row.returned = r3(row.returned + sign * d.quantity);
        });
      });
      return Array.from(map.values()).filter(r => r.issued !== 0)
        .map(r => Object.assign(r, { net: r3(r.issued - r.returned), docs: r.docs.size }))
        .sort((a, b) => a.receiver.localeCompare(b.receiver, 'ru') || b.net - a.net);
    },

    // ---------- обслуживание ----------
    async resetDemo() {
      const u = this.currentUser();
      if (!u || u.role !== ROLES.ADMIN) throw new ApiError('Сброс данных доступен только администратору', 403);
      await DB.reset();
      sessionStorage.removeItem(SESSION_KEY);
    },

    /** Проверка согласованности регистра stock с журналом движений. */
    checkConsistency() {
      const s = DB.read();
      const calc = new Map();
      s.operations.filter(o => o.status === 'posted').forEach(op => {
        detailsOf(s, op.id).forEach(d => lineMoves(op, d).forEach(m => {
          const k = m.component_id + ':' + m.location_id;
          calc.set(k, r3((calc.get(k) || 0) + m.delta));
        }));
      });
      const problems = [];
      s.stock.forEach(x => {
        const k = x.component_id + ':' + x.location_id;
        if (r3(calc.get(k) || 0) !== r3(x.quantity)) problems.push({ component: componentLabel(s, x.component_id), location: locationLabel(s, x.location_id), stock: x.quantity, journal: calc.get(k) || 0 });
        calc.delete(k);
      });
      calc.forEach((v, k) => {
        if (v !== 0) { const [c, l] = k.split(':').map(Number); problems.push({ component: componentLabel(s, c), location: locationLabel(s, l), stock: 0, journal: v }); }
      });
      return problems;
    },

    // внутренние функции для сидирования
    _internal: { saveDraftIn, postIn, reverseIn, audit }
  };

  function validatePassword(pw) {
    if (!pw || String(pw).length < 6) throw new ApiError('Пароль должен содержать не менее 6 символов', 422);
    if (String(pw).length > 100) throw new ApiError('Пароль слишком длинный', 422);
  }

  global.Api = Api;
})(typeof window !== 'undefined' ? window : globalThis);
