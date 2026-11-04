/* =====================================================================
   Inicio de sesión (web) — simulado en el navegador.
   - Usuarios de SEG-09 (tabla users) de cada empresa; contraseña de demo "DonGuando2026".
   - Segundo factor para los usuarios con 2FA (SEG-06): el código se muestra en una app autenticadora simulada.
   - 5 intentos fallidos bloquean la cuenta (se reactiva en SEG-09). Inicio y fallos quedan en la auditoría (AUD).
   - Recuperación de contraseña con enlace simulado y la política de SEG-06.
   ===================================================================== */
(function () {
  const h = G.ui.h;
  const DEMO_PWD = 'DonGuando2026';
  const MAX_FAILS = 5;
  const A = G.auth = {};
  const hash = s => { let x = 2166136261; for (const ch of 'aycha-salt:' + s) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return 'fnv1a$' + x.toString(16); };
  A.hash = hash;
  A.policy = p => p.length >= (G.param('seg_password_min_length') || 10) && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p);
  const allUsers = () => G.db.raw('users');
  const tenantName = id => (G.db.raw('tenants').find(t => t.id === id) || {}).name || id;
  A.totp = (u, offset = 0) => { const w = Math.floor(Date.now() / 30000) + offset; let x = 2166136261; for (const ch of u.email + ':' + w) { x ^= ch.charCodeAt(0); x = Math.imul(x, 16777619) >>> 0; } return String(x % 1000000).padStart(6, '0'); };
  A.session = () => G.ctx.session || null;
  A.user = () => { const s = A.session(); return s ? allUsers().find(u => u.id === s.user_id) || null : null; };

  /* --- usuarios: contraseña de demo, empresa B y respaldo si PLT no está en el build --- */
  G.seed(95, function seedAuth() {
    for (const u of allUsers()) { if (!u.pwd_hash) u.pwd_hash = hash(DEMO_PWD); if (u.failed_logins == null) u.failed_logins = 0; }
    G.db.touch();
  }, 'auth');

  /* --- iniciar y cerrar sesión --- */
  function audit(u, action, detail) {
    if (!u) return;
    G.db.ensure('audit').push({ id: G.util.uid('aud'), tenant: u.tenant, at: G.date.now(), user: u.name, role: u.role, action, entity: 'users', entity_id: u.id, detail, before: null, after: null });
    G.db.touch();
  }
  /** valida usuario y contraseña; devuelve { user, need2fa } o lanza un error con mensaje para la persona */
  A.check = function (email, pwd) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !pwd) throw new Error('Ingresa tu correo y tu contraseña.');
    const u = allUsers().find(x => (x.email || '').toLowerCase() === e);
    const generic = 'Correo o contraseña incorrectos.';
    if (!u) throw new Error(generic);
    if (u.status === 'INACTIVE') throw new Error('Este usuario fue dado de baja. Si es un error, pide al administrador que lo reactive (SEG-09).');
    if (u.status === 'LOCKED') throw new Error(u.support ? 'El acceso de soporte está revocado. Solo el administrador del sistema puede habilitarlo (RN-PLT-01).' : 'La cuenta está bloqueada por intentos fallidos. El administrador puede reactivarla en SEG-09.');
    if (u.pwd_hash !== hash(pwd)) {
      u.failed_logins = (u.failed_logins || 0) + 1;
      if (u.failed_logins >= MAX_FAILS) { u.status = 'LOCKED'; u.locked_reason = 'Intentos fallidos'; audit(u, 'BLOQUEO', `Cuenta bloqueada tras ${MAX_FAILS} intentos fallidos`); G.db.touch(); throw new Error(`Cuenta bloqueada tras ${MAX_FAILS} intentos fallidos. El administrador puede reactivarla en SEG-09.`); }
      audit(u, 'INICIO_FALLIDO', `Contraseña incorrecta (intento ${u.failed_logins} de ${MAX_FAILS})`); G.db.touch();
      throw new Error(`${generic} Te quedan ${MAX_FAILS - u.failed_logins} intento(s) antes del bloqueo.`);
    }
    return { user: u, need2fa: !!u.twofa_enabled };
  };
  A.verify2fa = (u, code) => { const c = String(code || '').replace(/\s/g, ''); return [-1, 0, 1].some(o => A.totp(u, o) === c); };
  A.start = function (u, opts = {}) {
    u.failed_logins = 0; u.last_login = G.date.now();
    G.ctx.tenant = u.tenant; G.ctx.role = u.role; G.ctx.portalCustomer = u.customer_id || null;
    G.ctx.brand = (u.brands || []).length === 1 ? u.brands[0] : 'ALL'; G.ctx.site = (u.sites || []).length === 1 ? u.sites[0] : 'ALL';
    G.ctx.session = { user_id: u.id, name: u.name, email: u.email, role: u.role, tenant: u.tenant, at: G.date.now(), remember: !!opts.remember, via: opts.via || 'web' };
    audit(u, 'INICIO_SESION', `Inicio de sesión web${opts.via === 'demo' ? ' (cambio rápido de la demo)' : ''}${u.twofa_enabled && opts.via !== 'demo' ? ' con segundo factor' : ''}`);
    G.nav.current = 'HOME'; G.nav.params = {};
    G.db.save(); G.render();
  };
  A.logout = function () {
    const u = A.user(); if (u) audit(u, 'CIERRE_SESION', 'Cierre de sesión');
    G.ctx.session = null; G.ui.closeAll(); G.db.save(); G.render();
  };
  /** entra directo con el primer usuario activo del rol (pruebas y cambio rápido de la demo) */
  A.demoLogin = function (role = 'GERENTE', tenant = 'DG') {
    const u = allUsers().find(x => x.tenant === tenant && x.role === role && x.status === 'ACTIVE') || allUsers().find(x => x.tenant === tenant && x.status === 'ACTIVE');
    if (u) A.start(u, { via: 'demo' });
    return u;
  };
  A.switchUser = function (id) { const u = allUsers().find(x => x.id === id); if (u && u.status === 'ACTIVE') { A.start(u, { via: 'demo' }); G.ui.toast(`Sesión de ${u.name} · ${G.roleName(u.role)}`, 'ok'); } };
  A.usersOf = tenant => allUsers().filter(u => u.tenant === tenant && u.status === 'ACTIVE' && !u.support);

  /* --- pantalla de inicio de sesión --- */
  const st = { step: 'login', email: '', remember: true, user: null, msg: null, tone: 'bad', reset: null };
  A.state = st;
  function field(label, input, hint) { return h('div', { class: 'field' }, h('label', { attrs: { for: input.id } }, label), input, hint ? h('div', { class: 'small muted' }, hint) : null); }
  function brandPanel() {
    return h('section', { class: 'login-brand' },
      h('div', { class: 'login-mark' }, h('span', null, 'DG')),
      h('div', { class: 'login-brand-text' },
        h('b', null, 'Don Guando'),
        h('span', null, 'Comercial · ventas, reparto y producción')),
      h('p', { class: 'login-claim' }, 'Cuy, conejo, aves, cordero, caldos y embutidos de Don Guando y sus 4 marcas: pedidos de WhatsApp, web y TikTok, preparación sin errores, delivery con costo real y comprobantes en un solo lugar.'),
      h('ul', { class: 'login-points' },
        h('li', null, 'Ningún pedido se confirma sin dirección con pin'),
        h('li', null, 'WhatsApp oficial con control de vendedoras'),
        h('li', null, 'Cada empresa ve solo sus datos')),
      h('div', { class: 'login-foot' }, 'Aycha by Intelectalab · prototipo de demostración · datos de ejemplo'));
  }
  function demoAccounts(onPick) {
    const groups = [['Gerencia y administración', ['GERENTE', 'ADMINISTRACION', 'ADMIN_SISTEMA', 'AUDITOR']], ['Ventas y marketing', ['SUPERVISORA_VENTAS', 'VENDEDORA', 'CAJERO', 'MARKETING']], ['Almacén y reparto', ['ALMACENERO', 'PREPARADOR', 'COORDINADOR_DELIVERY', 'REPARTIDOR']], ['Producción, calidad y compras', ['JEFE_PRODUCCION', 'OPERARIO_PRODUCCION', 'CALIDAD', 'COMPRAS']], ['Contabilidad y personal', ['CONTADORA', 'PRACTICANTE_CONTABLE', 'RRHH', 'VISITADOR_CONSIGNACION']], ['Portal y plataforma', ['CLIENTE_B2B', 'SOPORTE_PLATAFORMA']]];
    const box = h('details', { class: 'login-demo' }, h('summary', null, 'Usuarios de demostración ', h('span', { class: 'muted small' }, `(contraseña: ${DEMO_PWD})`)));
    for (const [title, roles] of groups) {
      box.appendChild(h('div', { class: 'login-demo-title' }, title));
      const list = h('div', { class: 'login-demo-list' });
      for (const role of roles) { const u = allUsers().find(x => x.tenant === 'DG' && x.role === role && x.status === 'ACTIVE' && !x.support); if (!u) continue; list.appendChild(h('button', { type: 'button', class: 'login-chip', on: { click: () => onPick(u) } }, h('b', null, G.roleName(role)), h('span', { class: 'mono' }, u.email), u.twofa_enabled ? h('i', null, '2FA') : null)); }
      box.appendChild(list);
    }
    box.appendChild(h('div', { class: 'login-demo-title' }, 'Otra empresa (prueba de aislamiento)'));
    const og = h('div', { class: 'login-demo-list' });
    for (const u of allUsers().filter(x => x.tenant === 'CS' && x.status === 'ACTIVE')) og.appendChild(h('button', { type: 'button', class: 'login-chip', on: { click: () => onPick(u) } }, h('b', null, `${G.roleName(u.role)} · ${tenantName(u.tenant)}`), h('span', { class: 'mono' }, u.email)));
    box.appendChild(og);
    return box;
  }
  function msgBox() { return st.msg ? h('div', { class: 'notice ' + st.tone, attrs: { role: 'alert' } }, st.msg) : null; }
  function loginForm(card) {
    const email = h('input', { class: 'input', type: 'email', value: st.email, placeholder: 'tu.correo@donguando.pe', attrs: { id: 'lg-email', autocomplete: 'username', required: true } });
    const pwd = h('input', { class: 'input', type: 'password', placeholder: '••••••••••', attrs: { id: 'lg-pwd', autocomplete: 'current-password', required: true } });
    const show = h('button', { type: 'button', class: 'btn ghost sm login-eye', attrs: { 'aria-label': 'Mostrar contraseña' }, on: { click: () => { pwd.type = pwd.type === 'password' ? 'text' : 'password'; show.textContent = pwd.type === 'password' ? 'Mostrar' : 'Ocultar'; } } }, 'Mostrar');
    const rem = h('input', { type: 'checkbox', checked: st.remember, attrs: { id: 'lg-rem' } });
    const form = h('form', { class: 'login-form', attrs: { novalidate: true } },
      h('h1', null, 'Iniciar sesión'),
      h('p', { class: 'muted' }, 'Ingresa con el correo que te registró el administrador.'),
      msgBox(),
      field('Correo', email),
      h('div', { class: 'field' }, h('label', { attrs: { for: 'lg-pwd' } }, 'Contraseña'), h('div', { class: 'login-pwd' }, pwd, show)),
      h('div', { class: 'row between' }, h('label', { class: 'check' }, rem, h('span', null, 'Mantener la sesión en este equipo')), h('button', { type: 'button', class: 'linklike', on: { click: () => { st.step = 'forgot'; st.email = email.value; st.msg = null; draw(card); } } }, '¿Olvidaste tu contraseña?')),
      h('button', { class: 'btn primary login-submit', type: 'submit' }, 'Ingresar'));
    form.addEventListener('submit', e => {
      e.preventDefault(); st.email = email.value; st.remember = rem.checked;
      try {
        const r = A.check(email.value, pwd.value);
        st.msg = null;
        if (r.need2fa) { st.user = r.user; st.step = '2fa'; draw(card); }
        else A.start(r.user, { remember: st.remember });
      } catch (err) { st.msg = err.message; st.tone = /bloquead|baja|revocado/.test(err.message) ? 'warn' : 'bad'; draw(card); setTimeout(() => { const p = document.getElementById('lg-pwd'); if (p) p.focus(); }, 0); }
    });
    form.appendChild(demoAccounts(u => { st.email = u.email; st.msg = null; draw(card); const p = document.getElementById('lg-pwd'); if (p) { p.value = DEMO_PWD; } }));
    return form;
  }
  function twofaForm(card) {
    const u = st.user;
    const code = h('input', { class: 'input login-code', inputmode: 'numeric', maxlength: 6, placeholder: '000000', attrs: { id: 'lg-code', autocomplete: 'one-time-code', 'aria-label': 'Código de 6 dígitos' } });
    const form = h('form', { class: 'login-form', attrs: { novalidate: true } },
      h('h1', null, 'Verificación en dos pasos'),
      h('p', { class: 'muted' }, `Hola, ${u.name.split(' ')[0]}. Tu rol exige segundo factor: escribe el código de 6 dígitos de tu app autenticadora.`),
      msgBox(),
      field('Código', code),
      h('div', { class: 'login-totp', attrs: { 'aria-live': 'polite' } }, h('span', { class: 'small muted' }, 'App autenticadora (simulada para la demo)'), h('b', { class: 'mono' }, A.totp(u)), h('span', { class: 'small muted' }, 'Aycha · ' + u.email)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Verificar e ingresar'), h('button', { type: 'button', class: 'btn ghost', on: { click: () => { st.step = 'login'; st.user = null; st.msg = null; draw(card); } } }, 'Volver')));
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (A.verify2fa(u, code.value)) { st.step = 'login'; st.msg = null; A.start(u, { remember: st.remember }); }
      else { audit(u, 'INICIO_FALLIDO', 'Código de segundo factor incorrecto'); st.msg = 'El código no es válido o ya venció. Usa el código vigente de tu app.'; st.tone = 'bad'; draw(card); }
    });
    setTimeout(() => code.focus(), 0);
    return form;
  }
  function forgotForm(card) {
    const email = h('input', { class: 'input', type: 'email', value: st.email, attrs: { id: 'lg-femail', autocomplete: 'username' } });
    const form = h('form', { class: 'login-form', attrs: { novalidate: true } },
      h('h1', null, 'Recuperar contraseña'),
      h('p', { class: 'muted' }, 'Te enviaremos un enlace para crear una nueva contraseña. Vence en 30 minutos.'),
      msgBox(),
      field('Correo', email),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Enviar enlace'), h('button', { type: 'button', class: 'btn ghost', on: { click: () => { st.step = 'login'; st.msg = null; draw(card); } } }, 'Volver')));
    form.addEventListener('submit', e => {
      e.preventDefault(); st.email = email.value;
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.value.trim())) { st.msg = 'Escribe un correo válido.'; st.tone = 'bad'; draw(card); return; }
      const u = allUsers().find(x => (x.email || '').toLowerCase() === email.value.trim().toLowerCase() && x.status !== 'INACTIVE');
      st.reset = u ? { user_id: u.id, token: G.util.token ? G.util.token(16) : String(Math.random()).slice(2, 18) } : null;
      st.step = 'sent'; st.msg = null; draw(card);
    });
    return form;
  }
  function sentView(card) {
    return h('div', { class: 'login-form' },
      h('h1', null, 'Revisa tu correo'),
      h('p', { class: 'muted' }, `Si ${st.email} está registrado, le enviamos un enlace para crear una nueva contraseña. Por seguridad, el mensaje es el mismo exista o no la cuenta.`),
      st.reset ? h('div', { class: 'notice info' }, h('b', null, 'Demo: '), 'el correo no se envía de verdad. ', h('button', { type: 'button', class: 'linklike', on: { click: () => { st.step = 'newpwd'; draw(card); } } }, 'Abrir el enlace del correo')) : null,
      h('button', { type: 'button', class: 'btn ghost', on: { click: () => { st.step = 'login'; draw(card); } } }, 'Volver al inicio de sesión'));
  }
  function newPwdForm(card) {
    const u = st.reset && allUsers().find(x => x.id === st.reset.user_id);
    const p1 = h('input', { class: 'input', type: 'password', attrs: { id: 'lg-n1', autocomplete: 'new-password' } });
    const p2 = h('input', { class: 'input', type: 'password', attrs: { id: 'lg-n2', autocomplete: 'new-password' } });
    const form = h('form', { class: 'login-form', attrs: { novalidate: true } },
      h('h1', null, 'Nueva contraseña'),
      h('p', { class: 'muted' }, u ? `Para ${u.email}.` : ''),
      msgBox(),
      field('Nueva contraseña', p1, 'Mínimo 10 caracteres, con mayúscula, minúscula y número.'),
      field('Repite la contraseña', p2),
      h('button', { class: 'btn primary', type: 'submit' }, 'Guardar y volver a ingresar'));
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!A.policy(p1.value)) { st.msg = 'La contraseña debe tener mínimo 10 caracteres, con mayúscula, minúscula y número.'; st.tone = 'bad'; draw(card); return; }
      if (p1.value !== p2.value) { st.msg = 'Las contraseñas no coinciden.'; st.tone = 'bad'; draw(card); return; }
      u.pwd_hash = hash(p1.value); u.failed_logins = 0; if (u.status === 'LOCKED' && !u.support) u.status = 'ACTIVE';
      audit(u, 'SEGURIDAD', 'Contraseña restablecida con enlace de recuperación'); G.db.touch();
      st.step = 'login'; st.email = u.email; st.reset = null; st.msg = 'Contraseña actualizada. Ingresa con la nueva.'; st.tone = 'ok'; draw(card);
    });
    return form;
  }
  function draw(card) {
    G.ui.clear(card);
    const f = { login: loginForm, '2fa': twofaForm, forgot: forgotForm, sent: sentView, newpwd: newPwdForm }[st.step] || loginForm;
    card.appendChild(f(card));
  }
  A.renderLogin = function (app) {
    app.className = 'login';
    const card = h('section', { class: 'login-card', attrs: { 'aria-label': 'Inicio de sesión' } });
    app.append(brandPanel(), h('div', { class: 'login-side' }, card));
    draw(card);
    setTimeout(() => { const e = document.getElementById(st.email ? 'lg-pwd' : 'lg-email'); if (e && st.step === 'login') e.focus(); }, 0);
  };

  /* --- menú del usuario en la barra superior --- */
  A.userMenu = function () {
    const u = A.user() || { name: G.ctx.userName(), email: '', role: G.ctx.role };
    const ini = u.name.replace(/^(Dra?|Ing)\.\s*/, '').split(' ').map(x => x[0]).slice(0, 2).join('');
    return h('button', { class: 'user-btn', title: 'Mi cuenta', attrs: { 'aria-label': 'Mi cuenta: ' + u.name, id: 'user-btn' }, on: { click: () => A.accountPanel() } }, h('span', { class: 'avatar' }, ini), h('span', { class: 'user-txt hide-sm' }, h('b', null, u.name), h('span', null, G.roleName(G.ctx.role))));
  };
  A.accountPanel = function () {
    const u = A.user();
    G.ui.drawer('Mi sesión', bd => {
      bd.appendChild(G.ui.dl([['Usuario', u ? u.name : G.ctx.userName()], ['Correo', u ? u.email : '—'], ['Rol', G.roleName(G.ctx.role)], ['Empresa', tenantName(G.ctx.tenant)], ['Marcas', u && (u.brands || []).length ? u.brands.map(G.brandName).join(', ') : 'Todas'], ['Locales', u && (u.sites || []).length ? u.sites.map(G.siteName).join(', ') : 'Todos'], ['Segundo factor', u && u.twofa_enabled ? 'Activo' : 'No activo'], ['Sesión iniciada', A.session() ? G.fmt.datetime ? G.fmt.datetime(A.session().at) : A.session().at.replace('T', ' ').slice(0, 16) : '—']]));
      const row = h('div', { class: 'row' });
      if (G.screens['SEG-06']) row.appendChild(G.ui.btn('Mi cuenta (SEG-06)', () => { G.ui.closeAll(); G.go('SEG-06'); }));
      row.appendChild(G.ui.btn('Cerrar sesión', () => A.logout(), { kind: 'danger' }));
      bd.appendChild(row);
      // cambio rápido de usuario (solo demo)
      const sel = h('select', { class: 'input', attrs: { id: 'demo-user', 'aria-label': 'Cambiar de usuario' } }, A.usersOf(G.ctx.tenant).map(x => h('option', { value: x.id, selected: u && x.id === u.id }, `${x.name} · ${G.roleName(x.role)}`)));
      sel.addEventListener('change', () => { G.ui.closeAll(); A.switchUser(sel.value); });
      bd.appendChild(h('div', { class: 'stack', style: 'margin-top:12px' }, h('div', { class: 'notice info' }, 'Demo: cambia de usuario sin volver a escribir la contraseña para recorrer los permisos de cada rol.'), sel));
    });
  };
})();

