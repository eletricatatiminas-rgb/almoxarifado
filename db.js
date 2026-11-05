/* ============================================================
   Conexão com o Supabase: login, leitura, gravação, modo offline e conflitos.
   Pendências são calculadas comparando o estado atual com a última versão
   confirmada pelo banco ("snap"). Nada é enviado antes da leitura inicial.
   ============================================================ */
const SB_URL = 'https://gfbtuijlwxyreneatbwz.supabase.co';
const SB_KEY = 'sb_publishable_LsV-VRGIY7P8kePiuT6uDA_NSngB14e';
const BUCKET = 'imagens';
const CLOUD = true;
const sb = window.supabase.createClient(SB_URL, SB_KEY);

const TABLES = ['roles', 'profiles', 'categories', 'items', 'item_locations', 'equipment',
  'equipment_parts', 'equipment_pins', 'movements', 'purchases', 'loans', 'repairs'];
const KEYCOL = { roles: 'name', profiles: 'id', categories: 'name', items: 'id', equipment: 'id', purchases: 'id',
  loans: 'id', repairs: 'id', movements: 'id', item_locations: 'id', equipment_parts: 'equipment_id', equipment_pins: 'id' };
const VERSIONED = ['roles', 'profiles', 'categories', 'items', 'equipment', 'purchases', 'loans', 'repairs'];
const LABEL = { roles: 'Função', profiles: 'Usuário', categories: 'Categoria', items: 'Peça', equipment: 'Equipamento',
  purchases: 'Compra', loans: 'Empréstimo', repairs: 'Conserto' };
const CHUNK = 500;

let snap = null;              // última versão confirmada pelo banco (linhas por tabela)
let ver = {};                 // data da última alteração no banco, por registro: ver[tabela][chave]
let sessionUid = null;
let syncChain = Promise.resolve();
const pathOf = new Map();     // URL temporária ou foto nova (dataURL) -> caminho no bucket

const ts = s => s ? Date.parse(s) : null;
const numOr = (v, d = 0) => (v === null || v === undefined) ? d : Number(v);
const isoOrNull = ms => ms ? new Date(ms).toISOString() : null;
const dateOrNull = s => s || null;
const imgPath = v => !v ? '' : (pathOf.get(v) || '');
const groupBy = (rows, key) => { const m = new Map(); rows.forEach(r => { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r) }); return m };
const netError = () => new Error('Sem conexão com a internet.');
const isNet = e => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|Sem conexão/i.test(e.message || '');

/* ---------- banco -> app ---------- */
function fromRows(R) {
  const locs = groupBy(R.item_locations, 'item_id'), parts = groupBy(R.equipment_parts, 'equipment_id'), pins = groupBy(R.equipment_pins, 'equipment_id');
  const S2 = {
    roles: R.roles.map(r => ({ name: r.name, perms: r.perms || [] })),
    users: R.profiles.map(p => ({ id: p.id, name: p.name, role: p.role, active: p.active, pin: '', photo: '' })),
    categories: R.categories.map(c => c.name),
    items: R.items.map(i => ({ id: i.id, name: i.name, code: i.code, category: i.category || '', unit: i.unit, min: numOr(i.min), photo: i.photo_path || '',
      locations: (locs.get(i.id) || []).map(l => ({ street: l.street, side: l.side, level: l.level, bin: l.bin, qty: numOr(l.qty) })) })),
    equipment: R.equipment.map(e => ({ id: e.id, name: e.name, sector: e.sector, icon: e.icon, image: e.image_path || '', exploded: e.exploded_path || '',
      parts: (parts.get(e.id) || []).map(p => p.item_id),
      pins: (pins.get(e.id) || []).map(p => ({ id: p.id, x: numOr(p.x), y: numOr(p.y), itemId: p.item_id })) })),
    movements: R.movements.map(m => ({ id: m.id, type: m.type, itemId: m.item_id, itemName: m.item_name, itemCode: m.item_code, unit: m.unit,
      qty: numOr(m.qty), user: m.user_name, reason: m.reason, loc: m.loc, note: m.note, at: ts(m.created_at) })).sort((a, b) => b.at - a.at),
    purchases: R.purchases.map(p => ({ id: p.id, itemId: p.item_id, itemName: p.item_name, itemCode: p.item_code, unit: p.unit, qty: numOr(p.qty),
      received: numOr(p.received), status: p.status, priority: p.priority, requester: p.requester, justification: p.justification, at: ts(p.created_at),
      receivedAt: ts(p.received_at), supplier: p.supplier, eta: p.eta || '', receipts: p.receipts || [], note: p.note, seenAt: ts(p.seen_at), history: p.history || [] })),
    loans: R.loans.map(l => ({ id: l.id, tool: l.tool, photo: l.photo_path || '', company: l.company, withdrawnBy: l.withdrawn_by, deliveredBy: l.delivered_by,
      withdrawnAt: l.withdrawn_at, returnedAt: l.returned_at || '', status: l.status, signature: l.signature_path || '', note: l.note,
      createdBy: l.created_by, createdAt: ts(l.created_at), returnedBy: l.returned_by || '' })),
    repairs: R.repairs.map(r => ({ id: r.id, item: r.item, workshop: r.workshop, service: r.service, photo: r.photo_path || '', sentAt: r.sent_at,
      sentBy: r.sent_by, returnedAt: r.returned_at || '', status: r.status, note: r.note, returnNote: r.return_note, createdBy: r.created_by,
      createdAt: ts(r.created_at), returnedBy: r.returned_by || '' })),
  };
  S2.tools = [...new Set(S2.loans.map(l => l.tool))];
  S2.seen = {}; S2.catsV2 = true; S2.repairsV1 = true;
  S2.nextId = [...S2.items, ...S2.equipment, ...S2.movements, ...S2.purchases, ...S2.loans, ...S2.repairs]
    .reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  return S2;
}

