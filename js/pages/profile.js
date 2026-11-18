/* Профиль пользователя и смена пароля. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  Pages.profile = {
    title: 'Профиль',
    perm: 'profile',
    render(view, params, user) {
      view.innerHTML = `
        ${user.must_change_password ? '<div class="alert-box warn"><b>Требуется смена пароля.</b> Вы вошли с временным паролем, назначенным администратором. Установите собственный пароль, чтобы продолжить работу.</div>' : ''}
        <div class="grid-2">
          <div class="card-box"><div class="card-head"><h3>Учётная запись</h3></div>
            <div class="doc-summary"><dl>
              <dt>ФИО</dt><dd>${esc(user.full_name)}</dd>
              <dt>Логин</dt><dd class="mono">${esc(user.login)}</dd>
              <dt>Роль</dt><dd>${esc(user.role)}</dd>
              <dt>Создана</dt><dd>${UI.fmtDate(user.created_at)}</dd>
              <dt>Последний вход</dt><dd>${UI.fmtDateTime(user.last_login_at)}</dd>
            </dl></div>
            <h4 style="margin:6px 0 8px">Доступные действия роли</h4>
            <ul class="perm-list">${Object.entries({
              'dashboard': 'Личный дашборд', 'users.manage': 'Управление пользователями и ролями', 'dict.manage': 'Управление справочниками',
              'components.edit': 'Создание и изменение комплектующих', 'stock.view': 'Просмотр остатков', 'ops.create': 'Создание и проведение операций',
              'ops.view': 'Просмотр истории операций', 'audit.view': 'Журнал действий пользователей', 'reports': 'Формирование отчётов', 'export': 'Экспорт в Excel'
            }).map(([p, t]) => `<li><span class="perm-mark ${Api.can(p) ? 'yes' : 'no'}">${Api.can(p) ? 'да' : 'нет'}</span> ${esc(t)}</li>`).join('')}</ul>
          </div>
          <div class="card-box"><div class="card-head"><h3>Смена пароля</h3></div>
            <form id="pw-form" novalidate>
              <div class="mb-3"><label class="form-label">Текущий пароль <span class="req">*</span></label><input type="password" class="form-control" name="old" autocomplete="current-password"></div>
              <div class="mb-3"><label class="form-label">Новый пароль <span class="req">*</span></label><input type="password" class="form-control" name="new1" autocomplete="new-password"><div class="form-hint">Не менее 6 символов</div></div>
              <div class="mb-3"><label class="form-label">Повторите новый пароль <span class="req">*</span></label><input type="password" class="form-control" name="new2" autocomplete="new-password"></div>
              <div id="pw-err" hidden></div>
              <button class="btn btn-primary" type="submit">Сменить пароль</button>
            </form></div>
        </div>`;
      const form = view.querySelector('#pw-form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const err = view.querySelector('#pw-err');
        err.hidden = true;
        if (form.new1.value !== form.new2.value) {
          UI.showError(err, new Api.ApiError('Новый пароль и подтверждение не совпадают'));
          return;
        }
        try {
          await Api.changePassword(form.old.value, form.new1.value);
          form.reset();
          UI.toast('Пароль изменён');
          if (user.must_change_password) location.hash = '#/dashboard';
          else global.App.route();
        } catch (ex) { UI.showError(err, ex); }
      });
    }
  };
})(window);
