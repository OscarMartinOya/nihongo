'use strict';
/* global KANA_BASE, KATA_NOTES, KATA_EXT, PHRASE_UNITS, VOCAB_UNITS, KANJI_UNITS, PATH */

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const dayNum = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
const today = () => dayNum();
const toKata = (s) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

/* ---------- estado ---------- */
const KEY = 'nihongo-v1';
const defaults = () => ({
  v: 1, items: {}, trip: '2027-10-01', newPerDay: 7, romaji: true, autoAudio: true,
  streak: 0, best: 0, lastDay: null, hist: {}, newDay: null, newCount: 0,
});
let S;
try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { S = defaults(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- contenido ---------- */
const UNITS = {};
const ITEMS = {};
const KANA_TABLE = { h: [], k: [] }; // filas para la pestaña Kana

function addKanaUnit(script, g, note) {
  const uid = script + '_' + g.k;
  const unit = { id: uid, sec: script === 'h' ? 'Hiragana' : 'Katakana', t: g.t, n: note, items: [] };
  const row = [];
  g.c.split('|').forEach((p) => {
    if (p === '_') { row.push(null); return; }
    let [jp, ro] = p.split('=');
    if (script === 'k' && g.k !== 'ext') jp = toKata(jp);
    const id = script + ':' + jp;
    ITEMS[id] = { id, kind: 'kana', script, jp, ro, unit: uid };
    unit.items.push(id);
    row.push(id);
  });
  UNITS[uid] = unit;
  KANA_TABLE[script].push({ t: g.t, cells: row });
}
KANA_BASE.forEach((g) => addKanaUnit('h', g, g.n));
KANA_BASE.forEach((g) => addKanaUnit('k', g, g.k === 'a' ? KATA_NOTES.a : KATA_NOTES[g.k]));
addKanaUnit('k', KATA_EXT, KATA_EXT.n);

PHRASE_UNITS.forEach((u) => {
  UNITS[u.id] = { id: u.id, sec: 'Frases', cat: u.cat, t: u.t, n: u.n, items: [] };
  u.items.forEach((r, i) => {
    const id = u.id + ':' + i;
    ITEMS[id] = { id, kind: 'phrase', jp: r[0], kana: r[1] || '', ro: r[2], es: r[3], note: r[4] || '', unit: u.id };
    UNITS[u.id].items.push(id);
  });
});
VOCAB_UNITS.forEach((u) => {
  UNITS[u.id] = { id: u.id, sec: 'Vocabulario', cat: u.cat, t: u.t, n: u.n, items: [] };
  u.items.forEach((r, i) => {
    const id = u.id + ':' + i;
    ITEMS[id] = { id, kind: 'vocab', jp: r[0], kj: r[1] || '', ro: r[2], es: r[3], note: r[4] || '', unit: u.id };
    UNITS[u.id].items.push(id);
  });
});
KANJI_UNITS.forEach((u) => {
  UNITS[u.id] = { id: u.id, sec: 'Kanji', cat: u.cat, t: u.t, n: u.n, items: [] };
  u.items.forEach((r, i) => {
    const id = u.id + ':' + i;
    ITEMS[id] = { id, kind: 'kanji', jp: r[0], kana: r[1], ro: r[2], es: r[3], note: r[4] || '', unit: u.id };
    UNITS[u.id].items.push(id);
  });
});
const PATH_OK = PATH.filter((u) => UNITS[u]);
const ALL_IDS = PATH_OK.flatMap((u) => UNITS[u].items);

/* ---------- audio (voz japonesa del sistema) ---------- */
let jaVoice = null;
function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang));
  jaVoice = vs.find((v) => /kyoko|otoya|o-ren|google/i.test(v.name)) || vs[0] || null;
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
const ttsOK = () => 'speechSynthesis' in window;
function speak(text, rate = 0.85) {
  if (!ttsOK() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[〜~]/g, ''));
  u.lang = 'ja-JP'; u.rate = rate;
  if (jaVoice) u.voice = jaVoice;
  speechSynthesis.speak(u);
}
const sayText = (it) => (it.kind === 'kanji' ? it.kana.split(' / ')[0] : (it.kana || it.jp));

