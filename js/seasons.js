/* =====================================================================
   AGE OF CROWNS: SEASONS IN THE BROWSER
   The Season panel (Tab), story characters and objectives in the world,
   the battle pass, challenges, calendar and wardrobe, seasonal atmosphere,
   decorations and holiday hunts, and graphics quality settings.
   Everything here only DISPLAYS what the server says and ASKS the server to act;
   the server decides every step, XP point, reward and unlock.
   ===================================================================== */
(function () {
  'use strict';
  const A = () => window.AOC;
  const NET = () => window.AOC_NET;
  const HOOK = () => window.AOC_HOOK || (window.AOC_HOOK = {});
  const send = m => !!(NET() && NET().send(m));
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, c) => { try { A().toast(m, c); } catch (e) { console.log(m); } };
  const inPlay = () => A() && A().state === 'play';
  const P = () => A().P;
  const fmtN = n => Math.round(n).toLocaleString('en');
  // calendar dates are UTC days (the server's clock), so show them in UTC
  const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtShort = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtLocalDay = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const leftTxt = ms => { if (ms <= 0) return 'now'; const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60; return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const GAME_SEASON = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
  const SLOT_NAMES = { outfit: 'Outfits', hat: 'Hats', title: 'Titles', plate: 'Nameplates', balloon: 'Balloon envelopes', sails: 'Ship sails', gunfin: 'Weapon finishes', emote: 'Emotes' };
  const RARITY = { common: '#9aa3ad', rare: '#4f8fd8', epic: '#a065d8', legendary: '#e0a030', mythic: '#e05a5a' };

  const SS = {
    ready: false, season: null, content: null, xp: 0, tier: 0, premium: false, claims: new Set(), owned: new Set(), equip: {},
    story: null, chal: [], hol: [], events: [], finale: null, nextFinale: null, tab: 'home', open: false, prev: null,
    npcs: {}, marks: [], holds: {}, evcp: {}, built: false, deco: new Map(), decoT: 0, gfx: 'auto', parts: null, fw: [], fwT: 0, preview: null,
  };
  try { SS.gfx = localStorage.getItem('aoc_gfx') || 'auto'; } catch (e) {}
  const items = () => (SS.content && SS.content.items) || {};
  const C = () => SS.content && SS.content.campaign;

  // ---------------------------------------------------------------- messages from the server
  const RX = {
    sState(m) {
      Object.assign(SS, { season: m.season, content: m.content, xp: m.xp, tier: m.tier, premium: m.premium, claims: new Set(m.claims), owned: new Set(m.owned), equip: m.equip || {},
        story: m.story, chal: m.chal, hol: m.hol, events: m.events, finale: m.finale, nextFinale: m.nextFinale, boost: m.boost || null });
      const first = !SS.ready; SS.ready = true;
      applySeasonToWorld(); applyCos(); buildHUD(); spawnNPCs(); refreshMarks();
      if (first) toast(`${m.season.name} season: ${m.season.title}. Press Tab for the Season panel.`, 'gold');
      render();
    },
    sXP(m) { const before = SS.tier; SS.xp = m.xp; SS.tier = Math.min(SS.season ? (SS.season.maxTier || SS.season.tiers) : 100, Math.floor(m.xp / (SS.season ? SS.season.tierXP : 1500))); floatXP(m.gain, m.why, m.boosted); hud(); if (SS.open) render(); if (SS.tier > before) pulseHUD(); },
    sStep(m) {
      const s = findStep(m.id);
      if (m.msg) A().openPanel(s ? stepTitle(s) : 'Done', s ? 'Objective complete' : '', `<p>${esc(m.msg)}</p>`, [{ label: 'Continue', primary: true, close: true, fn: () => A().closePanel() }]);
      else toast(`Objective complete: ${s ? s.obj : m.id}`, 'gold');
      try { A().sfxChime && A().sfxChime(); } catch (e) {}
    },
    sStory(m) { SS.story = m.story; refreshMarks(); hud(); if (SS.open) render(); },
    sChal(m) { SS.chal = m.list; if (SS.open) render(); },
    sClaims(m) { SS.claims = new Set(m.claims); if (m.got) reveal(m.got); if (SS.open) render(); },
    sBoost(m) { SS.boost = m.boost; hud(); if (SS.open) render(); },
    sOwn(m) { SS.owned = new Set(m.items); if (SS.open) render(); },
    sEquip(m) { SS.equip = m.equip || {}; applyCos(); if (SS.open) render(); },
    sPremium(m) { SS.premium = !!m.premium; if (SS.open) render(); },
    sHol(m) { SS.hol = m.hol; SS.deco.forEach(d => removeDeco(d)); SS.deco.clear(); refreshMarks(); if (SS.open) render(); },
    sHold(m) { SS.holds[m.id] = m; hud(); },
    sFinale(m) { SS.finale = m.fin; if (m.fin === null && m.won === true) { toast('The Concord Assembly is won!', 'gold'); } refreshMarks(); hud(); if (SS.open) render(); },
    sFund(m) { if (SS.story && SS.story.fund) SS.story.fund.total = m.total; if (SS.open) render(); },
    sEvCp(m) { SS.evcp[m.id] = m.i; toast(`Checkpoint ${m.i} of ${m.of}`, 'gold'); },
    sCampaignDone(m) {
      const its = (m.items || []).map(id => items()[id] ? items()[id].name : id);
      A().openPanel('The Broken Crown is mended', 'Campaign complete', `<p>You have completed the ${esc(SS.season.name)} campaign. The realm will remember it.</p><p><b>Rewards:</b> ${fmtN(m.gold)} gold, ${its.map(esc).join(', ')} and a title that depends on the choice you made over the crown.</p><p>Equip them in the Season panel’s Wardrobe (Tab).</p>`,
        [{ label: 'Open the Wardrobe', primary: true, close: true, fn: () => { A().closePanel(); openPanel('wardrobe'); } }, { label: 'Later', close: true, fn: () => A().closePanel() }]);
    },
  };
  function rx(m) { const h = RX[m.t]; if (h) h(m); }

  // ---------------------------------------------------------------- story lookups
  function allSteps() { const c = C(); if (!c) return []; const out = []; for (const ch of c.chapters) for (const s of ch.steps) out.push({ ...s, q: 'main', ch: ch.n }); for (const Q of c.side) for (const s of Q.steps) out.push({ ...s, q: Q.id, side: Q }); return out; }
  function findStep(id) { return allSteps().find(s => s.id === id) || null; }
  function stepTitle(s) { if (s.side) return s.side.title; const ch = C().chapters.find(c => c.n === s.ch); return ch ? `Chapter ${ch.n}: ${ch.title}` : ''; }
  function activeSteps() {
    const st = SS.story; if (!st || st.none) return [];
    const out = [];
    if (st.main && st.main.open) { const s = findStep(st.main.id); if (s) out.push(s); }
    for (const a of st.sides || []) { const s = findStep(a.step); if (s) out.push({ ...s, q: a.q }); }
    return out;
  }
  const mainStep = () => { const st = SS.story; return st && st.main ? findStep(st.main.id) : null; };

  // ---------------------------------------------------------------- the season in the world
  function applySeasonToWorld() {
    if (!SS.season) return;
    const H = HOOK();
    H.season = GAME_SEASON[SS.season.key];
    H.atmo = atmo;
    try { A().applySeason && A().applySeason(); } catch (e) {}
    applyQuality();
  }
  const TINT = { spring: { fog: [0.96, 0.88, 0.91], k: .08, dens: 1.0, sun: 1.0 }, summer: { fog: [1.0, 0.95, 0.82], k: .06, dens: .85, sun: 1.08 }, autumn: { fog: [0.93, 0.74, 0.5], k: .12, dens: 1.12, sun: .96 }, winter: { fog: [0.88, 0.92, 0.97], k: .14, dens: 1.18, sun: .9 } };
  function atmo(dt, fx, fz) {
    if (!SS.season || !inPlay()) return;
    const sc = A().scene, T = TINT[SS.season.key], night = A().nightF || 0;
    if (sc.fog) {
      // blend the fog toward the season's tint at the same brightness, less at night
      const k = T.k * (1 - night * .7), c = sc.fog.color, lum = (c.r + c.g + c.b) / 3 * 1.04;
      c.r += (T.fog[0] * lum - c.r) * k; c.g += (T.fog[1] * lum - c.g) * k; c.b += (T.fog[2] * lum - c.b) * k;
      sc.fog.density *= T.dens * qualityFog();
    }
    try { const sun = A().sun; if (sun && sun.intensity !== SS.sunSet) { sun.intensity *= T.sun; SS.sunSet = sun.intensity; } } catch (e) {}   // only when the game has set a fresh value this frame
    particles(dt);
    fireworks(dt);
    SS.decoT -= dt; if (SS.decoT <= 0) { SS.decoT = 2; decorateNear(); }
    tickMarks(dt);
  }

  // ---- seasonal particles: petals, fireflies, falling leaves, light flurries
  function particles(dt) {
    const q = QUALITY[SS.gfx] || QUALITY.auto;
    const p = P(); const want = !!SS.season && q.parts > 0 && !p.inside;
    if (!SS.parts && want) {
      const N = Math.round(600 * q.parts), g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), ph = new Float32Array(N);
      for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - .5) * 70; pos[i * 3 + 1] = Math.random() * 30; pos[i * 3 + 2] = (Math.random() - .5) * 70; ph[i] = Math.random() * 6.3; }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: .28, vertexColors: true, transparent: true, opacity: .85, depthWrite: false });
      SS.parts = { pts: new THREE.Points(g, m), ph, key: null, N }; SS.parts.pts.frustumCulled = false; A().scene.add(SS.parts.pts);
    }
    if (!SS.parts) return;
    const pp = SS.parts; pp.pts.visible = want;
    if (!want) return;
    const key = SS.season.key, night = A().nightF || 0;
    const mode = key === 'summer' ? (night > .45 ? 'fireflies' : 'pollen') : key === 'spring' ? 'petals' : key === 'autumn' ? 'leaves' : 'flurries';
    const snowing = A().WX && A().WX.type === 'snow';
    if (pp.key !== mode) {
      pp.key = mode; const c = pp.pts.geometry.attributes.color.array;
      const pal = { petals: ['#f7c6d4', '#fbe3ea', '#f2a9bf', '#ffffff'], leaves: ['#d9772b', '#b8441f', '#e8a83a', '#8a5a2a'], fireflies: ['#fff1a0', '#d8ff9a'], pollen: ['#fff6d8'], flurries: ['#ffffff', '#eaf3ff'] }[mode];
      const tmp = new THREE.Color();
      for (let i = 0; i < pp.N; i++) { tmp.set(pal[i % pal.length]); c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b; }
      pp.pts.geometry.attributes.color.needsUpdate = true;
      pp.pts.material.size = { petals: .26, leaves: .34, fireflies: .3, pollen: .1, flurries: .18 }[mode];
      pp.pts.material.blending = mode === 'fireflies' ? THREE.AdditiveBlending : THREE.NormalBlending; pp.pts.material.needsUpdate = true;
    }
    const show = mode === 'pollen' ? .35 : mode === 'flurries' ? (snowing ? 0 : .5) : 1;
    pp.pts.material.opacity = (mode === 'fireflies' ? .5 + .5 * Math.sin(performance.now() / 300) : .85) * show;
    const cam = A().camera.position; pp.pts.position.set(cam.x, cam.y - 12, cam.z);
    const a = pp.pts.geometry.attributes.position.array, t = performance.now() / 1000;
    const fall = { petals: .9, leaves: 1.6, fireflies: -0.02, pollen: .15, flurries: 1.2 }[mode];
    for (let i = 0; i < pp.N; i++) {
      const j = i * 3, ph = pp.ph[i];
      if (mode === 'fireflies') { a[j] += Math.sin(t * .7 + ph) * dt * .6; a[j + 1] += Math.sin(t * 1.1 + ph * 2) * dt * .4; a[j + 2] += Math.cos(t * .6 + ph) * dt * .6; if (a[j + 1] > 10) a[j + 1] = 2; if (a[j + 1] < 0) a[j + 1] = 6; }
      else { a[j + 1] -= fall * dt * (1 + (i % 5) * .08); a[j] += Math.sin(t * 1.3 + ph) * dt * (mode === 'leaves' ? 1.4 : .8) + dt * .5; a[j + 2] += Math.cos(t * 1.1 + ph) * dt * .6; if (a[j + 1] < 0) { a[j + 1] = 28; a[j] = (Math.random() - .5) * 70; a[j + 2] = (Math.random() - .5) * 70; } }
      if (a[j] > 35) a[j] -= 70; if (a[j] < -35) a[j] += 70; if (a[j + 2] > 35) a[j + 2] -= 70; if (a[j + 2] < -35) a[j + 2] += 70;
    }
    pp.pts.geometry.attributes.position.needsUpdate = true;
  }

  // ---- New Year fireworks over the capitals at night
  function fireworks(dt) {
    const ny = (SS.hol || []).some(h => h.deco === 'fireworks'); if (!ny) return;
    const night = A().nightF || 0; if (night < .5) return;
    const p = P(); const caps = A().TOWNS.filter(t => t.type === 'capital' || t.type === 'market').filter(t => Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 1400);
    SS.fwT -= dt;
    if (SS.fwT <= 0 && caps.length && SS.fw.length < 6) {
      SS.fwT = .7 + Math.random() * 1.2;
      const t = caps[Math.floor(Math.random() * caps.length)], N = 90, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), vel = [];
      const cx = t.x + (Math.random() - .5) * 80, cz = t.z + (Math.random() - .5) * 80, cy = A().heightAt(t.x, t.z) + 70 + Math.random() * 40;
      for (let i = 0; i < N; i++) { pos[i * 3] = cx; pos[i * 3 + 1] = cy; pos[i * 3 + 2] = cz; const u = Math.random() * 2 - 1, th = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = 16 + Math.random() * 8; vel.push([s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp]); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const col = ['#ffe36a', '#ff7a6a', '#8fe0ff', '#c9a0ff', '#9fff9a'][Math.floor(Math.random() * 5)];
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: col, size: 1.6, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      pts.frustumCulled = false; A().scene.add(pts); SS.fw.push({ pts, vel, t: 0 });
    }
    for (let i = SS.fw.length - 1; i >= 0; i--) {
      const f = SS.fw[i]; f.t += dt; const a = f.pts.geometry.attributes.position.array;
      for (let k = 0; k < f.vel.length; k++) { const v = f.vel[k]; v[1] -= 9 * dt; a[k * 3] += v[0] * dt; a[k * 3 + 1] += v[1] * dt; a[k * 3 + 2] += v[2] * dt; v[0] *= .985; v[2] *= .985; }
      f.pts.geometry.attributes.position.needsUpdate = true; f.pts.material.opacity = Math.max(0, 1 - f.t / 2.2);
      if (f.t > 2.2) { A().scene.remove(f.pts); f.pts.geometry.dispose(); f.pts.material.dispose(); SS.fw.splice(i, 1); }
    }
  }

  // ---- town decorations for the season and any live holiday (built only near you, merged into one mesh per town)
  function okSpot(x, z) {
    const h = A().heightAt(x, z); if (!(h > .7 && h < 70)) return false;
    if (Math.abs(A().groundAt(x, z) - h) > .3) return false;
    for (let k = 0; k < 6; k++) { const q = new THREE.Vector3(x + Math.cos(k) * 1.4, 0, z + Math.sin(k) * 1.4), ox = q.x, oz = q.z; A().collide(q, 1); if (Math.abs(q.x - ox) + Math.abs(q.z - oz) > .01) return false; }
    return true;
  }
  function spotsFor(t, n, f0, f1, seed) {
    const out = []; let s = seed || 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n * 12 && out.length < n; i++) { const a = rnd() * 6.283, d = t.r * (f0 + rnd() * (f1 - f0)); const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d; if (okSpot(x, z) && out.every(o => Math.hypot(o.x - x, o.z - z) > 9)) out.push({ x, z, y: A().heightAt(x, z), a }); }
    return out;
  }
  const DECO = {
    blossom(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#6a4a32', TM(p.x, p.y + 1.6, p.z, .35, 3.2, .35)); for (let i = 0; i < 5; i++) { const a = i * 1.26; b.add(GB.sph, i % 2 ? '#f6c3d1' : '#fbe1e8', TM(p.x + Math.cos(a) * 1.3, p.y + 3.8 + (i % 3) * .5, p.z + Math.sin(a) * 1.3, 1.7, 1.4, 1.7)); } },
    planter(b, p) { const { GB, TM } = A(); b.add(GB.box, '#7a5a38', TM(p.x, p.y + .3, p.z, 2.2, .6, .9)); const c = ['#f2a9bf', '#f7e07a', '#ffffff', '#c9a0ff']; for (let i = 0; i < 5; i++) b.add(GB.sph, c[i % 4], TM(p.x - .8 + i * .4, p.y + .75, p.z, .28)); },
    maypole(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#f4efe4', TM(p.x, p.y + 4, p.z, .22, 8, .22)); b.add(GB.sph, '#f2a9bf', TM(p.x, p.y + 8.1, p.z, .6)); const c = ['#e9536a', '#f7e07a', '#5fb3d6', '#8fcf6a', '#c9a0ff', '#ffffff']; for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; b.add(GB.box, c[i], TM(p.x + Math.cos(a) * 1.9, p.y + 4.2, p.z + Math.sin(a) * 1.9, .08, 7.6, .25, Math.sin(a) * .5, 0, -Math.cos(a) * .5)); } },
    bunting(b, p) { const { GB, TM } = A(); const q = { x: p.x + Math.cos(p.a + 1.57) * 10, z: p.z + Math.sin(p.a + 1.57) * 10 }; if (!okSpot(q.x, q.z)) return; const qy = A().heightAt(q.x, q.z); for (const r of [{ x: p.x, z: p.z, y: p.y }, { x: q.x, z: q.z, y: qy }]) b.add(GB.cyl, '#6a4a32', TM(r.x, r.y + 2.5, r.z, .15, 5, .15)); const c = ['#e9536a', '#f3c45a', '#5fb3d6', '#f4efe4']; for (let i = 1; i < 12; i++) { const f = i / 12, x = p.x + (q.x - p.x) * f, z = p.z + (q.z - p.z) * f, y = p.y + (qy - p.y) * f + 4.8 - Math.sin(f * Math.PI) * .9; b.add(GB.cone, c[i % 4], TM(x, y, z, .45, .7, .08, Math.PI, Math.atan2(q.x - p.x, q.z - p.z) + 1.57, 0)); } },
    stall(b, p) { const { GB, TM } = A(); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(GB.cyl, '#6a4a32', TM(p.x + sx * 1.6, p.y + 1.3, p.z + sz * 1, .1, 2.6, .1)); for (let i = 0; i < 6; i++) b.add(GB.box, i % 2 ? '#f4efe4' : '#d9705a', TM(p.x - 1.5 + i * .6, p.y + 2.7, p.z, .6, .12, 2.4)); b.add(GB.box, '#8a6a42', TM(p.x, p.y + .9, p.z, 3, .2, 1.8)); b.add(GB.sph, '#f3c45a', TM(p.x - .7, p.y + 1.15, p.z, .3)); b.add(GB.sph, '#8fcf6a', TM(p.x + .4, p.y + 1.15, p.z, .3)); },
    pumpkin(b, p, lit) { const { GB, TM } = A(); for (let i = 0; i < 3; i++) { const x = p.x + i * 1.1 - 1, z = p.z + (i % 2) * .7; b.add(GB.sph, '#e0782a', TM(x, p.y + .45, z, .75, .55, .75)); b.add(GB.cyl, '#4a6a2a', TM(x, p.y + 1, z, .07, .25, .07)); if (lit) b.add(GB.sph, '#ffd25a', TM(x, p.y + .5, z + .62, .22, .14, .05)); } },
    hay(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#d9b85a', TM(p.x, p.y + .7, p.z, .9, 1.6, .9, 0, 0, Math.PI / 2)); b.add(GB.cyl, '#cfae52', TM(p.x + .4, p.y + 1.9, p.z + .3, .8, 1.4, .8, 0, 0, Math.PI / 2)); for (let i = 0; i < 3; i++) b.add(GB.cone, '#e8c86a', TM(p.x + 2 + i * .5, p.y + .9, p.z - .5, .3, 1.8, .3)); },
    snowman(b, p) { const { GB, TM } = A(); b.add(GB.sph, '#f8fbff', TM(p.x, p.y + .7, p.z, .9)); b.add(GB.sph, '#f8fbff', TM(p.x, p.y + 1.85, p.z, .65)); b.add(GB.sph, '#f8fbff', TM(p.x, p.y + 2.75, p.z, .45)); b.add(GB.cone, '#f08a2a', TM(p.x, p.y + 2.75, p.z + .5, .08, .4, .08, Math.PI / 2, 0, 0)); b.add(GB.cyl, '#222', TM(p.x, p.y + 3.3, p.z, .38, .5, .38)); b.add(GB.box, '#c0303a', TM(p.x, p.y + 2.35, p.z, .9, .14, .9)); },
    lantern(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#2a2a2e', TM(p.x, p.y + 1.6, p.z, .1, 3.2, .1)); b.add(GB.box, '#ffd27a', TM(p.x, p.y + 3.3, p.z, .5, .6, .5)); b.add(GB.cone, '#2a2a2e', TM(p.x, p.y + 3.75, p.z, .4, .35, .4)); },
    xmastree(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#5a3a20', TM(p.x, p.y + .8, p.z, .4, 1.6, .4)); for (let i = 0; i < 4; i++) b.add(GB.cone, '#2e6b3a', TM(p.x, p.y + 2.2 + i * 1.5, p.z, 3.2 - i * .7, 2.6, 3.2 - i * .7)); const c = ['#c0303a', '#e2b84a', '#5fb3d6', '#f4f1ea']; for (let i = 0; i < 18; i++) { const a = i * 2.4, h = 1.8 + (i % 6) * .95, r = 2.6 - (h - 1.8) * .42; b.add(GB.sph, c[i % 4], TM(p.x + Math.cos(a) * r, p.y + h, p.z + Math.sin(a) * r, .22)); } b.add(GB.sph, '#ffe36a', TM(p.x, p.y + 8.4, p.z, .45)); },
    heart(b, p) { const { GB, TM } = A(); b.add(GB.cyl, '#6a4a32', TM(p.x, p.y + 1.6, p.z, .1, 3.2, .1)); b.add(GB.sph, '#d9475f', TM(p.x - .32, p.y + 3.4, p.z, .45, .45, .15)); b.add(GB.sph, '#d9475f', TM(p.x + .32, p.y + 3.4, p.z, .45, .45, .15)); b.add(GB.cone, '#d9475f', TM(p.x, p.y + 2.85, p.z, .62, .7, .15, Math.PI, 0, 0)); },
    bonfire(b, p) { const { GB, TM } = A(); for (let i = 0; i < 6; i++) { const a = i * 1.05; b.add(GB.cyl, '#5a3a20', TM(p.x + Math.cos(a) * .5, p.y + .9, p.z + Math.sin(a) * .5, .12, 2, .12, Math.cos(a) * .5, 0, Math.sin(a) * .5)); } b.add(GB.cone, '#ff9a2a', TM(p.x, p.y + 1.6, p.z, .8, 2, .8)); b.add(GB.cone, '#ffe36a', TM(p.x, p.y + 1.4, p.z, .45, 1.3, .45)); },
    eggs(b, p) { const { GB, TM } = A(); const c = ['#9fd2f0', '#f7c6d4', '#f7e07a', '#b8e6a0', '#d8b8ff']; for (let i = 0; i < 5; i++) b.add(GB.sph, c[i], TM(p.x + Math.cos(i * 1.3) * .8, p.y + .3, p.z + Math.sin(i * 1.3) * .8, .22, .3, .22)); },
  };
  function decoPlan(t) {
    const key = SS.season.key, big = t.type !== 'village', hol = (SS.hol || []).map(h => h.deco);
    const plan = [];
    if (key === 'spring') { plan.push(['blossom', big ? 6 : 3, .55, .95], ['planter', big ? 4 : 2, .3, .7]); if (t.type === 'capital' || t.type === 'city' || t.type === 'market') plan.push(['maypole', 1, .15, .4]); }
    if (key === 'summer') { plan.push(['bunting', big ? 3 : 1, .3, .7]); if (big) plan.push(['stall', 3, .3, .7]); }
    if (key === 'autumn') { plan.push(['hay', big ? 3 : 2, .5, .95], ['pumpkin', big ? 3 : 2, .3, .8]); if (big) plan.push(['stall', 2, .3, .7]); }
    if (key === 'winter') { plan.push(['snowman', big ? 3 : 1, .3, .8], ['lantern', big ? 5 : 2, .3, .8]); }
    if (hol.includes('pumpkins')) plan.push(['jack', big ? 5 : 3, .2, .9]);
    if (hol.includes('winterfest') && big) plan.push(['xmastree', 1, .1, .35], ['lantern', 3, .3, .8]);
    if (hol.includes('hearts')) plan.push(['heart', big ? 4 : 2, .3, .8]);
    if (hol.includes('eggs')) plan.push(['eggs', big ? 3 : 1, .3, .9]);
    if (hol.includes('bunting')) plan.push(['bunting', 2, .3, .7], ['bonfire', 1, .5, .9]);
    if (hol.includes('fireworks') && big) plan.push(['lantern', 4, .3, .8]);
    return plan;
  }
  function buildDeco(t) {
    const { VB, MOUSEMAT } = A(); const b = new VB(); let n = 0, seed = t.idx * 97 + 13;
    for (const [kind, cnt, f0, f1] of decoPlan(t)) for (const p of spotsFor(t, cnt, f0, f1, seed++)) { if (kind === 'jack') DECO.pumpkin(b, p, true); else DECO[kind](b, p); n++; }
    if (!n) return { t, mesh: null };
    const mesh = new THREE.Mesh(b.geometry(), MOUSEMAT); mesh.castShadow = true; mesh.receiveShadow = true; A().scene.add(mesh);
    return { t, mesh };
  }
  function removeDeco(d) { if (d && d.mesh) { A().scene.remove(d.mesh); d.mesh.geometry.dispose(); } }
  function decorateNear() {
    if (!SS.season || (QUALITY[SS.gfx] || QUALITY.auto).deco === false) { SS.deco.forEach(d => removeDeco(d)); SS.deco.clear(); return; }
    const p = P().pos;
    for (const t of A().TOWNS) {
      const d = Math.hypot(t.x - p.x, t.z - p.z), has = SS.deco.get(t.idx);
      if (d < 650 && !has) { SS.deco.set(t.idx, buildDeco(t)); return; }   // at most one town per call, to avoid stutter
      if (d > 950 && has) { removeDeco(has); SS.deco.delete(t.idx); }
    }
  }

  // ---------------------------------------------------------------- story characters and objective markers
  function spawnNPCs() {
    if (!SS.content || !SS.content.npcs || SS.built) return;
    SS.built = true;
    for (const [id, n] of Object.entries(SS.content.npcs)) {
      if (!n.pos) continue;
      const L = n.look || {};
      try {
        const npc = A().addNPC({ kind: 'story', name: n.name, title: n.name, x: n.pos.x, z: n.pos.z, still: true, yaw: 0, yaw0: 0, fur: L.fur, coat: L.coat, trim: L.trim, hat: L.hat, hatCol: L.hatCol, musket: !!L.musket, epaulettes: !!L.epaulettes, crossbelt: !!L.crossbelt, apron: !!L.apron, hp: 9999 });
        npc.storyId = id; npc.onTalk = () => talkTo(id);
        SS.npcs[id] = npc;
      } catch (e) { console.warn('[seasons] npc', id, e); }
    }
  }
  function markMesh(kind) {
    const g = new THREE.Group();
    const col = kind === 'hunt' ? 0x9fe0ff : kind === 'post' ? 0xff8a6a : kind === 'cp' ? 0x8fff9a : 0xffd25a;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 30; g.add(beam);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.6), new THREE.MeshBasicMaterial({ color: col })); gem.position.y = 3.2; g.add(gem); g.userData.gem = gem;
    return g;
  }
  function clearMarks() { for (const m of SS.marks) A().scene.remove(m.g); SS.marks = []; }
  function refreshMarks() {
    if (!A() || !A().scene) return;
    clearMarks();
    const add = (kind, pos, info) => { if (!pos) return; const g = markMesh(kind); g.position.set(pos.x, A().heightAt(pos.x, pos.z), pos.z); A().scene.add(g); SS.marks.push({ g, kind, pos, ...info }); };
    for (const s of activeSteps()) if (s.pos && s.type !== 'finale') add('story', s.pos, { step: s });
    if (SS.finale) for (const p of SS.finale.posts) add('post', p, { post: p });
    for (const h of SS.hol || []) for (const sp of h.spots) if (!h.found.includes(sp.n)) add('hunt', sp, { hol: h, spot: sp.n });
  }
  function tickMarks(dt) {
    const t = performance.now() / 1000;
    for (const m of SS.marks) { const gem = m.g.userData.gem; gem.rotation.y += dt * 2; gem.position.y = 3.2 + Math.sin(t * 2) * .3; }
    // live event checkpoints: show only the next one, near the event
    const evs = NET() && NET().state && NET().state.events;
    if (evs) for (const E of evs.values()) {
      if (!E.cps) continue; const i = SS.evcp[E.id] || 0; const p = E.cps[i];
      let m = SS.marks.find(x => x.ev === E.id);
      if (!p) { if (m) { A().scene.remove(m.g); SS.marks.splice(SS.marks.indexOf(m), 1); } continue; }
      if (!m) { const g = markMesh('cp'); A().scene.add(g); m = { g, kind: 'cp', ev: E.id, pos: p }; SS.marks.push(m); }
      if (m.pos !== p) m.pos = p;
      m.g.position.set(p.x, Math.max(A().heightAt(p.x, p.z), 0), p.z);
    }
    prompt();
  }
  // what pressing E does near a story spot or a holiday find
  function nearAct() {
    if (!inPlay() || !SS.ready) return null;
    const p = P().pos; if (P().inside) return null;
    for (const s of activeSteps()) {
      if (!s.pos || !['talk', 'search', 'choice', 'pay'].includes(s.type)) continue;
      const r = Math.min(s.r || 7, 7);
      if (Math.hypot(p.x - s.pos.x, p.z - s.pos.z) <= r) return { s, label: s.type === 'search' ? 'Search here' : s.type === 'pay' ? (s.gold ? `Pay ${s.gold} gold` : `Hand over ${s.n} ${s.cargo}`) : s.npc && SS.content.npcs[s.npc] ? `Talk to ${SS.content.npcs[s.npc].name}` : 'Decide' };
    }
    for (const h of SS.hol || []) for (const sp of h.spots) if (!h.found.includes(sp.n) && Math.hypot(p.x - sp.x, p.z - sp.z) <= 6) return { hunt: h, spot: sp.n, label: `${h.name}: take it` };
    return null;
  }
  function prompt() {
    let el = $('ssnPrompt'); const a = nearAct();
    if (!a || A().uiOpen()) { if (el) el.style.display = 'none'; return; }
    if (!el) { el = document.createElement('div'); el.id = 'ssnPrompt'; el.className = 'ssnprompt'; document.body.appendChild(el); }
    el.style.display = ''; el.textContent = 'E  ·  ' + a.label;
  }
  function interact() {
    const a = nearAct(); if (!a) return false;
    if (a.hunt) { send({ t: 'sHunt', h: a.hunt.id, spot: a.spot }); return true; }
    stepDialog(a.s); return true;
  }
  function talkTo(id) {
    const n = SS.content.npcs[id]; const s = activeSteps().find(x => x.npc === id && ['talk', 'choice', 'pay'].includes(x.type));
    const p = P().pos;
    if (s && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) <= (s.r || 7) + 2) return stepDialog(s);
    // not their turn in the story: a line in character
    const m = mainStep();
    const where = m && m.pos ? ` Your next task: ${m.obj}.` : '';
    A().openPanel(n.name, n.role, `<p>“${esc(idleLine(id))}”</p>${where ? `<p class="ssnsoft">${esc(where)}</p>` : ''}`, [{ label: 'Farewell', close: true, fn: () => A().closePanel() }]);
  }
  function idleLine(id) {
    const done = new Set((SS.story && SS.story.done) || []);
    const L = { elowen: done.has('c5s5') ? 'Iceharbour. Bring him home.' : 'Every hour we lose, the rumours grow teeth.', rook: 'Keep your eyes open and your back to a wall.', seraphine: 'Darling, I never have time for small talk. Only large talk.', corvin: 'The sea doesn’t care whose flag you fly. Neither do I, much.', hesk: '…Frosthold remembers.', marisol: 'Prices are up three percent since the crown broke. Wars start with prices.', jory: 'Can’t talk, I’m being inconspicuous.', ansel: 'Peace is a thing you do every day, or it stops.', aldric: 'Mended things are stronger at the seams.', wren: 'Letters, letters, letters!' };
    return L[id] || 'Good day.';
  }
  function stepDialog(s) {
    const n = s.npc ? SS.content.npcs[s.npc] : null;
    const lines = (s.say || []).map(l => `<p>${n ? '“' + esc(l) + '”' : esc(l)}</p>`).join('');
    const head = n ? n.name : stepTitle(s), sub = n ? n.role : s.obj;
    const go = opt => { send({ t: 'sAct', q: s.q, step: s.id, opt }); A().closePanel(); };
    if (s.type === 'choice') return A().openPanel(head, sub, lines + `<p class="ssnsoft">${esc(s.obj)}</p>`, s.options.map(o => ({ label: o.label, primary: true, close: true, fn: () => go(o.id) })).concat([{ label: 'Not yet', close: true, fn: () => A().closePanel() }]));
    if (s.type === 'pay') return A().openPanel(head, sub, lines + `<p><b>${s.gold ? `Cost: ${fmtN(s.gold)} gold` : `Needs: ${s.n} crates of ${esc(s.cargo)}`}</b>${s.community ? ' (counts toward the realm fund)' : ''}</p>`, [{ label: s.gold ? `Pay ${fmtN(s.gold)} gold` : 'Hand them over', primary: true, close: true, fn: () => go() }, { label: 'Not yet', close: true, fn: () => A().closePanel() }]);
    if (s.type === 'search') return go();
    return A().openPanel(head, sub, lines || `<p>${esc(s.obj)}</p>`, [{ label: 'Continue', primary: true, close: true, fn: () => go() }]);
  }

  // ---------------------------------------------------------------- map markers
  function mapMarkers(ctx, tr, scale) {
    if (!SS.ready) return;
    const dia = (x, y, r, c) => { ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.lineWidth = 2 * scale; ctx.strokeStyle = '#2a1a00'; ctx.stroke(); };
    for (const m of SS.marks) { const p = tr(m.pos.x, m.pos.z); dia(p[0], p[1], (m.kind === 'story' ? 9 : 6) * scale, m.kind === 'story' ? '#ffd25a' : m.kind === 'hunt' ? '#9fe0ff' : m.kind === 'post' ? '#ff8a6a' : '#8fff9a'); }
  }

  // ---------------------------------------------------------------- wardrobe effects in the game
  function applyCos() {
    const I = items(), E = SS.equip || {}, H = HOOK();
    H.cos = { balloon: E.balloon && I[E.balloon] ? I[E.balloon].data : null, sails: E.sails && I[E.sails] ? I[E.sails].data.col : null, gunfin: E.gunfin && I[E.gunfin] ? I[E.gunfin].data : null };
    H.cosLook = (o, dress) => {
      const out = Object.assign({}, o);
      if (H.cos.gunfin) out.gunfin = H.cos.gunfin;
      if (dress === 'civ') {
        const prev = SS.preview && I[SS.preview];
        const of = prev && prev.kind === 'outfit' ? prev.data : E.outfit && I[E.outfit] ? I[E.outfit].data : null;
        if (of) Object.assign(out, of);
        const hat = prev && prev.kind === 'hat' ? prev.data : E.hat && I[E.hat] ? I[E.hat].data : null;
        if (hat) Object.assign(out, hat);
      }
      return out;
    };
    try { if (inPlay()) A().outfit(); } catch (e) {}
  }

  // ---------------------------------------------------------------- graphics quality
  const QUALITY = {
    auto: { label: 'Automatic', parts: 1, deco: true },
    low: { label: 'Low (fastest)', pr: 1, shadow: 1024, range: 70, far: 3400, fog: 1.35, parts: 0, deco: false },
    medium: { label: 'Medium', pr: 1.25, shadow: 2048, range: 90, far: 5200, fog: 1.12, parts: .6, deco: true },
    high: { label: 'High', pr: 1.75, shadow: 4096, range: 100, far: 8500, fog: 1, parts: 1, deco: true },
    ultra: { label: 'Ultra (strong computers)', pr: 2, shadow: 4096, range: 160, far: 8500, fog: .88, parts: 1.4, deco: true },
  };
  const qualityFog = () => (QUALITY[SS.gfx] || QUALITY.auto).fog || 1;
  function applyQuality() {
    const q = QUALITY[SS.gfx]; if (!q || SS.gfx === 'auto' || !A()) return;
    try {
      const r = A().renderer, sun = A().sun, cam = A().camera;
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
      if (sun && sun.shadow) { if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } } const c = sun.shadow.camera; c.left = -q.range; c.right = q.range; c.top = q.range; c.bottom = -q.range; c.updateProjectionMatrix(); }
      if (cam) { cam.far = q.far; cam.updateProjectionMatrix(); }
    } catch (e) { console.warn('[seasons] quality', e); }
    if (SS.parts) { A().scene.remove(SS.parts.pts); SS.parts = null; }
  }

  // ---------------------------------------------------------------- HUD: season badge and objective tracker
  function buildHUD() {
    if ($('ssnHud')) return hud();
    const d = document.createElement('div'); d.id = 'ssnHud'; d.className = 'ssnhud';
    d.innerHTML = `<button class="ssnbadge" id="ssnBadge" title="Season panel (Tab)"></button><div class="ssnobj" id="ssnObj"></div><div class="ssnfin" id="ssnFin"></div>`;
    document.body.appendChild(d);
    $('ssnBadge').onclick = () => openPanel('home');
    $('ssnObj').onclick = () => openPanel('campaign');
    hud();
  }
  function hud() {
    const b = $('ssnBadge'); if (!b || !SS.season) return;
    const S0 = SS.season, need = S0.tierXP, into = SS.xp - SS.tier * need, pct = SS.tier >= (S0.maxTier || S0.tiers) ? 100 : Math.max(0, Math.min(100, into / need * 100));
    b.style.setProperty('--acc', S0.accent);
    const bo = boostLeft(), ready = claimable().length;
    b.innerHTML = `<span class="ssnleaf">❀</span><span class="ssnbt"><b>${esc(S0.name)}</b> · ${SS.tier > S0.tiers ? 'Bonus ' : ''}Tier ${SS.tier}</span><span class="ssnbar"><i style="width:${pct.toFixed(1)}%"></i></span>${bo ? `<span class="ssnboostc" title="XP boost">⚡×${SS.boost.mult} ${esc(leftTxt(bo))}</span>` : ''}${ready ? `<span class="ssnready" title="Rewards ready to claim">${ready}</span>` : ''}`;
    const o = $('ssnObj'), m = mainStep(), st = SS.story;
    if (st && st.none) o.innerHTML = '';
    else if (st && st.complete) o.innerHTML = `<b>${esc(C() ? C().title : '')}</b><span>Campaign complete</span>`;
    else if (m && st.main && !st.main.open) o.innerHTML = `<b>Chapter ${m.ch} opens ${esc(fmtShort(st.main.opensAt))}</b><span>${esc(m.obj)}</span>`;
    else if (m) {
      const p = inPlay() ? P().pos : null, d = p && m.pos ? Math.round(Math.hypot(p.x - m.pos.x, p.z - m.pos.z)) : null;
      const hold = m.type === 'hold' && SS.holds[m.id] ? ` · ${SS.holds[m.id].t}/${SS.holds[m.id].of}s` : '';
      o.innerHTML = `<b>${esc(stepTitle(m))}</b><span>${esc(m.obj)}${d !== null ? ` · ${fmtN(d)} paces` : ''}${hold}</span>`;
    } else o.innerHTML = '';
    const f = $('ssnFin');
    if (SS.finale) f.innerHTML = `<b>⚑ The Concord Assembly · ${esc(leftTxt(SS.finale.ends - Date.now()))} left</b>${SS.finale.posts.map(p => `<span>${esc(p.name)} <i style="width:${Math.min(100, p.t / p.of * 100).toFixed(0)}%"></i></span>`).join('')}`;
    else f.innerHTML = '';
    f.style.display = SS.finale ? '' : 'none';
  }
  setInterval(() => { if (SS.ready) hud(); }, 1000);
  function pulseHUD() { const b = $('ssnBadge'); if (!b) return; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
  function floatXP(n, why, boosted) { if (!(n > 0)) return; const d = document.createElement('div'); d.className = 'ssnxp'; d.textContent = `+${fmtN(n)} XP${boosted ? ' ⚡' : ''}`; document.body.appendChild(d); setTimeout(() => d.remove(), 1800); }

  // ---------------------------------------------------------------- the Season panel (Tab)
  const TABS = [['home', 'Season'], ['campaign', 'Story'], ['pass', 'Battle pass'], ['chal', 'Challenges'], ['cal', 'Calendar'], ['wardrobe', 'Wardrobe'], ['gfx', 'Graphics']];
  function openPanel(tab) {
    if (!SS.ready || !inPlay()) return;
    if (tab) SS.tab = tab;
    SS.open = true; document.body.classList.add('ssn-open'); try { A().releaseMouse(); } catch (e) {}
    $('modal').classList.remove('hidden'); render();
  }
  function closePanel() { SS.open = false; document.body.classList.remove('ssn-open'); if (SS.preview) { SS.preview = null; applyCos(); } $('modal').classList.add('hidden'); }
  function isOurs() { return SS.open && !$('modal').classList.contains('hidden') && $('mcontent').querySelector('.ssn'); }
  function render() {
    if (!SS.open) return;
    if (!isOurs() && $('modal').classList.contains('hidden')) { SS.open = false; return; }
    const S0 = SS.season; if (!S0) return;
    const keep = $('mcontent').querySelector('.ssnbody'), sc = keep ? keep.scrollTop : 0;
    $('mcontent').innerHTML = `<div class="ssn" style="--acc:${S0.accent};--acc2:${S0.accent2}">
      <div class="ssnhead"><div><div class="ssnkicker">${esc(S0.name)} season${S0.preview ? ' · preview' : ''}</div><h2 class="ssntitle">${esc(S0.title)}</h2></div>
      <div class="ssntier"><div class="ssntiern">${SS.tier}</div><div class="ssntierl">${SS.tier > S0.tiers ? 'bonus tier' : 'tier of ' + S0.tiers}</div></div></div>
      <div class="ssntabs">${TABS.map(([k, n]) => `<button data-st="${k}" class="${SS.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="ssnbody">${(VIEW[SS.tab] || VIEW.home)()}</div></div>`;
    const body = $('mcontent').querySelector('.ssnbody'); if (body && SS.prevTab === SS.tab) body.scrollTop = sc; SS.prevTab = SS.tab;
    $('mcontent').querySelectorAll('[data-st]').forEach(b => b.onclick = () => { SS.tab = b.dataset.st; SS.chestOpen = null; SS.prevSel = null; render(); });
    (WIRE[SS.tab] || (() => {}))();
  }
  const maxT = () => SS.season.maxTier || SS.season.tiers;
  const xpBar = () => { const S0 = SS.season, need = S0.tierXP, done = SS.tier >= maxT(), into = done ? need : SS.xp - SS.tier * need, nx = SS.tier + 1; return `<div class="ssnprog"><i style="width:${(into / need * 100).toFixed(1)}%"></i></div><div class="ssnsoft">${done ? 'Every tier reached. Well played!' : `${fmtN(into)} / ${fmtN(need)} XP to ${nx > S0.tiers ? 'bonus ' : ''}tier ${nx}`} · ${fmtN(SS.xp)} XP this season</div>`; };
  const boostLeft = () => SS.boost && SS.boost.until > Date.now() ? SS.boost.until - Date.now() : 0;
  // every reward the player could claim right now (chests included)
  function claimable() {
    if (!SS.content || !SS.content.pass) return [];
    const out = [];
    for (const r of SS.content.pass) { if (r.tier > SS.tier) break; if (r.free && !SS.claims.has(r.tier + ':free')) out.push([r, 'free']); if (SS.premium && r.premium && !SS.claims.has(r.tier + ':premium')) out.push([r, 'premium']); }
    return out;
  }
  const rwRarity = r => r.item ? ((items()[r.item] || {}).rarity || 'common') : r.chest ? r.chest.rarity : r.boost ? 'rare' : 'common';
  function rwLabel(r) {
    if (r.item) { const it = items()[r.item]; return it ? shortName(it) : r.item; }
    if (r.chest) return r.chest.name;
    const p = [];
    if (r.boost) p.push(`XP ×${r.boost.mult} for ${r.boost.mins >= 60 && r.boost.mins % 60 === 0 ? r.boost.mins / 60 + ' h' : r.boost.mins + ' min'}`);
    if (r.tonic) p.push(`${r.tonic} tonic${r.tonic === 1 ? '' : 's'}`);
    if (r.gold) p.push(`${fmtN(r.gold)} gold`);
    return p.join(' + ');
  }
  function rwIcon(r, big) {
    const c = 'ssnico' + (big ? ' big' : '');
    if (r.item) { const it = items()[r.item]; if (it) return `<span class="${c}" style="${icoStyle(it)}">${icoGlyph(it)}</span>`; }
    if (r.chest) return `<span class="${c} chest r-${r.chest.rarity}">❖</span>`;
    if (r.boost) return `<span class="${c} boost">⚡</span>`;
    if (r.tonic) return `<span class="${c} tonic">⚗</span>`;
    return `<span class="${c} gold">◉</span>`;
  }
  function rwDesc(r) {
    if (r.item) { const it = items()[r.item]; return it ? `${SLOT_NAMES[it.kind] || ''}${it.desc ? ' · ' + it.desc : ''}` : ''; }
    if (r.chest) return 'Open it to choose one of three rewards.';
    if (r.boost) return 'All XP you earn counts extra while it lasts. Boosts of the same strength add their time together.';
    if (r.tonic && !r.gold) return 'Healing tonics. Press 1 in the world to drink one.';
    if (r.gold && !r.tonic) return 'Paid straight into your purse by the server.';
    if (r.tonic && r.gold) return 'Healing tonics for the road (press 1 to drink one), plus gold.';
    return '';
  }
  // a small card that pops up when a reward arrives
  function reveal(got) {
    let d = $('ssnReveal'); if (!d) { d = document.createElement('div'); d.id = 'ssnReveal'; d.className = 'ssnreveal'; document.body.appendChild(d); }
    const r = got.rw; d.style.setProperty('--rc', RARITY[rwRarity(r)] || '#c9b48a');
    d.innerHTML = `${rwIcon(r, true)}<div><div class="ssnkicker">${got.tier > (SS.season ? SS.season.tiers : 100) ? 'Bonus tier' : 'Tier'} ${got.tier} · ${got.track === 'premium' ? 'Premium' : 'Free'}</div><b>${esc(rwLabel(r))}</b><div class="ssnsoft">${esc(rwRarity(r))}</div></div>`;
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
    clearTimeout(SS.revealT); SS.revealT = setTimeout(() => d.classList.remove('show'), 2600);
    try { A().sfxChime && A().sfxChime(); } catch (e) {}
  }
  function rewardCell(r, opts) {
    if (!r) return `<div class="ssnrw empty"></div>`;
    const st = opts.claimed ? 'claimed' : opts.ready ? 'ready' : 'locked', rar = rwRarity(r);
    return `<div class="ssnrw ${st}${opts.prem ? ' prem' : ''} r-${rar}${r.chest ? ' ischest' : ''}" style="--rc:${RARITY[rar]}" data-tier="${opts.tier}" data-track="${opts.prem ? 'premium' : 'free'}" title="${esc(rwLabel(r))}" tabindex="0">
      ${rwIcon(r)}<span class="ssnrn">${esc(rwLabel(r))}</span>
      ${st === 'claimed' ? '<span class="ssnst">✓</span>' : st === 'locked' ? '<span class="ssnst">🔒</span>' : `<span class="ssnst claim">${r.chest ? 'Open' : 'Claim'}</span>`}</div>`;
  }
  const shortName = it => it.name.replace(/^(Title|Emote): /, '');
  function icoGlyph(it) { return { outfit: '⚜', hat: '▲', title: '❧', plate: 'Aa', balloon: '◓', sails: '⛵', gunfin: '✦', emote: '☺' }[it.kind] || '★'; }
  function icoStyle(it) {
    const d = it.data || {};
    const c1 = d.coat || d.a || d.col || d.hatCol || d.metal || '#c9b48a', c2 = d.trim || d.b || d.brass || d.wood || '#f4efe4';
    return `background:linear-gradient(135deg,${c1} 0 55%,${c2} 55% 100%);border-color:${RARITY[it.rarity] || '#999'}`;
  }
  // a summary card for the home screen (shown before entering the world)
  function homeCard() {
    if (!SS.ready || !SS.season) return '';
    const S0 = SS.season, m = mainStep(), st = SS.story, n = claimable().length, bo = boostLeft();
    return `<div class="ssn ssnhome" style="--acc:${S0.accent};--acc2:${S0.accent2}"><div class="ssnkicker">${esc(S0.name)} season · ${esc(leftTxt(S0.end - Date.now()))} left</div><h3 class="ssnshowt">${esc(S0.title)}</h3>
      <div class="ssnhomet"><b>${SS.tier > S0.tiers ? 'Bonus tier' : 'Tier'} ${SS.tier}</b>${SS.premium ? ' <span class="ssnpill">Premium</span>' : ''}${n ? ` <span class="ssnpill">${n} reward${n === 1 ? '' : 's'} to claim</span>` : ''}${bo ? ` <span class="ssnpill">⚡ ×${SS.boost.mult} · ${esc(leftTxt(bo))}</span>` : ''}</div>${xpBar()}
      ${st && !st.none && !st.complete && m ? `<div class="ssnsoft">Story: ${esc(stepTitle(m))}: ${esc(m.obj)}</div>` : st && st.complete ? '<div class="ssnsoft">Story complete.</div>' : ''}
      ${(SS.hol || []).map(h => `<div class="ssnsoft">🎉 ${esc(h.name)}: ${h.found.length}/${h.spots.length} found</div>`).join('')}</div>`;
  }
  const VIEW = {
    home() {
      const S0 = SS.season, st = SS.story, m = mainStep(), left = S0.end - Date.now();
      const hol = (SS.hol || []).map(h => `<div class="ssncard hol"><b>${esc(h.name)}</b> · ends ${esc(fmtShort(h.ends))}<div>${esc(h.hunt)}: <b>${h.found.length}/${h.spots.length}</b> found${h.found.length === h.spots.length ? ' · complete!' : ''}</div><div class="ssnsoft">Rewards: ${h.items.map(i => esc(items()[i] ? items()[i].name : i)).join(', ')}. Look for the pale blue markers on the map (M).</div></div>`).join('');
      const fund = st && st.fund ? `<div class="ssncard"><b>${esc(st.fund.name)}</b>: ${fmtN(st.fund.total)} gold raised by the realm · you gave ${fmtN(st.fund.mine)}<div class="ssnsoft">${st.fund.milestones.map(ms => `${st.fund.total >= ms.at ? '✓' : '○'} ${fmtN(ms.at)}: ${esc(ms.note)}`).join(' · ')}</div><div class="row"><input id="ssnDon" class="ssnin" type="number" min="1" placeholder="Gold to donate"><button class="btn" id="ssnDonGo">Donate</button></div></div>` : '';
      const fin = SS.finale ? `<div class="ssncard alert"><b>⚑ The Concord Assembly is happening now</b> at the Crossroads Market. ${esc(leftTxt(SS.finale.ends - Date.now()))} left.</div>` : SS.nextFinale && C() ? `<div class="ssncard">The live finale, <b>The Concord Assembly</b>, is held regularly once chapter 7 opens${SS.nextFinale > Date.now() ? `; next one around ${esc(fmtTime(SS.nextFinale))}${SS.nextFinale - Date.now() > 864e5 ? ' on ' + esc(fmtLocalDay(SS.nextFinale)) : ''}` : ''}.</div>` : '';
      return `<div class="ssnhero"><p>${esc(S0.blurb)}</p><div class="ssnsoft">${esc(fmtDate(S0.start))} – ${esc(fmtDate(S0.end))} · ${esc(leftTxt(left))} left in the season</div></div>
        <div class="ssncard"><b>Battle pass: ${SS.tier > S0.tiers ? 'bonus tier ' + SS.tier : 'tier ' + SS.tier + ' of ' + S0.tiers}</b> ${SS.premium ? '<span class="ssnpill">Premium</span>' : ''}${claimable().length ? ` <span class="ssnpill">${claimable().length} to claim</span>` : ''}${xpBar()}<div class="row"><button class="btn primary" data-go="pass">Open the battle pass</button><button class="btn" data-go="chal">Challenges</button></div></div>
        ${st && !st.none ? `<div class="ssncard"><b>Story: ${esc(C().title)}</b><div>${st.complete ? 'Complete. Thank you, Keeper.' : m ? `${esc(stepTitle(m))}: ${esc(m.obj)}` : ''}</div>${st.main && !st.main.open ? `<div class="ssnsoft">The next chapter opens ${esc(fmtDate(st.main.opensAt))}.</div>` : ''}<div class="row"><button class="btn" data-go="campaign">Open the story</button></div></div>` : st && st.none ? `<div class="ssncard"><b>Story</b><div>The ${esc(S0.name)} campaign, <i>${esc(S0.title)}</i>, is planned but not written yet. You can still earn the whole battle pass through challenges, events and holidays.</div></div>` : ''}
        ${fin}${hol}${fund}`;
    },
    campaign() {
      const c = C(), st = SS.story;
      if (!c) { const plan = SS.season.plans[SS.season.key]; return `<p>The ${esc(SS.season.name)} campaign is not playable yet. Planned chapters:</p><ol class="ssnplan">${plan ? plan.chapters.map(x => `<li>${esc(x)}</li>`).join('') : ''}</ol>`; }
      const done = new Set(st.done || []);
      const ch = c.chapters.map(chp => {
        const open = Date.now() >= chp.opensAt || (SS.season.chapterGapDays === 0);
        const steps = chp.steps.filter(s => !s.when || Object.entries(s.when).every(([k, v]) => st.choices[k] === v));
        const nd = steps.filter(s => done.has(s.id)).length;
        const cur = st.main && st.main.id && steps.some(s => s.id === st.main.id);
        return `<details class="ssnch ${nd === steps.length ? 'done' : ''}" ${cur ? 'open' : ''}><summary><span class="ssnchn">${chp.n}</span><b>${esc(chp.title)}</b><span class="ssnsoft">${open ? `${nd}/${steps.length}` : 'opens ' + esc(fmtShort(chp.opensAt))}</span></summary><p class="ssnsoft">${esc(chp.blurb)}</p>
          <ul class="ssnsteps">${steps.map(s => `<li class="${done.has(s.id) ? 'done' : s.id === (st.main && st.main.id) ? 'cur' : ''}">${done.has(s.id) ? '✓' : s.id === (st.main && st.main.id) ? '➤' : '○'} ${esc(s.obj)}${s.type === 'choice' && st.choices[s.key] ? ` <i>(you chose: ${esc((s.options.find(o => o.id === st.choices[s.key]) || {}).label || '')})</i>` : ''}</li>`).join('')}</ul></details>`;
      }).join('');
      const sides = c.side.map(Q => { const nd = Q.steps.filter(s => done.has(s.id)).length; const avail = !Q.after || done.has(Q.after); return `<div class="ssncard"><b>${esc(Q.title)}</b> · ${nd === Q.steps.length ? 'complete' : avail ? `${nd}/${Q.steps.length}` : 'not yet available'}<div class="ssnsoft">${esc(Q.blurb)}</div>${avail && nd < Q.steps.length ? `<div>➤ ${esc((Q.steps.find(s => !done.has(s.id)) || {}).obj || '')}</div>` : ''}</div>`; }).join('');
      const rw = c.rewards;
      return `<p class="ssnintro">${esc(c.intro)}</p>${ch}<h3 class="ssnh3">Side stories</h3>${sides}
        <h3 class="ssnh3">Campaign reward</h3><div class="ssncard"><div>Only for finishing the whole story. Never sold, never in the battle pass.</div><div class="ssnrow">${rw.items.map(i => items()[i]).filter(Boolean).map(it => `<span class="ssnchip"><span class="ssnico" style="${icoStyle(it)}">${icoGlyph(it)}</span>${esc(it.name)}</span>`).join('')}<span class="ssnchip"><span class="ssnico gold">◉</span>${fmtN(rw.gold)} gold</span><span class="ssnchip">+ a title that depends on your final choice</span></div>${st.rewarded ? '<div><b>✓ Received.</b></div>' : ''}</div>`;
    },
    pass() {
      const S0 = SS.season, pass = SS.content.pass, names = S0.passChapters || [], I = items();
      const cl = claimable(), chests = cl.filter(([r, t]) => r[t].chest).length, plain = cl.length - chests;
      // the showcase: this season's evolving outfit, the next item on each track, and the finale rewards
      const evo = pass.filter(r => r.premium && r.premium.item && /_evo\d$/.test(r.premium.item));
      const evoHTML = evo.map((r, i) => { const it = I[r.premium.item], own = SS.owned.has(r.premium.item); return `<button class="ssnevo ${own ? 'own' : SS.tier >= r.tier ? 'ready' : ''}" data-tier="${r.tier}" data-track="premium" style="--rc:${RARITY[it.rarity]}">${rwIcon(r.premium, true)}<span>Stage ${['I', 'II', 'III', 'IV'][i]}</span><i>${own ? 'owned' : 'tier ' + r.tier}</i></button>`; }).join('<span class="ssnevoarrow">›</span>');
      const nextOf = tr => pass.find(r => r.tier > SS.tier && r[tr] && (r[tr].item || r[tr].chest));
      const nf = nextOf('free'), np = nextOf('premium');
      const nextHTML = [[nf, 'free', 'Next on the free track'], [np, 'premium', 'Next on premium']].filter(x => x[0]).map(([r, tr, lab]) => `<button class="ssnnext" data-tier="${r.tier}" data-track="${tr}" style="--rc:${RARITY[rwRarity(r[tr])]}">${rwIcon(r[tr], true)}<span><i>${lab} · tier ${r.tier}</i><b>${esc(rwLabel(r[tr]))}</b></span></button>`).join('');
      const evoName = evo.length ? (I[evo[0].premium.item].name.split(' · ')[0]) : '';
      // chapter strip
      const chs = names.map((n, i) => { const c = i + 1, lo = i * 10 + 1, hi = c * 10, got = SS.tier >= hi, cur = SS.tier >= lo - 1 && SS.tier < hi; return `<button class="ssnchap ${got ? 'done' : cur ? 'cur' : ''}" data-chap="${c}" title="Tiers ${lo}–${hi}"><b>${c}</b><span>${esc(n)}</span></button>`; }).join('') + `<button class="ssnchap bonus ${SS.tier > S0.tiers ? 'cur' : ''}" data-chap="11" title="Tiers ${S0.tiers + 1}–${maxT()}"><b>★</b><span>Bonus tiers</span></button>`;
      // the track, with a banner at the start of each chapter
      const cols = pass.map(r => {
        const ready = r.tier <= SS.tier, head = (r.tier - 1) % 10 === 0 && r.tier <= S0.tiers ? `<div class="ssnchead" id="ssnCh${r.chapter}"><b>Chapter ${r.chapter}</b><span>${esc(names[r.chapter - 1] || '')}</span></div>` : r.tier === S0.tiers + 1 ? `<div class="ssnchead bonus" id="ssnCh11"><b>Bonus</b><span>Keep going to tier ${maxT()}</span></div>` : '';
        return `${head}<div class="ssntcol ${ready ? 'reached' : ''}${r.tier === SS.tier + 1 ? ' next' : ''}${r.bonus ? ' bonus' : ''}"><div class="ssntno">${r.tier}</div>${rewardCell(r.free, { tier: r.tier, ready, claimed: SS.claims.has(r.tier + ':free') })}${rewardCell(r.premium, { tier: r.tier, ready: ready && SS.premium, claimed: SS.claims.has(r.tier + ':premium'), prem: true })}</div>`;
      }).join('');
      const bo = boostLeft();
      return `<div class="ssnshow">
          <div class="ssnshowl"><div class="ssnkicker">Evolving outfit · premium</div><h3 class="ssnshowt">${esc(evoName)}</h3><div class="ssnevos">${evoHTML}</div></div>
          <div class="ssnshowr">${nextHTML}</div>
          <div class="ssnshowb">${xpBar()}${bo ? `<div class="ssnboost">⚡ XP boost ×${SS.boost.mult} active · ${esc(leftTxt(bo))} left</div>` : ''}
          <div class="row"><button class="btn primary" id="ssnAll" ${plain ? '' : 'disabled'}>Claim all (${plain})</button>${chests ? `<button class="btn primary" id="ssnChests">Open chests (${chests})</button>` : ''}${SS.premium ? '<span class="ssnpill">Premium track unlocked</span>' : `<button class="btn" id="ssnPrem">Unlock premium: ${fmtN(S0.premiumPrice)} gold</button>`}</div></div></div>
        <div class="ssnchaps" id="ssnChaps">${chs}</div>
        <div class="ssnpasswrap"><div class="ssnlbl"><div class="ssntno">Tier</div><div class="ssnlbln">Free</div><div class="ssnlbln prem">Premium</div></div><div class="ssnpass" id="ssnPass">${cols}</div></div><div id="ssnPrev" class="ssnprev"></div>
        <p class="ssnsoft">Free: an item, a tonic, gold or a chest through every chapter, and a chest to choose from at the end of each one. Premium (in-game gold only, never needed for the story, events or holidays) fills every tier and evolves the outfit at tiers 1, 33, 66 and 100. Past tier ${S0.tiers}, bonus tiers run to ${maxT()} with prestige rewards for everyone.</p><div id="ssnChestBox"></div>`;
    },
    chal() {
      const now = new Date(), endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
      const wk = SS.season.start + (Math.floor((Date.now() - SS.season.start) / (7 * 864e5)) + 1) * 7 * 864e5;
      const sec = (per, name, ends) => `<h3 class="ssnh3">${name}${ends ? ` <span class="ssnsoft">· new in ${esc(leftTxt(ends - Date.now()))}</span>` : ''}</h3>` + SS.chal.filter(c => c.per === per).map(c => `<div class="ssnchal ${c.done ? 'done' : ''}"><div><b>${esc(c.text)}</b><span class="ssnsoft"> · ${fmtN(c.xp)} XP</span></div><div class="ssnprog"><i style="width:${(Math.min(1, c.have / c.n) * 100).toFixed(0)}%"></i></div><div class="ssnsoft">${c.done ? '✓ Complete' : `${fmtN(c.have)} / ${fmtN(c.n)}`}</div></div>`).join('');
      return `<p class="ssnsoft">Challenges are counted by the server from what it sees: where you travel, which towns you enter, trades, votes, events and gold earned. They complete by themselves.</p>${sec('d', 'Daily', endDay)}${sec('w', 'Weekly', wk)}${sec('s', 'Seasonal', null)}`;
    },
    cal() {
      const y = new Date().getUTCFullYear(), S0 = SS.season;
      const sd = (m, d, yy) => new Date(Date.UTC(yy, m - 1, d));
      const seasons = S0.seasons.map(s => { const st = s.key === 'winter' ? `${fmtShort(sd(s.start[0], s.start[1], y))} – ${fmtShort(sd(s.end[0], s.end[1], y + 1))}` : `${fmtShort(sd(s.start[0], s.start[1], y))} – ${fmtShort(sd(s.end[0], s.end[1], y))}`; return `<div class="ssncal ${s.key === S0.key ? 'cur' : ''}" style="--c:${s.accent}"><b>${esc(s.name)}</b><span>${esc(s.title)}</span><span class="ssnsoft">${esc(st)}</span></div>`; }).join('');
      const hols = (S0.holidays || []).map(h => { const live = (SS.hol || []).some(x => x.id === h.id); return `<tr class="${live ? 'live' : ''}"><td><b>${esc(h.name)}</b>${live ? ' <span class="ssnpill">now</span>' : ''}</td><td>${h.dates ? esc(fmtShort(h.dates.a)) + ' – ' + esc(fmtShort(h.dates.b - 864e5)) : ''}</td><td class="ssnsoft">${esc(h.hunt)} (${h.n})</td></tr>`; }).join('');
      const evs = (SS.events || []).map(e => `<tr><td>${esc(fmtLocalDay(e.at))}, ${esc(fmtTime(e.at))}</td><td>${esc(e.title)}</td></tr>`).join('');
      const live = NET() && NET().state ? [...NET().state.events.values()] : [];
      return `<h3 class="ssnh3">Seasons of the year</h3><div class="ssncals">${seasons}</div>
        <h3 class="ssnh3">Festivals and holidays</h3><table class="ssntab">${hols}</table>
        <h3 class="ssnh3">Live world events</h3>${live.length ? live.map(e => `<div class="ssncard alert"><b>Now: ${esc(e.title)}</b> · ${esc(e.obj === 'checkpoints' ? `reach ${e.cps ? e.cps.length : ''} checkpoints in order` : e.obj === 'hold' ? 'hold the line together' : 'stay and take part')} · ${fmtN(e.reward)} gold + ${fmtN(e.xp || 0)} XP · join from the Realm panel (.)</div>`).join('') : ''}
        <table class="ssntab">${evs}</table>
        ${C() ? `<h3 class="ssnh3">The finale</h3><p>The Concord Assembly is held every few hours from the opening of chapter 7 until the season ends. Times are set by the server.</p>` : ''}
        <h3 class="ssnh3">Coming seasons’ stories</h3>${Object.entries(S0.plans).filter(([k]) => k !== S0.key).map(([k, p]) => `<details class="ssnch"><summary><b>${esc(p.title)}</b><span class="ssnsoft">${esc(GAME_SEASON[k])} · planned</span></summary><ol class="ssnplan">${p.chapters.map(x => `<li>${esc(x)}</li>`).join('')}</ol></details>`).join('')}`;
    },
    wardrobe() {
      const I = items(), own = [...SS.owned].map(id => I[id]).filter(Boolean);
      if (!own.length) return '<p>You don’t own any wardrobe items yet. Claim battle pass rewards, finish the story, or complete holiday hunts.</p>';
      const by = {}; for (const it of own) (by[it.kind] = by[it.kind] || []).push(it);
      return `<p class="ssnsoft">Outfits and hats show while you wear everyday clothes (choose Everyday dress in the Admin or Journal dress options if you are a ruler or soldier). Titles, nameplates, balloons, sails and weapon finishes always show. Everyone around you sees what you equip.</p>` +
        Object.keys(SLOT_NAMES).filter(k => by[k]).map(k => `<h3 class="ssnh3">${SLOT_NAMES[k]}</h3><div class="ssnwar">${by[k].map(it => {
          const on = k === 'emote' ? false : SS.equip[k] === it.id;
          return `<div class="ssnitem ${on ? 'on' : ''}"><span class="ssnico" style="${icoStyle(it)}">${icoGlyph(it)}</span><div><b>${esc(shortName(it))}</b><div class="ssnsoft" style="color:${RARITY[it.rarity]}">${esc(it.rarity)}</div></div>${k === 'emote' ? `<button class="btn" data-emote="${esc(it.data.e)}">Perform</button>` : `<button class="btn ${on ? '' : 'primary'}" data-eq="${esc(k)}" data-it="${on ? '' : esc(it.id)}">${on ? 'Take off' : 'Equip'}</button>${k === 'outfit' || k === 'hat' ? `<button class="btn" data-pv="${esc(it.id)}">Preview</button>` : ''}`}</div>`;
        }).join('')}</div>`).join('');
    },
    gfx() {
      return `<p>Choose how much detail the game draws. Lower settings run better on older computers and phones. The choice is remembered in this browser.</p>
        <div class="ssngfx">${Object.entries(QUALITY).map(([k, q]) => `<label class="ssncard ${SS.gfx === k ? 'on' : ''}"><input type="radio" name="gfx" value="${k}" ${SS.gfx === k ? 'checked' : ''}> <b>${esc(q.label)}</b><div class="ssnsoft">${k === 'auto' ? 'The game’s own defaults for your device.' : `Resolution ×${q.pr}, shadows ${q.shadow}px over ${q.range * 2} paces, draw distance ${fmtN(q.far)} paces, ${q.parts ? 'seasonal particles' : 'no particles'}, ${q.deco ? 'town decorations' : 'no decorations'}.`}</div></label>`).join('')}</div>
        <p class="ssnsoft">Seasonal atmosphere (fog colour, light, petals, leaves, fireflies, snow flurries and town decorations) follows the server’s season, so every player sees the same season.</p>`;
    },
  };
  const WIRE = {
    home() { $('mcontent').querySelectorAll('[data-go]').forEach(b => b.onclick = () => { SS.tab = b.dataset.go; render(); }); const d = $('ssnDonGo'); if (d) d.onclick = () => { const n = Math.floor(+$('ssnDon').value); if (n > 0) send({ t: 'sDonate', n }); }; },
    pass() {
      const all = $('ssnAll'); if (all) all.onclick = () => { for (const [r, tr] of claimable()) if (!r[tr].chest) send({ t: 'sClaim', tier: r.tier, track: tr }); };
      const ch = $('ssnChests'); if (ch) ch.onclick = () => { const c = claimable().find(([r, tr]) => r[tr].chest); if (c) openChest(c[0].tier, c[1]); };
      $('mcontent').querySelectorAll('[data-chap]').forEach(b => b.onclick = () => { const h = $('ssnCh' + b.dataset.chap), pass = $('ssnPass'); if (h && pass) pass.scrollTo({ left: pass.scrollLeft + h.getBoundingClientRect().left - pass.getBoundingClientRect().left - 4, behavior: 'smooth' }); });
      $('mcontent').querySelectorAll('.ssnevo,.ssnnext').forEach(b => b.onclick = () => { const t = +b.dataset.tier, tr = b.dataset.track; showPrev(t, tr); const col = $('ssnPass') && $('ssnPass').querySelector(`.ssnrw[data-tier="${t}"][data-track="${tr}"]`); if (col) col.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); });
      const pr = $('ssnPrem'); if (pr) pr.onclick = () => { A().openPanel('Premium track', SS.season.name, `<p>Unlock the premium track for ${fmtN(SS.season.premiumPrice)} in-game gold? It adds an item or gold to every tier of this season’s pass, including tiers you have already reached. There is no real-money purchase in Age of Crowns.</p>`, [{ label: 'Unlock', primary: true, close: true, fn: () => { send({ t: 'sPremium' }); A().closePanel(); } }, { label: 'Not now', close: true, fn: () => A().closePanel() }]); };
      $('mcontent').querySelectorAll('.ssnrw[data-tier]').forEach(el => {
        el.onclick = () => { const tier = +el.dataset.tier, track = el.dataset.track, r = SS.content.pass[tier - 1][track]; if (el.classList.contains('ready')) { if (r.chest) return openChest(tier, track); send({ t: 'sClaim', tier, track }); } showPrev(tier, track); };
        el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); el.click(); } };
        el.onmouseenter = () => showPrev(+el.dataset.tier, el.dataset.track);
      });
      const pass = $('ssnPass'); if (pass) { if (SS.passX != null) pass.scrollLeft = SS.passX; else { const t = pass.querySelector('.ssntcol:not(.reached)'); if (t) pass.scrollLeft = Math.max(0, t.getBoundingClientRect().left - pass.getBoundingClientRect().left - 160); } pass.onscroll = () => { SS.passX = pass.scrollLeft; }; }
      if (SS.chestOpen) openChest(SS.chestOpen[0], SS.chestOpen[1]);
      if (SS.prevSel) showPrev(SS.prevSel[0], SS.prevSel[1]);
    },
    wardrobe() {
      $('mcontent').querySelectorAll('[data-eq]').forEach(b => b.onclick = () => { SS.preview = null; send({ t: 'sEquip', slot: b.dataset.eq, item: b.dataset.it || null }); });
      $('mcontent').querySelectorAll('[data-pv]').forEach(b => b.onclick = () => { SS.preview = SS.preview === b.dataset.pv ? null : b.dataset.pv; applyCos(); toast(SS.preview ? 'Previewing: you wear it while this panel is open. Press Equip to keep it.' : 'Preview off.'); });
      $('mcontent').querySelectorAll('[data-emote]').forEach(b => b.onclick = () => { send({ t: 'emote', e: b.dataset.emote }); closePanel(); });
    },
    gfx() { $('mcontent').querySelectorAll('input[name=gfx]').forEach(r => r.onchange = () => { SS.gfx = r.value; try { localStorage.setItem('aoc_gfx', SS.gfx); } catch (e) {} if (SS.gfx === 'auto') toast('Automatic quality takes full effect after reloading the page.'); applyQuality(); render(); }); },
  };
  function showPrev(tier, track) {
    const el = $('ssnPrev'); if (!el) return;
    const r = SS.content.pass[tier - 1] && SS.content.pass[tier - 1][track]; if (!r) { el.innerHTML = ''; return; }
    SS.prevSel = [tier, track];
    const it = r.item && items()[r.item], rar = rwRarity(r);
    const opts = r.chest ? `<div class="ssnopts">${r.chest.opts.map(o => `<span class="ssnchip">${rwIcon(o)}${esc(rwLabel(o))}</span>`).join('')}</div>` : '';
    const pv = it && (it.kind === 'outfit' || it.kind === 'hat') ? `<button class="btn" id="ssnTry" data-pv="${esc(it.id)}">${SS.preview === it.id ? 'Stop trying on' : 'Try it on'}</button>` : '';
    el.innerHTML = `${rwIcon(r, true)}<div class="ssnprevt"><b>${esc(it ? it.name : rwLabel(r))}</b> <span style="color:${RARITY[rar]}">${esc(rar)}</span> · ${tier > SS.season.tiers ? 'bonus ' : ''}tier ${tier} ${track}<div class="ssnsoft">${esc(rwDesc(r))}</div>${opts}</div>${pv}`;
    const tb = $('ssnTry'); if (tb) tb.onclick = () => { SS.preview = SS.preview === tb.dataset.pv ? null : tb.dataset.pv; applyCos(); showPrev(tier, track); toast(SS.preview ? 'Trying it on: you wear it while this panel is open, and it comes off when you close the panel.' : 'Back to your own clothes.'); };
  }
  // choose one reward from a chest; the server checks the choice and that the tier is reached and unclaimed
  function openChest(tier, track) {
    const box = $('ssnChestBox'); if (!box) return;
    const r = SS.content.pass[tier - 1][track]; if (!r || !r.chest) return;
    SS.chestOpen = [tier, track];
    const can = tier <= SS.tier && (track === 'free' || SS.premium) && !SS.claims.has(tier + ':' + track);
    box.innerHTML = `<div class="ssnchest" role="dialog" aria-label="${esc(r.chest.name)}" style="--rc:${RARITY[r.chest.rarity]}"><div class="ssnchestin"><div class="ssnkicker">Tier ${tier} · ${track === 'premium' ? 'Premium' : 'Free'}</div><h3 class="ssnshowt">${esc(r.chest.name)}</h3><p class="ssnsoft">${can ? 'Choose one. The others stay in the chest.' : SS.claims.has(tier + ':' + track) ? 'Already opened.' : 'Reach this tier to open it. Inside you will choose one of:'}</p>
      <div class="ssnpicks">${r.chest.opts.map((o, i) => `<button class="ssnpick" data-pick="${i}" ${can ? '' : 'disabled'} style="--rc:${RARITY[rwRarity(o)]}">${rwIcon(o, true)}<b>${esc(rwLabel(o))}</b><span class="ssnsoft">${esc(rwDesc(o))}</span></button>`).join('')}</div>
      <div class="row"><button class="btn" id="ssnChestX">Close</button></div></div></div>`;
    box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { send({ t: 'sClaim', tier, track, pick: +b.dataset.pick }); SS.chestOpen = null; box.innerHTML = ''; });
    $('ssnChestX').onclick = () => { SS.chestOpen = null; box.innerHTML = ''; };
  }

  // ---------------------------------------------------------------- keys
  addEventListener('keydown', e => {
    if (!SS.ready || !inPlay()) return;
    const tag = e.target && e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); if (isOurs()) closePanel(); else if (!A().uiOpen()) openPanel(); }
    else if (e.code === 'Escape' && isOurs()) { closePanel(); }
  }, true);
  // closing the modal with its ✕ or a click outside also closes our panel state
  const mo = new MutationObserver(() => { if (SS.open && $('modal').classList.contains('hidden')) { SS.open = false; document.body.classList.remove('ssn-open'); if (SS.preview) { SS.preview = null; applyCos(); } } });
  const watch = () => { const m = $('modal'); if (m) mo.observe(m, { attributes: true, attributeFilter: ['class'] }); else setTimeout(watch, 500); };
  watch();
  try { if (localStorage.getItem('aoc_gfx')) setTimeout(() => applyQuality(), 0); } catch (e) {}

  // ---------------------------------------------------------------- offline look-only preview: add #preview-spring (or -summer, -autumn, -winter), optionally with a holiday: #preview-winter-winterfest
  // to the page address to see a season's atmosphere and decorations without the server. Nothing is earned or saved.
  (function previewFromHash() {
    const m = /preview-(spring|summer|autumn|winter)(?:-([a-z]+))?/.exec(location.hash || ''); if (!m) return;
    const h = m[2] ? [null, m[2]] : null; const decoOf = { valentine: 'hearts', easter: 'eggs', midsummer: 'bunting', halloween: 'pumpkins', winterfest: 'winterfest', newyear: 'fireworks' };
    const wait = () => { if (!A() || A().state !== 'play' || SS.ready) return setTimeout(wait, 500);
      SS.season = { key: m[1], name: GAME_SEASON[m[1]], accent: '#9fd28a' }; SS.hol = h ? h[1].split(',').filter(x => decoOf[x]).map(x => ({ id: x, deco: decoOf[x], spots: [], found: [] })) : [];
      applySeasonToWorld(); toast(`Look-only preview: ${GAME_SEASON[m[1]]}${SS.hol.length ? ' with ' + SS.hol.map(x => x.id).join(', ') : ''}.`, 'gold'); };
    wait();
  })();

  window.AOC_SEASONS = { rx, interact, mapMarkers, nearAct, homeCard, claimableCount: () => claimable().length, emoteVerb: e => { for (const it of Object.values(items())) if (it.kind === 'emote' && it.data.e === e) return it.data.verb; return null; }, open: openPanel, get state() { return SS; } };
})();