/* Fotos no bucket privado: o banco guarda o caminho; o app mostra links temporários. */
function imageRefs(state) {
  const out = [];
  state.items.forEach(o => out.push([o, 'photo', 'itens']));
  state.equipment.forEach(o => { out.push([o, 'image', 'equipamentos']); out.push([o, 'exploded', 'equipamentos']) });
  state.loans.forEach(o => { out.push([o, 'photo', 'ferramentas']); out.push([o, 'signature', 'assinaturas']) });
  state.repairs.forEach(o => out.push([o, 'photo', 'consertos']));
  return out;
}
async function signPaths(paths) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error('Não foi possível carregar as fotos: ' + error.message);
  const map = {}; (data || []).forEach(d => { if (d.signedUrl) map[d.path] = d.signedUrl });
  return map;
}
async function resolveImages(state) {
  const refs = imageRefs(state).filter(([o, k]) => o[k] && !/^(data:|https?:)/.test(o[k]));
  if (!refs.length) return;
  const map = await signPaths([...new Set(refs.map(([o, k]) => o[k]))]);
  refs.forEach(([o, k]) => { const p = o[k]; o[k] = map[p] || ''; if (map[p]) pathOf.set(map[p], p) });
}
/* Links temporários expiram em 1 hora: troca por novos quando há conexão. */
async function resignImages(state) {
  const refs = imageRefs(state).filter(([o, k]) => o[k] && o[k].startsWith('https://') && pathOf.has(o[k]));
  if (!refs.length) return;
  const map = await signPaths([...new Set(refs.map(([o, k]) => pathOf.get(o[k])))]);
  refs.forEach(([o, k]) => { const p = pathOf.get(o[k]); if (map[p]) { o[k] = map[p]; pathOf.set(map[p], p) } });
}

/* Lê todas as tabelas. Sem sessão, devolve null. Sem rede, lança erro. */
async function cloudLoad() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const results = await Promise.all(TABLES.map(t => sb.from(t).select('*')));
  const R = {};
  TABLES.forEach((t, i) => { if (results[i].error) throw new Error(`Erro ao ler "${t}": ${results[i].error.message}`); R[t] = results[i].data || [] });
  const state = fromRows(R);
  const me = state.users.find(u => u.id === session.user.id);
  if (!me) throw new Error('Este login ainda não tem perfil no almoxarifado. Peça ao administrador para cadastrar.');
  if (!me.active) throw new Error('Acesso desativado. Fale com o administrador.');
  await resolveImages(state);
  const v = {};
  VERSIONED.forEach(t => { v[t] = {}; R[t].forEach(r => { if (r.updated_at) v[t][String(r[KEYCOL[t]])] = r.updated_at }) });
  return { state, me, ver: v, uid: session.user.id };
}