/* ---------- repetición espaciada ---------- */
function newLeft() {
  const used = S.newDay === today() ? S.newCount : 0;
  return Math.max(0, S.newPerDay - used);
}
function nextNew(n) {
  const out = [];
  for (const id of ALL_IDS) { if (out.length >= n) break; if (!S.items[id]) out.push(id); }
  return out;
}
const dueIds = () => { const t = today(); return Object.keys(S.items).filter((id) => ITEMS[id] && S.items[id].due <= t); };

function markActivity() {
  const t = today();
  if (S.lastDay !== t) {
    S.streak = S.lastDay === t - 1 ? S.streak + 1 : 1;
    S.lastDay = t;
    S.best = Math.max(S.best, S.streak);
  }
  S.hist[t] = (S.hist[t] || 0) + 1;
}
function currentStreak() { return S.lastDay !== null && S.lastDay >= today() - 1 ? S.streak : 0; }

function grade(id, ok, rec) {
  const t = today();
  let st = S.items[id];
  if (!st) {
    st = S.items[id] = { iv: 0, ef: 2.5, reps: 0, lapses: 0, due: t, added: t };
    if (S.newDay !== t) { S.newDay = t; S.newCount = 0; }
    S.newCount++;
  }
  if (ok) {
    if (rec.failed || rec.isNew) st.iv = 1;
    else {
      st.iv = st.iv < 1 ? 1 : st.iv < 3 ? 3 : Math.round(st.iv * st.ef * (0.95 + Math.random() * 0.1));
      st.ef = Math.min(3, st.ef + 0.05);
    }
    st.reps++;
    st.due = t + st.iv;
  } else {
    if (!rec.failed) { st.lapses++; st.ef = Math.max(1.3, st.ef - 0.2); }
    rec.failed = true;
    st.iv = 0; st.due = t;
  }
  markActivity();
  save();
}
const level = (id) => { const st = S.items[id]; return !st ? 0 : st.iv >= 7 ? 2 : 1; };

/* ---------- preguntas ---------- */
function quizType(it) {
  const r = S.items[it.id] ? S.items[it.id].reps : 0;
  if (it.kind === 'kana') return r < 2 ? 'k2r' : pick(['k2r', 'k2r', 'r2k']);
  if (it.kind === 'kanji') return r < 1 ? 'j2e' : pick(['j2e', 'e2j', 'j2r']);
  const t = r < 1 ? ['j2e'] : ['j2e', 'e2j'];
  if (r >= 2 && ttsOK()) t.push('a2e');
  return pick(t);
}
const sameKind = (a, b) => a.kind === b.kind && (a.kind !== 'kana' || a.script === b.script);

function optionText(it, type) {
  if (type === 'k2r') return it.ro;
  if (type === 'r2k' || type === 'e2j') return it.jp;
  if (type === 'j2r') return it.kana;
  return it.es;
}
function promptKey(it, type) { return type === 'r2k' ? it.ro : type === 'e2j' ? it.es : it.jp; }

function buildOptions(it, type) {
  const ans = optionText(it, type);
  const pk = promptKey(it, type);
  const pool = ALL_IDS.map((id) => ITEMS[id]).filter((o) => o.id !== it.id && sameKind(o, it));
  const ok = (o) => optionText(o, type) !== ans && promptKey(o, type) !== pk;
  const sameUnit = shuffle(pool.filter((o) => o.unit === it.unit && ok(o)));
  const seen = shuffle(pool.filter((o) => o.unit !== it.unit && S.items[o.id] && ok(o)));
  const rest = shuffle(pool.filter((o) => o.unit !== it.unit && !S.items[o.id] && ok(o)));
  const picked = [];
  const texts = new Set([ans]);
  for (const o of [...sameUnit.slice(0, 2), ...seen, ...sameUnit.slice(2), ...rest]) {
    if (picked.length >= 3) break;
    const tx = optionText(o, type);
    if (!texts.has(tx)) { texts.add(tx); picked.push(o); }
  }
  return shuffle([it, ...picked]);
}

