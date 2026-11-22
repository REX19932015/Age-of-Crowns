'use strict';
/* =====================================================================
   AGE OF CROWNS: SEASONS ON THE SERVER
   The server alone decides: which season and holidays are active (from its own
   UTC clock), whether a story step is complete (from where it sees the player),
   how much XP a player has, which battle pass rewards they may claim, and what
   they own. The browser only asks; it can never grant itself XP or items.
   ===================================================================== */
const D = require('./data/seasons');
const PL = require('./data/places.json');

module.exports = function installSeasons(ctx) {
  const { db, send, toast, system, changeGold, online, each, TOWNS, CFG, log, q, err, walletMsg, flush, nameOf } = ctx;
  const now = () => Date.now();
  const DAY = 86400000;
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const place = n => PL.places[n];
  const near = (S, at, r) => { const p = place(at); return !!p && fin(S.x) && !S.inside && Math.hypot(S.x - p.x, S.z - p.z) <= r; };
  const CHAPTER_GAP = +(process.env.CHAPTER_GAP_DAYS ?? 7) * DAY;
  const FINALE_EVERY = +(process.env.FINALE_EVERY_MINUTES || 120) * 60000;
  const FINALE_HOLD = +(process.env.FINALE_HOLD_SECONDS || D.CAMPAIGNS.spring.finale.holdSecs);

  // ---------------------------------------------------------------- calendar
  const utc = (y, m, d) => Date.UTC(y, m - 1, d);
  function seasonAt(t) {
    const ov = (process.env.SEASON_OVERRIDE || '').toLowerCase();
    if (D.SEASONS[ov]) {
      // preview mode for testing: the chosen season starts when the server starts and runs 92 days
      return { key: ov, id: ov + '-preview', start: BOOT - (+(process.env.SEASON_OVERRIDE_DAY || 0)) * DAY, end: BOOT + 92 * DAY, preview: true };
    }
    const d = new Date(t), y = d.getUTCFullYear();
    for (const yy of [y - 1, y]) for (const k of ['spring', 'summer', 'autumn', 'winter']) {
      const s = D.SEASONS[k];
      const start = utc(yy, s.start[0], s.start[1]);
      const end = utc(k === 'winter' ? yy + 1 : yy, s.end[0], s.end[1]) + DAY;
      if (t >= start && t < end) return { key: k, id: k + '-' + (k === 'winter' ? yy + '-' + (yy + 1) : yy), start, end };
    }
    return { key: 'winter', id: 'winter-' + y, start: t, end: t + DAY };
  }
  function easterSunday(y) { // anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return utc(y, month, day);
  }
  function holidaysAt(t) {
    const ov = (process.env.HOLIDAY_OVERRIDE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const out = [];
    const y = new Date(t).getUTCFullYear();
    for (const H of D.HOLIDAYS) {
      if (ov.includes(H.id)) { out.push({ ...H, key: H.id + '-preview', ends: t + 7 * DAY }); continue; }
      for (const yy of [y - 1, y]) {
        let a, b;
        if (H.easter) { const e = easterSunday(yy); a = e - 6 * DAY; b = e + 3 * DAY; }
        else { a = utc(yy, H.from[0], H.from[1]); b = utc(H.to[0] < H.from[0] ? yy + 1 : yy, H.to[0], H.to[1]) + DAY; }
        if (t >= a && t < b) out.push({ ...H, key: H.id + '-' + yy, ends: b });
      }
    }
    return out;
  }
  function nextHoliday(H, t) { // the next (or current) dates of a holiday, for the calendar
    const y = new Date(t).getUTCFullYear();
    for (const yy of [y - 1, y, y + 1]) {
      let a, b;
      if (H.easter) { const e = easterSunday(yy); a = e - 6 * DAY; b = e + 3 * DAY; }
      else { a = utc(yy, H.from[0], H.from[1]); b = utc(H.to[0] < H.from[0] ? yy + 1 : yy, H.to[0], H.to[1]) + DAY; }
      if (b > t) return { a, b };
    }
    return null;
  }
  const BOOT = now();
  let SEASON = seasonAt(now());
  let HOLS = holidaysAt(now());
  const campaign = () => D.CAMPAIGNS[SEASON.key] || null;
  const chapterOpen = n => now() >= SEASON.start + (n - 1) * CHAPTER_GAP;
  const chapterOpensAt = n => SEASON.start + (n - 1) * CHAPTER_GAP;
  const dayKey = t => new Date(t).toISOString().slice(0, 10);
  const weekKey = t => 'w' + Math.floor((t - SEASON.start) / (7 * DAY));
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pickN(pool, n, seed) { const a = pool.slice(); let h = hash(seed); for (let i = a.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
  const dailies = () => pickN(D.DAILY_POOL, D.DAILY_COUNT, SEASON.id + dayKey(now()));
  const weeklies = () => pickN(D.WEEKLY_POOL, D.WEEKLY_COUNT, SEASON.id + weekKey(now()));

  // ---------------------------------------------------------------- the realm fund (shared)
  let fund = { season: null, total: 0, reached: [] };
  async function loadFund() {
    const C = campaign(); fund = { season: SEASON.id, total: 0, reached: [] };
    if (!C || !C.fund) return;
    const r = await db.one('season_community', { where: { season_id: SEASON.id, goal: 'fund' } }).catch(() => null);
    fund.total = r ? +r.progress : 0;
    fund.reached = C.fund.milestones.filter(m => fund.total >= m.at).map(m => m.at);
  }

  // ---------------------------------------------------------------- per-player progress
  function blank() { return { xp: 0, premium: false, story: { done: [], choices: {}, holdT: {}, rewarded: false }, stats: { season: {}, day: { k: '', m: {} }, week: { k: '', m: {} }, towns: { season: [], day: [], week: [] }, caps: { day: [], week: [], season: [] } }, chal: [], hunt: {}, fund: { donated: 0, got: [] } }; }
  async function loadPlayer(S) {
    S.sp = blank(); S.claims = new Set(); S.owned = new Set(); S.cos = {}; S.spDirty = false; S.spSeason = SEASON.id;
    try {
      const row = await db.one('season_progress', { where: { user_id: S.id, season_id: SEASON.id } });
      if (row) { const b = blank(); S.sp = { ...b, xp: +row.xp || 0, premium: !!row.premium, story: { ...b.story, ...(row.story || {}) }, stats: { ...b.stats, ...(row.stats || {}) }, chal: row.chal || [], hunt: row.hunt || {}, fund: { ...b.fund, ...(row.fund || {}) } }; }
      for (const c of await db.select('season_claims', { columns: 'tier,track', where: { user_id: S.id, season_id: SEASON.id } })) S.claims.add(c.tier + ':' + c.track);
      for (const u of await db.select('unlocks', { columns: 'item_id', where: { user_id: S.id } })) S.owned.add(u.item_id);
      const ch = await db.one('characters', { columns: 'equipped', where: { user_id: S.id } });
      S.cos = cleanEquip(S, ch && ch.equipped);
    } catch (e) { log('season load failed for', S.id, e.message); }
  }
  async function savePlayer(S) {
    if (!S.sp || !S.spDirty) return;
    S.spDirty = false;
    const sp = S.sp;
    await q(db.insert('season_progress', { user_id: S.id, season_id: S.spSeason, xp: sp.xp, premium: sp.premium, story: sp.story, stats: sp.stats, chal: sp.chal.slice(-200), hunt: sp.hunt, fund: sp.fund, updated_at: new Date().toISOString() }, { upsert: true, onConflict: 'user_id,season_id', returning: false }));
  }
  const dirty = S => { S.spDirty = true; };
  const tierOf = xp => Math.min(D.MAX_TIER, Math.floor(xp / D.TIER_XP));
  const boostOf = S => { const b = S.sp && S.sp.stats && S.sp.stats.boost; return b && b.until > now() ? b : null; };

  // ---------------------------------------------------------------- cosmetics
  const SLOTS = ['outfit', 'hat', 'title', 'balloon', 'sails', 'gunfin', 'plate'];
  function cleanEquip(S, e) { const out = {}; if (!e || typeof e !== 'object') return out; for (const s of SLOTS) { const id = e[s]; const it = D.ITEMS[id]; if (it && it.kind === s && S.owned.has(id)) out[s] = id; } return out; }
  function cosPublic(S) { // what other players need to draw you
    const c = S.cos || {}, o = {};
    if (c.title) o.title = D.ITEMS[c.title].data.text;
    if (c.plate) o.plate = D.ITEMS[c.plate].data.col;
    if (c.balloon) o.balloon = D.ITEMS[c.balloon].data;
    if (c.sails) o.sails = D.ITEMS[c.sails].data.col;
    if (c.gunfin) o.gunfin = D.ITEMS[c.gunfin].data;
    return o;
  }
  async function grantItem(S, uid, id, source) {
    if (!D.ITEMS[id]) return false;
    const P = S || online.get(uid);
    if (P && P.owned && P.owned.has(id)) return false;
    await q(db.insert('unlocks', { user_id: uid, item_id: id, source, season_id: SEASON.id }, { upsert: true, onConflict: 'user_id,item_id', returning: false }));
    if (P && P.owned) { P.owned.add(id); send(P, { t: 'sOwn', items: [...P.owned] }); toast(P, `New item: ${D.ITEMS[id].name}. Equip it in the Wardrobe (Season panel, Tab key).`, 'gold'); }
    return true;
  }

  // battle pass rewards: gold, wardrobe items, healing tonics and XP boosts
  async function applyReward(S, rw, ref) {
    if (rw.gold) await changeGold(S.id, rw.gold, 'battle pass', ref);
    if (rw.item) await grantItem(S, S.id, rw.item, 'pass');
    if (rw.tonic > 0 && S.char) {
      const c = S.char; c.items = c.items || {}; c.items.tonic = (+c.items.tonic || 0) + rw.tonic;
      c.wallet_seq++; S.dirty = true; send(S, walletMsg(c)); await flush(S);
      toast(S, `+${rw.tonic} healing tonic${rw.tonic === 1 ? '' : 's'} (press 1 to drink one).`, 'gold');
    }
    if (rw.boost) {
      const st = S.sp.stats, cur = boostOf(S), mins = Math.min(600, Math.max(1, rw.boost.mins)), mult = Math.min(3, Math.max(1, rw.boost.mult));
      // same strength: add the time on; a stronger boost replaces a weaker one (keeping the longer end time)
      if (cur && cur.mult === mult) st.boost = { mult, until: cur.until + mins * 60000 };
      else st.boost = { mult: Math.max(mult, cur ? cur.mult : 1), until: Math.max(now() + mins * 60000, cur ? cur.until : 0) };
      dirty(S);
      send(S, { t: 'sBoost', boost: st.boost });
      toast(S, `XP boost ×${st.boost.mult} until ${new Date(st.boost.until).toISOString().slice(11, 16)} UTC.`, 'gold');
    }
  }

  // ---------------------------------------------------------------- XP, challenges and stats
  function addXP(S, n, why) {
    if (!S.sp || !(n > 0)) return;
    const before = tierOf(S.sp.xp);
    const b = why === 'admin' ? null : boostOf(S);
    if (b) n *= b.mult;
    S.sp.xp += Math.round(n); dirty(S);
    const after = tierOf(S.sp.xp);
    send(S, { t: 'sXP', xp: S.sp.xp, gain: Math.round(n), why, boosted: !!b });
    if (after > before) toast(S, after > D.TIERS ? `Bonus tier ${after} reached! Claim it in the Season panel (Tab).` : after === D.TIERS ? `Tier ${D.TIERS}: you finished the battle pass! Bonus tiers continue to ${D.MAX_TIER}.` : `Battle pass tier ${after} reached! Claim your rewards in the Season panel (Tab).`, 'gold');
  }
  function rollPeriods(S) {
    const st = S.sp.stats, dk = dayKey(now()), wk = weekKey(now());
    if (st.day.k !== dk) { st.day = { k: dk, m: {} }; st.towns.day = []; st.caps.day = []; }
    if (st.week.k !== wk) { st.week = { k: wk, m: {} }; st.towns.week = []; st.caps.week = []; }
  }
  function metric(S, name, n = 1) {
    if (!S || !S.sp || !(n > 0)) return;
    rollPeriods(S);
    const st = S.sp.stats;
    st.season[name] = (st.season[name] || 0) + n; st.day.m[name] = (st.day.m[name] || 0) + n; st.week.m[name] = (st.week.m[name] || 0) + n;
    dirty(S);
    checkChallenges(S);
  }
  function chalList(S) {
    rollPeriods(S);
    const st = S.sp.stats, done = new Set(S.sp.chal);
    const row = (c, per, m) => ({ id: c.id, per, text: c.text, n: c.n, xp: c.xp, have: Math.min(c.n, Math.floor(m[c.metric] || 0)), done: done.has(per + ':' + (per === 's' ? '' : (per === 'd' ? st.day.k : st.week.k)) + ':' + c.id) });
    return [...dailies().map(c => row(c, 'd', st.day.m)), ...weeklies().map(c => row(c, 'w', st.week.m)), ...D.SEASONAL_CH.map(c => row(c, 's', st.season))];
  }
  function checkChallenges(S) {
    const st = S.sp.stats;
    let changed = false;
    for (const c of chalList(S)) {
      if (c.done || c.have < c.n) continue;
      const key = c.per + ':' + (c.per === 's' ? '' : (c.per === 'd' ? st.day.k : st.week.k)) + ':' + c.id;
      S.sp.chal.push(key); changed = true;
      toast(S, `Challenge complete: ${c.text} (+${c.xp} XP)`, 'gold');
      addXP(S, c.xp, 'challenge');
    }
    if (changed) send(S, { t: 'sChal', list: chalList(S) });
  }

  // movement: distance and towns, counted from what the server itself sees
  function onMove(S, ox, oz) {
    if (!S.sp || !fin(ox) || !fin(S.x)) return;
    const d = Math.hypot(S.x - ox, S.z - oz);
    if (d > 0.05 && d < 40) { S.distAcc = (S.distAcc || 0) + d; if (S.distAcc >= 25) { metric(S, 'dist', Math.floor(S.distAcc)); S.distAcc -= Math.floor(S.distAcc); } }
  }
  function townTick(S) {
    if (!S.sp || !fin(S.x) || S.inside) return;
    rollPeriods(S);
    for (const t of TOWNS) {
      if (Math.abs(t.x - S.x) > t.r || Math.abs(t.z - S.z) > t.r || Math.hypot(t.x - S.x, t.z - S.z) > t.r) continue;
      const tw = S.sp.stats.towns;
      if (!tw.day.includes(t.i)) { tw.day.push(t.i); metricOnly(S, 'towns', 'day'); }
      if (!tw.week.includes(t.i)) { tw.week.push(t.i); metricOnly(S, 'towns', 'week'); }
      if (!tw.season.includes(t.i)) { tw.season.push(t.i); metricOnly(S, 'towns', 'season'); }
      if (t.type === 'capital' && t.k !== S.char.kingdom) {
        const cp = S.sp.stats.caps;
        if (!cp.day.includes(t.i)) { cp.day.push(t.i); metricOnly(S, 'caps', 'day'); }
        if (!cp.week.includes(t.i)) { cp.week.push(t.i); metricOnly(S, 'caps', 'week'); }
        if (!cp.season.includes(t.i)) { cp.season.push(t.i); metricOnly(S, 'caps', 'season'); }
      }
      break;
    }
  }
  function metricOnly(S, name, per) { // "different towns" style counters, counted once per period
    const st = S.sp.stats, m = per === 'day' ? st.day.m : per === 'week' ? st.week.m : st.season;
    m[name] = (m[name] || 0) + 1; dirty(S); checkChallenges(S);
  }

  // ---------------------------------------------------------------- the story
  function mainSteps() { const C = campaign(); if (!C) return []; const out = []; for (const ch of C.chapters) for (const s of ch.steps) out.push({ ...s, ch: ch.n }); return out; }
  const applies = (S, s) => !s.when || Object.entries(s.when).every(([k, v]) => S.sp.story.choices[k] === v);
  function currentMain(S) {
    const done = new Set(S.sp.story.done);
    for (const s of mainSteps()) { if (done.has(s.id) || !applies(S, s)) continue; return s; }
    return null;
  }
  function activeSides(S) {
    const C = campaign(); if (!C) return [];
    const done = new Set(S.sp.story.done), out = [];
    for (const Q of C.side) {
      if (Q.after && !done.has(Q.after)) continue;
      const st = Q.steps.find(s => !done.has(s.id));
      if (st) out.push({ q: Q, s: st });
    }
    return out;
  }
  function activeSteps(S) { // [{q:'main'|sideId, s}]
    if (!S.sp) return [];
    const out = [];
    const m = currentMain(S);
    if (m && chapterOpen(m.ch)) out.push({ q: 'main', s: m });
    for (const a of activeSides(S)) out.push({ q: a.q.id, s: a.s });
    return out;
  }
  function storyState(S) {
    const C = campaign();
    if (!C) return { none: true, plan: D.CAMPAIGN_PLANS[SEASON.key] || null };
    const m = currentMain(S);
    return {
      id: C.id, title: C.title, done: S.sp.story.done, choices: S.sp.story.choices, holdT: S.sp.story.holdT,
      main: m ? { id: m.id, ch: m.ch, open: chapterOpen(m.ch), opensAt: chapterOpensAt(m.ch) } : null,
      sides: activeSides(S).map(a => ({ q: a.q.id, step: a.s.id })),
      complete: !m, rewarded: !!S.sp.story.rewarded,
      fund: C.fund ? { name: C.fund.name, total: fund.total, milestones: C.fund.milestones, mine: S.sp.fund.donated } : null,
    };
  }
  function pushStory(S) { send(S, { t: 'sStory', story: storyState(S) }); }
  async function completeStep(S, q, s, extra) {
    if (S.sp.story.done.includes(s.id)) return;
    S.sp.story.done.push(s.id); delete S.sp.story.holdT[s.id]; dirty(S);
    if (extra && extra.choice) S.sp.story.choices[s.key] = extra.choice;
    addXP(S, s.xp || 300, 'story');
    if (s.gold) await changeGold(S.id, s.gold, 'story reward', 'step:' + s.id);
    metric(S, 'steps', 1);
    const msg = s.found || s.done || (extra && extra.reply) || null;
    send(S, { t: 'sStep', q, id: s.id, msg });
    // the end of the main story: the campaign's own rewards, granted once and never sold
    if (q === 'main' && !currentMain(S)) await finishCampaign(S);
    await savePlayer(S);
    pushStory(S);
  }
  async function finishCampaign(S) {
    const C = campaign(); if (!C || S.sp.story.rewarded) return;
    try { await db.insert('season_claims', { user_id: S.id, season_id: SEASON.id, tier: 0, track: 'story' }, { returning: false }); }
    catch (e) { S.sp.story.rewarded = true; dirty(S); return; }   // already rewarded (another session)
    S.sp.story.rewarded = true; dirty(S);
    await changeGold(S.id, C.rewards.gold, 'campaign complete', 'campaign:' + SEASON.id);
    for (const id of C.rewards.items) await grantItem(S, S.id, id, 'campaign');
    for (const [k, map] of Object.entries(C.rewards.byChoice || {})) { const ch = S.sp.story.choices[k]; for (const id of (map[ch] || [])) await grantItem(S, S.id, id, 'campaign'); }
    system('global', `${S.char.name} has completed ${C.title}, the ${D.SEASONS[SEASON.key].name} campaign!`);
    send(S, { t: 'sCampaignDone', gold: C.rewards.gold, items: C.rewards.items });
  }
  // a request from the browser to complete a talk/search/choice/pay step. The server checks it.
  async function onAct(S, m) {
    if (!S.sp || S.spSeason !== SEASON.id) return;
    const act = activeSteps(S).find(a => a.q === m.q && a.s.id === m.step);
    if (!act) return err(S, 'That is not your current task.');
    const s = act.s;
    if (!['talk', 'search', 'choice', 'pay'].includes(s.type)) return;
    if (!near(S, s.at, (s.r || 7) + 3)) { if (process.env.DEBUG_SEASON) log('not near', s.id, S.x, S.z, S.inside, place(s.at)); return err(S, 'You need to be right there to do that.'); }
    if (s.type === 'choice') {
      const opt = s.options.find(o => o.id === m.opt);
      if (!opt) return err(S, 'Choose one of the options.');
      return completeStep(S, act.q, s, { choice: opt.id, reply: opt.reply });
    }
    if (s.type === 'pay') {
      if (s.gold) {
        if (!(await changeGold(S.id, -s.gold, 'story payment', 'step:' + s.id))) return err(S, `You need ${s.gold} gold for this.`);
        if (s.community) await donate(S, s.gold, true);
      } else if (s.cargo) {
        const c = S.char; if ((c.cargo[s.cargo] || 0) < s.n) return err(S, `You need ${s.n} crates of ${s.cargo} in your cargo.`);
        c.cargo[s.cargo] -= s.n; if (!c.cargo[s.cargo]) delete c.cargo[s.cargo]; c.wallet_seq++; S.dirty = true; send(S, walletMsg(c)); flush(S);
      }
    }
    return completeStep(S, act.q, s);
  }
  async function donate(S, n, fromStory) {
    const C = campaign(); if (!C || !C.fund) return;
    n = Math.floor(n); if (!(n > 0)) return;
    if (!fromStory) { if (n > 100000) return err(S, 'That is too large a single donation.'); if (!(await changeGold(S.id, -n, 'realm fund donation', 'fund:' + SEASON.id))) return err(S, 'You do not have that much gold.'); }
    S.sp.fund.donated += n; dirty(S); metric(S, 'donate', n);
    fund.total += n;
    await q(db.insert('season_community', { season_id: SEASON.id, goal: 'fund', progress: fund.total, updated_at: new Date().toISOString() }, { upsert: true, onConflict: 'season_id,goal', returning: false }));
    for (const ms of C.fund.milestones) if (fund.total >= ms.at && !fund.reached.includes(ms.at)) { fund.reached.push(ms.at); system('global', `The ${C.fund.name} has reached ${ms.at.toLocaleString('en')} gold! Every donor receives: ${ms.note}.`); }
    each(O => { fundRewards(O); });
    toast(S, `You gave ${n} gold to the ${C.fund.name}. Thank you!`, 'gold');
    each(O => send(O, { t: 'sFund', total: fund.total }));
  }
  async function fundRewards(S) {
    const C = campaign(); if (!C || !C.fund || !S.sp || !(S.sp.fund.donated > 0)) return;
    for (const ms of C.fund.milestones) {
      if (!fund.reached.includes(ms.at) || S.sp.fund.got.includes(ms.at)) continue;
      S.sp.fund.got.push(ms.at); dirty(S);
      if (ms.item) await grantItem(S, S.id, ms.item, 'fund');
      if (ms.gold) await changeGold(S.id, ms.gold, 'fund milestone', 'fund:' + ms.at);
    }
  }
  // go and hold steps are checked every second from the server's own view of each player
  const holdMates = (S, at, r) => { let n = 0; for (const O of online.values()) if (O !== S && O.ready && near(O, at, r)) n++; return n; };
  async function storyTick(S, dt) {
    for (const a of activeSteps(S)) {
      const s = a.s;
      if (s.type === 'go' && near(S, s.at, s.r || 14)) await completeStep(S, a.q, s);
      else if (s.type === 'hold') {
        if (!near(S, s.at, s.r || 12)) continue;
        const mult = 1 + Math.min(3, holdMates(S, s.at, s.r || 12)) * 0.5;
        const t = (S.sp.story.holdT[s.id] || 0) + dt * mult; S.sp.story.holdT[s.id] = t; dirty(S);
        if (t >= s.secs) await completeStep(S, a.q, s);
        else if (Math.floor(t) % 5 === 0) send(S, { t: 'sHold', id: s.id, t: Math.floor(t), of: s.secs, mates: Math.round((mult - 1) * 2) });
      }
    }
  }

  // ---------------------------------------------------------------- the live finale
  let FIN = null, nextFinale = now() + 60000;
  function finaleInfo() { if (!FIN) return null; return { ends: FIN.ends, posts: FIN.posts.map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z, t: Math.floor(p.t), of: FINALE_HOLD })), count: FIN.time.size, won: FIN.won }; }
  function startFinale(by) {
    const C = campaign(); if (!C || !C.finale || FIN) return false;
    const F = C.finale;
    FIN = { ends: now() + F.minutes * 60000, posts: F.posts.map(p => ({ ...p, ...place(p.at), t: 0 })), time: new Map(), helpers: new Set(), won: false, at: place(F.at) };
    system('global', `THE CONCORD ASSEMBLY BEGINS at the Crossroads Market! The Hollow Hand attacks. Secure ${F.posts.map(p => p.name).join(', ')} together within ${F.minutes} minutes.${by ? '' : ''}`);
    each(S => send(S, { t: 'sFinale', fin: finaleInfo() }));
    return true;
  }
  async function finaleTick(dt) {
    const C = campaign();
    if (!FIN) {
      if (C && C.finale && chapterOpen(C.chapters.length) && online.size && now() > nextFinale) { nextFinale = now() + FINALE_EVERY; startFinale(); }
      return;
    }
    for (const S of online.values()) if (S.ready && fin(S.x) && !S.inside && Math.hypot(S.x - FIN.at.x, S.z - FIN.at.z) < 220) FIN.time.set(S.id, (FIN.time.get(S.id) || 0) + dt);
    for (const p of FIN.posts) {
      let n = 0; for (const S of online.values()) if (S.ready && fin(S.x) && !S.inside && Math.hypot(S.x - p.x, S.z - p.z) <= 14) n++;
      if (n) { p.t = Math.min(FINALE_HOLD, p.t + dt * Math.min(3, n)); for (const S of online.values()) if (S.ready && fin(S.x) && !S.inside && Math.hypot(S.x - p.x, S.z - p.z) <= 14) FIN.helpers.add(S.id); }
    }
    if (Math.floor(now() / 1000) % 3 === 0) each(S => send(S, { t: 'sFinale', fin: finaleInfo() }));
    if (FIN.posts.every(p => p.t >= FINALE_HOLD)) {
      FIN.won = true;
      const fin0 = FIN; FIN = null; nextFinale = now() + FINALE_EVERY;
      const heroes = [...new Set([...[...fin0.time.entries()].filter(([, t]) => t >= 30).map(([uid]) => uid), ...fin0.helpers])];
      system('global', `VICTORY! The Hollow Hand is broken at the Concord Assembly. ${heroes.length} defender${heroes.length === 1 ? '' : 's'} stood together.`);
      for (const uid of heroes) {
        const S = online.get(uid); if (!S || !S.sp) continue;
        const a = activeSteps(S).find(x => x.q === 'main' && x.s.type === 'finale');
        if (a) await completeStep(S, 'main', a.s);
        else { addXP(S, 1000, 'finale'); await changeGold(uid, 250, 'finale defender', 'finale'); toast(S, 'You helped defend the Concord Assembly: +1000 XP and 250 gold.', 'gold'); }
      }
      each(S => send(S, { t: 'sFinale', fin: null, won: true }));
    } else if (now() > FIN.ends) {
      FIN = null; nextFinale = now() + FINALE_EVERY;
      system('global', `The Hollow Hand slips away from the Concord Assembly. The Assembly will meet again in ${Math.round(FINALE_EVERY / 60000)} minutes.`);
      each(S => send(S, { t: 'sFinale', fin: null, won: false }));
    }
  }

  // ---------------------------------------------------------------- holiday hunts
  function holState(S) { return HOLS.map(H => ({ id: H.id, key: H.key, name: H.name, deco: H.deco, hunt: H.hunt, ends: H.ends, spots: H.spots.map(n => ({ n, ...place(n) })), found: (S.sp.hunt[H.key] || []), items: H.items })); }
  async function onHunt(S, m) {
    const H = HOLS.find(h => h.id === m.h); if (!H) return err(S, 'That festival is over.');
    if (!H.spots.includes(m.spot)) return;
    const got = S.sp.hunt[H.key] || (S.sp.hunt[H.key] = []);
    if (got.includes(m.spot)) return;
    if (!near(S, m.spot, 10)) return err(S, 'Get closer first.');
    got.push(m.spot); dirty(S);
    addXP(S, H.xp, 'holiday'); await changeGold(S.id, H.gold, 'holiday find', H.key + ':' + m.spot); metric(S, 'hunt', 1);
    toast(S, `${H.name}: ${got.length} of ${H.spots.length} found.`, 'gold');
    await savePlayer(S);
    if (got.length === H.spots.length) { for (const id of H.items) await grantItem(S, S.id, id, 'holiday'); system('global', `${S.char.name} completed the ${H.name} hunt!`); }
    send(S, { t: 'sHol', hol: holState(S) });
  }

  // ---------------------------------------------------------------- live world events (schedule, objectives, XP)
  const BIG = TOWNS.filter(t => t.type !== 'village' && t.k >= 0);
  const pickTown = where => {
    let pool = where === 'capital' ? TOWNS.filter(t => t.type === 'capital')
      : where === 'port' ? TOWNS.filter(t => t.type !== 'village' && t.k >= 0 && PL.routes[t.i] && PL.routes[t.i].water)
      : where === 'town' ? TOWNS.filter(t => t.type !== 'capital' && t.k >= 0)
      : BIG;
    if (where !== 'port') { const withLoop = pool.filter(t => PL.routes[t.i] && PL.routes[t.i].land); if (withLoop.length) pool = withLoop; }
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : TOWNS[0];
  };
  const schedule = [];
  function planEvents() {
    const every = CFG.EVENT_EVERY_MIN * 60000;
    let t = schedule.length ? schedule[schedule.length - 1].at : now() + every;
    while (schedule.length < 8) {
      const kinds = D.LIVE_EVENTS.filter(k => k.seasons.includes(SEASON.key));
      const K = kinds[hash(SEASON.id + ':' + t) % kinds.length];
      const town = pickTown(K.where);
      schedule.push({ at: t, kind: K.kind, town: town.i, title: K.title(town, SEASON.key) });
      t += every;
    }
  }
  function upcoming() { planEvents(); return schedule.map(e => ({ at: e.at, kind: e.kind, title: e.title, town: e.town })); }
  // called by the server when it is time for the next event; returns the extra fields for the event object
  function nextLiveEvent() {
    planEvents();
    const plan = schedule.shift(); planEvents();
    const K = D.LIVE_EVENTS.find(k => k.kind === plan.kind) || D.LIVE_EVENTS[0];
    const t = TOWNS[plan.town];
    const ext = { kind: K.kind, title: plan.title, town: t.i, x: t.x, z: t.z, reward: K.reward, xp: K.xp, obj: K.obj };
    if (K.obj === 'checkpoints') { const r = PL.routes[t.i]; ext.cps = (K.kind === 'regatta' ? r && r.water : r && r.land) || null; if (!ext.cps) ext.obj = 'stay'; else { ext.cps = ext.cps.map(p => ({ x: p.x, z: p.z })); ext.cps.push({ x: t.x, z: t.z }); } }
    if (K.obj === 'hold') ext.holdSecs = K.holdSecs || 120;
    return ext;
  }
  // objective progress for one event, called each second by the server
  function eventTick(E, dt) {
    if (E.obj === 'checkpoints' && E.cps) {
      E.cp = E.cp || new Map();
      for (const uid of E.joined) {
        const S = online.get(uid); if (!S || !S.ready || !fin(S.x)) continue;
        const i = E.cp.get(uid) || 0; if (i >= E.cps.length) continue;
        const p = E.cps[i]; const r = E.kind === 'regatta' ? 35 : 18;
        if (Math.hypot(S.x - p.x, S.z - p.z) <= r) { E.cp.set(uid, i + 1); send(S, { t: 'sEvCp', id: E.id, i: i + 1, of: E.cps.length }); if (i + 1 >= E.cps.length) toast(S, `${E.title}: finished! Your reward comes when the event ends.`, 'gold'); }
      }
    } else if (E.obj === 'hold') {
      E.hold = E.hold || 0;
      let n = 0; for (const uid of E.joined) { const S = online.get(uid); if (S && S.ready && fin(S.x) && !S.inside && Math.hypot(S.x - E.x, S.z - E.z) < 120) n++; }
      if (n) E.hold += dt * Math.min(4, n);
    }
  }
  function eventWon(E, uid) {
    if (E.obj === 'checkpoints' && E.cps) return (E.cp && E.cp.get(uid) || 0) >= E.cps.length;
    if (E.obj === 'hold') return (E.hold || 0) >= (E.holdSecs || 120) && (E.time.get(uid) || 0) >= 20;
    return (E.time.get(uid) || 0) >= CFG.EVENT_STAY_S;
  }
  function eventRewarded(uid, E) { const S = online.get(uid); if (S) { addXP(S, E.xp || 400, 'event'); metric(S, 'events', 1); } }
  function eventExtra(E) { return { obj: E.obj, cps: E.cps || null, hold: E.obj === 'hold' ? { t: Math.floor(E.hold || 0), of: E.holdSecs } : null, xp: E.xp }; }

  // ---------------------------------------------------------------- what the browser receives
  function seasonInfo() {
    const S0 = D.SEASONS[SEASON.key];
    const C = campaign();
    return { key: SEASON.key, id: SEASON.id, name: S0.name, title: S0.title, blurb: S0.blurb, accent: S0.accent, accent2: S0.accent2, start: SEASON.start, end: SEASON.end, preview: !!SEASON.preview,
      tiers: D.TIERS, maxTier: D.MAX_TIER, passChapters: D.CHAPTERS[SEASON.key], tierXP: D.TIER_XP, premiumPrice: D.PREMIUM_PRICE, chapterGapDays: CHAPTER_GAP / DAY,
      chapters: C ? C.chapters.map(c => ({ n: c.n, title: c.title, blurb: c.blurb, opensAt: chapterOpensAt(c.n) })) : null,
      plans: D.CAMPAIGN_PLANS, holidays: D.HOLIDAYS.map(H => ({ id: H.id, name: H.name, hunt: H.hunt, items: H.items, n: H.spots.length, dates: nextHoliday(H, now()) })), seasons: Object.values(D.SEASONS).map(s => ({ key: s.key || s.id, name: s.name, title: s.title, start: s.start, end: s.end, accent: s.accent })) };
  }
  function contentFor() { // static content for display (sent once per connection)
    const C = campaign();
    const npcs = {}; for (const [k, v] of Object.entries(D.NPCS)) npcs[k] = { ...v, pos: place(v.at) };
    const steps = s => ({ ...s, pos: s.at ? place(s.at) : null });
    return { items: D.ITEMS, pass: D.PASSES[SEASON.key], npcs,
      campaign: C ? { id: C.id, title: C.title, intro: C.intro, chapters: C.chapters.map(c => ({ ...c, steps: c.steps.map(steps) })), side: C.side.map(Q => ({ ...Q, steps: Q.steps.map(steps) })), rewards: C.rewards, finale: { ...C.finale, posts: C.finale.posts.map(p => ({ ...p, pos: place(p.at) })) } } : null };
  }
  function fullState(S) {
    return { t: 'sState', season: seasonInfo(), content: contentFor(), xp: S.sp.xp, tier: tierOf(S.sp.xp), boost: boostOf(S), premium: S.sp.premium, claims: [...S.claims], owned: [...S.owned], equip: S.cos,
      story: storyState(S), chal: chalList(S), hol: holState(S), events: upcoming(), finale: finaleInfo(), nextFinale: campaign() ? Math.max(nextFinale, chapterOpensAt((campaign().chapters || []).length)) : null };
  }

  // ---------------------------------------------------------------- message handlers
  const H = {
    sAct: onAct,
    sHunt: onHunt,
    async sClaim(S, m) {
      const tier = Math.floor(Number(m.tier)), track = m.track === 'premium' ? 'premium' : 'free';
      const row = (D.PASSES[SEASON.key] || [])[tier - 1]; if (!row) return;
      if (tier > tierOf(S.sp.xp)) return err(S, `Reach tier ${tier} first.`);
      if (track === 'premium' && !S.sp.premium) return err(S, 'Unlock the premium track first.');
      let rw = row[track]; if (!rw) return;
      if (rw.chest) {   // a chest: the player picks one option; anything else is refused
        const pick = Math.floor(Number(m.pick));
        if (!(pick >= 0 && pick < rw.chest.opts.length)) return err(S, 'Choose one reward from the chest.');
        rw = rw.chest.opts[pick];
      }
      const key = tier + ':' + track; if (S.claims.has(key)) return;
      S.claims.add(key);
      try { await db.insert('season_claims', { user_id: S.id, season_id: SEASON.id, tier, track }, { returning: false }); }
      catch (e) { if (e.status === 409 || e.code === '23505') return send(S, { t: 'sClaims', claims: [...S.claims] }); S.claims.delete(key); return err(S, 'Could not claim that reward. Try again.'); }
      await applyReward(S, rw, 'pass:' + SEASON.id + ':' + key);
      dirty(S); await savePlayer(S);
      send(S, { t: 'sClaims', claims: [...S.claims], got: { tier, track, rw } });
    },
    async sPremium(S) {
      if (S.sp.premium) return;
      if (!(await changeGold(S.id, -D.PREMIUM_PRICE, 'premium battle pass', 'premium:' + SEASON.id))) return err(S, `The premium track costs ${D.PREMIUM_PRICE.toLocaleString('en')} gold.`);
      S.sp.premium = true; dirty(S); await savePlayer(S);
      toast(S, `Premium track unlocked for ${D.SEASONS[SEASON.key].name}!`, 'gold');
      send(S, { t: 'sPremium', premium: true });
    },
    async sEquip(S, m) {
      const slot = SLOTS.includes(m.slot) ? m.slot : null; if (!slot) return;
      if (m.item === null || m.item === '') delete S.cos[slot];
      else { const it = D.ITEMS[m.item]; if (!it || it.kind !== slot || !S.owned.has(m.item)) return err(S, 'You do not own that.'); S.cos[slot] = m.item; }
      await q(db.update('characters', { user_id: S.id }, { equipped: S.cos }));
      send(S, { t: 'sEquip', equip: S.cos });
      ctx.announcePlayer(S);
    },
    async sDonate(S, m) { return donate(S, Number(m.n), false); },
    sSync(S) { send(S, fullState(S)); },
  };

  // ---------------------------------------------------------------- lifecycle hooks used by server.js
  return {
    handlers: H,
    async onEnter(S) { await loadPlayer(S); send(S, fullState(S)); fundRewards(S); },
    async onLeave(S) { await savePlayer(S); },
    async flushAll() { for (const S of online.values()) await savePlayer(S); },
    addXPAdmin(S, n) { addXP(S, n, 'admin'); },
    calendar: { seasonAt, holidaysAt, easterSunday },
    onMove, metric, cosPublic, eventTick, eventWon, eventRewarded, eventExtra, nextLiveEvent, startFinale,
    emoteAllowed(S, e) { if (['wave', 'bow', 'cheer', 'salute', 'dance', 'laugh'].includes(e)) return e; for (const id of (S.owned || [])) { const it = D.ITEMS[id]; if (it && it.kind === 'emote' && it.data.e === e) return e; } return null; },
    emoteVerb(e) { for (const it of Object.values(D.ITEMS)) if (it.kind === 'emote' && it.data.e === e) return it.data.verb; return null; },
    title(S) { return S.cos && S.cos.title ? D.ITEMS[S.cos.title].data.text : null; },
    async init() { await loadFund(); planEvents(); log(`season: ${D.SEASONS[SEASON.key].name} (${SEASON.id})${SEASON.preview ? ' PREVIEW' : ''}; holidays: ${HOLS.map(h => h.name).join(', ') || 'none'}`); },
    async tick(dt) {
      // season rollover and holidays, from the server's clock
      const ns = seasonAt(now());
      if (ns.id !== SEASON.id) {
        for (const S of online.values()) await savePlayer(S);
        SEASON = ns; schedule.length = 0; FIN = null; await loadFund();
        system('global', `A new season begins: ${D.SEASONS[SEASON.key].name}, ${D.SEASONS[SEASON.key].title}.`);
        for (const S of online.values()) if (S.ready) { await loadPlayer(S); send(S, fullState(S)); }
      }
      const nh = holidaysAt(now());
      if (nh.map(h => h.key).join() !== HOLS.map(h => h.key).join()) { const started = nh.filter(h => !HOLS.some(o => o.key === h.key)); HOLS = nh; for (const h of started) system('global', `${h.name} has begun! ${h.hunt}.`); each(S => send(S, { t: 'sHol', hol: holState(S) })); }
      for (const S of online.values()) {
        if (!S.ready || !S.sp) continue;
        S.minAcc = (S.minAcc || 0) + dt; if (S.minAcc >= 60) { S.minAcc -= 60; metric(S, 'mins', 1); }
        townTick(S);
        await storyTick(S, dt);
        if (S.spDirty && now() - (S.spSaved || 0) > 10000) { S.spSaved = now(); savePlayer(S); }
      }
      await finaleTick(dt);
    },
  };
};