/* Coloca os dados do banco como estado atual do app. */
function adoptCloud(r) {
  S = r.state; migrate(); setSnapshot(S); ver = r.ver || {}; sessionUid = r.uid;
  scheduleSave();
}
function setSnapshot(state) { snap = snapshotRows(state) }

async function cloudLogin(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message.includes('Invalid login') ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar: ' + error.message);
  const r = await cloudLoad();
  if (!r) throw new Error('Não foi possível iniciar a sessão. Tente de novo.');
  return r;
}
async function cloudRefresh(silent = false) {
  const r = await cloudLoad();
  if (!r) return;
  adoptCloud(r); currentUser = S.users.find(u => u.id === r.uid) || currentUser;
  refresh(); setSyncStatus(); if (!silent) toast('Dados atualizados do banco.');
}
async function cloudSignOut() {
  snap = null; clearTimeout(saveT);
  try { await kvDel('cache') } catch (e) { }
  await sb.auth.signOut();
}

/* ---------- app -> banco: fotação, linhas e diferenças ---------- */
const rowRole = r => ({ name: r.name, perms: r.perms });
const rowProfile = u => ({ id: u.id, name: u.name, role: u.role, active: u.active });
const rowCategory = c => ({ name: c.name });
const rowItem = x => ({ id: x.id, name: x.name, code: x.code, category: x.category || null, unit: x.unit, min: x.min, photo_path: imgPath(x.photo) });
const rowsLocs = x => x.locations.map(l => ({ item_id: x.id, street: l.street || '', side: l.side || '', level: l.level || '', bin: l.bin || '', qty: l.qty }));
const rowEquip = e => ({ id: e.id, name: e.name, sector: e.sector, icon: e.icon, image_path: imgPath(e.image), exploded_path: imgPath(e.exploded) });
const rowsParts = e => e.parts.map(p => ({ equipment_id: e.id, item_id: p }));
const rowsPins = e => e.pins.map(p => ({ id: p.id, equipment_id: e.id, item_id: p.itemId, x: p.x, y: p.y }));
const rowMovement = m => ({ id: m.id, type: m.type, item_id: m.itemId, item_name: m.itemName, item_code: m.itemCode, unit: m.unit, qty: m.qty, user_name: m.user, reason: m.reason, loc: m.loc, note: m.note, created_at: isoOrNull(m.at) });
const rowPurchase = p => ({ id: p.id, item_id: p.itemId, item_name: p.itemName, item_code: p.itemCode, unit: p.unit, qty: p.qty, received: p.received, status: p.status, priority: p.priority, requester: p.requester, justification: p.justification, created_at: isoOrNull(p.at), received_at: isoOrNull(p.receivedAt), supplier: p.supplier, eta: dateOrNull(p.eta), note: p.note, seen_at: isoOrNull(p.seenAt), receipts: p.receipts, history: p.history });
const rowLoan = l => ({ id: l.id, tool: l.tool, photo_path: imgPath(l.photo), company: l.company, withdrawn_by: l.withdrawnBy, delivered_by: l.deliveredBy, withdrawn_at: l.withdrawnAt, returned_at: dateOrNull(l.returnedAt), status: l.status, signature_path: imgPath(l.signature), note: l.note, created_by: l.createdBy, returned_by: l.returnedBy || '', created_at: isoOrNull(l.createdAt) });
const rowRepair = r => ({ id: r.id, item: r.item, workshop: r.workshop, service: r.service, photo_path: imgPath(r.photo), sent_at: r.sentAt, sent_by: r.sentBy, returned_at: dateOrNull(r.returnedAt), status: r.status, note: r.note, return_note: r.returnNote || '', created_by: r.createdBy, returned_by: r.returnedBy || '', created_at: isoOrNull(r.createdAt) });

