/* ---------- Google Drive (Picker + drive.file scope) ---------- */
const GD = { clientId: '725524055836-6dgeqhcvjs1sf5ppfbicpd717oibtren.apps.googleusercontent.com', apiKey: 'AIzaSyD3x2w3cmAN2q7mZoMBoSKZT6bwwxkhjF4', appId: '725524055836', scope: 'https://www.googleapis.com/auth/drive.file', token: null, exp: 0, tc: null, loaded: {} };
function loadScript(src) { return GD.loaded[src] || (GD.loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load Google script. Check your internet connection.')); document.head.append(s); })); }
async function gdToken(interactive) {
  if (GD.token && Date.now() < GD.exp - 60000) return GD.token;
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((res, rej) => {
    GD.tc = google.accounts.oauth2.initTokenClient({ client_id: GD.clientId, scope: GD.scope,
      callback: (r) => { if (r.error) return rej(new Error('Google sign-in: ' + (r.error_description || r.error))); GD.token = r.access_token; GD.exp = Date.now() + (r.expires_in || 3600) * 1000; DB.set('settings:driveLinked', true); res(GD.token); },
      error_callback: (e) => rej(new Error('Google sign-in was closed or blocked (' + (e.type || 'error') + '). Allow pop-ups for this site and try again.')) });
    GD.tc.requestAccessToken({ prompt: GD.exp ? '' : (GD.first ? '' : 'consent') }); GD.first = true;
  });
}
async function gdPick(mimes, multi) {
  const tok = await gdToken(true);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise(r => gapi.load('picker', r));
  return new Promise((res) => {
    const v = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes(mimes).setIncludeFolders(true).setSelectFolderEnabled(false);
    const b = new google.picker.PickerBuilder().addView(v).setOAuthToken(tok).setDeveloperKey(GD.apiKey).setAppId(GD.appId).setTitle('Choose from Google Drive')
      .setCallback(d => { if (d.action === 'picked') res(d.docs); else if (d.action === 'cancel') res([]); });
    if (multi) b.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    b.build().setVisible(true);
  });
}
async function gdDownload(doc) {
  const tok = await gdToken();
  const r = await fetch('https://www.googleapis.com/drive/v3/files/' + doc.id + '?alt=media', { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error('Drive said ' + r.status + ' for ' + doc.name);
  const total = +(r.headers.get('content-length') || doc.sizeBytes || 0); const reader = r.body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; toast('Downloading ' + doc.name + ' ' + (total ? Math.round(got / total * 100) + '%' : (got / 1048576).toFixed(0) + ' MB'), 60000); }
  return new Blob(parts, { type: doc.mimeType });
}
async function gdOpenFromDrive() {
  try {
    const docs = await gdPick('application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/html', true);
    if (!docs.length) return;
    const files = [];
    for (const d of docs) {
      if (S.files.find(f => f.driveId === d.id)) { toast(d.name + ' is already in your library'); continue; }
      const blob = await gdDownload(d); const name = d.name; const ext = (name.split('.').pop() || '').toLowerCase();
      const kind = d.mimeType === 'application/pdf' ? 'pdf' : d.mimeType.startsWith('image/') ? 'image' : 'text';
      toast('Saving ' + name + ' on this device…', 60000);
      await DB.putFile({ id: uid(), name, kind, size: blob.size, added: Date.now(), blob, ext, driveId: d.id }); files.push(name);
    }
    await renderLib(); if (files.length) toast(files.length + ' file(s) from Drive saved on this device', 5000);
  } catch (e) { toast('Drive: ' + (e.message || e), 7000); }
}
async function gdFolder(tok) {
  const q = encodeURIComponent("name='Tabarak Whiteboard' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const r = await (await fetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)', { headers: { Authorization: 'Bearer ' + tok } })).json();
  if (r.files && r.files[0]) return r.files[0].id;
  const c = await (await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tabarak Whiteboard', mimeType: 'application/vnd.google-apps.folder' }) })).json();
  if (!c.id) throw new Error('Could not create the Drive folder');
  return c.id;
}
async function gdUpload(name, blob, mime) {
  const tok = await gdToken(true); const folder = await gdFolder(tok);
  const meta = { name, parents: [folder] }; const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' })); form.append('file', blob, name);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: form });
  if (!r.ok) throw new Error('Drive upload failed (' + r.status + ')');
  return r.json();
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
async function gdSaveBoard() {
  try {
    if (!BD.inited || !BD.pad) { toast('Open the Whiteboard and draw something first'); return; }
    BD.pages[BD.i] = BD.pad.strokes;
    const png = await new Promise(r => BD.pad.png(BOARD_BG[BD.bg]).toBlob(r, 'image/png'));
    toast('Saving to Drive…', 30000);
    const a = await gdUpload('board-page-' + (BD.i + 1) + '-' + stamp() + '.png', png);
    await gdUpload('board-all-pages-' + stamp() + '.tabarak-board.json', new Blob([JSON.stringify({ app: 'tabarak-board', pages: BD.pages, bg: BD.bg })], { type: 'application/json' }));
    toast('Saved to Drive folder "Tabarak Whiteboard" (picture + editable file)', 6000);
  } catch (e) { toast('Drive: ' + (e.message || e), 7000); }
}
async function gdSaveNotes() {
  try {
    const kv = await DB.allKv(); const files = await DB.listFiles(); const out = { app: 'tabarak-whiteboard', version: 1, qhl: kv.qhl || [], qbm: kv.qbm || [], docs: [] };
    files.forEach(f => out.docs.push({ name: f.name, size: f.size, ann: kv['ann:' + f.id] || null, state: kv['doc:' + f.id] || null }));
    toast('Saving notes to Drive…', 30000);
    await gdUpload('tabarak-notes-' + stamp() + '.json', new Blob([JSON.stringify(out)], { type: 'application/json' }));
    toast('Notes saved to Drive folder "Tabarak Whiteboard"', 5000);
  } catch (e) { toast('Drive: ' + (e.message || e), 7000); }
}
async function gdRestore() {
  try {
    const docs = await gdPick('application/json', false); if (!docs.length) return;
    const d = docs[0]; const blob = await gdDownload(d); const j = JSON.parse(await blob.text());
    if (j.app === 'tabarak-board') { BD.inited = false; $('#boardView').textContent = ''; await DB.set('board', { pages: j.pages, i: 0, bg: j.bg || 'white' }); await openBoard(); toast('Board loaded from Drive'); return; }
    const f = new File([blob], d.name, { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(f);
    const inp = $('#restoreFile'); inp.files = dt.files; await inp.onchange({ target: inp });
  } catch (e) { toast('Drive: ' + (e.message || e), 7000); }
}
$('#gdOpen').onclick = gdOpenFromDrive; $('#gdBoard').onclick = gdSaveBoard; $('#gdNotes').onclick = gdSaveNotes; $('#gdRestore').onclick = gdRestore;
