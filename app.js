'use strict';
/* Tabarak Academy Whiteboard. Everything is stored in this browser (IndexedDB). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v);
  }
  kids.flat().forEach(c => c != null && e.append(c.nodeType ? c : document.createTextNode(c)));
  return e;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms);
}

/* ---------- storage ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('tabarak-whiteboard', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('files', { keyPath: 'id' });
        r.result.createObjectStore('kv');
      };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  get: (k) => DB.tx('kv', 'readonly', s => s.get(k)),
  set: (k, v) => DB.tx('kv', 'readwrite', s => { s.put(v, k); }),
  del: (k) => DB.tx('kv', 'readwrite', s => { s.delete(k); }),
  allKv: () => new Promise((res, rej) => {
    const out = {}; const t = DB.db.transaction('kv', 'readonly'); const c = t.objectStore('kv').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
  }),
  putFile: (f) => DB.tx('files', 'readwrite', s => { s.put(f); }),
  getFile: (id) => DB.tx('files', 'readonly', s => s.get(id)),
  delFile: (id) => DB.tx('files', 'readwrite', s => { s.delete(id); }),
  listFiles: () => new Promise((res, rej) => {
    const out = []; const t = DB.db.transaction('files', 'readonly'); const c = t.objectStore('files').openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { const { blob, ...meta } = cur.value; out.push(meta); cur.continue(); } };
    t.oncomplete = () => res(out.sort((a, b) => a.added - b.added)); t.onerror = () => rej(t.error);
  }),
};

/* ---------- Quran data ---------- */
const META = window.QURAN_META;      // [n, ar name, en name, en meaning, count, type]
const AYAT = window.QURAN_AYAT;      // [s, a, page, juz, uthmani, simple, english]
const ayahIndex = new Map(); AYAT.forEach((r, i) => ayahIndex.set(r[0] + ':' + r[1], i));
const normAr = (s) => s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u08D3-\u08FF]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
let NORM = null;
const TAFSIRS = [
  { slug: 'ar-tafsir-muyassar', name: 'التفسير الميسر (Al-Muyassar)', lang: 'ar', id: 38, by: 'Al-Tafsir al-Muyassar (concise Arabic tafsir)' },
  { slug: 'ar-tafsir-al-jalalayn', name: 'تفسير الجلالين (Al-Jalalayn)', lang: 'ar', id: 523, by: 'Jalal al-Din al-Mahalli and Jalal al-Din al-Suyuti' },
  { slug: 'en-al-jalalayn', name: 'Al-Jalalayn (English)', lang: 'en', id: 74, by: 'Jalal al-Din al-Mahalli and Jalal al-Din al-Suyuti (English), source listed as altafsir.com', url: 'https://www.altafsir.com/' },
  { slug: 'ar-tafseer-al-saddi', name: 'تفسير السعدي (Al-Sa\'di)', lang: 'ar', id: 24, by: 'Abd al-Rahman al-Sa\'di' },
  { slug: 'ar-tafsir-ibn-kathir', name: 'تفسير ابن كثير (Ibn Kathir)', lang: 'ar', id: 22, by: 'Hafiz Ibn Kathir' },
  { slug: 'en-tafisr-ibn-kathir', name: 'Tafsir Ibn Kathir (English)', lang: 'en', id: 35, by: 'Hafiz Ibn Kathir (English edition; the source does not say which translation or abridgement)' },
  { slug: 'ar-tafseer-al-qurtubi', name: 'تفسير القرطبي (Al-Qurtubi)', lang: 'ar', id: 23, by: 'Al-Qurtubi' },
  { slug: 'ar-tafsir-al-tabari', name: 'تفسير الطبري (Al-Tabari)', lang: 'ar', id: 37, by: 'Al-Tabari' },
  { slug: 'ar-tafsir-al-baghawi', name: 'تفسير البغوي (Al-Baghawi)', lang: 'ar', id: 27, by: 'Al-Baghawi' },
  { slug: 'ar-tafsir-al-mukhtasar', name: 'المختصر في تفسير القرآن (Al-Mukhtasar)', lang: 'ar', id: 251, by: 'Tafsir Center for Quranic Studies' },
  { slug: 'en-tafsir-al-mukhtasar', name: 'Al-Mukhtasar (English)', lang: 'en', id: 266, by: 'Tafsir Center for Quranic Studies (English)' },
];

/* ---------- app state ---------- */
const S = {
  view: 'welcome', files: [], docId: null,
  ayah: null,                 // {s,a}
  tab: 'translate',
  tr: { src: '', out: '', target: 'auto', auto: true, busy: false, engine: '', err: '' },
  tafsirSlug: 'ar-tafsir-muyassar',
  qhl: [], qbm: [],
  quran: { surah: 1, query: '', showEn: true },
  doc: null,                  // loaded doc runtime
};

/* ---------- translation ---------- */
const isArabic = (t) => (t.match(/[\u0600-\u06FF]/g) || []).length > (t.replace(/\s/g, '').length / 3);
const trCache = new Map();
function chunkText(t, max) {
  const parts = []; let cur = '';
  for (const piece of t.split(/(?<=[.!?؟\n])\s+/)) {
    if ((cur + ' ' + piece).length > max && cur) { parts.push(cur); cur = piece; } else cur = cur ? cur + ' ' + piece : piece;
    while (cur.length > max) { parts.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur) parts.push(cur); return parts;
}
async function translateText(text, target) {
  const sl = isArabic(text) ? 'ar' : 'en';
  const key = sl + target + text; if (trCache.has(key)) return trCache.get(key);
  let out = '', engine = '';
  try {
    const parts = chunkText(text, 1800), res = [];
    for (const p of parts) {
      const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + target + '&dt=t&q=' + encodeURIComponent(p));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); res.push(j[0].map(x => x[0]).join(''));
    }
    out = res.join('\n'); engine = 'Google Translate (machine translation)';
  } catch (e1) {
    try {
      const parts = chunkText(text, 450), res = [];
      for (const p of parts) {
        const r = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(p) + '&langpair=' + sl + '|' + target);
        const j = await r.json(); if (j.responseStatus !== 200) throw new Error(j.responseDetails);
        res.push(j.responseData.translatedText);
      }
      out = res.join('\n'); engine = 'MyMemory (machine translation)';
    } catch (e2) { throw new Error('Translation needs an internet connection. (' + (e2.message || e1.message) + ')'); }
  }
  const v = { out, engine }; trCache.set(key, v); return v;
}
async function doTranslate(text) {
  text = (text || '').trim(); if (!text) return;
  S.tr.src = text; S.tr.out = ''; S.tr.err = ''; S.tr.busy = true;
  if (innerWidth < 800) $('#panel').classList.remove('hide');
  switchTab('translate');
  const target = S.tr.target === 'auto' ? (isArabic(text) ? 'en' : 'ar') : S.tr.target;
  try { const r = await translateText(text, target); S.tr.out = r.out; S.tr.engine = r.engine; S.tr.shownTarget = target; }
  catch (e) { S.tr.err = e.message; }
  S.tr.busy = false; if (S.tab === 'translate') renderTab();
}

