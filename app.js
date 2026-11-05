/* ============================================================
   Almoxarifado Manutenção — versão funcional
   Dados salvos no navegador (localStorage). Toda a leitura/gravação
   passa por load() e persist(), para trocar por Supabase depois.
   ============================================================ */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KEY = 'almox.v2', SESSION = 'almox.session';
const ICONS = { Rolamentos: '⚙️', Correias: '〰️', Sensores: '🔌', Lubrificantes: '🛢️', 'Elétrica': '⚡', 'Hidráulica': '🔧', Parafusos: '🔩', Outros: '📦' };
const SIDES = ['Direito', 'Esquerdo'];
const STREETS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const UNITS = ['UN', 'KG', 'M', 'L', 'PC', 'CX', 'PAR'];
const ROLES = ['Administrador', 'Mecânico', 'Compras'];
const EQ_ICONS = ['⚙️', '🔧', '🏭', '🌀', '⚡', '🛠️', '🔩', '🚜'];
const STATUS = ['Pendente', 'Aguardando cotação', 'Em compra', 'Recebida parcialmente', 'Recebida', 'Cancelada'];
const PRIORITIES = ['Normal', 'Urgente', 'Emergencial'];
const PERMS = {
  Administrador: ['saida', 'entrada', 'request', 'purchase', 'items', 'equip', 'users', 'reports', 'loans', 'repairs'],
  'Mecânico': ['saida', 'entrada', 'request', 'loans', 'repairs'],
  Compras: ['entrada', 'request', 'purchase', 'reports']
};
const PURCHASE_FILTERS = {
  all: () => true,
  open: p => isOpen(p),
  soon: p => dueState(p) === 'soon',
  overdue: p => dueState(p) === 'overdue',
  pend: p => ['Pendente', 'Aguardando cotação'].includes(p.status),
  buy: p => ['Em compra', 'Recebida parcialmente'].includes(p.status),
  done: p => p.status === 'Recebida'
};

let S = null, currentUser = null, currentItemId = null, currentEquipId = null, purchaseFilter = 'all';