function snapshotRows(state) {
  const M = (arr, f, k = 'id') => new Map(arr.map(x => [String(x[k]), f(x)]));
  const K = (arr, f) => new Map(arr.map(x => [String(x.id), f(x)]));
  return {
    roles: M(state.roles, rowRole, 'name'),
    profiles: M(state.users, rowProfile),
    categories: M(state.categories.map(n => ({ name: n })), rowCategory, 'name'),
    items: M(state.items, rowItem),
    item_locations: K(state.items, rowsLocs),
    equipment: M(state.equipment, rowEquip),
    equipment_parts: K(state.equipment, rowsParts),
    equipment_pins: K(state.equipment, rowsPins),
    movements: M(state.movements, rowMovement),
    purchases: M(state.purchases, rowPurchase),
    loans: M(state.loans, rowLoan),
    repairs: M(state.repairs, rowRepair),
  };
}
function diff(prev, cur) {
  const upserts = [], deletes = [];
  cur.forEach((row, k) => { const p = prev.get(k); if (p === undefined || JSON.stringify(p) !== JSON.stringify(row)) upserts.push(row) });
  prev.forEach((_, k) => { if (!cur.has(k)) deletes.push(k) });
  return { upserts, deletes };
}
function computeDiffs(state) {
  const cur = snapshotRows(state), prev = snap || {}, dd = {};
  Object.keys(cur).forEach(k => dd[k] = diff(prev[k] || new Map(), cur[k]));
  return { cur, dd };
}
function pendingCount() {
  if (!snap || !S) return 0;
  const { dd } = computeDiffs(S);
  const rows = Object.values(dd).reduce((n, x) => n + x.upserts.length + x.deletes.length, 0);
  const photos = imageRefs(S).filter(([o, k]) => o[k] && o[k].startsWith('data:') && !pathOf.has(o[k])).length;
  return rows + photos;
}

/* Fotos novas sobem uma única vez; o caminho fica registrado. */
async function uploadPending(state) {
  for (const [o, k, folder] of imageRefs(state)) {
    const v = o[k];
    if (!v || !v.startsWith('data:') || pathOf.has(v)) continue;
    const blob = await (await fetch(v)).blob();
    const ext = blob.type === 'image/png' ? 'png' : 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw new Error('foto não enviada: ' + error.message);
    pathOf.set(v, path);
  }
}

/* Consulta o banco em lotes (evita URLs longas). */
async function selectIn(table, col, keys, cols) {
  const out = [];
  for (let i = 0; i < keys.length; i += 200) {
    const part = keys.slice(i, i + 200).map(k => col === 'name' ? k : Number(k));
    const res = await sb.from(table).select(cols).in(col, part);
    if (res.error) throw new Error(res.error.message);
    out.push(...(res.data || []));
  }
  return out;
}
/* Conflito: o registro mudou no banco desde a última vez que este aparelho o leu. */
async function findConflicts(dd) {
  const out = [];
  for (const t of VERSIONED) {
    const kc = KEYCOL[t], v = ver[t] || {}, d = dd[t], keys = [], dels = new Set(d.deletes);
    d.upserts.forEach(r => { const k = String(r[kc]); if (v[k] !== undefined) keys.push(k) });
    d.deletes.forEach(k => { if (v[k] !== undefined) keys.push(k) });
    if (!keys.length) continue;
    const srv = new Map((await selectIn(t, kc, keys, `${kc},updated_at`)).map(r => [String(r[kc]), r.updated_at]));
    keys.forEach(k => {
      const now = srv.get(k);
      if (now === undefined) { if (!dels.has(k)) out.push({ table: t, key: k }); return }   // apagado no banco enquanto eu editava
      if (Date.parse(now) !== Date.parse(v[k])) out.push({ table: t, key: k });
    });
  }
  return out;
}
/* Depois de gravar, guarda a data nova de cada registro enviado. */
async function refreshVer(dd) {
  for (const t of VERSIONED) {
    const kc = KEYCOL[t], v = ver[t] || (ver[t] = {});
    dd[t].deletes.forEach(k => delete v[k]);
    const keys = dd[t].upserts.map(r => String(r[kc]));
    if (!keys.length) continue;
    (await selectIn(t, kc, keys, `${kc},updated_at`)).forEach(r => { if (r.updated_at) v[String(r[kc])] = r.updated_at });
  }
}

