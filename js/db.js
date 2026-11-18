/* =====================================================================
   Хранилище данных («база данных») приложения.

   GitHub Pages умеет отдавать только статические файлы, поэтому вместо
   PostgreSQL данные хранятся в localStorage браузера. Структура таблиц
   полностью повторяет схему из ТЗ (раздел 6.5): roles, users, categories,
   units, locations, components, operations, operation_details, stock,
   audit_log.

   Хранение: основной экземпляр — в IndexedDB браузера (поддерживает
   настоящие транзакции), копия — в localStorage для быстрого чтения.

   Транзакции: DB.tx(fn) — функция fn получает копию базы, вносит
   изменения; если внутри возникла ошибка — транзакция отменяется и ни одно
   изменение не сохраняется (аналог ROLLBACK). Чтение и запись выполняются
   внутри одной readwrite-транзакции IndexedDB; браузер выполняет такие
   транзакции строго по очереди даже из разных вкладок — это аналог
   блокировки записей SELECT ... FOR UPDATE: из двух одновременных выдач
   последней единицы будет проведена только одна.
   ===================================================================== */
(function (global) {
  'use strict';

  const KEY = 'ic_warehouse_db_v1';
  const TABLES = ['roles', 'users', 'categories', 'units', 'locations', 'components',
    'operations', 'operation_details', 'stock', 'audit_log'];

  function emptyState() {
    const s = { meta: { version: 1, created_at: new Date().toISOString() }, seq: {} };
    TABLES.forEach(t => { s[t] = []; s.seq[t] = 0; });
    return s;
  }

  function clone(obj) {
    return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
  }

  function readStorage() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Не удалось прочитать данные', e);
      return null;
    }
  }

  function writeStorage(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // ---------- IndexedDB: транзакционное хранилище (источник истины) ----------
  const IDB_NAME = 'ic_warehouse';
  const IDB_STORE = 'kv';
  let idbPromise = null;

  function openIdb() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(resolve => {
      try {
        if (!global.indexedDB) return resolve(null);
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return idbPromise;
  }

  function idbGet(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }

  function idbPut(db, state) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const DB = {
    KEY,
    TABLES,
    state: null,
    emptyState,
    clone,

    /** Загрузка БД; при первом запуске — создание и заполнение тестовыми данными. */
    async init() {
      this.state = readStorage();
      const idb = await openIdb();
      if (idb) {
        const stored = await idbGet(idb).catch(() => null);
        if (stored && (!this.state || (stored.meta.version || 0) >= (this.state.meta.version || 0))) {
          this.state = stored;
          writeStorage(stored);
        }
      }
      if (!this.state || !this.state.meta) {
        this.state = global.Seed.build();
        await this.persist(this.state);
      } else if (idb) {
        const stored = await idbGet(idb).catch(() => null);
        if (!stored) await idbPut(idb, this.state).catch(() => {});
      }
      return this.state;
    },

    async persist(state) {
      writeStorage(state);
      const idb = await openIdb();
      if (idb) await idbPut(idb, state).catch(e => console.error(e));
    },

    /** Актуальное состояние для отображения (кэш localStorage). */
    read() {
      const fresh = readStorage();
      if (fresh && (!this.state || (fresh.meta.version || 0) >= (this.state.meta.version || 0))) this.state = fresh;
      return this.state;
    },

    nextId(state, table) {
      state.seq[table] = (state.seq[table] || 0) + 1;
      return state.seq[table];
    },

    /**
     * Транзакция: всё или ничего.
     * fn(draft) — синхронная функция, изменяющая draft. Возвращает результат fn.
     * Чтение актуального состояния, изменение и запись выполняются внутри одной
     * readwrite-транзакции IndexedDB, которые браузер выполняет строго по очереди
     * даже между разными вкладками, — аналог блокировки записей в СУБД.
     */
    async tx(fn) {
      const idb = await openIdb();
      if (!idb) return this._txFallback(fn);
      const result = await new Promise((resolve, reject) => {
        let out;
        let failed = null;
        const t = idb.transaction(IDB_STORE, 'readwrite');
        const store = t.objectStore(IDB_STORE);
        const g = store.get(KEY);
        g.onsuccess = () => {
          try {
            const base = g.result || readStorage() || this.state;
            const draft = clone(base);
            out = fn(draft); // при исключении — транзакция отменяется (ROLLBACK)
            draft.meta.version = (draft.meta.version || 0) + 1;
            draft.meta.updated_at = new Date().toISOString();
            store.put(draft, KEY);
            out = { value: out, state: draft };
          } catch (e) {
            failed = e;
            try { t.abort(); } catch (_) { /* уже завершена */ }
          }
        };
        t.oncomplete = () => resolve(out);
        t.onabort = () => reject(failed || t.error || new Error('Транзакция отменена'));
        t.onerror = () => { if (!failed) failed = t.error; };
      });
      this.state = result.state;
      writeStorage(result.state); // кэш для быстрого чтения и уведомления других вкладок
      return result.value;
    },

    /** Запасной вариант без IndexedDB: Web Locks + localStorage. */
    async _txFallback(fn) {
      const run = () => {
        const base = readStorage() || this.state;
        const draft = clone(base);
        const result = fn(draft);
        draft.meta.version = (draft.meta.version || 0) + 1;
        draft.meta.updated_at = new Date().toISOString();
        writeStorage(draft);
        this.state = draft;
        return result;
      };
      if (global.navigator && navigator.locks && navigator.locks.request) {
        return navigator.locks.request(KEY, { mode: 'exclusive' }, () => run());
      }
      return run();
    },

    /** Сброс к демонстрационным данным. */
    async reset() {
      const old = this.read();
      this.state = global.Seed.build();
      this.state.meta.version = ((old && old.meta.version) || 0) + 1;
      await this.persist(this.state);
      return this.state;
    },

    exportJson() {
      return JSON.stringify(this.read(), null, 2);
    },

    async importJson(text) {
      const data = JSON.parse(text);
      TABLES.forEach(t => { if (!Array.isArray(data[t])) throw new Error('В файле нет таблицы ' + t); });
      if (!data.meta || !data.seq) throw new Error('Файл не является резервной копией системы');
      const old = this.read();
      data.meta.version = Math.max(data.meta.version || 0, ((old && old.meta.version) || 0) + 1);
      this.state = data;
      await this.persist(data);
    }
  };

  global.DB = DB;
})(typeof window !== 'undefined' ? window : globalThis);