/* ---------- pruebas del inicio de sesión ---------- */
(function () {
  const A = G.auth; const assert = (c, m) => { if (!c) throw new Error(m); };
  const T = (name, fn) => G.tests.push({ module: 'SEG', name, fn: async () => { try { await fn(); } finally { G.ctx.session = null; A.demoLogin('GERENTE'); } } });
  T('Inicio de sesión: contraseña incorrecta avisa los intentos y a los 5 bloquea la cuenta (RN-SEG en auditoría)', async () => {
    const u = G.db.raw('users').find(x => x.tenant === 'DG' && x.role === 'ALMACENERO' && x.status === 'ACTIVE');
    let m = ''; try { A.check(u.email, 'mala-clave'); } catch (e) { m = e.message; }
    assert(/4 intento/.test(m), 'Debe avisar los intentos restantes: ' + m);
    for (let i = 0; i < 4; i++) { try { A.check(u.email, 'mala-clave'); } catch (e) { m = e.message; } }
    assert(u.status === 'LOCKED' && /bloqueada/.test(m), 'A los 5 intentos debe bloquear');
    let m2 = ''; try { A.check(u.email, 'DonGuando2026'); } catch (e) { m2 = e.message; } assert(/bloqueada/.test(m2), 'Bloqueada no entra ni con la clave correcta');
    assert(G.db.raw('audit').some(a => a.entity_id === u.id && a.action === 'BLOQUEO'), 'Falta el registro de auditoría');
  });
  T('Inicio de sesión: el gerente necesita segundo factor y entra con el código vigente', async () => {
    const u = G.db.raw('users').find(x => x.tenant === 'DG' && x.role === 'GERENTE');
    const r = A.check(u.email, 'DonGuando2026'); assert(r.need2fa, 'El gerente debe pedir 2FA');
    assert(!A.verify2fa(u, '000000') || A.totp(u) === '000000', 'Un código cualquiera no debe valer');
    assert(A.verify2fa(u, A.totp(u)), 'El código vigente debe valer');
    G.ctx.session = null; A.start(u); assert(G.ctx.session && G.ctx.session.user_id === u.id && G.ctx.role === 'GERENTE', 'No inició la sesión');
  });
  T('Inicio de sesión: un usuario de Carnes Selectas del Sur SAC entra a su empresa y no ve datos de Don Guando', async () => {
    const u = G.db.raw('users').find(x => x.tenant === 'CS' && x.role === 'GERENTE');
    const r = A.check(u.email, 'DonGuando2026'); G.ctx.session = null; A.start(r.user);
    assert(G.ctx.tenant === 'CS', 'Debe entrar a su empresa');
    assert(!G.db.all('sales_orders').some(o => o.brand_id === 'br-DG') && !G.db.all('customers').some(c => c.id === 'cu-0001'), 'Ve datos de Don Guando');
    A.logout(); assert(!G.ctx.session && document.querySelector('.login-card'), 'Cerrar sesión debe mostrar el inicio de sesión');
  });
  T('Recuperar contraseña: la nueva clave cumple la política y permite ingresar', async () => {
    const u = G.db.raw('users').find(x => x.tenant === 'DG' && x.role === 'VENDEDORA');
    assert(!A.policy('corta1A') && !A.policy('sinnumeroMayus') && A.policy('NuevaClave2026'), 'Política de contraseña');
    u.pwd_hash = A.hash('NuevaClave2026');
    assert(A.check(u.email, 'NuevaClave2026').user === u, 'Debe entrar con la nueva clave');
  });
})();