/* ---------- tafsir ---------- */
async function getTafsir(slug, s, a) {
  const key = 'tafsir:' + slug + '|' + s + '|' + a;
  const c = await DB.get(key); if (c) return c;
  const r = await fetch('https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/' + slug + '/' + s + '/' + a + '.json');
  if (!r.ok) throw new Error('This tafsir has no entry for this ayah (HTTP ' + r.status + ').');
  const j = await r.json(); const v = { text: j.text || '', ayah: j.ayah };
  if (v.text) await DB.set(key, v);
  return v;
}

/* ---------- panel tabs ---------- */
function switchTab(t) { if (innerWidth < 800 && t === 'tafsir') $('#panel').classList.remove('hide'); S.tab = t; $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); renderTab(); }
$$('#tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
function renderTab() {
  const body = $('#tabBody'); body.textContent = '';
  if (S.tab === 'translate') renderTranslateTab(body);
  else if (S.tab === 'tafsir') renderTafsirTab(body);
  else if (S.tab === 'marks') renderMarksTab(body);
  else if (S.tab === 'pageayat') renderPageAyat(body);
}
function renderTranslateTab(body) {
  const tr = S.tr;
  const ta = el('textarea', { rows: 3, style: 'width:100%;font:inherit;padding:6px;border:1px solid var(--line);border-radius:6px', placeholder: 'Select any text, or type here…' }); ta.value = tr.src;
  const tsel = el('select', { onchange: e => { tr.target = e.target.value; } },
    el('option', { value: 'auto', text: 'Auto (Arabic ⇄ English)' }), el('option', { value: 'ar', text: 'To Arabic' }), el('option', { value: 'en', text: 'To English' }));
  tsel.value = tr.target;
  const auto = el('input', { type: 'checkbox', onchange: e => { tr.auto = e.target.checked; DB.set('settings:autoTranslate', tr.auto); } }); auto.checked = tr.auto;
  body.append(
    el('h4', { text: 'Translate' }), ta,
    el('div', { class: 'row' }, tsel, el('button', { class: 'btn', text: 'Translate', onclick: () => doTranslate(ta.value) })),
    el('label', { class: 'small' }, auto, ' Translate automatically when I select text'));
  if (tr.src) body.append(el('div', { class: 'srcbox' + (isArabic(tr.src) ? ' ar' : '') }, el('div', { class: 'lbl', text: 'Selected text' }), tr.src));
  if (tr.busy) body.append(el('div', { class: 'note', text: 'Translating…' }));
  if (tr.err) body.append(el('div', { class: 'srcbox', style: 'border-color:#c55;color:#a22' }, tr.err));
  if (tr.out) {
    const toAr = tr.shownTarget === 'ar';
    body.append(el('div', { class: 'srcbox' + (toAr ? ' ar' : '') }, el('div', { class: 'lbl', text: 'Translation' }), tr.out),
      el('div', { class: 'note', text: tr.engine + '. Machine translation can miss religious terms and grammar terms; check important wording.' }));
  }
}
async function renderTafsirTab(body) {
  const sel = el('select', { onchange: e => { S.tafsirSlug = e.target.value; DB.set('settings:tafsir', S.tafsirSlug); renderTab(); } },
    TAFSIRS.map(t => el('option', { value: t.slug, text: t.name })));
  sel.value = S.tafsirSlug;
  body.append(el('h4', { text: 'Tafsir' }), sel);
  if (!S.ayah) { body.append(el('p', { class: 'note', text: 'Open the Quran and tap an ayah (or a line in "Page ayat") to see its tafsir here.' })); return; }
  const { s, a } = S.ayah; const t = TAFSIRS.find(x => x.slug === S.tafsirSlug);
  const row = AYAT[ayahIndex.get(s + ':' + a)];
  body.append(el('div', { class: 'srcbox ar' }, el('div', { class: 'lbl', text: `Surah ${META[s - 1][2]} ${s}:${a}` }), row[4]));
  const box = el('div', { class: 'srcbox' + (t.lang === 'ar' ? ' ar' : ''), style: 'white-space:pre-wrap;' + (t.lang === 'ar' ? 'font-family:Amiri,serif' : 'line-height:1.55') }, 'Loading…');
  body.append(box);
  body.append(el('div', { class: 'note' }, 'Source: ', el('b', { text: t.name }), ' · ' + t.by + '. Text from the Tafsir API / Tarteel QUL collection: ',
    el('a', { href: t.url || ('https://qul.tarteel.ai/resources/tafsir/' + t.id), target: '_blank', rel: 'noopener', text: t.url || ('qul.tarteel.ai/resources/tafsir/' + t.id) }),
    '. This app does not edit it. Tafsir books often explain a group of ayat together, so the text may cover neighbouring ayat. Check the printed book before quoting it in class.'));
  body.append(el('div', { class: 'row' }, el('button', { class: 'btn sm alt', text: 'Translate this tafsir', onclick: () => { if (box.dataset.text) doTranslate(box.dataset.text.slice(0, 4000)); } }),
    el('span', { class: 'note', text: 'or select part of it' })));
  try {
    const r = await getTafsir(t.slug, s, a);
    if (S.tab !== 'tafsir' || S.tafsirSlug !== t.slug || !S.ayah || S.ayah.s !== s || S.ayah.a !== a) return;
    box.textContent = r.text || 'No text for this ayah in this tafsir.'; box.dataset.text = r.text || '';
  } catch (e) { box.textContent = (navigator.onLine ? '' : 'You are offline. ') + 'Could not load: ' + e.message + ' Tafsir loads from the internet the first time, then it is kept on this computer.'; }
}
function renderMarksTab(body) {
  body.append(el('h4', { text: 'My highlights' }));
  if (S.view === 'quran') {
    const list = S.qhl.slice().sort((x, y) => ayahIndex.get(x.s + ':' + x.a) - ayahIndex.get(y.s + ':' + y.a));
    if (!list.length) body.append(el('p', { class: 'note', text: 'Select words inside an ayah and pick a colour to highlight them.' }));
    list.forEach(h => body.append(el('div', { class: 'markitem ar', style: 'border-color:' + h.color },
      h.text, el('div', { class: 'acts' }, el('span', { class: 'small', text: `${META[h.s - 1][2]} ${h.s}:${h.a}` }),
        el('a', { text: 'open', onclick: () => gotoAyah(h.s, h.a) }), el('a', { text: 'translate', onclick: () => doTranslate(h.text) }),
        el('a', { text: 'delete', onclick: () => { S.qhl = S.qhl.filter(x => x.id !== h.id); DB.set('qhl', S.qhl); renderQuran(); renderTab(); } })))));
    body.append(el('h4', { style: 'margin-top:14px', text: 'Bookmarks' }));
    if (!S.qbm.length) body.append(el('p', { class: 'note', text: 'Use ☆ on an ayah to bookmark it.' }));
    S.qbm.forEach(k => { const [s, a] = k.split(':').map(Number); body.append(el('div', { class: 'markitem', style: 'border-color:#e2a100' }, `${META[s - 1][2]} ${k}`,
      el('div', { class: 'acts' }, el('a', { text: 'open', onclick: () => gotoAyah(s, a) }), el('a', { text: 'remove', onclick: () => toggleBm(k) })))); });
  } else if (S.view === 'doc' && S.doc) {
    const d = S.doc; const list = d.ann.hl.slice().sort((x, y) => x.page - y.page);
    if (!list.length) body.append(el('p', { class: 'note', text: 'Pick Highlight or Area, then select text or drag on the page.' }));
    list.forEach(h => body.append(el('div', { class: 'markitem', style: 'border-color:' + h.color },
      h.text || '(area highlight)', el('div', { class: 'acts' }, el('span', { class: 'small', text: 'Page ' + h.page }),
        el('a', { text: 'go to', onclick: () => scrollToPage(h.page) }), h.text ? el('a', { text: 'translate', onclick: () => doTranslate(h.text) }) : '',
        el('a', { text: 'delete', onclick: () => deleteHl(h.id) })))));
  } else body.append(el('p', { class: 'note', text: 'Open the Quran or a book first.' }));
}
function renderPageAyat(body) {
  const d = S.doc; if (!d || !d.mushaf.on) { body.append(el('p', { class: 'note', text: 'Turn on "Madinah mushaf" in the toolbar for a mushaf PDF.' })); return; }
  const qp = d.cur - d.mushaf.offset;
  body.append(el('h4', { text: 'Quran page ' + qp }));
  if (qp < 1 || qp > 604) { body.append(el('p', { class: 'note', text: 'This PDF page is outside the 604 Quran pages (cover or end pages).' })); return; }
  body.append(el('div', { class: 'note', text: 'Matches the standard 604-page Madinah mushaf. Check one page against the PDF; change "first Quran page is PDF page" if it is off.' }));
  AYAT.filter(r => r[2] === qp).forEach(r => body.append(el('div', { class: 'markitem ar', style: 'cursor:pointer;border-color:' + (S.ayah && S.ayah.s === r[0] && S.ayah.a === r[1] ? '#1fa6d8' : '#ccc'), onclick: () => { S.ayah = { s: r[0], a: r[1] }; switchTab('tafsir'); } },
    r[4] + ' ﴿' + r[1] + '﴾', el('div', { class: 'small', style: 'direction:ltr;text-align:left;color:#678', text: `${META[r[0] - 1][2]} ${r[0]}:${r[1]} · ${r[6].slice(0, 90)}…` }))));
}

/* ---------- selection toolbar ---------- */
let selCtx = null, selTimer = null;
function selectionInfo() {
  const sel = getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const text = sel.toString().trim(); if (!text) return null;
  const r = sel.getRangeAt(0); const node = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
  if (!node || !(node.closest('#main') || node.closest('#panel'))) return null;
  let ctx = { type: 'none', text };
  const ar = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('.ar[data-key]');
  const tl = node.closest('.textLayer');
  if (ar) ctx = { type: 'quran', text, ar, range: r };
  else if (tl) ctx = { type: 'pdf', text, page: tl.closest('.page'), range: r };
  return ctx;
}
document.addEventListener('mouseup', () => setTimeout(onSelect, 10));
document.addEventListener('keyup', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Shift') onSelect(); });
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#selbar')) $('#selbar').hidden = true; });
function onSelect() {
  const ctx = selectionInfo(); const bar = $('#selbar');
  if (!ctx) return; selCtx = ctx;
  const rect = ctx.range ? ctx.range.getBoundingClientRect() : getSelection().getRangeAt(0).getBoundingClientRect();
  $('#hlColors').style.display = ctx.type === 'none' ? 'none' : 'flex';
  bar.hidden = false; bar.style.left = Math.max(8, Math.min(innerWidth - 230, rect.left)) + 'px'; bar.style.top = Math.max(50, rect.top - 44) + 'px';
  if (S.tr.auto) { clearTimeout(selTimer); selTimer = setTimeout(() => { if (selCtx && selCtx.text === ctx.text) doTranslate(ctx.text); }, 350); }
}
$('#selbar').addEventListener('mousedown', e => e.preventDefault());
$('#selbar').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !selCtx) return;
  if (b.dataset.act === 'translate') doTranslate(selCtx.text);
  else if (b.dataset.hl) {
    if (selCtx.type === 'quran') addQuranHl(selCtx, b.dataset.hl);
    else if (selCtx.type === 'pdf') addPdfHl(selCtx, b.dataset.hl);
    getSelection().removeAllRanges(); $('#selbar').hidden = true;
  }
});