/* ---------- dados ---------- */
const pad2 = n => String(n).padStart(2, '0');
const isoDate = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` };
const daysUntil = iso => { if (!iso) return null; const [y, m, d] = iso.split('-').map(Number), t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5) };
const fmtDay = iso => iso ? iso.split('-').reverse().join('/') : '';
const SOON_DAYS = 3;
const isOpen = p => !['Recebida', 'Cancelada'].includes(p.status);
function dueState(p) { if (!isOpen(p) || !p.eta) return null; const d = daysUntil(p.eta); return d < 0 ? 'overdue' : d <= SOON_DAYS ? 'soon' : null }
function dueText(p) { const d = daysUntil(p.eta); if (d === null) return ''; if (d < 0) return `Atrasado há ${-d} dia${d === -1 ? '' : 's'}`; if (d === 0) return 'Chega hoje'; if (d === 1) return 'Chega amanhã'; return `Chega em ${d} dias` }
const cats = () => S.categories || [];
const catOpts = sel => cats().map(c => `<option ${sel === c ? 'selected' : ''}>${esc(c)}</option>`).join('') + '<option value="__new">＋ Outra (nova categoria)…</option>';

function seed() {
  const t = Date.now(), H = 3600e3, D = 24 * H;
  const L = (street, side, level, bin, qty) => ({ street, side, level, bin, qty });
  const raw = [
    { code: 'ROL-000125', name: 'Rolamento 6205 ZZ', category: 'Rolamentos', min: 10, unit: 'UN', locations: [L('A', 'Direito', '2', '15', 20), L('C', 'Esquerdo', '4', '08', 15)], apps: ['Motor da Esteira 01', 'Bomba hidráulica 02', 'Redutor da Linha 03'] },
    { code: 'COR-000087', name: 'Correia A-42', category: 'Correias', min: 12, unit: 'UN', locations: [L('B', 'Direito', '1', '03', 6)], apps: ['Ventilador Industrial 04', 'Exaustor da Caldeira'] },
    { code: 'SEN-000031', name: 'Sensor indutivo M18', category: 'Sensores', min: 4, unit: 'UN', locations: [L('D', 'Esquerdo', '3', 'Gaveta 02', 0)], apps: ['Esteira de seleção 02'] },
    { code: 'LUB-000044', name: 'Graxa para rolamento EP2', category: 'Lubrificantes', min: 8, unit: 'KG', locations: [L('E', 'Direito', '3', '01', 18)], apps: ['Motores elétricos', 'Mancais industriais'] },
    { code: 'MOT-000019', name: 'Contator tripolar 32A', category: 'Elétrica', min: 5, unit: 'UN', locations: [L('F', 'Esquerdo', '1', '04', 9)], apps: ['Painel da bomba 01', 'Compressor 02'] }
  ];
  let id = 1;
  const items = raw.map(r => ({ id: id++, code: r.code, name: r.name, category: r.category, min: r.min, unit: r.unit, locations: r.locations }));
  const known = { 'Motor da Esteira 01': ['Produção · Linha 01', '⚙️'], 'Bomba hidráulica 02': ['Manutenção · Utilidades', '🔧'], 'Redutor da Linha 03': ['Produção · Linha 03', '🏭'] };
  const equipment = [];
  raw.forEach((r, i) => r.apps.forEach(a => {
    let e = equipment.find(x => x.name === a);
    if (!e) { e = { id: id++, name: a, sector: (known[a] || ['Manutenção', '🛠️'])[0], icon: (known[a] || ['', '🛠️'])[1], parts: [], image: '', pins: [] }; equipment.push(e) }
    e.parts.push(items[i].id);
  }));
  const mv = (type, itemIdx, qty, user, reason, at) => { const x = items[itemIdx]; return { id: id++, type, itemId: x.id, itemName: x.name, itemCode: x.code, unit: x.unit, qty, user, reason, loc: locLabel(x.locations[0]), note: '', at } };
  const movements = [
    mv('saida', 0, 2, 'Marcos', 'Manutenção Motor Esteira 01', t - 1 * H),
    mv('entrada', 3, 10, 'André', 'Recebimento de fornecedor', t - 4 * H),
    mv('saida', 1, 1, 'Pedro', 'Ventilador Industrial 04', t - 6 * H),
    mv('saida', 4, 1, 'Marcos', 'Painel da bomba 01', t - 1 * D - 3 * H)
  ];
  const pu = (i, qty, status, priority, requester, ago, received, supplier, eta) => { const x = items[i]; return { id: id++, itemId: x.id, itemName: x.name, itemCode: x.code, unit: x.unit, qty, received: received || 0, status, priority, requester, justification: '', at: t - ago * D, receivedAt: null, supplier: supplier || '', eta: eta || '', receipts: [], note: '', seenAt: null, history: [{ at: t - ago * D, user: requester, text: 'Criou a solicitação' }] } };
  const purchases = [
    pu(1, 20, 'Aguardando cotação', 'Urgente', 'André', 1, 0, '', isoDate(2)),
    pu(2, 10, 'Em compra', 'Emergencial', 'André', 2, 0, 'Sensores & Cia', isoDate(-1)),
    pu(3, 8, 'Recebida parcialmente', 'Normal', 'Marcos', 6, 4, 'Lubrificantes Norte', isoDate(10))
  ];
  const users = ['André:Administrador', 'Marcos:Mecânico', 'Pedro:Mecânico', 'Compradora:Compras'].map(s => { const [name, role] = s.split(':'); return { name, role, pin: '1234', active: true, photo: '' } });
  return { items, equipment, movements, purchases, users, categories: Object.keys(ICONS), catsV2: true, seen: {}, nextId: id };
}
function migrate() {
  S.categories = S.categories || [];
  if (!S.catsV2) { S.categories = [...Object.keys(ICONS).filter(c => !S.categories.includes(c)), ...S.categories]; S.catsV2 = true }
  S.seen = S.seen || {};
  S.items.forEach(x => {
    x.locations.forEach(l => { if (l.street === undefined) { l.street = l.name || ''; l.side = ''; l.level = ''; delete l.name } l.bin = l.bin || '' });
    x.photo = x.photo || '';
    if (!S.categories.includes(x.category)) S.categories.push(x.category);
  });
  S.purchases.forEach(p => { p.supplier = p.supplier || ''; p.eta = p.eta || ''; p.receipts = p.receipts || []; p.note = p.note || ''; p.seenAt = p.seenAt || null; p.history = p.history || [{ at: p.at, user: p.requester, text: 'Criou a solicitação' }] });
  S.equipment.forEach(e => {
    e.pins = e.pins || [];
    if (e.exploded === undefined) { e.exploded = e.image || ''; e.image = '' } // antes a foto explodida ficava em "image"
    e.image = e.image || '';
  });
  S.users.forEach(u => { u.photo = u.photo || '' });
  S.roles = S.roles || ROLES.map(n => ({ name: n, perms: [...PERMS[n]] }));
  S.loans = S.loans || [];
  S.tools = S.tools || [];
  S.repairs = S.repairs || [];
  if (!S.repairsV1) { S.roles.forEach(r => { if (r.perms.includes('loans') && !r.perms.includes('repairs')) r.perms.push('repairs') }); S.repairsV1 = true }
}
function load() {
  try { const r = localStorage.getItem(KEY); if (r) { S = JSON.parse(r); migrate(); return } } catch (e) { }
  S = seed(); migrate(); persist();
}
function persist() {
  if (CLOUD) { try { updateBadge() } catch (e) { } scheduleSave(); queueSync(); return }
  try { localStorage.setItem(KEY, JSON.stringify(S)) } catch (e) { toast('Sem espaço para salvar no navegador. Use imagens menores ou exclua algumas.') }
  try { updateBadge() } catch (e) { }
}
const uid = () => { S.nextId = Math.max(S.nextId, Date.now() * 1000) + 1; return S.nextId };
const itemById = id => S.items.find(x => x.id === Number(id));
const equipById = id => S.equipment.find(x => x.id === Number(id));
const total = x => x.locations.reduce((s, l) => s + Number(l.qty || 0), 0);
const stateOf = x => { const q = total(x); return q === 0 ? 'zero' : q <= x.min ? 'low' : 'ok' };
const PILL = { zero: ['danger', 'Zerado'], low: ['warning', 'Estoque baixo'], ok: ['success', 'Normal'] };
const pill = x => { const p = PILL[stateOf(x)]; return `<span class="status-pill ${p[0]}">${p[1]}</span>` };
const icon = x => ICONS[x.category] || '📦';
const thumb = x => x.photo ? `<img src="${x.photo}" alt="">` : icon(x);
/* ---------- funções e permissões ---------- */
const ALL_PERMS = ['saida', 'entrada', 'request', 'purchase', 'items', 'equip', 'users', 'reports', 'loans', 'repairs'];
const PERM_LABELS = { saida: 'Registrar saída', entrada: 'Registrar entrada / recebimento', request: 'Solicitar compra', purchase: 'Gerenciar compras', items: 'Cadastrar peças e categorias', equip: 'Gerenciar equipamentos', users: 'Usuários e funções (administração)', reports: 'Relatórios e backup', loans: 'Empréstimos de ferramentas', repairs: 'Conserto de equipamentos' };
const roleNames = () => (S.roles || []).map(r => r.name);
const rolePerms = name => name === 'Administrador' ? ALL_PERMS : ((S.roles || []).find(r => r.name === name)?.perms || []);
const can = p => !!currentUser && rolePerms(currentUser.role).includes(p);

/* endereço: Rua › Lado › Nível › Caixa/gaveta */
const streetTxt = s => { s = String(s || '').trim(); return !s ? '' : /^rua\b/i.test(s) ? s : `Rua ${s}` };
function locParts(l) {
  const num = v => /^\d+$/.test(String(v).trim());
  const place = [streetTxt(l.street), l.side && `Lado ${String(l.side).toLowerCase()}`, l.level && (num(l.level) ? `Nível ${l.level}` : l.level)].filter(Boolean).join(' · ');
  const bin = l.bin ? (num(l.bin) ? `Caixa ${l.bin}` : l.bin) : '';
  return { place: place || 'Sem endereço', bin };
}
const locLabel = l => { const p = locParts(l); return p.place + (p.bin ? ' · ' + p.bin : '') };

function addHist(p, text) { (p.history = p.history || []).push({ at: Date.now(), user: currentUser.name, text }) }
function logMove(x, type, qty, loc, reason, note) {
  S.movements.unshift({ id: uid(), type, itemId: x.id, itemName: x.name, itemCode: x.code, unit: x.unit, qty, user: currentUser.name, reason: reason || 'Movimentação de estoque', loc: loc || '', note: note || '', at: Date.now() });
}

/* ---------- utilidades de interface ---------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000) }
const hm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function fmt(ts) {
  const d = new Date(ts), n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 864e5);
  if (diff === 0) return 'Hoje · ' + hm(d);
  if (diff === 1) return 'Ontem · ' + hm(d);
  return d.toLocaleDateString('pt-BR') + ' · ' + hm(d);
}
const isToday = ts => new Date(ts).toDateString() === new Date().toDateString();

function openModal(title, html, mount) {
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden'); document.body.classList.add('modal-open');
  if (mount) mount($('#modalBody'));
  const f = $('#modalBody').querySelector('input:not([type=checkbox]),select,textarea'); if (f) setTimeout(() => f.focus(), 50);
}
function closeModal() { $('#modal').classList.add('hidden'); document.body.classList.remove('modal-open'); $('#modalBody').innerHTML = '' }
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal() });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal() });

function csv(rows) { return '\ufeff' + rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n') }
function download(name, text, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
const stamp = () => new Date().toISOString().slice(0, 10);

/* ---------- navegação ---------- */
const NAVMAP = { detail: 'stock', equipdetail: 'equipment', history: 'profile', users: 'profile', loans: 'profile', categories: 'profile', repairs: 'profile' };
let activeView = 'home', navStack = [];
function goBack(fallback) { let t = navStack.pop(); while (t === activeView) t = navStack.pop(); showView(t || fallback || 'home', true) }
function showView(name, back) {
  const need = { users: 'users', reports: 'reports', loans: 'loans', repairs: 'repairs', categories: 'items' }[name];
  if (need && !can(need)) { toast(need === 'reports' ? 'Seu perfil não acessa os relatórios.' : 'Seu perfil não acessa esta área.'); return }
  if (activeView === 'scanner' && name !== 'scanner') stopCamera();
  if (!back && name !== activeView) { navStack.push(activeView); if (navStack.length > 30) navStack.shift() }
  activeView = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + name)?.classList.add('active');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.go === (NAVMAP[name] || name)));
  renderView(name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderView(name) {
  ({ home: renderHome, stock: renderStock, history: renderHistory, purchases: renderPurchases, equipment: renderEquipment, users: renderUsers, profile: renderProfile, detail: drawDetail, equipdetail: renderEquipDetail, reports: renderReports, loans: renderLoans, repairs: renderRepairs, categories: renderCategories }[name] || (() => { }))();
}
function refresh() { renderView(activeView); renderHome(); fillMoveForm(); updateBadge() }
function updateBadge() {
  const n = currentUser ? unseenNotifs() : 0, b = $('#notifDot');
  b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n);
}
function applyPermissions() { $$('[data-perm]').forEach(el => el.classList.toggle('hidden', !can(el.dataset.perm))) }

/* ---------- avatar / foto ---------- */
function paintAvatar(el, u) {
  if (!el) return;
  if (u.photo) { el.style.backgroundImage = `url("${u.photo}")`; el.textContent = '' } else { el.style.backgroundImage = ''; el.textContent = u.name[0] }
}
const avatarHTML = u => `<div class="avatar" ${u.photo ? `style="background-image:url('${u.photo}')"` : ''}>${u.photo ? '' : esc(u.name[0])}</div>`;
function readImage(file, max, q, square) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m }
      const sc = Math.min(1, max / Math.max(sw, sh)), c = document.createElement('canvas');
      c.width = Math.round(sw * sc); c.height = Math.round(sh * sc);
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('img')) };
    img.src = url;
  });
}
function pickImage(cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = () => { if (i.files[0]) cb(i.files[0]) }; i.click();
}

/* ---------- notificações ---------- */
let notifList = [];
const seenKeys = () => (S.seen && S.seen[currentUser.name]) || [];
const unseenNotifs = () => { const s = seenKeys(); return notifications().filter(n => !s.includes(n.key)).length };
function markNotifsSeen() { S.seen = S.seen || {}; S.seen[currentUser.name] = notifications().map(n => n.key); persist() }
function notifications() {
  const out = [];
  S.purchases.forEach(p => {
    const d = dueState(p); if (!d) return;
    out.push({ k: d, key: `p${p.id}-${d}-${p.eta}`, icon: '🛒', title: `${p.itemName} · ${p.qty} ${p.unit}`, sub: `${d === 'overdue' ? 'Pedido atrasado' : 'Pedido perto do vencimento'} · ${dueText(p)} (${fmtDay(p.eta)})${p.supplier ? ' · ' + p.supplier : ''}`, go: () => { purchaseFilter = d; showView('purchases') } });
  });
  S.items.forEach(x => {
    const s = stateOf(x); if (s === 'ok') return;
    out.push({ k: s, key: `i${x.id}-${s}`, icon: thumb(x), title: x.name, sub: s === 'zero' ? `Sem estoque · mínimo ${x.min} ${x.unit}` : `Estoque baixo: ${total(x)} de ${x.min} ${x.unit}`, go: () => openDetail(x.id) });
  });
  const order = { overdue: 0, soon: 1, zero: 2, low: 3 };
  return out.sort((a, b) => order[a.k] - order[b.k]);
}
const NOTIF_TAG = { overdue: ['danger', 'Atrasado'], soon: ['warning', 'Vence em breve'], zero: ['danger', 'Sem estoque'], low: ['warning', 'Estoque baixo'] };
function notificationsModal() {
  notifList = notifications(); markNotifsSeen();
  openModal('Notificações', notifList.length ? `<div class="notif-list">${notifList.map((n, i) => `<button class="notif-row" data-act="notif" data-id="${i}"><span class="product-thumb">${n.icon}</span><span class="product-info"><b>${esc(n.title)}</b><small>${esc(n.sub)}</small></span><span class="status-pill ${NOTIF_TAG[n.k][0]}">${NOTIF_TAG[n.k][1]}</span></button>`).join('')}</div>` : '<div class="empty-state">Nenhuma notificação. Tudo em dia! 🎉</div>');
}

/* ---------- ações por data-act ---------- */
const act = {
  item: id => openDetail(id),
  equip: id => openEquip(id),
  notif: id => { const n = notifList[Number(id)]; closeModal(); n && n.go() },
  stat: id => {
    if (id === 'today') { showView('history'); $('#historyFilter').value = 'today'; $('#historySearch').value = ''; renderHistory(); return }
    showView('stock'); $('#stockFilter').value = id; $('#stockSearch').value = ''; renderStock();
  },
  pfilter: id => { purchaseFilter = id; renderPurchases() },
  newItem: () => itemForm(),
  editItem: id => itemForm(id),
  delItem: id => {
    const x = itemById(id); if (!x || !confirm(`Excluir "${x.name}"? O histórico de movimentações será mantido.`)) return;
    S.items = S.items.filter(i => i.id !== x.id);
    S.equipment.forEach(e => { e.parts = e.parts.filter(p => p !== x.id); e.pins = e.pins.filter(p => p.itemId !== x.id) });
    persist(); toast('Peça excluída.'); showView('stock');
  },
  label: id => labelModal(id),
  out: id => { showView('movement'); setMoveType(can('saida') ? 'saida' : 'entrada'); fillMoveForm(id) },
  buy: id => purchaseForm(id),
  newPurchase: () => purchaseForm(),
  receive: id => receiveForm(id),
  editPurchase: id => purchaseEditForm(id),
  newEquip: () => equipForm(),
  addPart: () => partForm(),
  rmPart: id => { const e = equipById(currentEquipId), x = itemById(id); if (!e || !x || !can('equip') || !confirm(`Remover "${x.name}" deste equipamento?`)) return; e.parts = e.parts.filter(p => p !== x.id); e.pins = e.pins.filter(p => p.itemId !== x.id); persist(); renderEquipDetail() },
  editEquip: id => equipForm(id),
  delEquip: id => {
    const e = equipById(id); if (!e || !confirm(`Excluir o equipamento "${e.name}"?`)) return;
    S.equipment = S.equipment.filter(x => x.id !== e.id); persist(); toast('Equipamento excluído.'); showView('equipment');
  },
  equipImage: () => pickImage(async f => {
    try { const e = equipById(currentEquipId); e.image = await readImage(f, 800, .8, false); persist(); renderEquipDetail(); toast('Foto do equipamento salva.') }
    catch (err) { toast('Não foi possível ler essa imagem.') }
  }),
  delImage: () => {
    const e = equipById(currentEquipId); if (!e.image || !confirm('Remover a foto do equipamento?')) return;
    e.image = ''; persist(); renderEquipDetail();
  },
  explodedImage: () => pickImage(async f => {
    try { const e = equipById(currentEquipId); e.exploded = await readImage(f, 1400, .8, false); persist(); renderEquipDetail(); toast('Desenho salvo. Toque em “Editar pontos” para marcar as peças.') }
    catch (err) { toast('Não foi possível ler essa imagem.') }
  }),
  delExploded: () => {
    const e = equipById(currentEquipId); if (!e.exploded || !confirm('Remover o desenho explodido e todos os pontos marcados?')) return;
    e.exploded = ''; e.pins = []; editPins = false; persist(); renderEquipDetail();
  },
  togglePins: () => { editPins = !editPins; renderEquipDetail() },
  pin: id => {
    const e = equipById(currentEquipId), p = e.pins.find(x => x.id === Number(id)); if (!p) return;
    if (editPins) pinForm(id); else openDetail(p.itemId);
  },
  newUser: () => userForm(),
  resetPin: id => resetPinForm(id),
  toggleUser: id => {
    const u = S.users.find(x => x.name === id); if (!u) return;
    if (u.active && u.role === 'Administrador' && activeAdmins() < 2) { toast('Mantenha pelo menos um administrador ativo.'); return }
    if (u.name === currentUser.name) { toast('Você não pode desativar o próprio acesso.'); return }
    u.active = !u.active; persist(); renderUsers(); toast(u.active ? 'Acesso reativado.' : 'Acesso desativado.');
  },
  changePin: () => changePinForm(),
  reports: () => showView('reports'),
  newRole: () => roleForm(),
  editRole: id => roleForm(id),
  delRole: id => deleteRole(id),
  newCat: () => catForm(),
  renameCat: id => catForm(id),
  delCat: id => deleteCat(id),
  newLoan: () => loanForm(),
  loan: id => loanDetail(id),
  newRepair: () => repairForm(),
  repair: id => repairDetail(id)
};
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zoom]');
  if (z) { const eq = equipById(z.dataset.eq); if (eq) openLightbox(z.dataset.zoom === 'exploded' ? eq.exploded : eq.image, eq.name + (z.dataset.zoom === 'exploded' ? ' · desenho explodido' : '')); return }
  const bk = e.target.closest('[data-back]'); if (bk) { goBack(bk.dataset.back); return }
  const go = e.target.closest('[data-go]'); if (go) { if (go.classList.contains('nav-item')) navStack = []; showView(go.dataset.go); return }
  const a = e.target.closest('[data-act]'); if (a && act[a.dataset.act]) act[a.dataset.act](a.dataset.id, a);
});
document.addEventListener('change', e => {
  const sel = e.target.closest('.status-select'); if (sel) setPurchaseStatus(sel.dataset.id, sel.value);
  const rs = e.target.closest('.role-select'); if (rs) setUserRole(rs.dataset.id, rs.value);
});

/* ---------- login / sessão ---------- */
const activeAdmins = () => S.users.filter(u => u.active && u.role === 'Administrador').length;
function renderLogin() { $('#loginHint').textContent = 'Entre com seu e-mail e senha do almoxarifado.' }
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#userSelect').value.trim(), pass = $('#pinInput').value;
  if (!email || !pass) { toast('Informe e-mail e senha.'); return }
  const btn = $('#loginBtn'); btn.disabled = true;
  try {
    const r = await cloudLogin(email, pass);
    adoptCloud(r); currentUser = r.me; enterApp(r.me); toast('Bem-vindo, ' + r.me.name + '!');
  } catch (err) { toast(err.message) }
  finally { btn.disabled = false; $('#pinInput').value = '' }
});
function enterApp(u) {
  currentUser = u;
  $('#loginScreen').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#pinInput').value = '';
  $('#headerUser').textContent = u.name; $('#welcomeName').textContent = u.name; paintAvatar($('#avatar'), u);
  applyPermissions(); setMoveType(can('saida') ? 'saida' : 'entrada'); fillMoveForm(); updateBadge();
  activeView = 'home'; navStack = []; $$('.view').forEach(v => v.classList.remove('active')); $('#view-home').classList.add('active');
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.go === 'home')); renderHome();
}
$('#logoutButton').onclick = () => {
  const n = pendingCount();
  if (n && !confirm(`Há ${n} alteração(ões) que ainda não foram enviadas ao banco. Se sair agora, elas serão perdidas. Sair mesmo assim?`)) return;
  stopCamera(); closeModal(); cloudSignOut();
  try { localStorage.removeItem(SESSION) } catch (e) { }
  currentUser = null; $('#app').classList.add('hidden'); $('#loginScreen').classList.remove('hidden'); renderLogin();
};
$('#profileShortcut').onclick = () => showView('profile');

/* ---------- início ---------- */
function renderHome() {
  const it = S.items, low = it.filter(x => stateOf(x) === 'low').length, zero = it.filter(x => stateOf(x) === 'zero').length;
  $('#todayLabel').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase();
  $('#statItems').textContent = it.length.toLocaleString('pt-BR');
  $('#statLow').textContent = pad2(low); $('#statZero').textContent = pad2(zero);
  $('#todayMoves').textContent = S.movements.filter(m => isToday(m.at)).length;
  $('#recentMoves').innerHTML = S.movements.length ? S.movements.slice(0, 4).map(moveHTML).join('') : '<div class="empty-state">Nenhuma movimentação registrada ainda.</div>';
}
function moveHTML(m) {
  const ok = !!itemById(m.itemId);
  return `<div class="move-row ${ok ? 'clickable' : ''}" ${ok ? `data-act="item" data-id="${m.itemId}"` : ''}><div class="move-sign ${m.type === 'saida' ? 'out' : 'in'}">${m.type === 'saida' ? '↗' : '↙'}</div><div class="move-details"><b>${esc(m.itemName)}</b>${can('users') ? `<small class="who">👤 ${esc(m.user)}</small>` : ''}<small>${esc(m.reason || 'Sem observação')} · ${fmt(m.at)}</small>${m.loc ? `<small>⌖ ${esc(m.loc)}</small>` : ''}${m.note ? `<small>“${esc(m.note)}”</small>` : ''}</div><div class="move-qty">${m.type === 'saida' ? '-' : '+'}${m.qty} ${esc(m.unit || '')}</div></div>`;
}
$('#homeSearchBtn').onclick = () => { showView('stock'); $('#stockFilter').value = 'all'; $('#stockSearch').value = $('#homeSearch').value; $('#homeSearch').value = ''; renderStock() };
$('#homeSearch').addEventListener('keydown', e => { if (e.key === 'Enter') $('#homeSearchBtn').click() });
$('#notificationBtn').onclick = notificationsModal;

/* ---------- estoque ---------- */
function equipUsing(id) { return S.equipment.filter(e => e.parts.includes(Number(id))) }
const FILTER_LABEL = { all: '', alert: 'Precisam de atenção', low: 'Estoque baixo', zero: 'Sem estoque' };
function renderStock() {
  const q = ($('#stockSearch').value || '').toLowerCase().trim(), f = $('#stockFilter').value;
  const list = S.items.filter(x => {
    const hay = (x.name + ' ' + x.code + ' ' + x.category + ' ' + x.locations.map(locLabel).join(' ') + ' ' + equipUsing(x.id).map(e => e.name).join(' ')).toLowerCase();
    const st = stateOf(x);
    return hay.includes(q) && (f === 'all' || (f === 'alert' && st !== 'ok') || (f === 'low' && st === 'low') || (f === 'zero' && st === 'zero'));
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('#resultCount').textContent = `${FILTER_LABEL[f] ? FILTER_LABEL[f] + ' · ' : ''}${list.length} material(is) encontrado(s)`;
  $('#stockList').innerHTML = list.length ? list.map(x => `<article class="stock-card" data-act="item" data-id="${x.id}"><div class="product-thumb">${thumb(x)}</div><div class="product-info"><b>${esc(x.name)}</b><small>${esc(x.code)} · ${esc(x.category)}</small><small>⌖ ${x.locations[0] ? esc(locLabel(x.locations[0])) : 'Sem local'}${x.locations.length > 1 ? ` +${x.locations.length - 1}` : ''}</small></div><div class="stock-meta"><b>${total(x)} ${esc(x.unit)}</b>${pill(x)}</div><span class="arrow">›</span></article>`).join('') : '<div class="empty-state">Nenhum material encontrado.</div>';
}
$('#stockSearch').addEventListener('input', renderStock);
$('#stockFilter').addEventListener('change', renderStock);

const locCell = (label, v, big) => `<div class="loc-cell ${big ? 'big' : ''}"><small>${label}</small><b>${v ? esc(v) : '—'}</b></div>`;
const locCard = (x, l) => `<div class="loc-card ${l.qty ? '' : 'empty'}"><div class="loc-grid">${locCell('Rua', l.street, 1)}${locCell('Lado', l.side)}${locCell('Nível', l.level)}${locCell('Caixa / gaveta', l.bin)}</div><div class="loc-qty"><span>Quantidade neste local</span><b>${l.qty} ${esc(x.unit)}</b></div></div>`;
function openDetail(id) { const x = itemById(id); if (!x) { toast('Peça não encontrada.'); return } currentItemId = x.id; showView('detail') }
function drawDetail() {
  const x = itemById(currentItemId); if (!x) { showView('stock', true); return }
  const st = stateOf(x), eqs = equipUsing(x.id), pend = S.purchases.filter(p => p.itemId === x.id && isOpen(p));
  $('#itemDetail').innerHTML = `<div class="detail-card"><div class="detail-top"><div class="detail-photo">${thumb(x)}</div><div class="detail-title"><span class="status-pill ${PILL[st][0]}">${st === 'zero' ? 'Sem estoque' : st === 'low' ? 'Estoque baixo' : 'Disponível'}</span><h2>${esc(x.name)}</h2><p>Código: ${esc(x.code)} · ${esc(x.category)}</p><p>Unidade: ${esc(x.unit)}</p></div></div>
  <div class="detail-stats"><div class="detail-stat"><small>Estoque total</small><b>${total(x)}</b></div><div class="detail-stat"><small>Estoque mínimo</small><b>${x.min}</b></div><div class="detail-stat"><small>Locais</small><b>${x.locations.length}</b></div></div>
  ${pend.length ? `<div class="info-strip">🛒 ${pend.length} solicitação(ões) de compra em aberto para esta peça.</div>` : ''}
  <div class="detail-section"><h3>📍 Onde encontrar</h3>${x.locations.map(l => locCard(x, l)).join('')}</div>
  <div class="detail-section"><h3>⚙️ Equipamentos que utilizam esta peça</h3>${eqs.length ? eqs.map(e => `<div class="application-row clickable" data-act="equip" data-id="${e.id}"><span>${esc(e.name)}</span><small>Ver aplicação ›</small></div>`).join('') : '<div class="empty-inline">Nenhum equipamento vinculado ainda. Vincule em Equipamentos.</div>'}</div>
  <div class="detail-actions"><button class="btn primary" data-act="out" data-id="${x.id}" data-perm="saida">↗ Registrar saída</button><button class="btn secondary" data-act="buy" data-id="${x.id}" data-perm="request">＋ Solicitar compra</button></div>
  <div class="detail-actions sub"><button class="btn ghost" data-act="label" data-id="${x.id}">▦ Etiqueta QR</button><button class="btn ghost" data-act="editItem" data-id="${x.id}" data-perm="items">✎ Editar</button><button class="btn ghost danger" data-act="delItem" data-id="${x.id}" data-perm="items">🗑 Excluir</button></div></div>`;
  applyPermissions();
}

/* campos de endereço reutilizáveis */
const miniField = (label, inner) => `<label class="mini"><span>${label}</span>${inner}</label>`;
const sideSelect = (cls, v) => `<select class="${cls}"><option value="">—</option>${SIDES.map(s => `<option ${v === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
const streetSelect = (cls, v) => `<select class="${cls}"><option value="">—</option>${(v && !STREETS.includes(v) ? [...STREETS, v] : STREETS).map(s => `<option ${v === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
const newLocFields = () => `<div class="loc-new">${miniField('Rua', streetSelect('n-street', ''))}${miniField('Lado', sideSelect('n-side', 'Direito'))}${miniField('Nível', '<input class="n-level" placeholder="1">')}${miniField('Caixa / gaveta', '<input class="n-bin" placeholder="Nº">')}</div>`;
function readNewLoc(scope) {
  const g = c => scope.querySelector(c).value.trim();
  return { street: g('.n-street'), side: g('.n-side'), level: g('.n-level'), bin: g('.n-bin'), qty: 0 };
}

/* cadastro / edição de peça */
function itemForm(id) {
  if (!can('items')) return;
  const x = id ? itemById(id) : null;
  openModal(x ? 'Editar peça' : 'Cadastrar peça', `<form id="itemForm">
    <div class="field"><label>Foto da peça</label><div class="photo-field"><div class="photo-prev" id="photoPrev">📷</div><div class="photo-btns"><button class="btn secondary sm" type="button" id="pickPhoto">📷 Anexar foto</button><button class="btn ghost sm danger hidden" type="button" id="rmPhoto">Remover</button></div></div></div>
    <div class="field"><label>Nome *</label><input name="name" required maxlength="80" value="${esc(x?.name)}"></div>
    <div class="field"><label>Código da peça *</label><input name="code" required maxlength="40" placeholder="Código específico da peça (ex.: 6205-ZZ ou código interno)" value="${esc(x?.code)}"></div>
    <div class="form-row"><div class="field"><label>Categoria</label><select name="category">${catOpts(x?.category)}</select></div>
    <div class="field"><label>Unidade</label><select name="unit">${UNITS.map(u => `<option ${x?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
    <div class="field hidden" id="newCatWrap"><label>Nome da nova categoria *</label><input name="newcat" maxlength="30" placeholder="Ex.: Vedações"></div>
    <div class="field"><label>Estoque mínimo *</label><input name="min" type="number" min="0" required value="${x ? x.min : 1}"></div>
    <div class="field"><label>Onde fica guardada (rua › lado › nível › caixa)</label><div id="locRows"></div><button class="btn secondary" type="button" id="addLoc">＋ Adicionar local</button>
    <small class="field-hint">${x ? 'O saldo de locais existentes só muda por Movimentação. Em locais novos, a quantidade vira “Saldo inicial”.' : 'A quantidade informada vira o saldo inicial.'}</small></div>
    <button class="btn primary full" type="submit">${x ? 'Salvar alterações' : 'Cadastrar peça'}</button></form>`, root => {
    const rows = root.querySelector('#locRows'), catSel = root.querySelector('[name=category]');
    let photo = x?.photo || '';
    const prev = root.querySelector('#photoPrev'), rmBtn = root.querySelector('#rmPhoto'), pickBtn = root.querySelector('#pickPhoto');
    const paintPhoto = () => { prev.innerHTML = photo ? `<img src="${photo}" alt="">` : '📷'; rmBtn.classList.toggle('hidden', !photo); pickBtn.textContent = photo ? '🔄 Trocar foto' : '📷 Anexar foto' };
    pickBtn.onclick = () => pickImage(async f => { try { photo = await readImage(f, 700, .78, false); paintPhoto() } catch (err) { toast('Não foi possível ler essa imagem.') } });
    rmBtn.onclick = () => { photo = ''; paintPhoto() };
    paintPhoto();
    catSel.onchange = () => { const n = catSel.value === '__new'; root.querySelector('#newCatWrap').classList.toggle('hidden', !n); if (n) root.querySelector('[name=newcat]').focus() };
    const addRow = (l, idx) => {
      const d = document.createElement('div'); d.className = 'loc-row'; if (idx !== undefined) d.dataset.idx = idx;
      d.innerHTML = miniField('Rua', streetSelect('l-street', l.street)) + miniField('Lado', sideSelect('l-side', l.side)) + miniField('Nível', `<input class="l-level" placeholder="1" value="${esc(l.level)}">`) + miniField('Caixa / gaveta', `<input class="l-bin" placeholder="Nº" value="${esc(l.bin)}">`) + miniField('Qtd', `<input class="l-qty" type="number" min="0" value="${l.qty || 0}" ${idx !== undefined ? 'disabled' : ''}>`) + '<button class="icon-btn rm" type="button" title="Remover local">✕</button>';
      d.querySelector('.rm').onclick = () => {
        if (idx !== undefined && x.locations[idx].qty > 0) { toast('Zere o saldo por Movimentação antes de remover este local.'); return }
        d.remove();
      };
      rows.appendChild(d);
    };
    (x ? x.locations : [{ street: '', side: 'Direito', level: '', bin: '', qty: 0 }]).forEach((l, i) => addRow(l, x ? i : undefined));
    root.querySelector('#addLoc').onclick = () => addRow({ street: '', side: 'Direito', level: '', bin: '', qty: 0 });
    root.querySelector('#itemForm').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      const name = f.get('name').trim(), code = f.get('code').trim(), unit = f.get('unit'), min = Math.max(0, parseInt(f.get('min')) || 0);
      if (!code) { toast('Informe o código da peça.'); return }
      if (S.items.some(i => i.code.toLowerCase() === code.toLowerCase() && i.id !== x?.id)) { toast('Já existe uma peça com este código.'); return }
      let category = f.get('category');
      if (category === '__new') {
        const n = f.get('newcat').trim(); if (!n) { toast('Digite o nome da nova categoria.'); return }
        category = cats().find(c => c.toLowerCase() === n.toLowerCase()) || n;
        if (!cats().includes(category)) S.categories.push(category);
      }
      const locs = [], initial = [];
      for (const r of rows.querySelectorAll('.loc-row')) {
        const g = c => r.querySelector(c).value.trim();
        const l = { street: g('.l-street'), side: g('.l-side'), level: g('.l-level'), bin: g('.l-bin'), qty: 0 };
        if (!l.street && !l.level && !l.bin) continue;
        if (r.dataset.idx !== undefined) { l.qty = x.locations[Number(r.dataset.idx)].qty; locs.push(l) }
        else { l.qty = Math.max(0, parseInt(r.querySelector('.l-qty').value) || 0); locs.push(l); if (l.qty > 0) initial.push(l) }
      }
      if (!locs.length) { toast('Informe pelo menos um local (rua, nível ou caixa).'); return }
      let target = x;
      if (x) {
        Object.assign(x, { name, category, unit, min, code, locations: locs, photo });
        S.movements.forEach(m => { if (m.itemId === x.id) { m.itemName = x.name; m.itemCode = x.code; m.unit = x.unit } });
        S.purchases.forEach(p => { if (p.itemId === x.id) { p.itemName = x.name; p.itemCode = x.code; p.unit = x.unit } });
      } else { target = { id: uid(), name, category, unit, min, code, locations: locs, photo }; S.items.push(target) }
      initial.forEach(l => logMove(target, 'entrada', l.qty, locLabel(l), 'Saldo inicial', ''));
      persist(); closeModal(); toast(x ? 'Peça atualizada.' : 'Peça cadastrada com sucesso!');
      refresh(); openDetail(target.id);
    };
  });
}

/* etiqueta QR */
function qrSvg(text) {
  if (typeof qrcode === 'undefined') return '';
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }) } catch (e) { return '' }
}
const labelHTML = x => `<div class="label-card"><div class="label-qr">${qrSvg(x.code) || '<small>QR indisponível (sem internet)</small>'}</div><div class="label-text"><b>${esc(x.name)}</b><span>${esc(x.code)}</span><small>${esc(x.locations[0] ? locLabel(x.locations[0]) : '')}</small></div></div>`;
function labelModal(id) {
  const x = itemById(id); if (!x) return;
  openModal('Etiqueta QR', `<div class="label-preview">${labelHTML(x)}</div><p class="muted center tiny">O QR contém o código <b>${esc(x.code)}</b>. Cole na prateleira ou na caixa da peça.</p><button class="btn primary full" id="printLabel">🖨 Imprimir etiqueta</button>`, r => { r.querySelector('#printLabel').onclick = () => printLabels([x]) });
}
function printLabels(list) {
  $('#printArea').className = ''; $('#printArea').innerHTML = list.map(labelHTML).join('');
  window.addEventListener('afterprint', () => { $('#printArea').innerHTML = '' }, { once: true });
  setTimeout(() => window.print(), 100);
}

