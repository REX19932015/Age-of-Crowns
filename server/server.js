'use strict';
/*
  AGE OF CROWNS — multiplayer server
  ----------------------------------
  • Checks each player's Supabase login, loads and saves their character.
  • Relays movement so players see each other in the 3D world (area-of-interest, 10 updates/s).
  • Runs chat: global, local, private, kingdom and army channels, with permissions and spam limits.
  • Owns everything that must not be trusted to a browser: gold and items moving between
    players, trades, property, army ranks granted by officers, offices, elections, parliament
    votes, kingdom treasuries and world-event rewards.
  Run: node server.js   (Node 18 or newer, no packages to install)
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./lib/ws');
const { Supa } = require('./lib/supabase');

// ---------------------------------------------------------------- config
(function loadDotEnv() {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
})();
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CFG = {
  PORT: +env('PORT', 8080),
  SUPABASE_URL: env('SUPABASE_URL', ''),
  SUPABASE_SECRET_KEY: env('SUPABASE_SECRET_KEY', env('SUPABASE_SERVICE_ROLE_KEY', '')),
  ALLOWED_ORIGINS: env('ALLOWED_ORIGINS', '*').split(',').map(s => s.trim()).filter(Boolean),
  EARN_PER_MIN: +env('EARN_PER_MIN', 1500),       // most gold a player can earn from solo play per minute
  EARN_BURST: +env('EARN_BURST', 20000),          // ...and the most they can bank up for one big payout
  ELECTION_MIN: +env('ELECTION_MINUTES', 10),
  MOTION_MIN: +env('MOTION_MINUTES', 10),
  EVENT_EVERY_MIN: +env('EVENT_EVERY_MINUTES', 12),
  EVENT_LEN_MIN: +env('EVENT_LENGTH_MINUTES', 6),
  EVENT_STAY_S: +env('EVENT_STAY_SECONDS', 60),     // how long a player must stay at an event to be rewarded
  VIEW: +env('VIEW_DISTANCE', 700),
  LOCAL_CHAT: +env('LOCAL_CHAT_DISTANCE', 60),
};
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_SECRET_KEY) {
  console.error('\n[Age of Crowns] Missing SUPABASE_URL or SUPABASE_SECRET_KEY.\nCopy server/.env.example to server/.env and fill them in (see README.md).\n');
  process.exit(1);
}
const db = new Supa(CFG.SUPABASE_URL, CFG.SUPABASE_SECRET_KEY);
const W = require('./data/world.json');
const HOUSES = new Map(W.houses.map(h => [h.id, h]));
const TOWNS = W.towns;
const KNAMES = W.kingdoms.map(k => k.name);
const OFFICES = ['monarch', 'chancellor', 'treasurer', 'marshal', 'speaker', 'seat1', 'seat2', 'seat3'];
const OFFICE_NAMES = { monarch: 'Monarch', chancellor: 'Chancellor', treasurer: 'Treasurer', marshal: 'Marshal', speaker: 'Speaker of Parliament', seat1: 'Member of Parliament', seat2: 'Member of Parliament', seat3: 'Member of Parliament' };
const RANKS = W.ranks;
// Ranks up to Warrant Officer are earned in the field; every rank above it is granted by an admin.
const WARRANT = RANKS.indexOf('Warrant Officer'), MAX_RANK = RANKS.length - 1;
// Specialised corps. Only admins assign them, except that a line Warrant Officer may volunteer for the Storm Troopers.
const CORPS = { line: 'Line Infantry', storm: 'Storm Troopers', ironmask: 'Ironmask Corps', heavy: 'Heavy Infantry', officer: 'Officer Corps' };
const CORPS_HAT = { line: 'stahlhelm', storm: 'stahlhelm', ironmask: 'ironmask', heavy: 'heavyhelm', officer: 'pickelhaube' };
const CORPS_HATS = new Set(Object.values(CORPS_HAT));
const corpsOf = S => (S.mil && CORPS[S.mil.corps]) ? S.mil.corps : null;
// a look may only show corps gear the server has actually granted
function lockLook(S, look) {
  const l = { ...(look || {}) }, c = corpsOf(S);
  if (l.corps !== undefined && l.corps !== c) delete l.corps;
  if (CORPS_HATS.has(l.hat) && (!c || CORPS_HAT[c] !== l.hat)) delete l.hat;
  return l;
}
const ESTATE_PRICE = 2500, ESTATES_PER_TOWN = 4, REGIMENT_PRICE = 200, MAX_HOUSES = 10;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const now = () => Date.now();
let SEA = null;   // seasons, battle pass and story (server/season.js); set up after the helpers below
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
const str = (v, max) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const fin = v => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------- shared state
const online = new Map();      // userId -> session
const byNid = new Map();       // short numeric id -> session
const names = new Map();       // userId -> character name (cache, offline players too)
let nidSeq = 1;
const kingdoms = [0, 1, 2, 3].map(i => ({ id: i, name: KNAMES[i], treasury: 0, tax_rate: 0.05 }));
const offices = [0, 1, 2, 3].map(() => ({}));            // offices[k][office] = userId|null
const elections = new Map();   // id -> {id,kingdom,office,closes,cands:Map(uid->votes),voters:Set}
const lastElection = new Map(); // 'k:office' -> time of last call
const motions = new Map();     // id -> {id,kingdom,title,kind,amount,target,tax_rate,proposer,closes,yes:Set,no:Set}
const regiments = new Map();   // id -> {id,kingdom,name,commander}
const properties = new Map();  // id -> {id,kind,town,kingdom,owner,price}
const events = new Map();      // id -> live event
const history = new Map();     // channel -> recent messages
const tradeAsks = new Map();   // targetUid -> {from, until}
const regInvites = new Map();  // targetUid -> {regiment, from, until}
const leaving = new Map();     // userId -> promise of their last session finishing its save

const send = (S, msg) => { if (S && S.ws.open) S.ws.send(JSON.stringify(msg)); };
const err = (S, msg) => send(S, { t: 'err', msg });
const toast = (S, msg, cls) => send(S, { t: 'toast', msg, cls });
const each = fn => { for (const S of online.values()) if (S.ready) fn(S); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const nameOf = uid => names.get(uid) || 'someone';
const officesOf = uid => { const o = []; offices.forEach((m, k) => { for (const [off, h] of Object.entries(m)) if (h === uid) o.push({ k, office: off }); }); return o; };
function titleOf(S) {
  const st = SEA && SEA.title(S); if (st) return st;
  const o = officesOf(S.id);
  const mon = o.find(x => x.office === 'monarch');
  if (mon) return (S.char.look && S.char.look.queen ? 'Queen' : 'Monarch') + ' of ' + KNAMES[mon.k];
  if (o.length) return OFFICE_NAMES[o[0].office] + ', ' + KNAMES[o[0].k];
  if (S.mil) return RANKS[S.mil.rank] + ', ' + KNAMES[S.mil.army] + ' Army';
  return 'Citizen of ' + KNAMES[S.char.kingdom];
}
function pushHistory(ch, m, cap = 50) { let a = history.get(ch); if (!a) history.set(ch, a = []); a.push(m); if (a.length > cap) a.shift(); }
function system(ch, body, filter) {
  const m = { t: 'chat', ch, from: 'Herald', sys: true, body, ts: now() };
  if (ch === 'global') pushHistory('global', m);
  each(S => { if (!filter || filter(S)) send(S, m); });
}
const q = p => p.catch(e => log('db error:', e.message));   // fire-and-forget DB write with logging

// ---------------------------------------------------------------- startup: load the realm from Supabase
async function loadRealm() {
  for (const k of await db.select('kingdoms')) Object.assign(kingdoms[k.id], { treasury: +k.treasury, tax_rate: +k.tax_rate });
  const offs = await db.select('offices');
  for (const o of offs) offices[o.kingdom][o.office] = o.holder;
  const ids = [...new Set(offs.map(o => o.holder).filter(Boolean))];
  if (ids.length) for (const c of await db.select('characters', { columns: 'user_id,name', where: { user_id: ids } })) names.set(c.user_id, c.name);
  for (const e of await db.select('elections', { where: { status: 'open' } })) {
    const E = { id: +e.id, kingdom: e.kingdom, office: e.office, closes: Date.parse(e.closes_at), cands: new Map(), voters: new Set() };
    for (const c of await db.select('election_candidates', { where: { election_id: E.id } })) E.cands.set(c.user_id, 0);
    for (const v of await db.select('election_votes', { where: { election_id: E.id } })) { E.voters.add(v.voter_id); E.cands.set(v.candidate_id, (E.cands.get(v.candidate_id) || 0) + 1); }
    elections.set(E.id, E);
  }
  for (const m of await db.select('motions', { where: { status: 'open' } })) {
    const M = { id: +m.id, kingdom: m.kingdom, title: m.title, kind: m.kind, amount: m.amount && +m.amount, target: m.target, tax_rate: m.tax_rate && +m.tax_rate, proposer: m.proposer, closes: Date.parse(m.closes_at), yes: new Set(), no: new Set() };
    for (const v of await db.select('motion_votes', { where: { motion_id: M.id } })) (v.yes ? M.yes : M.no).add(v.voter_id);
    motions.set(M.id, M);
  }
  for (const r of await db.select('regiments')) regiments.set(+r.id, { id: +r.id, kingdom: r.kingdom, name: r.name, commander: r.commander });
  for (const p of await db.select('properties')) properties.set(p.id, { id: p.id, kind: p.kind, town: p.town, kingdom: p.kingdom, owner: p.owner, price: +p.price });
  const pids = [...new Set([...properties.values()].map(p => p.owner))].filter(id => !names.has(id));
  for (let i = 0; i < pids.length; i += 100) for (const c of await db.select('characters', { columns: 'user_id,name', where: { user_id: pids.slice(i, i + 100) } })) names.set(c.user_id, c.name);
  await db.update('world_events', { status: 'live' }, { status: 'done' });
  for (const ch of ['global', 'kingdom:0', 'kingdom:1', 'kingdom:2', 'kingdom:3', 'army:0', 'army:1', 'army:2', 'army:3']) {
    const rows = await db.select('chat_messages', { where: { channel: ch }, order: 'created_at.desc', limit: 40 });
    for (const r of rows.reverse()) pushHistory(ch, { t: 'chat', ch: ch.split(':')[0], from: r.sender_name, body: r.body, ts: Date.parse(r.created_at), hist: true });
  }
  log(`realm loaded: ${regiments.size} regiments, ${properties.size} properties, ${elections.size} open elections, ${motions.size} open motions`);
}

// ---------------------------------------------------------------- wallet (gold, items, cargo) — the server is the authority
function earnBudget(S) {
  const t = now(); S.earn.budget = Math.min(CFG.EARN_BURST, S.earn.budget + (t - S.earn.t) / 60000 * CFG.EARN_PER_MIN); S.earn.t = t; return S.earn.budget;
}
function walletMsg(c) { return { t: 'wallet', gold: c.gold, wseq: c.wallet_seq, items: c.items, cargo: c.cargo }; }
/** Change a player's gold on the server (online or offline). Returns false if they cannot afford it. */
async function changeGold(uid, delta, reason, ref) {
  delta = Math.trunc(delta);
  const S = online.get(uid);
  if (S) {
    if (S.char.gold + delta < 0) return false;
    S.char.gold += delta; S.char.wallet_seq++; S.dirty = true;
    send(S, walletMsg(S.char));
    flush(S);
  } else {
    const c = await db.one('characters', { columns: 'gold,wallet_seq', where: { user_id: uid } });
    if (!c || +c.gold + delta < 0) return false;
    await db.update('characters', { user_id: uid }, { gold: +c.gold + delta, wallet_seq: c.wallet_seq + 1 });
  }
  q(db.insert('ledger', { user_id: uid, delta, reason, ref: ref || null }, { returning: false }));
  return true;
}
async function changeTreasury(k, delta) {
  if (!(k >= 0 && k <= 3)) return;
  kingdoms[k].treasury = Math.max(0, kingdoms[k].treasury + Math.trunc(delta));
  await q(db.update('kingdoms', { id: k }, { treasury: kingdoms[k].treasury, updated_at: new Date().toISOString() }));
}
function cleanBag(o, maxKeys = 200) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(o)) {
    if (++n > maxKeys) break;
    const key = str(k, 40); if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof v === 'boolean') out[key] = v;
    else if (fin(v)) out[key] = Math.max(0, Math.min(1e6, Math.floor(v)));
    else if (typeof v === 'string') out[key] = str(v, 40);
  }
  return out;
}
const LOOK_KEYS = ['fur', 'coat', 'trim', 'pants', 'hat', 'hatCol', 'size', 'civvies', 'dress', 'royal', 'epaulettes', 'apron', 'crossbelt', 'cape', 'ruler', 'sash', 'cuirass', 'officer', 'musket', 'gun', 'queen', 'corps', 'scarf', 'bag', 'glasses', 'feather', 'earring'];
function cleanLook(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const k of LOOK_KEYS) { const v = o[k]; if (typeof v === 'boolean') out[k] = v; else if (fin(v)) out[k] = Math.max(.5, Math.min(1.6, v)); else if (typeof v === 'string') out[k] = str(v, 24); }
  return out;
}

