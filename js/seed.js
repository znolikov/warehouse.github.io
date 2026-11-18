/* =====================================================================
   Скрипт инициализации БД: роли, начальные учётные записи, справочники,
   номенклатура и демонстрационные документы. Все остатки получены
   проведением документов, поэтому регистр stock согласован с журналом.

   Чтобы изменить ФИО или пароли тестовых пользователей — правьте
   массив SEED_USERS ниже, затем в приложении нажмите «Сбросить данные»
   (Справочники → Обслуживание) или очистите localStorage браузера.
   ===================================================================== */
(function (global) {
  'use strict';

  const SEED_USERS = [
    { login: 'admin', password: 'admin123', full_name: 'Опарина Наталья Сергеевна', role: 'Администратор' },
    { login: 'storekeeper', password: 'sk123', full_name: 'Петров Иван Алексеевич', role: 'Кладовщик' },
    { login: 'manager', password: 'mg123', full_name: 'Смирнова Елена Викторовна', role: 'Руководитель' }
  ];

  const CATEGORIES = ['Электротехника', 'Крепёж', 'Кабельная продукция', 'Электроника', 'Расходные материалы'];

  const UNITS = [
    { name: 'шт', allows_fraction: false },
    { name: 'м', allows_fraction: true },
    { name: 'кг', allows_fraction: true },
    { name: 'упак', allows_fraction: false }
  ];

  const LOCATIONS = [
    { name: 'Зона А / Стеллаж 1', description: 'Электротехника и электроника' },
    { name: 'Зона А / Стеллаж 2', description: 'Кабельная продукция' },
    { name: 'Зона Б / Ячейка 1', description: 'Крепёж и расходные материалы' },
    { name: 'Зона В / Резерв', description: 'Резервное место хранения' }
  ];

  // sku, name, category, unit, min_stock
  const COMPONENTS = [
    ['EL-001', 'Автоматический выключатель 16А', 'Электротехника', 'шт', 10],
    ['EL-002', 'Розетка накладная двойная', 'Электротехника', 'шт', 15],
    ['EL-003', 'Изолента ПВХ 19 мм', 'Расходные материалы', 'шт', 20],
    ['KB-001', 'Кабель ВВГнг 3×2,5', 'Кабельная продукция', 'м', 100],
    ['KB-002', 'Провод ПУГВ 1×1,5', 'Кабельная продукция', 'м', 50],
    ['KR-001', 'Саморез 3,5×25 (упак. 200 шт)', 'Крепёж', 'упак', 5],
    ['KR-002', 'Дюбель 6×30', 'Крепёж', 'шт', 200],
    ['EK-001', 'Резистор 10 кОм 0,25 Вт', 'Электроника', 'шт', 100],
    ['EK-002', 'Конденсатор 100 мкФ 25 В', 'Электроника', 'шт', 50],
    ['EK-003', 'Микроконтроллер ATmega328P', 'Электроника', 'шт', 10],
    ['RM-001', 'Припой ПОС-61', 'Расходные материалы', 'кг', 1]
  ];

  function daysAgo(n, hour) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour || 10, Math.floor(Math.random() * 50), 0, 0);
    return d.toISOString();
  }

  function build() {
    const DB = global.DB;
    const internal = global.Api._internal;
    const s = DB.emptyState();
    const now = new Date().toISOString();

    ['Администратор', 'Кладовщик', 'Руководитель'].forEach(name => {
      s.roles.push({ id: DB.nextId(s, 'roles'), name });
    });
    const roleId = name => s.roles.find(r => r.name === name).id;

    SEED_USERS.forEach(u => {
      s.users.push({
        id: DB.nextId(s, 'users'),
        login: u.login,
        password_hash: global.Sha.hashPassword(u.password),
        full_name: u.full_name,
        role_id: roleId(u.role),
        is_active: true,
        must_change_password: false,
        created_at: now
      });
    });
    const admin = s.users[0];
    const sk = s.users[1];
    internal.audit(s, admin.id, 'Инициализация базы данных', 'system', null, { users: SEED_USERS.length });

    CATEGORIES.forEach(name => s.categories.push({ id: DB.nextId(s, 'categories'), name, is_active: true }));
    UNITS.forEach(u => s.units.push(Object.assign({ id: DB.nextId(s, 'units') }, u)));
    LOCATIONS.forEach(l => s.locations.push(Object.assign({ id: DB.nextId(s, 'locations'), is_active: true }, l)));

    const catId = n => s.categories.find(c => c.name === n).id;
    const unitId = n => s.units.find(u => u.name === n).id;
    COMPONENTS.forEach(([sku, name, cat, unit, min]) => {
      s.components.push({ id: DB.nextId(s, 'components'), sku, name, category_id: catId(cat), unit_id: unitId(unit), min_stock: min, is_archived: false, created_at: now });
    });

    const C = sku => s.components.find(c => c.sku === sku).id;
    const L = i => s.locations[i].id;
    const user = { id: sk.id };

    const post = (input) => {
      const op = internal.saveDraftIn(s, user, input);
      op.created_at = input.operation_date;
      internal.postIn(s, user, op.id);
      op.posted_at = input.operation_date;
      return op;
    };

    // --- Поступления ---
    post({ type: 'receipt', number: 'ТН-1045', operation_date: daysAgo(28), location_id: L(0), comment: 'Первичное оприходование',
      lines: [
        { component_id: C('EL-001'), quantity: 40, unit_price: 320 },
        { component_id: C('EL-002'), quantity: 30, unit_price: 210 },
        { component_id: C('EL-003'), quantity: 25, unit_price: 45 },
        { component_id: C('EK-003'), quantity: 12, unit_price: 390 }
      ] });
    post({ type: 'receipt', number: 'ТН-1046', operation_date: daysAgo(27), location_id: L(1),
      lines: [
        { component_id: C('KB-001'), quantity: 500, unit_price: 98.5 },
        { component_id: C('KB-002'), quantity: 200, unit_price: 21 }
      ] });
    post({ type: 'receipt', number: 'ТН-1051', operation_date: daysAgo(25), location_id: L(2),
      lines: [
        { component_id: C('KR-001'), quantity: 20, unit_price: 260 },
        { component_id: C('KR-002'), quantity: 1000, unit_price: 1.2 },
        { component_id: C('RM-001'), quantity: 3.5, unit_price: 2900 }
      ] });
    post({ type: 'receipt', operation_date: daysAgo(20), location_id: L(0),
      lines: [
        { component_id: C('EK-001'), quantity: 500, unit_price: 0.8 },
        { component_id: C('EK-002'), quantity: 200, unit_price: 6.5 }
      ] });

    // --- Выдачи ---
    const iss1 = post({ type: 'issue', operation_date: daysAgo(18), location_id: L(0), receiver: 'Цех сборки №1',
      lines: [{ component_id: C('EL-001'), quantity: 12 }, { component_id: C('EL-002'), quantity: 8 }, { component_id: C('EL-003'), quantity: 6 }] });
    post({ type: 'issue', operation_date: daysAgo(15), location_id: L(1), receiver: 'Монтажный участок',
      lines: [{ component_id: C('KB-001'), quantity: 180 }, { component_id: C('KB-002'), quantity: 60 }] });
    post({ type: 'issue', operation_date: daysAgo(12), location_id: L(0), receiver: 'Лаборатория электроники',
      lines: [{ component_id: C('EK-001'), quantity: 220 }, { component_id: C('EK-002'), quantity: 90 }, { component_id: C('EK-003'), quantity: 4 }] });
    post({ type: 'issue', operation_date: daysAgo(9), location_id: L(2), receiver: 'Монтажный участок',
      lines: [{ component_id: C('KR-002'), quantity: 650 }, { component_id: C('KR-001'), quantity: 9 }] });
    post({ type: 'issue', operation_date: daysAgo(6), location_id: L(1), receiver: 'Цех сборки №1',
      lines: [{ component_id: C('KB-001'), quantity: 140 }] });
    post({ type: 'issue', operation_date: daysAgo(3), location_id: L(0), receiver: 'Лаборатория электроники',
      lines: [{ component_id: C('EK-001'), quantity: 120 }, { component_id: C('EL-003'), quantity: 4 }] });

    // --- Возврат по выдаче ---
    post({ type: 'return', operation_date: daysAgo(14), location_id: L(0), issue_id: iss1.id, comment: 'Неиспользованные позиции',
      lines: [{ component_id: C('EL-002'), quantity: 2 }] });

    // --- Списание ---
    post({ type: 'writeoff', operation_date: daysAgo(10), location_id: L(0), reason: 'Брак',
      lines: [{ component_id: C('EK-002'), quantity: 5 }], comment: 'Вздутие корпуса' });

    // --- Перемещение ---
    post({ type: 'transfer', operation_date: daysAgo(8), source_location_id: L(1), destination_location_id: L(3),
      lines: [{ component_id: C('KB-001'), quantity: 50 }], comment: 'Перенос в резерв' });

    // --- Инвентаризация ---
    post({ type: 'inventory', operation_date: daysAgo(2), location_id: L(2), comment: 'Плановая инвентаризация ячейки Б1',
      lines: [{ component_id: C('KR-002'), actual_quantity: 345 }, { component_id: C('KR-001'), actual_quantity: 11 }] });

    // --- Черновик (для демонстрации) ---
    internal.saveDraftIn(s, user, { type: 'receipt', operation_date: new Date().toISOString(), location_id: L(0), comment: 'Ожидается поставка',
      lines: [{ component_id: C('EL-003'), quantity: 50, unit_price: 45 }] });

    s.meta.seeded_at = now;
    return s;
  }

  global.Seed = { build, SEED_USERS };
})(typeof window !== 'undefined' ? window : globalThis);