/* ---------- scanner ---------- */
const cam = { stream: null, timer: 0, detector: null, busy: false, last: '', canvas: null };
const scanMsg = t => $('#scannerMessage').textContent = t;
function lookup(val) {
  const v = String(val || '').trim().toLowerCase(); if (!v) return null;
  let x = S.items.find(i => i.code.toLowerCase() === v || String(i.id) === v);
  if (!x) { const m = v.match(/[a-z]{3}-\d{4,}/i); if (m) x = S.items.find(i => i.code.toLowerCase() === m[0].toLowerCase()) }
  return x || null;
}
$('#lookupQr').onclick = () => {
  const x = lookup($('#qrManual').value);
  if (x) { scanMsg('Peça localizada: ' + x.name); $('#qrManual').value = ''; openDetail(x.id) }
  else scanMsg('Código não encontrado. Confira a etiqueta ou tente novamente.');
};
$('#qrManual').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lookupQr').click() });
async function startCamera() {
  if (cam.stream) { stopCamera(); return }
  if (!navigator.mediaDevices?.getUserMedia) { scanMsg('Câmera indisponível. Use HTTPS ou digite o código abaixo.'); return }
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const v = $('#cameraVideo'); v.srcObject = cam.stream; await v.play();
    $('#cameraFrame').classList.add('live'); $('#startCamera').textContent = '■ Parar câmera';
    cam.detector = null; cam.last = '';
    if ('BarcodeDetector' in window) { try { cam.detector = new BarcodeDetector({ formats: ['qr_code'] }) } catch (e) { } }
    if (!cam.detector && typeof jsQR === 'undefined') scanMsg('Leitor automático indisponível aqui (sem internet). Digite o código abaixo.');
    else scanMsg('Procurando QR Code…');
    scanLoop();
  } catch (e) { cam.stream = null; scanMsg('Permita o acesso à câmera nas configurações do navegador.') }
}
function stopCamera() {
  clearTimeout(cam.timer); cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null;
  const v = $('#cameraVideo'); if (v) v.srcObject = null;
  $('#cameraFrame')?.classList.remove('live'); const b = $('#startCamera'); if (b) b.textContent = '◎ Ativar câmera';
}
async function scanLoop() {
  if (!cam.stream) return;
  const v = $('#cameraVideo');
  if (v.readyState >= 2 && v.videoWidth && !cam.busy) {
    cam.busy = true;
    try {
      let val = null;
      if (cam.detector) { const r = await cam.detector.detect(v); val = r[0]?.rawValue }
      else if (typeof jsQR !== 'undefined') {
        const c = cam.canvas || (cam.canvas = document.createElement('canvas')), sc = Math.min(1, 640 / v.videoWidth);
        c.width = Math.round(v.videoWidth * sc); c.height = Math.round(v.videoHeight * sc);
        const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height); val = jsQR(d.data, d.width, d.height)?.data;
      }
      if (val) handleScan(val);
    } catch (e) { }
    cam.busy = false;
  }
  if (cam.stream) cam.timer = setTimeout(scanLoop, 150);
}
function handleScan(val) {
  const x = lookup(val);
  if (x) { navigator.vibrate?.(60); stopCamera(); scanMsg('Peça localizada: ' + x.name); openDetail(x.id) }
  else if (val !== cam.last) { cam.last = val; scanMsg('QR lido, mas não corresponde a nenhuma peça: ' + String(val).slice(0, 40)) }
}
$('#startCamera').onclick = startCamera;

