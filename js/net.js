/* =====================================================================
   AGE OF CROWNS: ONLINE LAYER
   Sign-in (Supabase), character load/save, other players in the 3D world,
   chat, trading, property, armies, elections, parliament and world events.
   Talks to the game through window.AOC and window.AOC_HOOK, and to the
   multiplayer server over a WebSocket. Does nothing if js/config.js is empty.
   ===================================================================== */
(function () {
  'use strict';
  const CFG = window.AOC_CONFIG || {};
  const ONLINE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_PUBLISHABLE_KEY && CFG.SERVER_URL);
  if (!ONLINE) { console.info('[Age of Crowns] Online play is off. Fill in js/config.js to turn it on.'); return; }

  const KCOL = ['#9fcbff', '#ff9d8c', '#97e3a3', '#86e1ee'];
  const CH_NAMES = { global: 'Global', local: 'Local', kingdom: 'Kingdom', army: 'Army', pm: 'Private', sys: 'Herald' };
  const N = {
    sb: null, ws: null, session: null, you: null, ready: false, entered: false, creating: false, needCharacter: false,
    wseq: 0, remotes: new Map(), roster: [], props: new Map(), pol: null, mil: null, events: new Map(), offices: [], regiments: [],
    crowned: -1, sendT: 0, lastSent: 0, last: null, pendingSave: null, lastSaveSent: 0, saveTimer: null, retry: 0, noRetry: false,
    log: [], chatOpen: true, chatTab: 'all', unread: 0, realmTab: 'players', trade: null, estateCb: null, prompt: null, clock: 0,
  };
  const $ = id => document.getElementById(id);
  const A = () => window.AOC;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, c) => { try { A().toast(m, c); } catch (e) { console.log(m); } };
  const send = m => { if (N.ws && N.ws.readyState === 1) { N.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); return true; } return false; };
  const fmtT = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const left = ts => { const s = Math.max(0, Math.round((ts - Date.now()) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const inGame = () => A() && A().state === 'play';
  const P = () => A().P;
  const insideKey = () => { const p = P(); return p.inside && p.inside.door ? p.inside.door.x.toFixed(1) + ',' + p.inside.door.z.toFixed(1) : null; };
  const houseId = d => 'h:' + Math.round(d.x * 10) / 10 + ',' + Math.round(d.z * 10) / 10;

  // ------------------------------------------------------------------ hooks the game calls
  const HOOK = window.AOC_HOOK = {
    online: false,
    save(js, force) {
      if (!N.entered) return;
      N.pendingSave = js;
      const now = Date.now();
      if (!force && now - N.lastSaveSent < 4000) { if (!N.saveTimer) N.saveTimer = setTimeout(() => { N.saveTimer = null; flushSave(false); }, 4100 - (now - N.lastSaveSent)); return; }
      flushSave(force);
    },
    frame: dt => frame(dt),
    interact() { if (window.AOC_SEASONS && window.AOC_SEASONS.interact()) return true; const R = nearestRemote(2.6); if (!R) return false; playerMenu(R); return true; },
    houseTaken(d) { const p = N.props.get(houseId(d)); return !!(p && !p.mine); },
    buyHouse(d) { if (!send({ t: 'buyHouse', id: houseId(d) })) toast('You are not connected to the realm right now.', 'bad'); else N.buyingDoor = d; },
    buyEstate(t, done) { N.estateCb = done; if (!send({ t: 'buyEstate', town: t.idx })) { N.estateCb = null; toast('You are not connected to the realm right now.', 'bad'); } },
    estateFailed(t) { send({ t: 'estateRefund', town: t.idx }); },
    newGame(ns) {
      if (!HOOK.online) return false;
      if (!N.needCharacter) { toast('Your character is loading…'); return true; }
      N.creating = true; authMsg('Creating your character…');
      send({ t: 'create', name: ns.name, kingdom: ns.home, look: Object.assign({ fur: ns.fur }, ns.look), save: ns });
      return true;
    },
    outfit(o) { N.look = cleanLook(o); if (N.ready) send({ t: 'look', look: N.look }); },
    joinStorm() { send({ t: 'joinStorm' }); },
    mapMarkers(ctx, tr, scale) {
      ctx.save();
      for (const e of N.events.values()) { const p = tr(e.x, e.z); ctx.fillStyle = '#ffd25a'; ctx.strokeStyle = '#3a2400'; ctx.lineWidth = 2 * scale; star(ctx, p[0], p[1], 9 * scale); ctx.fill(); ctx.stroke(); }
      ctx.font = `600 ${Math.round(12 * scale)}px Alegreya, Georgia, serif`; ctx.textAlign = 'center';
      for (const r of N.roster) {
        if ((N.you && r.nid === N.you.nid) || r.x == null) continue;
        const p = tr(r.x, r.z); ctx.fillStyle = KCOL[r.k] || '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * scale;
        ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 3 * scale; ctx.strokeText(r.name, p[0], p[1] - 8 * scale); ctx.fillStyle = '#fff'; ctx.fillText(r.name, p[0], p[1] - 8 * scale);
      }
      if (window.AOC_SEASONS) try { window.AOC_SEASONS.mapMarkers(ctx, tr, scale); } catch (e) {}
      ctx.restore();
    },
  };
  function star(ctx, x, y, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * .45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
  function cleanLook(o) { const out = {}; for (const k in o) { const v = o[k]; if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') out[k] = v; } return out; }
  function flushSave(force) {
    if (!N.pendingSave) return;
    if (!N.ws || N.ws.readyState !== 1) return;       // kept and sent again after reconnecting
    N.lastSaveSent = Date.now();
    send('{"t":"save","wseq":' + N.wseq + ',"force":' + (!!force) + ',"save":' + N.pendingSave + '}');
    N.pendingSave = null;
  }

  // ------------------------------------------------------------------ sign-in on the title screen
  function titleCol() { const t = $('title'); return t && t.querySelector('.tcol'); }
  function setTitleFields(show) {
    const col = titleCol(); if (!col) return;
    for (const el of col.children) { if (el.id === 'aocAuth' || el.classList.contains('logo') || el.classList.contains('intro')) continue; el.style.display = show ? '' : 'none'; }
    const bc = $('bCont'); if (bc && HOOK.online) bc.style.display = 'none';
  }
  function authBox() {
    let box = $('aocAuth'); if (box) return box;
    const col = titleCol(); if (!col) return null;
    box = document.createElement('div'); box.id = 'aocAuth'; box.className = 'aocbox';
    const intro = col.querySelector('.intro'); (intro || col.firstChild).after(box);
    return box;
  }
  function authMsg(msg, bad) { const m = $('aocAuthMsg'); if (m) { m.textContent = msg || ''; m.classList.toggle('bad', !!bad); } }
  function showSignIn(note) {
    const box = authBox(); if (!box) return;
    setTitleFields(false);
    box.innerHTML = `<h3 class="cz">Enter the online realm</h3>
      <div class="aocrow"><input id="aocEmail" type="email" autocomplete="email" placeholder="Email"></div>
      <div class="aocrow"><input id="aocPass" type="password" autocomplete="current-password" placeholder="Password (at least 6 characters)"></div>
      <div class="aocrow"><button class="big" id="aocIn">Sign in</button><button class="big alt" id="aocUp">Create account</button></div>
      <div id="aocAuthMsg" class="aocmsg"></div>
      <button class="aoclink" id="aocOff">Play offline instead (single player, saved in this browser)</button>`;
    authMsg(note || '');
    const go = async up => {
      const email = $('aocEmail').value.trim(), password = $('aocPass').value;
      if (!email || password.length < 6) return authMsg('Enter your email and a password of at least 6 characters.', true);
      authMsg(up ? 'Creating your account…' : 'Signing in…');
      try {
        const r = up ? await N.sb.auth.signUp({ email, password }) : await N.sb.auth.signInWithPassword({ email, password });
        if (r.error) return authMsg(r.error.message, true);
        if (!r.data.session) return authMsg('Account created. Check your email to confirm it, then sign in.');
        N.session = r.data.session; connect();
      } catch (e) { authMsg('Could not reach Supabase: ' + e.message, true); }
    };
    $('aocIn').onclick = () => go(false); $('aocUp').onclick = () => go(true);
    $('aocPass').addEventListener('keydown', e => { if (e.key === 'Enter') go(false); });
    $('aocOff').onclick = () => { N.noRetry = true; box.remove(); setTitleFields(true); };
  }
  function showSignedIn(text) {
    const box = authBox(); if (!box) return;
    box.innerHTML = `<div class="aocmsg" id="aocAuthMsg">${esc(text)}</div><button class="aoclink" id="aocOut">Sign out</button>`;
    $('aocOut').onclick = logout;
  }
  function showCreate() {
    const box = authBox(); if (!box) return;
    setTitleFields(true);
    box.innerHTML = `<h3 class="cz">Create your character</h3><div class="aocmsg" id="aocAuthMsg">Choose a name, fur, coat and kingdom below. Your name is unique across the realm.</div><button class="aoclink" id="aocOut">Sign out</button>`;
    $('aocOut').onclick = logout;
    const b = $('bNew'); if (b) b.textContent = 'Create character and enter the realm';
    const bc = $('bCont'); if (bc) bc.style.display = 'none';
  }
  async function logout() {
    try { if (inGame()) A().save(true); } catch (e) {}
    N.noRetry = true;
    setTimeout(async () => { try { if (N.ws) N.ws.close(1000); } catch (e) {} try { await N.sb.auth.signOut(); } catch (e) {} location.reload(); }, 600);
  }

  // ------------------------------------------------------------------ connection
  async function connect() {
    if (N.ws && N.ws.readyState <= 1) return;
    const { data } = await N.sb.auth.getSession();
    N.session = data && data.session;
    if (!N.session) { if (!N.entered) showSignIn(); return; }
    if (!N.entered) showSignedIn('Signed in as ' + (N.session.user && N.session.user.email || 'you') + '. Connecting to the realm…');
    let ws; try { ws = new WebSocket(CFG.SERVER_URL); } catch (e) { return failConnect('Bad SERVER_URL in js/config.js.'); }
    N.ws = ws;
    ws.onopen = () => { N.retry = 0; ws.send(JSON.stringify({ t: 'hello', token: N.session.access_token, v: 1 })); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } const h = RX[m.t]; if (h) { try { h(m); } catch (err) { console.warn('[net]', m.t, err); } } else if (window.AOC_SEASONS) { try { window.AOC_SEASONS.rx(m); } catch (err) { console.warn('[seasons]', m.t, err); } } };
    ws.onclose = ev => {
      const was = N.ready; N.ready = false; clearRemotes(); setLink(false);
      if (N.noRetry || [4001, 4002, 4003, 4004].includes(ev.code)) return;
      const wait = Math.min(30000, 2000 * Math.pow(1.6, N.retry++));
      if (N.entered) { if (was) toast('Lost connection to the realm. Reconnecting…', 'bad'); }
      else authMsg('Cannot reach the multiplayer server. Retrying…', true);
      setTimeout(connect, wait);
    };
  }
  function failConnect(msg) { authMsg(msg, true); }

  // ------------------------------------------------------------------ messages from the server
  const RX = {
    auth(m) {
      if (!m.ok) { N.noRetry = true; N.sb.auth.signOut().catch(() => {}); if (!N.entered) showSignIn(m.msg); else toast(m.msg, 'bad'); return; }
      HOOK.online = true; N.you = Object.assign(N.you || {}, { id: m.id, admin: m.admin });
      N.needCharacter = !!m.needCharacter;
      if (N.needCharacter && !N.entered) showCreate();
    },
    world(m) {
      N.you = m.you; N.wseq = m.wseq; N.mil = m.mil; N.pol = m.pol; N.regiments = m.regiments || [];
      N.props = new Map(m.props.map(p => [p.id, p])); N.events = new Map(m.events.map(e => [e.id, e]));
      N.needCharacter = false; N.ready = true; setLink(true);
      // a returning player sees the home screen first; a brand-new character goes straight in
      if (!N.entered && !N.creating) { N.homeWorld = m; N.wal = null; showHome(); return; }
      enterNow(m);
    },
    wallet(m) { if (!N.entered) { N.wal = m; if (typeof m.wseq === 'number') N.wseq = m.wseq; return; } applyWallet(m); },
    pj(m) { addRemote(m.p); }, pu(m) { addRemote(m.p, true); }, pl(m) { removeRemote(m.nid); },
    st(m) { for (const a of m.p) { const R = N.remotes.get(a[0]); if (!R) continue; R.tx = a[1]; R.ty = a[2]; R.tz = a[3]; R.tyaw = a[4]; setMode(R, a[5]); R.spd = a[6]; } },
    roster(m) { N.roster = m.list; if (N.realmOpen && N.realmTab === 'players') renderRealm(); },
    chat(m) { addChat(m); },
    toast(m) { toast(m.msg, m.cls); },
    err(m) { if (!N.entered) authMsg(m.msg, true); else toast(m.msg, 'bad'); if (N.creating && !N.entered) N.creating = false; },
    emote(m) { const R = N.remotes.get(m.nid); if (R) R.emoteT = 2.2; addChat({ ch: 'local', sys: true, from: '', body: `${m.name} ${{ wave: 'waves', bow: 'bows', cheer: 'cheers', salute: 'salutes', dance: 'dances a jig', laugh: 'laughs' }[m.e] || (window.AOC_SEASONS && window.AOC_SEASONS.emoteVerb(m.e)) || 'waves'}.`, ts: Date.now() }); },
    profile(m) { showProfile(m.p); },
    tradeAsk(m) {
      A().openPanel('Trade offer', m.name, `<p>${esc(m.name)} would like to trade with you.</p>`, [
        { label: 'Open the trade', primary: true, fn: () => { send({ t: 'tradeAns', ok: true }); A().closePanel(); } },
        { label: 'No thank you', fn: () => { send({ t: 'tradeAns', ok: false }); A().closePanel(); } }]);
    },
    trade(m) { N.trade = m; renderTrade(); },
    tradeEnd(m) { const wasOpen = !!N.trade; N.trade = null; if (wasOpen) A().closePanel(); toast(m.msg, m.done ? 'gold' : ''); if (m.done) A().save(true); },
    houseOk(m) {
      const p = P(); const i = A().DOORS.findIndex(d => d.room === 'house' && houseId(d) === m.id);
      if (i >= 0) { p.houses = (p.houses || []).filter(q => q !== i); p.houses.push(i); p.house = i; A().updateHouseMarker(); }
      N.props.set(m.id, { id: m.id, kind: 'house', mine: true, owner: N.you.name });
      if (m.old) N.props.delete(m.old);
      try { A().sfxChime && A().sfxChime(); } catch (e) {}
      toast(`The deed is yours (${m.cost} gold). A green lantern hangs by your new door.`, 'gold'); A().save(true);
    },
    houseNo(m) { toast(m.msg, 'bad'); },
    estateOk() { const cb = N.estateCb; N.estateCb = null; if (cb) cb(); },
    estateNo(m) { N.estateCb = null; toast(m.msg, 'bad'); },
    prop(m) { if (m.owner) N.props.set(m.id, { id: m.id, kind: m.kind, town: m.town, owner: m.owner, mine: !!m.mine }); else N.props.delete(m.id); },
    mil(m) { N.mil = m.mil; syncCorps(); if (N.realmOpen) renderRealm(); },
    rankSet(m) {
      const p = P(), R = A().RANKS; if (typeof m.army === 'number' && m.army >= 0) p.army = m.army; if (m.corps) p.corps = m.corps; p.rank = m.rank; p.merit = Math.max(p.merit || 0, R[m.rank] ? R[m.rank].m : 0); try { A().outfit(); } catch (e) {}
      if (N.mil) N.mil.rank = m.rank;
      if (m.by || m.note !== '') toast(m.by ? `${m.by} sets your rank to ${R[m.rank].n}.` : (m.note || `Your rank is now ${R[m.rank].n}.`), m.by ? 'gold' : '');
    },
    offices(m) {
      N.offices = m.mine || [];
      const mon = N.offices.find(o => o.office === 'monarch'), p = P();
      if (mon && p.ruler !== mon.k) { p.ruler = mon.k; N.crowned = mon.k; try { A().outfit(); } catch (e) {} toast(`You are crowned ruler of ${A().K[mon.k].name}!`, 'gold'); }
      else if (!mon && N.crowned >= 0) { if (p.ruler === N.crowned) { p.ruler = -1; try { A().outfit(); } catch (e) {} } N.crowned = -1; }
      if (N.realmOpen) renderRealm();
    },
    pol(m) { N.pol = m.pol; if (N.realmOpen) renderRealm(); },
    kingdom(m) { P().home = m.k; if (N.you) N.you.kingdom = m.k; N.pol = m.pol; if (N.realmOpen) renderRealm(); },
    regInvite(m) {
      A().openPanel('Regiment invitation', m.name, `<p>${esc(m.from)} invites you to join the <b>${esc(m.name)}</b>.</p>`, [
        { label: 'Join the regiment', primary: true, fn: () => { send({ t: 'regJoin', id: m.id, ok: true }); A().closePanel(); } },
        { label: 'Decline', fn: () => A().closePanel() }]);
    },
    event(m) { const isNew = !N.events.has(m.ev.id); N.events.set(m.ev.id, m.ev); if (isNew) toast('⚑ ' + m.ev.title, 'gold'); if (N.realmOpen) renderRealm(); },
    eventEnd(m) { N.events.delete(m.id); if (N.realmOpen) renderRealm(); },
    adminList(m) { N.adminList = m; N.adminAt = Date.now(); if (N.realmOpen && N.realmTab === 'admin') renderRealm(); },
    summon(m) { if (!inGame()) return; try { A().closePanel(); A().adminWarp(m.x, m.z); } catch (e) {} toast(`${m.by} has brought you to them.`, 'gold'); },
    kicked(m) { N.noRetry = true; toast(m.msg, 'bad'); setTimeout(() => alertBox(m.msg), 300); },
    pong() {},
  };
  // the corps a soldier serves in comes from the server; the game dresses and arms them from it
  function syncCorps() { try { const p = P(); if (!p) return; const c = N.mil && N.mil.corps ? N.mil.corps : 'line'; if (N.mil && typeof N.mil.army === 'number') { p.army = N.mil.army; p.rank = N.mil.rank; } if (p.corps !== c) { p.corps = c; if (N.entered) A().outfit(); } } catch (e) {} }
  function enterNow(m) {
      if (!N.entered) {
        N.entered = true; const box = $('aocAuth'); if (box) box.remove();
        A().startGame(m.save, !N.creating);
        syncCorps();
        buildUI();
        for (const h of m.history || []) addChat(h, true);
        for (const p of m.pms || []) addChat(p);
        if (m.pms && m.pms.length) toast(`You have ${m.pms.length} private message${m.pms.length === 1 ? '' : 's'} from while you were away.`, 'gold');
        toast(`Welcome to the online realm, ${m.you.name}. Press Enter to chat and . (full stop) for the Realm panel.`, 'gold');
      } else if (N.pendingSave) flushSave(true);
      applyWallet({ gold: m.save.gold, items: m.save.items, cargo: m.save.cargo, wseq: m.wseq });
      if (N.wal) { applyWallet(N.wal); N.wal = null; }   // anything the server changed while we were on the home screen
      syncHouse();
      if (N.look) send({ t: 'look', look: N.look }); else if (P().visO) send({ t: 'look', look: cleanLook(P().visO) });
    
  }
  function alertBox(msg) { const d = document.createElement('div'); d.className = 'aocover'; d.innerHTML = `<div class="aocbox"><p>${esc(msg)}</p><button class="big" onclick="location.reload()">Reload</button></div>`; document.body.appendChild(d); }
  function applyWallet(m) {
    const p = P(); if (!p) return;
    const hadMusket = !!(p.items && p.items.musket);
    if (typeof m.gold === 'number') p.gold = m.gold;
    if (m.items) p.items = Object.assign({ tonic: 0, musket: false, backpack: false, lumen: false }, m.items);
    if (m.cargo) p.cargo = Object.assign({}, m.cargo);
    if (typeof m.wseq === 'number') N.wseq = m.wseq;
    if (hadMusket !== !!p.items.musket) { try { A().outfit(); } catch (e) {} }
  }
  function syncHouse() {
    const p = P(); const D = A().DOORS; const ids = new Set([...N.props.values()].filter(x => x.mine && x.kind === 'house').map(x => x.id));
    const own = []; D.forEach((d, i) => { if (d.room === 'house' && ids.has(houseId(d))) own.push(i); });
    const key = own.join(','); if ((p.houses || []).join(',') !== key || (own.length ? !own.includes(p.house) : p.house !== -1)) { p.houses = own; p.house = own.length ? (own.includes(p.house) ? p.house : own[own.length - 1]) : -1; try { A().updateHouseMarker(); } catch (e) {} }
  }

  // ------------------------------------------------------------------ other players in the world
  function nameTag(p) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.textAlign = 'center'; g.lineJoin = 'round';
    g.font = '700 46px Cinzel, Georgia, serif'; g.lineWidth = 9; g.strokeStyle = 'rgba(10,14,22,.85)'; g.strokeText(p.name, 256, 54); g.fillStyle = (p.cos && p.cos.plate) || KCOL[p.k] || '#fff'; g.fillText(p.name, 256, 54);
    g.font = 'italic 30px Alegreya, Georgia, serif'; g.lineWidth = 7; g.strokeText(p.title || '', 256, 100); g.fillStyle = '#efe6d2'; g.fillText(p.title || '', 256, 100);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(4.2, 1.05, 1); s.renderOrder = 10; return s;
  }
  function lookFor(p) { const l = Object.assign({ fur: '#8b6a4e', coat: '#6b5a43', trim: '#d9ccb0', pants: '#5a4a3a', hat: 'none', hatCol: '#1d1712' }, p.look || {}); if (p.cos && p.cos.gunfin) l.gunfin = p.cos.gunfin; return l; }
  function addRemote(p, update) {
    let R = N.remotes.get(p.nid);
    const lookKey = JSON.stringify(p.look || {}) + JSON.stringify((p.cos && p.cos.gunfin) || '');
    const cosKey = JSON.stringify(p.cos || {});
    if (R && R.lookKey !== lookKey) { A().scene.remove(R.vis.g); R.vis = A().makeMouse(lookFor(p)); R.vis.g.scale.setScalar((p.look && p.look.size) || 1); A().scene.add(R.vis.g); R.vis.g.position.set(R.tx, R.ty, R.tz); R.lookKey = lookKey; }
    if (R && (R.name !== p.name || R.title !== p.title || R.cosKey !== cosKey)) { A().scene.remove(R.tag); R.tag.material.map.dispose(); R.tag = nameTag(p); A().scene.add(R.tag); }
    if (!R) {
      if (update) return;
      const vis = A().makeMouse(lookFor(p)); vis.g.scale.setScalar((p.look && p.look.size) || 1);
      vis.g.position.set(p.x, p.y, p.z); vis.g.rotation.y = p.yaw || 0; A().scene.add(vis.g);
      const tag = nameTag(p); A().scene.add(tag);
      R = { nid: p.nid, vis, tag, lookKey, cosKey, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw || 0, spd: 0, mode: 'walk', emoteT: 0, ride: null };
      N.remotes.set(p.nid, R);
    }
    if (R.cosKey !== cosKey && R.ride) { const md = R.mode; R.mode = null; R.cos = p.cos || {}; setMode(R, md); }
    Object.assign(R, { name: p.name, title: p.title, k: p.k, army: p.army, inside: p.in, cos: p.cos || {}, cosKey });
    if (!update) { R.tx = p.x; R.ty = p.y; R.tz = p.z; }
    setMode(R, p.mode);
  }
  function setMode(R, mode) {
    if (R.mode === mode) return; R.mode = mode;
    if (R.ride) { A().scene.remove(R.ride); R.ride = null; }
    try {
      if (mode === 'ship') { R.ride = A().makeShip(R.k >= 0 ? R.k : 0); if (R.cos && R.cos.sails && A().shipSails) A().shipSails(R.ride, R.cos.sails); A().scene.add(R.ride); }
      else if (mode === 'balloon') { R.ride = A().makeBalloon(R.k >= 0 ? R.k : -1, (R.cos && R.cos.balloon) || undefined); A().scene.add(R.ride); }
    } catch (e) { R.ride = null; }
  }
  function removeRemote(nid) { const R = N.remotes.get(nid); if (!R) return; A().scene.remove(R.vis.g); A().scene.remove(R.tag); if (R.ride) A().scene.remove(R.ride); try { R.tag.material.map.dispose(); R.tag.material.dispose(); } catch (e) {} N.remotes.delete(nid); }
  function clearRemotes() { for (const nid of [...N.remotes.keys()]) removeRemote(nid); }
  function nearestRemote(maxD) {
    const p = P(); let best = null, bd = maxD;
    for (const R of N.remotes.values()) { const d = Math.hypot(R.vis.g.position.x - p.pos.x, R.vis.g.position.z - p.pos.z); if (d < bd && Math.abs(R.vis.g.position.y - p.pos.y) < 3) { bd = d; best = R; } }
    return best;
  }
  const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  function frame(dt) {
    N.clock += dt;
    const p = P();
    // send our position ~10 times a second while moving, once a second when still
    N.sendT -= dt;
    if (N.ready && N.sendT <= 0) {
      N.sendT = 0.1;
      const yaw = p.vis ? p.vis.g.rotation.y : (p.yaw || 0);
      const cur = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw, mode: p.riding && p.mode === 'walk' ? 'ride' : p.mode, in: insideKey() };
      const L = N.last, t = performance.now();
      const moved = !L || Math.abs(L.x - cur.x) > .02 || Math.abs(L.z - cur.z) > .02 || Math.abs(L.y - cur.y) > .02 || Math.abs(L.yaw - cur.yaw) > .01 || L.mode !== cur.mode || L.in !== cur.in;
      if (moved || t - N.lastSent > 1000) {
        const spd = L ? Math.hypot(cur.x - L.x, cur.z - L.z) / Math.max(.05, (t - N.lastSent) / 1000) : 0;
        send({ t: 's', x: +cur.x.toFixed(2), y: +cur.y.toFixed(2), z: +cur.z.toFixed(2), yaw: +cur.yaw.toFixed(3), mode: cur.mode, spd: +spd.toFixed(2), in: cur.in });
        N.last = cur; N.lastSent = t;
      }
    }
    // move, animate and label everyone else
    const k = 1 - Math.exp(-dt * 12);
    for (const R of N.remotes.values()) {
      const g = R.vis.g, d = Math.hypot(R.tx - g.position.x, R.tz - g.position.z);
      if (d > 40) g.position.set(R.tx, R.ty, R.tz); else { g.position.x += (R.tx - g.position.x) * k; g.position.y += (R.ty - g.position.y) * k; g.position.z += (R.tz - g.position.z) * k; }
      g.rotation.y += wrapA(R.tyaw - g.rotation.y) * k;
      const anim = R.mode === 'swim' ? 'swim' : 'walk';
      try { A().animMouse(R.vis, R.mode === 'walk' || R.mode === 'swim' || R.mode === 'ride' ? Math.min(R.spd || 0, 9) : 0, dt, anim); } catch (e) {}
      if (R.emoteT > 0) { R.emoteT -= dt; if (R.vis.arms) { R.vis.arms[1].rotation.x = -2.7 + Math.sin(N.clock * 9) * .35; R.vis.arms[1].rotation.z = -.2; } }
      if (R.ride) { if (R.mode === 'ship') { R.ride.position.set(g.position.x, .2, g.position.z); R.ride.rotation.y = g.rotation.y; } else { R.ride.position.set(g.position.x, g.position.y - .15, g.position.z); } }
      const far = Math.hypot(g.position.x - p.pos.x, g.position.z - p.pos.z);
      R.tag.visible = far < 140; R.tag.position.set(g.position.x, g.position.y + 2.55 * (g.scale.y || 1) + (R.mode === 'balloon' ? .4 : 0), g.position.z);
    }
    // "E" prompt beside a nearby player
    const near = !A().uiOpen() ? nearestRemote(2.6) : null;
    const pr = $('aocPrompt');
    if (pr) { if (near) { pr.textContent = `E · ${near.name}`; pr.classList.remove('hidden'); } else pr.classList.add('hidden'); }
  }

  // ------------------------------------------------------------------ chat
  function buildUI() {
    if ($('aocChat')) return;
    const d = document.createElement('div'); d.id = 'aocChat'; d.className = 'glass';
    d.innerHTML = `<div class="aochead"><div class="aoctabs">${['all', 'global', 'local', 'kingdom', 'army', 'pm'].map(t => `<button data-tab="${t}" class="${t === 'all' ? 'on' : ''}">${t === 'all' ? 'All' : CH_NAMES[t]}</button>`).join('')}</div>
      <span id="aocLink" class="aoclinkdot" title="Connection"></span><button id="aocMin" title="Hide or show chat">▾</button></div>
      <div id="aocLog" class="aoclog" aria-live="polite"></div>
      <form id="aocForm" autocomplete="off"><select id="aocCh" aria-label="Channel">${['global', 'local', 'kingdom', 'army', 'pm'].map(c => `<option value="${c}">${CH_NAMES[c]}</option>`).join('')}</select>
      <input id="aocTo" placeholder="To" maxlength="24" class="hidden" aria-label="Recipient"><input id="aocMsg" maxlength="240" placeholder="Press Enter to chat" aria-label="Message" enterkeyhint="send"><button type="submit" class="aocsend" title="Send (Enter)" aria-label="Send">➤</button></form>`;
    document.body.appendChild(d);
    const bar = document.createElement('div'); bar.id = 'aocBar';
    bar.innerHTML = `<button class="btn" id="aocRealmBtn" title="Realm panel (.)">⚜ Realm</button><span id="aocUnread" class="hidden"></span>`;
    document.body.appendChild(bar);
    const pr = document.createElement('div'); pr.id = 'aocPrompt'; pr.className = 'glass hidden'; document.body.appendChild(pr);
    $('aocRealmBtn').onclick = () => openRealm();
    $('aocMin').onclick = () => { N.chatOpen = !N.chatOpen; d.classList.toggle('min', !N.chatOpen); $('aocMin').textContent = N.chatOpen ? '▾' : '▴'; if (N.chatOpen) { N.unread = 0; badge(); } };
    d.querySelectorAll('.aoctabs button').forEach(b => b.onclick = () => { N.chatTab = b.dataset.tab; d.querySelectorAll('.aoctabs button').forEach(x => x.classList.toggle('on', x === b)); filterLog(); if (['global', 'local', 'kingdom', 'army', 'pm'].includes(N.chatTab)) setCh(N.chatTab); });
    $('aocCh').onchange = () => setCh($('aocCh').value);
    const msg = $('aocMsg');
    msg.addEventListener('focus', () => { try { A().releaseMouse(); const k = A().keys; for (const c in k) k[c] = false; } catch (e) {} });
    msg.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') msg.blur();
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); }
    });
    $('aocTo').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); msg.focus(); } else if (e.key === 'Escape') $('aocTo').blur(); });
    $('aocForm').onsubmit = e => { e.preventDefault(); sendChat(); };
    setLink(true);
    setTimeout(() => { const early = N.early || []; N.early = null; for (const x of early) { const i = N.log.indexOf(x); if (i >= 0) N.log.splice(i, 1); addChat(x, true); } }, 0);
  }
  function setCh(c) { $('aocCh').value = c; $('aocTo').classList.toggle('hidden', c !== 'pm'); }
  function setLink(ok) { const l = $('aocLink'); if (l) { l.classList.toggle('off', !ok); l.title = ok ? 'Connected to the realm' : 'Reconnecting…'; } }
  function badge() { const b = $('aocUnread'); if (!b) return; b.textContent = N.unread > 99 ? '99+' : String(N.unread); b.classList.toggle('hidden', !N.unread || N.chatOpen); }
  function sendChat() {
    const msg = $('aocMsg'); let body = msg.value.trim(); if (!body) { msg.blur(); return; }
    let ch = $('aocCh').value, to = $('aocTo').value.trim();
    if (ch === 'pm' && !body.startsWith('/') && !to) { toast('Who is the private message for? Fill in “To”, or click a name in chat.', 'bad'); return; }
    if (!send({ t: 'chat', ch, to, body })) { toast('Not connected to the realm right now. Your message was kept.', 'bad'); return; }
    msg.value = ''; msg.blur();   // back to the world; press Enter again to write another
  }
  function chKey(m) { return m.sys && !m.ch ? 'sys' : m.ch; }
  function addChat(m, hist) {
    N.log.push(m); if (N.log.length > 200) N.log.shift();
    const log = $('aocLog'); if (!log) { (N.early = N.early || []).push(m); return; }
    const ch = chKey(m);
    const row = document.createElement('div'); row.className = 'aocline ch-' + ch + (m.sys ? ' sys' : '') + (hist ? ' hist' : ''); row.dataset.ch = ch;
    const tag = m.sys ? 'Herald' : ch === 'pm' ? (m.echo ? 'To ' + m.to : 'From ' + m.from) : CH_NAMES[ch] || ch;
    const who = m.sys ? '' : (ch === 'pm' && m.echo) ? '' : `<button class="aocname" style="color:${KCOL[m.k] || '#f3e3b5'}" data-name="${esc(m.from)}" title="${esc(m.title || '')}">${esc(m.from)}</button>${m.rank ? `<i class="aocrank">${esc(m.rank)}</i>` : ''}: `;
    row.innerHTML = `<span class="aocts">${fmtT(m.ts || Date.now())}</span> <b class="aoctag">[${esc(tag)}]</b> ${who}<span class="aocbody"></span>${m.offline && m.echo ? ' <i class="aocrank">(delivered when they return)</i>' : ''}`;
    row.querySelector('.aocbody').textContent = m.body;
    const nb = row.querySelector('.aocname'); if (nb) nb.onclick = () => { setCh('pm'); $('aocTo').value = nb.dataset.name; $('aocMsg').focus(); };
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
    log.appendChild(row); while (log.children.length > 200) log.firstChild.remove();
    row.style.display = visibleIn(ch) ? '' : 'none';
    if (stick) log.scrollTop = log.scrollHeight;
    if (!hist && !N.chatOpen) { N.unread++; badge(); }
    if (!hist && ch === 'pm' && !m.echo) toast(`✉ ${m.from}: ${m.body.slice(0, 80)}`);
  }
  function visibleIn(ch) { return N.chatTab === 'all' || N.chatTab === ch || (ch === 'sys'); }
  function filterLog() { const log = $('aocLog'); for (const r of log.children) r.style.display = visibleIn(r.dataset.ch) ? '' : 'none'; log.scrollTop = log.scrollHeight; }

  // keys: Enter opens chat, full stop opens the Realm panel (captured before the game sees them)
  addEventListener('keydown', e => {
    if (!N.entered || !inGame()) return;
    const tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
    if (e.code === 'Enter' && !A().uiOpen()) { e.preventDefault(); e.stopPropagation(); if (!N.chatOpen) $('aocMin').click(); $('aocMsg').focus(); }
    else if (e.code === 'Slash' && !A().uiOpen()) { e.preventDefault(); e.stopPropagation(); if (!N.chatOpen) $('aocMin').click(); const m = $('aocMsg'); m.value = '/'; m.focus(); }
    else if (e.code === 'Period' && !A().uiOpen()) { e.preventDefault(); e.stopPropagation(); openRealm(); }
  }, true);
  addEventListener('pagehide', () => { try { if (N.entered && inGame()) A().save(true); } catch (e) {} });
  addEventListener('beforeunload', () => { try { if (N.entered && inGame()) A().save(true); } catch (e) {} });

  // ------------------------------------------------------------------ player menu, profile and trade
  function playerMenu(R) {
    const opts = [
      { label: 'Trade', primary: true, fn: () => { send({ t: 'tradeReq', nid: R.nid }); A().closePanel(); } },
      { label: 'Private message', fn: () => { A().closePanel(); setCh('pm'); $('aocTo').value = R.name; $('aocMsg').focus(); } },
      { label: 'Give gold', fn: () => giveGold(R) },
      { label: 'Wave', fn: () => { send({ t: 'emote', e: 'wave' }); A().closePanel(); } },
      { label: 'Bow', fn: () => { send({ t: 'emote', e: 'bow' }); A().closePanel(); } },
      { label: 'Salute', fn: () => { send({ t: 'emote', e: 'salute' }); A().closePanel(); } },
      { label: 'View their record', fn: () => send({ t: 'inspect', nid: R.nid }) },
    ];
    if (N.mil && N.mil.regiment && N.mil.role !== 'member' && R.army === N.mil.army) opts.push({ label: 'Invite to ' + N.mil.regiment.name, fn: () => { send({ t: 'regInvite', nid: R.nid }); A().closePanel(); } });
    if (N.mil && N.mil.regiment && N.mil.role === 'commander') { opts.push({ label: 'Make regiment officer', fn: () => { send({ t: 'regRole', nid: R.nid, role: 'officer' }); A().closePanel(); } }); opts.push({ label: 'Dismiss from regiment', fn: () => { send({ t: 'regRole', nid: R.nid, role: 'kick' }); A().closePanel(); } }); }
    const myK = N.you && N.you.kingdom;
    const marshal = N.offices.some(o => (o.office === 'marshal' || o.office === 'monarch') && o.k === R.army);
    if ((marshal || (N.you && N.you.admin)) && R.army >= 0) opts.push({ label: 'Set army rank', fn: () => promoteDialog(R) });
    if (N.offices.some(o => o.office === 'monarch' && o.k === myK) && R.k === myK) opts.push({ label: 'Appoint to office', fn: () => appointDialog(R) });
    A().openPanel(R.name, R.title || '', `<p class="aocsmall">${esc(A().K[R.k] ? 'Citizen of ' + A().K[R.k].name : '')}${R.army >= 0 ? ' · serves in the ' + esc(A().K[R.army].name) + ' Army' : ''}</p>`, opts);
  }
  function giveGold(R) {
    A().openPanel('Give gold', 'to ' + R.name, `<p>You have <b>${P().gold}</b> gold.</p><input id="aocGive" class="aocin" type="number" min="1" max="${P().gold}" value="10">`, [
      { label: 'Hand it over', primary: true, fn: () => { const v = Math.floor(+$('aocGive').value); if (v > 0) send({ t: 'give', nid: R.nid, gold: v }); A().closePanel(); } },
      { label: 'Back', fn: () => playerMenu(R) }]);
  }
  function promoteDialog(R) {
    const ranks = A().RANKS;
    const top = N.you && N.you.admin ? ranks.length - 1 : A().WARRANT_R;
    A().openPanel('Set army rank', R.name, `<select id="aocRank" class="aocin">${ranks.slice(0, top + 1).map((r, i) => `<option value="${i}">${esc(r.n)}</option>`).join('')}</select>${top < ranks.length - 1 ? '<p class="aocsmall">Ranks above Warrant Officer are appointed by admins.</p>' : ''}`, [
      { label: 'Confirm', primary: true, fn: () => { send({ t: 'armyPromote', nid: R.nid, rank: +$('aocRank').value }); A().closePanel(); } }, { label: 'Back', fn: () => playerMenu(R) }]);
  }
  function appointDialog(R) {
    const offs = (N.pol ? N.pol.offices : []).filter(o => o.office !== 'monarch');
    A().openPanel('Appoint to office', R.name, `<select id="aocOff" class="aocin">${offs.map(o => `<option value="${o.office}">${esc(o.title)}${o.holder ? ' (now ' + esc(o.holder) + ')' : ''}</option>`).join('')}</select>`, [
      { label: 'Appoint', primary: true, fn: () => { send({ t: 'appoint', nid: R.nid, office: $('aocOff').value }); A().closePanel(); } }, { label: 'Back', fn: () => playerMenu(R) }]);
  }
  function showProfile(p) {
    const mil = p.mil ? `${esc(p.mil.rankName)} of the ${esc(A().K[p.mil.army].name)} Army${p.mil.regiment ? ', ' + esc(p.mil.regiment.name) : ''}` : 'Not a soldier';
    A().openPanel(p.name, p.title, `<table class="aoctable"><tr><td>Kingdom</td><td>${esc(p.kingdom)}</td></tr><tr><td>Army</td><td>${mil}</td></tr><tr><td>Offices</td><td>${p.offices.length ? p.offices.map(esc).join('<br>') : 'None'}</td></tr><tr><td>Property</td><td>${p.props}</td></tr><tr><td>Medals</td><td>${p.medals}</td></tr><tr><td>In the realm since</td><td>${esc(new Date(p.since).toLocaleDateString())}</td></tr></table>`, []);
  }
  const label = k => String(k).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
  function offerHTML(o) {
    const parts = []; if (o.gold) parts.push(`${o.gold} gold`);
    for (const [k, n] of Object.entries(o.items || {})) parts.push(`${n > 1 ? n + ' × ' : ''}${esc(label(k))}`);
    for (const [k, n] of Object.entries(o.cargo || {})) parts.push(`${n} × ${esc(label(k))}`);
    return parts.length ? parts.join('<br>') : '<i>nothing yet</i>';
  }
  function renderTrade() {
    const T = N.trade; if (!T) return;
    const meA = T.a.nid === N.you.nid, me = meA ? T.a : T.b, them = meA ? T.b : T.a, p = P();
    const goods = [];
    for (const [k, v] of Object.entries(p.items || {})) if (v === true || (typeof v === 'number' && v > 0)) goods.push({ bag: 'items', k, have: v === true ? 1 : v, cur: me.offer.items[k] || 0 });
    for (const [k, v] of Object.entries(p.cargo || {})) if (v > 0) goods.push({ bag: 'cargo', k, have: v, cur: me.offer.cargo[k] || 0 });
    const tax = Math.round((meA ? T.tax[0] : T.tax[1]) * 100);
    const body = `<div class="aoctrade"><div><h4 class="cz">You offer ${me.ready ? '✔' : ''}</h4>
      <label>Gold (you have ${p.gold})<input id="aocTG" class="aocin" type="number" min="0" max="${p.gold}" value="${me.offer.gold}"></label>
      ${goods.map(g => `<label>${esc(label(g.k))} (have ${g.have})<input class="aocin aocTI" data-bag="${g.bag}" data-k="${esc(g.k)}" type="number" min="0" max="${g.have}" value="${g.cur}"></label>`).join('') || '<p class="aocsmall">No goods to offer.</p>'}
      <p class="aocsmall">Your kingdom takes ${tax}% of gold you pay as tax.</p></div>
      <div><h4 class="cz">${esc(them.name)} offers ${them.ready ? '✔' : ''}</h4><p>${offerHTML(them.offer)}</p></div></div>`;
    A().openPanel('Trade with ' + them.name, me.ready && them.ready ? 'Completing…' : (them.ready ? `${them.name} is ready` : 'Agree an exchange, then both press Ready'), body, [
      { label: 'Update my offer', fn: () => { const o = { t: 'tradeSet', gold: Math.floor(+$('aocTG').value || 0), items: {}, cargo: {} }; document.querySelectorAll('.aocTI').forEach(i => { const n = Math.floor(+i.value || 0); if (n > 0) o[i.dataset.bag][i.dataset.k] = n; }); send(o); } },
      { label: me.ready ? 'Not ready' : 'Ready', primary: true, fn: () => send({ t: 'tradeReady', ready: !me.ready }) },
      { label: 'Cancel trade', close: true, fn: () => { send({ t: 'tradeCancel' }); } }]);
  }

  // ------------------------------------------------------------------ the Realm panel
  function openRealm(tab) { if (tab) N.realmTab = tab; if (N.realmTab === 'admin' && !(N.you && N.you.admin)) N.realmTab = 'players'; N.realmOpen = true; renderRealm(); send({ t: 'pol' }); if (N.realmTab === 'admin') send({ t: 'adminList' }); }
  const TABS0 = [['players', 'Players'], ['kingdom', 'Kingdom'], ['parliament', 'Parliament'], ['army', 'Army'], ['events', 'Events'], ['property', 'Property'], ['account', 'Account']];
  const tabsNow = () => N.you && N.you.admin ? TABS0.concat([['admin', '⚑ Admin']]) : TABS0;
  function renderRealm() {
    if (!N.realmOpen) return;
    const tabs = `<div class="aocrtabs">${tabsNow().map(([k, n]) => `<button data-rt="${k}" class="${N.realmTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    const body = tabs + `<div class="aocrbody">${(RT[N.realmTab] || RT.players)()}</div>`;
    A().openPanel('The Realm', N.you ? `${N.you.name} · ${N.roster.length} online` : '', body, [{ label: 'Close', close: true, fn: () => { N.realmOpen = false; A().closePanel(); } }]);
    const pb = $('pbody'); if (!pb) return;
    pb.querySelectorAll('[data-rt]').forEach(b => b.onclick = () => { N.realmTab = b.dataset.rt; renderRealm(); if (N.realmTab === 'admin') send({ t: 'adminList' }); });
    pb.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset));
    if (N.realmTab === 'admin') wireAdmin(pb);
    pb.querySelectorAll('input,select,textarea').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    const panel = $('panel'); if (panel && !panel._aocWatch) { panel._aocWatch = true; new MutationObserver(() => { if (panel.classList.contains('hidden')) N.realmOpen = false; }).observe(panel, { attributes: true, attributeFilter: ['class'] }); }
  }
  const btn = (act, text, data = {}, cls = '') => `<button class="btn ${cls}" data-act="${act}" ${Object.entries(data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${text}</button>`;
  const RT = {
    players() {
      const p = P();
      const rows = N.roster.map(r => { const d = r.x == null ? null : Math.round(Math.hypot(r.x - p.pos.x, r.z - p.pos.z)); const me = N.you && r.nid === N.you.nid;
        return `<tr><td><b style="color:${KCOL[r.k]}">${esc(r.name)}</b>${me ? ' (you)' : ''}<br><i class="aocsmall">${esc(r.title)}</i></td><td>${r.x == null ? 'Getting ready' : esc(A().placeName ? A().placeName(r.x, r.z) : '')}<br><i class="aocsmall">${me || d == null ? '' : d + ' paces away'}</i></td><td>${me ? '' : btn('pm', 'Message', { name: r.name })}</td></tr>`; }).join('');
      return `<table class="aoctable">${rows || '<tr><td>No one else is here yet.</td></tr>'}</table>`;
    },
    kingdom() {
      const pol = N.pol; if (!pol) return '<p>Loading…</p>';
      const mine = new Set(N.offices.filter(o => o.k === pol.kingdom).map(o => o.office));
      const isMon = mine.has('monarch');
      const offs = pol.offices.map(o => `<tr><td>${esc(o.title)}</td><td>${o.holder ? esc(o.holder) : '<i>vacant</i>'}</td><td>${pol.elections.some(e => e.office === o.office) ? '<i class="aocsmall">election open</i>' : btn('elecCall', 'Call election', { office: o.office })}${mine.has(o.office) ? btn('resign', 'Resign', { office: o.office }) : ''}</td></tr>`).join('');
      const elec = pol.elections.map(e => { const voted = pol.myVotes && pol.myVotes.e.includes(e.id); const standing = e.cands.some(c => c.name === N.you.name);
        return `<div class="aoccard"><b>Election: ${esc(e.title)}</b> <span class="aocsmall">closes in ${left(e.closes)} · ${e.voters} voted</span>
        <table class="aoctable">${e.cands.map(c => `<tr><td>${esc(c.name)}</td><td>${c.votes} vote${c.votes === 1 ? '' : 's'}</td><td>${voted ? '' : btn('elecVote', 'Vote', { id: e.id, cand: c.id })}</td></tr>`).join('') || '<tr><td><i>No candidates yet.</i></td></tr>'}</table>
        ${standing ? '<i class="aocsmall">You are standing.</i>' : btn('elecStand', 'Stand as candidate', { id: e.id })}${voted ? ' <i class="aocsmall">You have voted.</i>' : ''}</div>`; }).join('');
      return `<p><b class="cz">${esc(pol.name)}</b> · Treasury <b>${pol.treasury}</b> gold · Trade tax ${Math.round(pol.tax * 100)}%</p>
        <table class="aoctable">${offs}</table>${elec}
        <p class="aocsmall">Any citizen can call an election for an office. Elections run for a few minutes; one vote per account, counted by the server.${isMon ? ' As Monarch you can appoint ministers from the player menu (press E beside a citizen).' : ''}</p>`;
    },
    parliament() {
      const pol = N.pol; if (!pol) return '<p>Loading…</p>';
      const member = N.offices.some(o => o.k === pol.kingdom);
      const ms = pol.motions.map(m => { const voted = pol.myVotes && pol.myVotes.m.includes(m.id);
        const what = m.kind === 'grant' ? ` (grant ${m.amount} gold to ${esc(m.target)})` : m.kind === 'tax' ? ` (set trade tax to ${Math.round(m.tax_rate * 100)}%)` : '';
        return `<div class="aoccard"><b>“${esc(m.title)}”</b>${what}<br><span class="aocsmall">Tabled by ${esc(m.proposer)} · Aye ${m.yes} · Nay ${m.no} · closes in ${left(m.closes)}</span><br>${member && !voted ? btn('vote', 'Aye', { id: m.id, yes: 1 }) + btn('vote', 'Nay', { id: m.id, yes: 0 }) : voted ? '<i class="aocsmall">You have voted.</i>' : ''}</div>`; }).join('');
      const form = member ? `<div class="aoccard"><b>Table a motion</b>
        <input id="aocMT" class="aocin" maxlength="140" placeholder="Title, e.g. Build a lighthouse at Saltmere">
        <select id="aocMK" class="aocin"><option value="decree">Decree (a statement of law)</option><option value="grant">Grant from the treasury</option><option value="tax">Change the trade tax</option></select>
        <input id="aocMA" class="aocin" type="number" min="1" placeholder="Grant amount (gold)"><input id="aocMG" class="aocin" maxlength="24" placeholder="Grant to (player name)"><input id="aocMR" class="aocin" type="number" min="0" max="20" placeholder="New tax %">
        ${btn('motion', 'Table motion')}</div>` : '<p class="aocsmall">Only office holders sit in Parliament. Win an election (Kingdom tab) to take a seat.</p>';
      return (ms || '<p><i>No motions are before Parliament.</i></p>') + form;
    },
    army() {
      const m = N.mil;
      if (!m) return '<p>You are not a soldier. Visit the marshal in any capital to enlist; your army membership and rank are then kept by the server, and army chat opens to you.</p>';
      const K = A().K;
      const reg = m.regiment ? `<p>Regiment: <b>${esc(m.regiment.name)}</b> (${esc(m.role)}), commander ${esc(m.regiment.commander)}</p>${btn('regLeave', 'Leave regiment')}`
        : (m.rank >= 4 ? `<div class="aoccard"><b>Raise a regiment</b> (200 gold)<input id="aocRN" class="aocin" maxlength="40" placeholder="e.g. The 3rd Frostguard Fusiliers">${btn('regCreate', 'Raise regiment')}</div>` : '<p class="aocsmall">Sergeants and above can raise their own regiment.</p>');
      return `<p><b>${esc(m.rankName)}</b> of the ${esc(K[m.army].name)} Army.</p>${reg}
        <p class="aocsmall">Regiments in your army: ${N.regiments.map(r => esc(r.name)).join(', ') || 'none yet'}.</p>
        <p class="aocsmall">Commanders and officers invite soldiers from the player menu (E beside them). The Marshal and Monarch can set any soldier's rank.</p>`;
    },
    events() {
      const p = P(); const evs = [...N.events.values()];
      return evs.length ? evs.map(e => `<div class="aoccard"><b>⚑ ${esc(e.title)}</b><br><span class="aocsmall">${Math.round(Math.hypot(e.x - p.pos.x, e.z - p.pos.z))} paces away · ends in ${left(e.ends)} · ${e.count} joined · reward ${e.reward} gold</span><br>${btn('eventJoin', 'Join', { id: e.id })}${btn('eventMap', 'Show on map', { id: e.id })}</div>`).join('')
        : '<p>No world events right now. The Herald announces fairs, tournaments, raids and musters every few minutes in global chat.</p>';
    },
    property() {
      const mine = [...N.props.values()].filter(x => x.mine);
      const tn = i => (A().TOWNS[i] ? A().TOWNS[i].name : '');
      return `<p>Each house and estate has one owner across the whole realm. Purchases are paid on the server, and the price goes to the kingdom's treasury.</p>
        <table class="aoctable">${mine.map(x => `<tr><td>${x.kind === 'house' ? 'House' : 'Estate'}</td><td>${esc(tn(x.town) || x.id)}</td></tr>`).join('') || '<tr><td><i>You own no property yet. Ask an innkeeper about houses for sale.</i></td></tr>'}</table>
        <p class="aocsmall">${N.props.size} properties are owned by players in the realm.</p>`;
    },
    admin() {
      if (!(N.you && N.you.admin)) return '<p>Only admins can see this.</p>';
      const L = N.adminList; if (!L) return '<p>Loading the realm’s players…</p>';
      const K = A().K, R = A().RANKS, f = N.adminF || { q: '', show: 'all', sort: 'online' }, p = P();
      const q = f.q.trim().toLowerCase();
      let rows = L.list.filter(r => (!q || r.name.toLowerCase().includes(q)) && (f.show === 'all' || (f.show === 'online') === r.online));
      const by = { online: (a, b) => (b.online - a.online) || (b.last - a.last), name: (a, b) => a.name.localeCompare(b.name), gold: (a, b) => b.gold - a.gold, kingdom: (a, b) => a.k - b.k || a.name.localeCompare(b.name) }[f.sort] || (() => 0);
      rows.sort(by);
      const on = L.list.filter(r => r.online).length;
      const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
      const where = r => r.inside ? 'Indoors' : r.x == null ? 'On the home screen' : esc(A().placeName ? A().placeName(r.x, r.z) : `${r.x}, ${r.z}`);
      const tr = rows.slice(0, 300).map(r => {
        const me = N.you && r.nid === N.you.nid, col = KCOL[r.k] || '#fff';
        const st = r.online ? (r.x == null ? '<span class="aocdot idle"></span>Online' : '<span class="aocdot on"></span>In the world') : `<span class="aocdot"></span>Last seen ${ago(r.last)}`;
        const d = r.online && r.x != null && !me ? ` · ${fmtN(Math.round(Math.hypot(r.x - p.pos.x, r.z - p.pos.z)))} paces` : '';
        const who = r.online ? `data-nid="${r.nid}"` : `data-uid="${esc(r.uid || '')}"`;
        const milSel = `<div class="aocmil"><select class="aocin aocsm" data-milk ${who} aria-label="Army of ${esc(r.name)}"><option value="-1" ${r.army < 0 ? 'selected' : ''}>No army</option>${K.map((x, i) => `<option value="${i}" ${r.army === i ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
          + `<select class="aocin aocsm" data-milr ${who} aria-label="Rank of ${esc(r.name)}" ${r.army < 0 ? 'disabled' : ''}>${R.map((x, i) => `<option value="${i}" ${r.rank === i ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select>`
          + `<select class="aocin aocsm" data-milc ${who} aria-label="Corps of ${esc(r.name)}" ${r.army < 0 ? 'disabled' : ''}>${Object.entries(CORPS_N).map(([id, n]) => `<option value="${id}" ${(r.corps || 'line') === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`;
        const acts = me ? '<i class="aocsmall">you</i>' : r.online ? `${r.x != null && !r.inside ? btn('admGo', 'Go to', { x: r.x, z: r.z, name: r.name }) : ''}${r.x != null ? btn('admBring', 'Bring here', { nid: r.nid, name: r.name }) : ''}${btn('pm', 'Message', { name: r.name })}${btn('admMute', r.muted ? 'Muted' : 'Mute 10 min', { name: r.name })}${btn('admKick', 'Kick', { name: r.name }, 'danger')}`
          : `${btn('admGo', 'Go to last place', { x: r.x, z: r.z, name: r.name })}${btn('pm', 'Message', { name: r.name })}`;
        return `<tr><td><b style="color:${col}">${esc(r.name)}</b><br><i class="aocsmall">${esc(K[r.k] ? K[r.k].name : '')}${r.army >= 0 && R[r.rank] ? ' · ' + esc(R[r.rank].n) : ''}</i></td><td>${st}<br><i class="aocsmall">${where(r)}${d}</i></td><td class="aocnum">${fmtN(r.gold)}<br><i class="aocsmall">gold</i></td><td class="aocacts">${acts}${milSel}</td></tr>`;
      }).join('');
      return `<div class="aocadm"><input id="aocAQ" class="aocin" placeholder="Search players by name" value="${esc(f.q)}" aria-label="Search players">
        <select id="aocAS" class="aocin" aria-label="Show"><option value="all">Everyone (${L.list.length})</option><option value="online">Online (${on})</option><option value="offline">Offline (${L.list.length - on})</option></select>
        <select id="aocAO" class="aocin" aria-label="Sort by"><option value="online">Online first, then recent</option><option value="name">Name</option><option value="gold">Gold</option><option value="kingdom">Kingdom</option></select>
        <button class="btn" id="aocAR">Refresh</button></div>
        <p class="aocsmall">${on} online · ${L.list.length} characters in the realm${L.capped ? ' (showing the 500 most recently seen)' : ''}${rows.length > 300 ? ' · showing the first 300 matches' : ''} · updated ${esc(fmtT(N.adminAt))}. Online players also show on your map (M). “Go to” teleports you there; “Bring here” teleports them to you.</p>
        <div class="aoctablewrap"><table class="aoctable aocadmt">${tr || '<tr><td><i>No players match.</i></td></tr>'}</table></div>`;
    },
    account() {
      const K = A().K, k = N.you ? N.you.kingdom : 0;
      return `<p>Signed in as <b>${esc(N.session && N.session.user ? N.session.user.email : '')}</b></p><p>Character: <b>${esc(N.you ? N.you.name : '')}</b>, citizen of ${esc(K[k].name)}</p>
        <div class="aoccard"><b>Change kingdom</b> (once a day; you give up any office)<select id="aocKS" class="aocin">${K.map((x, i) => `<option value="${i}" ${i === k ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${btn('kingdom', 'Swear allegiance')}</div>
        ${btn('logout', 'Save and log out', {}, 'primary')}
        <p class="aocsmall">Chat: Enter to type, / for commands (/w Name message, /g, /l, /k, /a, /online). Your progress is saved to your account automatically.</p>`;
    },
  };
  function act(a, d) {
    const v = id => { const el = $(id); return el ? el.value : ''; };
    if (a === 'pm') { A().closePanel(); N.realmOpen = false; setCh('pm'); $('aocTo').value = d.name; $('aocMsg').focus(); }
    else if (a === 'elecCall') send({ t: 'elecCall', office: d.office });
    else if (a === 'elecStand') send({ t: 'elecStand', id: +d.id });
    else if (a === 'elecVote') send({ t: 'elecVote', id: +d.id, cand: d.cand });
    else if (a === 'resign') send({ t: 'resign', office: d.office });
    else if (a === 'vote') send({ t: 'motionVote', id: +d.id, yes: d.yes === '1' });
    else if (a === 'motion') send({ t: 'motion', title: v('aocMT'), kind: v('aocMK'), amount: +v('aocMA') || 0, target: v('aocMG'), rate: +v('aocMR') || 0 });
    else if (a === 'regCreate') send({ t: 'regCreate', name: v('aocRN') });
    else if (a === 'regLeave') send({ t: 'regLeave' });
    else if (a === 'eventJoin') send({ t: 'eventJoin', id: +d.id });
    else if (a === 'eventMap') { const e = N.events.get(+d.id); A().closePanel(); N.realmOpen = false; if (e && A().openMap) A().openMap(); toast(e ? `${e.title}: look for the gold star on your map.` : ''); }
    else if (a === 'kingdom') send({ t: 'changeKingdom', k: +v('aocKS') });
    else if (a === 'logout') logout();
    else if (a === 'admGo') { if (d.x === '' || d.x == null || d.x === 'null') return toast('Their position is not known yet.'); A().closePanel(); N.realmOpen = false; A().adminWarp(+d.x + 3, +d.z + 3); toast(`You arrive near ${d.name}.`, 'gold'); }
    else if (a === 'admBring') send({ t: 'adminSummon', nid: +d.nid });
    else if (a === 'admMute') { send({ t: 'chat', ch: 'global', body: '/mute ' + d.name + ' 10' }); setTimeout(() => send({ t: 'adminList' }), 400); }
    else if (a === 'admKick') { const b = document.querySelector(`[data-act="admKick"][data-name="${CSS.escape(d.name)}"]`); if (b && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Really kick?'; return; } send({ t: 'chat', ch: 'global', body: '/kick ' + d.name }); setTimeout(() => send({ t: 'adminList' }), 600); }
  }
  function wireAdmin(pb) {
    const f = N.adminF = N.adminF || { q: '', show: 'all', sort: 'online' };
    const qi = $('aocAQ'), si = $('aocAS'), oi = $('aocAO'); if (!qi) return;
    si.value = f.show; oi.value = f.sort;
    qi.oninput = () => { f.q = qi.value; const pos = qi.selectionStart; renderRealm(); const n = $('aocAQ'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    si.onchange = () => { f.show = si.value; renderRealm(); };
    oi.onchange = () => { f.sort = oi.value; renderRealm(); };
    $('aocAR').onclick = () => send({ t: 'adminList' });
    // army, rank and corps: the server checks the admin and applies it, online or offline
    pb.querySelectorAll('[data-milk],[data-milr],[data-milc]').forEach(sel => sel.onchange = () => {
      const m = { t: 'adminSetMil' }; if (sel.dataset.nid) m.nid = +sel.dataset.nid; else m.uid = sel.dataset.uid;
      if (sel.hasAttribute('data-milk')) m.army = +sel.value; else if (sel.hasAttribute('data-milr')) m.rank = +sel.value; else m.corps = sel.value;
      send(m); toast('Saving…');
    });
  }
  const fmtN = n => Number(n || 0).toLocaleString('en');
  const CORPS_N = { line: 'Line Infantry', storm: 'Storm Troopers', ironmask: 'Ironmask Corps', heavy: 'Heavy Infantry', officer: 'Officer Corps' };

  // ------------------------------------------------------------------ home screen
  const NEWS = [
    ['Battle passes and seasons', 'Each real-world season brings its own story, a battle pass with chests, and holiday hunts.'],
    ['Enter sends chat', 'Press Enter to open chat, type, and press Enter again to send and get back to the world.'],
    ['Faster map travel', 'W A S D pan the map. Admins click to teleport and can move straight away afterwards.'],
  ];
  function showHome() {
    if (N.entered) return;
    const box = $('aocAuth'); if (box) box.remove();
    const t = $('title'); if (t) t.classList.add('hidden');
    document.body.classList.add('aoc-home');
    let h = $('aocHome');
    if (!h) { h = document.createElement('div'); h.id = 'aocHome'; h.setAttribute('role', 'main'); document.body.appendChild(h); }
    renderHome();
    clearInterval(N.homeT); N.homeT = setInterval(() => { if ($('aocHome')) renderHome(); else clearInterval(N.homeT); }, 2000);
    setTimeout(() => { const b = $('aocPlay'); if (b) b.focus(); }, 50);
  }
  function renderHome() {
    const h = $('aocHome'), m = N.homeWorld; if (!h || !m) return;
    const K = A().K, R = A().RANKS, you = m.you, k = you.kingdom, col = KCOL[k] || '#f3e3b5';
    const gold = N.wal && typeof N.wal.gold === 'number' ? N.wal.gold : m.save.gold;
    const mil = N.mil ? `${esc(N.mil.rankName || (R[N.mil.rank] ? R[N.mil.rank].n : ''))}, ${esc(K[N.mil.army].name)} Army` : 'Not in an army';
    const offs = (N.offices || []).map(o => esc(o.title || o.office)).join(', ');
    const myProps = [...N.props.values()].filter(x => x.mine).length;
    const evs = [...N.events.values()];
    const sea = window.AOC_SEASONS && window.AOC_SEASONS.homeCard ? window.AOC_SEASONS.homeCard() : '';
    const pm = (m.pms || []).length;
    const pol = N.pol;
    h.innerHTML = `<div class="aochome">
      <div class="aochl">
        <h1 class="logo">Age of Crowns<small>Realm of the Four Crowns</small></h1>
        <div class="aocchar" style="--kc:${col}">
          <div class="aocchark">${esc(K[k] ? K[k].name : '')}</div>
          <div class="aoccharn">${esc(you.name)}</div>
          <div class="aocchart">${esc(you.title || '')}</div>
          <div class="aocstats"><span><b>${fmtN(gold)}</b>gold</span><span><b>${myProps}</b>${myProps === 1 ? 'property' : 'properties'}</span><span><b>${N.roster.length}</b>online now</span></div>
          <div class="aocsmall">${mil}${offs ? ' · ' + offs : ''}</div>
        </div>
        <div class="aochbtns"><button class="big" id="aocPlay">Enter the realm</button><button class="big alt" id="aocHomeOut">Sign out</button></div>
        <p class="aocsmall aochkeys">Enter chat · . Realm panel${window.AOC_SEASONS ? ' · Tab Season panel' : ''} · M map · J journal</p>
      </div>
      <div class="aochr">
        ${sea}
        ${pm ? `<div class="aochcard gold"><b>✉ ${pm} private message${pm === 1 ? '' : 's'}</b> waiting from while you were away.</div>` : ''}
        <div class="aochcard"><h3>The realm now</h3>
          ${evs.length ? evs.map(e => `<div>⚑ <b>${esc(e.title)}</b> · ends in ${left(e.ends)} · ${e.count} joined</div>`).join('') : '<div class="aocsmall">No live world event right now. The Herald announces them in chat.</div>'}
          ${pol ? `<div class="aocsmall">${esc(pol.name)}: treasury ${fmtN(pol.treasury)} gold · trade tax ${Math.round(pol.tax * 100)}%${pol.elections && pol.elections.length ? ` · ${pol.elections.length} election${pol.elections.length === 1 ? '' : 's'} open` : ''}</div>` : ''}
          <div class="aochonline">${N.roster.slice(0, 18).filter(r => r.nid !== you.nid).map(r => `<span style="color:${KCOL[r.k] || '#fff'}">${esc(r.name)}</span>`).join('') || '<span class="aocsmall">You are the first one here.</span>'}</div>
        </div>
        <div class="aochcard"><h3>What's new</h3>${NEWS.map(([a, b]) => `<div><b>${esc(a)}</b> <span class="aocsmall">${esc(b)}</span></div>`).join('')}</div>
      </div></div>`;
    $('aocPlay').onclick = playFromHome;
    $('aocHomeOut').onclick = logout;
  }
  function playFromHome() {
    const m = N.homeWorld; if (!m || N.entered) return;
    clearInterval(N.homeT);
    const h = $('aocHome'); if (h) { h.classList.add('leaving'); setTimeout(() => h.remove(), 400); }
    document.body.classList.remove('aoc-home');
    N.homeWorld = null;
    try { if (A().initAudio) A().initAudio(); } catch (e) {}
    enterNow(m);
  }
  addEventListener('keydown', e => { if ($('aocHome') && !N.entered && e.key === 'Enter' && document.activeElement && document.activeElement.id !== 'aocHomeOut') { e.preventDefault(); playFromHome(); } });

  // ------------------------------------------------------------------ start
  function start() {
    if (!window.supabase || !window.supabase.createClient) { const box = authBox(); if (box) { box.innerHTML = '<div class="aocmsg bad">Could not load the Supabase library. Check your internet connection, or play offline.</div>'; } return; }
    N.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'aoc-auth' } });
    N.sb.auth.onAuthStateChange((ev, session) => { N.session = session; });
    connect();
  }
  // console / debugging handle: AOC_NET.state, AOC_NET.say('global','hi')
  window.AOC_NET = { get state() { return N; }, connect, play: playFromHome, say: (ch, body, to) => send({ t: 'chat', ch, body, to }), send };
  const wait = setInterval(() => { if (window.AOC && window.AOC.state && window.AOC.state !== 'loading' && $('title')) { clearInterval(wait); start(); } }, 200);
})();
