'use strict';
/*
  THE SHARED REALM
  ----------------
  One world for every player, run here on the server so that no browser can bend it:
  the calendar, relations between the four crowns, wars, peace and alliances, treaties,
  royal treasuries and approval, rulers and their heirs, rebel and occupied towns, burnt
  towns, forts, the herald's news and every army company in the field with its reserves.
  Browsers draw it and send requests; every request is checked against the sender's rank
  or office before anything changes.
  The world is stored in the world_state table (supabase/world.sql). The first time the
  server starts without one, it is seeded from the saved game of the character named in
  WORLD_SEED (Natan by default).
*/
module.exports = function makeWorld(ctx) {
  const { db, log, each, send, err, toast, online, offices, nameOf, TOWNS, KNAMES, RANKS, changeGold, byNid, CORPS, system } = ctx;
  const DAYLEN = 720;                     // real seconds in a game day, as in the browser
  const SEED = (process.env.WORLD_SEED || 'Natan').toLowerCase();
  const rr = Math.random, pick = a => a[Math.floor(rr() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const R4 = () => [0, 1, 2, 3];
  const KN = KNAMES;
  const capOf = k => TOWNS.find(t => t.k === k && t.type === 'capital') || TOWNS.find(t => t.k === k);
  const mainland = t => t && t.main !== false && !t.nation && t.type !== 'market';
  const FIELD = { foot: { n: 3, size: 20 }, horse: { n: 2, size: 12 }, guns: { n: 2, size: 6 } };
  const CAPS = { foot: 100, guns: 200, horse: 500 };
  const UNITCOST = { foot: 4, horse: 7, guns: 9 };
  const TBASE = { capital: 120, city: 70, town: 45, village: 22, market: 0 };
  const DIVS = { foot: { line: [1, 1, 1], storm: [1.3, .85, 1.2], heavy: [1.1, 1.3, .85], sniper: [1.25, .8, .95], light: [1.05, .9, 1.3], grenadier: [1.1, 1.25, .9], guard: [1.15, 1.15, 1] },
    // infantry: the player corps (Line, Shock Troopers, Heavy, Snipers) and the old legions; retired names are renamed when the world loads
    horse: { hussar: [1, .9, 1.3], dragoon: [1.05, 1, 1.1], cuirassier: [1.35, 1.25, .9] }, guns: { field: [1, 1, 1], horse: [.85, .9, 1.6], siege: [1.2, .9, .7] } };
  const DIV0 = { foot: 'line', horse: 'dragoon', guns: 'field' };
  const DIVMAP = { shock: 'storm', raider: 'light', gas: 'guard', flamer: 'storm', ranger: 'light', aviator: 'light' };
  const FOOTMIX = ['line', 'line', 'line', 'storm', 'heavy', 'sniper', 'light', 'grenadier', 'guard'];   // what the AI raises
  const FORMS = ['line', 'column', 'square', 'skirmish'], STANCES = ['attack', 'defend', 'hold'];
  const PERS = { warlike: { agg: .85, dip: .3, greed: .5, caut: .25 }, diplomatic: { agg: .2, dip: .9, greed: .35, caut: .6 }, mercantile: { agg: .35, dip: .6, greed: .85, caut: .5 }, cautious: { agg: .2, dip: .5, greed: .4, caut: .9 }, scheming: { agg: .55, dip: .45, greed: .6, caut: .45 } };
  const POL = { conscript: { appr: -6, mil: 1.2 }, freetrade: { inc: -.15, rel: 1 }, tolls: { inc: .2, appr: -3, rel: -1 }, subsidy: { appr: 10, cost: 80 }, martial: { appr: -10, stab: 4 }, bounty: { cost: 60 }, press: { appr: 4, stab: -1 }, guilds: { cost: 50 }, borders: { stab: 3, rel: -2 }, tithe: { cost: 40, appr: 2 }, schools: { cost: 70, stab: 2, appr: 3 }, levy: { inc: .12, appr: -5 } };
  const INCID = [(a, b) => `${KN[a]} border guards seize a ${KN[b]} cheese caravan.`, (a, b) => `A ${KN[b]} spy is caught sketching the walls of ${capOf(a).name}.`, (a, b) => `Fishermen of ${KN[a]} and ${KN[b]} brawl over the pearl beds.`, (a, b) => `${KN[a]} doubles its tariffs on ${KN[b]} goods.`, (a, b) => `A ${KN[b]} ambassador is insulted at the court of ${KN[a]}.`];
  const GOODW = [(a, b) => `${KN[a]} and ${KN[b]} sign a trade agreement.`, (a, b) => `A royal wedding unites noble houses of ${KN[a]} and ${KN[b]}.`, (a, b) => `${KN[a]} sends grain to ${KN[b]} after a hard winter.`, (a, b) => `Scholars of ${KN[a]} and ${KN[b]} map the islands together.`];
  const FIRST = ['Bram', 'Clover', 'Dusty', 'Ember', 'Fennel', 'Hazel', 'Juniper', 'Marigold', 'Nutmeg', 'Pip', 'Rowan', 'Sorrel', 'Thistle', 'Wren', 'Bramble', 'Barley'];
  const LAST = ['Whiskerton', 'Cheddarby', 'Nibbleworth', 'Crumbleton', 'Tailsworth', 'Brie', 'Squeakley', 'Pawsley', 'Gouda', 'Rindhaven', 'Burrowes'];
  const PFX = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
  const PROJ = { fort: [2000, 3500], navy: [1800, 3200], academy: [2500], monument: [3000], spies: [1500, 2500], roads: [1200, 2200], balloonworks: [2200] };
  const DEF_RULERS = ['Queen Isolde Frostwhisker', 'King Aldric Thornwhisker', 'Empress Mirela Fernwhisk', 'Doge Marisol Saltwhisker'];

  let W = null, dirty = false, lastSave = 0, regId = 0, saveOk = true, lastDay = 0;
  const leads = new Map();
  const clashes = new Map(); // pair of companies -> game time their clash was last announced   // company id -> user id of the officer leading it (online authority, not saved)

  // ---------------------------------------------------------------- state
  function blank() {
    return { v: 1, t: 1 + 8 / 24, seq: 0,
      rel: [[100, 10, -70, 0], [10, 100, 0, -70], [-70, 0, 100, 10], [0, -70, 10, 100]], war: [[0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0], [0, 1, 0, 0]], ally: [[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]],
      ws: R4().map(() => [0, 0, 0, 0]), news: [],
      ai: R4().map(k => ({ pers: ['cautious', 'mercantile', 'warlike', 'diplomatic'][k], mil: 55 + k * 3, stab: 70, goal: 'Watching the other courts', grudge: [0, 0, 0, 0], trust: [0, 0, 0, 0], age: 45 + k * 4 })),
      gov: { tax: [10, 10, 10, 10], treasury: [2500, 2500, 2500, 2500], appr: [72, 72, 72, 72], fest: [0, 0, 0, 0], pol: [{}, {}, {}, {}], proj: [{}, {}, {}, {}] },
      treaties: [], occ: {}, ruin: {}, rebel: [], rulers: DEF_RULERS.slice(), forts: [], regs: [], res: R4().map(() => ({ foot: 0, horse: 0, guns: 0 })), auto: [true, true, true, true] };
  }
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const mat4 = (m, d) => R4().map(i => R4().map(j => num(m && m[i] && m[i][j], d[i][j])));
  function fromSave(s) {
    const w = blank(); if (!s || typeof s !== 'object') return w;
    w.t = num(s.t, w.t); w.rel = mat4(s.rel, w.rel); w.war = mat4(s.war, w.war).map(r => r.map(v => v ? 1 : 0)); w.ally = mat4(s.ally, w.ally).map(r => r.map(v => v ? 1 : 0)); w.ws = mat4(s.ws, w.ws);
    if (Array.isArray(s.news)) w.news = s.news.filter(n => n && typeof n.msg === 'string').slice(0, 40).map(n => ({ d: num(n.d, 1), msg: n.msg.slice(0, 300) }));
    if (Array.isArray(s.ai)) s.ai.slice(0, 4).forEach((a, k) => { if (!a) return; const A = w.ai[k]; if (PERS[a.pers]) A.pers = a.pers; A.mil = clamp(num(a.mil, A.mil), 10, 140); A.stab = clamp(num(a.stab, A.stab), 5, 100); if (typeof a.goal === 'string') A.goal = a.goal.slice(0, 80); A.grudge = R4().map(j => num(a.grudge && a.grudge[j], 0)); A.trust = R4().map(j => num(a.trust && a.trust[j], 0)); A.age = num(a.age, A.age); });
    const g = s.gov || {}; for (const f of ['tax', 'treasury', 'appr', 'fest']) if (Array.isArray(g[f])) w.gov[f] = R4().map(k => num(g[f][k], w.gov[f][k]));
    for (const f of ['pol', 'proj']) if (Array.isArray(g[f])) w.gov[f] = R4().map(k => { const o = {}; const src = g[f][k] || {}; for (const key of Object.keys(src).slice(0, 20)) if (typeof src[key] === 'number' || typeof src[key] === 'boolean') o[key.slice(0, 20)] = src[key]; return o; });
    if (Array.isArray(s.treaties)) w.treaties = s.treaties.filter(q => q && q.a >= 0 && q.a < 4 && q.b >= 0 && q.b < 4 && typeof q.type === 'string').slice(0, 30).map(q => ({ a: q.a, b: q.b, type: q.type.slice(0, 10), until: num(q.until, 0) }));
    if (Array.isArray(s.occ)) for (const [i, k] of s.occ) if (TOWNS[i] && k >= 0 && k < 4) w.occ[i] = k;
    if (Array.isArray(s.ruins)) for (const [i, v] of s.ruins) if (TOWNS[i] && v > 0) w.ruin[i] = clamp(+v, 0, 1);
    if (Array.isArray(s.rebels)) w.rebel = s.rebels.filter(i => TOWNS[i]);
    if (Array.isArray(s.rulers)) w.rulers = R4().map(k => typeof s.rulers[k] === 'string' ? s.rulers[k].slice(0, 60) : DEF_RULERS[k]);
    if (Array.isArray(s.forts)) w.forts = s.forts.filter(f => f && f.k >= 0 && f.k < 4 && Number.isFinite(f.x)).slice(0, 12).map(f => ({ k: f.k, x: f.x, z: f.z, name: String(f.name || 'Fort').slice(0, 40) }));
    if (Array.isArray(s.regs)) w.regs = s.regs.filter(r => r && r.k >= 0 && r.k < 4 && FIELD[r.type || 'foot']).map(r => cleanReg(r));
    if (Array.isArray(s.res)) s.res.slice(0, 4).forEach((q, k) => { if (q) for (const t of ['foot', 'horse', 'guns']) w.res[k][t] = Math.max(0, Math.round(num(q[t], 0))); });
    if (s.regauto) w.auto = [true, true, true, true];
    return w;
  }
  function cleanReg(r) {
    const type = FIELD[r.type] ? r.type : 'foot';
    const o = r.order && typeof r.order === 'object' ? r.order : { type: 'garrison', town: r.home };
    const ord = o.type === 'siege' || o.type === 'garrison' ? { type: o.type, town: TOWNS[o.town] ? o.town : capOf(r.k).i } : o.type === 'move' && Number.isFinite(o.x) ? { type: 'move', x: o.x, z: o.z } : { type: 'hold' };
    const cmd = r.cmd && typeof r.cmd === 'object' ? { name: String(r.cmd.name || '').slice(0, 40) || `${pick(FIRST)} ${pick(LAST)}`, rank: String(r.cmd.rank || 'Colonel').slice(0, 20), skill: clamp(num(r.cmd.skill, 2), 1, 5), fame: num(r.cmd.fame, 0), wins: num(r.cmd.wins, 0), losses: num(r.cmd.losses, 0) } : newCmd();
    return { id: Math.round(num(r.id, 0)), k: r.k, type, name: String(r.name || '').slice(0, 40), str: Math.max(0, Math.round(num(r.str, 0))), mor: clamp(num(r.mor, 80), 0, 100), x: num(r.x, 0), z: num(r.z, 0), yaw: num(r.yaw, 0), home: TOWNS[r.home] ? r.home : capOf(r.k).i, order: ord, sieg: clamp(num(r.sieg, 0), 0, 1),
      div: DIVS[type][type === 'foot' && DIVMAP[r.div] ? DIVMAP[r.div] : r.div] ? (type === 'foot' && DIVMAP[r.div] ? DIVMAP[r.div] : r.div) : DIV0[type], form: FORMS.includes(r.form) ? r.form : (type === 'horse' ? 'column' : 'line'), stance: STANCES.includes(r.stance) ? r.stance : 'attack', cmd, busy: false, rout: false, routT: 0 };
  }
  function newCmd() { return { name: `${pick(FIRST)} ${pick(LAST)}`, rank: 'Colonel', skill: 1 + Math.round(rr() * 4), fame: 0, wins: 0, losses: 0 }; }
  const divOf = R => DIVS[R.type][R.div] || DIVS[R.type][DIV0[R.type]];
  function mkCompany(k, t, n, type) {
    const used = W.regs.filter(r => r.k === k).map(r => r.name); let nm = '';
    for (let i = 0; i < 9 && !nm; i++) { const c = `${KN[k]} ${PFX[i] || (i + 1) + 'th'} ${type === 'horse' ? 'Cavalry Troop' : type === 'guns' ? 'Battery' : 'Foot Company'}`; if (!used.includes(c)) nm = c; }
    const R = cleanReg({ id: ++regId, k, type, name: nm, str: n, mor: 80, x: t.x + (rr() - .5) * 20, z: t.z + (rr() - .5) * 20, home: t.i, order: { type: 'garrison', town: t.i } });
    R.cmd = newCmd(); if (type === 'foot') R.div = pick(FOOTMIX); W.regs.push(R); return R;
  }
  function reorg() {
    for (let k = 0; k < 4; k++) for (const ty of ['foot', 'horse', 'guns']) {
      const F = FIELD[ty]; const list = W.regs.filter(r => r.k === k && r.type === ty).sort((a, b) => b.str - a.str);
      let pool = list.reduce((a, r) => a + r.str, 0) + (W.res[k][ty] || 0); const keep = list.slice(0, F.n);
      for (const r of list.slice(F.n)) W.regs.splice(W.regs.indexOf(r), 1);
      for (const r of keep) { r.str = Math.min(F.size, r.str); pool -= r.str; }
      W.res[k][ty] = Math.max(0, pool); for (const r of keep) { const a = Math.min(F.size - r.str, W.res[k][ty]); r.str += a; W.res[k][ty] -= a; }
      while (keep.length < F.n && W.res[k][ty] >= Math.ceil(F.size / 2)) { const n = Math.min(F.size, W.res[k][ty]); W.res[k][ty] -= n; keep.push(mkCompany(k, capOf(k), n, ty)); }
    }
  }
  function initArmies() { // a brand-new world with no saved companies
    for (let k = 0; k < 4; k++) { W.res[k] = { foot: 100, guns: 120, horse: 300 }; }
    reorg();
  }

  // ---------------------------------------------------------------- helpers
  const atWar = (a, b) => a >= 0 && b >= 0 && a !== b && !!W.war[a][b];
  const enemiesOf = k => R4().filter(j => atWar(k, j));
  const ownerT = i => (W.occ[i] !== undefined ? W.occ[i] : TOWNS[i].k);
  const hasTreaty = (a, b, ty) => W.treaties.some(q => q.type === ty && ((q.a === a && q.b === b) || (q.a === b && q.b === a)));
  const human = k => !!(offices[k] && offices[k].monarch);
  const rulerOf = k => human(k) ? `Monarch ${nameOf(offices[k].monarch)}` : W.rulers[k];
  const setRel = (a, b, v) => { W.rel[a][b] = W.rel[b][a] = clamp(v, -100, 100); };
  function placeName(x, z) { let nt = null, nd = 1e9; for (const t of TOWNS) { const d = Math.hypot(t.x - x, t.z - z) - t.r; if (d < nd) { nd = d; nt = t; } } return nd < 40 ? nt.name : `${nt.name} outskirts`; }
  const pending = [];
  function news(msg, cls) { const n = { d: Math.floor(W.t), msg, c: cls || '' }; W.news.unshift(n); if (W.news.length > 40) W.news.pop(); pending.push(n); dirty = true; }
  function setWar(a, b, w) {
    if (!w && W.war[a][b]) peaceReturns(a, b);
    W.war[a][b] = W.war[b][a] = w ? 1 : 0; if (w) W.ally[a][b] = W.ally[b][a] = 0; dirty = true;
  }
  function peaceReturns(a, b) {
    W.ws[a][b] = W.ws[b][a] = 0;
    for (const t of TOWNS) { const o = W.occ[t.i]; if (o === undefined) continue; if ((t.k === a && o === b) || (t.k === b && o === a)) { W.gov.treasury[t.k] = Math.max(0, W.gov.treasury[t.k] - 200); W.gov.treasury[o] += 200; delete W.occ[t.i]; news(`Under the peace, ${t.name} is handed back to ${KN[t.k]}, which pays 200 gold in reparations.`); } }
    for (const R of W.regs) if ((R.k === a || R.k === b) && R.order.type === 'siege') { const t = TOWNS[R.order.town]; if (t.k === a || t.k === b) retreat(R); }
  }
  function occupy(t, k) {
    const was = ownerT(t.i); W.ruin[t.i] = clamp((W.ruin[t.i] || 0) + (was !== t.k && k === t.k ? .2 : .55), 0, 1);
    if (k === t.k) delete W.occ[t.i]; else W.occ[t.i] = k;
    if (W.occ[t.i] !== undefined) { news(`${t.name} falls! The ${KN[k]} flag now flies over the ${t.type} of ${KN[t.k]}.`, 'bad'); W.ai[t.k].stab = Math.max(5, W.ai[t.k].stab - (t.type === 'capital' ? 25 : t.type === 'city' ? 10 : 5)); W.gov.appr[t.k] = Math.max(0, W.gov.appr[t.k] - (t.type === 'capital' ? 15 : 5)); W.ai[t.k].grudge[k] += 10; }
    else news(`${t.name} is liberated by ${KN[k]}!`, 'good');
  }
  function retreat(R) { const own = TOWNS.filter(t => ownerT(t.i) === R.k && mainland(t)); let bt = null, bd = 1e9; for (const t of own) { const d = Math.hypot(t.x - R.x, t.z - R.z); if (d < bd) { bd = d; bt = t; } } if (bt) R.order = { type: 'garrison', town: bt.i }; }
  const garrisonOf = t => ({ village: 120, town: 200, city: 320, capital: 520 }[t.type] || 200) + (W.gov.proj[t.k] && W.gov.proj[t.k].fort ? W.gov.proj[t.k].fort * 120 : 0);
  const kSoldiers = (k, ty) => W.regs.filter(r => r.k === k && (!ty || r.type === ty)).reduce((a, r) => a + r.str, 0) + (ty ? W.res[k][ty] : W.res[k].foot + W.res[k].horse + W.res[k].guns);
  const kRoom = (k, ty) => Math.max(0, CAPS[ty] - kSoldiers(k, ty));
  function regPower(R, foe) {
    const D = divOf(R); let p = (1 + R.cmd.skill * .03) * R.str * (.6 + R.mor / 250) * (.85 + rr() * .3) * (1 + W.ai[R.k].mil / 400) * D[0] / ((foe && divOf(foe)[1]) || 1);
    if (foe && R.type === 'horse' && foe.type === 'guns') p *= 1.3; if (foe && R.type === 'guns' && foe.type === 'foot') p *= 1.15;
    if (W.forts.some(f => f.k === R.k && Math.hypot(f.x - R.x, f.z - R.z) < 95)) p *= 1.6;
    const t = TOWNS.find(t => ownerT(t.i) === R.k && Math.hypot(t.x - R.x, t.z - R.z) < t.r); if (t) p *= 1.25 + (W.gov.proj[R.k].fort || 0) * .15; return p;
  }
  function target(R) {
    const o = R.order; if (o.type === 'garrison' || o.type === 'siege') { const t = TOWNS[o.town]; return { x: t.x, z: t.z, r: o.type === 'siege' ? t.r * .7 : t.r * .4 }; }
    if (o.type === 'move') return { x: o.x, z: o.z, r: 12 };
    if (o.type === 'follow') { const S = online.get(o.uid); if (S && Number.isFinite(S.x)) return { x: S.x, z: S.z, r: 14 }; R.order = { type: 'hold' }; } return null;
  }

  // ---------------------------------------------------------------- the companies, every second
  function stepRegs(dt) {
    for (const R of W.regs) {
      R.moving = false; if (R.busy && !R.rout) { const F = R.foeR; if (!F || R.stance !== 'attack' || R.type === 'guns') continue; const want = divOf(R)[0] > 1.2 ? 4 : 38; const dx = F.x - R.x, dz = F.z - R.z, d = Math.hypot(dx, dz); if (d <= want) continue; const sp = 3 * divOf(R)[2] * dt; R.x += dx / d * Math.min(sp, d - want); R.z += dz / d * Math.min(sp, d - want); R.moving = true; continue; }
      const tg = target(R); if (!tg) continue; const dx = tg.x - R.x, dz = tg.z - R.z, d = Math.hypot(dx, dz);
      if (d < tg.r) { if (R.order.type === 'move') R.order = { type: 'hold' }; continue; }
      const base = 3.2 * (R.type === 'horse' ? 1.7 : R.type === 'guns' ? .8 : 1); const sp = base * divOf(R)[2] * (R.mor > 40 || R.rout ? 1 : .75) * (R.rout ? 1.4 : 1) * dt;
      R.x += dx / d * Math.min(sp, d); R.z += dz / d * Math.min(sp, d); R.yaw = Math.atan2(dx, dz); R.moving = true;
    }
  }
  const shaken = R => R.lastRout !== undefined && W.t - R.lastRout < .25 && R.str < FIELD[R.type].size * .6; // regrouping after a rout: out of the fight
  function casualty(R, n) { R.str = Math.max(0, R.str - n); R.mor = Math.max(0, R.mor - n * 3.2 / (R.div === 'guard' ? 1.7 : 1)); dirty = true; }
  function rout(R, Wn) {
    if (R.rout) return; R.rout = true; R.lastRout = W.t; R.routT = 45; R.busy = false; retreat(R); if (R.str > 0) news(`The ${R.name} break and flee${Wn ? ` from the ${Wn.name}` : ''}! ${R.str} of them get away.`, 'bad');
    if (Wn) { Wn.cmd.wins++; Wn.cmd.fame += 4; R.cmd.losses++; W.ws[Wn.k][R.k] += 4; Wn.mor = Math.min(100, Wn.mor + 8); W.ai[R.k].stab = Math.max(5, W.ai[R.k].stab - 2); setRel(Wn.k, R.k, W.rel[Wn.k][R.k] - 3);
      each(S => { if (S.mil && S.mil.army === Wn.k && !S.inside && Number.isFinite(S.x) && Math.hypot(S.x - R.x, S.z - R.z) < 220) { if (changeGold) changeGold(S.id, 40, 'battle', 'rout:' + R.id + ':' + Math.floor(W.t * 100)).catch(() => {}); send(S, { t: 'wwin', id: Wn.id, foe: R.name, gold: 40 }); } }); }
  }
  function battles(dt) {
    for (const R of W.regs) {
      if (R.rout) { R.routT -= dt; R.busy = false; if (R.routT <= 0) { R.rout = false; R.mor = Math.max(R.mor, 45); } continue; }
      if (shaken(R)) { R.busy = false; R.foeR = null; continue; }
      let foe = null, fd = 1e9; for (const O of W.regs) { if (O === R || O.rout || shaken(O) || !atWar(R.k, O.k)) continue; const d = Math.hypot(O.x - R.x, O.z - R.z); if (d < fd) { fd = d; foe = O; } }
      const was = R.busy; R.busy = !!foe && fd < 95 && R.stance !== 'hold'; R.foeR = R.busy ? foe : null;
      if (!R.busy) continue;
      R.yaw = Math.atan2(foe.x - R.x, foe.z - R.z);
      const ck = Math.min(R.id, foe.id) + ':' + Math.max(R.id, foe.id); if (!was && !(clashes.get(ck) > W.t - .2)) { clashes.set(ck, W.t); news(`The ${R.name} and the ${foe.name} clash near ${placeName((R.x + foe.x) / 2, (R.z + foe.z) / 2)}!`, 'bad'); }
      const pa = regPower(R, foe), pb = regPower(foe, R); const lam = .045 * foe.str * (pb / (pa + pb)) * 2 * dt * (fd < 60 ? 1 : .5);
      const n = Math.floor(lam) + (rr() < lam % 1 ? 1 : 0); if (n) casualty(R, n);
      if (R.str <= FIELD[R.type].size * .3 || R.mor < 18) rout(R, foe);
    }
  }
  function regsTick() { // once a second: sieges, reserves, re-forming, AI orders
    for (const R of W.regs) {
      if (R.busy || R.rout) continue; const o = R.order;
      if (o.type === 'siege') {
        const t = TOWNS[o.town]; const own = ownerT(t.i); const reb = W.rebel.includes(t.i) && own === R.k;
        if (own === R.k && !reb) { R.order = { type: 'garrison', town: t.i }; R.sieg = 0; continue; }
        if (!reb && !atWar(R.k, own)) { retreat(R); R.sieg = 0; continue; }
        if (Math.hypot(t.x - R.x, t.z - R.z) < t.r * .8 + 30) {
          const gar = garrisonOf(t) / 6; const blocked = !reb && W.regs.some(o2 => o2.k === own && !o2.busy && !o2.rout && Math.hypot(o2.x - t.x, o2.z - t.z) < t.r);
          if (!blocked && reb) { R.sieg += R.str / gar / 30; if (R.sieg >= 1) { R.sieg = 0; W.rebel = W.rebel.filter(i => i !== t.i); W.ruin[t.i] = clamp((W.ruin[t.i] || 0) + .25, 0, 1); W.ai[t.k].stab = Math.min(100, W.ai[t.k].stab + 8); news(`The rebellion in ${t.name} is crushed. ${KN[t.k]}'s flag flies again.`, 'good'); R.order = { type: 'garrison', town: t.i }; } continue; }
          if (!blocked) { R.sieg += R.str / gar / 40 * (R.type === 'guns' ? 2.5 * (R.div === 'siege' ? 2 : 1) : 1); if (rr() < .04) casualty(R, 1); if (rr() < .05) W.ruin[t.i] = clamp((W.ruin[t.i] || 0) + .01, 0, 1);
            if (R.sieg >= 1) { R.sieg = 0; const was = own; occupy(t, R.k); W.ws[R.k][was] = (W.ws[R.k][was] || 0) + (t.type === 'capital' ? 25 : 10); R.order = { type: 'garrison', town: t.i }; } }
        }
      } else R.sieg = Math.max(0, R.sieg - .02);
      const home = TOWNS.find(t => ownerT(t.i) === R.k && Math.hypot(t.x - R.x, t.z - R.z) < t.r * 1.2);
      if (home) { R.mor = Math.min(100, R.mor + .3); if (R.str < FIELD[R.type].size && W.res[R.k][R.type] > 0 && rr() < .25) { W.res[R.k][R.type]--; R.str++; } }
    }
    for (let i = W.regs.length - 1; i >= 0; i--) { const R = W.regs[i]; if (R.str >= 1) continue; const t = TOWNS[R.home] || capOf(R.k); const sz = FIELD[R.type].size;
      if (W.res[R.k][R.type] >= Math.ceil(sz / 2)) { const n = Math.min(sz, W.res[R.k][R.type]); W.res[R.k][R.type] -= n; Object.assign(R, { str: n, x: t.x, z: t.z, rout: false, busy: false, mor: 60, order: { type: 'garrison', town: t.i } }); news(`The ${R.name} is wiped out, but ${n} fresh soldiers from the reserves re-form it at ${t.name}.`); }
      else { news(`The ${R.name} is destroyed. ${KN[R.k]} has no reserves left to re-form it.`, 'bad'); W.regs.splice(i, 1); leads.delete(R.id); } }
  }
  function regAI(k) {
    const mine = W.regs.filter(r => r.k === k && !r.busy && !r.rout && !leads.has(r.id)); if (!mine.length) { enlist(k, 40); return; }
    const cap = capOf(k); const guard = mine.find(r => r.order.type === 'garrison' && r.order.town === cap.i) || mine.slice().sort((a, b) => Math.hypot(a.x - cap.x, a.z - cap.z) - Math.hypot(b.x - cap.x, b.z - cap.z))[0];
    if (guard) guard.order = { type: 'garrison', town: cap.i };
    const en = enemiesOf(k); const lost = TOWNS.filter(t => (t.k === k && W.occ[t.i] !== undefined && atWar(k, W.occ[t.i])) || (t.k === k && W.rebel.includes(t.i) && W.occ[t.i] === undefined));
    for (const R of mine) {
      if (R === guard) continue; if (R.str < FIELD[R.type].size * .45) { retreat(R); continue; }
      const threat = W.regs.find(o => atWar(k, o.k) && TOWNS.some(t => ownerT(t.i) === k && Math.hypot(t.x - o.x, t.z - o.z) < 500));
      if (lost.length && R.order.type !== 'siege') { const t = lost.sort((a, b) => Math.hypot(a.x - R.x, a.z - R.z) - Math.hypot(b.x - R.x, b.z - R.z))[0]; R.order = { type: 'siege', town: t.i }; continue; }
      if (threat && rr() < .6) { R.order = { type: 'move', x: threat.x, z: threat.z }; continue; }
      if (en.length && R.order.type !== 'siege' && rr() < .5 + PERS[W.ai[k].pers].agg * .4) { const tg = TOWNS.filter(t => en.includes(ownerT(t.i)) && mainland(t)).sort((a, b) => (Math.hypot(a.x - R.x, a.z - R.z) + (a.type === 'capital' ? 900 : 0)) - (Math.hypot(b.x - R.x, b.z - R.z) + (b.type === 'capital' ? 900 : 0)))[0]; if (tg) R.order = { type: 'siege', town: tg.i }; continue; }
      if (!en.length && R.order.type !== 'garrison') R.order = { type: 'garrison', town: R.home };
    }
    if (kRoom(k, 'foot') + kRoom(k, 'horse') + kRoom(k, 'guns') >= 20 && rr() < .3 + (en.length ? .3 : 0)) enlist(k, 40);
  }
  function enlist(k, n, ty) {
    const Pp = PERS[W.ai[k].pers]; const order = Pp.agg > .6 ? ['horse', 'guns', 'foot'] : ['foot', 'horse', 'guns'];
    ty = ty || order.find(t => kRoom(k, t) >= 10 && W.res[k][t] < FIELD[t].size * 3) || order.find(t => kRoom(k, t) >= 5); if (!ty) return 0;
    n = Math.min(n, kRoom(k, ty)); const c = n * UNITCOST[ty]; if (n < 1 || W.gov.treasury[k] < c) return 0; W.gov.treasury[k] -= c; W.res[k][ty] += n;
    if (W.regs.filter(r => r.k === k && r.type === ty).length < FIELD[ty].n && W.res[k][ty] >= Math.ceil(FIELD[ty].size / 2)) { const m = Math.min(FIELD[ty].size, W.res[k][ty]); W.res[k][ty] -= m; const R = mkCompany(k, capOf(k), m, ty); news(`${KN[k]} raises the ${R.name}.`); }
    dirty = true; return n;
  }

  // ---------------------------------------------------------------- the morning: economy, diplomacy, AI courts
  function govDay() {
    for (let k = 0; k < 4; k++) {
      const pl = W.gov.pol[k] || {}, pj = W.gov.proj[k] || {}; const m = { inc: .1 * (pj.roads || 0), appr: pj.monument ? 8 : 0, stab: 0, mil: 0, rel: 0, cost: 0 };
      for (const id in pl) if (pl[id] && POL[id]) for (const f in POL[id]) m[f] += POL[id][f];
      const base = TOWNS.filter(t => ownerT(t.i) === k && !W.rebel.includes(t.i)).reduce((a, t) => a + (TBASE[t.type] || 0) * (1 - (W.ruin[t.i] || 0) * .6), 0);
      const inc = Math.round(base * W.gov.tax[k] / 10 * W.gov.appr[k] / 100 * (1 + m.inc)); const upkeep = Math.round(W.ai[k].mil * 2.4);
      W.gov.treasury[k] += inc - m.cost - upkeep; if (W.gov.treasury[k] < 0) { W.gov.treasury[k] = 0; W.ai[k].stab = Math.max(5, W.ai[k].stab - 5); }
      const target = clamp(92 - W.gov.tax[k] * 1.9 + W.gov.fest[k] + m.appr + (W.ai[k].stab - 50) * .1, 5, 100); W.gov.appr[k] += (target - W.gov.appr[k]) * .4; W.gov.fest[k] *= .6;
      const st = 50 + (W.gov.appr[k] - 50) * .6 - enemiesOf(k).length * 8 + m.stab * 5 + (W.gov.treasury[k] <= 0 ? -15 : 0); W.ai[k].stab = clamp(W.ai[k].stab + (st - W.ai[k].stab) * .15, 5, 100);
      W.ai[k].mil = clamp(W.ai[k].mil + (40 - W.ai[k].mil) * .035 + m.mil + (pj.navy || 0) * .4, 10, 140);
      if (m.rel) for (let j = 0; j < 4; j++) if (j !== k) setRel(k, j, W.rel[k][j] + m.rel);
      if (W.ai[k].stab < 20 && rr() < .4) { news(`Unrest grips ${KN[k]}. Mobs gather outside the palace of ${rulerOf(k)}.`, 'bad'); W.gov.appr[k] = Math.max(0, W.gov.appr[k] - 6); }
    }
  }
  function politicsDay() {
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      let r = W.rel[i][j] + (rr() - .5) * 12; if (atWar(i, j)) r += 6; if (W.ally[i][j]) r += 2;
      if (!atWar(i, j) && rr() < .13) { r -= 12 + rr() * 14; news(pick(INCID)(rr() < .5 ? i : j, rr() < .5 ? j : i), 'bad'); } else if (rr() < .07) { r += 10 + rr() * 10; news(pick(GOODW)(i, j), 'good'); }
      setRel(i, j, r); r = W.rel[i][j]; const hum = human(i) || human(j);
      if (!atWar(i, j) && r < -70 && rr() < .25 && !hasTreaty(i, j, 'pact')) { if (hum && !(r < -80 && rr() < .5)) news(`${KN[human(i) ? j : i]} masses troops on the border of ${KN[human(i) ? i : j]}.`, 'bad'); else { setWar(i, j, 1); news(`${KN[i]} declares war on ${KN[j]}!`, 'bad'); } }
      else if (atWar(i, j) && r > -15 && rr() < .45) { if (hum) news(`${KN[human(i) ? j : i]} sends envoys asking for peace with ${KN[human(i) ? i : j]}.`); else { setWar(i, j, 0); news(`${KN[i]} and ${KN[j]} sign a peace treaty.`, 'good'); } }
      if (!hum && !atWar(i, j) && r > 65 && !W.ally[i][j] && rr() < .3) { W.ally[i][j] = W.ally[j][i] = 1; news(`${KN[i]} and ${KN[j]} form an alliance.`, 'good'); }
      if (W.ally[i][j] && r < 25) { W.ally[i][j] = W.ally[j][i] = 0; news(`The alliance between ${KN[i]} and ${KN[j]} collapses.`, 'bad'); }
    }
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (W.ally[a][b]) for (let c = 0; c < 4; c++) if (c !== a && atWar(b, c) && !atWar(a, c) && !human(a) && rr() < .25) { setWar(a, c, 1); setRel(a, c, W.rel[a][c] - 25); news(`${KN[a]} joins its ally ${KN[b]} in the war against ${KN[c]}!`, 'bad'); }
  }
  function aiDay() {
    for (let k = 0; k < 4; k++) {
      const A = W.ai[k], Pp = PERS[A.pers]; for (let j = 0; j < 4; j++) { A.grudge[j] *= .93; A.trust[j] *= .97; }
      if (human(k)) { A.goal = `Awaiting the commands of ${rulerOf(k)}`; continue; }
      const ap = W.gov.appr[k]; if (ap < 45 && W.gov.tax[k] > 5) W.gov.tax[k] -= 5; else if (W.gov.treasury[k] < 900 && ap > 58 && W.gov.tax[k] < 30) W.gov.tax[k] += 5;
      if (ap < 52 && W.gov.treasury[k] > 700 && rr() < .6) { W.gov.treasury[k] -= 400; W.gov.fest[k] += 30; W.gov.appr[k] = Math.min(100, ap + 12); news(`${rulerOf(k)} of ${KN[k]} holds a grand festival.`); }
      const threat = Math.max(0, ...R4().filter(j => j !== k).map(j => (atWar(k, j) ? 60 : 0) + Math.max(0, -W.rel[k][j]) * .5));
      const milT = 45 + Pp.agg * 35 + (enemiesOf(k).length ? 25 : 0) + Math.max(0, threat - 30) * .3; if (A.mil < milT && W.gov.treasury[k] > 1200 && rr() < .45 + Pp.agg * .3) { W.gov.treasury[k] -= 800; A.mil = Math.min(140, A.mil + 12); }
      const acts = [];
      for (let j = 0; j < 4; j++) {
        if (j === k) continue; const r = W.rel[k][j], war = atWar(k, j), ratio = A.mil / Math.max(10, W.ai[j].mil);
        if (!war && !hasTreaty(k, j, 'pact') && r < -40) acts.push({ u: Pp.agg * (ratio - .9) * 2 + (-r - 40) / 60 + A.grudge[j] * .02 - .2, f: () => { setWar(k, j, 1); setRel(k, j, W.rel[k][j] - 10); A.goal = `At war with ${KN[j]}`; news(`${rulerOf(k)} of ${KN[k]} declares war on ${KN[j]}!`, 'bad'); for (let a = 0; a < 4; a++) if (a !== k && a !== j && W.ally[a][j] && !human(a) && rr() < .6) { setWar(a, k, 1); news(`${KN[a]} honours its alliance and joins the war against ${KN[k]}.`, 'bad'); } } });
        if (war) acts.push({ u: (1 - ratio) * 1.6 + (W.gov.treasury[k] < 500 ? .6 : 0) + (A.stab < 40 ? .6 : 0) + Pp.dip * .35 - .35 - A.grudge[j] * .01 + TOWNS.filter(t => t.k === k && W.occ[t.i] === j).length * .25, f: () => { if (human(j)) { news(`${KN[k]} offers peace to ${KN[j]}. ${rulerOf(j)} may accept at the embassy.`); A.goal = `Seeking peace with ${KN[j]}`; } else if (rr() < (W.rel[k][j] + 100) / 200 * .7 + .25) { setWar(k, j, 0); setRel(k, j, W.rel[k][j] + 15); news(`Peace! ${KN[k]} and ${KN[j]} sign a treaty. The war is over.`, 'good'); } else news(`Peace talks between ${KN[k]} and ${KN[j]} collapse without agreement.`, 'bad'); } });
        if (!war && r > 35 && !W.ally[k][j] && !human(j)) acts.push({ u: Pp.dip * .6 + (r - 35) / 80 - .3, f: () => { if (rr() < (r + 100) / 200 * .7 + .15) { W.ally[k][j] = W.ally[j][k] = 1; setRel(k, j, r + 12); news(`${KN[k]} and ${KN[j]} form an alliance!`, 'good'); } } });
        if (!war && r > -10 && !hasTreaty(k, j, 'trade') && !human(j)) acts.push({ u: Pp.greed * .7 + Pp.dip * .2 - .25 + rr() * .2, f: () => { if (rr() < (r + 100) / 200 * .7 + .15) { W.treaties.push({ a: k, b: j, type: 'trade', until: Math.floor(W.t) + 12 }); setRel(k, j, r + 8); news(`${KN[k]} and ${KN[j]} sign a trade treaty.`, 'good'); } } });
        if (!war && r < -15 && r > -55 && !hasTreaty(k, j, 'pact') && !human(j)) acts.push({ u: Pp.caut * .5 + Pp.dip * .2 - .25 + rr() * .2, f: () => { if (rr() < (r + 100) / 200 * .7 + .15) { W.treaties.push({ a: k, b: j, type: 'pact', until: Math.floor(W.t) + 15 }); setRel(k, j, r + 10); news(`${KN[k]} and ${KN[j]} sign a non-aggression pact. Neither may declare war for fifteen days.`, 'good'); } } });
        if (!war && r < 20 && r > -60 && W.gov.treasury[k] > 1600) acts.push({ u: Pp.dip * .7 - .25 + rr() * .15, f: () => { W.gov.treasury[k] -= 300; setRel(k, j, W.rel[k][j] + 10); W.ai[j].trust[k] += 3; news(`${KN[k]} sends gifts of silver and cheese to the court of ${KN[j]}.`, 'good'); } });
      }
      acts.sort((a, b) => b.u - a.u); const best = acts[0]; if (best && best.u > .2 + rr() * .3) best.f(); else if (!enemiesOf(k).length) A.goal = pick(['Building up trade', 'Strengthening the army', 'Keeping the people fed', 'Watching the other courts']);
    }
  }
  function miscDay() {
    const d = Math.floor(W.t);
    for (let i = W.treaties.length - 1; i >= 0; i--) { const q = W.treaties[i]; if (q.until < d) { W.treaties.splice(i, 1); news(`The ${q.type === 'trade' ? 'trade treaty' : q.type === 'pact' ? 'non-aggression pact' : 'accord'} between ${KN[q.a]} and ${KN[q.b]} has expired.`); } else if (q.type === 'trade') setRel(q.a, q.b, W.rel[q.a][q.b] + 2); }
    for (let k = 0; k < 4; k++) { const A = W.ai[k]; A.age = (A.age || 45) + 1 / 12; if (human(k)) continue; const risk = Math.max(0, (A.age - 62) * .004) + .0015 + (A.stab < 20 ? .004 : 0);
      if (rr() < risk) { const old = W.rulers[k]; const heir = `${old.split(' ')[0]} ${pick(FIRST)} ${old.split(' ').slice(2).join(' ') || pick(LAST)}`; W.rulers[k] = heir; A.age = 22 + rr() * 20; A.stab = Math.max(5, A.stab - 15); if (rr() < .4) A.pers = pick(Object.keys(PERS)); news(`${old} of ${KN[k]} has died. Long live ${heir}!`, 'bad'); } }
    for (let k = 0; k < 4; k++) { if (!(W.ai[k].stab < 18 || W.gov.appr[k] < 18) || rr() > .25) continue; const c = TOWNS.filter(t => t.k === k && t.type !== 'capital' && mainland(t) && !W.rebel.includes(t.i) && W.occ[t.i] === undefined); if (!c.length) continue; const t = pick(c); W.rebel.push(t.i); news(`Rebels seize ${t.name}! ${KN[k]} has lost control of the town.`, 'bad'); }
    for (const i of Object.keys(W.ruin)) { const t = TOWNS[i]; const own = ownerT(+i); let rec = .02; if (own >= 0 && !human(own) && W.gov.treasury[own] > 2000) { W.gov.treasury[own] -= 200; rec += .06; } W.ruin[i] = Math.max(0, W.ruin[i] - rec); if (W.ruin[i] < .05) { delete W.ruin[i]; news(`${t.name} has been rebuilt. Fresh timber and new roofs shine in the sun.`, 'good'); } }
    if (rr() < .3) { const k = Math.floor(rr() * 4); const T = pick(TOWNS.filter(t => t.k === k && mainland(t))); if (T) { const ev = rr(); if (ev < .4) { W.gov.treasury[k] = Math.max(0, W.gov.treasury[k] - 120); news(`Iron Fang saboteurs set fire to a League supply depot near ${T.name}.`, 'bad'); } else if (ev < .75) { W.ai[k].stab = Math.max(5, W.ai[k].stab - 3); news(`Iron Fang pamphlets calling for the League's destruction turn up in ${T.name}.`, 'bad'); } else { for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) setRel(i, j, W.rel[i][j] + 2); news('Shaken by Iron Fang attacks, the four crowns pledge to stand together in the League of Kingdoms.', 'good'); } } }
    for (let k = 0; k < 4; k++) { if (human(k) || W.gov.treasury[k] < 4500 || W.forts.filter(f => f.k === k).length >= 2 || rr() > .12 + PERS[W.ai[k].pers].caut * .1) continue; const en = enemiesOf(k); if (!en.length) continue; const ec = capOf(en[0]); const own = TOWNS.filter(t => t.k === k && mainland(t)).sort((a, b) => Math.hypot(a.x - ec.x, a.z - ec.z) - Math.hypot(b.x - ec.x, b.z - ec.z))[0]; if (!own) continue; const dx = ec.x - own.x, dz = ec.z - own.z, dl = Math.hypot(dx, dz) || 1; W.gov.treasury[k] -= 1500; W.forts.push({ k, x: own.x + dx / dl * (own.r + 90), z: own.z + dz / dl * (own.r + 90), name: `Fort ${pick(LAST)}` }); news(`${KN[k]} builds a new fort facing ${KN[en[0]]}.`); }
  }
  function newDay() { govDay(); politicsDay(); aiDay(); miscDay(); dirty = true; broadcastState(); }

  // ---------------------------------------------------------------- sending the world to browsers
  const regView = R => [R.id, R.k, R.type, R.name, R.str, Math.round(R.mor), Math.round(R.x * 10) / 10, Math.round(R.z * 10) / 10, Math.round((R.yaw || 0) * 100) / 100, R.order, R.busy ? 1 : 0, R.rout ? 1 : 0, R.div, R.form, R.stance, leads.has(R.id) ? nameOf(leads.get(R.id)) : '', R.home, Math.round(R.sieg * 100) / 100, R.moving ? 1 : 0, R.cmd.rank + ' ' + R.cmd.name];
  function stateMsg() { return { t: 'wstate', w: { t: W.t, rel: W.rel, war: W.war, ally: W.ally, ws: W.ws, news: W.news, ai: W.ai.map(a => ({ pers: a.pers, mil: a.mil, stab: a.stab, goal: a.goal, grudge: a.grudge, trust: a.trust })), gov: W.gov, treaties: W.treaties, occ: W.occ, ruin: W.ruin, rebel: W.rebel, rulers: R4().map(rulerOf), forts: W.forts, res: W.res, auto: W.auto } }; }
  function broadcastState() { const m = stateMsg(); each(S => send(S, m)); }
  function regsMsg() { return { t: 'wregs', t0: W.t, regs: W.regs.map(regView) }; }
  let syncT = 0, aiT = 0, secT = 0, stateT = 0, rosT = 0;
  function tick(dt) {
    if (!W) return; W.t += dt / DAYLEN; const day = Math.floor(W.t);
    if (day > lastDay) { lastDay = day; try { newDay(); } catch (e) { log('world day error', e.stack || e.message); } }
    stepRegs(dt); battles(dt);
    secT += dt; if (secT >= 1) { secT = 0; regsTick(); }
    aiT += dt; if (aiT >= 15) { aiT = 0; for (let k = 0; k < 4; k++) if (W.auto[k]) regAI(k); }
    syncT += dt; if (syncT >= 1) { syncT = 0; const m = regsMsg(); each(S => send(S, m)); if (pending.length) { const n = { t: 'wnews', items: pending.splice(0) }; each(S => send(S, n)); } }
    stateT += dt; if (stateT >= 20 || (dirty && stateT >= 3)) { stateT = 0; broadcastState(); }
    rosT += dt; if (rosT >= 1) { rosT = 0; milTick(); }
    if (Date.now() - lastSave > 60000) save();
  }
  async function save() {
    lastSave = Date.now(); if (!W) return; dirty = false;
    const data = { ...W, regs: W.regs.map(r => ({ ...r, foeR: undefined })) };
    try { await db.insert('world_state', { id: 1, data, updated_at: new Date().toISOString() }, { upsert: true, onConflict: 'id', returning: false }); if (!saveOk) log('world saved again'); saveOk = true; }
    catch (e) { if (saveOk) log('could not save the shared world (did you run supabase/world.sql?):', e.message); saveOk = false; }
  }
  async function init() {
    let row = null; try { row = await db.one('world_state', { where: { id: 1 } }); } catch (e) { log('world_state table missing — run supabase/world.sql. The shared world runs in memory until then.'); }
    if (row && row.data && row.data.v === 1) { W = row.data; W.regs = (W.regs || []).map(cleanReg); W.news = W.news || []; W.auto = W.auto || [true, true, true, true]; log(`shared world loaded: day ${Math.floor(W.t)}, ${W.regs.length} companies`); }
    else {
      let seed = null; try { const rows = await db.select('characters', { columns: 'name,save', where: { name: { op: 'ilike', value: SEED } }, limit: 5 }); seed = rows.find(c => String(c.name || '').toLowerCase() === SEED); } catch (e) { log('could not look up the seed character:', e.message); }
      W = fromSave(seed && seed.save); log(seed ? `shared world seeded from ${seed.name}'s game: day ${Math.floor(W.t)}, ${W.regs.length} companies` : 'shared world started fresh (no seed character found)');
      if (!W.regs.length) initArmies();
      news(seed ? `The four crowns now share one chronicle. The realm of ${seed.name} becomes the realm of all.` : 'A new chronicle of the four crowns begins.', 'gold');
      regId = W.regs.reduce((a, r) => Math.max(a, r.id), 0); reorg(); await save();
    }
    regId = W.regs.reduce((a, r) => Math.max(a, r.id), 0); reorg(); lastDay = Math.floor(W.t);
    milInit();
  }

  // ---------------------------------------------------------------- requests from players, checked here
  function scope(S) {
    if (S.admin) return { k: S.mil ? S.mil.army : S.char.kingdom, max: 99, full: true, recruit: true };
    for (let k = 0; k < 4; k++) if (offices[k].monarch === S.id) return { k, max: 99, full: true, recruit: true, monarch: true };
    for (let k = 0; k < 4; k++) if (offices[k].marshal === S.id) return { k, max: 99, full: true, recruit: true };
    if (S.mil && S.mil.rank >= 7) { const r = S.mil.rank; return { k: S.mil.army, max: r >= 10 ? 99 : [1, 2, 4][r - 7], full: r >= 11, recruit: r >= 10 }; }
    return null;
  }
  const ledBy = uid => [...leads.entries()].filter(([, u]) => u === uid).map(([id]) => id);
  const canCtl = (S, R, sc) => !!sc && R.k === sc.k && (sc.max >= 99 || leads.get(R.id) === S.id);
  const ok = (S, msg) => { if (msg) toast(S, msg, 'gold'); dirty = true; send(S, regsMsg()); };
  // the crown's business: who may do what is decided here, from the offices the server keeps
  function govRole(S, k) {
    if (!(k >= 0 && k < 4)) return 0; if (S.admin || offices[k].monarch === S.id) return 2;
    if (offices[k].chancellor === S.id || offices[k].treasurer === S.id) return 1; return 0;
  }
  function govCmd(S, m) {
    const k = Math.round(+m.gk), j = Math.round(+m.k), a = String(m.a || ''); const role = govRole(S, k);
    const crown = ['war', 'peace', 'ally', 'unally', 'gift', 'insult', 'tribute', 'sab'];
    if (!role) return err(S, 'Only the Monarch, the Chancellor, the Treasurer or an admin can do that.');
    if (crown.includes(a) && role < 2) return err(S, 'War, peace and alliances belong to the crown.');
    if (crown.includes(a) && (!(j >= 0 && j < 4) || j === k)) return;
    const T = W.gov.treasury; const pay = c => { if (T[k] < c) { err(S, `The treasury needs ${c} gold.`); return false; } T[k] -= c; return true; };
    if (a === 'tax') W.gov.tax[k] = clamp(Math.round(+m.v / 5) * 5, 0, 40);
    else if (a === 'pol') { if (!POL[m.id]) return; W.gov.pol[k][m.id] = !W.gov.pol[k][m.id]; news(`${KN[k]} ${W.gov.pol[k][m.id] ? 'enacts' : 'repeals'} a law: ${m.id === 'freetrade' ? 'free trade' : m.id === 'borders' ? 'closed borders' : m.id === 'martial' ? 'martial law' : m.id}.`); }
    else if (a === 'proj') { const c = PROJ[m.id]; if (!c) return; const lv = W.gov.proj[k][m.id] || 0; if (lv >= c.length) return; if (!pay(c[lv])) return; W.gov.proj[k][m.id] = lv + 1; news(`${KN[k]} completes a great work: ${m.id}${c.length > 1 ? ' (level ' + (lv + 1) + ')' : ''}.`, 'gold'); }
    else if (a === 'recruit') { if (!pay(800)) return; W.ai[k].mil = Math.min(140, W.ai[k].mil + 12); toast(S, 'New regiments are raised: +12 strength.', 'gold'); }
    else if (a === 'fest') { if (!pay(400)) return; W.gov.fest[k] += 30; W.gov.appr[k] = Math.min(100, W.gov.appr[k] + 15); news(`A grand parade fills the streets of ${KN[k]}!`, 'good'); }
    else if (a === 'gift') { if (!pay(300)) return; setRel(k, j, W.rel[k][j] + 12); W.ai[j].trust[k] += 4; news(`${KN[k]} sends lavish gifts to the court of ${KN[j]}.`, 'good'); }
    else if (a === 'insult') { setRel(k, j, W.rel[k][j] - 15); W.ai[j].grudge[k] += 8; news(`${rulerOf(k)} publicly insults the court of ${KN[j]}.`, 'bad'); }
    else if (a === 'sab') { if ((W.gov.proj[k].spies || 0) < 2) return err(S, 'You need a level 2 spy network.'); if (!pay(600)) return; if (rr() < .25) { setRel(k, j, W.rel[k][j] - 18); W.ai[j].grudge[k] += 12; news(`Saboteurs of ${KN[k]} are caught in ${capOf(j).name}! ${rulerOf(j)} demands answers.`, 'bad'); } else { W.ai[j].mil = Math.max(10, W.ai[j].mil - 12); toast(S, `Your agents set fire to ${KN[j]}'s powder stores. Their strength falls by 12.`, 'gold'); } }
    else if (a === 'tribute') { if (atWar(k, j)) return; const ratio = W.ai[k].mil / Math.max(10, W.ai[j].mil); if (!human(j) && ratio > 1.3 && rr() < PERS[W.ai[j].pers].caut + .15 && T[j] > 300) { T[j] -= 300; T[k] += 300; setRel(k, j, W.rel[k][j] - 8); W.ai[j].grudge[k] += 10; news(`${KN[j]} pays 300 gold in tribute to ${KN[k]}.`, 'gold'); } else { setRel(k, j, W.rel[k][j] - 12); W.ai[j].grudge[k] += 12; news(`${KN[j]} refuses to pay tribute to ${KN[k]}.`, 'bad'); } }
    else if (a === 'war') { if (atWar(k, j)) return; if (hasTreaty(k, j, 'pact')) return err(S, 'A non-aggression pact forbids war until it expires.'); setWar(k, j, 1); setRel(k, j, W.rel[k][j] - 20); for (let o = 0; o < 4; o++) if (o !== k) W.ai[o].trust[k] -= 5; news(`${rulerOf(k)} of ${KN[k]} declares war on ${KN[j]}!`, 'bad'); }
    else if (a === 'peace') { if (!atWar(k, j)) return; if (human(j) && offices[j].monarch !== S.id) { const O = online.get(offices[j].monarch); news(`${KN[k]} offers peace to ${KN[j]}.`); if (O) toast(O, `${KN[k]} offers peace. Offer peace back from your government's Diplomacy tab to accept.`, 'gold'); W.peaceAsk = W.peaceAsk || {}; W.peaceAsk[k + ':' + j] = W.t; if (!(W.peaceAsk[j + ':' + k] > W.t - 3)) { dirty = true; broadcastState(); return; } }
      const ok = human(j) || rr() < (W.rel[k][j] + 100) / 200 * .7 + .25; if (ok) { setWar(k, j, 0); setRel(k, j, W.rel[k][j] + 15); news(`Peace! ${KN[k]} and ${KN[j]} sign a treaty. The war is over.`, 'good'); } else { setRel(k, j, W.rel[k][j] - 7); news(`${KN[j]} rejects ${KN[k]}'s offer of peace.`, 'bad'); } }
    else if (a === 'ally') { if (atWar(k, j) || W.ally[k][j]) return; if (human(j)) { news(`${KN[k]} proposes an alliance to ${KN[j]}.`); W.allyAsk = W.allyAsk || {}; W.allyAsk[k + ':' + j] = W.t; if (!(W.allyAsk[j + ':' + k] > W.t - 3)) { dirty = true; broadcastState(); return; } }
      const ok = human(j) || rr() < (W.rel[k][j] - 15) / 60 + W.ai[j].trust[k] * .02 + PERS[W.ai[j].pers].dip * .2; if (ok) { W.ally[k][j] = W.ally[j][k] = 1; news(`${KN[k]} and ${KN[j]} form an alliance!`, 'good'); } else { setRel(k, j, W.rel[k][j] - 3); toast(S, `${KN[j]} politely declines an alliance for now.`); } }
    else if (a === 'unally') { if (!W.ally[k][j]) return; W.ally[k][j] = W.ally[j][k] = 0; setRel(k, j, W.rel[k][j] - 15); W.ai[j].trust[k] -= 15; news(`${KN[k]} ends its alliance with ${KN[j]}.`, 'bad'); }
    else return;
    dirty = true; broadcastState();
  }

  // ---------------------------------------------------------------- the chain of command: real soldiers in companies and squads
  // W.mem: user id -> { co: company id, n: name, r: rank, c: division }   (saved with the world)
  // W.sq:  [{ id, co, k, name, lead: user id or null, by: user id, mem: [user ids] }]
  const LT = RANKS.indexOf('Lieutenant'), SQ_MAX = 10, SQ_PER_CO = 8;
  let rosterDirty = true;
  const sqInv = new Map();   // user id -> { sq, from, until }
  function milInit() { W.mem = (W.mem && typeof W.mem === 'object') ? W.mem : {}; W.sq = Array.isArray(W.sq) ? W.sq : []; W.sqId = W.sqId || W.sq.reduce((a, q) => Math.max(a, q.id), 0); rosterDirty = true; }
  const coOf = id => W.regs.find(r => r.id === id);
  const sqOfUid = uid => W.sq.find(q => q.mem.includes(uid));
  const isOfficer = (S, k) => !!(S.admin || (offices[k] && (offices[k].monarch === S.id || offices[k].marshal === S.id)) || (S.mil && S.mil.army === k && S.mil.rank >= LT));
  const canManage = (S, q) => !!(q && (S.admin || q.lead === S.id || q.by === S.id || isOfficer(S, q.k)));
  const snap = S => ({ n: S.char.name, r: S.mil ? S.mil.rank : 0, c: S.mil && CORPS[S.mil.corps] ? S.mil.corps : 'line' });
  function unSquad(uid) { const q = sqOfUid(uid); if (!q) return null; q.mem = q.mem.filter(u => u !== uid); if (q.lead === uid) q.lead = null; return q; }
  function dropMember(uid) { if (!W) return; const had = !!W.mem[uid] || !!sqOfUid(uid); unSquad(uid); delete W.mem[uid]; if (had) { dirty = true; rosterDirty = true; } }
  function setCompany(S, R) { const cur = W.mem[S.id]; if (cur && cur.co !== R.id) { const q = sqOfUid(S.id); if (q && q.co !== R.id) unSquad(S.id); } W.mem[S.id] = { co: R.id, ...snap(S) }; dirty = true; rosterDirty = true; }
  function refresh(S) {   // a soldier's name, rank or division changed, or they came online
    if (!W || !S || !S.char) return; const m = W.mem[S.id];
    if (m) { const R = coOf(m.co); if (!S.mil || !R || R.k !== S.mil.army) return dropMember(S.id); Object.assign(m, snap(S)); }
    else if (sqOfUid(S.id)) unSquad(S.id);
    rosterDirty = true;
  }
  function milTick() {
    // companies that were destroyed take their roster and squads with them
    let ch = false;
    for (const [uid, m] of Object.entries(W.mem)) if (!coOf(m.co)) { delete W.mem[uid]; ch = true; }
    const before = W.sq.length; W.sq = W.sq.filter(q => coOf(q.co)); for (const q of W.sq) { const keep = q.mem.filter(u => W.mem[u] && W.mem[u].co === q.co); if (keep.length !== q.mem.length) { q.mem = keep; ch = true; } if (q.lead && !q.mem.includes(q.lead)) { q.lead = null; ch = true; } }
    if (ch || W.sq.length !== before) { dirty = true; rosterDirty = true; }
    for (const [uid, v] of sqInv) if (v.until < Date.now()) sqInv.delete(uid);
    if (rosterDirty) { rosterDirty = false; each(S => send(S, rosterMsg(S))); }
  }
  function rosterMsg(S) {
    const cos = {};
    for (const [uid, m] of Object.entries(W.mem)) { const q = sqOfUid(uid); (cos[m.co] = cos[m.co] || []).push([m.n, m.r, m.c, q ? q.id : 0, online.has(uid) ? 1 : 0, q && q.lead === uid ? 1 : 0]); }
    for (const id in cos) cos[id].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const sqs = W.sq.map(q => [q.id, q.co, q.name, q.lead && W.mem[q.lead] ? W.mem[q.lead].n : '', q.mem.length]);
    const mine = W.mem[S.id], myq = sqOfUid(S.id), k = S.mil ? S.mil.army : -1;
    return { t: 'wroster', cos, sqs, me: { co: mine ? mine.co : null, sq: myq ? myq.id : 0, officer: k >= 0 && isOfficer(S, k), manage: W.sq.filter(q => canManage(S, q)).map(q => q.id) } };
  }
  const squadOf = uid => (W ? sqOfUid(uid) || null : null);
  const cleanName = v => String(v || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 30);
  const byName = n => { const t = String(n || '').toLowerCase(); for (const [uid, m] of Object.entries(W.mem)) if (m.n.toLowerCase() === t) return uid; return null; };
  const tell = (uid, msg, c) => { const O = online.get(uid); if (O) toast(O, msg, c); };
  const MIL = {
    join(S, m) {
      const R = coOf(Math.round(+m.id)); if (!R) return err(S, 'That company is gone.');
      if (!S.mil) return err(S, 'Enlist in an army first.'); if (S.mil.army !== R.k) return err(S, `Only soldiers of ${KN[R.k]} can serve in the ${R.name}.`);
      setCompany(S, R); toast(S, `You join the ${R.name}. Its roster is on your Army tab.`, 'gold');
    },
    leave(S) { if (!W.mem[S.id]) return; const R = coOf(W.mem[S.id].co); dropMember(S.id); toast(S, R ? `You leave the ${R.name}.` : 'You leave your company.'); },
    sqNew(S, m) {
      const R = coOf(Math.round(+m.id)); if (!R) return err(S, 'Pick one of your companies.');
      if (!isOfficer(S, R.k)) return err(S, 'Only a Lieutenant or higher, the Marshal, the Monarch or an admin can form squads.');
      const name = cleanName(m.name); if (name.length < 3) return err(S, 'Give the squad a name (3–30 letters).');
      if (W.sq.filter(q => q.co === R.id).length >= SQ_PER_CO) return err(S, `The ${R.name} already has ${SQ_PER_CO} squads.`);
      if (W.sq.some(q => q.co === R.id && q.name.toLowerCase() === name.toLowerCase())) return err(S, 'That company already has a squad with that name.');
      const q = { id: ++W.sqId, co: R.id, k: R.k, name, lead: null, by: S.id, mem: [] };
      if (S.mil && S.mil.army === R.k && m.self !== false) { unSquad(S.id); setCompany(S, R); q.mem.push(S.id); q.lead = S.id; }
      W.sq.push(q); dirty = true; rosterDirty = true;
      toast(S, `Squad “${name}” formed in the ${R.name}.${q.lead ? ' You lead it.' : ''} Invite soldiers from the Army tab or the player menu.`, 'gold');
    },
    sqInv(S, m) {
      const q = W.sq.find(x => x.id === Math.round(+m.sq)); if (!canManage(S, q)) return err(S, 'Only the squad leader or an officer can invite to this squad.');
      const O = byNid.get(Math.round(+m.nid)); if (!O || !O.ready) return err(S, 'That player is not online.');
      if (!O.mil || O.mil.army !== q.k) return err(S, `${O.char.name} is not a soldier of ${KN[q.k]}.`);
      if (q.mem.includes(O.id)) return err(S, `${O.char.name} is already in ${q.name}.`);
      if (q.mem.length >= SQ_MAX) return err(S, `A squad holds at most ${SQ_MAX} soldiers.`);
      const R = coOf(q.co); sqInv.set(O.id, { sq: q.id, from: S.char.name, until: Date.now() + 120000 });
      send(O, { t: 'wsqinv', sq: q.id, name: q.name, co: R ? R.name : '', from: S.char.name }); toast(S, `Invitation sent to ${O.char.name}.`);
    },
    sqAcc(S, m) {
      const inv = sqInv.get(S.id); sqInv.delete(S.id); if (!inv || inv.sq !== Math.round(+m.sq)) return err(S, 'That invitation has expired.');
      if (!m.ok) return; const q = W.sq.find(x => x.id === inv.sq), R = q && coOf(q.co);
      if (!q || !R) return err(S, 'That squad is gone.'); if (!S.mil || S.mil.army !== q.k) return err(S, 'You are not a soldier of that army.');
      if (q.mem.length >= SQ_MAX) return err(S, 'That squad is full.');
      unSquad(S.id); setCompany(S, R); q.mem.push(S.id); if (!q.lead) q.lead = S.id; dirty = true; rosterDirty = true;
      toast(S, `You join squad ${q.name} of the ${R.name}. Use the Squad chat channel to talk to them.`, 'gold');
      for (const u of q.mem) if (u !== S.id) tell(u, `${S.char.name} joins your squad.`);
    },
    sqKick(S, m) {
      const q = W.sq.find(x => x.id === Math.round(+m.sq)); if (!canManage(S, q)) return err(S, 'Only the squad leader or an officer can do that.');
      const uid = byName(m.name); if (!uid || !q.mem.includes(uid)) return err(S, 'They are not in that squad.');
      if (uid === S.id) return MIL.sqLeave(S);
      unSquad(uid); dirty = true; rosterDirty = true; tell(uid, `You were removed from squad ${q.name}.`); toast(S, `${m.name} removed from ${q.name}.`);
    },
    sqLead(S, m) {
      const q = W.sq.find(x => x.id === Math.round(+m.sq)); if (!canManage(S, q)) return err(S, 'Only the squad leader or an officer can do that.');
      const uid = byName(m.name); if (!uid || !q.mem.includes(uid)) return err(S, 'Pick a member of the squad.');
      q.lead = uid; dirty = true; rosterDirty = true; tell(uid, `You now lead squad ${q.name}.`, 'gold'); toast(S, `${W.mem[uid].n} now leads ${q.name}.`, 'gold');
    },
    sqLeave(S) { const q = unSquad(S.id); if (!q) return; dirty = true; rosterDirty = true; toast(S, `You leave squad ${q.name}.`); },
    sqDel(S, m) {
      const q = W.sq.find(x => x.id === Math.round(+m.sq)); if (!q) return;
      if (!(S.admin || q.by === S.id || isOfficer(S, q.k))) return err(S, 'Only an officer can disband a squad.');
      W.sq = W.sq.filter(x => x !== q); dirty = true; rosterDirty = true; for (const u of q.mem) if (u !== S.id) tell(u, `Squad ${q.name} has been disbanded.`); toast(S, `Squad ${q.name} disbanded.`);
    },
  };
  const handlers = {
    async wcmd(S, m) {
      if (!W || !m || typeof m.op !== 'string') return; if (Object.prototype.hasOwnProperty.call(MIL, m.op)) return MIL[m.op](S, m); const sc = scope(S); const R = W.regs.find(r => r.id === Math.round(+m.id)); const op = m.op;
      if (op === 'take') { if (!R || !sc || R.k !== sc.k || sc.max >= 99) return err(S, 'You cannot take command of that company.'); if (leads.has(R.id) && leads.get(R.id) !== S.id) return err(S, `${nameOf(leads.get(R.id))} already leads the ${R.name}.`); if (ledBy(S.id).length >= sc.max) return err(S, 'You already lead as many companies as your rank allows.'); leads.set(R.id, S.id); return ok(S, `You take command of the ${R.name}.`); }
      if (op === 'give') { if (R && leads.get(R.id) === S.id) { leads.delete(R.id); if (R.order.type === 'follow') R.order = { type: 'garrison', town: R.home }; } return ok(S); }
      if (op === 'order') {
        if (!R || !canCtl(S, R, sc)) return err(S, 'You do not command that company.'); if (R.rout) return err(S, 'That company is fleeing and will not answer orders until it rallies.');
        const o = m.order || {}; let ord = null;
        if ((o.type === 'garrison' || o.type === 'siege') && TOWNS[o.town]) { const t = TOWNS[o.town]; const own = ownerT(t.i); if (o.type === 'garrison' && own !== R.k) return err(S, 'You can only garrison your own towns.'); if (o.type === 'siege' && !(atWar(R.k, own) || (W.rebel.includes(t.i) && own === R.k))) return err(S, 'You are not at war with that town.'); ord = { type: o.type, town: t.i }; R.sieg = 0; }
        else if (o.type === 'move' && Number.isFinite(+o.x) && Number.isFinite(+o.z) && Math.abs(o.x) < 20000 && Math.abs(o.z) < 20000) ord = { type: 'move', x: +o.x, z: +o.z };
        else if (o.type === 'hold') ord = { type: 'hold' };
        else if (o.type === 'follow') ord = { type: 'follow', uid: S.id };
        if (!ord) return err(S, 'That order makes no sense.'); R.order = ord; return ok(S);
      }
      if (op === 'custom') {
        if (!R || !canCtl(S, R, sc)) return err(S, 'You do not command that company.');
        if (typeof m.name === 'string') { const v = m.name.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40); if (v.length >= 3) R.name = v; }
        if (DIVS[R.type][m.div]) R.div = m.div; if (FORMS.includes(m.form)) R.form = m.form; if (STANCES.includes(m.stance)) R.stance = m.stance; return ok(S);
      }
      if (op === 'enlist') { if (!sc || !sc.recruit) return err(S, 'Only Colonels, Generals, Marshals and Monarchs can enlist soldiers.'); const ty = FIELD[m.type] ? m.type : null; const n = clamp(Math.round(+m.n || 0), 1, 500); if (!ty) return; const got = enlist(sc.k, n, ty); if (!got) return err(S, 'The treasury cannot afford that, or the kingdom is at its limit.'); return ok(S, `${got} recruits join the ${ty === 'horse' ? 'cavalry' : ty === 'guns' ? 'artillery' : 'infantry'} reserves.`); }
      if (op === 'auto') { if (!sc || !sc.full) return err(S, 'Only Generals, Marshals and Monarchs can hand the army to the Lord Marshal.'); W.auto[sc.k] = !!m.on; dirty = true; broadcastState(); return; }
      if (op === 'fort') { if (!sc || !sc.full) return err(S, 'Only Generals, Marshals and Monarchs can build forts.'); const x = +m.x, z = +m.z; if (!Number.isFinite(x) || !Number.isFinite(z)) return; if (!TOWNS.some(t => ownerT(t.i) === sc.k && mainland(t) && Math.hypot(t.x - x, t.z - z) < 700)) return err(S, 'Forts must be built within 700 paces of one of your own towns.'); if (W.gov.treasury[sc.k] < 1500) return err(S, 'The treasury cannot afford a fort.'); W.gov.treasury[sc.k] -= 1500; W.forts.push({ k: sc.k, x, z, name: `Fort ${pick(LAST)}` }); news(`${KN[sc.k]} raises a new fort near ${placeName(x, z)}.`); dirty = true; broadcastState(); return; }
      if (op === 'hit') { // the player shot or cut down a soldier of this company
        if (!R || !Number.isFinite(S.x) || Math.hypot(S.x - R.x, S.z - R.z) > 260) return; const t = Date.now(); if (t - (S.lastHit || 0) < 700) return; S.lastHit = t;
        const myK = S.mil ? S.mil.army : -1; if (myK === R.k) return; if (myK >= 0 && !atWar(myK, R.k)) return; casualty(R, 1); if (R.str <= FIELD[R.type].size * .3 || R.mor < 18) rout(R, null); return;
      }
      if (op === 'gov') return govCmd(S, m);
      if (op === 'rebuild') { // a patron pays from their own purse; the gold is taken here, never in the browser
        const t = TOWNS[Math.round(+m.town)]; if (!t || !(W.ruin[t.i] > 0)) return err(S, 'That town has nothing to rebuild.');
        if (!Number.isFinite(S.x) || Math.hypot(S.x - t.x, S.z - t.z) > t.r + 120) return err(S, `Go to ${t.name} first.`);
        const full = !!m.full; const cost = full ? Math.round(W.ruin[t.i] * 1600) : 200; if (!changeGold || !(await changeGold(S.id, -cost, 'rebuild', 'town:' + t.i))) return err(S, 'You cannot afford that.');
        if (full) { delete W.ruin[t.i]; news(`${S.char.name} pays to rebuild ${t.name}! The town will not forget it.`, 'good'); if (t.k >= 0) W.gov.appr[t.k] = Math.min(100, W.gov.appr[t.k] + 4); }
        else { W.ruin[t.i] = Math.max(0, W.ruin[t.i] - .12); if (W.ruin[t.i] < .05) delete W.ruin[t.i]; toast(S, 'Blankets, bread and timber for the homeless.', 'good'); }
        dirty = true; broadcastState(); return;
      }
    },
  };
  function onEnter(S) { if (!W) return; send(S, stateMsg()); send(S, regsMsg()); refresh(S); send(S, rosterMsg(S)); }
  function onLeave(S) { sqInv.delete(S.id); rosterDirty = true; for (const id of ledBy(S.id)) leads.delete(id); for (const R of W ? W.regs : []) if (R.order.type === 'follow' && R.order.uid === S.id) R.order = { type: 'hold' }; }
  return { init, tick, save, handlers, onEnter, onLeave, refresh, dropMember, squadOf, get state() { return W; } };
};