/* ---------- números y precios ---------- */
const DK = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
const DR = ['', 'ichi', 'ni', 'san', 'yon', 'go', 'roku', 'nana', 'hachi', 'kyū'];
function readYen(n) {
  const k = [], r = [];
  const man = Math.floor(n / 10000), sen = Math.floor(n / 1000) % 10, hya = Math.floor(n / 100) % 10, ju = Math.floor(n / 10) % 10, one = n % 10;
  if (man) { k.push(DK[man] + 'まん'); r.push(DR[man] + 'man'); }
  if (sen) {
    const sp = { 1: ['せん', 'sen'], 3: ['さんぜん', 'sanzen'], 8: ['はっせん', 'hassen'] }[sen] || [DK[sen] + 'せん', DR[sen] + 'sen'];
    k.push(sp[0]); r.push(sp[1]);
  }
  if (hya) {
    const sp = { 1: ['ひゃく', 'hyaku'], 3: ['さんびゃく', 'sanbyaku'], 6: ['ろっぴゃく', 'roppyaku'], 8: ['はっぴゃく', 'happyaku'] }[hya] || [DK[hya] + 'ひゃく', DR[hya] + 'hyaku'];
    k.push(sp[0]); r.push(sp[1]);
  }
  if (ju) { k.push(ju === 1 ? 'じゅう' : DK[ju] + 'じゅう'); r.push(ju === 1 ? 'jū' : DR[ju] + 'jū'); }
  if (one) {
    if (one === 4) { k.push('よ'); r.push('yo'); } else { k.push(DK[one]); r.push(DR[one]); }
  }
  return { kana: k.join('') + 'えん', ro: r.join(' ') + ' en' };
}
const fmtYen = (n) => n.toLocaleString('es-ES') + ' 円';
function randPrice() {
  const x = Math.random();
  if (x < 0.4) return (1 + Math.floor(Math.random() * 99)) * 10;      // 10-990
  if (x < 0.85) return (10 + Math.floor(Math.random() * 90)) * 100;   // 1.000-9.900
  return (2 + Math.floor(Math.random() * 48)) * 1000;                 // 2.000-49.000
}
function priceDistractors(n) {
  const s = String(n).split('');
  const out = new Set();
  let guard = 0;
  while (out.size < 3 && guard++ < 50) {
    const d = s.slice();
    const nz = d.map((c, i) => (c !== '0' ? i : -1)).filter((i) => i >= 0);
    const i = pick(nz);
    d[i] = String(1 + ((+d[i] + Math.floor(Math.random() * 8)) % 9));
    let v = +d.join('');
    if (Math.random() < 0.25) v = n >= 1000 ? v / 10 : v * 10;
    v = Math.round(v);
    if (v !== n && v > 0 && v < 100000) out.add(v);
  }
  return [...out];
}

/* ---------- sesión ---------- */
let SES = null;

function startSession(opts = {}) {
  const q = [];
  if (opts.mode === 'price') {
    for (let i = 0; i < 10; i++) q.push({ type: 'price', listen: opts.listen });
  } else if (opts.mode === 'free') {
    const seen = shuffle(Object.keys(S.items).filter((id) => ITEMS[id])).slice(0, 15);
    seen.forEach((id) => q.push({ type: 'quiz', id }));
  } else {
    const due = shuffle(dueIds()).slice(0, 60);
    const fresh = nextNew(opts.extra != null ? opts.extra : newLeft());
    due.forEach((id) => q.push({ type: 'quiz', id }));
    for (let i = 0; i < fresh.length; i += 3) {
      const blk = fresh.slice(i, i + 3);
      blk.forEach((id) => q.push({ type: 'learn', id }));
      shuffle(blk.slice()).forEach((id) => q.push({ type: 'quiz', id }));
    }
    var isNew = new Set(fresh);
  }
  if (!q.length) return;
  SES = { q, i: 0, total: q.length, right: 0, wrong: 0, rec: {}, practice: !!opts.mode, isNew: isNew || new Set(), answered: false };
  $('#session').hidden = false;
  document.body.classList.add('in-session');
  renderCard();
}
function endSession() {
  SES = null;
  if (ttsOK()) speechSynthesis.cancel();
  $('#session').hidden = true;
  document.body.classList.remove('in-session');
  render();
}

function itemInfo(it, { big = true } = {}) {
  const ro = it.kind === 'kana' ? '' : `<div class="ro">${esc(it.ro)}</div>`;
  if (it.kind === 'kana') {
    return `<div class="jp ${big ? 'huge' : 'big'}">${esc(it.jp)}</div><div class="ro strong">${esc(it.ro)}</div>`;
  }
  const sub = it.kind === 'vocab' ? (it.kj ? `<div class="kana">${esc(it.kj)}</div>` : '')
    : (it.kana && it.kana !== it.jp ? `<div class="kana">${esc(it.kana)}</div>` : '');
  return `<div class="jp ${it.jp.length > 8 ? 'mid' : 'big'}">${esc(it.jp)}</div>${sub}${ro}<div class="es">${esc(it.es)}</div>` +
    (it.note ? `<div class="note">${esc(it.note)}</div>` : '');
}