/* ---------- movimentação ---------- */
function setMoveType(t) {
  if (!can(t)) return;
  $('#movementType').value = t;
  $$('.movement-tabs button').forEach(b => b.classList.toggle('selected', b.dataset.type === t));
  $('#moveLocLabel').textContent = t === 'saida' ? 'Local de retirada' : 'Local de entrada';
  $('#moveSubmit').textContent = t === 'saida' ? 'Confirmar saída' : 'Confirmar entrada';
  fillLocations();
}
$$('.movement-tabs button').forEach(b => b.onclick = () => { setMoveType(b.dataset.type); $('#moveQty').value = 1 });
function fillMoveForm(preId) {
  const sel = $('#moveItem'), cur = preId || sel.value;
  sel.innerHTML = S.items.length ? S.items.map(x => `<option value="${x.id}">${esc(x.name)} (${esc(x.code)})</option>`).join('') : '<option value="">Nenhuma peça cadastrada</option>';
  if (cur && itemById(cur)) sel.value = cur;
  fillLocations();
}
function fillLocations() {
  const x = itemById($('#moveItem').value), type = $('#movementType').value, sel = $('#moveLocation');
  if (!x) { sel.innerHTML = ''; $('#moveBalance').textContent = ''; $('#newLocWrap').classList.add('hidden'); return }
  const prev = sel.value;
  let html = x.locations.map((l, i) => `<option value="${i}">${esc(locLabel(l))} — ${l.qty} ${esc(x.unit)}</option>`).join('');
  if (type === 'entrada') html += '<option value="new">＋ Novo local…</option>';
  sel.innerHTML = html;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  else if (type === 'saida') { const i = x.locations.findIndex(l => l.qty > 0); if (i >= 0) sel.value = String(i) }
  updateMoveHints();
}
function updateMoveHints() {
  const x = itemById($('#moveItem').value), v = $('#moveLocation').value;
  $('#newLocWrap').classList.toggle('hidden', v !== 'new');
  if (!x) return;
  const l = x.locations[Number(v)];
  $('#moveBalance').textContent = `Saldo total: ${total(x)} ${x.unit}` + (l ? ` · neste local: ${l.qty} ${x.unit}` : '') + ` · mínimo: ${x.min} ${x.unit}`;
}
$('#moveItem').onchange = fillLocations; $('#moveLocation').onchange = updateMoveHints;
$('#movementForm').onsubmit = e => {
  e.preventDefault();
  const x = itemById($('#moveItem').value), qty = parseInt($('#moveQty').value), type = $('#movementType').value;
  if (!x) { toast('Cadastre uma peça antes de movimentar.'); return }
  if (!can(type)) { toast('Seu perfil não permite este tipo de movimentação.'); return }
  if (!(qty > 0)) { toast('Informe uma quantidade válida.'); return }
  let loc;
  if ($('#moveLocation').value === 'new') {
    loc = readNewLoc($('#newLocWrap')); if (!loc.street && !loc.level && !loc.bin) { toast('Informe a rua, o nível ou a caixa do novo local.'); return }
    x.locations.push(loc);
  } else loc = x.locations[Number($('#moveLocation').value)];
  if (type === 'saida' && qty > loc.qty) { toast(`Saldo insuficiente em ${locLabel(loc)}: ${loc.qty} ${x.unit}.`); return }
  loc.qty += type === 'entrada' ? qty : -qty;
  logMove(x, type, qty, locLabel(loc), $('#moveReason').value.trim(), $('#moveNote').value.trim());
  persist();
  ['#moveReason', '#moveNote'].forEach(s => $(s).value = ''); $('#newLocWrap').innerHTML = newLocFields(); $('#moveQty').value = 1;
  const warn = type === 'saida' && stateOf(x) !== 'ok' ? ` Atenção: ${stateOf(x) === 'zero' ? 'estoque zerado' : 'abaixo do mínimo'}.` : '';
  toast((type === 'saida' ? 'Saída registrada.' : 'Entrada registrada.') + warn);
  fillMoveForm(); showView('home');
};

