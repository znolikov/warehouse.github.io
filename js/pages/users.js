/* Управление пользователями (только администратор). Регистрация закрытая. */
(function (global) {
  'use strict';
  const Pages = global.Pages = global.Pages || {};
  const { Api, UI } = global;
  const esc = UI.esc;

  async function edit(u, refresh) {
    const s = Api.state();
    const body = `<form class="form-grid" onsubmit="return false">
      <div><label class="form-label">Логин <span class="req">*</span></label>
        <input class="form-control" name="login" value="${esc(u ? u.login : '')}" ${u ? 'readonly' : ''} maxlength="50" autocomplete="off">
        ${u ? '' : '<div class="form-hint">Латиница, цифры, «_», «.», «-»; уникальный</div>'}</div>
      <div><label class="form-label">Роль <span class="req">*</span></label>
        <select class="form-select" name="role_id">${UI.options(s.roles, u ? u.role_id : '', '— выберите —')}</select></div>
      <div class="span-all"><label class="form-label">ФИО <span class="req">*</span></label>
        <input class="form-control" name="full_name" value="${esc(u ? u.full_name : '')}" maxlength="150"></div>
      ${u ? '' : `<div class="span-all"><label class="form-label">Временный пароль <span class="req">*</span></label>
        <input class="form-control" name="password" type="text" autocomplete="new-password" minlength="6">
        <div class="form-hint">Не менее 6 символов. При первом входе пользователь должен будет сменить пароль.</div></div>`}
    </form>`;
    const ok = await UI.modal({
      title: u ? 'Пользователь: ' + u.login : 'Новый пользователь',
      body,
      buttons: [{ text: 'Отмена', value: null }, { text: 'Сохранить', cls: 'btn-primary', action: async m => {
        const d = UI.formData(m);
        if (u) d.id = u.id;
        await Api.saveUser(d);
        return true;
      } }]
    });
    if (ok) { UI.toast(u ? 'Данные пользователя обновлены' : 'Учётная запись создана'); refresh(); }
  }

  async function reset(u, refresh) {
    const ok = await UI.modal({
      title: 'Сброс пароля: ' + u.login,
      body: `<label class="form-label">Новый временный пароль <span class="req">*</span></label>
        <input class="form-control" name="pw" type="text" autocomplete="new-password">
        <div class="form-hint">Пользователь должен будет сменить его при следующем входе.</div>`,
      buttons: [{ text: 'Отмена', value: null }, { text: 'Сбросить пароль', cls: 'btn-primary', action: async m => { await Api.resetPassword(u.id, m.querySelector('[name=pw]').value); return true; } }]
    });
    if (ok) { UI.toast('Пароль сброшен'); refresh(); }
  }

  Pages.users = {
    title: 'Пользователи',
    perm: 'users.manage',
    render(view) {
      const me = Api.currentUser();
      view.innerHTML = `<div class="card-box"><div class="card-head"><h3>Учётные записи</h3>
        <div class="actions"><button class="btn btn-primary" id="add">+ Создать пользователя</button></div></div>
        <div class="alert-box info">Самостоятельная регистрация отсутствует — учётные записи создаёт администратор. Пароли хранятся только в виде хешей с солью.</div>
        <div id="tbl"></div></div>`;
      const t = new UI.DataTable(view.querySelector('#tbl'), {
        search: { placeholder: 'Поиск по логину или ФИО…', text: r => r.login + ' ' + r.full_name + ' ' + r.role },
        defaultSort: { key: 'login', dir: 'asc' },
        rowClass: r => r.is_active ? '' : 'row-muted',
        columns: [
          { key: 'login', title: 'Логин', render: r => `<span class="mono">${esc(r.login)}</span>${r.id === me.id ? ' <span class="badge-s blue">вы</span>' : ''}` },
          { key: 'full_name', title: 'ФИО' },
          { key: 'role', title: 'Роль' },
          { key: 'is_active', title: 'Статус', render: r => (r.is_active ? '<span class="badge-s green">Активен</span>' : '<span class="badge-s red">Заблокирован</span>') + (r.must_change_password ? ' <span class="badge-s amber">смена пароля</span>' : '') },
          { key: 'created_at', title: 'Создан', render: r => UI.fmtDate(r.created_at) },
          { key: 'last_login_at', title: 'Последний вход', render: r => UI.fmtDateTime(r.last_login_at) },
          { key: 'act', title: '', sortable: false, render: r => `<div class="cell-actions">
            <button class="btn btn-sm btn-outline-primary" data-edit="${r.id}">Изменить</button>
            <button class="btn btn-sm btn-outline-secondary" data-reset="${r.id}">Сброс пароля</button>
            ${r.id === me.id ? '' : r.is_active ? `<button class="btn btn-sm btn-outline-danger" data-block="${r.id}">Блокировать</button>` : `<button class="btn btn-sm btn-success" data-unblock="${r.id}">Разблокировать</button>`}
          </div>` }
        ],
        afterRender(box) {
          const get = id => Api.listUsers().find(u => u.id === Number(id));
          box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(get(b.dataset.edit), refresh));
          box.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => reset(get(b.dataset.reset), refresh));
          box.querySelectorAll('[data-block]').forEach(b => b.onclick = async () => {
            const u = get(b.dataset.block);
            if (!await UI.confirm('Блокировка', `Заблокировать пользователя ${esc(u.full_name)}? Он не сможет войти в систему.`, 'Заблокировать', 'btn-danger')) return;
            try { await Api.setUserActive(u.id, false); UI.toast('Пользователь заблокирован'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
          });
          box.querySelectorAll('[data-unblock]').forEach(b => b.onclick = async () => {
            try { await Api.setUserActive(Number(b.dataset.unblock), true); UI.toast('Пользователь разблокирован'); refresh(); } catch (e) { UI.toast(e.message, 'error'); }
          });
        }
      });
      function refresh() { t.setRows(Api.listUsers()); }
      view.querySelector('#add').onclick = () => edit(null, refresh);
      refresh();
    }
  };
})(window);