// ---------------------------------------------------------------- saving characters
function overlayServerFields(c) {
  // the save the browser receives always carries the server's own gold, items, cargo, name and kingdom
  const s = c.save && typeof c.save === 'object' ? { ...c.save } : {};
  s.name = c.name; s.home = c.kingdom; s.gold = c.gold; s.items = c.items; s.cargo = c.cargo; s.look = { ...(s.look || {}), ...c.look };
  s.army = c.army; s.rank = c.army_rank;
  return s;
}
async function applySave(S, blob, wseq, force) {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return;
  const c = S.char;
  const stale = wseq !== c.wallet_seq;
  let resync = stale;
  if (!stale) {
    const g = clampInt(blob.gold, 0, 1e12);
    if (g <= c.gold) c.gold = g;
    else {
      const allowed = S.admin ? Infinity : earnBudget(S);
      const want = g - c.gold, inc = Math.floor(Math.min(want, allowed));
      if (!S.admin) S.earn.budget -= inc;
      c.gold += inc;
      if (SEA && inc > 0) SEA.metric(S, 'gold', inc);
      if (inc < want) { resync = true; c.wallet_seq++; }
    }
    c.items = cleanBag(blob.items); c.cargo = cleanBag(blob.cargo);
  }
  if (fin(blob.x) && fin(blob.z)) { c.pos_x = blob.x; c.pos_z = blob.z; }
  c.look = lockLook(S, cleanLook(blob.look || c.look));
  // army: joining and leaving happens in the game; ranks above what an army officer granted climb at most one step every 90 s
  const army = clampInt(blob.army, -1, 3);
  if (army !== (S.mil ? S.mil.army : -1)) await setArmy(S, army);
  if (S.mil) {
    const want = clampInt(blob.rank, 0, MAX_RANK);
    // the game may only lower a rank, or raise it one step at a time up to Warrant Officer; officer ranks come from admins
    if (want < S.mil.rank && want < WARRANT && S.mil.rank <= WARRANT) { S.mil.rank = want; q(db.update('military_members', { user_id: S.id }, { rank: want })); }
    else if (want > S.mil.rank) {
      if (S.mil.rank >= WARRANT) send(S, { t: 'rankSet', rank: S.mil.rank, note: 'Ranks above Warrant Officer are granted by the realm’s admins.' });
      else {
        if (now() - (S.mil.lastUp || 0) > 90000) { S.mil.rank++; S.mil.lastUp = now(); q(db.update('military_members', { user_id: S.id }, { rank: S.mil.rank })); }
        if (S.mil.rank < want) send(S, { t: 'rankSet', rank: S.mil.rank, note: S.mil.rank >= WARRANT ? 'Ranks above Warrant Officer are granted by the realm’s admins.' : 'Promotions are confirmed by the army one rank at a time.' });
      }
    } else if (want < S.mil.rank) send(S, { t: 'rankSet', rank: S.mil.rank, note: '' });
    c.army = S.mil.army; c.army_rank = S.mil.rank;
  } else { c.army = -1; c.army_rank = 0; }
  c.gov_rank = clampInt(blob.govc && blob.govc.rank, 0, 20);
  c.achievements = { medals: Array.isArray(blob.medals) ? blob.medals.slice(0, 100) : [], wonders: blob.wonders || null, stars: Array.isArray(blob.stars) ? blob.stars.length : 0, kills: clampInt(blob.kills, 0, 1e7), visited: Array.isArray(blob.visited) ? blob.visited.length : 0 };
  const s = { ...blob };
  delete s.admin; delete s.god;   // server admin rights live in the profiles table, not in a save
  c.save = s;
  S.dirty = true;
  if (resync) send(S, walletMsg(c));
  if (force) await flush(S); else if (now() - S.lastFlush > 10000) flush(S);
}
async function flush(S) {
  if (!S.dirty || !S.char) return;
  S.dirty = false; S.lastFlush = now();
  const c = S.char;
  const save = overlayServerFields(c);
  if (fin(S.x) && !S.inside) { save.x = S.x; save.z = S.z; c.pos_x = S.x; c.pos_z = S.z; }
  await q(db.update('characters', { user_id: S.id }, {
    gold: c.gold, wallet_seq: c.wallet_seq, items: c.items, cargo: c.cargo, look: c.look, army: c.army, army_rank: c.army_rank, gov_rank: c.gov_rank,
    pos_x: c.pos_x, pos_z: c.pos_z, achievements: c.achievements, save, updated_at: new Date().toISOString(), last_seen: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------- military
async function setArmy(S, army) {
  if (army < 0) {
    if (S.mil) { await leaveRegiment(S, true); await q(db.remove('military_members', { user_id: S.id })); S.mil = null; announcePlayer(S); }
    return;
  }
  if (S.mil) await leaveRegiment(S, true);
  S.mil = { army, rank: 0, regiment_id: null, role: 'member', corps: 'line', lastUp: now() };
  await q(db.insert('military_members', { user_id: S.id, army, rank: 0, regiment_id: null, regiment_role: 'member', corps: 'line' }, { upsert: true, onConflict: 'user_id', returning: false }));
  send(S, { t: 'mil', mil: milInfo(S) });
  announcePlayer(S);
}
function milInfo(S) {
  if (!S.mil) return null;
  const r = S.mil.regiment_id ? regiments.get(S.mil.regiment_id) : null;
  return { army: S.mil.army, rank: S.mil.rank, rankName: RANKS[S.mil.rank], corps: corpsOf(S) || 'line', corpsName: CORPS[corpsOf(S) || 'line'], warrant: WARRANT, regiment: r ? { id: r.id, name: r.name, commander: nameOf(r.commander) } : null, role: S.mil.role };
}
async function leaveRegiment(S, quiet) {
  if (!S.mil || !S.mil.regiment_id) return;
  const R = regiments.get(S.mil.regiment_id);
  S.mil.regiment_id = null; const wasCmd = S.mil.role === 'commander'; S.mil.role = 'member';
  await q(db.update('military_members', { user_id: S.id }, { regiment_id: null, regiment_role: 'member' }));
  if (R && wasCmd) {
    const rest = await db.select('military_members', { where: { regiment_id: R.id }, order: 'joined_at.asc' }).catch(() => []);
    if (!rest.length) { regiments.delete(R.id); await q(db.remove('regiments', { id: R.id })); }
    else {
      const heir = rest.find(m => m.regiment_role === 'officer') || rest[0];
      R.commander = heir.user_id;
      await q(db.update('regiments', { id: R.id }, { commander: heir.user_id }));
      await q(db.update('military_members', { user_id: heir.user_id }, { regiment_role: 'commander' }));
      const H = online.get(heir.user_id); if (H && H.mil) { H.mil.role = 'commander'; send(H, { t: 'mil', mil: milInfo(H) }); toast(H, `You now command ${R.name}.`, 'gold'); }
    }
  }
  if (!quiet) toast(S, 'You leave the regiment.');
  send(S, { t: 'mil', mil: milInfo(S) });
}

// ---------------------------------------------------------------- politics
const isMember = (S, k) => S.char.kingdom === k;
const holdsOffice = (uid, k) => Object.values(offices[k]).includes(uid);
function polState(k) {
  return {
    kingdom: k, name: KNAMES[k], treasury: kingdoms[k].treasury, tax: kingdoms[k].tax_rate,
    offices: OFFICES.map(o => ({ office: o, title: OFFICE_NAMES[o], holder: offices[k][o] ? nameOf(offices[k][o]) : null, holderId: offices[k][o] || null })),
    elections: [...elections.values()].filter(e => e.kingdom === k).map(e => ({ id: e.id, office: e.office, title: OFFICE_NAMES[e.office], closes: e.closes, cands: [...e.cands.entries()].map(([id, v]) => ({ id, name: nameOf(id), votes: v })), voters: e.voters.size })),
    motions: [...motions.values()].filter(m => m.kingdom === k).map(m => ({ id: m.id, title: m.title, kind: m.kind, amount: m.amount, target: m.target ? nameOf(m.target) : null, tax_rate: m.tax_rate, proposer: nameOf(m.proposer), closes: m.closes, yes: m.yes.size, no: m.no.size })),
  };
}
function pushPol(k) { each(S => { if (S.char.kingdom === k) { const p = polState(k); p.myVotes = myVotes(S, k); send(S, { t: 'pol', pol: p }); } }); }
function myVotes(S, k) {
  const e = [...elections.values()].filter(x => x.kingdom === k && x.voters.has(S.id)).map(x => x.id);
  const m = [...motions.values()].filter(x => x.kingdom === k && (x.yes.has(S.id) || x.no.has(S.id))).map(x => x.id);
  return { e, m };
}
async function setOffice(k, office, uid) {
  if (uid) for (const o of OFFICES) if (offices[k][o] === uid && o !== office) { offices[k][o] = null; await q(db.update('offices', { kingdom: k, office: o }, { holder: null, since: new Date().toISOString() })); }
  const prev = offices[k][office];
  offices[k][office] = uid || null;
  await q(db.update('offices', { kingdom: k, office }, { holder: uid || null, since: new Date().toISOString() }));
  for (const id of [prev, uid]) { const S = id && online.get(id); if (S) { sendOffices(S); announcePlayer(S); } }
  pushPol(k);
}
function sendOffices(S) { send(S, { t: 'offices', mine: officesOf(S.id).map(o => ({ ...o, title: OFFICE_NAMES[o.office] })) }); }
async function closeElection(E) {
  elections.delete(E.id);
  let win = null, best = -1;
  for (const [id, v] of E.cands) if (v > best) { best = v; win = id; }
  if (best <= 0) win = E.cands.size === 1 ? [...E.cands.keys()][0] : null;
  await q(db.update('elections', { id: E.id }, { status: 'closed', winner: win }));
  if (win) {
    await setOffice(E.kingdom, E.office, win);
    system('kingdom', `${nameOf(win)} wins the election for ${OFFICE_NAMES[E.office]} of ${KNAMES[E.kingdom]} with ${Math.max(best, 0)} vote${best === 1 ? '' : 's'}.`, S => S.char.kingdom === E.kingdom);
    if (E.office === 'monarch') system('global', `By the vote of the people, ${nameOf(win)} is crowned ruler of ${KNAMES[E.kingdom]}!`);
  } else system('kingdom', `The election for ${OFFICE_NAMES[E.office]} closes with no candidates.`, S => S.char.kingdom === E.kingdom);
  pushPol(E.kingdom);
}
async function closeMotion(M) {
  motions.delete(M.id);
  const passed = M.yes.size > M.no.size;
  await q(db.update('motions', { id: M.id }, { status: passed ? 'passed' : 'failed' }));
  let note = '';
  if (passed && M.kind === 'grant') {
    if (kingdoms[M.kingdom].treasury >= M.amount && M.target) {
      await changeTreasury(M.kingdom, -M.amount);
      await changeGold(M.target, M.amount, 'parliament grant', 'motion:' + M.id);
      note = ` ${M.amount} gold paid to ${nameOf(M.target)}.`;
    } else note = ' The treasury could not pay it.';
  }
  if (passed && M.kind === 'tax') { kingdoms[M.kingdom].tax_rate = M.tax_rate; await q(db.update('kingdoms', { id: M.kingdom }, { tax_rate: M.tax_rate })); note = ` Tax is now ${Math.round(M.tax_rate * 100)}%.`; }
  system('kingdom', `Parliament ${passed ? 'PASSES' : 'rejects'} “${M.title}” (${M.yes.size}–${M.no.size}).${note}`, S => S.char.kingdom === M.kingdom);
  pushPol(M.kingdom);
}

// ---------------------------------------------------------------- world events (shared missions)
const EVENT_KINDS = [
  { kind: 'fair', reward: 50, title: t => `Market fair in ${t.name}` },
  { kind: 'tourney', reward: 80, title: t => `Tournament at ${t.name}` },
  { kind: 'raid', reward: 100, title: t => `Bandit raid near ${t.name}, defend the town!` },
  { kind: 'muster', reward: 60, title: t => `Royal muster at ${t.name}` },
];
async function startEvent(kind) {
  let ext = null;
  if (SEA && !EVENT_KINDS.some(e => e.kind === kind)) ext = SEA.nextLiveEvent();
  const K0 = EVENT_KINDS.find(e => e.kind === kind) || EVENT_KINDS[Math.floor(Math.random() * EVENT_KINDS.length)];
  const pool = TOWNS.filter(t => t.type !== 'village' || Math.random() < .3);
  const t = ext ? TOWNS[ext.town] : pool[Math.floor(Math.random() * pool.length)];
  const ends = now() + CFG.EVENT_LEN_MIN * 60000;
  const row = ext ? { kind: ext.kind, title: ext.title, town: t.i, x: t.x, z: t.z, reward: ext.reward, ends_at: new Date(ends).toISOString() } : { kind: K0.kind, title: K0.title(t), town: t.i, x: t.x, z: t.z, reward: K0.reward, ends_at: new Date(ends).toISOString() };
  let id = -now();
  try { const r = await db.insert('world_events', row); id = +r[0].id; } catch (e) { log('event insert failed', e.message); }
  const E = { id, ...row, ...(ext ? { obj: ext.obj, cps: ext.cps || null, xp: ext.xp, holdSecs: ext.holdSecs } : {}), ends, joined: new Set(), time: new Map() };
  events.set(id, E);
  each(S => send(S, { t: 'event', ev: evInfo(E) }));
  system('global', `${E.title}. Go there and press “Join” in the Realm panel (.) for ${E.reward} gold.`);
  return E;
}
function evInfo(E) { return { id: E.id, kind: E.kind, title: E.title, x: E.x, z: E.z, reward: E.reward, ends: E.ends, count: E.joined.size, ...(SEA ? SEA.eventExtra(E) : {}) }; }
async function endEvent(E) {
  events.delete(E.id);
  const winners = [...E.joined].filter(uid => SEA ? SEA.eventWon(E, uid) : (E.time.get(uid) || 0) >= CFG.EVENT_STAY_S);
  for (const uid of winners) {
    await changeGold(uid, E.reward, 'world event', 'event:' + E.id);
    if (E.id > 0) q(db.update('event_participants', { event_id: E.id, user_id: uid }, { rewarded: true }));
    if (SEA) SEA.eventRewarded(uid, E);
    const S = online.get(uid); if (S) toast(S, `${E.title} is over: you earned ${E.reward} gold${E.xp ? ' and ' + E.xp + ' XP' : ''}.`, 'gold');
  }
  if (E.id > 0) q(db.update('world_events', { id: E.id }, { status: 'done' }));
  system('global', `${E.title} has ended. ${winners.length} player${winners.length === 1 ? '' : 's'} took part.`);
  each(S => send(S, { t: 'eventEnd', id: E.id }));
}

// ---------------------------------------------------------------- sessions and world entry
function publicInfo(S) {
  return { nid: S.nid, name: S.char.name, k: S.char.kingdom, title: titleOf(S), look: lockLook(S, S.vlook || S.char.look), cos: SEA ? SEA.cosPublic(S) : {}, army: S.mil ? S.mil.army : -1, x: S.x, y: S.y, z: S.z, yaw: S.yaw, mode: S.mode, in: S.inside };
}
function announcePlayer(S) { const info = publicInfo(S); for (const O of online.values()) if (O.ready && O.seen.has(S.nid)) send(O, { t: 'pu', p: info }); }
async function enterWorld(S) {
  const c = S.char;
  names.set(S.id, c.name);
  const m = await db.one('military_members', { where: { user_id: S.id } }).catch(() => null);
  S.mil = m ? { army: m.army, rank: m.rank, regiment_id: m.regiment_id && +m.regiment_id, role: m.regiment_role, corps: CORPS[m.corps] ? m.corps : 'line', lastUp: now() } : null;
  S.x = NaN; S.z = NaN; S.y = 0;   // invisible to others until the game reports where they really are
  S.ready = true;
  online.set(S.id, S);
  const pms = await db.select('private_messages', { where: { recipient: S.id, delivered: false }, order: 'created_at.asc', limit: 50 }).catch(() => []);
  if (pms.length) q(db.update('private_messages', { recipient: S.id, delivered: false }, { delivered: true }));
  const chans = ['global', 'kingdom:' + c.kingdom].concat(S.mil ? ['army:' + S.mil.army] : []);
  const hist = chans.flatMap(ch => history.get(ch) || []).sort((a, b) => a.ts - b.ts).slice(-60);
  const pol = polState(c.kingdom); pol.myVotes = myVotes(S, c.kingdom);
  send(S, {
    t: 'world', you: { nid: S.nid, id: S.id, name: c.name, kingdom: c.kingdom, admin: S.admin, title: titleOf(S) },
    save: overlayServerFields(c), wseq: c.wallet_seq, mil: milInfo(S), pol,
    kingdoms: kingdoms.map(k => ({ id: k.id, name: k.name, treasury: k.treasury, tax: k.tax_rate })),
    props: [...properties.values()].map(p => ({ id: p.id, kind: p.kind, town: p.town, owner: nameOf(p.owner), mine: p.owner === S.id })),
    events: [...events.values()].map(evInfo), history: hist,
    pms: pms.map(p => ({ t: 'chat', ch: 'pm', from: p.sender_name, body: p.body, ts: Date.parse(p.created_at), offline: true })),
    regiments: [...regiments.values()].filter(r => r.kingdom === (S.mil ? S.mil.army : c.kingdom)).map(r => ({ id: r.id, name: r.name, commander: nameOf(r.commander) })),
  });
  sendOffices(S);
  if (SEA) await SEA.onEnter(S);
  log(`${c.name} entered the world (${online.size} online)`);
}
async function leaveWorld(S) {
  if (!S.ready) return;
  S.ready = false;
  if (online.get(S.id) === S) online.delete(S.id);
  byNid.delete(S.nid);
  if (S.trade) cancelTrade(S.trade, `${S.char.name} left.`);
  for (const O of online.values()) if (O.seen.delete(S.nid)) send(O, { t: 'pl', nid: S.nid });
  if (SEA) await SEA.onLeave(S);
  S.dirty = true; await flush(S);
  log(`${S.char.name} left (${online.size} online)`);
}

// ---------------------------------------------------------------- movement relay (area of interest)
function tickMovement() {
  for (const S of online.values()) {
    if (!S.ready || !fin(S.x)) continue;
    const vis = new Set(), upd = [];
    for (const O of online.values()) {
      if (O === S || !O.ready || !fin(O.x)) continue;
      if (O.inside !== S.inside) continue;
      if (Math.abs(O.x - S.x) > CFG.VIEW || Math.abs(O.z - S.z) > CFG.VIEW) continue;
      vis.add(O.nid);
      if (!S.seen.has(O.nid)) send(S, { t: 'pj', p: publicInfo(O) });
      else if (O.moved) upd.push([O.nid, +O.x.toFixed(2), +O.y.toFixed(2), +O.z.toFixed(2), +O.yaw.toFixed(3), O.mode, +O.spd.toFixed(2)]);
    }
    for (const n of S.seen) if (!vis.has(n)) send(S, { t: 'pl', nid: n });
    S.seen = vis;
    if (upd.length) send(S, { t: 'st', p: upd });
  }
  for (const S of online.values()) S.moved = false;
}
function tickRoster() {
  const list = [...online.values()].filter(S => S.ready).map(S => ({ nid: S.nid, name: S.char.name, k: S.char.kingdom, title: titleOf(S), x: fin(S.x) ? Math.round(S.x) : null, z: fin(S.z) ? Math.round(S.z) : null, army: S.mil ? S.mil.army : -1 }));
  each(S => send(S, { t: 'roster', list }));
}
function tickEvents(dt) {
  for (const E of events.values()) {
    for (const uid of E.joined) { const S = online.get(uid); if (S && S.ready && !S.inside && Math.hypot(S.x - E.x, S.z - E.z) < 160) E.time.set(uid, (E.time.get(uid) || 0) + dt); }
    if (SEA) SEA.eventTick(E, dt);
    if (now() > E.ends) endEvent(E);
  }
}

// ---------------------------------------------------------------- chat
const CHAT_MAX = 240;
function chatAllowed(S, body) {
  const c = S.chat, t = now();
  if (t < c.muteUntil) { err(S, `You are muted for ${Math.ceil((c.muteUntil - t) / 1000)} more seconds.`); return false; }
  c.times = c.times.filter(x => t - x < 10000);
  let bad = '';
  if (c.times.length >= 5) bad = 'Slow down: at most 5 messages every 10 seconds.';
  else if (t - c.last < 700) bad = 'Slow down a little.';
  else if (body.toLowerCase() === c.lastText && t - c.lastAt < 30000) bad = 'You just said that.';
  if (bad) { c.strikes++; if (c.strikes >= 3) { c.muteUntil = t + 60000; c.strikes = 0; bad = 'Too many messages: you are muted for 60 seconds.'; } err(S, bad); return false; }
  c.times.push(t); c.last = t; c.lastText = body.toLowerCase(); c.lastAt = t; c.strikes = Math.max(0, c.strikes - 0.25);
  return true;
}
async function onChat(S, m) {
  let body = str(m.body, CHAT_MAX + 1);
  if (!body) return;
  if (body.length > CHAT_MAX) return err(S, `Messages can be at most ${CHAT_MAX} characters.`);
  if (body.startsWith('/')) return command(S, body);
  if (!chatAllowed(S, body)) return;
  const ch = m.ch;
  const base = { t: 'chat', from: S.char.name, fnid: S.nid, k: S.char.kingdom, title: titleOf(S), body, ts: now() };
  if (ch === 'global') {
    const msg = { ...base, ch: 'global' }; pushHistory('global', msg); each(O => send(O, msg));
    q(db.insert('chat_messages', { channel: 'global', sender: S.id, sender_name: S.char.name, body }, { returning: false }));
  } else if (ch === 'local') {
    const msg = { ...base, ch: 'local' };
    each(O => { if (O.inside === S.inside && fin(O.x) && Math.hypot(O.x - S.x, O.z - S.z) <= CFG.LOCAL_CHAT) send(O, msg); });
  } else if (ch === 'kingdom') {
    const k = S.char.kingdom, msg = { ...base, ch: 'kingdom' };
    pushHistory('kingdom:' + k, msg); each(O => { if (O.char.kingdom === k) send(O, msg); });
    q(db.insert('chat_messages', { channel: 'kingdom:' + k, sender: S.id, sender_name: S.char.name, body }, { returning: false }));
  } else if (ch === 'army') {
    if (!S.mil) return err(S, 'Only soldiers can use army chat. Enlist with a recruiter first.');
    const a = S.mil.army, msg = { ...base, ch: 'army', rank: RANKS[S.mil.rank] };
    pushHistory('army:' + a, msg); each(O => { if (O.mil && O.mil.army === a) send(O, msg); });
    q(db.insert('chat_messages', { channel: 'army:' + a, sender: S.id, sender_name: S.char.name, body }, { returning: false }));
  } else if (ch === 'pm') {
    await privateMessage(S, str(m.to, 24), body);
  } else err(S, 'Unknown chat channel.');
}
async function privateMessage(S, toName, body) {
  if (!toName) return err(S, 'Who is the message for?');
  let target = [...online.values()].find(O => O.ready && O.char.name.toLowerCase() === toName.toLowerCase());
  let tid = target && target.id, tname = target && target.char.name;
  if (!target) {
    const r = await db.select('characters', { columns: 'user_id,name', where: { name: { op: 'ilike', value: toName.replace(/[%_]/g, '') } }, limit: 1 }).catch(() => []);
    if (!r.length) return err(S, `There is no one called ${toName}.`);
    tid = r[0].user_id; tname = r[0].name;
  }
  if (tid === S.id) return err(S, 'You mutter to yourself.');
  const msg = { t: 'chat', ch: 'pm', from: S.char.name, fnid: S.nid, to: tname, body, ts: now() };
  await q(db.insert('private_messages', { sender: S.id, sender_name: S.char.name, recipient: tid, body, delivered: !!target }, { returning: false }));
  if (target) send(target, msg);
  send(S, { ...msg, echo: true, offline: !target });
}
async function command(S, body) {
  const [cmd, ...rest] = body.slice(1).split(' ');
  const arg = rest.join(' ').trim();
  const c = cmd.toLowerCase();
  if (c === 'w' || c === 'pm' || c === 'msg') {
    // names can contain spaces ("Pip Cheddarby"): prefer the longest name of someone online that the text starts with
    const low = arg.toLowerCase();
    let nmLen = 0; for (const O of online.values()) { const n = O.char && O.char.name; if (n && n.length > nmLen && low.startsWith(n.toLowerCase() + ' ')) nmLen = n.length; }
    const sp = nmLen || arg.indexOf(' '); if (sp < 1) return err(S, 'Use: /w Name message');
    if (!chatAllowed(S, arg)) return; return privateMessage(S, arg.slice(0, sp), arg.slice(sp + 1).trim());
  }
  if (c === 'g' || c === 'l' || c === 'k' || c === 'a') return onChat(S, { ch: { g: 'global', l: 'local', k: 'kingdom', a: 'army' }[c], body: arg });
  if (c === 'online') return toast(S, `${online.size} player${online.size === 1 ? '' : 's'} online.`);
  if (!S.admin) return err(S, 'Unknown command. Try /w Name message, /g, /l, /k, /a, /online.');
  if (c === 'announce') return system('global', '📜 ' + arg);
  if (c === 'event') { await startEvent(arg || 'season'); return; }
  if (c === 'finale') { if (!SEA.startFinale(S)) return err(S, 'No finale this season, or one is already running.'); return; }
  if (c === 'givexp') { const n = clampInt(arg, 1, 200000); SEA.addXPAdmin(S, n); return toast(S, `+${n} XP (admin test).`); }
  const T = [...online.values()].find(O => O.char && O.char.name.toLowerCase() === arg.split(' ')[0].toLowerCase());
  if (c === 'kick') { if (!T) return err(S, 'Not online.'); send(T, { t: 'kicked', msg: 'You were removed from the server by an admin.' }); T.ws.close(4001, 'kicked'); return toast(S, `${T.char.name} was kicked.`); }
  if (c === 'mute') { if (!T) return err(S, 'Not online.'); const mins = clampInt(arg.split(' ')[1] || 5, 1, 1440); T.chat.muteUntil = now() + mins * 60000; toast(T, `An admin muted you for ${mins} minutes.`); return toast(S, `${T.char.name} muted for ${mins} minutes.`); }
  return err(S, 'Admin commands: /announce text, /event [fair|tourney|raid|muster], /finale, /givexp amount, /kick Name, /mute Name minutes');
}

// ---------------------------------------------------------------- trading between players
let tradeSeq = 1;
const tradeView = T => ({ t: 'trade', id: T.id, a: { name: T.A.char.name, nid: T.A.nid, offer: T.offer.a, ready: T.ready.a }, b: { name: T.B.char.name, nid: T.B.nid, offer: T.offer.b, ready: T.ready.b }, tax: [kingdoms[T.A.char.kingdom].tax_rate, kingdoms[T.B.char.kingdom].tax_rate] });
function cancelTrade(T, why) { if (!T || T.done) return; T.done = true; for (const S of [T.A, T.B]) { S.trade = null; send(S, { t: 'tradeEnd', id: T.id, msg: why || 'Trade cancelled.' }); } }
function holds(c, offer) {
  if (offer.gold > c.gold) return 'not enough gold';
  for (const [k, n] of Object.entries(offer.items)) { const have = c.items[k]; if (typeof have === 'boolean' ? (n !== 1 || !have) : (have || 0) < n) return 'missing ' + k; }
  for (const [k, n] of Object.entries(offer.cargo)) if ((c.cargo[k] || 0) < n) return 'missing ' + k;
  return null;
}
function cleanOffer(m) {
  const o = { gold: clampInt(m.gold, 0, 1e9), items: {}, cargo: {} };
  for (const [bag, src] of [['items', m.items], ['cargo', m.cargo]]) {
    let n = 0;
    if (src && typeof src === 'object') for (const [k, v] of Object.entries(src)) { if (++n > 30) break; const key = str(k, 40); const cnt = clampInt(v, 0, 1e6); if (key && cnt > 0 && key !== '__proto__') o[bag][key] = cnt; }
  }
  return o;
}
async function executeTrade(T) {
  const A = T.A.char, B = T.B.char;
  const pa = holds(A, T.offer.a), pb = holds(B, T.offer.b);
  if (pa || pb) return cancelTrade(T, 'Trade failed: ' + (pa ? T.A.char.name + ' is ' + pa : T.B.char.name + ' is ' + pb) + '.');
  for (const [k, n] of Object.entries(T.offer.a.items)) if (typeof B.items[k] === 'boolean' && B.items[k]) return cancelTrade(T, `${B.name} already has a ${k}.`);
  for (const [k, n] of Object.entries(T.offer.b.items)) if (typeof A.items[k] === 'boolean' && A.items[k]) return cancelTrade(T, `${A.name} already has a ${k}.`);
  T.done = true;
  const taxA = Math.floor(T.offer.a.gold * kingdoms[A.kingdom].tax_rate), taxB = Math.floor(T.offer.b.gold * kingdoms[B.kingdom].tax_rate);
  const move = (from, to, offer, tax) => {
    from.gold -= offer.gold; to.gold += offer.gold - tax;
    for (const [k, n] of Object.entries(offer.items)) { if (typeof from.items[k] === 'boolean') { from.items[k] = false; to.items[k] = true; } else { from.items[k] -= n; to.items[k] = (typeof to.items[k] === 'number' ? to.items[k] : 0) + n; } }
    for (const [k, n] of Object.entries(offer.cargo)) { from.cargo[k] -= n; if (!from.cargo[k]) delete from.cargo[k]; to.cargo[k] = (to.cargo[k] || 0) + n; }
  };
  move(A, B, T.offer.a, taxA); move(B, A, T.offer.b, taxB);
  A.wallet_seq++; B.wallet_seq++;
  T.A.dirty = T.B.dirty = true;
  await Promise.all([flush(T.A), flush(T.B)]);
  if (taxA) await changeTreasury(A.kingdom, taxA);
  if (taxB) await changeTreasury(B.kingdom, taxB);
  q(db.insert('trades', { player_a: T.A.id, player_b: T.B.id, offer_a: T.offer.a, offer_b: T.offer.b, tax_paid: taxA + taxB }, { returning: false }));
  if (T.offer.a.gold) q(db.insert('ledger', [{ user_id: T.A.id, delta: -T.offer.a.gold, reason: 'trade', ref: B.name }, { user_id: T.B.id, delta: T.offer.a.gold - taxA, reason: 'trade', ref: A.name }], { returning: false }));
  if (T.offer.b.gold) q(db.insert('ledger', [{ user_id: T.B.id, delta: -T.offer.b.gold, reason: 'trade', ref: A.name }, { user_id: T.A.id, delta: T.offer.b.gold - taxB, reason: 'trade', ref: B.name }], { returning: false }));
  for (const S of [T.A, T.B]) { S.trade = null; send(S, walletMsg(S.char)); send(S, { t: 'tradeEnd', id: T.id, done: true, msg: 'The trade is done. Shake paws!' }); }
  const worth = o => o.gold + Object.values(o.items).reduce((a, b) => a + b, 0) + Object.values(o.cargo).reduce((a, b) => a + b, 0);
  if (SEA && worth(T.offer.a) > 0 && worth(T.offer.b) > 0) { SEA.metric(T.A, 'trades', 1); SEA.metric(T.B, 'trades', 1); }
}

// ---------------------------------------------------------------- message handlers
const near = (S, O, d) => O && O.ready && S.inside === O.inside && Math.hypot(S.x - O.x, S.z - O.z) <= d;
const H = {
  async s(S, m) {   // movement
    S.lastMove = now();   // the newest position always wins; the flood guard limits how often this can run
    if (![m.x, m.y, m.z, m.yaw].every(fin) || Math.abs(m.x) > 40000 || Math.abs(m.z) > 40000 || Math.abs(m.y) > 5000) return;
    const ox = S.x, oz = S.z;
    S.x = m.x; S.y = m.y; S.z = m.z; S.yaw = m.yaw; S.spd = fin(m.spd) ? Math.max(0, Math.min(400, m.spd)) : 0;
    S.mode = ['walk', 'ship', 'balloon', 'cannon', 'travel', 'swim', 'ride', 'fly', 'dead'].includes(m.mode) ? m.mode : 'walk';
    const ins = m.in === null || m.in === undefined ? null : str(String(m.in), 40);
    if (ins !== S.inside) { S.inside = ins; }
    S.moved = true;
    if (SEA && !S.admin) SEA.onMove(S, ox, oz);
  },
  look(S, m) { S.vlook = lockLook(S, cleanLook(m.look)); announcePlayer(S); },
  save(S, m) { const t = now(); if (!m.force && t - S.lastSave < 3000) return; S.lastSave = t; return applySave(S, m.save, m.wseq, !!m.force); },
  chat: onChat,
  emote(S, m) { const e = (SEA ? SEA.emoteAllowed(S, m.e) : (['wave', 'bow', 'cheer', 'salute', 'dance', 'laugh'].includes(m.e) ? m.e : null)) || 'wave'; if (now() - S.lastEmote < 1500) return; S.lastEmote = now(); if (SEA && S.seen.size) SEA.metric(S, 'emotes', 1); for (const O of online.values()) if (O.seen.has(S.nid) || O === S) send(O, { t: 'emote', nid: S.nid, name: S.char.name, e }); },
  async inspect(S, m) {
    const O = byNid.get(m.nid); if (!O || !O.ready) return err(S, 'That player is gone.');
    const props = [...properties.values()].filter(p => p.owner === O.id).length;
    send(S, { t: 'profile', p: { nid: O.nid, name: O.char.name, k: O.char.kingdom, kingdom: KNAMES[O.char.kingdom], title: titleOf(O), mil: milInfo(O), offices: officesOf(O.id).map(o => OFFICE_NAMES[o.office] + ' of ' + KNAMES[o.k]), props, medals: (O.char.achievements && O.char.achievements.medals || []).length, since: O.char.created_at } });
  },
  async give(S, m) {
    const O = byNid.get(m.nid), amt = clampInt(m.gold, 0, 1e9);
    if (!near(S, O, 15)) return err(S, 'Stand next to them to hand over gold.');
    if (amt < 1) return err(S, 'How much?');
    if (S.char.gold < amt) return err(S, 'You do not have that much gold.');
    if (!(await changeGold(S.id, -amt, 'gift', O.char.name))) return err(S, 'You do not have that much gold.');
    await changeGold(O.id, amt, 'gift', S.char.name);
    toast(S, `You give ${amt} gold to ${O.char.name}.`); toast(O, `${S.char.name} gives you ${amt} gold.`, 'gold');
    if (SEA && amt >= 25) SEA.metric(S, 'gifts', 1);
  },
  tradeReq(S, m) {
    const O = byNid.get(m.nid);
    if (!near(S, O, 15)) return err(S, 'Stand next to them to trade.');
    if (S.trade || O.trade) return err(S, 'One of you is already trading.');
    tradeAsks.set(O.id, { from: S.id, until: now() + 30000 });
    send(O, { t: 'tradeAsk', nid: S.nid, name: S.char.name }); toast(S, `You offer to trade with ${O.char.name}…`);
  },
  tradeAns(S, m) {
    const a = tradeAsks.get(S.id); tradeAsks.delete(S.id);
    const O = a && online.get(a.from);
    if (!a || a.until < now() || !O) return err(S, 'That offer has expired.');
    if (!m.ok) return toast(O, `${S.char.name} declines to trade.`);
    if (S.trade || O.trade) return err(S, 'One of you is already trading.');
    if (!near(S, O, 15)) return err(S, 'You are too far apart to trade.');
    const T = { id: tradeSeq++, A: O, B: S, offer: { a: { gold: 0, items: {}, cargo: {} }, b: { gold: 0, items: {}, cargo: {} } }, ready: { a: false, b: false } };
    O.trade = S.trade = T; const v = tradeView(T); send(O, v); send(S, v);
  },
  tradeSet(S, m) {
    const T = S.trade; if (!T || T.done) return;
    const side = T.A === S ? 'a' : 'b'; const o = cleanOffer(m);
    const p = holds(S.char, o); if (p) return err(S, 'You cannot offer that: ' + p + '.');
    T.offer[side] = o; T.ready.a = T.ready.b = false;
    const v = tradeView(T); send(T.A, v); send(T.B, v);
  },
  async tradeReady(S, m) {
    const T = S.trade; if (!T || T.done) return;
    if (!near(T.A, T.B, 20)) return cancelTrade(T, 'You walked too far apart.');
    T.ready[T.A === S ? 'a' : 'b'] = !!m.ready;
    const v = tradeView(T); send(T.A, v); send(T.B, v);
    if (T.ready.a && T.ready.b) await executeTrade(T);
  },
  tradeCancel(S) { if (S.trade) cancelTrade(S.trade, `${S.char.name} cancelled the trade.`); },
  async buyHouse(S, m) {
    const h = HOUSES.get(str(m.id, 40)); if (!h) return err(S, 'That house is not for sale.');
    if (properties.has(h.id)) return send(S, { t: 'houseNo', id: h.id, msg: `That house belongs to ${nameOf(properties.get(h.id).owner)}.` });
    const town = TOWNS[h.town]; const price = W.houseprice[town.type] || 600;
    const owned = [...properties.values()].filter(p => p.owner === S.id && p.kind === 'house').length;
    if (owned >= MAX_HOUSES) return send(S, { t: 'houseNo', id: h.id, msg: `You already own ${MAX_HOUSES} houses.` });
    const old = null, cost = price;
    if (S.char.gold < cost) return send(S, { t: 'houseNo', id: h.id, msg: `You need ${cost} gold.` });
    const row = { id: h.id, kind: 'house', town: h.town, kingdom: town.k >= 0 ? town.k : null, owner: S.id, price };
    try { await db.insert('properties', row, { returning: false }); } catch (e) { return send(S, { t: 'houseNo', id: h.id, msg: 'Someone else just bought that house.' }); }
    properties.set(h.id, row);
    await changeGold(S.id, -cost, 'house', h.id);
    if (town.k >= 0) await changeTreasury(town.k, cost);
    each(O => send(O, { t: 'prop', id: h.id, kind: 'house', town: h.town, owner: S.char.name, mine: O === S }));
    send(S, { t: 'houseOk', id: h.id, cost, old: old ? old.id : null });
  },
  async buyEstate(S, m) {
    const town = TOWNS[clampInt(m.town, 0, TOWNS.length - 1)];
    if ([...properties.values()].some(p => p.owner === S.id && p.kind === 'estate')) return send(S, { t: 'estateNo', msg: 'You already own an estate.' });
    if ([...properties.values()].filter(p => p.kind === 'estate' && p.town === town.i).length >= ESTATES_PER_TOWN) return send(S, { t: 'estateNo', msg: `All the land around ${town.name} is taken.` });
    if (S.char.gold < ESTATE_PRICE) return send(S, { t: 'estateNo', msg: `An estate costs ${ESTATE_PRICE} gold.` });
    const row = { id: 'e:' + town.i + ':' + S.id.slice(0, 8), kind: 'estate', town: town.i, kingdom: town.k >= 0 ? town.k : null, owner: S.id, price: ESTATE_PRICE };
    try { await db.insert('properties', row, { returning: false }); } catch (e) { return send(S, { t: 'estateNo', msg: 'Could not register the estate.' }); }
    properties.set(row.id, row);
    await changeGold(S.id, -ESTATE_PRICE, 'estate', row.id);
    if (town.k >= 0) await changeTreasury(town.k, ESTATE_PRICE);
    each(O => send(O, { t: 'prop', id: row.id, kind: 'estate', town: town.i, owner: S.char.name, mine: O === S }));
    S.estateAt = now();
    send(S, { t: 'estateOk', town: town.i });
  },
  async estateRefund(S, m) {
    const p = [...properties.values()].find(x => x.owner === S.id && x.kind === 'estate' && x.town === clampInt(m.town, 0, 1e6));
    if (!p || !S.estateAt || now() - S.estateAt > 120000) return;
    properties.delete(p.id); await q(db.remove('properties', { id: p.id }));
    await changeGold(S.id, p.price, 'estate refund', p.id);
    if (p.kingdom !== null && p.kingdom !== undefined) await changeTreasury(p.kingdom, -p.price);
    each(O => send(O, { t: 'prop', id: p.id, owner: null }));
  },
  // ---- regiments and army authority
  async regCreate(S, m) {
    if (!S.mil) return err(S, 'Enlist in an army first.');
    if (S.mil.regiment_id) return err(S, 'Leave your regiment first.');
    if (S.mil.rank < RANKS.indexOf('Sergeant')) return err(S, 'Only a Sergeant or higher may raise a regiment.');
    const name = str(m.name, 40); if (name.length < 3) return err(S, 'Give the regiment a name (3–40 letters).');
    if (S.char.gold < REGIMENT_PRICE) return err(S, `Raising a regiment costs ${REGIMENT_PRICE} gold.`);
    let r; try { r = (await db.insert('regiments', { kingdom: S.mil.army, name, commander: S.id }))[0]; } catch (e) { return err(S, 'That regiment name is taken.'); }
    await changeGold(S.id, -REGIMENT_PRICE, 'regiment', name);
    regiments.set(+r.id, { id: +r.id, kingdom: S.mil.army, name, commander: S.id });
    S.mil.regiment_id = +r.id; S.mil.role = 'commander';
    await q(db.update('military_members', { user_id: S.id }, { regiment_id: +r.id, regiment_role: 'commander' }));
    send(S, { t: 'mil', mil: milInfo(S) }); toast(S, `You raise the ${name}.`, 'gold');
    system('army', `${S.char.name} raises a new regiment: ${name}.`, O => O.mil && O.mil.army === S.mil.army);
  },
  regInvite(S, m) {
    const O = byNid.get(m.nid);
    if (!S.mil || !S.mil.regiment_id || S.mil.role === 'member') return err(S, 'Only regiment officers can invite.');
    if (!O || !O.ready) return err(S, 'That player is gone.');
    if (!O.mil || O.mil.army !== S.mil.army) return err(S, `${O.char.name} is not in your army.`);
    if (O.mil.regiment_id) return err(S, `${O.char.name} is already in a regiment.`);
    const R = regiments.get(S.mil.regiment_id);
    regInvites.set(O.id, { regiment: R.id, from: S.id, until: now() + 120000 });
    send(O, { t: 'regInvite', id: R.id, name: R.name, from: S.char.name }); toast(S, `Invitation sent to ${O.char.name}.`);
  },
  async regJoin(S, m) {
    const inv = regInvites.get(S.id); regInvites.delete(S.id);
    if (!inv || inv.until < now() || inv.regiment !== clampInt(m.id, 0, 1e12)) return err(S, 'That invitation has expired.');
    const R = regiments.get(inv.regiment); if (!R || !S.mil || S.mil.army !== R.kingdom) return err(S, 'You cannot join that regiment.');
    if (!m.ok) return;
    S.mil.regiment_id = R.id; S.mil.role = 'member';
    await q(db.update('military_members', { user_id: S.id }, { regiment_id: R.id, regiment_role: 'member' }));
    send(S, { t: 'mil', mil: milInfo(S) });
    system('army', `${S.char.name} joins the ${R.name}.`, O => O.mil && O.mil.regiment_id === R.id);
  },
  regLeave(S) { return leaveRegiment(S); },
  async regRole(S, m) {
    if (!S.mil || S.mil.role !== 'commander') return err(S, 'Only the commander can change roles.');
    const O = byNid.get(m.nid); if (!O || !O.mil || O.mil.regiment_id !== S.mil.regiment_id || O === S) return err(S, 'They are not in your regiment.');
    const role = m.role === 'officer' ? 'officer' : m.role === 'kick' ? null : 'member';
    if (role === null) { await leaveRegiment(O, true); toast(O, 'You were dismissed from the regiment.'); return toast(S, `${O.char.name} dismissed.`); }
    O.mil.role = role; await q(db.update('military_members', { user_id: O.id }, { regiment_role: role }));
    send(O, { t: 'mil', mil: milInfo(O) }); toast(O, `You are now a regiment ${role}.`); toast(S, `${O.char.name} is now a regiment ${role}.`);
  },
  async armyPromote(S, m) {   // the Marshal or Monarch sets a soldier's rank in their kingdom's army
    const O = byNid.get(m.nid); if (!O || !O.ready || !O.mil) return err(S, 'They are not a soldier.');
    const k = O.mil.army; const isMon = offices[k].monarch === S.id, isMar = offices[k].marshal === S.id;
    if (!isMon && !isMar && !S.admin) return err(S, `Only the Marshal or Monarch of ${KNAMES[k]} can promote its soldiers.`);
    const r = clampInt(m.rank, 0, S.admin ? MAX_RANK : WARRANT);   // field promotions stop at Warrant Officer; officers are made by admins
    O.mil.rank = r; O.mil.lastUp = now(); await q(db.update('military_members', { user_id: O.id }, { rank: r }));
    O.char.army_rank = r; O.dirty = true;
    send(O, { t: 'rankSet', rank: r, by: S.char.name }); announcePlayer(O);
    toast(S, `${O.char.name} is now ${RANKS[r]}.`);
  },
  // ---- government, elections and parliament
  async elecCall(S, m) {
    const k = S.char.kingdom, office = OFFICES.includes(m.office) ? m.office : null;
    if (!office) return err(S, 'No such office.');
    if ([...elections.values()].some(e => e.kingdom === k && e.office === office)) return err(S, 'An election for that office is already open.');
    const key = k + ':' + office; if (now() - (lastElection.get(key) || 0) < 10 * 60000 && !S.admin) return err(S, 'An election for that office was held recently. Try again later.');
    lastElection.set(key, now());
    const closes = now() + CFG.ELECTION_MIN * 60000;
    let r; try { r = (await db.insert('elections', { kingdom: k, office, called_by: S.id, closes_at: new Date(closes).toISOString() }))[0]; } catch (e) { return err(S, 'Could not open the election.'); }
    elections.set(+r.id, { id: +r.id, kingdom: k, office, closes, cands: new Map(), voters: new Set() });
    system('kingdom', `${S.char.name} calls an election for ${OFFICE_NAMES[office]}. Stand or vote in the Realm panel (.) within ${CFG.ELECTION_MIN} minutes.`, O => O.char.kingdom === k);
    pushPol(k);
  },
  async elecStand(S, m) {
    const E = elections.get(clampInt(m.id, 0, 1e12)); if (!E || E.kingdom !== S.char.kingdom) return err(S, 'That election is closed.');
    if (E.cands.has(S.id)) return err(S, 'You are already standing.');
    try { await db.insert('election_candidates', { election_id: E.id, user_id: S.id }, { returning: false }); } catch (e) { return err(S, 'Could not register you.'); }
    E.cands.set(S.id, 0); pushPol(E.kingdom);
    system('kingdom', `${S.char.name} stands for ${OFFICE_NAMES[E.office]}.`, O => O.char.kingdom === E.kingdom);
  },
  async elecVote(S, m) {
    const E = elections.get(clampInt(m.id, 0, 1e12)); if (!E || E.kingdom !== S.char.kingdom) return err(S, 'That election is closed.');
    if (E.voters.has(S.id)) return err(S, 'You have already voted in this election.');
    const cand = [...E.cands.keys()].find(id => id === m.cand); if (!cand) return err(S, 'That person is not standing.');
    try { await db.insert('election_votes', { election_id: E.id, voter_id: S.id, candidate_id: cand }, { returning: false }); } catch (e) { return err(S, 'You have already voted in this election.'); }
    E.voters.add(S.id); E.cands.set(cand, E.cands.get(cand) + 1); pushPol(E.kingdom); toast(S, `Your vote for ${nameOf(cand)} is counted.`);
    if (SEA) SEA.metric(S, 'votes', 1);
  },
  async appoint(S, m) {
    const k = S.char.kingdom;
    if (offices[k].monarch !== S.id && !S.admin) return err(S, 'Only the Monarch can appoint ministers.');
    if (!OFFICES.includes(m.office) || m.office === 'monarch') return err(S, 'You cannot appoint to that office.');
    const O = byNid.get(m.nid); if (!O || !O.ready || O.char.kingdom !== k) return err(S, 'They are not a citizen of your kingdom.');
    await setOffice(k, m.office, O.id);
    system('kingdom', `${S.char.name} appoints ${O.char.name} as ${OFFICE_NAMES[m.office]}.`, X => X.char.kingdom === k);
  },
  async resign(S, m) {
    const k = S.char.kingdom; if (!OFFICES.includes(m.office) || offices[k][m.office] !== S.id) return err(S, 'You do not hold that office.');
    await setOffice(k, m.office, null);
    system('kingdom', `${S.char.name} resigns as ${OFFICE_NAMES[m.office]}.`, X => X.char.kingdom === k);
  },
  async motion(S, m) {
    const k = S.char.kingdom;
    if (!holdsOffice(S.id, k) && !S.admin) return err(S, 'Only office holders sit in Parliament.');
    if ([...motions.values()].filter(x => x.kingdom === k).length >= 3) return err(S, 'Parliament already has three motions open.');
    const title = str(m.title, 140); if (title.length < 3) return err(S, 'Give the motion a title.');
    const kind = ['decree', 'grant', 'tax'].includes(m.kind) ? m.kind : 'decree';
    const row = { kingdom: k, proposer: S.id, title, kind, closes_at: new Date(now() + CFG.MOTION_MIN * 60000).toISOString() };
    if (kind === 'grant') {
      row.amount = clampInt(m.amount, 1, 1e9); if (row.amount > kingdoms[k].treasury) return err(S, `The treasury holds only ${kingdoms[k].treasury} gold.`);
      const r = await db.select('characters', { columns: 'user_id,name,kingdom', where: { name: { op: 'ilike', value: str(m.target, 24).replace(/[%_]/g, '') } }, limit: 1 }).catch(() => []);
      if (!r.length) return err(S, 'No such player to receive the grant.'); row.target = r[0].user_id; names.set(r[0].user_id, r[0].name);
    }
    if (kind === 'tax') { row.tax_rate = Math.max(0, Math.min(.2, Number(m.rate) / 100 || 0)); }
    let r; try { r = (await db.insert('motions', row))[0]; } catch (e) { return err(S, 'Could not table the motion.'); }
    motions.set(+r.id, { id: +r.id, kingdom: k, title, kind, amount: row.amount, target: row.target, tax_rate: row.tax_rate, proposer: S.id, closes: Date.parse(row.closes_at), yes: new Set(), no: new Set() });
    system('kingdom', `Parliament: ${S.char.name} tables “${title}”.`, O => O.char.kingdom === k);
    pushPol(k);
  },
  async motionVote(S, m) {
    const M = motions.get(clampInt(m.id, 0, 1e12)); if (!M || M.kingdom !== S.char.kingdom) return err(S, 'That motion is closed.');
    if (!holdsOffice(S.id, M.kingdom) && !S.admin) return err(S, 'Only office holders vote in Parliament.');
    if (M.yes.has(S.id) || M.no.has(S.id)) return err(S, 'You have already voted on this motion.');
    try { await db.insert('motion_votes', { motion_id: M.id, voter_id: S.id, yes: !!m.yes }, { returning: false }); } catch (e) { return err(S, 'You have already voted.'); }
    (m.yes ? M.yes : M.no).add(S.id);
    if (SEA) SEA.metric(S, 'votes', 1);
    const members = new Set(Object.values(offices[M.kingdom]).filter(Boolean));
    if ([...members].every(id => M.yes.has(id) || M.no.has(id)) && members.size) await closeMotion(M); else pushPol(M.kingdom);
  },
  async changeKingdom(S, m) {
    const k = clampInt(m.k, 0, 3); if (k === S.char.kingdom) return;
    const last = S.char.kingdom_changed_at ? Date.parse(S.char.kingdom_changed_at) : 0;
    if (now() - last < 24 * 3600000 && !S.admin) return err(S, 'You can change kingdom once a day.');
    for (const o of OFFICES) if (offices[S.char.kingdom][o] === S.id) await setOffice(S.char.kingdom, o, null);
    S.char.kingdom = k; S.char.kingdom_changed_at = new Date().toISOString();
    await q(db.update('characters', { user_id: S.id }, { kingdom: k, kingdom_changed_at: S.char.kingdom_changed_at }));
    const p = polState(k); p.myVotes = myVotes(S, k);
    send(S, { t: 'kingdom', k, pol: p }); announcePlayer(S); toast(S, `You are now a citizen of ${KNAMES[k]}.`, 'gold');
  },
  // ---- specialised corps
  async joinStorm(S) {   // the one corps a soldier can volunteer for: line Warrant Officers may join the Storm Troopers
    if (!S.mil) return err(S, 'Enlist in an army first.');
    if (corpsOf(S) !== 'line') return err(S, `You already serve in the ${CORPS[corpsOf(S)]}. Only an admin can transfer you.`);
    if (S.mil.rank !== WARRANT) return err(S, `Only a Warrant Officer of the line may volunteer for the Storm Troopers.`);
    S.mil.corps = 'storm'; await q(db.update('military_members', { user_id: S.id }, { corps: 'storm' }));
    S.vlook = lockLook(S, S.vlook); send(S, { t: 'mil', mil: milInfo(S) }); announcePlayer(S);
    toast(S, 'You volunteer for the Storm Troopers. Grenades, a storm carbine and the steel helmet are yours.', 'gold');
  },
  async adminSetMil(S, m) {   // admins choose anyone's army, rank and corps, their own included
    if (!S.admin) return err(S, 'Only admins can assign ranks and corps.');
    const corps = m.corps === undefined ? undefined : (CORPS[m.corps] ? m.corps : null);
    if (corps === null) return err(S, 'No such corps.');
    let T = null, uid = null;
    if (fin(m.nid)) { T = [...online.values()].find(O => O.nid === m.nid && O.char); if (!T) return err(S, 'That player is not online any more. Refresh the list.'); uid = T.id; }
    else if (typeof m.uid === 'string' && /^[0-9a-f-]{36}$/i.test(m.uid)) uid = m.uid;
    else return err(S, 'Pick a player.');
    if (!T) T = online.get(uid) || null;
    const ch = T ? T.char : await db.one('characters', { columns: 'user_id,name,kingdom', where: { user_id: uid } }).catch(() => null);
    if (!ch) return err(S, 'No such character.');
    const cur = T ? T.mil : await db.one('military_members', { where: { user_id: uid } }).catch(() => null);
    let army = m.army === undefined ? (cur ? cur.army : -1) : clampInt(m.army, -1, 3);
    if (army < 0 && (corps !== undefined || m.rank !== undefined) && m.army === undefined) army = ch.kingdom;   // giving a rank or corps to a civilian enlists them in their own kingdom
    if (army < 0) {
      if (T) await setArmy(T, -1); else { await q(db.remove('military_members', { user_id: uid })); await q(db.update('characters', { user_id: uid }, { army: -1, army_rank: 0 })); }
      toast(S, `${ch.name} is no longer a soldier.`); if (T) toast(T, 'An admin has discharged you from the army.');
      return H.adminList(S, { force: true });
    }
    const rank = m.rank === undefined ? (cur && cur.army === army ? cur.rank : 0) : clampInt(m.rank, 0, MAX_RANK);
    const cps = corps !== undefined ? corps : (cur && cur.army === army ? (cur.corps || 'line') : 'line');
    if (T) {
      if (!T.mil || T.mil.army !== army) await setArmy(T, army);
      T.mil.rank = rank; T.mil.corps = cps; T.mil.lastUp = now(); T.char.army = army; T.char.army_rank = rank; T.dirty = true;
      await q(db.update('military_members', { user_id: uid }, { rank, corps: cps }));
      T.vlook = lockLook(T, T.vlook);
      send(T, { t: 'mil', mil: milInfo(T) }); send(T, { t: 'rankSet', rank, by: S.char.name, army, corps: cps }); announcePlayer(T);
      if (T !== S) toast(T, `${S.char.name} makes you ${RANKS[rank]} of the ${CORPS[cps]}, ${KNAMES[army]} Army.`, 'gold');
    } else {
      await q(db.insert('military_members', { user_id: uid, army, rank, corps: cps, regiment_id: cur && cur.army === army ? cur.regiment_id : null, regiment_role: cur && cur.army === army ? cur.regiment_role : 'member' }, { upsert: true, onConflict: 'user_id', returning: false }));
      await q(db.update('characters', { user_id: uid }, { army, army_rank: rank }));
    }
    toast(S, `${ch.name} is now ${RANKS[rank]}, ${CORPS[cps]}, ${KNAMES[army]} Army.`, 'gold');
    return H.adminList(S, { force: true });
  },
  // ---- admin tools: the whole realm's player list (server admins only, checked here)
  async adminList(S, m) {
    if (!S.admin) return err(S, 'Only admins can see the realm’s player list.');
    if (!(m && m.force) && now() - (S.lastAdminList || 0) < 1500) return; S.lastAdminList = now();
    const mm = new Map((await db.select('military_members', { columns: 'user_id,corps', limit: 2000 }).catch(() => [])).map(r => [r.user_id, r.corps]));
    const rows = await db.select('characters', { columns: 'user_id,name,kingdom,gold,army,army_rank,pos_x,pos_z,last_seen,created_at', order: 'last_seen.desc', limit: 500 }).catch(() => []);
    const seen = new Set(), list = [];
    for (const O of online.values()) {
      if (!O.char) continue; seen.add(O.id);
      list.push({ nid: O.nid, name: O.char.name, k: O.char.kingdom, gold: O.char.gold, army: O.mil ? O.mil.army : -1, rank: O.mil ? O.mil.rank : 0, corps: corpsOf(O) || 'line', x: fin(O.x) ? Math.round(O.x) : null, z: fin(O.z) ? Math.round(O.z) : null, inside: !!O.inside, mode: O.mode || 'walk', online: true, playing: !!O.ready && fin(O.x), last: now(), since: O.char.created_at, muted: O.chat && O.chat.muteUntil > now() ? O.chat.muteUntil : 0 });
    }
    for (const r of rows) if (!seen.has(r.user_id)) list.push({ uid: r.user_id, name: r.name, k: r.kingdom, gold: +r.gold, army: r.army, rank: r.army_rank, corps: mm.get(r.user_id) || 'line', x: Math.round(+r.pos_x || 0), z: Math.round(+r.pos_z || 0), online: false, last: Date.parse(r.last_seen) || 0, since: r.created_at });
    send(S, { t: 'adminList', list, total: list.length, capped: rows.length >= 500, ranks: RANKS, corps: CORPS, warrant: WARRANT });
  },
  adminSummon(S, m) {
    if (!S.admin) return err(S, 'Only admins can summon players.');
    const T = [...online.values()].find(O => O.nid === m.nid && O.ready);
    if (!T) return err(S, 'That player is not in the world right now.');
    if (T === S) return;
    if (!fin(S.x) || S.inside) return err(S, 'Step outside first, so there is somewhere to bring them.');
    send(T, { t: 'summon', x: S.x + 2, z: S.z + 2, by: S.char.name });
    toast(S, `${T.char.name} is brought to you.`);
  },
  eventJoin(S, m) {
    const E = events.get(Number(m.id)); if (!E) return err(S, 'That event is over.');
    if (S.inside || Math.hypot(S.x - E.x, S.z - E.z) > 160) return err(S, `Go to ${TOWNS[E.town] ? TOWNS[E.town].name : 'the event'} first, then join.`);
    if (E.joined.has(S.id)) return;
    E.joined.add(S.id);
    if (E.id > 0) q(db.insert('event_participants', { event_id: E.id, user_id: S.id }, { returning: false }));
    toast(S, `You join: ${E.title}. Stay nearby to earn ${E.reward} gold.`, 'gold');
    each(O => send(O, { t: 'event', ev: evInfo(E) }));
  },
  async pol(S) { const k = S.char.kingdom; const p = polState(k); p.myVotes = myVotes(S, k); send(S, { t: 'pol', pol: p }); },
};

// ---------------------------------------------------------------- connection lifecycle
async function onHello(S, m) {
  const user = await db.userFromToken(m.token);
  if (user && leaving.has(user.id)) await leaving.get(user.id).catch(() => {});   // let a just-closed session finish saving first
  if (!user) { send(S, { t: 'auth', ok: false, msg: 'Your login has expired. Please sign in again.' }); return S.ws.close(4003, 'bad token'); }
  let prof = await db.one('profiles', { where: { id: user.id } });
  if (!prof) { await db.insert('profiles', { id: user.id }, { upsert: true, onConflict: 'id', returning: false }); prof = { id: user.id, is_admin: false, banned: false }; }
  if (prof.banned) { send(S, { t: 'auth', ok: false, msg: 'This account is banned.' }); return S.ws.close(4004, 'banned'); }
  const old = online.get(user.id);
  if (old && old !== S) { send(old, { t: 'kicked', msg: 'You signed in somewhere else.' }); await leaveWorld(old); old.ws.close(4002, 'replaced'); }
  S.id = user.id; S.email = user.email; S.admin = !!prof.is_admin;
  const c = await db.one('characters', { where: { user_id: user.id } });
  send(S, { t: 'auth', ok: true, id: user.id, admin: S.admin, needCharacter: !c, kingdoms: KNAMES });
  if (c) { S.char = normChar(c); await enterWorld(S); }
}
function normChar(c) { return { ...c, gold: +c.gold, items: c.items || {}, cargo: c.cargo || {}, look: c.look || {} }; }
async function onCreate(S, m) {
  if (!S.id || S.char) return;
  const name = str(m.name, 24).replace(/\s+/g, ' ');
  if (!/^[A-Za-z][A-Za-z '\-]{1,23}$/.test(name)) return err(S, 'Names use 2–24 letters, spaces, hyphens or apostrophes.');
  const kingdom = clampInt(m.kingdom, 0, 3);
  const save = m.save && typeof m.save === 'object' ? m.save : {};
  const row = { user_id: S.id, name, kingdom, look: cleanLook(m.look || save.look), gold: 40, wallet_seq: 0, items: { tonic: 1, musket: false, backpack: false, lumen: false }, cargo: {}, save: null };
  try { await db.insert('characters', row, { returning: false }); }
  catch (e) { return err(S, e.code === '23505' || /duplicate|unique/i.test(e.message) ? `The name ${name} is already taken.` : 'Could not create your character.'); }
  const c = await db.one('characters', { where: { user_id: S.id } });
  S.char = normChar(c);
  S.char.save = { ...save, name, home: kingdom, gold: 40 };
  S.dirty = true;
  await enterWorld(S);
  await flush(S);
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, online: online.size, uptime: process.uptime() | 0 })); }
  res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Age of Crowns multiplayer server is running.\n');
});
const originOk = o => CFG.ALLOWED_ORIGINS.includes('*') || CFG.ALLOWED_ORIGINS.includes(o);
attach(server, { maxPayload: 600 * 1024, verifyOrigin: originOk }, (ws, req) => {
  const S = {
    ws, nid: nidSeq++, id: null, char: null, ready: false, x: NaN, y: 0, z: NaN, yaw: 0, mode: 'walk', spd: 0, inside: null, moved: false,
    seen: new Set(), dirty: false, lastFlush: 0, lastSave: 0, lastMove: 0, lastEmote: 0, earn: { budget: 2000, t: now() },
    chat: { times: [], last: 0, lastText: '', lastAt: 0, strikes: 0, muteUntil: 0 }, mil: null, trade: null, msgs: 0, msgT: now(),
  };
  byNid.set(S.nid, S);
  let busy = Promise.resolve();
  ws.on('message', raw => {
    // flood guard: at most 60 messages per second per connection
    const t = now(); if (t - S.msgT > 1000) { S.msgT = t; S.msgs = 0; } if (++S.msgs > 60) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    busy = busy.then(async () => {
      try {
        if (m.t === 'hello') return await onHello(S, m);
        if (m.t === 'create') return await onCreate(S, m);
        if (m.t === 'ping') return send(S, { t: 'pong', ts: m.ts });
        if (!S.ready) return;
        const h = Object.prototype.hasOwnProperty.call(H, m.t) ? H[m.t] : null;
        if (h) await h(S, m);
      } catch (e) { log('handler error', m.t, e.stack || e.message); err(S, 'The server could not do that.'); }
    });
  });
  ws.on('close', () => {
    const p = busy.then(() => leaveWorld(S)).catch(() => {});
    if (S.id) { leaving.set(S.id, p); p.then(() => { if (leaving.get(S.id) === p) leaving.delete(S.id); }); }
    byNid.delete(S.nid);
  });
});

// ---------------------------------------------------------------- seasons, battle pass and story
SEA = require('./season')({ db, send, toast, system, changeGold, online, each, TOWNS, CFG, log, q, err, walletMsg, flush, nameOf, announcePlayer });
for (const [k, fn] of Object.entries(SEA.handlers)) H[k] = fn;
let seaBusy = false, seaLast = now();
setInterval(async () => { if (seaBusy) return; seaBusy = true; const t = now(); try { await SEA.tick((t - seaLast) / 1000); } catch (e) { log('season tick error', e.stack || e.message); } seaLast = t; seaBusy = false; }, 1000);

let lastTick = now();
setInterval(tickMovement, 100);
setInterval(tickRoster, 3000);
setInterval(() => {
  const t = now(), dt = (t - lastTick) / 1000; lastTick = t;
  tickEvents(dt);
  for (const E of elections.values()) if (t > E.closes) closeElection(E);
  for (const M of motions.values()) if (t > M.closes) closeMotion(M);
  for (const [k, v] of tradeAsks) if (v.until < t) tradeAsks.delete(k);
  for (const S of online.values()) if (S.dirty && t - S.lastFlush > 10000) flush(S);
}, 1000);
setInterval(() => { for (const S of online.values()) { if (!S.ws.alive) { S.ws.close(4000, 'timeout'); continue; } S.ws.alive = false; S.ws.ping(); } }, 25000);
let nextEvent = now() + CFG.EVENT_EVERY_MIN * 60000;
setInterval(() => { if (now() > nextEvent) { nextEvent = now() + CFG.EVENT_EVERY_MIN * 60000; if (online.size) startEvent('season'); } }, 5000);

async function shutdown() { log('saving everyone and shutting down…'); if (SEA) await SEA.flushAll().catch(() => {}); for (const S of online.values()) { S.dirty = true; await flush(S); } process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

loadRealm().then(() => SEA.init()).then(() => server.listen(CFG.PORT, () => log(`Age of Crowns server listening on port ${CFG.PORT}`)))
  .catch(e => { console.error('Could not load the realm from Supabase. Did you run supabase/schema.sql?\n', e.message); process.exit(1); });

module.exports = { server, CFG };