/* ---------- compras ---------- */
const purchasePill = p => p.status.startsWith('Recebida') ? 'success' : p.status === 'Cancelada' ? 'muted' : p.priority === 'Emergencial' ? 'danger' : 'warning';
function markSeenByBuyer() {
  if (!currentUser || currentUser.role !== 'Compras') return;
  let ch = false;
  S.purchases.forEach(p => { if (isOpen(p) && !p.seenAt) { p.seenAt = Date.now(); p.seenBy = currentUser.name; addHist(p, 'Visualizou o pedido'); ch = true } });
  if (ch) persist();
}
const seenLine = p => p.seenAt ? `<small class="seen ok">👁 Visualizado por ${esc(p.seenBy)} · ${fmt(p.seenAt)}</small>` : isOpen(p) ? '<small class="seen wait">⏳ Ainda não visualizado pela compradora</small>' : '';
const histHTML = p => { const h = p.history || []; return h.length ? `<details class="hist"><summary>🕘 Histórico do pedido (${h.length})</summary><ul>${[...h].reverse().map(e => `<li><b>${esc(e.text)}</b><small>${esc(e.user)} · ${fmt(e.at)}</small></li>`).join('')}</ul></details>` : '' };
function renderPurchases() {
  markSeenByBuyer();
  const P = S.purchases, cnt = k => P.filter(PURCHASE_FILTERS[k]).length;
  $('#sumOpen').textContent = pad2(cnt('open')); $('#sumSoon').textContent = pad2(cnt('soon')); $('#sumOver').textContent = pad2(cnt('overdue'));
  $$('.sum-card').forEach(b => b.classList.toggle('active', b.dataset.id === purchaseFilter));
  $$('#purchasePills button').forEach(b => b.classList.toggle('active', b.dataset.f === purchaseFilter));
  let list = P.filter(PURCHASE_FILTERS[purchaseFilter]);
  if (['open', 'soon', 'overdue'].includes(purchaseFilter)) list = [...list].sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999'));
  $('#purchaseList').innerHTML = list.length ? list.map(purchaseCard).join('') : '<div class="empty-state">Nenhuma solicitação nesta lista.</div>';
}
function purchaseCard(p) {
  const open = isOpen(p), mgr = can('purchase'), ds = dueState(p);
  const opts = ['Pendente', 'Aguardando cotação', 'Em compra', 'Cancelada']; if (!opts.includes(p.status)) opts.splice(3, 0, p.status);
  const eta = p.eta ? `${fmtDay(p.eta)}${open ? ` <span class="due-tag ${ds || 'ok'}">${esc(dueText(p))}</span>` : ''}` : '<i>a definir pela compradora</i>';
  const rec = (p.receipts || []).map(r => `NF ${esc(r.nf)} · ${r.qty} ${esc(p.unit)} · ${esc(r.supplier || '—')} · ${esc(r.loc)} · ${new Date(r.at).toLocaleDateString('pt-BR')}`).join('<br>');
  return `<div class="purchase-card ${ds ? 'is-' + ds : ''}"><div class="product-thumb">🛒</div><div class="product-info"><b>${esc(p.itemName)}</b>
    <small>${p.isNew ? '🆕 Item novo (cadastrar ao chegar)' : esc(p.itemCode)} · ${p.qty} ${esc(p.unit)}${p.received ? ` · recebido ${p.received}` : ''}<br>Solicitante: ${esc(p.requester)} · ${new Date(p.at).toLocaleDateString('pt-BR')}<br>Prioridade: ${esc(p.priority)}<br>Fornecedor: ${p.supplier ? esc(p.supplier) : '<i>a definir</i>'}<br>Previsão de chegada: ${eta}</small>
    ${p.justification ? `<small class="just">“${esc(p.justification)}”</small>` : ''}${p.note ? `<small class="just">Compradora: “${esc(p.note)}”</small>` : ''}
    ${seenLine(p)}${rec ? `<small class="receipts"><b>Recebimentos</b><br>${rec}</small>` : ''}${histHTML(p)}
    ${p.updatedBy ? `<small class="upd">Atualizado por ${esc(p.updatedBy)} · ${fmt(p.updatedAt)}</small>` : ''}
    ${mgr && open ? `<div class="purchase-actions"><select class="status-select" data-id="${p.id}">${opts.map(o => `<option ${o === p.status ? 'selected' : ''} ${o === 'Recebida parcialmente' ? 'disabled' : ''}>${o}</option>`).join('')}</select><button class="btn ghost sm" data-act="editPurchase" data-id="${p.id}">📅 Previsão e fornecedor</button>${can('entrada') && (p.isNew || itemById(p.itemId)) ? `<button class="btn secondary sm" data-act="receive" data-id="${p.id}">📥 Registrar recebimento</button>` : ''}</div>` : ''}</div>
    <span class="status-pill ${purchasePill(p)}">${esc(p.status)}</span></div>`;
}
$$('#purchasePills button').forEach(b => b.onclick = () => { purchaseFilter = b.dataset.f; renderPurchases() });
function setPurchaseStatus(id, status) {
  if (!can('purchase')) return;
  const p = S.purchases.find(x => x.id === Number(id)); if (!p) return;
  if (status === 'Cancelada' && !confirm('Cancelar esta solicitação?')) { renderPurchases(); return }
  addHist(p, 'Alterou o status para "' + status + '"'); p.status = status; p.updatedBy = currentUser.name; p.updatedAt = Date.now(); persist(); renderPurchases(); toast('Status atualizado: ' + status);
}
function purchaseForm(itemId) {
  if (!can('request')) return;
  openModal('Nova solicitação de compra', `<form id="purchaseForm">
    <div class="field"><label>Material *</label><select name="item" required>${S.items.map(x => `<option value="${x.id}">${esc(x.name)} (${esc(x.code)})</option>`).join('')}<option value="__new">＋ Item novo (ainda não cadastrado)…</option></select></div>
    <div id="newItemBox" class="hidden new-item-box">
      <div class="field"><label>Nome do novo item *</label><input name="newname" maxlength="80" placeholder="Ex.: Rolamento 6306 2RS"></div>
      <div class="form-row"><div class="field"><label>Categoria</label><select name="newcat">${cats().map(c => `<option>${esc(c)}</option>`).join('')}</select></div><div class="field"><label>Unidade</label><select name="newunit">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></div></div>
      <small class="field-hint">O código, a foto e o local de armazenamento serão preenchidos quando o item chegar, no registro do recebimento.</small>
    </div>
    <div class="form-row"><div class="field"><label>Quantidade *</label><input name="qty" type="number" min="1" required value="1"></div><div class="field"><label>Prioridade</label><select name="priority">${PRIORITIES.map(p => `<option>${p}</option>`).join('')}</select></div></div>
    <p class="balance-hint" id="pHint"></p>
    <div class="field"><label>Justificativa</label><textarea name="just" rows="3" placeholder="Informe por que precisa comprar..."></textarea></div>
    <button class="btn primary full" type="submit">Enviar solicitação</button></form>`, r => {
    const sel = r.querySelector('[name=item]'), qty = r.querySelector('[name=qty]'), box = r.querySelector('#newItemBox'), hint = r.querySelector('#pHint');
    const suggest = () => {
      const isNew = sel.value === '__new'; box.classList.toggle('hidden', !isNew);
      if (isNew) { hint.textContent = 'Item novo: será cadastrado no estoque quando chegar.'; return }
      const x = itemById(sel.value); if (!x) { hint.textContent = ''; return }
      qty.value = Math.max(1, x.min * 2 - total(x)); hint.textContent = `Saldo atual: ${total(x)} ${x.unit} · mínimo: ${x.min} ${x.unit} · sugestão: repor até ${x.min * 2} ${x.unit}`;
    };
    if (itemId && itemById(itemId)) sel.value = itemId; else if (!S.items.length) sel.value = '__new';
    suggest(); sel.onchange = suggest;
    r.querySelector('#purchaseForm').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), q = parseInt(f.get('qty')); let base;
      if (!(q > 0)) { toast('Confira a quantidade.'); return }
      if (f.get('item') === '__new') {
        const name = (f.get('newname') || '').trim(); if (!name) { toast('Informe o nome do novo item.'); return }
        base = { itemId: null, isNew: true, itemName: name, itemCode: '', unit: f.get('newunit'), newCat: f.get('newcat') || 'Outros' };
      } else {
        const x = itemById(f.get('item')); if (!x) { toast('Confira o material.'); return }
        base = { itemId: x.id, itemName: x.name, itemCode: x.code, unit: x.unit };
      }
      S.purchases.unshift({ id: uid(), ...base, qty: q, received: 0, status: 'Pendente', priority: f.get('priority'), requester: currentUser.name, justification: f.get('just').trim(), at: Date.now(), receivedAt: null, supplier: '', eta: '', receipts: [], note: '', seenAt: null, history: [{ at: Date.now(), user: currentUser.name, text: base.isNew ? 'Criou a solicitação (item novo)' : 'Criou a solicitação' }] });
      persist(); closeModal(); toast('Solicitação criada com sucesso!'); purchaseFilter = 'all'; showView('purchases');
    };
  });
}
/* só compradora e administrador */
function purchaseEditForm(id) {
  if (!can('purchase')) { toast('Somente a compradora e o administrador editam o pedido.'); return }
  const p = S.purchases.find(x => x.id === Number(id)); if (!p) return;
  const sup = [...new Set(S.purchases.map(x => x.supplier).filter(Boolean))];
  openModal('Previsão e fornecedor', `<form id="peForm"><p class="muted">${esc(p.itemName)} · ${p.qty} ${esc(p.unit)}</p>
    <div class="field"><label>Fornecedor</label><input name="supplier" list="supList" maxlength="60" value="${esc(p.supplier)}" placeholder="De onde está vindo"><datalist id="supList">${sup.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
    <div class="form-row"><div class="field"><label>Previsão de chegada</label><input name="eta" type="date" value="${esc(p.eta)}"></div><div class="field"><label>Prioridade</label><select name="priority">${PRIORITIES.map(x => `<option ${x === p.priority ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
    <div class="field"><label>Observação</label><textarea name="note" rows="3" placeholder="Ex.: transportadora atrasou, novo prazo informado pelo fornecedor...">${esc(p.note)}</textarea></div>
    <button class="btn primary full" type="submit">Salvar atualização</button></form>`, r => {
    r.querySelector('#peForm').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      addHist(p, ['Atualizou o pedido', f.get('supplier').trim() && 'fornecedor ' + f.get('supplier').trim(), f.get('eta') && 'previsão ' + fmtDay(f.get('eta')), f.get('note').trim() && 'obs.: ' + f.get('note').trim()].filter(Boolean).join(' · '));
      Object.assign(p, { supplier: f.get('supplier').trim(), eta: f.get('eta') || '', priority: f.get('priority'), note: f.get('note').trim(), updatedBy: currentUser.name, updatedAt: Date.now() });
      persist(); closeModal(); toast('Pedido atualizado.'); renderPurchases();
    };
  });
}
function receiveForm(id) {
  if (!can('purchase') || !can('entrada')) return;
  const p = S.purchases.find(x => x.id === Number(id)); let x = p && itemById(p.itemId);
  if (!p || (!x && !p.isNew)) { toast('Peça da solicitação não encontrada.'); return }
  const isNew = !x, left = Math.max(1, p.qty - p.received), today = isoDate(0);
  openModal('Registrar recebimento', `<form id="receiveForm"><p class="muted">${esc(p.itemName)} · pedido ${p.qty} ${esc(p.unit)} · já recebido ${p.received}</p>
    ${isNew ? `<div class="new-item-box"><b class="box-title">🆕 Cadastro do item novo</b>
      <div class="field"><label>Código da peça *</label><input name="code" required maxlength="40" placeholder="Código específico da peça"></div>
      <div class="form-row"><div class="field"><label>Categoria</label><select name="cat">${cats().map(c => `<option ${c === p.newCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div><div class="field"><label>Estoque mínimo</label><input name="min" type="number" min="0" value="1"></div></div>
      <div class="field"><label>Foto da peça</label><div class="photo-field"><div class="photo-prev" id="rcPrev">📷</div><div class="photo-btns"><button class="btn secondary sm" type="button" id="rcPick">📷 Anexar foto</button><button class="btn ghost sm danger hidden" type="button" id="rcRm">Remover</button></div></div></div></div>` : ''}
    <div class="form-row"><div class="field"><label>Número da nota fiscal *</label><input name="nf" required maxlength="30" placeholder="Ex.: 12345"></div><div class="field"><label>Data de recebimento</label><input name="date" type="date" value="${today}" max="${today}"></div></div>
    <div class="field"><label>Fornecedor *</label><input name="supplier" required maxlength="60" value="${esc(p.supplier)}"></div>
    <div class="field"><label>Quantidade que chegou *</label><input name="qty" type="number" min="1" required value="${left}"></div>
    ${isNew ? '<div class="field"><label>Onde será guardado (rua › lado › nível › caixa) *</label></div>' : `<div class="field"><label>Guardar em</label><select name="loc">${x.locations.map((l, i) => `<option value="${i}">${esc(locLabel(l))}</option>`).join('')}<option value="new">＋ Novo local…</option></select></div>`}
    <div id="rcNew" class="${isNew ? '' : 'hidden'}">${newLocFields()}</div>
    <button class="btn primary full" type="submit">${isNew ? 'Cadastrar item e dar entrada' : 'Dar entrada no estoque'}</button></form>`, r => {
    let photo = '';
    if (isNew) {
      const prev = r.querySelector('#rcPrev'), rm = r.querySelector('#rcRm'), pick = r.querySelector('#rcPick');
      const paint = () => { prev.innerHTML = photo ? `<img src="${photo}" alt="">` : '📷'; rm.classList.toggle('hidden', !photo); pick.textContent = photo ? '🔄 Trocar foto' : '📷 Anexar foto' };
      pick.onclick = () => pickImage(async f => { try { photo = await readImage(f, 700, .78, false); paint() } catch (err) { toast('Não foi possível ler essa imagem.') } });
      rm.onclick = () => { photo = ''; paint() };
    }
    const sel = r.querySelector('[name=loc]'); if (sel) sel.onchange = () => r.querySelector('#rcNew').classList.toggle('hidden', sel.value !== 'new');
    r.querySelector('#receiveForm').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), q = parseInt(f.get('qty')), nf = f.get('nf').trim(), supplier = f.get('supplier').trim();
      if (!(q > 0) || !nf || !supplier) { toast('Informe nota fiscal, fornecedor e quantidade.'); return }
      let l, created = false;
      if (isNew) {
        const code = (f.get('code') || '').trim(); if (!code) { toast('Informe o código da peça.'); return }
        if (S.items.some(i => i.code.toLowerCase() === code.toLowerCase())) { toast('Já existe uma peça com este código.'); return }
        l = readNewLoc(r.querySelector('#rcNew')); if (!l.street && !l.level && !l.bin) { toast('Informe a rua, o nível ou a caixa onde será guardado.'); return }
        const cat = f.get('cat') || p.newCat || 'Outros'; if (!S.categories.includes(cat)) S.categories.push(cat);
        x = { id: uid(), name: p.itemName, code, category: cat, unit: p.unit, min: Math.max(0, parseInt(f.get('min')) || 0), locations: [l], photo };
        S.items.push(x); p.itemId = x.id; p.itemCode = code; p.isNew = false; created = true;
      } else if (f.get('loc') === 'new') {
        l = readNewLoc(r.querySelector('#rcNew')); if (!l.street && !l.level && !l.bin) { toast('Informe a rua, o nível ou a caixa do novo local.'); return }
        x.locations.push(l);
      } else l = x.locations[Number(f.get('loc'))];
      const at = new Date((f.get('date') || today) + 'T12:00:00').getTime();
      l.qty += q; p.received += q; if (!p.supplier) p.supplier = supplier;
      p.receipts.push({ id: uid(), at, nf, qty: q, supplier, loc: locLabel(l), user: currentUser.name });
      logMove(x, 'entrada', q, locLabel(l), `Recebimento NF ${nf} · ${supplier}`, '');
      if (created) addHist(p, `Cadastrou o item no estoque (código ${x.code})`);
      addHist(p, `Recebeu ${q} ${x.unit} · NF ${nf} · ${supplier}`);
      if (p.received >= p.qty) { p.status = 'Recebida'; p.receivedAt = at } else p.status = 'Recebida parcialmente';
      p.updatedBy = currentUser.name; p.updatedAt = Date.now();
      persist(); closeModal(); toast(created ? 'Item cadastrado e estoque atualizado!' : p.status === 'Recebida' ? 'Compra recebida e estoque atualizado.' : 'Recebimento parcial registrado.'); refresh();
    };
  });
}
/* ---------- histórico ---------- */
function renderHistory() {
  const q = ($('#historySearch').value || '').toLowerCase().trim(), f = $('#historyFilter').value;
  const list = S.movements.filter(m => (f === 'all' || (f === 'today' ? isToday(m.at) : m.type === f)) && `${m.itemName} ${m.itemCode} ${can('users') ? m.user : ''} ${m.reason} ${m.loc} ${m.note}`.toLowerCase().includes(q));
  $('#historyList').innerHTML = list.length ? list.map(moveHTML).join('') : '<div class="empty-state">Nenhuma movimentação encontrada.</div>';
}
$('#historySearch').addEventListener('input', renderHistory); $('#historyFilter').addEventListener('change', renderHistory);

/* ---------- equipamentos ---------- */
let editPins = false;
function renderEquipment() {
  const q = ($('#equipmentSearch').value || '').toLowerCase().trim();
  const list = S.equipment.filter(e => (e.name + ' ' + e.sector).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  $('#equipmentList').innerHTML = list.length ? list.map(e => `<div class="equipment-card clickable" data-act="equip" data-id="${e.id}">${e.image ? `<div class="equipment-symbol zoomable" data-zoom="photo" data-eq="${e.id}" title="Ampliar foto"><img src="${e.image}" alt=""></div>` : `<div class="equipment-symbol">${e.icon}</div>`}<div class="product-info"><b>${esc(e.name)}</b><small>${esc(e.sector)} · ${e.parts.filter(itemById).length} peças vinculadas</small></div><span>›</span></div>`).join('') : '<div class="empty-state">Nenhum equipamento encontrado.</div>';
}
$('#equipmentSearch').addEventListener('input', renderEquipment);
function openEquip(id) { const e = equipById(id); if (!e) return; currentEquipId = e.id; editPins = false; showView('equipdetail') }
function renderEquipDetail() {
  const e = equipById(currentEquipId); if (!e) { showView('equipment', true); return }
  const parts = e.parts.map(itemById).filter(Boolean), pins = e.pins.filter(p => itemById(p.itemId));
  const exploded = e.exploded
    ? `<div class="exploded ${editPins ? 'editing' : ''}" id="exploded"><img src="${e.exploded}" alt="Desenho explodido de ${esc(e.name)}" draggable="false" ${editPins ? '' : `class="zoomable" data-zoom="exploded" data-eq="${e.id}"`}>${pins.map((p, i) => `<button class="pin" style="left:${p.x}%;top:${p.y}%" data-act="pin" data-id="${p.id}" title="${esc(itemById(p.itemId).name)}">${i + 1}</button>`).join('')}</div>
    ${editPins ? '<p class="edit-hint">Modo edição: toque no desenho onde fica a peça e escolha qual é. Toque num ponto para trocar ou remover.</p>' : pins.length ? '<p class="edit-hint">Toque num número para abrir a peça. Toque no desenho para ampliar.</p>' : can('equip') ? '<p class="edit-hint">Nenhuma peça marcada ainda. Toque em “Editar pontos” para marcar as peças no desenho.</p>' : ''}
    ${pins.length ? `<div class="pin-legend">${pins.map((p, i) => { const x = itemById(p.itemId); return `<div class="application-row clickable" data-act="item" data-id="${x.id}"><span><b class="pin-num">${i + 1}</b> ${esc(x.name)}<small>${esc(x.code)}</small></span><span class="stock-meta"><b>${total(x)} ${esc(x.unit)}</b>${pill(x)}</span></div>` }).join('')}</div>` : ''}`
    : `<div class="empty-inline">${can('equip') ? 'Envie o desenho explodido para marcar onde fica cada peça.' : 'Este equipamento ainda não tem desenho explodido.'}</div>`;
  $('#equipDetail').innerHTML = `<div class="detail-card"><div class="detail-top"><div class="detail-photo ${e.image ? 'zoomable' : ''}" ${e.image ? `data-zoom="photo" data-eq="${e.id}" title="Toque para ampliar"` : ''}>${e.image ? `<img src="${e.image}" alt="">` : e.icon}</div><div class="detail-title"><h2>${esc(e.name)}</h2><p>${esc(e.sector)}</p><p>${parts.length} peça(s) vinculada(s)</p></div></div>
  <div class="detail-actions sub"><button class="btn ghost" data-act="equipImage" data-perm="equip">📷 ${e.image ? 'Trocar foto' : 'Enviar foto do equipamento'}</button>${e.image ? '<button class="btn ghost danger" data-act="delImage" data-perm="equip">Remover foto</button>' : ''}</div>
  ${e.image ? '<p class="edit-hint" style="margin-top:6px">Toque no ícone acima para ampliar a foto.</p>' : ''}
  <div class="detail-section"><h3>🧩 Desenho explodido</h3>${exploded}
  <div class="detail-actions sub"><button class="btn ghost" data-act="explodedImage" data-perm="equip">🖼 ${e.exploded ? 'Trocar desenho' : 'Enviar desenho'}</button>${e.exploded ? `<button class="btn ${editPins ? 'primary' : 'ghost'}" data-act="togglePins" data-perm="equip">📍 ${editPins ? 'Concluir edição' : 'Editar pontos'}</button><button class="btn ghost danger" data-act="delExploded" data-perm="equip">Remover desenho</button>` : ''}</div></div>
  <div class="detail-section"><div class="sec-head"><h3>🔩 Peças utilizadas</h3><button class="btn ghost sm" data-act="addPart" data-perm="equip">＋ Adicionar peça</button></div>${parts.length ? parts.map(x => `<div class="application-row clickable" data-act="item" data-id="${x.id}"><span><b>${esc(x.name)}</b><small>${esc(x.code)}</small></span><span class="stock-meta"><b>${total(x)} ${esc(x.unit)}</b>${pill(x)}</span><button class="icon-btn rm-part" data-act="rmPart" data-id="${x.id}" data-perm="equip" title="Remover do equipamento">✕</button></div>`).join('') : '<div class="empty-inline">Nenhuma peça vinculada. Use “Adicionar peça” ou marque os pontos no desenho.</div>'}</div>
  <div class="detail-actions sub"><button class="btn ghost" data-act="editEquip" data-id="${e.id}" data-perm="equip">✎ Editar equipamento</button><button class="btn ghost danger" data-act="delEquip" data-id="${e.id}" data-perm="equip">🗑 Excluir</button></div></div>`;
  applyPermissions();
  const ex = $('#exploded');
  if (ex && editPins && can('equip')) ex.onclick = ev => {
    if (ev.target.closest('.pin')) return;
    const r = ex.getBoundingClientRect();
    pinForm(null, { x: +((ev.clientX - r.left) / r.width * 100).toFixed(2), y: +((ev.clientY - r.top) / r.height * 100).toFixed(2) });
  };
}
function partForm() {
  if (!can('equip')) return;
  const e = equipById(currentEquipId), free = S.items.filter(x => !e.parts.includes(x.id));
  if (!free.length) { toast('Todas as peças cadastradas já estão vinculadas.'); return }
  openModal('Adicionar peça ao equipamento', `<form id="partForm"><div class="field"><label>Peça</label><select name="item">${free.map(x => `<option value="${x.id}">${esc(x.name)} (${esc(x.code)})</option>`).join('')}</select></div><button class="btn primary full" type="submit">Vincular peça</button></form>`, r => {
    r.querySelector('#partForm').onsubmit = ev => { ev.preventDefault(); e.parts.push(Number(new FormData(ev.target).get('item'))); persist(); closeModal(); renderEquipDetail(); toast('Peça vinculada.') };
  });
}
function pinForm(pinId, pos) {
  if (!can('equip')) return;
  if (!S.items.length) { toast('Cadastre peças antes de marcar pontos.'); return }
  const e = equipById(currentEquipId), pin = pinId ? e.pins.find(p => p.id === Number(pinId)) : null;
  const opt = x => `<option value="${x.id}">${esc(x.name)} (${esc(x.code)})</option>`;
  const mine = S.items.filter(x => e.parts.includes(x.id)), others = S.items.filter(x => !e.parts.includes(x.id));
  openModal(pin ? 'Editar ponto' : 'Vincular peça a este ponto', `<form id="pinForm"><div class="field"><label>Peça</label><select name="item">${mine.length ? `<optgroup label="Peças deste equipamento">${mine.map(opt).join('')}</optgroup>` : ''}${others.length ? `<optgroup label="Outras peças">${others.map(opt).join('')}</optgroup>` : ''}</select></div>
    <button class="btn primary full" type="submit">Salvar ponto</button>${pin ? '<button class="btn ghost danger full" type="button" id="rmPin" style="margin-top:8px">Remover ponto</button>' : ''}</form>`, r => {
    if (pin) r.querySelector('[name=item]').value = pin.itemId;
    r.querySelector('#pinForm').onsubmit = ev => {
      ev.preventDefault(); const itemId = Number(new FormData(ev.target).get('item'));
      if (pin) pin.itemId = itemId; else e.pins.push({ id: uid(), x: pos.x, y: pos.y, itemId });
      if (!e.parts.includes(itemId)) e.parts.push(itemId);
      persist(); closeModal(); renderEquipDetail(); toast('Ponto salvo.');
    };
    const rm = r.querySelector('#rmPin'); if (rm) rm.onclick = () => { e.pins = e.pins.filter(p => p.id !== pin.id); persist(); closeModal(); renderEquipDetail() };
  });
}
function equipForm(id) {
  if (!can('equip')) return;
  const e = id ? equipById(id) : null;
  openModal(e ? 'Editar equipamento' : 'Cadastrar equipamento', `<form id="equipForm">
    <div class="field"><label>Foto do equipamento</label><div class="photo-field"><div class="photo-prev big" id="eqPrev">📷</div><div class="photo-btns"><button class="btn secondary sm" type="button" id="eqPick">📷 Anexar foto</button><button class="btn ghost sm danger hidden" type="button" id="eqRm">Remover</button></div></div>
    <small class="field-hint">É a foto que aparece na lista. O desenho explodido é enviado depois, dentro do equipamento.</small></div>
    <div class="field"><label>Nome *</label><input name="name" required maxlength="80" value="${esc(e?.name)}"></div>
    <div class="field"><label>Setor / Linha</label><input name="sector" value="${esc(e?.sector)}" placeholder="Ex.: Produção · Linha 01"></div>
    <button class="btn primary full" type="submit">${e ? 'Salvar alterações' : 'Cadastrar equipamento'}</button></form>`, r => {
    let photo = e?.image || '';
    const prev = r.querySelector('#eqPrev'), rm = r.querySelector('#eqRm'), pick = r.querySelector('#eqPick');
    const paint = () => { prev.innerHTML = photo ? `<img src="${photo}" alt="">` : '📷'; rm.classList.toggle('hidden', !photo); pick.textContent = photo ? '🔄 Trocar foto' : '📷 Anexar foto' };
    pick.onclick = () => pickImage(async f => { try { photo = await readImage(f, 800, .8, false); paint() } catch (err) { toast('Não foi possível ler essa imagem.') } });
    rm.onclick = () => { photo = ''; paint() };
    paint();
    r.querySelector('#equipForm').onsubmit = ev => {
      ev.preventDefault(); const f = new FormData(ev.target);
      const d = { name: f.get('name').trim(), sector: f.get('sector').trim() || 'Manutenção', image: photo };
      let target = e;
      if (e) Object.assign(e, d);
      else { target = { id: uid(), icon: '⚙️', exploded: '', parts: [], pins: [], ...d }; S.equipment.push(target) }
      persist(); closeModal(); toast(e ? 'Equipamento atualizado.' : 'Equipamento cadastrado!'); openEquip(target.id);
    };
  });
}

/* ---------- perfil e usuários ---------- */
function renderProfile() {
  paintAvatar($('#profileAvatar'), currentUser); $('#profileName').textContent = currentUser.name; $('#profileRole').textContent = currentUser.role;
  $('#removePhoto').classList.toggle('hidden', !currentUser.photo);
}
$('#photoBtn').onclick = () => pickImage(async f => {
  try { currentUser.photo = await readImage(f, 256, .85, true); persist(); paintAvatar($('#avatar'), currentUser); renderProfile(); toast('Foto de perfil atualizada.') }
  catch (e) { toast('Não foi possível ler essa imagem.') }
});
$('#removePhoto').onclick = () => { currentUser.photo = ''; persist(); paintAvatar($('#avatar'), currentUser); renderProfile(); toast('Foto removida.') };
function renderUsers() {
  $('#userList').innerHTML = S.users.map(u => `<div class="user-row">${avatarHTML(u)}<div class="product-info"><b>${esc(u.name)}${u.name === currentUser.name ? ' (você)' : ''}</b><small><span class="status-pill ${u.active ? 'success' : 'muted'}">${u.active ? 'Ativo' : 'Inativo'}</span></small></div>
    <select class="role-select" data-id="${esc(u.name)}">${roleNames().map(r => `<option ${r === u.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
    <button class="btn ghost sm" data-act="resetPin" data-id="${esc(u.name)}">Redefinir senha</button>
    <button class="btn ghost sm ${u.active ? 'danger' : ''}" data-act="toggleUser" data-id="${esc(u.name)}">${u.active ? 'Desativar' : 'Reativar'}</button></div>`).join('');
  renderRoles();
}
function setUserRole(name, role) {
  const u = S.users.find(x => x.name === name); if (!u) return;
  if (u.role === 'Administrador' && role !== 'Administrador' && activeAdmins() < 2) { toast('Mantenha pelo menos um administrador ativo.'); renderUsers(); return }
  u.role = role; persist(); toast(`Função de ${u.name}: ${role}.`);
  if (u.name === currentUser.name) { renderProfile(); applyPermissions(); if (!can('users')) showView('profile') }
}
const pinOK = p => /^\d{4}$/.test(p);
function userForm() {
  openModal('Novo usuário', `<form id="userForm"><div class="field"><label>Nome *</label><input name="name" required maxlength="30"></div>
    <div class="field"><label>E-mail de acesso *</label><input name="email" type="email" required placeholder="nome@empresa.com"></div>
    <div class="form-row"><div class="field"><label>Função</label><select name="role" id="roleSel">${roleNames().map(r => `<option>${esc(r)}</option>`).join('')}<option value="__new">＋ Criar nova função…</option></select></div><div class="field"><label>Senha inicial *</label><input name="pass" type="password" minlength="6" required></div></div>
    <div class="role-box hidden" id="newRoleWrap"><div class="field"><label>Nome da nova função *</label><input name="rolename" maxlength="30" placeholder="Ex.: Supervisor"></div>${permChecks()}</div>
    <button class="btn primary full" type="submit">Criar usuário</button></form>`, root => {
    const sel = root.querySelector('#roleSel'), wrap = root.querySelector('#newRoleWrap');
    sel.onchange = () => { const n = sel.value === '__new'; wrap.classList.toggle('hidden', !n); if (n) wrap.querySelector('[name=rolename]').focus() };
    root.querySelector('#userForm').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target), name = f.get('name').trim(), email = f.get('email').trim(), pass = f.get('pass');
      if (S.users.some(u => u.name.toLowerCase() === name.toLowerCase())) { toast('Já existe um usuário com esse nome.'); return }
      let role = f.get('role');
      try {
        if (role === '__new') {
          const nm = (f.get('rolename') || '').trim(), perms = readPerms(root);
          if (!nm) { toast('Informe o nome da nova função.'); return }
          if (roleNames().some(n => n.toLowerCase() === nm.toLowerCase())) { toast('Já existe uma função com esse nome.'); return }
          if (!checkPerms(perms)) return;
          S.roles.push({ name: nm, perms }); role = nm;
          await flushSync();   // a função precisa existir no banco antes de criar o usuário
        }
        const { profile } = await adminCall({ action: 'criar', email, password: pass, name, role });
        S.users.push({ id: profile.id, name: profile.name, role: profile.role, active: profile.active, pin: '', photo: '' });
        closeModal(); renderUsers(); toast('Usuário criado.');
      } catch (err) { toast('Não foi possível criar: ' + err.message) }
    };
  });
}
function resetPinForm(name) {
  const u = S.users.find(x => x.name === name); if (!u) return;
  openModal('Redefinir senha de ' + name, `<form id="resetForm"><div class="field"><label>Nova senha (mínimo 6 caracteres)</label><input name="pass" type="password" minlength="6" required></div><button class="btn primary full" type="submit">Redefinir senha</button></form>`, r => {
    r.querySelector('#resetForm').onsubmit = async e => {
      e.preventDefault();
      try { await adminCall({ action: 'redefinir_senha', id: u.id, password: new FormData(e.target).get('pass') }); closeModal(); toast('Senha redefinida.') }
      catch (err) { toast('Não foi possível redefinir: ' + err.message) }
    };
  });
}
function changePinForm() {
  openModal('Alterar minha senha', `<form id="pwForm"><div class="field"><label>Senha atual</label><input name="old" type="password" required></div>
    <div class="form-row"><div class="field"><label>Nova senha</label><input name="p1" type="password" minlength="6" required></div><div class="field"><label>Confirmar</label><input name="p2" type="password" minlength="6" required></div></div>
    <button class="btn primary full" type="submit">Salvar nova senha</button></form>`, r => {
    r.querySelector('#pwForm').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      if (f.get('p1') !== f.get('p2')) { toast('A confirmação não confere.'); return }
      try {
        const { data: { user } } = await sb.auth.getUser();
        const check = await sb.auth.signInWithPassword({ email: user.email, password: f.get('old') });
        if (check.error) { toast('Senha atual incorreta.'); return }
        const { error } = await sb.auth.updateUser({ password: f.get('p1') });
        if (error) throw new Error(error.message);
        closeModal(); toast('Senha alterada com sucesso.');
      } catch (err) { toast('Não foi possível alterar: ' + err.message) }
    };
  });
}

/* ---------- relatórios ---------- */
const REPORTS = { inventory: 'Inventário (estoque atual)', low: 'Reposição: itens abaixo do mínimo ou zerados', moves: 'Movimentações (entradas e saídas)', in: 'Entradas no estoque', out: 'Saídas do estoque', byuser: 'Movimentações por colaborador', purchases: 'Pedidos de compra', receipts: 'Recebimentos (notas fiscais)', equipment: 'Equipamentos e peças vinculadas' };
const TIMED = ['moves', 'in', 'out', 'byuser', 'purchases', 'receipts'];
const dtFull = ts => new Date(ts).toLocaleString('pt-BR');
function reportData(k, from, to) {
  const f = from ? new Date(from + 'T00:00:00').getTime() : -Infinity, t = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
  const inR = ts => ts >= f && ts <= t, byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
  const MH = ['Data/hora', 'Tipo', 'Código', 'Peça', 'Qtd', 'Local', 'Responsável', 'Motivo', 'Observação'];
  const mrow = m => [dtFull(m.at), m.type === 'saida' ? 'Saída' : 'Entrada', m.itemCode, m.itemName, `${m.qty} ${m.unit || ''}`, m.loc, m.user, m.reason, m.note];
  const mv = type => S.movements.filter(m => inR(m.at) && (!type || m.type === type)).sort((a, b) => b.at - a.at);
  let head, rows, summary = [];
  if (k === 'inventory') {
    const it = [...S.items].sort(byName);
    head = ['Código', 'Peça', 'Categoria', 'Un.', 'Saldo', 'Mínimo', 'Situação', 'Locais (rua · lado · nível · caixa: qtd)'];
    rows = it.map(x => [x.code, x.name, x.category, x.unit, total(x), x.min, PILL[stateOf(x)][1], x.locations.map(l => `${locLabel(l)}: ${l.qty}`).join(' | ')]);
    summary = [`${it.length} itens cadastrados`, `${it.filter(x => stateOf(x) === 'low').length} com estoque baixo`, `${it.filter(x => stateOf(x) === 'zero').length} sem estoque`];
  } else if (k === 'low') {
    const it = S.items.filter(x => stateOf(x) !== 'ok').sort(byName);
    head = ['Código', 'Peça', 'Categoria', 'Saldo', 'Mínimo', 'Situação', 'Sugestão de reposição', 'Pedido em aberto'];
    rows = it.map(x => [x.code, x.name, x.category, `${total(x)} ${x.unit}`, `${x.min} ${x.unit}`, PILL[stateOf(x)][1], `${Math.max(0, x.min * 2 - total(x))} ${x.unit}`, S.purchases.some(p => p.itemId === x.id && isOpen(p)) ? 'Sim' : 'Não']);
    summary = [`${it.length} itens precisam de reposição`];
  } else if (k === 'moves' || k === 'in' || k === 'out') {
    const list = mv(k === 'in' ? 'entrada' : k === 'out' ? 'saida' : null);
    head = MH; rows = list.map(mrow); summary = [`${list.length} registros`];
    if (k === 'moves') summary.push(`${list.filter(m => m.type === 'entrada').length} entradas`, `${list.filter(m => m.type === 'saida').length} saídas`);
  } else if (k === 'byuser') {
    const g = {}; mv().forEach(m => { const u = g[m.user] = g[m.user] || { out: 0, inn: 0, last: 0 }; if (m.type === 'saida') u.out++; else u.inn++; u.last = Math.max(u.last, m.at) });
    head = ['Colaborador', 'Saídas', 'Entradas', 'Última movimentação'];
    rows = Object.entries(g).sort((a, b) => b[1].out - a[1].out).map(([n, u]) => [n, u.out, u.inn, dtFull(u.last)]);
    summary = [`${rows.length} colaboradores com movimentação`];
  } else if (k === 'purchases') {
    const list = S.purchases.filter(p => inR(p.at)).sort((a, b) => b.at - a.at);
    head = ['Data', 'Código', 'Peça', 'Qtd', 'Recebido', 'Prioridade', 'Status', 'Solicitante', 'Fornecedor', 'Previsão', 'Visualizado por'];
    rows = list.map(p => [new Date(p.at).toLocaleDateString('pt-BR'), p.itemCode || 'Item novo', p.itemName, `${p.qty} ${p.unit}`, p.received, p.priority, p.status, p.requester, p.supplier, fmtDay(p.eta), p.seenBy ? `${p.seenBy} (${dtFull(p.seenAt)})` : '—']);
    summary = [`${list.length} pedidos`, `${list.filter(isOpen).length} em aberto`, `${list.filter(p => p.status === 'Recebida').length} recebidos`];
  } else if (k === 'receipts') {
    const arr = S.purchases.flatMap(p => (p.receipts || []).filter(r => inR(r.at)).map(r => ({ at: r.at, row: [new Date(r.at).toLocaleDateString('pt-BR'), r.nf, p.itemName, `${r.qty} ${p.unit}`, r.supplier, r.loc, r.user, `#${p.id}`] }))).sort((a, b) => b.at - a.at);
    head = ['Data', 'Nota fiscal', 'Peça', 'Qtd', 'Fornecedor', 'Guardado em', 'Recebido por', 'Pedido']; rows = arr.map(a => a.row); summary = [`${rows.length} recebimentos`];
  } else {
    head = ['Equipamento', 'Setor', 'Peça', 'Código', 'Saldo'];
    rows = [...S.equipment].sort(byName).flatMap(e => { const ps = e.parts.map(itemById).filter(Boolean); return ps.length ? ps.map(x => [e.name, e.sector, x.name, x.code, `${total(x)} ${x.unit}`]) : [[e.name, e.sector, '—', '—', '—']] });
    summary = [`${S.equipment.length} equipamentos`];
  }
  return { title: REPORTS[k], head, rows, summary, period: TIMED.includes(k) ? `Período: ${from ? fmtDay(from) : 'início'} a ${to ? fmtDay(to) : 'hoje'}` : 'Posição atual' };
}
const tableHTML = (d, limit) => { const rows = limit ? d.rows.slice(0, limit) : d.rows; return `<div class="rep-table-wrap"><table class="rep-table"><thead><tr>${d.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${d.head.length}" class="rep-empty">Nenhum registro neste período.</td></tr>`}</tbody></table></div>` };
const currentReport = () => reportData($('#repType').value, $('#repFrom').value, $('#repTo').value);
function drawReport() {
  const d = currentReport();
  $('#repDates').classList.toggle('hidden', !TIMED.includes($('#repType').value));
  $('#repPreview').innerHTML = `<div class="rep-head"><b>${esc(d.title)}</b><small>${esc(d.period)}</small><div class="rep-sum">${d.summary.map(s => `<span>${esc(s)}</span>`).join('')}</div></div>${tableHTML(d, 150)}${d.rows.length > 150 ? `<p class="rep-more">Mostrando 150 de ${d.rows.length} linhas. A impressão e o CSV trazem todas.</p>` : ''}`;
}
function renderReports() {
  const sel = $('#repType');
  if (!sel.options.length) { sel.innerHTML = Object.entries(REPORTS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''); $('#repFrom').value = isoDate(-30); $('#repTo').value = isoDate(0) }
  drawReport();
}
function exportReport() { const d = currentReport(); download(`relatorio-${$('#repType').value}-${stamp()}.csv`, csv([d.head, ...d.rows])) }
function printReport() {
  const d = currentReport(), pa = $('#printArea');
  pa.className = 'rep';
  pa.innerHTML = `<div class="rep-doc"><div class="rep-doc-head"><h1>Almoxarifado Manutenção</h1><h2>${esc(d.title)}</h2><p>${esc(d.period)} · Emitido por ${esc(currentUser.name)} em ${dtFull(Date.now())}</p><p>${d.summary.map(s => esc(s)).join(' · ')}</p></div>${tableHTML(d)}<div class="rep-sign"><span>Responsável: ______________________________</span><span>Data: ____/____/________</span></div></div>`;
  window.addEventListener('afterprint', () => { pa.innerHTML = ''; pa.className = '' }, { once: true });
  setTimeout(() => window.print(), 100);
}
$('#repType').onchange = drawReport; $('#repFrom').onchange = drawReport; $('#repTo').onchange = drawReport;
$('#repPrint').onclick = printReport; $('#repCsv').onclick = exportReport;
$$('[data-range]').forEach(b => b.onclick = () => {
  const r = b.dataset.range, today = isoDate(0);
  const m = { today: [today, today], 7: [isoDate(-7), today], 30: [isoDate(-30), today], month: [today.slice(0, 8) + '01', today], all: ['', ''] }[r];
  $('#repFrom').value = m[0]; $('#repTo').value = m[1]; drawReport();
});
function runReport(k) {
  if (k === 'labels') { if (!S.items.length) { toast('Nenhuma peça cadastrada.'); return } printLabels(S.items) }
  if (k === 'backup' && can('users')) download(`backup-almoxarifado-${stamp()}.json`, JSON.stringify(S, null, 1), 'application/json');
  if (k === 'restore' && can('users')) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => {
      try {
        const d = JSON.parse(await i.files[0].text());
        if (!['items', 'equipment', 'movements', 'purchases', 'users'].every(k => Array.isArray(d[k])) || !d.users.some(u => u.role === 'Administrador' && u.active)) throw 0;
        if (!confirm('Substituir todos os dados deste aparelho pelo backup?')) return;
        S = d; persist(); location.reload();
      } catch (e) { toast('Arquivo de backup inválido.') }
    }; i.click();
  }
  if (k === 'reset' && CLOUD) { toast('Indisponível enquanto o banco está na nuvem.'); return }
  if (k === 'reset' && can('users') && confirm('Apagar todos os dados e voltar ao exemplo inicial?')) { try { localStorage.removeItem(KEY); localStorage.removeItem(SESSION) } catch (e) { } location.reload() }
}
$$('[data-r]').forEach(b => b.onclick = () => runReport(b.dataset.r));

/* ---------- categorias (administração) ---------- */
function renderCategories() {
  $('#catList').innerHTML = cats().map(c => { const n = S.items.filter(i => i.category === c).length; return `<div class="user-row cat-row"><span class="cat-ico">${ICONS[c] || '📦'}</span><div class="product-info"><b>${esc(c)}</b><small>${n} peça(s)</small></div><button class="btn ghost sm" data-act="renameCat" data-id="${esc(c)}">✎ Renomear</button><button class="btn ghost sm danger" data-act="delCat" data-id="${esc(c)}">🗑 Excluir</button></div>` }).join('') || '<div class="empty-state">Nenhuma categoria cadastrada.</div>';
}
function catForm(old) {
  if (!can('items')) return;
  openModal(old ? 'Renomear categoria' : 'Nova categoria', `<form id="catForm"><div class="field"><label>Nome da categoria *</label><input name="cat" required maxlength="30" value="${esc(old || '')}" placeholder="Ex.: Vedações"></div><button class="btn primary full" type="submit">${old ? 'Salvar nome' : 'Criar categoria'}</button></form>`, root => {
    root.querySelector('#catForm').onsubmit = ev => {
      ev.preventDefault(); const nm = new FormData(ev.target).get('cat').trim();
      if (!nm) return;
      if (cats().some(c => c !== old && c.toLowerCase() === nm.toLowerCase())) { toast('Já existe uma categoria com esse nome.'); return }
      if (old) { S.categories = S.categories.map(c => c === old ? nm : c); S.items.forEach(i => { if (i.category === old) i.category = nm }) }
      else S.categories.push(nm);
      persist(); closeModal(); renderCategories(); toast(old ? 'Categoria renomeada.' : 'Categoria criada.');
    };
  });
}
function deleteCat(c) {
  if (!can('items')) return;
  const n = S.items.filter(i => i.category === c).length, others = cats().filter(k => k !== c);
  if (!others.length) { toast('Crie outra categoria antes de excluir esta.'); return }
  if (!n) { if (!confirm(`Excluir a categoria "${c}"?`)) return; S.categories = S.categories.filter(k => k !== c); persist(); renderCategories(); toast('Categoria excluída.'); return }
  openModal(`Excluir "${c}"`, `<form id="delCatForm"><p class="field-hint" style="font-size:12px;margin-bottom:12px">${n} peça(s) usam esta categoria. Escolha para onde elas vão antes de excluir.</p><div class="field"><label>Mover as peças para</label><select name="to">${others.map(k => `<option>${esc(k)}</option>`).join('')}</select></div><button class="btn primary full" type="submit">Mover e excluir</button></form>`, root => {
    root.querySelector('#delCatForm').onsubmit = ev => {
      ev.preventDefault(); const to = new FormData(ev.target).get('to');
      S.items.forEach(i => { if (i.category === c) i.category = to });
      S.categories = S.categories.filter(k => k !== c); persist(); closeModal(); renderCategories();
      toast(`Categoria excluída. ${n} peça(s) movida(s) para "${to}".`);
    };
  });
}

/* ---------- funções e permissões (administração) ---------- */
function permChecks(perms = []) {
  return `<span class="perm-title">Permissões desta função</span><div class="perm-grid">${ALL_PERMS.map(p => `<label class="perm-item"><input type="checkbox" name="perm" value="${p}" ${perms.includes(p) ? 'checked' : ''}><span>${PERM_LABELS[p]}</span></label>`).join('')}</div>`;
}
const readPerms = root => [...root.querySelectorAll('[name=perm]:checked')].map(c => c.value);
function checkPerms(perms) { if (!perms.length) { toast('Marque pelo menos uma permissão.'); return false } return true }
function renderRoles() {
  $('#roleList').innerHTML = S.roles.map(r => {
    const n = S.users.filter(u => u.role === r.name).length, locked = r.name === 'Administrador', np = rolePerms(r.name).length;
    return `<div class="user-row"><div class="product-info"><b>${esc(r.name)}${locked ? ' 🔒' : ''}</b><small>${np} permissão(ões) · ${n} usuário(s)</small></div><button class="btn ghost sm" data-act="editRole" data-id="${esc(r.name)}">${locked ? 'Ver' : 'Editar permissões'}</button>${locked || n ? '' : `<button class="btn ghost sm danger" data-act="delRole" data-id="${esc(r.name)}">Excluir</button>`}</div>`;
  }).join('');
}
function roleForm(name) {
  const r = name ? S.roles.find(x => x.name === name) : null, locked = !!r && r.name === 'Administrador';
  openModal(r ? `Permissões: ${r.name}` : 'Nova função', `<form id="roleForm">${r ? '' : '<div class="field"><label>Nome da função *</label><input name="rolename" required maxlength="30" placeholder="Ex.: Supervisor"></div>'}
    ${permChecks(r ? rolePerms(r.name) : [])}${locked ? '<p class="field-hint">A função Administrador tem sempre todas as permissões.</p>' : ''}
    <button class="btn primary full" type="submit" ${locked ? 'disabled' : ''}>${r ? 'Salvar permissões' : 'Criar função'}</button></form>`, root => {
    root.querySelector('#roleForm').onsubmit = ev => {
      ev.preventDefault(); if (locked) return;
      const perms = readPerms(root);
      if (!checkPerms(perms)) return;
      if (r) {
        r.perms = perms; persist(); closeModal(); renderUsers(); applyPermissions();
        if (!can('users') && activeView === 'users') showView('profile');
        toast('Permissões atualizadas.'); return;
      }
      const nm = (new FormData(ev.target).get('rolename') || '').trim();
      if (!nm) { toast('Informe o nome da função.'); return }
      if (roleNames().some(n => n.toLowerCase() === nm.toLowerCase())) { toast('Já existe uma função com esse nome.'); return }
      S.roles.push({ name: nm, perms }); persist(); closeModal(); renderUsers(); toast('Função criada.');
    };
  });
}
function deleteRole(name) {
  const r = S.roles.find(x => x.name === name); if (!r || r.name === 'Administrador') return;
  if (S.users.some(u => u.role === name)) { toast('Há usuários nesta função. Troque a função deles antes de excluir.'); return }
  if (!confirm(`Excluir a função "${name}"?`)) return;
  S.roles = S.roles.filter(x => x.name !== name); persist(); renderRoles(); toast('Função excluída.');
}

/* ---------- empréstimos de ferramentas ---------- */
let loanFilter = 'open';
const loanOpen = l => l.status === 'Emprestada';
const todayISO = () => isoDate(0);
function renderLoans() {
  const list = S.loans.filter(l => loanFilter === 'all' || (loanFilter === 'open') === loanOpen(l)).sort((a, b) => b.id - a.id);
  $('#loanList').innerHTML = list.length ? list.map(l => { const open = loanOpen(l); return `<article class="stock-card" data-act="loan" data-id="${l.id}"><div class="product-thumb">🧰</div><div class="product-info"><b>${esc(l.tool)}</b><small>${esc(l.company)} · retirou ${esc(l.withdrawnBy)}</small><small>Entregue por ${esc(l.deliveredBy)} · ${fmtDay(l.withdrawnAt)}</small></div><div class="stock-meta"><span class="status-pill ${open ? 'warning' : 'success'}">${open ? 'Emprestada' : 'Devolvida'}</span></div><span class="arrow">›</span></article>` }).join('') : '<div class="empty-state">Nenhum empréstimo nesta lista.</div>';
  $$('#loanFilters button').forEach(b => b.classList.toggle('active', b.dataset.f === loanFilter));
}
function sigPad(c) {
  const ctx = c.getContext('2d'); let drawing = false, has = false, last = null;
  const fit = () => { const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr)); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#172235'; has = false };
  fit(); c.style.touchAction = 'none';
  const pos = ev => { const r = c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top } };
  c.onpointerdown = ev => { drawing = true; last = pos(ev); c.setPointerCapture(ev.pointerId) };
  c.onpointermove = ev => { if (!drawing) return; const p = pos(ev); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; has = true };
  c.onpointerup = c.onpointercancel = () => { drawing = false };
  return {
    empty: () => !has,
    clear: () => { ctx.clearRect(0, 0, c.width, c.height); has = false },
    data: () => { const o = document.createElement('canvas'); o.width = 480; o.height = 160; const g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 480, 160); g.drawImage(c, 0, 0, 480, 160); return o.toDataURL('image/png') }
  };
}
function loanForm() {
  if (!can('loans')) return;
  const users = S.users.filter(u => u.active), tools = [...new Set(S.tools)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  openModal('Novo empréstimo de ferramenta', `<form id="loanForm">
    <div class="field"><label>Foto da ferramenta</label><div class="photo-field"><div class="photo-prev big" id="lnPrev">📷</div><div class="photo-btns"><button class="btn secondary sm" type="button" id="lnPick">📷 Tirar / anexar foto</button><button class="btn ghost sm danger hidden" type="button" id="lnRm">Remover</button></div></div></div>
    <div class="field"><label>Ferramenta *</label><input name="tool" required maxlength="60" list="toolList" placeholder="Ex.: Parafusadeira" autocomplete="off"><datalist id="toolList">${tools.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
    <div class="field"><label>Emprestada para (empresa) *</label><input name="company" required maxlength="60" placeholder="Ex.: IMAP"></div>
    <div class="form-row"><div class="field"><label>Retirada por (pessoa) *</label><input name="withdrawnBy" required maxlength="40" value="${esc(currentUser.name)}"></div>
    <div class="field"><label>Entregue por *</label><select name="deliveredBy">${users.map(u => `<option ${u.name === currentUser.name ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Data da entrega *</label><input name="date" type="date" required value="${todayISO()}"></div>
    <div class="field"><label>Assinatura de quem retirou *</label><div class="sig-box"><canvas id="sigCanvas"></canvas><span class="sig-hint">Assine aqui com o dedo ou o mouse</span></div><button type="button" class="text-btn" id="sigClear">Limpar assinatura</button></div>
    <div class="field"><label>Observações</label><textarea name="note" rows="2" maxlength="200" placeholder="Ex.: Devolver com a bateria carregada"></textarea></div>
    <button class="btn primary full" type="submit">Registrar empréstimo</button></form>`, root => {
    const pad = sigPad(root.querySelector('#sigCanvas'));
    let photo = '';
    const prev = root.querySelector('#lnPrev'), rm = root.querySelector('#lnRm'), pick = root.querySelector('#lnPick');
    const paint = () => { prev.innerHTML = photo ? `<img src="${photo}" alt="">` : '📷'; rm.classList.toggle('hidden', !photo); pick.textContent = photo ? '🔄 Trocar foto' : '📷 Tirar / anexar foto' };
    pick.onclick = () => pickImage(async f => { try { photo = await readImage(f, 800, .8, false); paint() } catch (err) { toast('Não foi possível ler essa imagem.') } });
    rm.onclick = () => { photo = ''; paint() };
    root.querySelector('#sigClear').onclick = () => pad.clear();
    root.querySelector('#loanForm').onsubmit = ev => {
      ev.preventDefault(); const f = new FormData(ev.target), tool = f.get('tool').trim();
      if (pad.empty()) { toast('Peça para quem retirou assinar.'); return }
      S.loans.unshift({ id: uid(), tool, photo, company: f.get('company').trim(), withdrawnBy: f.get('withdrawnBy').trim(), deliveredBy: f.get('deliveredBy'), withdrawnAt: f.get('date'), returnedAt: '', status: 'Emprestada', signature: pad.data(), note: f.get('note').trim(), createdBy: currentUser.name, createdAt: Date.now() });
      if (!S.tools.some(t => t.toLowerCase() === tool.toLowerCase())) S.tools.push(tool);
      persist(); closeModal(); loanFilter = 'open'; renderLoans(); toast('Empréstimo registrado.');
    };
  });
}
function loanDetail(id) {
  const l = S.loans.find(x => x.id === Number(id)); if (!l) return;
  const open = loanOpen(l);
  openModal(l.tool, `${l.photo ? `<div class="eq-photo zoomable" id="loanPhoto" title="Toque para ampliar"><img src="${l.photo}" alt="Foto da ferramenta"></div>` : ''}
    <div class="loan-info">
    <div class="loan-row"><span>Empresa</span><b>${esc(l.company)}</b></div>
    <div class="loan-row"><span>Retirada por</span><b>${esc(l.withdrawnBy)}</b></div>
    <div class="loan-row"><span>Entregue por</span><b>${esc(l.deliveredBy)}</b></div>
    <div class="loan-row"><span>Data da entrega</span><b>${fmtDay(l.withdrawnAt)}</b></div>
    <div class="loan-row"><span>Devolução</span><b>${l.returnedAt ? fmtDay(l.returnedAt) : 'Pendente'}</b></div>
    ${l.note ? `<p class="field-hint">“${esc(l.note)}”</p>` : ''}
    <div class="loan-sign" id="loanSig"><small>Assinatura de quem retirou</small><img src="${l.signature}" alt="Assinatura"></div></div>
    <button class="btn ghost full" type="button" id="printLoanBtn" style="margin-top:14px">🖨 Imprimir termo de responsabilidade</button>
    ${open && can('loans') ? `<form id="returnForm" class="return-box"><div class="field"><label>Data da devolução *</label><input name="date" type="date" required value="${todayISO()}"></div><button class="btn primary full" type="submit">✔ Dar baixa (devolvida)</button></form>` : ''}
    <p class="field-hint">Registrado por ${esc(l.createdBy)} em ${fmt(l.createdAt)}</p>`, root => {
    root.querySelector('#printLoanBtn').onclick = () => printLoan(l.id);
    const lp = root.querySelector('#loanPhoto img'); if (lp) lp.onclick = () => openLightbox(l.photo, l.tool);
    root.querySelector('#loanSig img').onclick = () => openLightbox(l.signature, 'Assinatura · ' + l.withdrawnBy);
    const rf = root.querySelector('#returnForm');
    if (rf) rf.onsubmit = ev => {
      ev.preventDefault(); const d = new FormData(ev.target).get('date');
      if (d < l.withdrawnAt) { toast('A devolução não pode ser antes da retirada.'); return }
      l.returnedAt = d; l.status = 'Devolvida'; l.returnedBy = currentUser.name;
      persist(); closeModal(); renderLoans(); toast('Baixa registrada.');
    };
  });
}

/* ---------- ampliar imagem (tela cheia) ---------- */
function openLightbox(src, title) {
  if (!src) return;
  const lb = $('#lightbox'); lb.querySelector('img').src = src; lb.querySelector('.lb-title').textContent = title || '';
  lb.classList.remove('hidden'); document.body.classList.add('modal-open');
}
function closeLightbox() {
  $('#lightbox').classList.add('hidden'); $('#lightbox img').removeAttribute('src');
  if ($('#modal').classList.contains('hidden')) document.body.classList.remove('modal-open');
}
$('#lbClose').onclick = closeLightbox;
$('#lightbox').addEventListener('click', ev => { if (ev.target.id === 'lightbox' || ev.target.classList.contains('lb-stage')) closeLightbox() });
$('#loanFilters').onclick = ev => { const b = ev.target.closest('[data-f]'); if (!b) return; loanFilter = b.dataset.f; renderLoans() };

/* ---------- termo de responsabilidade (impressão) ---------- */
function printLoan(id) {
  const l = S.loans.find(x => x.id === Number(id)); if (!l) return;
  const pa = $('#printArea'); pa.className = 'rep';
  pa.innerHTML = `<div class="term">
    <h1>Almoxarifado Manutenção</h1><h2>Termo de Responsabilidade – Empréstimo de Ferramenta</h2>
    <table class="term-table">
      <tr><th>Ferramenta</th><td>${esc(l.tool)}</td></tr>
      <tr><th>Empresa / destino</th><td>${esc(l.company)}</td></tr>
      <tr><th>Retirada por</th><td>${esc(l.withdrawnBy)}</td></tr>
      <tr><th>Entregue por</th><td>${esc(l.deliveredBy)}</td></tr>
      <tr><th>Data da retirada</th><td>${fmtDay(l.withdrawnAt)}</td></tr>
      <tr><th>Data da devolução</th><td>${l.returnedAt ? fmtDay(l.returnedAt) : '____/____/______'}</td></tr>
    </table>
    ${l.photo ? `<div class="term-photo"><img src="${l.photo}" alt=""></div>` : ''}
    ${l.note ? `<p><b>Observações:</b> ${esc(l.note)}</p>` : ''}
    <p class="term-text">Declaro que recebi a ferramenta acima descrita em perfeito estado de funcionamento e me comprometo a devolvê-la no mesmo estado em que a retirei do almoxarifado. Em caso de quebra, dano ou extravio, reconheço que sou responsável pelo equipamento, comprometendo-me a providenciar o conserto ou a reposição.</p>
    <div class="term-sign"><img src="${l.signature}" alt=""><div class="term-line"></div><small>Assinatura de ${esc(l.withdrawnBy)}</small></div>
    <p class="term-foot">Emitido por ${esc(currentUser.name)} em ${dtFull(Date.now())}</p></div>`;
  window.addEventListener('afterprint', () => { pa.innerHTML = ''; pa.className = '' }, { once: true });
  setTimeout(() => window.print(), 100);
}

/* ---------- conserto de equipamentos ---------- */
let repairFilter = 'open';
const repairOpen = r => r.status === 'Em conserto';
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5));
const repairDays = r => daysBetween(r.sentAt, r.returnedAt || isoDate(0));
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
function renderRepairs() {
  const list = S.repairs.filter(r => repairFilter === 'all' || (repairFilter === 'open') === repairOpen(r)).sort((a, b) => b.id - a.id);
  $('#repairList').innerHTML = list.length ? list.map(r => { const open = repairOpen(r); return `<article class="stock-card" data-act="repair" data-id="${r.id}"><div class="product-thumb">${r.photo ? `<img src="${r.photo}" alt="">` : '🔧'}</div><div class="product-info"><b>${esc(r.item)}</b><small>${esc(r.workshop)} · ${esc(r.service || 'Conserto')}</small><small>Enviado em ${fmtDay(r.sentAt)} por ${esc(r.sentBy)}</small></div><div class="stock-meta"><span class="status-pill ${open ? 'warning' : 'success'}">${open ? plural(repairDays(r), 'dia', 'dias') : 'Retornado'}</span></div><span class="arrow">›</span></article>` }).join('') : '<div class="empty-state">Nenhum item nesta lista.</div>';
  $$('#repairFilters button').forEach(b => b.classList.toggle('active', b.dataset.f === repairFilter));
}
function repairForm() {
  if (!can('repairs')) return;
  const users = S.users.filter(u => u.active), workshops = [...new Set(S.repairs.map(r => r.workshop))];
  openModal('Enviar para conserto', `<form id="repairForm">
    <div class="field"><label>Foto do equipamento ou peça</label><div class="photo-field"><div class="photo-prev big" id="rpPrev">📷</div><div class="photo-btns"><button class="btn secondary sm" type="button" id="rpPick">📷 Tirar / anexar foto</button><button class="btn ghost sm danger hidden" type="button" id="rpRm">Remover</button></div></div></div>
    <div class="field"><label>Equipamento ou peça *</label><input name="item" required maxlength="80" placeholder="Ex.: Eixo principal da bomba 02"></div>
    <div class="form-row"><div class="field"><label>Oficina / empresa *</label><input name="workshop" required maxlength="60" list="workshopList" placeholder="Ex.: Borges" autocomplete="off"><datalist id="workshopList">${workshops.map(w => `<option value="${esc(w)}">`).join('')}</datalist></div>
    <div class="field"><label>Serviço</label><input name="service" maxlength="80" placeholder="Ex.: Usinagem"></div></div>
    <div class="form-row"><div class="field"><label>Data do envio *</label><input name="date" type="date" required value="${todayISO()}"></div>
    <div class="field"><label>Enviado por *</label><select name="sentBy">${users.map(u => `<option ${u.name === currentUser.name ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Observações</label><textarea name="note" rows="2" maxlength="200" placeholder="Ex.: Retificar o rolamento do lado direito"></textarea></div>
    <button class="btn primary full" type="submit">Registrar envio</button></form>`, root => {
    let photo = '';
    const prev = root.querySelector('#rpPrev'), rm = root.querySelector('#rpRm'), pick = root.querySelector('#rpPick');
    const paint = () => { prev.innerHTML = photo ? `<img src="${photo}" alt="">` : '📷'; rm.classList.toggle('hidden', !photo); pick.textContent = photo ? '🔄 Trocar foto' : '📷 Tirar / anexar foto' };
    pick.onclick = () => pickImage(async f => { try { photo = await readImage(f, 800, .8, false); paint() } catch (err) { toast('Não foi possível ler essa imagem.') } });
    rm.onclick = () => { photo = ''; paint() };
    root.querySelector('#repairForm').onsubmit = ev => {
      ev.preventDefault(); const f = new FormData(ev.target);
      S.repairs.unshift({ id: uid(), item: f.get('item').trim(), workshop: f.get('workshop').trim(), service: f.get('service').trim(), photo, sentAt: f.get('date'), sentBy: f.get('sentBy'), returnedAt: '', status: 'Em conserto', note: f.get('note').trim(), createdBy: currentUser.name, createdAt: Date.now() });
      persist(); closeModal(); repairFilter = 'open'; renderRepairs(); toast('Envio para conserto registrado.');
    };
  });
}
function repairDetail(id) {
  const r = S.repairs.find(x => x.id === Number(id)); if (!r) return;
  const open = repairOpen(r);
  openModal(r.item, `${r.photo ? `<div class="eq-photo zoomable" id="repairPhoto" title="Toque para ampliar"><img src="${r.photo}" alt="Foto"></div>` : ''}
    <div class="loan-info">
    <div class="loan-row"><span>Oficina / empresa</span><b>${esc(r.workshop)}</b></div>
    <div class="loan-row"><span>Serviço</span><b>${esc(r.service || '—')}</b></div>
    <div class="loan-row"><span>Enviado por</span><b>${esc(r.sentBy)}</b></div>
    <div class="loan-row"><span>Data do envio</span><b>${fmtDay(r.sentAt)}</b></div>
    <div class="loan-row"><span>${open ? 'Dias no conserto' : 'Tempo no conserto'}</span><b>${plural(repairDays(r), 'dia', 'dias')}</b></div>
    <div class="loan-row"><span>Retorno</span><b>${r.returnedAt ? fmtDay(r.returnedAt) : 'Ainda não retornou'}</b></div>
    ${r.note ? `<p class="field-hint">“${esc(r.note)}”</p>` : ''}${r.returnNote ? `<p class="field-hint">Retorno: “${esc(r.returnNote)}”</p>` : ''}</div>
    ${open && can('repairs') ? `<form id="repairReturn" class="return-box"><div class="field"><label>Data do retorno *</label><input name="date" type="date" required value="${todayISO()}"></div><div class="field"><label>Observação do retorno</label><input name="rnote" maxlength="200" placeholder="Ex.: Serviço conferido"></div><button class="btn primary full" type="submit">✔ Dar baixa (retornou)</button></form>` : ''}
    <p class="field-hint">Registrado por ${esc(r.createdBy)} em ${fmt(r.createdAt)}</p>`, root => {
    const ph = root.querySelector('#repairPhoto img'); if (ph) ph.onclick = () => openLightbox(r.photo, r.item);
    const rf = root.querySelector('#repairReturn');
    if (rf) rf.onsubmit = ev => {
      ev.preventDefault(); const f = new FormData(ev.target), d = f.get('date');
      if (d < r.sentAt) { toast('O retorno não pode ser antes do envio.'); return }
      r.returnedAt = d; r.status = 'Retornado'; r.returnNote = f.get('rnote').trim(); r.returnedBy = currentUser.name;
      persist(); closeModal(); renderRepairs(); toast('Baixa registrada.');
    };
  });
}
$('#repairFilters').onclick = ev => { const b = ev.target.closest('[data-f]'); if (!b) return; repairFilter = b.dataset.f; renderRepairs() };

/* ---------- início do app ---------- */
$('#newLocWrap').innerHTML = newLocFields();
load(); renderLogin();
(async function boot() {
  let r = null;
  try { r = await cloudLoad() }
  catch (err) {
    if (isNet(err)) {
      const me = await restoreCache();
      if (me) { currentUser = me; enterApp(me); toast('Modo offline: usando os dados salvos neste aparelho.'); setSyncStatus(); return }
    }
    toast(err.message);
  }
  if (r) { currentUser = await bootCloud(r); enterApp(currentUser); setSyncStatus(); return }
  renderLogin();
})();

/* ---------- PWA: instalação e funcionamento offline ---------- */
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').classList.remove('hidden') });
window.addEventListener('appinstalled', () => { installEvt = null; $('#installBtn').classList.add('hidden'); toast('Aplicativo instalado!') });
if (isIOS && !isStandalone()) $('#installBtn').classList.remove('hidden');
$('#installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').classList.add('hidden') }
  else openModal('Instalar no iPhone / iPad', '<p style="font-size:13px;line-height:1.6">No Safari, toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.</p>');
};