async function syncNow(force = false) {
  if (!snap) return;
  if (!navigator.onLine) throw netError();
  await uploadPending(S);
  scheduleSave();
  const { cur, dd } = computeDiffs(S);
  if (!force) {
    const conflicts = await findConflicts(dd);
    if (conflicts.length) { const e = new Error('Alterações em conflito.'); e.conflicts = conflicts; throw e }
  }
  const ok = res => { if (res.error) throw new Error(res.error.message) };
  const up = async (table, conflict, rows) => { for (let i = 0; i < rows.length; i += CHUNK) ok(await sb.from(table).upsert(rows.slice(i, i + CHUNK), { onConflict: conflict })) };
  const insert = async (table, rows, ignoreDup = false) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const r = await sb.from(table).insert(rows.slice(i, i + CHUNK));
      if (r.error && !(ignoreDup && r.error.code === '23505')) throw new Error(r.error.message);
    }
  };
  const del = async (table, col, keys) => { for (let i = 0; i < keys.length; i += CHUNK) ok(await sb.from(table).delete().in(col, keys.slice(i, i + CHUNK))) };
  const replaceKids = async (table, col, kidsCur, kidsPrev) => {
    for (const [pid, rows] of kidsCur) {
      if (JSON.stringify(kidsPrev.get(pid)) === JSON.stringify(rows)) continue;
      ok(await sb.from(table).delete().eq(col, Number(pid)));
      await insert(table, rows);
    }
  };
  const prev = snap;
  // a ordem importa por causa das chaves estrangeiras
  await up('categories', 'name', dd.categories.upserts);
  await up('roles', 'name', dd.roles.upserts);
  await up('profiles', 'id', dd.profiles.upserts);
  await up('items', 'id', dd.items.upserts);
  await replaceKids('item_locations', 'item_id', cur.item_locations, prev.item_locations || new Map());
  await up('equipment', 'id', dd.equipment.upserts);
  await replaceKids('equipment_parts', 'equipment_id', cur.equipment_parts, prev.equipment_parts || new Map());
  await replaceKids('equipment_pins', 'equipment_id', cur.equipment_pins, prev.equipment_pins || new Map());
  await insert('movements', dd.movements.upserts, true);
  await up('purchases', 'id', dd.purchases.upserts);
  await up('loans', 'id', dd.loans.upserts);
  await up('repairs', 'id', dd.repairs.upserts);
  await del('equipment', 'id', dd.equipment.deletes.map(Number));
  await del('items', 'id', dd.items.deletes.map(Number));
  await del('purchases', 'id', dd.purchases.deletes.map(Number));
  await del('loans', 'id', dd.loans.deletes.map(Number));
  await del('repairs', 'id', dd.repairs.deletes.map(Number));
  await del('categories', 'name', dd.categories.deletes);
  await del('roles', 'name', dd.roles.deletes);
  await refreshVer(dd);
  snap = cur;
  scheduleSave();
}

/* Fila de gravação: uma por vez, na ordem em que as alterações aconteceram. */
function flushSync(force = false) { const p = syncChain.then(() => syncNow(force)); syncChain = p.catch(() => { }); return p }
let lastErr = '';
function queueSync() { flushSync().catch(handleSyncError).finally(setSyncStatus) }
function handleSyncError(e) {
  if (e.conflicts) return showConflicts(e.conflicts);
  if (isNet(e)) return;                                          // continua pendente; tenta de novo ao voltar a conexão
  if (e.message !== lastErr) toast('Não foi possível salvar na nuvem: ' + e.message);
  lastErr = e.message;
}
function showConflicts(list) {
  if ($('#modalTitle').textContent === 'Alterações em conflito' && !$('#modal').classList.contains('hidden')) return;
  const names = list.map(c => `${LABEL[c.table]} nº ${c.key}`).join(', ');
  openModal('Alterações em conflito', `<p style="font-size:12px;line-height:1.5">Estes registros foram alterados em outro aparelho enquanto você editava aqui: <b>${esc(names)}</b>.</p>
    <p style="font-size:12px;margin:12px 0">Qual versão deve valer?</p>
    <button class="btn primary full" id="cfKeep" type="button">Manter as minhas alterações</button>
    <button class="btn ghost full" id="cfServer" type="button" style="margin-top:8px">Usar a versão do banco (descarta minhas alterações)</button>`, root => {
    root.querySelector('#cfKeep').onclick = () => { closeModal(); flushSync(true).catch(handleSyncError).finally(setSyncStatus) };
    root.querySelector('#cfServer').onclick = async () => { closeModal(); try { await cloudRefresh() } catch (e) { toast(e.message) } };
  });
}

