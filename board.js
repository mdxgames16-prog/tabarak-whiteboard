/* ---------- whiteboard + draw-over-page ---------- */
const INK = ['#111111', '#d62828', '#1565c0', '#1b8a3a', '#f2a900', '#8e44ad', '#ffffff'];
const BOARD_BG = { white: '#ffffff', green: '#1f4d3a', black: '#15181c', cream: '#f7f1dc' };

function Pad(host, opts) {
  opts = opts || {};
  const P = { tool: 'pen', color: '#111111', size: 4, strokes: [], redo: [], onchange: opts.onchange || (() => { }), scrollMode: false };
  const cv = el('canvas', { class: 'padcv' }); host.append(cv);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, cur = null, raf = 0;
  function fit() {
    const r = host.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
  }
  function path(s) {
    const p = s.p; ctx.beginPath();
    if (p.length <= 2) { ctx.arc(p[0], p[1], Math.max(0.5, s.w / 2), 0, 7); return true; }
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) { const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2; ctx.quadraticCurveTo(p[i], p[i + 1], mx, my); }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]); return false;
  }
  function one(s) {
    ctx.save();
    ctx.globalCompositeOperation = s.t === 'er' ? 'destination-out' : 'source-over';
    ctx.globalAlpha = s.t === 'hl' ? 0.35 : 1;
    ctx.strokeStyle = ctx.fillStyle = s.t === 'er' ? '#000' : s.c;
    ctx.lineWidth = s.w; ctx.lineCap = s.t === 'hl' ? 'butt' : 'round'; ctx.lineJoin = 'round';
    const dot = path(s); dot ? ctx.fill() : ctx.stroke(); ctx.restore();
  }
  function draw() { ctx.clearRect(0, 0, W, H); P.strokes.forEach(one); if (cur) one(cur); }
  function sched() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10]; };
  cv.addEventListener('pointerdown', e => {
    if (P.scrollMode || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const w = P.tool === 'er' ? P.size * 3 : P.tool === 'hl' ? P.size * 3 : P.size;
    cur = { t: P.tool, c: P.color, w, p: pos(e) }; sched();
  });
  cv.addEventListener('pointermove', e => {
    if (!cur) return; e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(x => { const q = pos(x); const n = cur.p.length; if (Math.abs(q[0] - cur.p[n - 2]) + Math.abs(q[1] - cur.p[n - 1]) > 0.8) cur.p.push(q[0], q[1]); });
    sched();
  });
  const end = () => { if (!cur) return; P.strokes.push(cur); cur = null; P.redo = []; draw(); P.onchange(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  P.undo = () => { const s = P.strokes.pop(); if (s) { P.redo.push(s); draw(); P.onchange(); } };
  P.redoOne = () => { const s = P.redo.pop(); if (s) { P.strokes.push(s); draw(); P.onchange(); } };
  P.clear = () => { if (!P.strokes.length) return; P.redo = P.strokes.slice().reverse(); P.strokes = []; draw(); P.onchange(); };
  P.load = (arr) => { P.strokes = arr || []; P.redo = []; draw(); };
  P.setScroll = (v) => { P.scrollMode = v; cv.style.pointerEvents = v ? 'none' : 'auto'; };
  P.png = (bg) => { const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height; const c = o.getContext('2d'); if (bg) { c.fillStyle = bg; c.fillRect(0, 0, o.width, o.height); } c.drawImage(cv, 0, 0); return o; };
  P.fit = fit; new ResizeObserver(fit).observe(host); setTimeout(fit, 0);
  return P;
}

function padToolbar(P, extra) {
  const bar = el('div', { class: 'padbar' });
  const tb = {};
  const tool = (k, label, title) => { const b = el('button', { class: 'ptool' + (P.tool === k ? ' on' : ''), title, onclick: () => { P.tool = k; Object.entries(tb).forEach(([kk, bb]) => bb.classList.toggle('on', kk === k)); } }, label); tb[k] = b; return b; };
  bar.append(tool('pen', '✏️ Pen', 'Pen'), tool('hl', '🖍 Marker', 'Transparent marker'), tool('er', '🧽 Eraser', 'Eraser'), el('span', { class: 'sep' }));
  const sws = [];
  INK.forEach(c => { const b = el('button', { class: 'psw' + (P.color === c ? ' on' : ''), style: 'background:' + c, title: 'Colour', onclick: () => { P.color = c; if (P.tool === 'er') tb.pen.click(); sws.forEach(x => x.classList.toggle('on', x === b)); } }); sws.push(b); bar.append(b); });
  const sz = el('input', { type: 'range', min: 1, max: 24, value: P.size, title: 'Thickness', oninput: () => { P.size = +sz.value; dot.style.width = dot.style.height = (3 + P.size) + 'px'; } });
  const dot = el('span', { class: 'sizedot', style: `width:${3 + P.size}px;height:${3 + P.size}px` });
  bar.append(el('span', { class: 'sep' }), el('span', { class: 'small', text: 'Size' }), sz, dot, el('span', { class: 'sep' }));
  bar.append(el('button', { class: 'ptool', title: 'Undo (Ctrl+Z)', onclick: () => P.undo() }, '↩ Undo'), el('button', { class: 'ptool', title: 'Redo', onclick: () => P.redoOne() }, '↪ Redo'),
    el('button', { class: 'ptool', title: 'Clear everything on this page', onclick: () => { if (!P.strokes.length || confirm('Clear everything you drew here?')) P.clear(); } }, '🗑 Clear'));
  (extra || []).forEach(x => bar.append(x));
  return bar;
}

/* ----- full whiteboard view ----- */
const BD = { pages: [[]], i: 0, bg: 'white', pad: null, inited: false };
let bdTimer = 0;
function bdSave() { clearTimeout(bdTimer); bdTimer = setTimeout(() => { BD.pages[BD.i] = BD.pad.strokes; DB.set('board', { pages: BD.pages, i: BD.i, bg: BD.bg }); }, 400); }
async function openBoard() {
  setView('board');
  const v = $('#boardView');
  if (!BD.inited) {
    BD.inited = true;
    const saved = await DB.get('board'); if (saved) { BD.pages = saved.pages && saved.pages.length ? saved.pages : [[]]; BD.i = Math.min(saved.i || 0, BD.pages.length - 1); BD.bg = saved.bg || 'white'; }
    const stage = el('div', { class: 'padstage bg-' + BD.bg });
    BD.stage = stage;
    BD.pad = Pad(stage, { onchange: bdSave });
    const bgSel = el('select', { title: 'Board colour', onchange: () => { BD.bg = bgSel.value; stage.className = 'padstage bg-' + BD.bg; bdSave(); } },
      ...Object.keys(BOARD_BG).map(k => el('option', { value: k, text: { white: 'White board', green: 'Green board', black: 'Black board', cream: 'Cream paper' }[k] })));
    bgSel.value = BD.bg;
    const lbl = el('span', { class: 'small', style: 'min-width:54px;text-align:center' });
    const upd = () => { lbl.textContent = 'Page ' + (BD.i + 1) + '/' + BD.pages.length; };
    const go = (n) => { BD.pages[BD.i] = BD.pad.strokes; BD.i = n; BD.pad.load(BD.pages[BD.i]); upd(); bdSave(); };
    const pg = [el('span', { class: 'sep' }), el('button', { class: 'ptool', title: 'Previous page', onclick: () => BD.i > 0 && go(BD.i - 1) }, '◀'), lbl,
      el('button', { class: 'ptool', title: 'Next page', onclick: () => BD.i < BD.pages.length - 1 && go(BD.i + 1) }, '▶'),
      el('button', { class: 'ptool', title: 'Add a new blank page', onclick: () => { BD.pages[BD.i] = BD.pad.strokes; BD.pages.splice(BD.i + 1, 0, []); go(BD.i + 1); } }, '＋ Page'),
      el('button', { class: 'ptool', title: 'Delete this page', onclick: () => { if (BD.pages.length > 1 && confirm('Delete this page?')) { BD.pages.splice(BD.i, 1); BD.i = Math.min(BD.i, BD.pages.length - 1); BD.pad.load(BD.pages[BD.i]); upd(); bdSave(); } } }, '✕ Page'),
      el('span', { class: 'sep' }), bgSel,
      el('button', { class: 'ptool', title: 'Download this page as a picture', onclick: () => { const o = BD.pad.png(BOARD_BG[BD.bg]); const a = el('a', { download: 'tabarak-board-' + (BD.i + 1) + '.png', href: o.toDataURL('image/png') }); document.body.append(a); a.click(); a.remove(); } }, '⬇ Save picture')];
    v.append(padToolbar(BD.pad, pg), stage); BD.pad.load(BD.pages[BD.i]); upd();
    document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z' && S.view === 'board') { e.preventDefault(); BD.pad.undo(); } });
  } else setTimeout(() => BD.pad.fit(), 0);
}
$('#btnBoard').onclick = openBoard;

/* ----- draw over Quran / book pages ----- */
const OV = { on: false, pad: null, root: null };
function toggleOverlay(force) {
  const on = force !== undefined ? force : !OV.on; if (on === OV.on) return;
  OV.on = on; $('#btnOverlay').classList.toggle('on', on);
  if (!on) { OV.root.remove(); OV.root = null; OV.pad = null; return; }
  const r = $('#main').getBoundingClientRect();
  const root = el('div', { id: 'ovRoot' }); const stage = el('div', { class: 'padstage ov' });
  root.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  const pad = Pad(stage);
  const sc = el('button', { class: 'ptool', title: 'Turn on to scroll or tap the page underneath. Turn off to draw again.', onclick: () => { pad.setScroll(!pad.scrollMode); sc.classList.toggle('on', pad.scrollMode); stage.classList.toggle('through', pad.scrollMode); } }, '✋ Scroll page');
  const close = el('button', { class: 'ptool danger', title: 'Close drawing (what you drew here is removed)', onclick: () => { if (!pad.strokes.length || confirm('Close drawing? What you drew over this page will be removed.')) toggleOverlay(false); } }, '✕ Done');
  const png = el('button', { class: 'ptool', title: 'Download your drawing (transparent picture)', onclick: () => { const o = pad.png(null); const a = el('a', { download: 'tabarak-drawing.png', href: o.toDataURL('image/png') }); document.body.append(a); a.click(); a.remove(); } }, '⬇ Save');
  const bar = padToolbar(pad, [el('span', { class: 'sep' }), sc, png, close]);
  root.append(bar, stage); document.body.append(root); OV.root = root; OV.pad = pad;
  pad.color = '#d62828'; bar.querySelectorAll('.psw').forEach((b, i) => b.classList.toggle('on', i === 1));
  toast('Draw on the page. Tap "Scroll page" to scroll, "Done" to close.', 3500);
}
$('#btnOverlay').onclick = () => toggleOverlay();
const _sv = setView;
setView = function (v) { if (OV.on) toggleOverlay(false); _sv(v); $('#btnOverlay').hidden = !(v === 'quran' || v === 'doc'); };
