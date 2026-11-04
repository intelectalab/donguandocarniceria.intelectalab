/* =====================================================================
   CRMX · CRM de la vendedora (v1.2): pestañas por red en la bandeja
   (WhatsApp, Instagram, TikTok, Messenger), leads en tablero kanban con
   arrastre y tareas en lista, kanban y agenda, con «encargar actividad»
   de la supervisora a las vendedoras. Envuelve CRM-01, CRM-05 y CRM-17.
   ===================================================================== */
(function () {
  const { h, btn, badge, drawer, toast, pills } = G.ui;
  const db = G.db, F = G.fmt;
  const C = G.crm;
  const KINDS = [['', 'Todas las redes'], ['WHATSAPP', 'WhatsApp'], ['INSTAGRAM', 'Instagram'], ['TIKTOK', 'TikTok'], ['MESSENGER', 'Messenger']];
  const ICON = { WHATSAPP: 'WA', INSTAGRAM: 'IG', TIKTOK: 'TT', MESSENGER: 'FB' };
  const me = () => G.ctx.userId();
  const isSup = () => ['SUPERVISORA_VENTAS', 'GERENTE'].includes(G.ctx.role);
  const V = { leads: 'KANBAN', tasks: 'KANBAN' };
  const tryAct = (fn, ok) => { try { const r = fn(); if (ok) toast(ok, 'ok'); G.refresh(); return r; } catch (e) { toast(e.message, 'bad'); return null; } };

  /* ---------- CRM-01: pestañas por red ---------- */
  const base01 = G.screens['CRM-01'].render;
  G.screens['CRM-01'].render = function (el, params) {
    base01(el, params);
    const sel = Array.from(el.querySelectorAll('select')).find(s => s.options[0] && /^Red:/.test(s.options[0].text));
    if (!sel) return;
    const ids = new Set(C.channelsFor().map(c => c.id));
    const open = db.where('conversations', c => c.status !== 'CLOSED' && ids.has(c.channel_id));
    const kindOf = c => (C.chan(c.channel_id) || {}).kind;
    const mine = c => c.assigned_user_id === me();
    const tabs = h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:10px' }, KINDS.filter(([k]) => !k || C.channelsFor().some(c => c.kind === k)).map(([k, l]) => {
      const rows = open.filter(c => !k || kindOf(c) === k); const m = rows.filter(mine).length;
      const on = (sel.value || '') === k;
      return btn(`${l} · ${rows.length}${m ? ` (${m} mías)` : ''}`, () => { sel.value = k; sel.dispatchEvent(new Event('change', { bubbles: true })); }, { sm: true, kind: on ? 'primary' : '' });
    }));
    const host = sel.closest('.card') || sel.parentNode;
    host.insertBefore(tabs, host.firstChild);
  };

  /* ---------- CRM-05: leads en lista o kanban ---------- */
  const LCOLS = [['NEW', 'Nuevo'], ['CONTACTED', 'Contactado'], ['QUALIFIED', 'Calificado'], ['WON', 'Ganado'], ['LOST', 'Perdido']];
  const base05 = G.screens['CRM-05'].render;
  G.screens['CRM-05'].render = function (el, params) {
    base05(el, params);
    const tbl = el.querySelector('.tbl-box'); if (!tbl) return;
    const toggle = pills([['KANBAN', 'Kanban'], ['LIST', 'Lista']], V.leads, v => { V.leads = v; G.refresh(); });
    tbl.parentNode.insertBefore(h('div', { class: 'row between', style: 'margin:10px 0' }, toggle, h('span', { class: 'small muted' }, V.leads === 'KANBAN' ? 'Arrastra una tarjeta a otra columna o usa sus botones. «Ganado» solo con un pedido desde el chat.' : '')), tbl);
    if (V.leads !== 'KANBAN') return;
    tbl.style.display = 'none';
    const chIds = new Set(C.channelsFor().map(c => c.id));
    const rows = db.where('leads', l => (!l.channel_id || chIds.has(l.channel_id)) && G.scope.ok(l, { site: '_none' }));
    const canM = G.can('crm.lead.manage');
    const move = (id, to) => {
      if (to === 'WON') return toast('Un lead se gana solo cuando se crea su pedido desde el chat.', 'warn');
      if (to === 'LOST') return G.go('CRM-05', { id });
      tryAct(() => C.setLeadStatus(id, to), 'Lead movido');
    };
    const card = l => {
      const cv = db.find('conversations', c => c.lead_id === l.id);
      const owner = l.owner_user_id || (cv || {}).assigned_user_id;
      const c = h('div', { class: 'card', attrs: { draggable: canM && !['WON', 'LOST'].includes(l.status) ? 'true' : 'false' }, style: 'padding:8px;margin-bottom:8px;cursor:pointer;display:grid;gap:4px', on: { click: () => G.go('CRM-05', { id: l.id }), dragstart: e => e.dataTransfer.setData('text/plain', l.id) } },
        h('div', { class: 'row between' }, h('b', null, l.full_name || l.phone || 'Contacto'), badge(ICON[l.source] || '', 'info')),
        h('span', { class: 'small muted' }, `${G.brandName(l.brand_id)}${l.ad_code ? ' · ' + l.ad_code : ''}`),
        h('span', { class: 'small' }, `${G.userShort(owner)} · ${F.datetime(l.first_contact_at)}`),
        l.lost_reason ? h('span', { class: 'small muted' }, (C.LABELS.LOST.find(x => x[0] === l.lost_reason) || [, l.lost_reason])[1]) : null,
        canM && ['NEW', 'CONTACTED', 'QUALIFIED'].includes(l.status) ? h('div', { class: 'row', style: 'gap:4px' }, cv ? btn('Chat', () => G.go('CRM-02', { id: cv.id }), { sm: true }) : null,
          l.status !== 'QUALIFIED' ? btn(l.status === 'NEW' ? 'Contactado' : 'Calificado', () => move(l.id, l.status === 'NEW' ? 'CONTACTED' : 'QUALIFIED'), { sm: true, kind: 'primary' }) : null) : null);
      return c;
    };
    const board = h('div', { style: 'display:grid;grid-template-columns:repeat(5,minmax(190px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px' }, LCOLS.map(([k, l]) => {
      const items = rows.filter(x => x.status === k).sort((a, b) => b.first_contact_at.localeCompare(a.first_contact_at));
      const col = h('div', { style: 'background:var(--surface-2);border-radius:10px;padding:8px;min-height:120px', on: { dragover: e => e.preventDefault(), drop: e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, k); } } },
        h('div', { class: 'row between', style: 'margin-bottom:8px' }, h('b', null, l), badge(String(items.length), k === 'WON' ? 'ok' : k === 'LOST' ? 'bad' : '')),
        ...items.slice(0, 25).map(card), items.length > 25 ? h('span', { class: 'small muted' }, `y ${items.length - 25} más en la lista`) : null);
      return col;
    }));
    tbl.parentNode.insertBefore(board, tbl);
  };

  /* ---------- CRM-17: tareas en lista, kanban y agenda ---------- */
  const TASK = C.LABELS.TASK;
  const base17 = G.screens['CRM-17'].render;
  G.screens['CRM-17'].render = function (el, params) {
    base17(el, params);
    const tbl = el.querySelector('.tbl-box'); if (!tbl) return;
    const now = C.now();
    const all = db.where('crm_tasks', t => (!t.brand_id || G.scope.ok(t, { site: '_none' })));
    const rows = all.filter(t => isSup() ? true : t.assigned_user_id === me());
    const mineOnly = isSup() ? null : null;
    const who = u => G.userShort(u) || 'Sin asignar';
    const bar = h('div', { class: 'row between', style: 'margin:10px 0;gap:8px;flex-wrap:wrap' },
      pills([['KANBAN', 'Kanban'], ['AGENDA', 'Agenda'], ['LIST', 'Lista']], V.tasks, v => { V.tasks = v; G.refresh(); }),
      btn(isSup() ? 'Encargar actividad' : 'Nueva actividad', () => assignDrawer(), { kind: 'primary', sm: true }));
    tbl.parentNode.insertBefore(bar, tbl);
    if (V.tasks === 'LIST') return;
    tbl.style.display = 'none';
    const open = rows.filter(t => t.status === 'OPEN');
    const tomorrow = G.date.add(G.TODAY, 1);
    const cols = V.tasks === 'KANBAN'
      ? [['Vencidas', open.filter(t => t.due_at < now), 'bad'], ['Hoy', open.filter(t => t.due_at >= now && t.due_at.slice(0, 10) === G.TODAY), 'warn'], ['Próximos días', open.filter(t => t.due_at.slice(0, 10) > G.TODAY), ''], ['Hechas', rows.filter(t => t.status === 'DONE').slice(-20), 'ok']]
      : [['Hoy', open.filter(t => t.due_at.slice(0, 10) <= G.TODAY), 'warn'], ['Mañana', open.filter(t => t.due_at.slice(0, 10) === tomorrow), ''], ['Resto de la semana', open.filter(t => t.due_at.slice(0, 10) > tomorrow && t.due_at.slice(0, 10) <= G.date.add(G.TODAY, 7)), ''], ['Más adelante', open.filter(t => t.due_at.slice(0, 10) > G.date.add(G.TODAY, 7)), '']];
    const card = t => h('div', { class: 'card', style: 'padding:8px;margin-bottom:8px;display:grid;gap:4px' },
      h('div', { class: 'row between' }, h('b', null, TASK[t.task_type] || t.task_type), badge(F.datetime(t.due_at).slice(0, 16), t.status === 'OPEN' && t.due_at < now ? 'bad' : '')),
      h('span', { class: 'small' }, t.customer_id ? G.custName(t.customer_id) : t.conversation_id ? C.contactName(C.conv(t.conversation_id)) : '—'),
      t.note ? h('span', { class: 'small muted' }, t.note) : null,
      h('span', { class: 'small muted' }, `${who(t.assigned_user_id)}${t.assigned_by ? ' · encargada por ' + G.userShort(t.assigned_by) : ''}`),
      t.status === 'DONE' ? h('span', { class: 'small' }, 'Resultado: ' + (t.result || '—')) : h('div', { class: 'row', style: 'gap:4px' },
        t.conversation_id ? btn('Abrir chat', () => G.go('CRM-02', { id: t.conversation_id }), { sm: true }) : null,
        btn('Completar', () => doneDrawer(t), { sm: true, kind: 'primary' })));
    tbl.parentNode.insertBefore(h('div', { style: 'display:grid;grid-template-columns:repeat(4,minmax(200px,1fr));gap:10px;overflow-x:auto;padding-bottom:8px' }, cols.map(([l, items, tone]) =>
      h('div', { style: 'background:var(--surface-2);border-radius:10px;padding:8px;min-height:120px' }, h('div', { class: 'row between', style: 'margin-bottom:8px' }, h('b', null, l), badge(String(items.length), tone)), ...items.sort((a, b) => a.due_at.localeCompare(b.due_at)).map(card)))), tbl);
  };
  function doneDrawer(t) {
    drawer('Completar tarea', (b, close) => {
      const res = h('input', { class: 'input', placeholder: 'Resultado (obligatorio)', attrs: { 'aria-label': 'Resultado' } });
      b.append(h('div', { class: 'stack' }, h('b', null, TASK[t.task_type] || t.task_type), res, btn('Marcar hecha', () => { if (tryAct(() => C.completeTask(t.id, res.value), 'Tarea completada')) close(); }, { kind: 'primary' })));
    });
  }
  function assignDrawer() {
    drawer(isSup() ? 'Encargar actividad' : 'Nueva actividad', (b, close) => {
      const users = db.all('users').filter(u => u.role === 'VENDEDORA' && u.status === 'ACTIVE' && (isSup() || u.id === me()));
      const type = h('select', { class: 'input', attrs: { 'aria-label': 'Tipo' } }, ['FOLLOW_UP', 'CALLBACK', 'REBUY'].map(k => h('option', { value: k }, TASK[k])));
      const to = h('select', { class: 'input', attrs: { 'aria-label': 'Asignar a' } }, users.map(u => h('option', { value: u.id, selected: u.id === me() }, u.name)));
      const cust = h('select', { class: 'input', attrs: { 'aria-label': 'Cliente' } }, [h('option', { value: '' }, '— Sin cliente —')].concat(db.all('customers').slice(0, 80).map(c => h('option', { value: c.id }, c.full_name))));
      const due = h('input', { class: 'input', type: 'datetime-local', value: G.TODAY + 'T17:00', attrs: { 'aria-label': 'Vence' } });
      const note = h('input', { class: 'input', placeholder: 'Indicación o nota', attrs: { 'aria-label': 'Nota' } });
      b.append(h('div', { class: 'stack' }, type, to, cust, due, note, btn('Guardar actividad', () => {
        try {
          if (!due.value) throw new Error('Indica cuándo vence.');
          const u = db.get('users', to.value);
          C.addTask({ task_type: type.value, customer_id: cust.value || null, brand_id: (u.brands || [])[0] || null, assigned_user_id: to.value, assigned_by: me(), due_at: due.value.length === 16 ? due.value + ':00' : due.value, note: note.value || null });
          toast('Actividad registrada y avisada a ' + u.name, 'ok'); try { G.notify({ user_id: u.id, title: 'Nueva actividad encargada', body: `${TASK[type.value]}${note.value ? ': ' + note.value : ''}`, tone: 'info', module: 'CRM' }); } catch (e) { /* sin avisos */ } close(); G.refresh();
        } catch (e) { toast(e.message, 'bad'); }
      }, { kind: 'primary' })));
    });
  }

  /* ---------- datos de demostración: redes sociales y actividades de la vendedora ---------- */
  G.seed(9101, function () {
    const IN = (ch, from, name, text, at, assignTo) => { try { return C.receive({ channel_id: ch, from, name, text, at: G.TODAY + 'T' + at + ':00', assignTo }); } catch (e) { return null; } };
    IN('ch-ig-DG', '@marisol.cocina', 'Marisol Cocina', 'Hola! ¿Venden caldo de huesos? ¿Cuánto sale el litro?', '15:40', 'us-atorres');
    IN('ch-ig-DG', '@chef.rolando', 'Rolando Chef', 'Vi su reel del cuy al horno, ¿hacen delivery a San Borja?', '16:05', 'us-atorres');
    IN('ch-tt-DG', '@carolina.food', 'Carolina Food', 'Cuánto cuesta el conejo entero? lo vi en su tiktok', '16:20', 'us-atorres');
    IN('ch-fb-DG', 'fb.100034', 'Jorge Salas', 'Buenas, ¿tienen pollo de corral para mañana?', '16:45', 'us-atorres');
    IN('ch-fb-DG', 'fb.100035', 'Lucía Vega', 'Quiero saber si entregan en Lurín y a qué hora', '17:02', 'us-atorres');
    const sup = (db.all('users').find(u => u.role === 'SUPERVISORA_VENTAS') || {}).id;
    const cust = db.all('customers').filter(c => c.status !== 'INACTIVE').slice(2, 6);
    const T = (type, ci, due, note) => C.addTask({ task_type: type, customer_id: cust[ci] ? cust[ci].id : null, brand_id: 'br-DG', assigned_user_id: 'us-atorres', assigned_by: sup || null, due_at: due, note });
    T('CALLBACK', 0, G.TODAY + 'T11:00:00', 'Confirmar dirección de entrega del sábado');
    T('FOLLOW_UP', 1, G.TODAY + 'T17:30:00', 'Preguntar si recibió bien el pedido y ofrecer recompra');
    T('FOLLOW_UP', 2, G.date.add(G.TODAY, 1) + 'T10:00:00', 'Enviar cotización del lechón para 25 personas');
    T('REBUY', 3, G.date.add(G.TODAY, 3) + 'T09:00:00', 'Cliente compra cada 15 días: ofrecer combo de cuy');
  });
})();
