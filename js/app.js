/* Точка входа: маршрутизация (hash-router), каркас, авторизация. */
(function (global) {
  'use strict';

  const { Api, UI, DB } = global;
  const Pages = global.Pages;
  const esc = UI.esc;

  const NAV = [
    { route: 'dashboard', icon: 'home', title: 'Главная', perm: 'dashboard' },
    { route: 'operations', icon: 'docs', title: 'Операции', perm: 'ops.view' },
    { route: 'stock', icon: 'warehouse', title: 'Склад', perm: 'stock.view' },
    { route: 'components', icon: 'box', title: 'Номенклатура', perm: 'components.view' },
    { route: 'reports', icon: 'chart', title: 'Отчёты', perm: 'reports' },
    { route: 'directories', icon: 'book', title: 'Справочники', perm: 'dict.manage' },
    { route: 'users', icon: 'users', title: 'Пользователи', perm: 'users.manage' },
    { route: 'audit', icon: 'shield', title: 'Аудит', perm: 'audit.view' },
    { route: 'history', icon: 'clock', title: 'История', perm: 'ops.view' },
    { sep: true },
    { route: 'profile', icon: 'user', title: 'Профиль', perm: 'profile' }
  ];

  /** Разбор адреса → страница и параметры. */
  function resolve(hash) {
    const [path, qs] = hash.replace(/^#\/?/, '').split('?');
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [a, b, c] = parts;
    const r = resolvePath(a, b, c);
    r.params = Object.assign({}, query, r.params || {});
    return r;
  }

  function resolvePath(a, b, c) {
    switch (a) {
      case undefined: case '': case 'dashboard': return { page: 'dashboard', nav: 'dashboard' };
      case 'operations':
        if (b === 'new') return { page: 'operationForm', nav: 'operations', params: { type: c } };
        if (b === 'edit') return { page: 'operationForm', nav: 'operations', params: { id: Number(c) } };
        if (b) return { page: 'operationView', nav: 'operations', params: { id: Number(b) } };
        return { page: 'operations', nav: 'operations' };
      default:
        if (Pages[a] && typeof Pages[a].render === 'function' && !['operationForm', 'operationView', 'notFound'].includes(a)) return { page: a, nav: a };
        return { page: 'notFound', nav: null };
    }
  }

  function renderNav(user, active) {
    const nav = document.getElementById('nav');
    nav.innerHTML = NAV.filter(n => n.sep || Api.can(n.perm)).map(n => n.sep ? '<div class="nav-sep"></div>' :
      `<a href="#/${n.route}" class="nav-item ${n.route === active ? 'active' : ''}"><span class="nav-ico">${Icons.icon(n.icon)}</span> ${esc(n.title)}</a>`).join('');
    const pill = document.getElementById('role-pill');
    pill.textContent = user.role;
    pill.className = 'role-pill ' + (user.role === Api.ROLES.STORE ? 'role-store' : user.role === Api.ROLES.MANAGER ? 'role-manager' : '');
    document.getElementById('user-name').textContent = UI.shortName(user.full_name);
  }

  function showLogin() {
    document.getElementById('boot').hidden = true;
    document.getElementById('app-screen').hidden = true;
    document.getElementById('login-screen').hidden = false;
    document.title = 'Вход — ИС учёта комплектующих';
    setTimeout(() => document.getElementById('login-input').focus(), 30);
  }

  let currentRoute = null;

  async function route() {
    const user = Api.currentUser();
    if (!user) {
      if (location.hash && location.hash !== '#/login') sessionStorage.setItem('ic_after_login', location.hash);
      showLogin();
      return;
    }
    document.getElementById('boot').hidden = true;
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    document.body.classList.remove('nav-open');

    let r = resolve(location.hash);
    if (user.must_change_password && r.page !== 'profile') {
      location.replace('#/profile');
      return;
    }
    currentRoute = r;
    renderNav(user, r.nav);
    UI.destroyCharts();
    const view = document.getElementById('view');
    const page = Pages[r.page] || Pages.notFound;
    // проверка прав при каждом переходе (дублирует проверку в слое Api)
    if (page.perm && !Api.can(page.perm)) {
      UI.setTitle('Отсутствие доступа');
      view.innerHTML = Pages.forbiddenHtml(user);
      return;
    }
    UI.setTitle(page.title || '');
    try {
      await page.render(view, r.params || {}, user);
    } catch (err) {
      if (err && err.code === 403) { UI.setTitle('Отсутствие доступа'); view.innerHTML = Pages.forbiddenHtml(user); return; }
      if (err && err.code === 401) { showLogin(); return; }
      view.innerHTML = UI.errorHtml(err);
    }
    window.scrollTo(0, 0);
  }

  Pages.forbiddenHtml = function (user) {
    return `<div class="card-box empty-state">
      <div class="big-code">403</div>
      <h3 style="margin:10px 0">Отсутствие доступа</h3>
      <p>Раздел или действие недоступны для роли «${esc(user.role)}». Проверьте роль и обратитесь к администратору.</p>
      <a class="btn btn-primary" href="#/dashboard">На главную</a></div>`;
  };

  Pages.notFound = {
    title: 'Страница не найдена',
    render(view) {
      view.innerHTML = `<div class="card-box empty-state"><div class="big-code">404</div>
        <h3 style="margin:10px 0">Страница не найдена</h3><a class="btn btn-primary" href="#/dashboard">На главную</a></div>`;
    }
  };

  function bindLogin() {
    const form = document.getElementById('login-form');
    const errBox = document.getElementById('login-error');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      errBox.hidden = true;
      const login = form.login.value.trim();
      const password = form.password.value;
      form.login.classList.toggle('is-invalid', !login);
      form.password.classList.toggle('is-invalid', !password);
      if (!login || !password) {
        errBox.textContent = 'Заполните обязательные поля: логин и пароль.';
        errBox.hidden = false;
        return;
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const user = await Api.login(login, password);
        form.reset();
        UI.toast('Добро пожаловать, ' + UI.shortName(user.full_name) + '!');
        const after = sessionStorage.getItem('ic_after_login');
        sessionStorage.removeItem('ic_after_login');
        if (after && after !== location.hash) location.hash = after;
        else if (!location.hash || location.hash === '#/login') location.hash = '#/dashboard';
        else route();
      } catch (err) {
        errBox.textContent = err.message || 'Ошибка входа';
        errBox.hidden = false;
        form.password.value = '';
        form.password.focus();
      } finally {
        btn.disabled = false;
      }
    });
    form.querySelectorAll('[data-fill]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const [l, p] = a.dataset.fill.split('|');
      form.login.value = l;
      form.password.value = p;
    }));
  }

  async function logout(e) {
    if (e) e.preventDefault();
    await Api.logout();
    UI.destroyCharts();
    document.getElementById('view').innerHTML = '';
    location.hash = '#/login';
    showLogin();
  }

  async function init() {
    document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = Icons.icon(el.dataset.icon, el.dataset.icon === 'menu' ? 22 : 18); });
    try { await DB.init(); } catch (e) { console.error(e); document.getElementById('boot').textContent = 'Не удалось открыть хранилище данных браузера.'; return; }
    bindLogin();
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('logout-top').addEventListener('click', logout);
    document.getElementById('burger').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    document.getElementById('sidebar-backdrop').addEventListener('click', () => document.body.classList.remove('nav-open'));
    window.addEventListener('hashchange', route);
    // изменения из другой вкладки: обновить экран (кроме открытых форм)
    window.addEventListener('storage', e => {
      if (e.key !== DB.KEY) return;
      DB.read();
      if (!Api.currentUser()) { route(); return; }
      if (currentRoute && currentRoute.page !== 'operationForm' && !document.querySelector('.modal-backdrop-x')) route();
    });
    route();
  }

  global.App = { route, logout };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