function renderCard() {
  const box = $('#card');
  const pct = Math.round((SES.i / SES.q.length) * 100);
  $('#bar').style.width = pct + '%';
  if (SES.i >= SES.q.length) return renderSummary();
  const c = SES.q[SES.i];
  SES.answered = false;

  if (c.type === 'learn') {
    const it = ITEMS[c.id];
    const u = UNITS[it.unit];
    const first = u.items[0] === it.id && u.n;
    box.innerHTML = `
      <div class="tag new">Nuevo · ${esc(u.sec)} · ${esc(u.t)}</div>
      ${first ? `<div class="intro">${esc(u.n)}</div>` : ''}
      <div class="info">${itemInfo(it)}</div>
      <button class="audio" data-act="say" data-id="${esc(it.id)}" aria-label="Escuchar">🔊 Escuchar</button>
      <div class="foot"><button class="btn primary" data-act="next">Entendido</button></div>`;
    if (S.autoAudio) speak(sayText(it));
    return;
  }

  if (c.type === 'price') return renderPrice(c);

  const it = ITEMS[c.id];
  const type = c.qt || (c.qt = quizType(it));
  const opts = c.opts || (c.opts = buildOptions(it, type));
  let prompt = '';
  const showRo = S.romaji && it.kind !== 'kana';
  if (type === 'k2r') prompt = `<div class="ask">¿Cómo se lee?</div><div class="jp huge">${esc(it.jp)}</div>`;
  else if (type === 'r2k') prompt = `<div class="ask">¿Cuál es «${esc(it.ro)}»?</div>`;
  else if (type === 'j2e') prompt = `<div class="ask">¿Qué significa?</div><div class="jp ${it.jp.length > 8 ? 'mid' : 'big'}">${esc(it.jp)}</div>` +
    (it.kind === 'phrase' && it.kana ? `<div class="kana">${esc(it.kana)}</div>` : '') + (showRo ? `<div class="ro">${esc(it.ro)}</div>` : '');
  else if (type === 'e2j') prompt = `<div class="ask">¿Cómo se dice?</div><div class="es big-es">${esc(it.es)}</div>`;
  else if (type === 'j2r') prompt = `<div class="ask">¿Cómo se lee?</div><div class="jp big">${esc(it.jp)}</div>`;
  else if (type === 'a2e') prompt = `<div class="ask">Escucha: ¿qué significa?</div><button class="audio big" data-act="say" data-id="${esc(it.id)}">🔊</button>`;

  const jpOpts = type === 'r2k' || type === 'e2j' || type === 'j2r';
  box.innerHTML = `
    ${SES.isNew.has(it.id) && !S.items[it.id] ? '<div class="tag new">Nuevo</div>' : '<div class="tag">Repaso</div>'}
    <div class="prompt">${prompt}</div>
    <div class="opts ${jpOpts ? 'jp-opts' : ''} ${type === 'r2k' ? 'kana-opts' : ''}">
      ${opts.map((o, k) => `<button class="opt" data-act="ans" data-k="${k}">${esc(optionText(o, type))}${
        jpOpts && showRo && type !== 'j2r' ? `<small>${esc(o.ro)}</small>` : ''}${type === 'j2r' && S.romaji ? `<small>${esc(o.ro)}</small>` : ''}</button>`).join('')}
    </div>
    <div class="feedback" id="fb" hidden></div>`;
  if (type === 'a2e') speak(sayText(it));
}