/* ---------- cache no aparelho (IndexedDB) ---------- */
let kvDb = null, saveT = null;
function kvOpen() {
  if (!kvDb) kvDb = new Promise((res, rej) => {
    const q = indexedDB.open('almoxarifado', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return kvDb;
}
async function kvTx(mode, f) {
  const db = await kvOpen();
  return new Promise((res, rej) => { const t = db.transaction('kv', mode); const r = f(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error) });
}
const kvPut = (k, v) => kvTx('readwrite', s => s.put(v, k));
const kvDel = k => kvTx('readwrite', s => s.delete(k));
const kvGet = async k => { const db = await kvOpen(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) }) };
const serSnap = sn => { const o = {}; Object.keys(sn).forEach(k => o[k] = [...sn[k].entries()]); return o };
const deserSnap = o => { const sn = {}; Object.keys(o).forEach(k => sn[k] = new Map(o[k])); return sn };
function scheduleSave() { if (!snap) return; clearTimeout(saveT); saveT = setTimeout(saveCache, 300) }
async function saveCache() {
  if (!snap || !S) return;
  try { await kvPut('cache', JSON.stringify({ S, snap: serSnap(snap), ver, pathOf: [...pathOf], uid: sessionUid })) }
  catch (e) { toast('Não foi possível guardar neste aparelho (espaço cheio?).') }
}
async function restoreCache() {
  const raw = await kvGet('cache'); if (!raw) return null;
  const c = JSON.parse(raw);
  S = c.S; migrate(); snap = deserSnap(c.snap); ver = c.ver || {}; sessionUid = c.uid;
  (c.pathOf || []).forEach(([k, v]) => pathOf.set(k, v));
  return S.users.find(u => u.id === sessionUid) || null;
}

/* ---------- indicador na barra superior ---------- */
function setSyncStatus() {
  const el = document.getElementById('syncStatus'); if (!el) return;
  const n = pendingCount(), on = navigator.onLine;
  el.className = 'sync-status ' + (!on ? 'off' : n ? 'pend' : 'ok');
  el.textContent = !on ? (n ? `Offline · ${n} pendente${n > 1 ? 's' : ''}` : 'Offline') : n ? `Salvando ${n}…` : 'Sincronizado';
}
window.addEventListener('online', () => { setSyncStatus(); queueSync(); resignImages(S).catch(() => { }) });
window.addEventListener('offline', setSyncStatus);
setInterval(() => { setSyncStatus(); if (navigator.onLine && snap && pendingCount()) queueSync() }, 20000);
setInterval(() => { if (navigator.onLine && snap) resignImages(S).catch(() => { }) }, 30 * 60 * 1000);

/* ---------- usuários: criar e redefinir senha passam pela função do servidor ---------- */
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke('admin-usuarios', { body });
  if (error) throw new Error(error.message);
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* Abertura com internet: se o cache do mesmo usuário tem alterações pendentes,
   elas são mantidas e enviadas (com verificação de conflito). Senão, vale o banco. */
async function bootCloud(r) {
  const raw = await kvGet('cache').catch(() => null);
  const c = raw ? JSON.parse(raw) : null;
  if (c && c.uid === r.uid) {
    S = c.S; migrate(); snap = deserSnap(c.snap); ver = c.ver || {}; sessionUid = c.uid;
    (c.pathOf || []).forEach(([k, v]) => pathOf.set(k, v));
    if (pendingCount() > 0) {
      flushSync().then(() => cloudRefresh(true)).catch(handleSyncError).finally(setSyncStatus);
      return S.users.find(u => u.id === r.uid) || r.me;
    }
  }
  adoptCloud(r);
  return r.me;
}
/* Atualização silenciosa: só quando não há nada pendente e nenhuma janela aberta. */
setInterval(() => {
  if (navigator.onLine && snap && !pendingCount() && $('#modal').classList.contains('hidden')) cloudRefresh(true).catch(() => { });
}, 120000);