/* ---------- Quran view ---------- */
function gotoAyah(s, a) { S.quran.surah = s; S.quran.query = ''; openQuran(); setTimeout(() => { const e = $(`.ayah[data-key="${s}:${a}"]`); if (e) { e.scrollIntoView({ block: 'center' }); selectAyah(s, a); } }, 50); }
function selectAyah(s, a) {
  S.ayah = { s, a }; $$('.ayah.sel').forEach(x => x.classList.remove('sel'));
  const e = $(`.ayah[data-key="${s}:${a}"]`); if (e) e.classList.add('sel');
  if (S.tab === 'tafsir') renderTab();
}
function toggleBm(k) { const i = S.qbm.indexOf(k); if (i >= 0) S.qbm.splice(i, 1); else S.qbm.push(k); DB.set('qbm', S.qbm); renderQuran(); if (S.tab === 'marks') renderTab(); }
function addQuranHl(ctx, color) {
  const ar = ctx.ar, key = ar.dataset.key, [s, a] = key.split(':').map(Number);
  const r = ctx.range; const pre = document.createRange(); pre.selectNodeContents(ar); pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  let end;
  if (ar.contains(r.endContainer)) { const p2 = document.createRange(); p2.selectNodeContents(ar); p2.setEnd(r.endContainer, r.endOffset); end = p2.toString().length; } else end = ar.textContent.length;
  if (end <= start) return;
  S.qhl.push({ id: uid(), s, a, start, end, color, text: ar.textContent.slice(start, end) });
  DB.set('qhl', S.qhl); renderQuran(); if (S.tab === 'marks') renderTab(); toast('Highlighted');
}
function paintArabic(node, row) {
  const key = row[0] + ':' + row[1], txt = row[4];
  const hs = S.qhl.filter(h => h.s === row[0] && h.a === row[1]).sort((x, y) => x.start - y.start);
  let pos = 0; node.textContent = '';
  for (const h of hs) {
    const st = Math.max(h.start, pos), en = Math.min(h.end, txt.length); if (en <= st) continue;
    if (st > pos) node.append(txt.slice(pos, st));
    node.append(el('mark', { class: 'hl', style: 'background:' + h.color, title: 'Highlight' }, txt.slice(st, en))); pos = en;
  }
  if (pos < txt.length) node.append(txt.slice(pos));
}
function ayahCard(row, opts = {}) {
  const key = row[0] + ':' + row[1];
  const ar = el('span', { class: 'ar-text' }); const wrap = el('div', { class: 'ar', 'data-key': key, style: 'font-size:' + (opts.size || 30) + 'px' }, ar);
  paintArabic(wrap, row);
  const num = el('span', { class: 'num', text: row[1] });
  const card = el('div', { class: 'ayah' + (S.ayah && S.ayah.s === row[0] && S.ayah.a === row[1] ? ' sel' : ''), 'data-key': key, onclick: (e) => { if (!getSelection().toString()) selectAyah(row[0], row[1]); } },
    el('div', { class: 'meta' }, `${META[row[0] - 1][2]} ${key} · Juz ${row[3]} · Mushaf page ${row[2]}`),
    el('div', { style: 'display:flex;gap:8px;align-items:flex-start;direction:rtl' }, num, wrap),
    S.quran.showEn || opts.forceEn ? el('div', { class: 'en', dir: 'ltr' }, row[6], el('div', { class: 'note', text: 'English: Saheeh International' })) : '',
    el('div', { class: 'tools' },
      el('button', { text: 'Tafsir', onclick: (e) => { e.stopPropagation(); selectAyah(row[0], row[1]); switchTab('tafsir'); } }),
      el('button', { text: 'Highlight ayah', onclick: (e) => { e.stopPropagation(); S.qhl.push({ id: uid(), s: row[0], a: row[1], start: 0, end: row[4].length, color: '#ffe45e', text: row[4] }); DB.set('qhl', S.qhl); renderQuran(); } }),
      el('button', { class: S.qbm.includes(key) ? 'bm' : '', text: S.qbm.includes(key) ? '★ Bookmarked' : '☆ Bookmark', onclick: (e) => { e.stopPropagation(); toggleBm(key); } }),
      opts.open ? el('button', { text: 'Open in surah', onclick: (e) => { e.stopPropagation(); gotoAyah(row[0], row[1]); } }) : ''));
  return card;
}
function openQuran() { setView('quran'); renderQuran(); }
function renderQuran() {
  const v = $('#quranView'); const keepScroll = $('#main').scrollTop; v.textContent = '';
  const surahSel = el('select', { onchange: e => { S.quran.surah = +e.target.value; S.quran.query = ''; renderQuran(); $('#main').scrollTop = 0; } },
    META.map(m => el('option', { value: m[0], text: `${m[0]}. ${m[1]} · ${m[2]}` }))); surahSel.value = S.quran.surah;
  const q = el('input', { type: 'search', placeholder: 'Search the Quran (Arabic with or without tashkeel, or English)…', value: S.quran.query });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { S.quran.query = q.value.trim(); renderQuran(); $('#main').scrollTop = 0; } });
  const pg = el('input', { type: 'number', min: 1, max: 604, placeholder: 'Page', style: 'width:70px' });
  pg.addEventListener('keydown', e => { if (e.key === 'Enter') { const n = +pg.value; const r = AYAT.find(x => x[2] === n); if (r) gotoAyah(r[0], r[1]); } });
  const en = el('input', { type: 'checkbox', onchange: e => { S.quran.showEn = e.target.checked; renderQuran(); } }); en.checked = S.quran.showEn;
  v.append(el('div', { class: 'qbar' }, surahSel, q, el('button', { class: 'btn', text: 'Search', onclick: () => { S.quran.query = q.value.trim(); renderQuran(); $('#main').scrollTop = 0; } }),
    pg, el('label', { class: 'small' }, en, ' English')));
  if (S.quran.query) {
    const qs = S.quran.query; let hits = [];
    if (/[\u0600-\u06FF]/.test(qs)) { if (!NORM) NORM = AYAT.map(r => normAr(r[5])); const nq = normAr(qs); AYAT.forEach((r, i) => { if (NORM[i].includes(nq)) hits.push(r); }); }
    else { const lq = qs.toLowerCase(); AYAT.forEach(r => { if (r[6].toLowerCase().includes(lq)) hits.push(r); }); }
    v.append(el('div', { class: 'surahhead' }, el('b', { text: 'Search' }), `${hits.length} ayat found for “${qs}”` + (hits.length > 150 ? ' (showing the first 150)' : ''), ' · ',
      el('a', { style: 'color:#9de;cursor:pointer', text: 'back to surah', onclick: () => { S.quran.query = ''; renderQuran(); } })));
    hits.slice(0, 150).forEach(r => v.append(ayahCard(r, { open: true, forceEn: true, size: 26 })));
  } else {
    const m = META[S.quran.surah - 1];
    v.append(el('div', { class: 'surahhead' }, el('b', { text: m[1] }), `${m[2]} · ${m[3]} · ${m[4]} ayat · ${m[5] === 'Meccan' ? 'Makkiyyah' : 'Madaniyyah'}`));
    if (m[0] !== 1 && m[0] !== 9) v.append(el('div', { class: 'bismillah', text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ' }));
    AYAT.filter(r => r[0] === m[0]).forEach(r => v.append(ayahCard(r)));
    v.append(el('div', { class: 'note', style: 'text-align:center', text: 'Arabic: Uthmani text and Madinah mushaf page numbers from the AlQuran Cloud data (api.alquran.cloud), bundled with this app so it works offline. English: Saheeh International.' }));
  }
  $('#main').scrollTop = keepScroll;
}

/* ---------- views / library ---------- */
function setView(v) {
  S.view = v; if (innerWidth < 800 && v !== 'welcome') $('#side').classList.add('hide');
  $('#welcome').hidden = v !== 'welcome'; $('#quranView').hidden = v !== 'quran'; $('#docView').hidden = v !== 'doc';
  $('#main').style.overflow = v === 'doc' ? 'hidden' : 'auto';
  $('#tabPageAyat').hidden = !(v === 'doc' && S.doc && S.doc.mushaf.on);
  $('#btnQuran').classList.toggle('on', v === 'quran');
  if (v !== 'doc') { S.docId = null; }
  renderLib();
  if (S.tab === 'pageayat' && $('#tabPageAyat').hidden) S.tab = 'translate';
  switchTab(S.tab);
  DB.set('last', v === 'doc' ? { v, id: S.docId } : { v });
}
async function renderLib() {
  S.files = await DB.listFiles(); const box = $('#libList'); box.textContent = '';
  S.files.forEach(f => box.append(el('button', { class: 'libitem' + (S.docId === f.id ? ' on' : ''), onclick: () => openDoc(f.id) },
    el('span', { text: f.kind === 'pdf' ? '📕' : f.kind === 'image' ? '🖼️' : '📄' }),
    el('div', {}, el('b', { text: f.name }), el('small', { text: (f.size / 1048576).toFixed(1) + ' MB' })),
    el('button', { class: 'del', title: 'Remove from library', onclick: async (e) => { e.stopPropagation(); if (confirm('Remove "' + f.name + '" and its highlights from this whiteboard?')) { await DB.delFile(f.id); await DB.del('ann:' + f.id); await DB.del('doc:' + f.id); if (S.docId === f.id) setView('welcome'); else renderLib(); } } }, '✕'))));
  if (!S.files.length) box.append(el('p', { class: 'small muted pad', text: 'Nothing added yet.' }));
  updateStorage();
}
async function updateStorage() {
  try { const e = await navigator.storage.estimate(); $('#storeInfo').textContent = 'Saved here: ' + (e.usage / 1048576).toFixed(0) + ' MB'; } catch (e) { }
}
async function addFiles(list) {
  let n = 0;
  for (const f of list) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const kind = ext === 'pdf' ? 'pdf' : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'image' : ['txt', 'md', 'html', 'htm'].includes(ext) ? 'text' : null;
    if (!kind) { toast('Not supported: ' + f.name + ' (use PDF, image or text)', 4000); continue; }
    toast('Saving ' + f.name + '…', 8000);
    try { await DB.putFile({ id: uid(), name: f.name, kind, size: f.size, added: Date.now(), blob: f, ext }); n++; }
    catch (e) { toast('Could not save ' + f.name + ': ' + (e.message || e), 6000); }
  }
  if (n) toast(n + ' file(s) saved permanently'); await renderLib();
}
$('#addFiles').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
['dragover', 'dragenter'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); document.body.classList.add('drop'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) document.body.classList.remove('drop'); }));
document.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });
$('#btnQuran').onclick = openQuran;
$('#btnSide').onclick = () => $('#side').classList.toggle('hide');
$('#btnPanel').onclick = () => $('#panel').classList.toggle('hide');