function answer(k) {
  if (SES.answered) return;
  SES.answered = true;
  const c = SES.q[SES.i];
  if (c.type === 'price') return answerPrice(c, k);
  const it = ITEMS[c.id];
  const ok = c.opts[k].id === it.id;
  const btns = [...document.querySelectorAll('.opt')];
  btns.forEach((b, j) => { b.disabled = true; if (c.opts[j].id === it.id) b.classList.add('right'); });
  if (!ok) btns[k].classList.add('wrong');

  const rec = SES.rec[it.id] || (SES.rec[it.id] = { isNew: SES.isNew.has(it.id), failed: false });
  if (!SES.practice) grade(it.id, ok, rec);
  else markActivity(), save();
  if (ok) SES.right++; else SES.wrong++;
  if (!ok) {
    const again = { type: 'quiz', id: it.id };
    SES.q.splice(Math.min(SES.q.length, SES.i + 4), 0, again);
  }
  const fb = $('#fb');
  fb.hidden = false;
  fb.className = 'feedback ' + (ok ? 'ok' : 'ko');
  fb.innerHTML = `<div class="verdict">${ok ? '¡Correcto!' : 'Casi… volverá a salir'}</div>
    <div class="info small">${itemInfo(it, { big: false })}</div>
    <div class="foot"><button class="audio" data-act="say" data-id="${esc(it.id)}">🔊</button>
    <button class="btn primary" data-act="next">Continuar</button></div>`;
  if (S.autoAudio && c.qt !== 'a2e') speak(sayText(it));
  fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPrice(c) {
  if (!c.n) {
    c.n = randPrice();
    c.opts = shuffle([c.n, ...priceDistractors(c.n)]);
  }
  const r = readYen(c.n);
  const box = $('#card');
  if (c.listen) {
    box.innerHTML = `<div class="tag">Precios · escuchar</div>
      <div class="prompt"><div class="ask">¿Cuánto cuesta?</div><button class="audio big" data-act="sayprice">🔊</button></div>
      <div class="opts">${c.opts.map((v, k) => `<button class="opt" data-act="ans" data-k="${k}">${fmtYen(v)}</button>`).join('')}</div>
      <div class="feedback" id="fb" hidden></div>`;
    speak(r.kana, 0.9);
  } else {
    box.innerHTML = `<div class="tag">Precios · leer</div>
      <div class="prompt"><div class="ask">¿Cómo se dice?</div><div class="price">${fmtYen(c.n)}</div></div>
      <div class="opts jp-opts">${c.opts.map((v, k) => { const o = readYen(v); return `<button class="opt" data-act="ans" data-k="${k}">${esc(o.kana)}${S.romaji ? `<small>${esc(o.ro)}</small>` : ''}</button>`; }).join('')}</div>
      <div class="feedback" id="fb" hidden></div>`;
  }
}
function answerPrice(c, k) {
  const ok = c.opts[k] === c.n;
  const btns = [...document.querySelectorAll('.opt')];
  btns.forEach((b, j) => { b.disabled = true; if (c.opts[j] === c.n) b.classList.add('right'); });
  if (!ok) btns[k].classList.add('wrong');
  if (ok) SES.right++; else SES.wrong++;
  markActivity(); save();
  const r = readYen(c.n);
  const fb = $('#fb');
  fb.hidden = false;
  fb.className = 'feedback ' + (ok ? 'ok' : 'ko');
  fb.innerHTML = `<div class="verdict">${ok ? '¡Correcto!' : 'Era este:'}</div>
    <div class="info small"><div class="price">${fmtYen(c.n)}</div><div class="kana">${esc(r.kana)}</div><div class="ro">${esc(r.ro)}</div></div>
    <div class="foot"><button class="audio" data-act="sayprice">🔊</button><button class="btn primary" data-act="next">Continuar</button></div>`;
  if (!c.listen && S.autoAudio) speak(r.kana, 0.9);
}

function renderSummary() {
  $('#bar').style.width = '100%';
  const tot = SES.right + SES.wrong;
  const pct = tot ? Math.round((SES.right / tot) * 100) : 100;
  const learned = SES.isNew.size;
  $('#card').innerHTML = `<div class="summary">
    <div class="big-emoji">${pct >= 80 ? '🎉' : '💪'}</div>
    <h2>${SES.practice ? '¡Práctica terminada!' : '¡Sesión completada!'}</h2>
    <p>${SES.right} aciertos de ${tot} (${pct} %)</p>
    ${learned && !SES.practice ? `<p>Has aprendido <b>${learned}</b> cosas nuevas.</p>` : ''}
    <p class="streak-line">🔥 Racha: <b>${currentStreak()}</b> ${currentStreak() === 1 ? 'día' : 'días'}</p>
    <div class="foot"><button class="btn primary" data-act="close">Volver</button></div></div>`;
}

/* ---------- pantallas ---------- */
let TAB = 'hoy';
let KANA_SCRIPT = 'h';
let PHRASE_Q = '';
try { TAB = localStorage.getItem('nihongo-tab') || 'hoy'; } catch (e) { /* nada */ }

function tripDays() {
  const d = new Date(S.trip + 'T00:00:00');
  return isNaN(d) ? null : dayNum(d) - today();
}
function sectionStats() {
  const secs = [['Hiragana', 'あ'], ['Katakana', 'ア'], ['Frases', '💬'], ['Vocabulario', '🍜'], ['Kanji', '漢']];
  return secs.map(([name, ico]) => {
    const ids = PATH_OK.filter((u) => UNITS[u].sec === name).flatMap((u) => UNITS[u].items);
    const seen = ids.filter((id) => S.items[id]).length;
    const strong = ids.filter((id) => level(id) === 2).length;
    return { name, ico, total: ids.length, seen, strong };
  });
}

function renderHoy() {
  const due = dueIds().length;
  const fresh = nextNew(newLeft()).length;
  const mins = Math.max(1, Math.ceil((due * 8 + fresh * 30) / 60));
  const days = tripDays();
  const next = nextNew(1)[0];
  const nextUnit = next ? UNITS[ITEMS[next].unit] : null;
  const streak = currentStreak();
  const stats = sectionStats();
  const totalSeen = Object.keys(S.items).filter((id) => ITEMS[id]).length;
  let cta;
  if (due || fresh) {
    cta = `<button class="btn primary xl" data-act="start">Empezar sesión</button>
      <p class="muted center">${due} repasos · ${fresh} nuevas · ~${mins} min</p>`;
  } else {
    cta = `<div class="done">✅ ¡Hecho por hoy! Vuelve mañana para repasar.</div>
      ${next ? '<button class="btn" data-act="extra">Aprender 5 más</button>' : ''}`;
  }
  return `
    <section class="hero">
      <div class="countdown">${days === null ? '' : days > 0 ? `<b>${days}</b> días para Japón 🇯🇵` : days === 0 ? '¡Hoy viajas a Japón! 🇯🇵' : 'いってらっしゃい 🇯🇵'}</div>
      <div class="streak">🔥 <b>${streak}</b> ${streak === 1 ? 'día' : 'días'} de racha</div>
    </section>
    <section class="card-box">${cta}
      ${nextUnit ? `<p class="muted center">Siguiente: <b>${esc(nextUnit.sec)} · ${esc(nextUnit.t)}</b></p>` : '<p class="muted center">¡Has visto todo el curso! Sigue repasando.</p>'}
    </section>
    <section class="card-box">
      <h3>Tu progreso <span class="muted">· ${totalSeen} de ${ALL_IDS.length}</span></h3>
      ${stats.map((s) => `<div class="stat"><span class="ico">${s.ico}</span><div class="grow">
        <div class="row"><span>${s.name}</span><span class="muted">${s.seen}/${s.total}</span></div>
        <div class="meter"><i class="seen" style="width:${(s.seen / s.total) * 100}%"></i><i class="strong" style="width:${(s.strong / s.total) * 100}%"></i></div>
      </div></div>`).join('')}
      <p class="legend"><i class="dot seen"></i> vistas <i class="dot strong"></i> dominadas</p>
    </section>
    ${renderWeek()}
    ${!isStandalone() ? `<section class="card-box tip">📲 <b>Instálala:</b> en Safari pulsa <b>Compartir</b> → <b>Añadir a pantalla de inicio</b>. Funcionará sin conexión, como una app.</section>` : ''}`;
}
function renderWeek() {
  const t = today();
  const names = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  let cells = '';
  for (let d = t - 6; d <= t; d++) {
    const n = S.hist[d] || 0;
    const wd = new Date(d * 86400000).getUTCDay();
    cells += `<div class="day ${n ? 'on' : ''} ${d === t ? 'today' : ''}"><i></i><span>${names[wd]}</span></div>`;
  }
  return `<section class="card-box"><h3>Esta semana</h3><div class="week">${cells}</div></section>`;
}

function renderFrases() {
  const q = PHRASE_Q.trim().toLowerCase();
  const units = PATH_OK.map((u) => UNITS[u]).filter((u) => u.sec !== 'Hiragana' && u.sec !== 'Katakana');
  const cats = [];
  units.forEach((u) => { const c = u.cat || u.sec; if (!cats.includes(c)) cats.push(c); });
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const match = (it) => !q || [it.jp, it.kana, it.kj, it.ro, it.es].some((f) => f && norm(f).includes(norm(q)));
  let html = `<div class="search"><input id="q" type="search" placeholder="Buscar en español, rōmaji o japonés…" value="${esc(PHRASE_Q)}" autocomplete="off"></div>`;
  let any = false;
  cats.forEach((cat) => {
    const its = units.filter((u) => (u.cat || u.sec) === cat).flatMap((u) => u.items).map((id) => ITEMS[id]).filter(match);
    if (!its.length) return;
    any = true;
    html += `<h3 class="cat">${esc(cat)}</h3><div class="plist">` + its.map((it) => `
      <button class="prow" data-act="say" data-id="${esc(it.id)}">
        <div class="pj">${esc(it.jp)}${it.kj ? ` <span class="muted">${esc(it.kj)}</span>` : ''}${S.items[it.id] ? '<i class="lv lv' + level(it.id) + '"></i>' : ''}</div>
        ${it.kana && it.kana !== it.jp && it.kind !== 'vocab' ? `<div class="pk">${esc(it.kana)}</div>` : ''}
        <div class="pr">${esc(it.ro)}</div>
        <div class="pe">${esc(it.es)}</div>
      </button>`).join('') + '</div>';
  });
  if (!any) html += '<p class="muted center">No hay resultados.</p>';
  return html;
}

function renderKana() {
  const rows = KANA_TABLE[KANA_SCRIPT];
  const ids = PATH_OK.filter((u) => u.startsWith(KANA_SCRIPT + '_')).flatMap((u) => UNITS[u].items);
  const seen = ids.filter((id) => S.items[id]).length;
  let html = `<div class="seg">
      <button class="${KANA_SCRIPT === 'h' ? 'on' : ''}" data-act="script" data-s="h">ひらがな Hiragana</button>
      <button class="${KANA_SCRIPT === 'k' ? 'on' : ''}" data-act="script" data-s="k">カタカナ Katakana</button>
    </div><p class="muted center">${seen} de ${ids.length} vistas · toca para escuchar</p>`;
  rows.forEach((r) => {
    const wide = r.cells.some((id) => id && ITEMS[id].jp.length > 1);
    html += `<div class="krow-t">${esc(r.t)}</div><div class="kgrid ${wide ? 'wide' : ''}">` + r.cells.map((id) => {
      if (!id) return '<div class="kcell empty"></div>';
      const it = ITEMS[id];
      return `<button class="kcell lv${level(id)}" data-act="say" data-id="${esc(id)}"><span>${esc(it.jp)}</span><small>${esc(it.ro)}</small></button>`;
    }).join('') + '</div>';
  });
  html += '<p class="legend"><i class="dot l0"></i> sin ver <i class="dot l1"></i> aprendiendo <i class="dot l2"></i> dominada</p>';
  return html;
}

function renderPractica() {
  const seen = Object.keys(S.items).filter((id) => ITEMS[id]).length;
  return `
    <section class="card-box"><h3>💴 Precios</h3>
      <p class="muted">Lee y entiende precios en yenes, como en tiendas y restaurantes.</p>
      <div class="two"><button class="btn" data-act="price">Leer precios</button>
      <button class="btn" data-act="pricelisten" ${ttsOK() ? '' : 'disabled'}>Escuchar precios</button></div>
    </section>
    <section class="card-box"><h3>🔁 Repaso libre</h3>
      <p class="muted">15 preguntas al azar de lo que ya has visto. No cambia tu calendario de repasos.</p>
      <button class="btn" data-act="free" ${seen >= 4 ? '' : 'disabled'}>Practicar</button>
      ${seen < 4 ? '<p class="muted small">Disponible cuando hayas aprendido algo en «Hoy».</p>' : ''}
    </section>
    <section class="card-box"><h3>🗺️ El curso</h3>
      <ol class="path">${PATH_OK.map((u) => {
        const un = UNITS[u];
        const s = un.items.filter((id) => S.items[id]).length;
        const st = s === un.items.length ? 'done' : s ? 'part' : '';
        return `<li class="${st}"><span>${esc(un.sec)} · ${esc(un.t)}</span><span class="muted">${s}/${un.items.length}</span></li>`;
      }).join('')}</ol>
    </section>`;
}

function renderAjustes() {
  return `
    <section class="card-box form">
      <label>Fecha del viaje<input type="date" id="trip" value="${esc(S.trip)}"></label>
      <label>Cosas nuevas al día
        <select id="npd">${[3, 5, 7, 10, 15].map((n) => `<option ${S.newPerDay === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="romaji" ${S.romaji ? 'checked' : ''}> Mostrar rōmaji en frases</label>
      <label class="chk"><input type="checkbox" id="auto" ${S.autoAudio ? 'checked' : ''}> Audio automático</label>
      ${ttsOK() ? `<button class="btn" data-act="testvoice">🔊 Probar voz${jaVoice ? ' (' + esc(jaVoice.name) + ')' : ''}</button>` : '<p class="muted">Este navegador no tiene voz japonesa.</p>'}
    </section>
    <section class="card-box"><h3>Copia de seguridad</h3>
      <p class="muted">Tu progreso se guarda solo en este móvil. Haz una copia de vez en cuando.</p>
      <div class="two"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div>
      <input type="file" id="impfile" accept="application/json,.json" hidden>
    </section>
    <section class="card-box"><h3>Zona peligrosa</h3>
      <button class="btn danger" data-act="reset">Borrar todo el progreso</button></section>
    <p class="muted center small">日本語 · v1</p>`;
}

const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function render() {
  const views = { hoy: renderHoy, frases: renderFrases, kana: renderKana, practica: renderPractica, ajustes: renderAjustes };
  const titles = { hoy: '日本語', frases: 'Frases', kana: 'Kana', practica: 'Práctica', ajustes: 'Ajustes' };
  $('#title').textContent = titles[TAB];
  $('#view').innerHTML = views[TAB]();
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB));
  if (TAB === 'frases') {
    const q = $('#q');
    q.addEventListener('input', () => {
      PHRASE_Q = q.value;
      const pos = q.selectionStart;
      render();
      const nq = $('#q'); nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) { /* nada */ }
    });
  }
  if (TAB === 'ajustes') {
    $('#trip').addEventListener('change', (e) => { S.trip = e.target.value; save(); });
    $('#npd').addEventListener('change', (e) => { S.newPerDay = +e.target.value; save(); });
    $('#romaji').addEventListener('change', (e) => { S.romaji = e.target.checked; save(); });
    $('#auto').addEventListener('change', (e) => { S.autoAudio = e.target.checked; save(); });
  }
}

/* ---------- eventos ---------- */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tabs button');
  if (tab) {
    TAB = tab.dataset.tab;
    try { localStorage.setItem('nihongo-tab', TAB); } catch (err) { /* nada */ }
    render(); window.scrollTo(0, 0); return;
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  switch (act) {
    case 'start': startSession(); break;
    case 'extra': startSession({ extra: 5 }); break;
    case 'free': startSession({ mode: 'free' }); break;
    case 'price': startSession({ mode: 'price', listen: false }); break;
    case 'pricelisten': startSession({ mode: 'price', listen: true }); break;
    case 'say': speak(sayText(ITEMS[b.dataset.id])); break;
    case 'sayprice': { const c = SES && SES.q[SES.i]; if (c && c.n) speak(readYen(c.n).kana, 0.9); break; }
    case 'ans': answer(+b.dataset.k); break;
    case 'next': SES.i++; renderCard(); $('#session').scrollTo(0, 0); break;
    case 'close': endSession(); break;
    case 'quit':
      if (!SES || SES.i >= SES.q.length || confirm('¿Salir de la sesión? Lo que ya has respondido queda guardado.')) endSession();
      break;
    case 'script': KANA_SCRIPT = b.dataset.s; render(); break;
    case 'testvoice': speak('こんにちは。日本へようこそ。', 0.9); break;
    case 'export': doExport(); break;
    case 'import': doImport(); break;
    case 'reset':
      if (confirm('¿Seguro? Se borrará todo tu progreso.') && confirm('De verdad, no se puede deshacer. ¿Borrar?')) {
        const keep = { trip: S.trip, newPerDay: S.newPerDay };
        S = Object.assign(defaults(), keep); save(); render();
      }
      break;
    default: break;
  }
});

function doExport() {
  const data = JSON.stringify(S);
  const name = 'nihongo-copia-' + new Date().toISOString().slice(0, 10) + '.json';
  const file = new File([data], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: 'Copia de 日本語' }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function doImport() {
  const inp = $('#impfile');
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || typeof d.items !== 'object') throw new Error('formato');
      if (!confirm('Esto reemplazará tu progreso actual. ¿Continuar?')) return;
      S = Object.assign(defaults(), d); save(); render();
      alert('Copia importada ✔');
    } catch (err) { alert('No parece una copia válida.'); }
  };
  inp.click();
}

/* ---------- arranque ---------- */
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && !SES) render(); });