/* ---------- document viewer ---------- */
let io = null;
async function openDoc(id) {
  const rec = await DB.getFile(id); if (!rec) return;
  if (S.doc && S.doc.pdf) { try { S.doc.pdf.destroy(); } catch (e) { } }
  const st = (await DB.get('doc:' + id)) || {};
  const ann = (await DB.get('ann:' + id)) || { hl: [], ink: {} };
  S.docId = id;
  S.doc = { id, rec, kind: rec.kind, zoom: st.zoom || 1, cur: st.page || 1, tool: 'select', color: '#ffe45e', ann, mushaf: st.mushaf || { on: false, offset: 0 }, pages: [], numPages: 1, ratio: 1.414, noText: false };
  setView('doc'); buildDocUI(); await loadDoc();
}
function saveDocState() { const d = S.doc; if (d) DB.set('doc:' + d.id, { zoom: d.zoom, page: d.cur, mushaf: d.mushaf }); }
function saveAnn() { const d = S.doc; if (d) DB.set('ann:' + d.id, d.ann); }
function buildDocUI() {
  const d = S.doc, v = $('#docView'); v.textContent = '';
  const bar = el('div', { id: 'dbar' });
  const tools = [['select', '🖱 Select'], ['area', '▭ Area'], ['pen', '✏️ Pen'], ['erase', '🧽 Eraser']];
  tools.forEach(([k, label]) => { if (d.kind !== 'pdf' && d.kind !== 'image' && k !== 'select') return; if (d.kind === 'image' && false) return;
    bar.append(el('button', { class: 'tool' + (d.tool === k ? ' on' : ''), 'data-tool': k, text: label, onclick: () => setTool(k) })); });
  bar.append(el('span', { class: 'sep' }));
  ['#ffe45e', '#8de08d', '#ffa6c9', '#8fd3ff'].forEach(c => bar.append(el('button', { class: 'sw' + (d.color === c ? ' on' : ''), style: 'background:' + c, title: 'Colour for highlight / pen', onclick: () => { d.color = c; $$('#dbar .sw').forEach(x => x.classList.toggle('on', x.style.background === c || x.style.backgroundColor === hexToRgb(c))); } })));
  if (d.kind === 'pdf' || d.kind === 'image') {
    bar.append(el('span', { class: 'sep' }), el('button', { class: 'tool', text: '－', onclick: () => setZoom(d.zoom / 1.2) }), el('span', { id: 'zl', class: 'small', text: Math.round(d.zoom * 100) + '%' }),
      el('button', { class: 'tool', text: '＋', onclick: () => setZoom(d.zoom * 1.2) }), el('button', { class: 'tool', text: 'Fit width', onclick: () => setZoom(1) }));
  }
  if (d.kind === 'pdf') {
    const pi = el('input', { type: 'number', id: 'pgin', min: 1, value: d.cur }); pi.addEventListener('keydown', e => { if (e.key === 'Enter') scrollToPage(+pi.value); });
    bar.append(el('span', { class: 'sep' }), 'Page ', pi, el('span', { id: 'pgtot', class: 'small', text: ' / …' }));
    const mc = el('input', { type: 'checkbox', onchange: e => { d.mushaf.on = e.target.checked; $('#tabPageAyat').hidden = !d.mushaf.on; mo.style.display = d.mushaf.on ? 'inline' : 'none'; saveDocState(); if (d.mushaf.on) switchTab('pageayat'); else if (S.tab === 'pageayat') switchTab('translate'); } }); mc.checked = d.mushaf.on;
    const off = el('input', { type: 'number', min: 1, value: d.mushaf.offset + 1, style: 'width:56px', onchange: e => { d.mushaf.offset = Math.max(0, (+e.target.value || 1) - 1); saveDocState(); if (S.tab === 'pageayat') renderTab(); } });
    const mo = el('span', { style: 'display:' + (d.mushaf.on ? 'inline' : 'none'), class: 'small' }, ' first Quran page is PDF page ', off);
    bar.append(el('span', { class: 'sep' }), el('label', { class: 'small', title: 'Only for a standard 604-page Madinah mushaf PDF' }, mc, ' Madinah mushaf'), mo);
  }
  v.append(bar, el('div', { id: 'scroller' }));
  $('#tabPageAyat').hidden = !(d.kind === 'pdf' && d.mushaf.on);
}
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
function setTool(k) {
  const d = S.doc; d.tool = k; $$('#dbar .tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === k));
  $$('.page').forEach(p => { p.classList.toggle('drawmode', k === 'pen' || k === 'erase'); p.classList.toggle('areamode', k === 'area'); $('.hlLayer', p) && $('.hlLayer', p).classList.toggle('erase', k === 'erase'); });
}
function fitW() { return Math.min(1000, $('#scroller').clientWidth - 30); }
async function loadDoc() {
  const d = S.doc, sc = $('#scroller');
  if (d.kind === 'text') {
    let t = await d.rec.blob.text(); if (/^(html|htm)$/.test(d.rec.ext)) t = new DOMParser().parseFromString(t, 'text/html').body.textContent;
    sc.append(el('div', { class: 'textdoc', dir: 'auto', text: t })); return;
  }
  if (d.kind === 'image') {
    const url = URL.createObjectURL(d.rec.blob); const img = new Image(); await new Promise(r => { img.onload = r; img.src = url; });
    d.numPages = 1; d.ratio = img.naturalHeight / img.naturalWidth; d.imgUrl = url; makePages(); return;
  }
  sc.append(el('div', { class: 'note', text: 'Opening…' }));
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
    const buf = await d.rec.blob.arrayBuffer();
    d.pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  } catch (e) { sc.textContent = ''; sc.append(el('div', { class: 'srcbox', style: 'color:#a22' }, 'Could not open this PDF: ' + (e.message || e))); return; }
  d.numPages = d.pdf.numPages; const p1 = await d.pdf.getPage(1); const vp = p1.getViewport({ scale: 1 }); d.ratio = vp.height / vp.width;
  $('#pgtot') && ($('#pgtot').textContent = ' / ' + d.numPages); $('#pgin') && ($('#pgin').max = d.numPages);
  sc.textContent = ''; makePages();
  d.cur = Math.min(Math.max(1, d.cur), d.numPages); setTimeout(() => scrollToPage(d.cur, true), 30);
  sc.addEventListener('scroll', onDocScroll);
  sc.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.doc.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
}
function pageCss() { const d = S.doc; const w = fitW() * d.zoom; return { w, h: w * d.ratio }; }
function makePages() {
  const d = S.doc, sc = $('#scroller'); sc.textContent = ''; d.pages = [];
  const { w, h } = pageCss();
  if (io) io.disconnect();
  io = new IntersectionObserver((ents) => ents.forEach(en => { const n = +en.target.dataset.n; if (en.isIntersecting) renderPage(n); else unrenderPage(n); }), { root: sc, rootMargin: '900px 0px' });
  for (let n = 1; n <= d.numPages; n++) {
    const pg = el('div', { class: 'page' + (d.tool === 'pen' || d.tool === 'erase' ? ' drawmode' : '') + (d.tool === 'area' ? ' areamode' : ''), 'data-n': n, style: `width:${w}px;height:${h}px` }, el('div', { class: 'pageNo', text: n }));
    sc.append(pg); d.pages[n] = { el: pg, rendered: false, token: 0 }; io.observe(pg);
  }
}
async function renderPage(n) {
  const d = S.doc; if (!d || !d.pages[n]) return; const P = d.pages[n]; if (P.rendered || P.busy) return; P.busy = true;
  const tok = ++P.token; const pg = P.el;
  try {
    const layers = [];
    if (d.kind === 'image') {
      const w = parseFloat(pg.style.width); pg.append(el('img', { class: 'pimg', src: d.imgUrl })); pg.style.height = (w * d.ratio) + 'px';
    } else {
      const page = await d.pdf.getPage(n); const base = page.getViewport({ scale: 1 }); const cssW = parseFloat(pg.style.width);
      const scale = cssW / base.width; const vp = page.getViewport({ scale }); pg.style.height = vp.height + 'px'; pg.style.setProperty('--scale-factor', scale);
      const dpr = Math.min(window.devicePixelRatio || 1, 2) * Math.min(1, 4096 / (vp.width * (window.devicePixelRatio || 1)));
      const cv = el('canvas', { class: 'pdf' }); cv.width = Math.floor(vp.width * dpr); cv.height = Math.floor(vp.height * dpr);
      pg.prepend(cv);
      if (tok !== P.token) return;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      const tc = await page.getTextContent();
      if (tc.items.length === 0 && !d.noTextShown && d.kind === 'pdf') { d.noText = true; }
      const tl = el('div', { class: 'textLayer' }); pg.append(tl);
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] }).promise;
      if (tc.items.length === 0) { d.scanned = (d.scanned || 0) + 1; if (d.scanned === 1) toast('This page is a picture (scanned), so text cannot be selected or translated here. Highlight with Area or Pen.', 6000); }
    }
    pg.append(el('div', { class: 'hlLayer' }), el('div', { class: 'areaCap' }), el('canvas', { class: 'ink' }));
    wirePage(n); paintHl(n); paintInk(n); P.rendered = true; setTool(d.tool);
  } catch (e) { if (!/cancel|destroy/i.test(String(e && e.message))) console.warn('render', n, e); }
  P.busy = false;
}
function unrenderPage(n) {
  const d = S.doc; if (!d || !d.pages[n]) return; const P = d.pages[n]; if (!P.rendered) return;
  P.token++; P.rendered = false; $$('canvas,.textLayer,.hlLayer,.areaCap,img', P.el).forEach(x => x.remove());
}
function setZoom(z) {
  const d = S.doc, sc = $('#scroller'); z = Math.min(4, Math.max(0.4, z)); const ratio = sc.scrollTop / Math.max(1, sc.scrollHeight);
  d.zoom = z; $('#zl') && ($('#zl').textContent = Math.round(z * 100) + '%'); const { w, h } = pageCss();
  d.pages.forEach((P, n) => { if (!P) return; P.token++; P.rendered = false; P.busy = false; $$('canvas,.textLayer,.hlLayer,.areaCap,img', P.el).forEach(x => x.remove()); P.el.style.width = w + 'px'; P.el.style.height = h + 'px'; io.unobserve(P.el); io.observe(P.el); });
  sc.scrollTop = ratio * sc.scrollHeight; saveDocState();
}
function scrollToPage(n, quiet) {
  const d = S.doc; n = Math.min(Math.max(1, Math.round(n) || 1), d.numPages); const P = d.pages[n]; if (!P) return;
  $('#scroller').scrollTop = P.el.offsetTop - 10; d.cur = n; $('#pgin') && ($('#pgin').value = n); if (S.tab === 'pageayat') renderTab(); saveDocState();
}
let scTimer = null;
function onDocScroll() {
  clearTimeout(scTimer); scTimer = setTimeout(() => {
    const d = S.doc; if (!d || !d.pages.length) return; const sc = $('#scroller'); const y = sc.scrollTop + sc.clientHeight / 3; let lo = 1, hi = d.numPages;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (d.pages[mid].el.offsetTop <= y) lo = mid; else hi = mid - 1; }
    if (lo !== d.cur) { d.cur = lo; $('#pgin') && ($('#pgin').value = lo); if (S.tab === 'pageayat') renderTab(); saveDocState(); }
  }, 120);
}
/* highlights on pages */
function paintHl(n) {
  const d = S.doc, P = d.pages[n]; const L = $('.hlLayer', P.el); if (!L) return; L.textContent = '';
  d.ann.hl.filter(h => h.page === n).forEach(h => h.rects.forEach(r => {
    L.append(el('div', { 'data-id': h.id, title: d.tool === 'erase' ? 'Click to delete' : h.text || 'Highlight', style: `left:${r[0] * 100}%;top:${r[1] * 100}%;width:${r[2] * 100}%;height:${r[3] * 100}%;background:${h.color}`, onclick: () => { if (S.doc.tool === 'erase') deleteHl(h.id); } }));
  }));
}
function deleteHl(id) { const d = S.doc; const h = d.ann.hl.find(x => x.id === id); d.ann.hl = d.ann.hl.filter(x => x.id !== id); saveAnn(); if (h) paintHl(h.page); if (S.tab === 'marks') renderTab(); }
function addPdfHl(ctx, color) {
  const d = S.doc; if (!d) return; const page = ctx.page; if (!page) return; const n = +page.dataset.n; const pr = page.getBoundingClientRect();
  const rects = [...ctx.range.getClientRects()].filter(r => r.width > 1 && r.height > 1 && r.right > pr.left && r.left < pr.right && r.bottom > pr.top && r.top < pr.bottom)
    .map(r => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height]);
  if (!rects.length) return;
  d.ann.hl.push({ id: uid(), page: n, color, rects, text: ctx.text }); saveAnn(); paintHl(n); if (S.tab === 'marks') renderTab(); toast('Highlighted');
}
function wirePage(n) {
  const d = S.doc, P = d.pages[n], pg = P.el, cap = $('.areaCap', pg), cv = $('canvas.ink', pg);
  // area highlight
  let st = null, ghost = null;
  cap.onpointerdown = (e) => { const r = pg.getBoundingClientRect(); st = [e.clientX - r.left, e.clientY - r.top]; ghost = el('div', { style: `position:absolute;border:2px dashed #1fa6d8;background:${d.color}66;left:${st[0]}px;top:${st[1]}px` }); pg.append(ghost); cap.setPointerCapture(e.pointerId); };
  cap.onpointermove = (e) => { if (!st) return; const r = pg.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; ghost.style.left = Math.min(x, st[0]) + 'px'; ghost.style.top = Math.min(y, st[1]) + 'px'; ghost.style.width = Math.abs(x - st[0]) + 'px'; ghost.style.height = Math.abs(y - st[1]) + 'px'; };
  cap.onpointerup = (e) => { if (!st) return; const r = pg.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; ghost.remove();
    const w = Math.abs(x - st[0]), h = Math.abs(y - st[1]);
    if (w > 6 && h > 6) { d.ann.hl.push({ id: uid(), page: n, color: d.color, rects: [[Math.min(x, st[0]) / r.width, Math.min(y, st[1]) / r.height, w / r.width, h / r.height]], text: '' }); saveAnn(); paintHl(n); if (S.tab === 'marks') renderTab(); }
    st = null; };
  // ink
  let stroke = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.onpointerdown = (e) => { if (d.tool === 'pen') { stroke = { c: d.color, w: 3, p: [pt(e)] }; (d.ann.ink[n] = d.ann.ink[n] || []).push(stroke); } else if (d.tool === 'erase') { stroke = 'erase'; eraseAt(n, pt(e)); } cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { if (!stroke) return; if (stroke === 'erase') eraseAt(n, pt(e)); else { stroke.p.push(pt(e)); paintInk(n); } };
  cv.onpointerup = () => { if (stroke && stroke !== 'erase') saveAnn(); if (stroke === 'erase') saveAnn(); stroke = null; };
}
function eraseAt(n, p) {
  const d = S.doc; const list = d.ann.ink[n] || []; const r = 0.015;
  const keep = list.filter(s => !s.p.some(q => Math.hypot(q[0] - p[0], (q[1] - p[1]) * d.ratio) < r));
  if (keep.length !== list.length) { d.ann.ink[n] = keep; paintInk(n); }
}
function paintInk(n) {
  const d = S.doc, P = d.pages[n]; if (!P) return; const cv = $('canvas.ink', P.el); if (!cv) return; const r = P.el.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.max(1, Math.floor(r.width * dpr)); cv.height = Math.max(1, Math.floor(r.height * dpr));
  const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.lineCap = 'round'; c.lineJoin = 'round';
  (d.ann.ink[n] || []).forEach(s => { c.strokeStyle = s.c; c.lineWidth = s.w * dpr; c.beginPath(); s.p.forEach((q, i) => i ? c.lineTo(q[0] * cv.width, q[1] * cv.height) : c.moveTo(q[0] * cv.width, q[1] * cv.height)); if (s.p.length === 1) c.lineTo(s.p[0][0] * cv.width + .1, s.p[0][1] * cv.height); c.stroke(); });
}

/* ---------- backup ---------- */
$('#btnBackup').onclick = async () => {
  const kv = await DB.allKv(); const files = await DB.listFiles(); const out = { app: 'tabarak-whiteboard', version: 1, qhl: kv.qhl || [], qbm: kv.qbm || [], docs: [] };
  files.forEach(f => out.docs.push({ name: f.name, size: f.size, ann: kv['ann:' + f.id] || null, state: kv['doc:' + f.id] || null }));
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })), download: 'tabarak-whiteboard-notes.json' }); document.body.append(a); a.click(); a.remove();
  toast('Notes saved to a file in Downloads (books are not included)', 4000);
};
$('#btnRestore').onclick = () => $('#restoreFile').click();
$('#restoreFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.app !== 'tabarak-whiteboard') throw new Error('not a whiteboard backup');
    S.qhl = j.qhl || []; S.qbm = j.qbm || []; await DB.set('qhl', S.qhl); await DB.set('qbm', S.qbm);
    const files = await DB.listFiles(); let m = 0;
    for (const d of j.docs || []) { const t = files.find(x => x.name === d.name && x.size === d.size); if (t) { if (d.ann) await DB.set('ann:' + t.id, d.ann); if (d.state) await DB.set('doc:' + t.id, d.state); m++; } }
    toast('Restored Quran highlights and notes for ' + m + ' book(s)'); if (S.view === 'quran') renderQuran(); else setView('welcome');
  } catch (err) { toast('Could not restore: ' + err.message, 5000); }
};

/* ---------- start ---------- */
(async function init() {
  try { await DB.open(); } catch (e) { $('#welcome').append(el('p', { style: 'color:#a22', text: 'This browser blocked storage, so nothing can be saved: ' + e }));
    return; }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
  S.qhl = (await DB.get('qhl')) || []; S.qbm = (await DB.get('qbm')) || [];
  S.tafsirSlug = (await DB.get('settings:tafsir')) || S.tafsirSlug;
  const at = await DB.get('settings:autoTranslate'); if (at !== undefined) S.tr.auto = at;
  const last = await DB.get('last'); await renderLib();
  if (last && last.v === 'quran') openQuran();
  else if (last && last.v === 'doc' && S.files.find(f => f.id === last.id)) openDoc(last.id);
  else setView('welcome');
  if (innerWidth < 800) { $('#panel').classList.add('hide'); if (S.view !== 'welcome') $('#side').classList.add('hide'); }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__ready = true;
})();
