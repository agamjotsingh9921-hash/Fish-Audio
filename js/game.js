/* Wrath of Olympus — gameplay.
   The Spartan and his blades, Atreus, enemy AI, strongholds and quests, the HUD,
   input, camera and the main loop. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, DEG, clamp, lerp, rand, smooth, damp, angleLerp, V3, segDist2D } = G.util;
  const scene = G.scene, camera = G.camera, W = G.world, A = G.actors, S = G.sound, FX = G.fx;
  const $ = (id) => document.getElementById(id);
  const ground = (x, z) => W.heightAt(x, z);
  const tmpA = V3(), tmpB = V3(), tmpC = V3();
  const BOUND = 372;

  // ===================================================================
  // State
  // ===================================================================
  const game = { state: 'title', time: 0, clock: 0, overT: -1, victory: false, freeRoam: false };
  const stats = { kills: 0, maxCombo: 0, orbs: 0, chests: 0 };
  const upgrades = { blades: 0, vigor: 0, aether: 0, fury: 0, bow: 0 };
  const bonus = { hp: 0, mp: 0 };
  const Q = { stage: 0 };
  let combo = 0, comboT = 0, hitstop = 0, slowmo = 0, trauma = 0, hurtFx = 0;
  let boss = null, checkpoint = W.altars[0];

  // ===================================================================
  // The Spartan
  // ===================================================================
  const spartan = A.buildSpartan();
  const pRig = A.makeRig(spartan, 1, 0.97);
  scene.add(pRig.root);
  const P = {
    root: pRig.root, rig: pRig.rig, pos: pRig.root.position, h: spartan,
    state: 'idle', stateT: 0, facing: Math.PI, vel: V3(), onGround: true, jumps: 0,
    hp: 100, maxHp: 100, mp: 100, maxMp: 100, rage: 0, rageT: 0, rageDur: 8, rageGain: 1, dmgMult: 1,
    invuln: 0, walkPh: 0, attack: null, atkName: '', atkT: 0, impactDone: false,
    comboIdx: 0, comboTimer: 0, queued: null, hitMap: new Map(),
    finTarget: null, finT: 0, dodgeDir: V3(), orbs: 0, sprint: false, magicDone: false, bladeBlood: 0,
  };
  const pLight = new THREE.PointLight(0xff6a20, 0, 8, 2);
  pLight.position.y = 1.4; P.root.add(pLight);

  // blades on their chains, with fire trails
  function makeBlade(handIdx) {
    const b = A.buildBlade();
    scene.add(b.g);
    const NCH = 14, cpos = new Float32Array(NCH * 3);
    const cgeo = new THREE.BufferGeometry(); cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    const chain = new THREE.Line(cgeo, new THREE.LineBasicMaterial({ color: 0x9a8a78 }));
    chain.frustumCulled = false; scene.add(chain);
    const NT = 10, tpos = new Float32Array(NT * 6), tcol = new Float32Array(NT * 6), idx = [];
    for (let i = 0; i < NT - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    tgeo.setIndex(idx);
    const trail = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    trail.frustumCulled = false; scene.add(trail);
    return { ...b, handIdx, flying: false, chain, cpos, NCH, trail, tpos, tcol, NT, hist: [] };
  }
  const blades = { R: makeBlade(0), L: makeBlade(1) };
  const steel = new THREE.Color(0xa8a29a), bloodSteel = new THREE.Color(0x3a0606);

  function toWorld(x, y, z, out) {
    const c = Math.cos(P.facing), s = Math.sin(P.facing);
    return out.set(P.pos.x + x * c + z * s, P.pos.y + y, P.pos.z - x * s + z * c);
  }
  // attack paths: t in [0,1] -> [x, y, z] in the Spartan's frame (+z forward, -x is his right)
  const sweep = (from, to, y, reach) => (t) => {
    const a = lerp(from, to, smooth(t));
    const r = 0.5 + reach * Math.pow(Math.sin(Math.PI * t), 0.6);
    return [Math.sin(a) * r, y + Math.sin(Math.PI * t) * 0.25, Math.cos(a) * r];
  };
  const slam = (x) => (t) => {
    let phi, r;
    if (t < 0.25) { const k = t / 0.25; phi = lerp(90, 150, k) * DEG; r = lerp(0.5, 2.4, k); }
    else if (t < 0.5) { const k = smooth((t - 0.25) / 0.25); phi = lerp(150, -12, k) * DEG; r = lerp(2.4, 6.2, k); }
    else { phi = -12 * DEG; r = lerp(6.2, 0.5, smooth((t - 0.5) / 0.5)); }
    return [x, 1.4 + Math.sin(phi) * r, Math.cos(phi) * r];
  };
  const spin = (off) => (t) => {
    const a = off - smooth(t) * TAU * 2;
    const r = 0.5 + 5.0 * Math.min(1, t * 5, (1 - t) * 5);
    return [Math.sin(a) * r, 1.0 + 0.22 * Math.sin(a * 2), Math.cos(a) * r];
  };
  const dive = (x) => (t) => [x, 0.3 + (1 - t) * 1.0, 1.5 + t * 0.8];
  const ATTACKS = {
    l1: { dur: 0.4, hit: [0.18, 0.66], dmg: 10, knock: 4, stag: 0.35, R: sweep(-120 * DEG, 100 * DEG, 1.15, 5) },
    l2: { dur: 0.4, hit: [0.18, 0.66], dmg: 10, knock: 4, stag: 0.35, L: sweep(120 * DEG, -100 * DEG, 1.3, 5) },
    l3: { dur: 0.5, hit: [0.15, 0.68], dmg: 12, knock: 5, stag: 0.4, R: sweep(-130 * DEG, 110 * DEG, 0.9, 5.4), L: sweep(130 * DEG, -110 * DEG, 1.55, 5.4) },
    l4: { dur: 0.72, hit: [0.4, 0.62], dmg: 22, knock: 11, stag: 0.9, R: slam(-0.45), L: slam(0.45), impact: 0.5, impactR: 3.4 },
    h1: { dur: 0.95, hit: [0.1, 0.88], dmg: 8, knock: 6, stag: 0.5, rehit: 0.17, R: spin(0), L: spin(Math.PI), heavy: true },
    air: { dur: 9, hit: [0, 1], dmg: 12, knock: 6, stag: 0.5, R: dive(-0.5), L: dive(0.5), air: true },
  };
  const CHAIN = ['l1', 'l2', 'l3', 'l4'];

  // ===================================================================
  // Atreus
  // ===================================================================
  const atreusH = A.buildAtreus();
  const aRig = A.makeRig(atreusH, 0.78, 0.97);
  scene.add(aRig.root);
  const AT = {
    root: aRig.root, rig: aRig.rig, pos: aRig.root.position, h: atreusH,
    vel: V3(), facing: Math.PI, state: 'follow', stateT: 0, walkPh: 0,
    shootCd: 1.5, drawT: 0, target: null, volleyQ: 0, volleyT: 0, volleyCd: 0, lineCd: 4, dodgeT: 0, onGround: true, idleT: 30,
  };
  const LINES = {
    start: ['The shrine still burns, father. The gods have not forgotten us.', 'I can see beacons from here. Three strongholds.'],
    aggro: ['Father, they\'re coming!', 'Enemies ahead!', 'I see them. I\'m ready.'],
    harpy: ['Harpies above us! Leave the fliers to me.', 'They\'re diving. Watch the sky!'],
    hound: ['Hellhounds! Watch their teeth!', 'They hunt in packs, father.'],
    minotaur: ['That one\'s huge. Lure it into a wall!', 'A minotaur! Make it charge into the stone!'],
    kill: ['Got one!', 'That\'s for the shrine!', 'Another down.', 'Did you see that shot?'],
    hurt: ['Father, you\'re hurt!', 'Careful! Grab the green orbs!'],
    clear: ['We did it. That stronghold is finished.', 'It\'s quiet now. Where next?'],
    chest: ['A chest! What\'s inside?', 'Orbs! The gods are generous today.'],
    idle: ['The old roads all meet at the crossroads.', 'Do you think Olympus can see us here?', 'Mother would have loved these olive groves.', 'The lake is so still. Like glass.'],
    volley: ['Loosing!', 'Now!', 'Take this!'],
    temple: ['The fire at the temple has died. Polyphemos waits.'],
    boss: ['It\'s the Cyclops! Stay out from under that club!'],
    victory: ['You did it, father. The temple is ours.'],
  };
  let subT = 0;
  function say(kind, force = false) {
    if (!force && AT.lineCd > 0) return;
    const list = LINES[kind];
    if (!list) return;
    const el = $('subtitle');
    el.innerHTML = `<b>Atreus</b>${list[Math.floor(Math.random() * list.length)]}`;
    el.classList.add('show');
    subT = 3.6;
    AT.lineCd = 7;
  }

  // ===================================================================
  // Enemies
  // ===================================================================
  const enemies = [];
  const DEFS = {
    legion:   { hp: 45,   speed: 3.4, radius: 0.55, height: 2.1, dmg: 9,  poise: 0,   red: 25,  aggro: 24 },
    harpy:    { hp: 30,   speed: 6.5, radius: 0.7,  height: 1.0, dmg: 8,  poise: 0,   red: 20,  aggro: 30 },
    hound:    { hp: 34,   speed: 8.4, radius: 0.6,  height: 1.1, dmg: 7,  poise: 0,   red: 18,  aggro: 26 },
    minotaur: { hp: 180,  speed: 3.0, radius: 1.0,  height: 2.9, dmg: 18, poise: 40,  red: 90,  aggro: 26 },
    cyclops:  { hp: 1250, speed: 2.6, radius: 2.2,  height: 6.4, dmg: 25, poise: 1e9, red: 400, aggro: 999, boss: true },
  };
  const markerGeo = new THREE.TorusGeometry(0.3, 0.05, 6, 24);
  function enemyHpBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x110806, fog: false, transparent: true, opacity: 0.75, depthWrite: false }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.065), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.08, 0.08), fog: false, depthWrite: false }));
    fg.position.z = 0.001;
    g.add(bg, fg); g.visible = false; g.renderOrder = 6;
    scene.add(g);
    return { g, fg };
  }
  function spawnEnemy(type, x, z, opts = {}) {
    const def = DEFS[type];
    const b = A.BUILDERS[type]();
    const e = {
      type, def, h: b.h, root: b.root, rig: b.rig, pos: b.root.position,
      hp: def.hp, maxHp: def.hp, radius: def.radius, height: def.height,
      vel: V3(), facing: rand(0, TAU), state: opts.rise ? 'spawn' : 'idle', stateT: 0, cd: rand(0.5, 1.5), alive: true,
      flash: 0, poiseDmg: 0, stagT: 0, walkPh: rand(0, 6), didHit: false, finishable: false,
      tempo: 1, speedMul: rand(0.9, 1.1), orbitA: rand(0, TAU), orbitDir: Math.random() < 0.5 ? 1 : -1, alt: type === 'harpy' ? 7 : 0,
      chargeCd: rand(2, 4), deadT: 0, aggro: !!opts.aggro, home: { x, z }, camp: opts.camp || null, roamer: !!opts.roamer,
      wanderT: rand(0, 4), wx: x, wz: z, yOff: 0, pooled: false, shadowT: 0,
    };
    e.pos.set(x, ground(x, z) + (opts.rise && type !== 'harpy' ? -e.height : 0) + (type === 'harpy' ? e.alt : 0), z);
    e.flashMats = []; e.meshes = [];
    e.root.traverse((o) => {
      if (!o.isMesh) return;
      e.meshes.push(o);
      if (o.material && o.material.emissive && e.flashMats.indexOf(o.material) < 0) e.flashMats.push(o.material);
    });
    e.flashMats.forEach((m) => { m.userData.baseEmissive = m.emissive.clone(); m.userData.baseColor = m.color.clone(); });
    e.skinMat = e.h.mats.skin;
    if (!def.boss) {
      e.bar = enemyHpBar();
      e.marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.3), fog: false }));
      e.marker.visible = false; scene.add(e.marker);
    }
    scene.add(e.root);
    enemies.push(e);
    if (opts.rise) {
      if (type === 'harpy') FX.flames.emit(x, e.pos.y + 4, z, 20, { color: 0x9a5aff, color2: 0x4a2a8a, speed: 3, life: 0.8, grav: -1, bright: 1.3 });
      else FX.flames.emit(x, e.pos.y + e.height, z, 30, { color: 0x6aff5a, color2: 0x1a8a3a, speed: 3, up: 3, life: 0.9, grav: -2, spread: e.radius, bright: 1.3 });
    }
    return e;
  }
  function removeEnemy(e) {
    scene.remove(e.root);
    if (e.bar) scene.remove(e.bar.g);
    if (e.marker) scene.remove(e.marker);
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
  }
  function setState(e, s) { e.state = s; e.stateT = 0; e.didHit = false; }

  // camps
  const CAMP_DEFS = {
    legion: [['legion', 7], ['hound', 3]],
    harpy: [['harpy', 5], ['legion', 2]],
    laby: [['minotaur', 2], ['legion', 4]],
  };
  const camps = {};
  function spawnCamp(k) {
    const p = W.POI[k];
    camps[k] = camps[k] || { key: k, cleared: false, members: [], name: p.name };
    const c = camps[k];
    c.members = [];
    for (const [type, n] of CAMP_DEFS[k]) {
      for (let i = 0; i < n; i++) {
        let x = p.x, z = p.z;
        for (let t = 0; t < 30; t++) {
          const a = rand(0, TAU), r = rand(3, p.r * 0.62);
          x = p.x + Math.sin(a) * r; z = p.z + Math.cos(a) * r;
          if (W.colliders.free(x, z, 1.4) && !W.isWater(x, z)) break;
        }
        c.members.push(spawnEnemy(type, x, z, { camp: k }));
      }
    }
  }
  const roamers = { t: 40 };

  // ===================================================================
  // Effects
  // ===================================================================
  const effects = [];
  const addEffect = (fx) => effects.push(fx);
  // a flat disc that hugs the terrain
  function groundDisc(x, z, r, segs, inner = 0) {
    const geo = inner > 0 ? new THREE.RingGeometry(inner, 1, segs, 1) : new THREE.CircleGeometry(1, segs);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo);
    m.userData.base = Float32Array.from(geo.attributes.position.array);
    m.position.set(x, 0, z);
    conform(m, r);
    return m;
  }
  function conform(m, r) {
    const p = m.geometry.attributes.position, b = m.userData.base;
    for (let i = 0; i < p.count; i++) {
      const lx = b[i * 3] * r, lz = b[i * 3 + 2] * r;
      p.setXYZ(i, lx, ground(m.position.x + lx, m.position.z + lz) + 0.09, lz);
    }
    p.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }
  function telegraph(x, z, r, dur, color = 0xff2a10) {
    const ring = groundDisc(x, z, r, 48, 0.9);
    const fill = groundDisc(x, z, 0.01, 48);
    ring.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false });
    fill.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, fog: false, side: THREE.DoubleSide });
    scene.add(ring, fill);
    let t = 0;
    addEffect({
      update(dt) {
        t += dt;
        conform(fill, Math.max(0.01, Math.min(1, t / dur)) * r);
        ring.material.opacity = 0.55 + 0.35 * Math.sin(t * 22);
        if (t >= dur) { this.dispose(); return false; }
        return true;
      },
      dispose() { scene.remove(ring, fill); ring.geometry.dispose(); fill.geometry.dispose(); },
    });
  }
  function telegraphLane(x, z, angle, length, width, dur) {
    const n = 16, pts = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * length;
      for (const s of [-1, 1]) {
        const px = x + Math.sin(angle) * t + Math.cos(angle) * s * width / 2, pz = z + Math.cos(angle) * t - Math.sin(angle) * s * width / 2;
        pts.push(px, ground(px, pz) + 0.1, pz);
      }
    }
    const idx = [];
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); scene.add(m);
    let t = 0;
    addEffect({
      update(dt) { t += dt; mat.opacity = 0.2 + 0.2 * Math.sin(t * 20); if (t >= dur) { this.dispose(); return false; } return true; },
      dispose() { scene.remove(m); geo.dispose(); },
    });
  }
  function shockwave(x, z, r0, r1, dur, color = 0xffaa55, onRadius = null) {
    const m = groundDisc(x, z, r0, 64, 0.86);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.8), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    m.material = mat; scene.add(m);
    let t = 0;
    addEffect({
      update(dt) {
        t += dt;
        const k = Math.min(1, t / dur), r = lerp(r0, r1, k);
        conform(m, r);
        mat.opacity = 0.9 * (1 - k);
        if (onRadius) onRadius(r);
        if (t >= dur) { this.dispose(); return false; }
        return true;
      },
      dispose() { scene.remove(m); m.geometry.dispose(); },
    });
  }
  const flashPool = [];
  // A fixed number of flash lights avoids shader recompiles when lights come and go.
  for (let i = 0; i < 2; i++) { const l = new THREE.PointLight(0xffffff, 0, 30, 2); scene.add(l); flashPool.push({ l, t: 0, dur: 1, i0: 0 }); }
  function flash(x, y, z, color, intensity, dur) {
    const f = flashPool.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    f.l.position.set(x, y, z); f.l.color.setHex(color); f.t = 0; f.dur = dur; f.i0 = intensity;
  }
  function lightning(x, z) {
    const gy = ground(x, z), pts = [];
    let px = x + rand(-2, 2), py = gy + 30, pz = z + rand(-2, 2);
    while (py > gy) { pts.push(new THREE.Vector3(px, py, pz)); py -= rand(1.5, 3.5); px += rand(-1.5, 1.5) + (x - px) * 0.25; pz += rand(-1.5, 1.5) + (z - pz) * 0.25; }
    pts.push(new THREE.Vector3(x, gy, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 3.5, 5), transparent: true, fog: false });
    const line = new THREE.Line(geo, mat); scene.add(line);
    let t = 0;
    addEffect({
      update(dt) { t += dt; mat.opacity = 1 - t / 0.35; if (t >= 0.35) { this.dispose(); return false; } return true; },
      dispose() { scene.remove(line); geo.dispose(); },
    });
  }
  const shake = (a) => { trauma = Math.min(1, trauma + a); };
  const doHitstop = (t) => { hitstop = Math.max(hitstop, t); };

  // ===================================================================
  // Orbs, arrows, boulders
  // ===================================================================
  const orbs = [];
  const orbGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const ORB_COLORS = { red: [1.5, 0.12, 0.08], green: [0.25, 1.5, 0.25], blue: [0.2, 0.6, 1.6] };
  const orbMats = {};
  for (const k in ORB_COLORS) orbMats[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ORB_COLORS[k]) });
  const ORB_HEX = { red: 0xff3a2a, green: 0x5aff5a, blue: 0x4aa8ff };
  function dropOrbs(pos, red, green, blue, y = null) {
    const add = (kind, n, value) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(orbGeo, orbMats[kind]);
        m.position.set(pos.x, (y !== null ? y : pos.y) + 1.1, pos.z);
        scene.add(m);
        orbs.push({ m, kind, value, vel: V3(rand(-4, 4), rand(4, 8), rand(-4, 4)), t: 0 });
      }
    };
    if (red > 0) { const n = Math.max(1, Math.round(red / 10)); add('red', n, red / n); }
    add('green', green, 12);
    add('blue', blue, 12);
  }
  function updateOrbs(dt) {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i], p = o.m.position;
      o.t += dt;
      tmpA.set(P.pos.x - p.x, P.pos.y + 1.1 - p.y, P.pos.z - p.z);
      const d = tmpA.length();
      if (o.t > 0.55 && d < 9 && P.state !== 'dead') o.vel.lerp(tmpA.normalize().multiplyScalar(18), damp(8, dt));
      else { o.vel.y -= 14 * dt; o.vel.x *= Math.exp(-2 * dt); o.vel.z *= Math.exp(-2 * dt); }
      p.addScaledVector(o.vel, dt);
      const gy = ground(p.x, p.z) + 0.2;
      if (p.y < gy) { p.y = gy; o.vel.y = Math.abs(o.vel.y) * 0.4; }
      if (o.t > 0.55 && d < 0.9) {
        if (o.kind === 'red') { P.orbs += o.value; stats.orbs += o.value; }
        else if (o.kind === 'green') P.hp = Math.min(P.maxHp, P.hp + o.value);
        else P.mp = Math.min(P.maxMp, P.mp + o.value);
        FX.sparks.emit(p.x, p.y, p.z, 6, { color: ORB_HEX[o.kind], speed: 2, life: 0.3, grav: 0, bright: 1.3 });
        S.pickup(o.kind);
        scene.remove(o.m); orbs.splice(i, 1);
      } else if (o.t > 40) { scene.remove(o.m); orbs.splice(i, 1); }
    }
  }

  const arrows = [];
  function fireArrow(charged) {
    const hand = AT.h.arms[1].hand;
    AT.root.updateMatrixWorld(true);
    const from = hand.getWorldPosition(V3()).add(V3(0, 0.05, 0));
    const tg = AT.target;
    let aim;
    if (tg && tg.alive) {
      const d = from.distanceTo(tg.pos);
      const t = d / 48;
      aim = V3(tg.pos.x + tg.vel.x * t * 0.3, tg.pos.y + tg.height * 0.55, tg.pos.z + tg.vel.z * t * 0.3);
    } else {
      aim = V3(AT.pos.x + Math.sin(AT.facing) * 30, AT.pos.y + 1.2, AT.pos.z + Math.cos(AT.facing) * 30);
    }
    const dir = aim.clone().sub(from);
    const flight = dir.length() / 48;
    dir.normalize().multiplyScalar(48);
    dir.y += 0.5 * 5 * flight;
    const m = A.buildArrow(charged);
    m.position.copy(from);
    scene.add(m);
    arrows.push({ m, pos: from, vel: dir, life: 3, charged, stuck: false });
    S.bow();
    if (charged) FX.sparks.emit(from.x, from.y, from.z, 10, { color: 0x9ac8ff, speed: 3, life: 0.3, grav: 0, bright: 1.8 });
  }
  const prevA = V3();
  function updateArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      a.life -= dt;
      if (a.stuck) { if (a.life <= 0) { scene.remove(a.m); arrows.splice(i, 1); } continue; }
      prevA.copy(a.pos);
      a.vel.y -= 5 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.m.position.copy(a.pos);
      a.m.lookAt(tmpA.copy(a.pos).add(a.vel));
      if (a.charged) FX.sparks.emit(a.pos.x, a.pos.y, a.pos.z, 2, { color: 0x9ac8ff, color2: 0xffffff, speed: 0.5, life: 0.25, grav: 0, bright: 1.8 });
      let hitE = null;
      for (const e of enemies) {
        if (!e.alive || e.state === 'spawn' || e.state === 'finished' || e.state === 'executed') continue;
        const [d, t] = segDist2D(e.pos.x, e.pos.z, prevA.x, prevA.z, a.pos.x, a.pos.z);
        const y = lerp(prevA.y, a.pos.y, t);
        if (d < e.radius + 0.25 && y > e.pos.y - 0.2 && y < e.pos.y + e.height + 0.2) { hitE = e; break; }
      }
      if (hitE) {
        const L = Math.hypot(a.vel.x, a.vel.z) || 1;
        const dmg = (a.charged ? 9 : 4) + upgrades.bow * 1.5;
        damageEnemy(hitE, dmg, a.vel.x / L, a.vel.z / L, 1.5, hitE.type === 'minotaur' ? 0 : 0.25, a.pos.x, a.pos.y, a.pos.z, false, 'arrow');
        S.arrowHit();
        if (a.charged) {
          lightning(a.pos.x, a.pos.z);
          FX.sparks.emit(a.pos.x, a.pos.y, a.pos.z, 40, { color: 0x9ac8ff, color2: 0xffffff, speed: 8, life: 0.4, grav: 2, bright: 1.8 });
          flash(a.pos.x, a.pos.y + 1, a.pos.z, 0x9ac8ff, 5, 0.4);
          S.zap();
          for (const e of enemies.slice()) {
            if (!e.alive || e === hitE) continue;
            const d = Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z);
            if (d < 3 + e.radius) damageEnemy(e, 10 + upgrades.bow * 2, (e.pos.x - a.pos.x) / (d || 1), (e.pos.z - a.pos.z) / (d || 1), 3, e.def.boss ? 0 : 1.2, e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, false, 'arrow');
          }
          if (hitE.alive && !hitE.def.boss) { setState(hitE, 'stagger'); hitE.stagT = 1.3; }
        }
        scene.remove(a.m); arrows.splice(i, 1);
        continue;
      }
      if (a.pos.y < ground(a.pos.x, a.pos.z)) { a.stuck = true; a.life = 6; continue; }
      if (a.life <= 0) { scene.remove(a.m); arrows.splice(i, 1); }
    }
  }

  const projectiles = [];
  const rockGeo = new THREE.DodecahedronGeometry(1.0, 1);
  function throwRock(from, to) {
    const m = new THREE.Mesh(rockGeo, W.mats.rock); m.castShadow = true;
    m.position.copy(from); scene.add(m);
    to.y = ground(to.x, to.z);
    telegraph(to.x, to.z, 2.8, 1.1);
    projectiles.push({ m, from: from.clone(), to: to.clone(), t: 0, dur: 1.1 });
  }
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.t += dt;
      const k = Math.min(1, pr.t / pr.dur);
      pr.m.position.lerpVectors(pr.from, pr.to, k);
      pr.m.position.y += Math.sin(Math.PI * k) * 8;
      pr.m.rotation.x += dt * 6; pr.m.rotation.z += dt * 4;
      if (k >= 1) {
        scene.remove(pr.m); projectiles.splice(i, 1);
        const p = pr.to;
        FX.sparks.emit(p.x, p.y + 0.5, p.z, 40, { color: 0xa08a70, color2: 0xff8a30, speed: 9, up: 4, life: 0.8 });
        FX.flames.emit(p.x, p.y + 0.5, p.z, 12, { color: 0x6a5040, speed: 3, life: 1, grav: -1 });
        shockwave(p.x, p.z, 0.5, 3.2, 0.35, 0xffa060);
        shake(0.45); S.boom();
        if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 2.8 && P.pos.y - p.y < 2) hurtPlayer(18, p, 10);
      }
    }
  }

  // ===================================================================
  // Combat
  // ===================================================================
  const bloodColor = new THREE.Color(0.22, 0.01, 0.01);
  function damageEnemy(e, dmg, dirX, dirZ, knock, stag, px, py, pz, heavy = false, src = 'blade') {
    if (!e.alive || e.state === 'spawn' || e.state === 'finished' || e.state === 'executed') return;
    if (e.def.boss && e.state === 'downed') return;
    if (src === 'blade' && P.rageT > 0) { dmg *= 1.6; P.hp = Math.min(P.maxHp, P.hp + 1.2); }
    if (src === 'blade') dmg *= P.dmgMult;
    e.hp -= dmg;
    e.flash = 1;
    if (!e.aggro) alertEnemy(e);
    // blood
    FX.blood.emit(px, py, pz, heavy ? 30 : (src === 'arrow' ? 6 : 16), { dx: dirX * 4, dy: 1.6, dz: dirZ * 4, speed: heavy ? 5 : 3.5, size: 0.1, stain: 0.2 });
    if (G.settings.blood && Math.random() < 0.35) FX.decals.add(e.pos.x + rand(-0.6, 0.6) + dirX, e.pos.z + rand(-0.6, 0.6) + dirZ, rand(0.3, 0.7));
    FX.sparks.emit(px, py, pz, heavy ? 16 : 6, { color: 0xffb040, color2: 0xff3a10, speed: heavy ? 8 : 5, life: 0.3, grav: 12, bright: 1.3 });
    if (e.skinMat && e.skinMat.userData.baseColor) e.skinMat.color.copy(e.skinMat.userData.baseColor).lerp(bloodColor, clamp(1 - e.hp / e.maxHp, 0, 1) * 0.55);
    let kb = knock;
    if (e.def.boss) kb *= 0.03; else if (e.type === 'minotaur') kb *= 0.3;
    e.vel.x += dirX * kb; e.vel.z += dirZ * kb;
    e.poiseDmg += dmg;
    if (stag > 0 && e.poiseDmg >= e.def.poise && e.hp > 0) {
      e.poiseDmg = 0;
      if (e.state !== 'stunned') { setState(e, 'stagger'); e.stagT = stag; }
    }
    if (src === 'blade') {
      doHitstop(heavy ? 0.09 : 0.05);
      shake(heavy ? 0.25 : 0.12);
      S.hit(heavy ? 1 : 0); S.flesh();
      P.bladeBlood = Math.min(1, P.bladeBlood + 0.06);
      if (P.rageT <= 0) P.rage = Math.min(100, P.rage + 2.2 * P.rageGain);
    }
    combo++; comboT = 2.2;
    stats.maxCombo = Math.max(stats.maxCombo, combo);
    if (e.hp <= 0) {
      if (e.def.boss) bossDowned(e);
      else { killEnemy(e, false); if (src === 'arrow') say('kill'); }
    } else if (!e.def.boss && e.hp <= e.maxHp * 0.22) {
      e.finishable = true;
    }
  }
  function killEnemy(e, executed) {
    if (!e.alive) return;
    e.alive = false; e.finishable = false;
    stats.kills++;
    const d = e.def, c = e.pos, cy = c.y + e.height * 0.5;
    if (executed) dropOrbs(c, d.red * 1.6, 3, 2);
    else dropOrbs(c, d.red, Math.random() < 0.4 ? 1 : 0, Math.random() < 0.35 ? 1 : 0);
    if (executed) {
      FX.blood.emit(c.x, cy, c.z, 90, { speed: 9, dy: 3, size: 0.14, stain: 0.25, spread: 0.3 });
      for (let i = 0; i < 4; i++) FX.decals.add(c.x + rand(-1.5, 1.5), c.z + rand(-1.5, 1.5), rand(0.6, 1.4));
      FX.sparks.emit(c.x, cy, c.z, 30, { color: 0xff4020, color2: 0xffc060, speed: 9, life: 0.6, grav: 10, bright: 1.3 });
      S.flesh(); S.flesh();
      removeEnemy(e);
    } else {
      FX.blood.emit(c.x, cy, c.z, 36, { speed: 5, dy: 2, size: 0.12, stain: 0.2 });
      setState(e, 'dying');
    }
  }
  function alertEnemy(e) {
    if (e.aggro || !e.alive) return;
    e.aggro = true;
    if (e.state === 'idle' || e.state === 'return') setState(e, e.type === 'harpy' ? 'circle' : 'chase');
    if (e.type === 'hound' || e.type === 'minotaur') S.growl();
    // alert neighbours
    for (const o of enemies) {
      if (o !== e && o.alive && !o.aggro && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 26) {
        o.aggro = true;
        if (o.state === 'idle') setState(o, o.type === 'harpy' ? 'circle' : 'chase');
      }
    }
    const kinds = { harpy: 'harpy', hound: 'hound', minotaur: 'minotaur' };
    say(kinds[e.type] || 'aggro');
  }
  function aoe(x, z, r, dmg, knock, stag, heavy = true) {
    for (const e of enemies.slice()) {
      if (!e.alive) continue;
      const dx = e.pos.x - x, dz = e.pos.z - z, d = Math.hypot(dx, dz);
      if (d < r + e.radius) {
        const L = d || 1;
        damageEnemy(e, dmg, dx / L, dz / L, knock, stag, e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, heavy);
      }
    }
  }
  function hurtPlayer(dmg, from, knock) {
    if (P.state === 'dead' || P.state === 'finisher' || P.invuln > 0 || game.state !== 'playing') return false;
    P.hp -= dmg * (P.rageT > 0 ? 0.5 : 1);
    P.invuln = 0.55;
    combo = 0;
    shake(0.4);
    S.hurt();
    hurtFx = 1;
    FX.blood.emit(P.pos.x, P.pos.y + 1.2, P.pos.z, 18, { speed: 4, dy: 1.5, size: 0.1, stain: 0.2 });
    let dx = P.pos.x - from.x, dz = P.pos.z - from.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    P.vel.x = dx * knock; P.vel.z = dz * knock;
    if (P.rageT <= 0) P.rage = Math.min(100, P.rage + dmg * 0.6 * P.rageGain);
    if (P.hp <= 0) { P.hp = 0; playerDie(); return true; }
    if (P.hp < P.maxHp * 0.3) say('hurt');
    if (P.rageT <= 0) {
      P.attack = null; blades.R.flying = blades.L.flying = false;
      P.state = 'hurt'; P.stateT = 0;
      P.facing = Math.atan2(-dx, -dz);
    }
    return true;
  }
  function playerDie() {
    P.state = 'dead'; P.stateT = 0; P.attack = null;
    blades.R.flying = blades.L.flying = false;
    game.overT = 2.4; game.victory = false;
    banner('', 'You have fallen', 2.2);
  }

  function nearestEnemy(maxD, cone = -0.2) {
    let best = null, bd = maxD;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    for (const e of enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, dist = Math.hypot(dx, dz), d = dist - e.radius;
      if (d < bd && (dx * fx + dz * fz) / (dist || 1) > cone) { bd = d; best = e; }
    }
    return best;
  }
  function aimFacing() {
    const mv = moveInput();
    if (mv.lengthSq() > 0.04) return Math.atan2(mv.x, mv.z);
    const e = nearestEnemy(9);
    if (e) return Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    // otherwise strike where the camera looks
    return Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
  }
  function startAttack(name) {
    const Ad = ATTACKS[name];
    P.attack = Ad; P.atkName = name; P.atkT = 0; P.state = 'attack'; P.stateT = 0;
    P.hitMap.clear(); P.queued = null; P.impactDone = false; P.sprint = false;
    P.facing = aimFacing();
    if (!Ad.heavy && !Ad.air) { P.vel.x = Math.sin(P.facing) * 6; P.vel.z = Math.cos(P.facing) * 6; }
    blades.R.flying = !!Ad.R; blades.L.flying = !!Ad.L;
    S.swoosh(Ad.heavy ? 0.7 : rand(0.9, 1.15));
    if (Ad.heavy) setTimeout(() => S.swoosh(0.8), 380);
  }
  function endAttack() {
    P.attack = null; P.state = 'idle'; P.stateT = 0;
    blades.R.flying = blades.L.flying = false;
    if (P.queued === 'light') { P.comboIdx = (P.comboIdx + 1) % CHAIN.length; startAttack(CHAIN[P.comboIdx]); }
    else if (P.queued === 'heavy') { P.comboIdx = -1; startAttack('h1'); }
    else P.comboTimer = 0.45;
  }

  // ===================================================================
  // Actions
  // ===================================================================
  const canAct = () => game.state === 'playing' && !['dead', 'finisher', 'hurt', 'magic'].includes(P.state);
  function actLight() {
    if (!canAct()) return;
    if (P.state === 'dodge') { if (P.stateT > 0.25) P.queued = 'light'; return; }
    if (!P.onGround && P.state !== 'attack') { startAttack('air'); P.vel.y = -24; return; }
    if (P.state === 'attack') { if (!P.attack.air && P.atkT > 0.4) P.queued = 'light'; return; }
    P.comboIdx = P.comboTimer > 0 ? (P.comboIdx + 1) % CHAIN.length : 0;
    startAttack(CHAIN[P.comboIdx]);
  }
  function actHeavy() {
    if (!canAct() || !P.onGround) return;
    if (P.state === 'attack') { if (!P.attack.air && P.atkT > 0.4 && P.atkName !== 'h1') P.queued = 'heavy'; return; }
    if (P.state === 'dodge') return;
    startAttack('h1');
  }
  function actDodge() {
    if (!canAct() || P.state === 'dodge' || !P.onGround) return;
    if (P.state === 'attack' && P.attack.air) return;
    const mv = moveInput();
    if (mv.lengthSq() > 0.04) P.dodgeDir.copy(mv).normalize();
    else P.dodgeDir.set(-Math.sin(P.facing), 0, -Math.cos(P.facing));
    P.attack = null; blades.R.flying = blades.L.flying = false;
    P.state = 'dodge'; P.stateT = 0; P.queued = null;
    P.facing = Math.atan2(P.dodgeDir.x, P.dodgeDir.z);
    P.invuln = Math.max(P.invuln, 0.38);
    S.swoosh(0.5);
    FX.flames.emit(P.pos.x, P.pos.y + 0.2, P.pos.z, 6, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
  }
  function actJump() {
    if (!canAct() || P.state === 'attack' || P.state === 'dodge') return;
    if (P.onGround) { P.vel.y = 10.5; P.onGround = false; P.pos.y += 0.02; P.jumps = 1; S.swoosh(0.4); }
    else if (P.jumps < 2) {
      P.vel.y = 9; P.jumps = 2; S.swoosh(0.6);
      FX.flames.emit(P.pos.x, P.pos.y, P.pos.z, 10, { color: 0xff8a30, speed: 3, life: 0.4, grav: 0, bright: 1.3 });
    }
  }
  function actMagic() {
    if (!canAct() || P.mp < 50 || P.state === 'dodge') return;
    P.mp -= 50;
    P.attack = null; blades.R.flying = blades.L.flying = false;
    P.state = 'magic'; P.stateT = 0; P.magicDone = false;
    S.magic();
    banner('', 'Olympian Wrath', 1.0, true);
  }
  function actRage() {
    if (!canAct() || P.rage < 100 || P.rageT > 0) return;
    P.rageT = P.rageDur;
    S.rage(); shake(0.5);
    FX.flames.emit(P.pos.x, P.pos.y + 1.2, P.pos.z, 60, { color: 0xff5a10, color2: 0xffc060, speed: 8, life: 0.8, grav: -2, bright: 1.6 });
    flash(P.pos.x, P.pos.y + 2, P.pos.z, 0xff5a20, 6, 0.8);
    banner('', 'Rage of Sparta', 1.0, true);
  }
  function actVolley() {
    if (game.state !== 'playing' || AT.volleyCd > 0) return;
    if (!AT.target || !AT.target.alive) AT.target = pickTarget(40);
    AT.volleyQ = 3; AT.volleyT = 0.1;
    AT.volleyCd = Math.max(5, 10 - upgrades.bow * 1.2);
    say('volley', true);
  }
  // E: execute, open, pray (in that order)
  function actUse() {
    if (!canAct() || P.state === 'attack' || P.state === 'dodge') return;
    const fin = finishCandidate();
    if (fin) return startFinisher(fin);
    const ch = chestCandidate();
    if (ch) return openChest(ch);
    const al = altarCandidate();
    if (al) return openShop(al);
  }
  function startFinisher(e) {
    P.state = 'finisher'; P.stateT = 0; P.finT = 0; P.finTarget = e;
    P.attack = null; blades.R.flying = blades.L.flying = true;
    P.facing = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    P.vel.set(0, 0, 0); e.vel.set(0, 0, 0);
    if (e.def.boss) { setState(e, 'executed'); slowmo = 2.6; }
    else { setState(e, 'finished'); slowmo = 0.9; }
    S.swoosh(0.6);
  }
  function finishCandidate() {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (!e.alive || !e.finishable) continue;
      if (e.state === 'finished' || e.state === 'executed' || e.state === 'spawn') continue;
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.radius;
      if (d < (e.def.boss ? 6 : 3.2) && d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function chestCandidate() {
    for (const c of W.chests) if (!c.open && Math.hypot(c.x - P.pos.x, c.z - P.pos.z) < 2.6) return c;
    return null;
  }
  function altarCandidate() {
    for (const a of W.altars) if (Math.hypot(a.x - P.pos.x, a.z - P.pos.z) < 4) return a;
    return null;
  }
  function openChest(c) {
    if (c.kind === 'reward' && !camps[c.camp].cleared) { banner('', 'Sealed until the stronghold falls', 1.6, true); return; }
    c.open = true; stats.chests++;
    c.lock.visible = false;
    S.chest();
    const p = V3(c.x, c.y, c.z);
    FX.sparks.emit(c.x, c.y + 0.8, c.z, 40, { color: 0xffd070, color2: 0xffffff, speed: 5, up: 3, life: 0.8, grav: 4, bright: 1.6 });
    if (c.kind === 'eye') { bonus.hp += 20; applyUpgrades(); P.hp = P.maxHp; banner('Gorgon Eye', 'Maximum health increased', 2.2, true); dropOrbs(p, 40, 0, 0, c.y); }
    else if (c.kind === 'feather') { bonus.mp += 20; applyUpgrades(); P.mp = P.maxMp; banner('Phoenix Feather', 'Maximum magic increased', 2.2, true); dropOrbs(p, 40, 0, 0, c.y); }
    else if (c.kind === 'reward') { dropOrbs(p, 260, 2, 2, c.y); banner('Spoils of war', '+260 red orbs', 1.8, true); }
    else dropOrbs(p, rand(90, 150), 1, 1, c.y);
    say('chest');
  }

  // ===================================================================
  // Input
  // ===================================================================
  const keys = {};
  const touchMove = { x: 0, y: 0, full: 0 };
  const cam = { yaw: 0, pitch: 0.22, dist: 5.5, target: V3(), pos: V3(), side: 0.6 };
  const moveVec = V3();
  function moveInput() {
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
    let my = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchMove.y;
    const L = Math.hypot(mx, my);
    if (L > 1) { mx /= L; my /= L; }
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return moveVec.set(rx * mx + fx * my, 0, rz * mx + fz * my);
  }
  const ACTIONS = { light: actLight, heavy: actHeavy, dodge: actDodge, jump: actJump, magic: actMagic, rage: actRage, use: actUse, arrow: actVolley, map: () => toggleMap() };
  let shiftDownT = -1;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === 'map') toggleMap();
      else if (game.state === 'playing') pauseGame(); else if (game.state === 'paused') resumeGame();
      return;
    }
    if (e.code === 'KeyM') { updateMenuLabels(S.toggleMute()); return; }
    if (e.code === 'KeyN' || e.code === 'Tab') { toggleMap(); return; }
    if (game.state !== 'playing') return;
    switch (e.code) {
      case 'KeyJ': actLight(); break;
      case 'KeyK': actHeavy(); break;
      case 'Space': actJump(); break;
      case 'ShiftLeft': case 'ShiftRight': shiftDownT = game.time; actDodge(); break;
      case 'KeyL': actDodge(); break;
      case 'KeyF': actMagic(); break;
      case 'KeyQ': actRage(); break;
      case 'KeyE': actUse(); break;
      case 'KeyR': actVolley(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code.startsWith('Shift')) shiftDownT = -1; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (game.state === 'playing') pauseGame(); });

  const canvas = G.renderer.domElement;
  const isTouch = G.settings.isTouch;
  let mouseDown = false, wantLock = false, lockedOnce = false;
  const locked = () => document.pointerLockElement === canvas;
  const requestLock = () => {
    if (!wantLock || !canvas.requestPointerLock) return;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* unavailable */ }
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (game.state !== 'playing' || isTouch) return;
    if (!locked()) requestLock();
    mouseDown = true;
    if (e.button === 0) actLight(); else if (e.button === 2) actHeavy();
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (game.state !== 'playing') return;
    if (locked() || mouseDown) {
      cam.yaw -= e.movementX * 0.0024;
      cam.pitch = clamp(cam.pitch + e.movementY * 0.0019, -0.25, 1.05);
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (locked()) lockedOnce = true;
    else if (lockedOnce && game.state === 'playing') pauseGame();
  });
  (function setupTouch() {
    const stick = $('stick'), knob = $('knob');
    let stickId = null, camId = null, camX = 0, camY = 0;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x}px, ${y}px)`; };
    const moveStick = (e) => {
      if (e.pointerId !== stickId) return;
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const L = Math.hypot(dx, dy), max = r.width / 2;
      if (L > max) { dx = (dx / L) * max; dy = (dy / L) * max; }
      setKnob(dx, dy);
      touchMove.x = dx / max; touchMove.y = -dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
    stick.addEventListener('pointermove', moveStick);
    const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; touchMove.x = touchMove.y = 0; setKnob(0, 0); };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    document.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const f = ACTIONS[b.dataset.act]; if (f) f(); });
    });
    $('tPause').addEventListener('click', () => pauseGame());
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || camId !== null) return; camId = e.pointerId; camX = e.clientX; camY = e.clientY; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== camId) return;
      cam.yaw -= (e.clientX - camX) * 0.006;
      cam.pitch = clamp(cam.pitch + (e.clientY - camY) * 0.004, -0.25, 1.05);
      camX = e.clientX; camY = e.clientY;
    });
    const endCam = (e) => { if (e.pointerId === camId) camId = null; };
    canvas.addEventListener('pointerup', endCam);
    canvas.addEventListener('pointercancel', endCam);
  })();

  // ===================================================================
  // UI
  // ===================================================================
  const ui = {
    hud: $('hud'), hp: $('hpFill'), mp: $('mpFill'), rage: $('rageFill'), rageBar: $('rageBar'), orbs: $('orbs'),
    combo: $('combo'), comboN: $('comboN'), bossBar: $('bossBar'), bossFill: $('bossFill'),
    prompt: $('prompt'), banner: $('banner'), bannerSub: $('bannerSub'), bannerMain: $('bannerMain'),
    touch: $('touch'), questTitle: $('questTitle'), questList: $('questList'), questDist: $('questDist'),
    volley: $('volley'), minimap: $('minimap'), bloodScreen: $('bloodScreen'), subtitle: $('subtitle'),
  };
  const mm = ui.minimap.getContext('2d');
  let bannerT = 0;
  function banner(sub, main, dur = 2.5, quick = false) {
    ui.bannerSub.textContent = sub; ui.bannerMain.textContent = main;
    ui.banner.classList.add('show');
    ui.banner.classList.toggle('quick', quick);
    bannerT = dur;
  }
  function updateMenuLabels(muted = S.muted) {
    $('muteBtn').textContent = muted ? 'Sound: off' : 'Sound: on';
    $('qualityBtn').textContent = `Graphics: ${G.settings.quality === 'high' ? 'high' : 'low'}`;
    $('bloodBtn').textContent = `Blood: ${G.settings.blood ? 'on' : 'off'}`;
  }
  function objective() {
    if (Q.stage === 0) {
      let best = null, bd = Infinity;
      for (const k in camps) {
        if (camps[k].cleared) continue;
        const p = W.POI[k], d = Math.hypot(p.x - P.pos.x, p.z - P.pos.z);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    if (Q.stage === 1) return { x: W.temple.gx, z: W.temple.gz, name: W.POI.temple.name };
    if (Q.stage === 2 && boss) return { x: boss.pos.x, z: boss.pos.z, name: 'Polyphemos' };
    return null;
  }
  let lastQuestKey = '', lastPrompt = '';
  function updateQuestPanel() {
    let title, items = [];
    if (Q.stage === 0) {
      title = 'Purge the strongholds of Tartarus';
      items = ['legion', 'harpy', 'laby'].map((k) => [W.POI[k].name, camps[k] && camps[k].cleared]);
    } else if (Q.stage === 1) { title = 'Enter the Temple of Polyphemos'; items = [['The fire barrier has fallen', true]]; }
    else if (Q.stage === 2) { title = 'Slay Polyphemos'; }
    else { title = 'Olympus trembles'; items = [[`Chests opened: ${stats.chests} of ${W.chests.length}`, stats.chests >= W.chests.length]]; }
    const key = title + JSON.stringify(items);
    if (key !== lastQuestKey) {
      lastQuestKey = key;
      ui.questTitle.textContent = title;
      ui.questList.innerHTML = items.map(([t, done]) => `<li class="${done ? 'done' : ''}">${t}</li>`).join('');
    }
    const o = objective();
    ui.questDist.textContent = o ? `${o.name} · ${Math.round(Math.hypot(o.x - P.pos.x, o.z - P.pos.z))} m` : '';
  }
  function updateHUD(dt) {
    ui.hp.style.width = (100 * P.hp / P.maxHp).toFixed(1) + '%';
    ui.mp.style.width = (100 * P.mp / P.maxMp).toFixed(1) + '%';
    const rf = P.rageT > 0 ? P.rageT / P.rageDur : P.rage / 100;
    ui.rage.style.width = (100 * rf).toFixed(1) + '%';
    ui.rageBar.classList.toggle('ready', P.rage >= 100 && P.rageT <= 0);
    ui.orbs.textContent = Math.floor(P.orbs);
    ui.combo.style.opacity = combo >= 3 ? 1 : 0;
    ui.comboN.textContent = combo;
    const vcd = AT.volleyCd / Math.max(5, 10 - upgrades.bow * 1.2);
    ui.volley.style.setProperty('--cd', (vcd * 100).toFixed(0) + '%');
    ui.volley.classList.toggle('ready', AT.volleyCd <= 0);
    if (boss && boss.alive) { ui.bossBar.hidden = false; ui.bossFill.style.width = (100 * Math.max(0, boss.hp) / boss.maxHp).toFixed(1) + '%'; }
    else ui.bossBar.hidden = true;
    let prompt = '';
    if (game.state === 'playing' && canAct()) {
      const k = isTouch ? 'Use' : 'E';
      if (finishCandidate()) prompt = `<kbd>${k}</kbd>Execute`;
      else {
        const c = chestCandidate();
        if (c) prompt = c.kind === 'reward' && !camps[c.camp].cleared ? 'Sealed until the stronghold falls' : `<kbd>${k}</kbd>Open chest`;
        else if (altarCandidate()) prompt = `<kbd>${k}</kbd>Pray at the altar`;
      }
    }
    if (prompt !== lastPrompt) { ui.prompt.innerHTML = prompt; ui.prompt.hidden = !prompt; lastPrompt = prompt; }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) ui.banner.classList.remove('show'); }
    if (subT > 0) { subT -= dt; if (subT <= 0) ui.subtitle.classList.remove('show'); }
    hurtFx = Math.max(0, hurtFx - dt * 1.2);
    const low = P.hp < P.maxHp * 0.3 && P.state !== 'dead' ? 0.4 + 0.15 * Math.sin(game.time * 5) : 0;
    ui.bloodScreen.style.opacity = G.settings.blood ? (Math.max(hurtFx, low) * 0.8).toFixed(2) : 0;
    G.post.hurt.value = Math.max(hurtFx * 0.6, low * 0.8);
    G.post.rage.value = P.rageT > 0 ? 0.8 + 0.2 * Math.sin(game.time * 8) : 0;
    updateQuestPanel();
    drawMinimap();
  }

  // minimap: north follows the camera
  const MAP_S = W.mapCanvas.width, WORLD = W.SIZE;
  function drawMinimap() {
    const c = ui.minimap, s = c.width, R = 110; // world metres shown from centre to edge
    mm.save();
    mm.clearRect(0, 0, s, s);
    mm.beginPath(); mm.arc(s / 2, s / 2, s / 2 - 2, 0, TAU); mm.clip();
    mm.fillStyle = '#1d1410'; mm.fillRect(0, 0, s, s);
    mm.translate(s / 2, s / 2);
    mm.rotate(cam.yaw - Math.PI);
    const k = (s / 2) / R, px = (P.pos.x + W.HALF) / WORLD * MAP_S, pz = (P.pos.z + W.HALF) / WORLD * MAP_S;
    const span = R / WORLD * MAP_S;
    mm.drawImage(W.mapCanvas, px - span * 1.5, pz - span * 1.5, span * 3, span * 3, -R * 1.5 * k, -R * 1.5 * k, R * 3 * k, R * 3 * k);
    const dot = (x, z, r, col, ring) => {
      const dx = (x - P.pos.x) * k, dz = (z - P.pos.z) * k;
      if (Math.hypot(dx, dz) > s / 2 + 20) return;
      mm.beginPath(); mm.arc(dx, dz, r, 0, TAU);
      mm.fillStyle = col; mm.fill();
      if (ring) { mm.strokeStyle = ring; mm.lineWidth = 2; mm.stroke(); }
    };
    for (const c2 of W.chests) if (!c2.open) dot(c2.x, c2.z, 3, '#ffd070');
    for (const a of W.altars) dot(a.x, a.z, 4.5, '#5ab0ff', '#0d0806');
    for (const k2 in camps) if (!camps[k2].cleared) dot(W.POI[k2].x, W.POI[k2].z, 6, 'rgba(255,170,60,.9)', '#0d0806');
    if (Q.stage >= 1) dot(W.temple.x, W.temple.z, 7, '#ff5a3a', '#0d0806');
    for (const e of enemies) if (e.alive && e.aggro) dot(e.pos.x, e.pos.z, 2.6, '#ff3a2a');
    dot(AT.pos.x, AT.pos.z, 3, '#8fe07a', '#0d0806');
    mm.restore();
    // player arrow (always points up: the map turns with the camera)
    mm.save();
    mm.translate(s / 2, s / 2);
    mm.rotate(cam.yaw - Math.PI - P.facing + Math.PI);
    mm.beginPath(); mm.moveTo(0, -8); mm.lineTo(6, 6); mm.lineTo(0, 3); mm.lineTo(-6, 6); mm.closePath();
    mm.fillStyle = '#ecdfc6'; mm.fill(); mm.strokeStyle = '#0d0806'; mm.lineWidth = 1.5; mm.stroke();
    mm.restore();
    // objective direction on the rim
    const o = objective();
    if (o) {
      const ang = Math.atan2(o.x - P.pos.x, o.z - P.pos.z);
      const d = Math.hypot(o.x - P.pos.x, o.z - P.pos.z);
      const rr = Math.min(s / 2 - 8, d * k);
      const a2 = ang + (cam.yaw - Math.PI);
      const ox = s / 2 + Math.sin(a2) * rr, oy = s / 2 + Math.cos(a2) * rr;
      mm.fillStyle = '#ffb040'; mm.strokeStyle = '#0d0806'; mm.lineWidth = 2;
      mm.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 3 : 7, t = (i / 10) * TAU; mm.lineTo(ox + Math.sin(t) * r, oy - Math.cos(t) * r); }
      mm.closePath(); mm.fill(); mm.stroke();
    }
    mm.strokeStyle = '#bb8e4a'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(s / 2, s / 2, s / 2 - 2, 0, TAU); mm.stroke();
  }
  // full world map
  function drawWorldMap() {
    const c = $('worldmap'), g = c.getContext('2d'), s = c.width, k = s / WORLD;
    g.drawImage(W.mapCanvas, 0, 0, s, s);
    const at = (x, z) => [(x + W.HALF) * k, (z + W.HALF) * k];
    const label = (x, z, text, col) => {
      const [px, pz] = at(x, z);
      g.font = '600 15px Cinzel, Georgia, serif'; g.textAlign = 'center';
      g.lineWidth = 4; g.strokeStyle = 'rgba(13,8,6,.85)'; g.strokeText(text, px, pz - 14);
      g.fillStyle = col; g.fillText(text, px, pz - 14);
    };
    const icon = (x, z, r, col) => { const [px, pz] = at(x, z); g.beginPath(); g.arc(px, pz, r, 0, TAU); g.fillStyle = col; g.fill(); g.strokeStyle = '#0d0806'; g.lineWidth = 2; g.stroke(); };
    for (const ch of W.chests) if (!ch.open) icon(ch.x, ch.z, 4, '#ffd070');
    for (const a of W.altars) { icon(a.x, a.z, 6, '#5ab0ff'); }
    label(W.altars[0].x, W.altars[0].z, 'Altar', '#9ad0ff'); label(W.altars[1].x, W.altars[1].z, 'Altar', '#9ad0ff');
    for (const key of ['legion', 'harpy', 'laby']) {
      const p = W.POI[key], cl = camps[key] && camps[key].cleared;
      icon(p.x, p.z, 8, cl ? '#7a6a5a' : '#ffaa3c'); label(p.x, p.z, p.name + (cl ? ' ✓' : ''), cl ? '#b8a890' : '#ffd29a');
    }
    icon(W.temple.x, W.temple.z, 9, Q.stage >= 1 ? '#ff5a3a' : '#6a4a40');
    label(W.temple.x, W.temple.z, W.POI.temple.name, Q.stage >= 1 ? '#ffb09a' : '#b8a890');
    const [px, pz] = at(P.pos.x, P.pos.z);
    g.save(); g.translate(px, pz); g.rotate(-P.facing + Math.PI);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath();
    g.fillStyle = '#ecdfc6'; g.fill(); g.strokeStyle = '#0d0806'; g.lineWidth = 2; g.stroke();
    g.restore();
  }
  function toggleMap() {
    if (game.state === 'playing') {
      game.state = 'map'; drawWorldMap(); showScreen('map'); ui.touch.hidden = true;
      if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); }
    } else if (game.state === 'map') {
      game.state = 'playing'; showScreen(null); ui.touch.hidden = !isTouch; requestLock();
    }
  }
  function showScreen(id) { ['title', 'pause', 'shop', 'over', 'map'].forEach((s) => { $(s).hidden = s !== id; }); }

  // ===================================================================
  // Shop (altars)
  // ===================================================================
  const UPGRADES = [
    { id: 'blades', name: 'Blades of Ash', desc: '+20% damage from every blade strike', base: 120, max: 5 },
    { id: 'vigor', name: 'Spartan Vigor', desc: '+25 maximum health', base: 100, max: 5 },
    { id: 'aether', name: 'Aether Reservoir', desc: '+25 maximum magic for Olympian Wrath', base: 90, max: 4 },
    { id: 'fury', name: 'Undying Fury', desc: '+2 s Rage of Sparta, and rage builds 25% faster', base: 110, max: 4 },
    { id: 'bow', name: 'Atreus\'s Bow', desc: 'Atreus shoots faster and harder, and his volley recharges sooner', base: 100, max: 4 },
  ];
  function applyUpgrades() {
    P.dmgMult = 1 + 0.2 * upgrades.blades;
    P.maxHp = 100 + 25 * upgrades.vigor + bonus.hp;
    P.maxMp = 100 + 25 * upgrades.aether + bonus.mp;
    P.rageDur = 8 + 2 * upgrades.fury;
    P.rageGain = 1 + 0.25 * upgrades.fury;
  }
  function openShop(altar) {
    game.state = 'shop';
    checkpoint = altar;
    if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); }
    P.hp = P.maxHp; P.mp = P.maxMp;
    S.altar();
    renderShop();
    showScreen('shop');
    ui.touch.hidden = true;
  }
  function renderShop() {
    $('shopOrbs').textContent = Math.floor(P.orbs);
    const list = $('upgrades');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lvl = upgrades[u.id], cost = u.base * (lvl + 1), maxed = lvl >= u.max;
      const el = document.createElement('div');
      el.className = 'upg';
      el.innerHTML = `<h3>${u.name}</h3><p>${u.desc}</p><p class="pips">${'◆'.repeat(lvl)}${'◇'.repeat(u.max - lvl)}</p>`;
      const btn = document.createElement('button');
      btn.className = 'btn'; btn.type = 'button'; btn.id = 'buy-' + u.id;
      btn.textContent = maxed ? 'Mastered' : `${cost} orbs`;
      btn.disabled = maxed || P.orbs < cost;
      btn.addEventListener('click', () => {
        if (P.orbs < cost || maxed) return;
        P.orbs -= cost; upgrades[u.id]++;
        applyUpgrades(); P.hp = P.maxHp; P.mp = P.maxMp;
        S.pickup('red'); S.clang();
        renderShop();
      });
      el.appendChild(btn);
      list.appendChild(el);
    }
  }
  function closeShop() {
    if (game.state !== 'shop') return;
    game.state = 'playing';
    showScreen(null);
    ui.touch.hidden = !isTouch;
    requestLock();
  }

  // ===================================================================
  // Game flow
  // ===================================================================
  function clearTransient() {
    for (const o of orbs) scene.remove(o.m);
    orbs.length = 0;
    for (const fx of effects) fx.dispose();
    effects.length = 0;
    for (const p of projectiles) scene.remove(p.m);
    projectiles.length = 0;
    for (const a of arrows) scene.remove(a.m);
    arrows.length = 0;
  }
  function placeAtSpawn(at) {
    const x = at.x, z = at.z + 6;
    P.pos.set(x, ground(x, z), z);
    P.vel.set(0, 0, 0);
    P.facing = Math.PI;
    AT.pos.set(x - 2, ground(x - 2, z + 2), z + 2);
    AT.vel.set(0, 0, 0);
    cam.yaw = 0;
    cam.target.set(P.pos.x, P.pos.y + 1.6, P.pos.z);
  }
  function resetPlayerState() {
    Object.assign(P, { hp: P.maxHp, mp: P.maxMp, rageT: 0, state: 'idle', stateT: 0, attack: null, invuln: 1.5, comboIdx: 0, comboTimer: 0, queued: null, onGround: true, jumps: 0, sprint: false, finTarget: null });
    P.rig.rotation.set(0, 0, 0); P.rig.position.y = 0.97;
    blades.R.flying = blades.L.flying = false;
  }
  function startGame() {
    S.init(); S.stopMusic(); S.startMusic();
    clearTransient();
    for (const e of enemies.slice()) removeEnemy(e);
    for (const k in upgrades) upgrades[k] = 0;
    bonus.hp = bonus.mp = 0;
    applyUpgrades();
    P.rage = 0; P.orbs = 0; P.bladeBlood = 0;
    Object.assign(stats, { kills: 0, maxCombo: 0, orbs: 0, chests: 0 });
    for (const c of W.chests) { c.open = false; c.openT = 0; c.lid.rotation.x = 0; c.lock.visible = true; }
    for (const k in CAMP_DEFS) { camps[k] = null; spawnCamp(k); W.beacons[k].visible = true; }
    W.beacons.temple.visible = false;
    W.temple.setSealed(true);
    Q.stage = 0; boss = null; game.freeRoam = false;
    FX.clear();
    checkpoint = W.altars[0];
    resetPlayerState();
    placeAtSpawn(checkpoint);
    combo = 0; slowmo = 0; hitstop = 0; roamers.t = 50;
    AT.volleyCd = 0; AT.lineCd = 2; AT.idleT = 40;
    game.time = 0; game.overT = -1; game.victory = false;
    game.state = 'playing';
    showScreen(null);
    ui.hud.hidden = false;
    ui.touch.hidden = !isTouch;
    wantLock = !isTouch;
    banner('Shrine of Hephaestus', 'Purge the strongholds', 3);
    setTimeout(() => say('start', true), 3200);
  }
  function respawn() {
    clearTransient();
    // strongholds that still stand recover their dead; wanderers leave
    for (const k in camps) {
      if (camps[k].cleared) continue;
      for (const e of camps[k].members) if (enemies.includes(e)) removeEnemy(e);
      spawnCamp(k);
    }
    for (const e of enemies.slice()) if (e.roamer || !e.camp) removeEnemy(e);
    if (Q.stage === 2) { Q.stage = 1; boss = null; W.temple.setSealed(false); }
    resetPlayerState();
    placeAtSpawn(checkpoint);
    game.overT = -1;
    game.state = 'playing';
    showScreen(null);
    ui.touch.hidden = !isTouch;
    requestLock();
    banner('', 'Rise, Spartan', 1.8);
  }
  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    updateMenuLabels();
    showScreen('pause');
    ui.touch.hidden = true;
  }
  function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    showScreen(null);
    ui.touch.hidden = !isTouch;
    requestLock();
  }
  function endScreen(victory) {
    game.state = 'over';
    if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); }
    ui.touch.hidden = true;
    $('overEyebrow').textContent = victory ? 'The trial is complete' : 'The Fates cut your thread';
    $('overTitle').textContent = victory ? 'Olympus trembles' : 'You have fallen';
    $('overText').textContent = victory
      ? 'Polyphemos lies blinded in the ash, and the land is quiet. Keep exploring with Atreus, or start a new journey.'
      : `Atreus drags you back to the ${checkpoint === W.altars[0] ? 'Shrine of Hephaestus' : 'Crossroads altar'}. Strongholds you cleared stay cleared.`;
    $('stKills').textContent = stats.kills;
    $('stCombo').textContent = stats.maxCombo;
    $('stChests').textContent = `${stats.chests}/${W.chests.length}`;
    const t = Math.floor(game.time);
    $('stTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('againBtn').textContent = victory ? 'Explore freely' : 'Rise again';
    $('newBtn').hidden = !victory;
    showScreen('over');
  }
  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', () => {
    if (game.victory) { game.victory = false; game.freeRoam = true; game.state = 'playing'; showScreen(null); ui.touch.hidden = !isTouch; requestLock(); }
    else respawn();
  });
  $('newBtn').addEventListener('click', startGame);
  $('restartBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resumeGame);
  $('nextBtn').addEventListener('click', closeShop);
  $('mapClose').addEventListener('click', toggleMap);
  $('muteBtn').addEventListener('click', () => updateMenuLabels(S.toggleMute()));
  $('qualityBtn').addEventListener('click', () => {
    G.settings.quality = G.settings.quality === 'high' ? 'low' : 'high';
    G.saveSettings(); G.applyQuality(); updateMenuLabels();
  });
  $('bloodBtn').addEventListener('click', () => {
    G.settings.blood = !G.settings.blood;
    if (!G.settings.blood) { FX.blood.clear(); FX.decals.clear(); }
    G.saveSettings(); updateMenuLabels();
  });

  function campCheck() {
    for (const k in camps) {
      const c = camps[k];
      if (c.cleared) continue;
      if (c.members.every((e) => !e.alive)) {
        c.cleared = true;
        W.beacons[k].visible = false;
        banner('Stronghold cleared', c.name, 2.6);
        S.altar();
        say('clear', true);
        if (Object.values(camps).every((x) => x.cleared) && Q.stage === 0) {
          Q.stage = 1;
          W.temple.setSealed(false);
          W.beacons.temple.visible = true;
          setTimeout(() => { banner('The fire has died', 'The temple is open', 3); say('temple', true); }, 3000);
        }
      }
    }
    // the boss fight begins when the Spartan walks into the arena
    if (Q.stage === 1 && Math.hypot(P.pos.x - W.temple.x, P.pos.z - W.temple.z) < W.temple.R - 5) {
      Q.stage = 2;
      W.temple.setSealed(true);
      const back = W.temple.ent + Math.PI;
      boss = spawnEnemy('cyclops', W.temple.x + Math.sin(back) * 12, W.temple.z + Math.cos(back) * 12, { rise: true, aggro: true });
      banner('The Cyclops King', 'Polyphemos', 3);
      S.roar(0.6); shake(0.8);
      setTimeout(() => say('boss', true), 2500);
    }
  }
  function updateRoamers(dt) {
    roamers.t -= dt;
    for (const e of enemies.slice()) {
      if (e.roamer && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) > 200) removeEnemy(e);
    }
    if (roamers.t > 0 || Q.stage === 2) return;
    roamers.t = rand(45, 75);
    if (enemies.filter((e) => e.roamer && e.alive).length >= 4) return;
    for (let t = 0; t < 20; t++) {
      const a = rand(0, TAU), r = rand(60, 95);
      const x = P.pos.x + Math.sin(a) * r, z = P.pos.z + Math.cos(a) * r;
      if (Math.abs(x) > 330 || Math.abs(z) > 330 || W.isWater(x, z) || W.nearPOI(x, z, 25) || ground(x, z) > 45) continue;
      const pack = Math.random() < 0.5 ? ['hound', 'hound', 'hound'] : ['legion', 'legion', Math.random() < 0.5 ? 'legion' : 'hound'];
      pack.forEach((type, i) => spawnEnemy(type, x + Math.sin(i * 2.1) * 2.5, z + Math.cos(i * 2.1) * 2.5, { roamer: true, rise: true }));
      break;
    }
  }

  // ===================================================================
  // Player update
  // ===================================================================
  function steep(oh, x, z, d) { return ground(x, z) - oh > d * 1.5 + 0.03; }
  function moveOnGround(pos, dx, dz, radius, onGround) {
    const ox = pos.x, oz = pos.z, oh = ground(ox, oz), d = Math.hypot(dx, dz);
    const bad = (x, z) => W.isWater(x, z) || (onGround && steep(oh, x, z, d));
    let nx = ox + dx, nz = oz + dz;
    if (bad(nx, nz)) {
      if (!bad(ox + dx, oz)) { nx = ox + dx; nz = oz; }
      else if (!bad(ox, oz + dz)) { nx = ox; nz = oz + dz; }
      else { nx = ox; nz = oz; }
    }
    pos.x = clamp(nx, -BOUND, BOUND); pos.z = clamp(nz, -BOUND, BOUND);
    return W.colliders.push(pos, radius);
  }
  function updatePlayer(dt) {
    P.stateT += dt;
    P.invuln = Math.max(0, P.invuln - dt);
    P.comboTimer = Math.max(0, P.comboTimer - dt);
    P.bladeBlood = Math.max(0, P.bladeBlood - dt * 0.012);
    if (P.rageT > 0) {
      P.rageT -= dt; P.rage = 100 * Math.max(0, P.rageT) / P.rageDur;
      if (P.rageT <= 0) { P.rageT = 0; P.rage = 0; }
      if (Math.random() < 0.5) FX.flames.emit(P.pos.x, P.pos.y + rand(0.5, 2), P.pos.z, 1, { color: 0xff5a10, speed: 1, life: 0.5, grav: -3, spread: 0.4, bright: 1.3 });
    }
    const mv = moveInput();
    const moving = mv.lengthSq() > 0.01;
    const shiftHeld = shiftDownT >= 0 && game.time - shiftDownT > 0.3;
    if (touchMove.x * touchMove.x + touchMove.y * touchMove.y > 0.9) touchMove.full += dt; else touchMove.full = 0;
    P.sprint = moving && (shiftHeld || touchMove.full > 0.5) && P.onGround && (P.state === 'idle' || P.state === 'run');
    const speed = P.sprint ? 12 : (P.rageT > 0 ? 8.4 : 7.2);

    switch (P.state) {
      case 'idle': case 'run': {
        const k = damp(P.onGround ? 12 : 4, dt);
        P.vel.x = lerp(P.vel.x, mv.x * speed, k); P.vel.z = lerp(P.vel.z, mv.z * speed, k);
        if (moving) P.facing = angleLerp(P.facing, Math.atan2(mv.x, mv.z), damp(14, dt));
        P.state = moving ? 'run' : 'idle';
        break;
      }
      case 'attack': {
        const Ad = P.attack;
        P.atkT += (dt * (P.rageT > 0 ? 1.3 : 1)) / Ad.dur;
        P.vel.x *= Math.exp(-9 * dt); P.vel.z *= Math.exp(-9 * dt);
        if (Ad.air) { P.atkT = 0.5; if (P.onGround) { airSlamImpact(); endAttack(); } break; }
        if (Ad.impact && !P.impactDone && P.atkT >= Ad.impact) {
          P.impactDone = true;
          const cx = P.pos.x + Math.sin(P.facing) * 5.8, cz = P.pos.z + Math.cos(P.facing) * 5.8, cy = ground(cx, cz);
          aoe(cx, cz, Ad.impactR, Ad.dmg * 0.6, Ad.knock, Ad.stag);
          shockwave(cx, cz, 0.5, Ad.impactR + 1, 0.35);
          FX.sparks.emit(cx, cy + 0.3, cz, 35, { color: 0xffa040, color2: 0xff5010, speed: 9, up: 3, life: 0.5, bright: 1.3 });
          FX.flames.emit(cx, cy + 0.3, cz, 10, { color: 0x6a5040, speed: 3, life: 0.8, grav: -1 });
          shake(0.45); S.boom();
        }
        if (P.atkT >= 1) endAttack();
        break;
      }
      case 'dodge': {
        const dur = 0.45, k = P.stateT / dur;
        const sp = 16 * Math.pow(Math.max(0, 1 - k), 0.6);
        P.vel.x = P.dodgeDir.x * sp; P.vel.z = P.dodgeDir.z * sp;
        if (P.stateT >= dur) {
          P.state = 'idle'; P.stateT = 0;
          if (P.queued === 'light') { P.queued = null; P.comboIdx = 0; startAttack('l1'); }
        }
        break;
      }
      case 'hurt':
        P.vel.x *= Math.exp(-7 * dt); P.vel.z *= Math.exp(-7 * dt);
        if (P.stateT > 0.38) { P.state = 'idle'; P.stateT = 0; }
        break;
      case 'magic':
        P.vel.x *= Math.exp(-10 * dt); P.vel.z *= Math.exp(-10 * dt);
        P.invuln = Math.max(P.invuln, 0.1);
        if (!P.magicDone && P.stateT > 0.35) {
          P.magicDone = true;
          shockwave(P.pos.x, P.pos.z, 1, 11, 0.6, 0x7ab8ff);
          shockwave(P.pos.x, P.pos.z, 1, 8, 0.45, 0xffa040);
          for (let i = 0; i < 6; i++) { const a = rand(0, TAU), r = rand(2, 9); lightning(P.pos.x + Math.sin(a) * r, P.pos.z + Math.cos(a) * r); }
          for (const e of enemies) if (e.alive && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 11) lightning(e.pos.x, e.pos.z);
          flash(P.pos.x, P.pos.y + 4, P.pos.z, 0x9ac8ff, 9, 0.7);
          FX.sparks.emit(P.pos.x, P.pos.y + 1, P.pos.z, 120, { color: 0x9ac8ff, color2: 0xffffff, speed: 16, life: 0.6, grav: 4, flat: true, bright: 1.6 });
          aoe(P.pos.x, P.pos.z, 11, 38, 14, 1.0);
          shake(0.7); S.boom();
        }
        if (P.stateT > 0.8) { P.state = 'idle'; P.stateT = 0; }
        break;
      case 'finisher': updateFinisher(dt); break;
      case 'dead': P.vel.x *= Math.exp(-5 * dt); P.vel.z *= Math.exp(-5 * dt); break;
      default: break;
    }

    // terrain-following movement
    moveOnGround(P.pos, P.vel.x * dt, P.vel.z * dt, 0.45, P.onGround);
    // boss arena keeps you in
    if (Q.stage === 2) {
      const dx = P.pos.x - W.temple.x, dz = P.pos.z - W.temple.z, d = Math.hypot(dx, dz), lim = W.temple.R - 0.5;
      if (d > lim) { P.pos.x = W.temple.x + dx / d * lim; P.pos.z = W.temple.z + dz / d * lim; }
    }
    const gy = ground(P.pos.x, P.pos.z);
    if (P.onGround) {
      if (P.pos.y - gy < 0.7) { P.pos.y = gy; P.vel.y = 0; } else P.onGround = false;
    }
    if (!P.onGround) {
      P.vel.y -= 28 * dt;
      P.pos.y += P.vel.y * dt;
      if (P.pos.y <= gy) {
        if (P.vel.y < -12) FX.flames.emit(P.pos.x, gy + 0.2, P.pos.z, 6, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
        P.pos.y = gy; P.vel.y = 0; P.onGround = true; P.jumps = 0;
      }
    }
    for (const e of enemies) {
      if (!e.alive || e.type === 'harpy' || e.state === 'spawn' || P.state === 'dodge') continue;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz), m = e.radius + 0.45;
      if (d < m && d > 1e-4) { P.pos.x = e.pos.x + (dx / d) * m; P.pos.z = e.pos.z + (dz / d) * m; }
    }
    P.root.rotation.y = P.facing;
    animatePlayer(dt);
  }
  function airSlamImpact() {
    aoe(P.pos.x, P.pos.z, 4.6, 20, 9, 0.8);
    shockwave(P.pos.x, P.pos.z, 0.5, 5.5, 0.4);
    FX.sparks.emit(P.pos.x, P.pos.y + 0.3, P.pos.z, 50, { color: 0xffa040, color2: 0xff5010, speed: 11, up: 3, life: 0.5, bright: 1.3 });
    FX.flames.emit(P.pos.x, P.pos.y + 0.3, P.pos.z, 16, { color: 0x6a5040, speed: 4, life: 0.8, grav: -1 });
    shake(0.55); S.boom();
    P.vel.set(0, 0, 0);
  }
  function updateFinisher(dt) {
    const e = P.finTarget;
    P.finT += dt;
    if (!e) { P.state = 'idle'; return; }
    P.invuln = 0.3;
    P.facing = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    if (!e.def.boss) {
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z), want = e.radius + 0.9;
      if (d > want) {
        const k = Math.min(1, (d - want) * 0.25 + 0.15);
        P.pos.x = lerp(P.pos.x, e.pos.x - Math.sin(P.facing) * want, k);
        P.pos.z = lerp(P.pos.z, e.pos.z - Math.cos(P.facing) * want, k);
      }
      if (P.finT > 0.2 && P.finT < 0.4 && Math.random() < 0.5) FX.blood.emit(e.pos.x, e.pos.y + e.height * 0.55, e.pos.z, 3, { speed: 2, dy: 1, size: 0.08 });
      if (P.finT > 0.35 && !e.didHit) {
        e.didHit = true;
        doHitstop(0.12); shake(0.6); S.hit(1); S.boom();
        P.hp = Math.min(P.maxHp, P.hp + 6);
        P.bladeBlood = Math.min(1, P.bladeBlood + 0.3);
        combo++; comboT = 2.2; stats.maxCombo = Math.max(stats.maxCombo, combo);
        killEnemy(e, true);
      }
      if (P.finT > 0.65) { P.state = 'idle'; P.stateT = 0; P.finTarget = null; blades.R.flying = blades.L.flying = false; }
    } else {
      if (P.finT > 0.6 && !e.didHit) { e.didHit = true; S.hit(1); S.flesh(); shake(0.4); doHitstop(0.1); }
      if (P.finT > 0.6 && P.finT < 1.6) FX.blood.emit(e.pos.x, e.pos.y + 4.9, e.pos.z, 3, { speed: 3, dy: 1, size: 0.18, stain: 0.3 });
      if (P.finT > 1.7 && e.alive) {
        e.alive = false;
        const c = e.pos;
        FX.blood.emit(c.x, c.y + 4.8, c.z, 220, { speed: 12, dy: 4, size: 0.2, stain: 0.3, spread: 0.6 });
        for (let i = 0; i < 8; i++) FX.decals.add(c.x + rand(-4, 4), c.z + rand(-4, 4), rand(1, 2.4));
        FX.flames.emit(c.x, c.y + 3, c.z, 60, { color: 0xff5a10, color2: 0x8a1a08, speed: 6, life: 1.4, grav: -2, spread: 2, bright: 1.3 });
        flash(c.x, c.y + 6, c.z, 0xff7a30, 10, 1.2);
        shake(1); S.boom(); S.roar(0.5);
        stats.kills++;
        dropOrbs(c, 400, 0, 0);
        setState(e, 'dying');
        Q.stage = 3;
        W.temple.setSealed(false);
        W.beacons.temple.visible = false;
        game.victory = true; game.overT = 4;
        banner('Polyphemos is slain', 'Victory', 3.5);
        setTimeout(() => say('victory', true), 1500);
      }
      if (P.finT > 2.2) { P.state = 'idle'; P.stateT = 0; P.finTarget = null; blades.R.flying = blades.L.flying = false; }
    }
  }

  function animatePlayer(dt) {
    const h = spartan;
    A.resetPose(h);
    P.rig.rotation.set(0, 0, 0);
    P.rig.position.y = 0.97;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    switch (P.state) {
      case 'idle': case 'run': {
        const amt = clamp(hs / 7.2, 0, 1), run = clamp((hs - 7.5) / 4.5, 0, 1);
        P.walkPh += dt * (6 + hs * 0.85);
        A.poseWalk(h, P.walkPh, amt, run);
        if (amt < 0.1) { h.hips.position.y = h.baseHip + Math.sin(game.time * 2.2) * 0.012; h.torso.rotation.x = 0.06; }
        for (const a of h.arms) { a.sh.rotation.z = a.s * 0.22; if (run < 0.2) a.el.rotation.x = -0.5; }
        if (!P.onGround) for (const l of h.legs) { l.hp.rotation.x = -0.7; l.kn.rotation.x = 1.2; }
        break;
      }
      case 'attack': {
        const Ad = P.attack;
        let ang = 0, any = false;
        for (const side of ['R', 'L']) {
          const f = Ad[side]; if (!f) continue;
          const [x, y, z] = f(Math.min(1, P.atkT));
          const a = Math.atan2(x, z);
          if (!any) { ang = a; any = true; }
          const arm = h.arms[side === 'R' ? 0 : 1];
          const elev = Math.atan2(y - 1.6, Math.hypot(x, z));
          arm.sh.rotation.y = clamp(a, -2.4, 2.4);
          arm.sh.rotation.x = clamp(-(Math.PI / 2 + elev), -3.1, 0.3);
          arm.sh.rotation.z = 0;
          arm.el.rotation.x = -0.1;
        }
        h.torso.rotation.y = clamp(ang * 0.45, -0.9, 0.9);
        for (const a of h.arms) if (a.sh.rotation.y !== 0) a.sh.rotation.y -= h.torso.rotation.y;
        h.legs[0].hp.rotation.x = -0.35; h.legs[1].hp.rotation.x = 0.3; h.legs[1].kn.rotation.x = 0.4;
        h.hips.position.y = h.baseHip - 0.06;
        if (Ad.air) { for (const l of h.legs) { l.hp.rotation.x = -0.5; l.kn.rotation.x = 0.9; } h.torso.rotation.x = 0.5; }
        if (Ad === ATTACKS.l4) h.torso.rotation.x = P.atkT < 0.25 ? -0.3 : 0.45;
        break;
      }
      case 'dodge': {
        const k = clamp(P.stateT / 0.45, 0, 1);
        P.rig.rotation.x = smooth(k) * TAU;
        P.rig.position.y = 0.97 - Math.sin(k * Math.PI) * 0.45;
        for (const l of h.legs) { l.hp.rotation.x = -1.4; l.kn.rotation.x = 2.0; }
        for (const a of h.arms) { a.sh.rotation.x = -1.2; a.el.rotation.x = -1.2; }
        break;
      }
      case 'hurt':
        h.torso.rotation.x = -0.35; h.neck.rotation.x = -0.3;
        for (const a of h.arms) { a.sh.rotation.x = 0.4; a.sh.rotation.z = a.s * 0.6; }
        break;
      case 'magic': {
        const k = clamp(P.stateT / 0.35, 0, 1);
        for (const a of h.arms) { a.sh.rotation.x = -lerp(0.5, 3.0, k); a.sh.rotation.z = a.s * 0.4; }
        if (P.stateT > 0.35) for (const a of h.arms) { a.sh.rotation.x = -0.6; a.sh.rotation.z = a.s * 1.3; }
        h.legs[0].hp.rotation.x = -0.4; h.legs[1].hp.rotation.x = 0.4;
        h.hips.position.y = h.baseHip - (P.stateT > 0.35 ? 0.15 : 0);
        break;
      }
      case 'finisher':
        for (const a of h.arms) { a.sh.rotation.x = -1.7; a.sh.rotation.z = 0; }
        if (P.finT > 0.3) { for (const a of h.arms) { a.sh.rotation.x = -1.1; a.sh.rotation.z = a.s * 1.0; } h.torso.rotation.x = -0.25; }
        h.legs[0].hp.rotation.x = -0.6; h.legs[1].hp.rotation.x = 0.5; h.legs[1].kn.rotation.x = 0.6;
        break;
      case 'dead': {
        const k = clamp(P.stateT / 0.6, 0, 1);
        P.rig.rotation.x = -smooth(k) * Math.PI / 2;
        P.rig.position.y = lerp(0.97, 0.22, smooth(k));
        for (const a of h.arms) a.sh.rotation.z = a.s * 1.2;
        break;
      }
      default: break;
    }
    if (P.state !== 'dodge' && P.state !== 'dead' && !P.onGround && P.jumps === 2 && P.vel.y > -4) {
      P.rig.rotation.x = clamp((9 - P.vel.y) / 13, 0, 1) * TAU;
    }
    pLight.intensity = P.rageT > 0 ? 2.6 + Math.sin(game.time * 20) * 0.6 : 0;
  }

  // blades, chains and trails
  const handPos = V3(), downDir = V3(), bladeTarget = V3();
  function updateBlades() {
    P.root.updateMatrixWorld(true);
    const rage = P.rageT > 0;
    for (const side of ['R', 'L']) {
      const b = blades[side];
      const hand = spartan.arms[b.handIdx].hand;
      hand.getWorldPosition(handPos);
      let flying = false;
      if (P.state === 'attack' && P.attack && P.attack[side]) {
        const [x, y, z] = P.attack[side](Math.min(1, P.atkT));
        toWorld(x, y, z, bladeTarget);
        bladeTarget.y = Math.max(bladeTarget.y, ground(bladeTarget.x, bladeTarget.z) + 0.15);
        flying = true;
      } else if (P.state === 'finisher' && P.finTarget) {
        const e = P.finTarget;
        const k = clamp(P.finT / 0.3, 0, 1);
        const off = side === 'R' ? -0.3 : 0.3;
        const ty = e.def.boss ? e.pos.y + 4.9 : e.pos.y + e.height * 0.55;
        tmpA.set(e.pos.x + Math.cos(P.facing) * off, ty, e.pos.z - Math.sin(P.facing) * off);
        bladeTarget.lerpVectors(handPos, tmpA, smooth(k));
        if (!e.def.boss && P.finT > 0.4) {
          const r = (P.finT - 0.4) * 10;
          bladeTarget.x += Math.cos(P.facing) * off * r * 2; bladeTarget.z -= Math.sin(P.facing) * off * r * 2;
        }
        if (e.def.boss && P.finT > 1.65) bladeTarget.lerp(handPos, clamp((P.finT - 1.65) / 0.3, 0, 1));
        flying = true;
      } else if (P.state === 'magic') {
        const a = P.stateT * 18 + (side === 'R' ? 0 : Math.PI), r = Math.min(1, P.stateT * 4) * 3;
        toWorld(Math.sin(a) * r, 1.3, Math.cos(a) * r, bladeTarget);
        flying = true;
      }
      if (flying) {
        b.g.position.copy(bladeTarget);
        tmpB.subVectors(bladeTarget, handPos); tmpB.y *= 0.3;
        if (tmpB.lengthSq() < 0.01) tmpB.set(Math.sin(P.facing), 0, Math.cos(P.facing));
        tmpB.normalize();
        b.g.lookAt(tmpC.copy(bladeTarget).add(tmpB));
        b.g.scale.setScalar(rage ? 1.3 : 1.1);
      } else {
        downDir.set(0, -1, 0).transformDirection(hand.matrixWorld);
        b.g.position.copy(handPos).addScaledVector(downDir, 0.04);
        b.g.lookAt(tmpC.copy(handPos).add(downDir));
        b.g.scale.setScalar(rage ? 1.15 : 1);
      }
      b.flying = flying;
      b.mat.emissiveIntensity = rage ? 1.6 + Math.sin(game.time * 25) * 0.3 : 0.35;
      b.mat.color.copy(steel).lerp(bloodSteel, P.bladeBlood * 0.85);
      b.edgeMat.color.setRGB(rage ? 6 : 3.5, rage ? 1.6 : 1.2, rage ? 0.3 : 0.3);
      // chain
      const bp = b.g.position;
      const dist = handPos.distanceTo(bp);
      const sag = Math.min(0.9, dist * 0.06);
      for (let i = 0; i < b.NCH; i++) {
        const t = i / (b.NCH - 1);
        b.cpos[i * 3] = lerp(handPos.x, bp.x, t);
        b.cpos[i * 3 + 1] = lerp(handPos.y, bp.y, t) - Math.sin(Math.PI * t) * sag;
        b.cpos[i * 3 + 2] = lerp(handPos.z, bp.z, t);
      }
      b.chain.geometry.attributes.position.needsUpdate = true;
      b.chain.visible = dist > 0.3;
      // fire trail
      tmpB.subVectors(bp, handPos); tmpB.y = 0;
      if (tmpB.lengthSq() < 1e-4) tmpB.set(Math.sin(P.facing), 0, Math.cos(P.facing));
      tmpB.normalize();
      const inner = bp.clone().addScaledVector(tmpB, -0.2);
      const outer = flying ? bp.clone().addScaledVector(tmpB, rage ? 1.3 : 1.0) : inner.clone();
      b.hist.unshift([inner, outer]);
      if (b.hist.length > b.NT) b.hist.length = b.NT;
      const intensity = rage ? 1.6 : 1.0;
      for (let i = 0; i < b.NT; i++) {
        const hp = b.hist[Math.min(i, b.hist.length - 1)];
        const f = Math.pow(1 - i / (b.NT - 1), 2) * intensity;
        b.tpos.set([hp[0].x, hp[0].y, hp[0].z, hp[1].x, hp[1].y, hp[1].z], i * 6);
        b.tcol.set([0.9 * f, 0.22 * f, 0.03 * f, 1.6 * f, 0.8 * f, 0.2 * f], i * 6);
      }
      b.trail.geometry.attributes.position.needsUpdate = true;
      b.trail.geometry.attributes.color.needsUpdate = true;
      if (flying && Math.random() < 0.6) FX.flames.emit(bp.x, bp.y, bp.z, 1, { color: 0xff6a1a, speed: 0.6, life: 0.3, grav: -2, bright: 1.3 });
      if (!flying && P.bladeBlood > 0.4 && Math.random() < P.bladeBlood * 0.08) FX.blood.emit(bp.x, bp.y - 0.4, bp.z, 1, { speed: 0.2, size: 0.05, stain: 0.5 });
      if (P.state === 'attack' && P.attack && P.attack[side]) {
        const Ad = P.attack;
        if (P.atkT >= Ad.hit[0] && P.atkT <= Ad.hit[1]) bladeHits(handPos, bp, Ad);
      }
    }
  }
  function bladeHits(a, b, Ad) {
    for (const e of enemies.slice()) {
      if (!e.alive || e.state === 'spawn' || e.state === 'finished' || e.state === 'executed') continue;
      const last = P.hitMap.get(e);
      if (last !== undefined && (!Ad.rehit || game.clock - last < Ad.rehit)) continue;
      const [d, t] = segDist2D(e.pos.x, e.pos.z, a.x, a.z, b.x, b.z);
      const py = lerp(a.y, b.y, t);
      const cy = e.pos.y + e.height * 0.5;
      if (d < e.radius + 0.5 && Math.abs(py - cy) < e.height * 0.5 + 1.0) {
        P.hitMap.set(e, game.clock);
        let dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        damageEnemy(e, Ad.dmg, dx, dz, Ad.knock, Ad.stag, lerp(a.x, b.x, t), py, lerp(a.z, b.z, t), Ad === ATTACKS.l4);
      }
    }
  }

  // ===================================================================
  // Atreus update
  // ===================================================================
  function pickTarget(range = 34) {
    let best = null, bs = Infinity;
    for (const e of enemies) {
      if (!e.alive || !e.aggro || e.state === 'spawn' || e.state === 'dying') continue;
      const d = Math.hypot(e.pos.x - AT.pos.x, e.pos.z - AT.pos.z);
      if (d > range) continue;
      const toP = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      const score = toP * 0.6 + d * 0.4 - (e.type === 'harpy' ? 8 : 0) - (e.def.boss ? 4 : 0);
      if (score < bs) { bs = score; best = e; }
    }
    return best;
  }
  function updateAtreus(dt) {
    AT.stateT += dt;
    AT.shootCd -= dt; AT.volleyCd = Math.max(0, AT.volleyCd - dt); AT.lineCd -= dt;
    if (!AT.target || !AT.target.alive || AT.target.state === 'dying' || Math.hypot(AT.target.pos.x - AT.pos.x, AT.target.pos.z - AT.pos.z) > 38) AT.target = pickTarget();
    const tg = AT.target;
    const dP = Math.hypot(P.pos.x - AT.pos.x, P.pos.z - AT.pos.z);
    if (dP > 48 && P.state !== 'dead') {
      const bx = P.pos.x - Math.sin(P.facing) * 3, bz = P.pos.z - Math.cos(P.facing) * 3;
      if (!W.isWater(bx, bz)) { AT.pos.set(bx, ground(bx, bz), bz); AT.vel.set(0, 0, 0); }
    }
    // where to stand: beside and behind the Spartan, or away from the enemy in a fight
    let dx, dz;
    const lx = Math.cos(P.facing), lz = -Math.sin(P.facing);
    if (tg) {
      let ax = P.pos.x - tg.pos.x, az = P.pos.z - tg.pos.z;
      const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
      dx = P.pos.x + ax * 4.5 + az * 2.5; dz = P.pos.z + az * 4.5 - ax * 2.5;
    } else {
      dx = P.pos.x + lx * 1.8 - Math.sin(P.facing) * 2.4; dz = P.pos.z + lz * 1.8 - Math.cos(P.facing) * 2.4;
    }
    // hop away from anything too close
    let threat = null;
    for (const e of enemies) if (e.alive && e.type !== 'harpy' && e.state !== 'spawn' && e.state !== 'dying' && Math.hypot(e.pos.x - AT.pos.x, e.pos.z - AT.pos.z) < 2.4) { threat = e; break; }
    if (threat && AT.dodgeT <= 0) {
      let ax = AT.pos.x - threat.pos.x, az = AT.pos.z - threat.pos.z;
      const L = Math.hypot(ax, az) || 1;
      AT.vel.set(ax / L * 11, 0, az / L * 11);
      AT.dodgeT = 0.35; AT.state = 'dodge'; AT.stateT = 0; AT.drawT = 0;
    }
    if (AT.dodgeT > 0) {
      AT.dodgeT -= dt;
      if (AT.dodgeT <= 0) AT.state = 'follow';
    } else {
      const tx = dx - AT.pos.x, tz = dz - AT.pos.z, td = Math.hypot(tx, tz);
      let spd = td > 9 ? (P.sprint ? 12.5 : 10.5) : td > 1.5 ? Math.min(7.5, td * 2) : 0;
      if (AT.drawT > 0) spd = Math.min(spd, 2);
      const k = damp(8, dt);
      AT.vel.x = lerp(AT.vel.x, td > 0.01 ? tx / td * spd : 0, k);
      AT.vel.z = lerp(AT.vel.z, td > 0.01 ? tz / td * spd : 0, k);
    }
    moveOnGround(AT.pos, AT.vel.x * dt, AT.vel.z * dt, 0.35, true);
    AT.pos.y = ground(AT.pos.x, AT.pos.z);
    if (Q.stage === 2) {
      const ex = AT.pos.x - W.temple.x, ez = AT.pos.z - W.temple.z, ed = Math.hypot(ex, ez), lim = W.temple.R - 1;
      if (ed > lim) { AT.pos.x = W.temple.x + ex / ed * lim; AT.pos.z = W.temple.z + ez / ed * lim; AT.pos.y = ground(AT.pos.x, AT.pos.z); }
    }
    const hs = Math.hypot(AT.vel.x, AT.vel.z);
    // facing
    if ((AT.drawT > 0 || AT.volleyQ > 0) && tg) AT.facing = angleLerp(AT.facing, Math.atan2(tg.pos.x - AT.pos.x, tg.pos.z - AT.pos.z), damp(12, dt));
    else if (hs > 0.5) AT.facing = angleLerp(AT.facing, Math.atan2(AT.vel.x, AT.vel.z), damp(10, dt));
    AT.root.rotation.y = AT.facing;
    // shooting
    const interval = Math.max(0.85, 1.5 - upgrades.bow * 0.15);
    if (tg && AT.shootCd <= 0 && AT.drawT <= 0 && AT.dodgeT <= 0 && P.state !== 'dead') AT.drawT = 0.45;
    if (AT.drawT > 0) {
      AT.drawT -= dt;
      if (AT.drawT <= 0) { if (tg && tg.alive) fireArrow(false); AT.shootCd = interval * rand(0.85, 1.15); }
    }
    if (AT.volleyQ > 0) {
      AT.volleyT -= dt;
      if (AT.volleyT <= 0) { fireArrow(true); AT.volleyQ--; AT.volleyT = 0.22; }
    }
    // idle chatter
    if (!tg && !enemies.some((e) => e.aggro && e.alive)) { AT.idleT -= dt; if (AT.idleT <= 0) { say('idle'); AT.idleT = rand(50, 90); } }
    animateAtreus(dt, hs, tg);
  }
  const bowLocal = V3();
  function animateAtreus(dt, hs, tg) {
    const h = AT.h;
    A.resetPose(h);
    AT.rig.rotation.set(0, 0, 0);
    AT.rig.position.y = 0.97 * 0.78;
    const amt = clamp(hs / 6, 0, 1), run = clamp((hs - 6) / 5, 0, 1);
    AT.walkPh += dt * (6 + hs * 1.1);
    A.poseWalk(h, AT.walkPh, amt, run);
    const aiming = AT.drawT > 0 || AT.volleyQ > 0;
    if (AT.state === 'dodge') {
      const k = clamp(AT.stateT / 0.35, 0, 1);
      AT.rig.rotation.x = -smooth(k) * TAU;
      for (const l of h.legs) { l.hp.rotation.x = -1.3; l.kn.rotation.x = 1.9; }
    } else if (aiming && tg) {
      const dy = tg.pos.y + tg.height * 0.55 - (AT.pos.y + 1.2), dh = Math.hypot(tg.pos.x - AT.pos.x, tg.pos.z - AT.pos.z);
      const elev = Math.atan2(dy, dh);
      h.torso.rotation.y = 0.9;
      const bow = h.arms[1], draw = h.arms[0];
      bow.sh.rotation.y = -0.9 + 0.0; bow.sh.rotation.x = -(Math.PI / 2 + elev); bow.sh.rotation.z = 0; bow.el.rotation.x = 0;
      const pull = AT.volleyQ > 0 ? 1 : clamp(1 - AT.drawT / 0.45, 0, 1);
      draw.sh.rotation.y = -0.9 + 0.35; draw.sh.rotation.x = -(Math.PI / 2 + elev) + 0.15; draw.sh.rotation.z = 0;
      draw.el.rotation.x = -lerp(0.6, 2.4, pull);
      h.legs[0].hp.rotation.x = -0.25; h.legs[1].hp.rotation.x = 0.25;
    } else {
      h.arms[1].el.rotation.x = -0.4;
    }
    // bowstring: tips to tips, or pulled to the right hand while drawing
    AT.root.updateMatrixWorld(true);
    const s = h.bow.spos;
    s[0] = 0; s[1] = 0.11; s[2] = 0.5; s[6] = 0; s[7] = 0.11; s[8] = -0.5;
    if (aiming) {
      h.arms[0].hand.getWorldPosition(bowLocal);
      h.arms[1].hand.worldToLocal(bowLocal);
      s[3] = bowLocal.x; s[4] = bowLocal.y; s[5] = bowLocal.z;
    } else { s[3] = 0; s[4] = 0.11; s[5] = 0; }
    h.bow.string.geometry.attributes.position.needsUpdate = true;
  }

  // ===================================================================
  // Enemy update
  // ===================================================================
  const toP = V3();
  const faceTo = (e, rate, dt) => { e.facing = angleLerp(e.facing, Math.atan2(toP.x, toP.z), damp(rate, dt)); };
  const facingDot = (e) => Math.sin(e.facing) * toP.x + Math.cos(e.facing) * toP.z;
  function stepToward(e, dx, dz, speed, dt) {
    const ox = e.pos.x, oz = e.pos.z;
    e.pos.x += dx * speed * dt; e.pos.z += dz * speed * dt;
    if (W.isWater(e.pos.x, e.pos.z)) { e.pos.x = ox; e.pos.z = oz; }
  }
  function updateEnemies(dt) {
    const camQ = camera.quaternion;
    for (const e of enemies.slice()) {
      toP.set(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z);
      const dist = toP.length();
      if (dist > 1e-4) toP.divideScalar(dist);
      e.root.visible = dist < 175;
      if (!e.aggro && dist > 130 && e.state === 'idle') continue;
      e.stateT += dt * e.tempo;
      e.shadowT -= dt;
      if (e.shadowT <= 0) { e.shadowT = 1; const cs = dist < 50; for (const m of e.meshes) m.castShadow = cs; }

      e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
      e.vel.multiplyScalar(Math.exp(-6 * dt));

      // notice the Spartan
      if (e.alive && !e.aggro && e.state === 'idle' && P.state !== 'dead' && dist < e.def.aggro && game.state === 'playing') alertEnemy(e);
      // give up the chase if led too far from home
      if (e.alive && e.aggro && !e.def.boss && e.state !== 'dying' && e.state !== 'finished') {
        const fromHome = Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z);
        if ((fromHome > 70 && dist > 20) || dist > 60 || P.state === 'dead') { e.aggro = false; setState(e, 'return'); }
      }

      if (e.state === 'spawn') {
        const k = clamp(e.stateT / 0.9, 0, 1);
        const gy = ground(e.pos.x, e.pos.z);
        if (e.type === 'harpy') e.pos.y = gy + lerp(14, e.alt, smooth(k));
        else e.pos.y = lerp(gy - e.height, gy, smooth(k));
        if (Math.random() < 0.5 && e.type !== 'harpy') FX.flames.emit(e.pos.x, gy + 0.2, e.pos.z, 2, { color: 0x6aff5a, color2: 0x1a8a3a, speed: 2, up: 2, life: 0.6, grav: -2, spread: e.radius, bright: 1.3 });
        e.facing = Math.atan2(toP.x, toP.z);
        if (k >= 1) setState(e, e.def.boss ? 'intro' : (e.aggro ? (e.type === 'harpy' ? 'circle' : 'chase') : 'idle'));
        e.root.rotation.y = e.facing;
        continue;
      } else if (e.state === 'dying') {
        e.deadT += dt;
        const k = clamp(e.deadT / 0.4, 0, 1);
        e.rig.rotation.x = -smooth(k) * Math.PI / 2;
        if (e.type === 'harpy') { e.alt = Math.max(0, e.alt - dt * 8); }
        if (!e.pooled && e.deadT > 0.45) {
          e.pooled = true;
          const back = e.def.boss ? 4 : e.height * 0.4;
          FX.decals.add(e.pos.x - Math.sin(e.facing) * back, e.pos.z - Math.cos(e.facing) * back, e.def.boss ? 5 : rand(1.1, 1.8));
        }
        if (e.deadT > 1.4) e.yOff -= dt * (e.def.boss ? 2 : 1.2);
        if (e.deadT > (e.def.boss ? 6 : 3)) { removeEnemy(e); continue; }
      } else if (e.state === 'finished') {
        e.rig.position.x = Math.sin(game.time * 60) * 0.03;
      } else if (e.state === 'return') {
        const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z, hd = Math.hypot(hx, hz);
        if (hd > 1.5) { stepToward(e, hx / hd, hz / hd, e.def.speed * 0.9, dt); e.facing = angleLerp(e.facing, Math.atan2(hx, hz), damp(6, dt)); }
        else { e.hp = e.maxHp; e.finishable = false; setState(e, 'idle'); if (e.skinMat.userData.baseColor) e.skinMat.color.copy(e.skinMat.userData.baseColor); }
        idleAnim(e, dt, hd > 1.5);
        if (e.type === 'harpy') e.alt = lerp(e.alt, 7, damp(2, dt));
      } else if (e.state === 'idle') {
        updateIdle(e, dt);
      } else {
        switch (e.type) {
          case 'legion': updateLegion(e, dt, dist); break;
          case 'harpy': updateHarpy(e, dt, dist); break;
          case 'hound': updateHound(e, dt, dist); break;
          case 'minotaur': updateMinotaur(e, dt, dist); break;
          case 'cyclops': updateCyclops(e, dt, dist); break;
          default: break;
        }
      }

      if (e.alive && e.type !== 'harpy') {
        for (const o of enemies) {
          if (o === e || !o.alive || o.type === 'harpy' || o.state === 'spawn') continue;
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = e.radius + o.radius;
          if (d < m && d > 1e-4) { const push = (m - d) * (o.def.boss ? 1 : 0.5); e.pos.x += (dx / d) * push; e.pos.z += (dz / d) * push; }
        }
        const m = e.radius + 0.45;
        if (dist < m && dist > 1e-4 && P.state !== 'dead') { e.pos.x -= toP.x * (m - dist) * 0.5; e.pos.z -= toP.z * (m - dist) * 0.5; }
      }
      if (e.state !== 'dying') {
        const hit = W.colliders.push(e.pos, e.radius);
        if (hit && e.state === 'charge' && e.stateT > 0.15) minotaurStun(e);
        if (e.def.boss) {
          const dx = e.pos.x - W.temple.x, dz = e.pos.z - W.temple.z, d = Math.hypot(dx, dz), lim = W.temple.R - e.radius;
          if (d > lim) { e.pos.x = W.temple.x + dx / d * lim; e.pos.z = W.temple.z + dz / d * lim; }
        }
      }
      const gy = ground(e.pos.x, e.pos.z);
      e.pos.y = gy + (e.type === 'harpy' ? e.alt : 0) + e.yOff;
      e.root.rotation.y = e.facing;

      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 6);
        for (const m of e.flashMats) {
          const be = m.userData.baseEmissive;
          m.emissive.setRGB(be.r + e.flash * 0.9, be.g + e.flash * 0.35, be.b + e.flash * 0.2);
        }
      }
      if (e.bar) {
        const show = e.alive && e.hp < e.maxHp && e.state !== 'spawn' && dist < 45;
        e.bar.g.visible = show;
        if (show) {
          e.bar.g.position.set(e.pos.x, e.pos.y + e.height + 0.4, e.pos.z);
          e.bar.g.quaternion.copy(camQ);
          const f = Math.max(0, e.hp / e.maxHp);
          e.bar.fg.scale.x = Math.max(0.001, f);
          e.bar.fg.position.x = -(1 - f) * 0.52;
        }
        e.marker.visible = e.alive && e.finishable && e.state !== 'finished';
        if (e.marker.visible) {
          e.marker.position.set(e.pos.x, e.pos.y + e.height + 0.85, e.pos.z);
          e.marker.quaternion.copy(camQ);
          e.marker.scale.setScalar(1 + Math.sin(game.time * 8) * 0.15);
        }
      }
    }
  }
  function idleAnim(e, dt, moving) {
    const h = e.h;
    if (e.type === 'harpy') { harpyPose(e, 10); return; }
    if (e.type === 'hound') { houndPose(e, dt, moving ? 0.5 : 0); return; }
    A.resetPose(h);
    if (moving) { e.walkPh += dt * 6; A.poseWalk(h, e.walkPh, 0.7); }
    else { h.hips.position.y = h.baseHip + Math.sin(game.time * 1.6 + e.walkPh) * 0.012; h.torso.rotation.x = 0.12; h.neck.rotation.x = 0.2; }
    if (e.type === 'legion') { h.arms[1].sh.rotation.x = -0.5; h.arms[1].el.rotation.x = -0.6; }
    if (e.type === 'cyclops') h.iris.scale.setScalar(1);
  }
  function updateIdle(e, dt) {
    e.wanderT -= dt;
    if (e.type === 'harpy') {
      e.orbitA += dt * 0.35 * e.orbitDir;
      const tx = e.home.x + Math.sin(e.orbitA) * 8, tz = e.home.z + Math.cos(e.orbitA) * 8;
      const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { stepToward(e, dx / d, dz / d, Math.min(3, d), dt); e.facing = angleLerp(e.facing, Math.atan2(dx, dz), damp(3, dt)); }
      e.alt = lerp(e.alt, 7 + Math.sin(game.time + e.walkPh) * 0.6, damp(2, dt));
      harpyPose(e, 9);
      e.rig.rotation.x = 0.15;
      return;
    }
    if (e.wanderT <= 0) {
      e.wanderT = rand(3, 8);
      const a = rand(0, TAU), r = rand(0, 7);
      e.wx = e.home.x + Math.sin(a) * r; e.wz = e.home.z + Math.cos(a) * r;
    }
    const dx = e.wx - e.pos.x, dz = e.wz - e.pos.z, d = Math.hypot(dx, dz);
    const moving = d > 0.8;
    if (moving) { stepToward(e, dx / d, dz / d, e.def.speed * 0.35, dt); e.facing = angleLerp(e.facing, Math.atan2(dx, dz), damp(4, dt)); }
    idleAnim(e, dt, moving);
  }

  function legionPose(e, dt, moving) {
    const h = e.h;
    A.resetPose(h);
    if (moving) { e.walkPh += dt * 9; A.poseWalk(h, e.walkPh, 1); }
    h.arms[1].sh.rotation.x = -1.0; h.arms[1].el.rotation.x = -0.6; h.arms[1].sh.rotation.y = -0.5;
    h.arms[0].sh.rotation.x = moving ? h.arms[0].sh.rotation.x - 0.4 : -0.5;
  }
  function updateLegion(e, dt, dist) {
    const h = e.h;
    switch (e.state) {
      case 'chase': {
        faceTo(e, 8, dt);
        const moving = dist > 1.9 && P.state !== 'dead';
        if (moving) stepToward(e, toP.x, toP.z, e.def.speed * e.speedMul, dt);
        legionPose(e, dt, moving);
        e.cd -= dt;
        if (dist < 2.5 && e.cd <= 0 && P.state !== 'dead') setState(e, 'windup');
        break;
      }
      case 'windup': {
        faceTo(e, 6, dt);
        legionPose(e, dt, false);
        const k = clamp(e.stateT / 0.6, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-0.5, -2.9, smooth(k));
        h.torso.rotation.y = 0.4 * k;
        if (e.stateT > 0.6) { setState(e, 'strike'); S.swoosh(0.7); e.vel.x += Math.sin(e.facing) * 5; e.vel.z += Math.cos(e.facing) * 5; }
        break;
      }
      case 'strike': {
        legionPose(e, dt, false);
        const k = clamp(e.stateT / 0.12, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-2.9, -0.5, k);
        h.torso.rotation.y = lerp(0.4, -0.4, k); h.torso.rotation.x = 0.25 * k;
        if (!e.didHit && e.stateT > 0.08) { e.didHit = true; if (dist < 2.7 && facingDot(e) > 0.35) hurtPlayer(e.def.dmg, e.pos, 6); }
        if (e.stateT > 0.3) setState(e, 'recover');
        break;
      }
      case 'recover':
        legionPose(e, dt, false);
        h.arms[0].sh.rotation.x = -0.6; h.torso.rotation.x = 0.2;
        if (e.stateT > 0.6) { setState(e, 'chase'); e.cd = rand(0.6, 1.6); }
        break;
      case 'stagger':
        legionPose(e, dt, false);
        h.torso.rotation.x = -0.45; h.neck.rotation.x = -0.4; h.arms[0].sh.rotation.z = -0.7; h.arms[1].sh.rotation.x = 0.2;
        if (e.stateT > e.stagT) { setState(e, 'chase'); e.cd = rand(0.3, 0.9); }
        break;
      default: setState(e, 'chase');
    }
  }

  function harpyPose(e, rate) {
    const f = Math.sin(game.time * rate + e.walkPh);
    for (const w of e.h.wings) { w.w.rotation.z = -w.s * f * 0.7; w.tip.rotation.z = -w.s * f * 0.45; }
  }
  function updateHarpy(e, dt, dist) {
    const chestY = P.pos.y + 1.2;
    const gy = ground(e.pos.x, e.pos.z);
    switch (e.state) {
      case 'circle': {
        e.orbitA += dt * e.orbitDir * 0.8;
        const tx = P.pos.x + Math.sin(e.orbitA) * 7, tz = P.pos.z + Math.cos(e.orbitA) * 7;
        const dx = tx - e.pos.x, dz = tz - e.pos.z, L = Math.hypot(dx, dz);
        if (L > 0.2) stepToward(e, dx / L, dz / L, Math.min(e.def.speed, L * 2), dt);
        e.alt = lerp(e.alt, 2.6 + (P.pos.y - gy) + Math.sin(game.time * 2 + e.walkPh) * 0.3, damp(3, dt));
        faceTo(e, 6, dt);
        harpyPose(e, 14);
        e.rig.rotation.x = 0.2;
        e.cd -= dt;
        if (e.cd <= 0 && P.state !== 'dead') { setState(e, 'screech'); S.screech(); }
        break;
      }
      case 'screech':
        faceTo(e, 10, dt);
        harpyPose(e, 24);
        e.rig.rotation.x = -0.4;
        e.rig.position.x = Math.sin(game.time * 50) * 0.05;
        if (e.stateT > 0.55) {
          e.rig.position.x = 0;
          e.diveDir = V3(P.pos.x - e.pos.x, chestY - 0.2 - e.pos.y, P.pos.z - e.pos.z).normalize();
          setState(e, 'dive');
        }
        break;
      case 'dive': {
        stepToward(e, e.diveDir.x, e.diveDir.z, 16, dt);
        e.alt += e.diveDir.y * 16 * dt;
        harpyPose(e, 4);
        e.rig.rotation.x = 0.9;
        const ey = gy + e.alt;
        const d3 = Math.hypot(P.pos.x - e.pos.x, chestY - (ey + 0.6), P.pos.z - e.pos.z);
        if (!e.didHit && d3 < 1.5) { e.didHit = true; hurtPlayer(e.def.dmg, e.pos, 7); }
        if (e.stateT > 0.75 || e.alt < 0.5) { e.alt = Math.max(0.5, e.alt); setState(e, 'climb'); }
        break;
      }
      case 'climb':
        e.alt = lerp(e.alt, 2.6 + (P.pos.y - gy), damp(3, dt));
        stepToward(e, -toP.x, -toP.z, 3, dt);
        harpyPose(e, 18);
        e.rig.rotation.x = -0.2;
        if (e.stateT > 0.9) { setState(e, 'circle'); e.cd = rand(1.8, 3.8); }
        break;
      case 'stagger':
        harpyPose(e, 6);
        e.rig.rotation.x = -0.6;
        e.alt = Math.max(1.2, e.alt - dt * 2);
        if (e.stateT > e.stagT) setState(e, 'climb');
        break;
      default: setState(e, 'circle');
    }
  }

  function houndPose(e, dt, gait, crouch = 0) {
    const h = e.h;
    e.walkPh += dt * (4 + gait * 14);
    const ph = e.walkPh;
    for (const l of h.legs) {
      const off = (l.f > 0 ? 0 : Math.PI) + (l.s > 0 ? 0.6 : 0);
      l.hp.rotation.x = Math.sin(ph + off) * 0.75 * gait - crouch * 0.4 * l.f;
      l.kn.rotation.x = (l.f > 0 ? -1 : 1) * (0.25 + Math.max(0, Math.sin(ph + off + 1.2)) * 0.7 * gait + crouch * 0.6);
    }
    h.torso.rotation.x = Math.sin(ph * 2) * 0.05 * gait;
    h.torso.position.y = 0.82 + Math.abs(Math.sin(ph)) * 0.08 * gait - crouch * 0.22;
    h.neck.rotation.x = 0.1 + crouch * 0.3;
    h.tail.rotation.x = -0.9 + Math.sin(ph * 1.5) * 0.3;
    h.jaw.rotation.x = 0.1 + (crouch > 0 ? 0.4 : Math.max(0, Math.sin(game.time * 3 + e.walkPh)) * 0.15);
  }
  function updateHound(e, dt, dist) {
    switch (e.state) {
      case 'chase': {
        faceTo(e, 9, dt);
        const moving = dist > 2.2 && P.state !== 'dead';
        // circle in slightly so the pack doesn't line up
        if (moving) stepToward(e, toP.x * 0.92 - toP.z * 0.38 * e.orbitDir, toP.z * 0.92 + toP.x * 0.38 * e.orbitDir, e.def.speed * e.speedMul * (dist < 8 ? 0.6 : 1), dt);
        houndPose(e, dt, moving ? 1 : 0.2);
        e.cd -= dt;
        if (dist < 5.5 && dist > 1.5 && e.cd <= 0 && P.state !== 'dead') { setState(e, 'crouch'); S.growl(); }
        break;
      }
      case 'crouch':
        faceTo(e, 10, dt);
        houndPose(e, dt, 0, clamp(e.stateT / 0.35, 0, 1));
        if (e.stateT > 0.4) { setState(e, 'pounce'); e.leapDir = V3(toP.x, 0, toP.z); }
        break;
      case 'pounce': {
        const k = clamp(e.stateT / 0.45, 0, 1);
        stepToward(e, e.leapDir.x, e.leapDir.z, 13 * (1 - k * 0.5), dt);
        e.yOff = Math.sin(k * Math.PI) * 1.1;
        houndPose(e, dt, 0.3);
        e.h.jaw.rotation.x = 0.6;
        if (!e.didHit && dist < 1.7) { e.didHit = true; hurtPlayer(e.def.dmg, e.pos, 6); FX.blood.emit(P.pos.x, P.pos.y + 1, P.pos.z, 8, { speed: 3, size: 0.08 }); }
        if (k >= 1) { e.yOff = 0; setState(e, 'recover'); }
        break;
      }
      case 'recover':
        houndPose(e, dt, 0.1);
        if (e.stateT > 0.6) { setState(e, 'chase'); e.cd = rand(0.8, 1.8); }
        break;
      case 'stagger':
        e.yOff = 0;
        houndPose(e, dt, 0, 0.5);
        e.h.torso.rotation.z = 0.3;
        if (e.stateT > e.stagT) { e.h.torso.rotation.z = 0; setState(e, 'chase'); }
        break;
      default: setState(e, 'chase');
    }
  }

  function minoPose(e, dt, moving, rate = 7) {
    const h = e.h;
    A.resetPose(h);
    if (moving) { e.walkPh += dt * rate; A.poseWalk(h, e.walkPh, 1); }
    h.torso.rotation.x += 0.2;
    h.arms[0].sh.rotation.x = moving ? -0.3 : -0.5;
  }
  function minotaurStun(e) {
    setState(e, 'stunned');
    shake(0.6); S.boom();
    FX.sparks.emit(e.pos.x, e.pos.y + 2.5, e.pos.z, 30, { color: 0xc0b090, speed: 7, life: 0.6 });
    banner('', 'Stunned', 0.8, true);
  }
  function updateMinotaur(e, dt, dist) {
    const h = e.h;
    e.chargeCd -= dt;
    switch (e.state) {
      case 'chase': {
        faceTo(e, 5, dt);
        const moving = dist > 2.7 && P.state !== 'dead';
        if (moving) stepToward(e, toP.x, toP.z, e.def.speed * e.speedMul, dt);
        minoPose(e, dt, moving);
        e.cd -= dt;
        if (P.state === 'dead') break;
        if (dist > 7.5 && dist < 26 && e.chargeCd <= 0) {
          setState(e, 'paw');
          e.facing = Math.atan2(toP.x, toP.z);
          e.chargeDir = V3(toP.x, 0, toP.z);
          telegraphLane(e.pos.x, e.pos.z, e.facing, 16, 2.4, 1.0);
          S.roar(1.3);
        } else if (dist < 3.6 && e.cd <= 0) setState(e, 'windup');
        break;
      }
      case 'paw':
        minoPose(e, dt, false);
        h.torso.rotation.x = 0.6; h.neck.rotation.x = 0.3;
        h.legs[1].hp.rotation.x = Math.sin(e.stateT * 18) * 0.5;
        if (Math.random() < 0.4) FX.flames.emit(e.pos.x, e.pos.y + 0.2, e.pos.z, 1, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
        if (e.stateT > 1.0) setState(e, 'charge');
        break;
      case 'charge':
        stepToward(e, e.chargeDir.x, e.chargeDir.z, 16, dt);
        minoPose(e, dt, true, 18);
        h.torso.rotation.x = 0.7; h.neck.rotation.x = 0.4;
        if (Math.random() < 0.6) FX.flames.emit(e.pos.x, e.pos.y + 0.2, e.pos.z, 1, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
        if (!e.didHit && dist < e.radius + 1.0 && P.pos.y - e.pos.y < 2.2) { e.didHit = true; hurtPlayer(22, e.pos, 15); }
        if (e.stateT > 1.4) setState(e, 'recover');
        break;
      case 'windup': {
        faceTo(e, 4, dt);
        minoPose(e, dt, false);
        const k = clamp(e.stateT / 0.85, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-0.5, -3.0, smooth(k));
        h.torso.rotation.x = lerp(0.2, -0.3, k);
        if (e.stateT > 0.85) setState(e, 'strike');
        break;
      }
      case 'strike': {
        minoPose(e, dt, false);
        const k = clamp(e.stateT / 0.12, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-3.0, -0.9, k);
        h.torso.rotation.x = lerp(-0.3, 0.55, k);
        if (!e.didHit && e.stateT > 0.1) {
          e.didHit = true;
          const cx = e.pos.x + Math.sin(e.facing) * 2.6, cz = e.pos.z + Math.cos(e.facing) * 2.6, cy = ground(cx, cz);
          shockwave(cx, cz, 0.4, 2.8, 0.3, 0xffa060);
          FX.sparks.emit(cx, cy + 0.3, cz, 25, { color: 0xc0a080, color2: 0xff8a30, speed: 7, up: 3, life: 0.5 });
          shake(0.4); S.boom();
          if (Math.hypot(P.pos.x - cx, P.pos.z - cz) < 2.6 && P.pos.y - cy < 1.5) hurtPlayer(e.def.dmg, e.pos, 11);
        }
        if (e.stateT > 0.45) setState(e, 'recover');
        break;
      }
      case 'recover':
        minoPose(e, dt, false);
        h.torso.rotation.x = 0.4;
        if (e.stateT > 0.85) { setState(e, 'chase'); e.cd = rand(0.8, 1.8); e.chargeCd = rand(3, 6); }
        break;
      case 'stunned':
        minoPose(e, dt, false);
        h.torso.rotation.x = -0.2; h.neck.rotation.x = -0.4; h.neck.rotation.z = Math.sin(game.time * 4) * 0.3;
        if (Math.random() < 0.3) FX.sparks.emit(e.pos.x + rand(-0.6, 0.6), e.pos.y + e.height + 0.3, e.pos.z + rand(-0.6, 0.6), 1, { color: 0xfff0a0, speed: 0.5, life: 0.6, grav: 0, bright: 1.3 });
        if (e.stateT > 2.6) { setState(e, 'chase'); e.chargeCd = rand(4, 6); }
        break;
      case 'stagger':
        minoPose(e, dt, false);
        h.torso.rotation.x = -0.4;
        if (e.stateT > e.stagT) setState(e, 'chase');
        break;
      default: setState(e, 'chase');
    }
  }

  function cyPose(e, dt, moving) {
    const h = e.h;
    A.resetPose(h);
    if (moving) { e.walkPh += dt * 4.5; A.poseWalk(h, e.walkPh, 0.8); }
    h.arms[0].sh.rotation.x = moving ? h.arms[0].sh.rotation.x - 0.3 : -0.35;
    h.torso.rotation.x += 0.1;
    h.iris.scale.setScalar(1 + Math.sin(game.time * 5) * 0.1);
  }
  function updateCyclops(e, dt, dist) {
    const h = e.h, T = e.stateT;
    switch (e.state) {
      case 'intro':
        cyPose(e, dt, false);
        h.neck.rotation.x = -0.5; h.arms[0].sh.rotation.x = -2.2; h.arms[1].sh.rotation.x = -2.2;
        h.arms[1].sh.rotation.z = 0.6; h.arms[0].sh.rotation.z = -0.6;
        if (T < 1.5) shake(0.02);
        if (T > 2.2) { setState(e, 'chase'); e.cd = 1; }
        break;
      case 'chase': {
        faceTo(e, 2.2, dt);
        const moving = dist > 6 && P.state !== 'dead';
        if (moving) stepToward(e, toP.x, toP.z, e.def.speed * (e.phase2 ? 1.25 : 1), dt);
        cyPose(e, dt, moving);
        if (P.state === 'dead') break;
        if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; e.tempo = 1.25; setState(e, 'roar'); e.adds = 'legion'; break; }
        if (!e.phase3 && e.hp < e.maxHp * 0.25) { e.phase3 = true; setState(e, 'roar'); e.adds = 'hound'; break; }
        e.cd -= dt * e.tempo;
        if (e.cd <= 0) {
          const r = Math.random();
          let next;
          if (dist < 6.5) next = r < 0.5 ? 'sweep' : 'stomp';
          else if (dist < 12) next = r < 0.55 ? 'slam' : (r < 0.8 ? 'stomp' : 'rock');
          else next = r < 0.7 ? 'rock' : 'slam';
          setState(e, next);
          if (next === 'slam') {
            e.facing = Math.atan2(toP.x, toP.z);
            const reach = clamp(dist, 5, 7);
            e.slamAt = V3(e.pos.x + Math.sin(e.facing) * reach, 0, e.pos.z + Math.cos(e.facing) * reach);
            e.slamAt.y = ground(e.slamAt.x, e.slamAt.z);
            telegraph(e.slamAt.x, e.slamAt.z, 3.6, 1.1);
          }
        }
        break;
      }
      case 'slam': {
        cyPose(e, dt, false);
        if (T < 1.1) {
          const raise = smooth(clamp(T / 1.1, 0, 1));
          h.arms[0].sh.rotation.x = lerp(-0.35, -3.0, raise);
          h.torso.rotation.x = lerp(0.1, -0.3, raise);
        } else {
          const k = clamp((T - 1.1) / 0.12, 0, 1);
          h.arms[0].sh.rotation.x = lerp(-3.0, -0.95, k);
          h.torso.rotation.x = lerp(-0.3, 0.5, k);
          if (!e.didHit) {
            e.didHit = true;
            const p = e.slamAt;
            shockwave(p.x, p.z, 0.5, 5, 0.4, 0xffa060);
            FX.sparks.emit(p.x, p.y + 0.4, p.z, 50, { color: 0xc0a080, color2: 0xff8a30, speed: 10, up: 4, life: 0.7 });
            FX.flames.emit(p.x, p.y + 0.4, p.z, 14, { color: 0x6a5040, speed: 4, life: 1.0, grav: -1 });
            shake(0.75); S.boom();
            if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 3.6 && P.pos.y - p.y < 2) hurtPlayer(28, p, 14);
          }
        }
        if (T > 2.0) { setState(e, 'chase'); e.cd = rand(1.0, 2.0); }
        break;
      }
      case 'sweep':
        cyPose(e, dt, false);
        if (T < 0.9) {
          faceTo(e, 3, dt);
          const k = smooth(T / 0.9);
          h.torso.rotation.y = lerp(0, 1.1, k);
          h.arms[0].sh.rotation.x = lerp(-0.35, -1.3, k);
          h.arms[0].sh.rotation.y = 0.6 * k;
        } else {
          const k = clamp((T - 0.9) / 0.35, 0, 1);
          h.torso.rotation.y = lerp(1.1, -1.2, smooth(k));
          h.arms[0].sh.rotation.x = -1.3;
          h.arms[0].sh.rotation.y = lerp(0.6, -0.6, k);
          if (!e.didHit && T > 1.0) {
            e.didHit = true; S.swoosh(0.4);
            if (dist < 9.5 && facingDot(e) > -0.15 && P.pos.y - e.pos.y < 3) hurtPlayer(20, e.pos, 17);
          }
        }
        if (T > 2.0) { setState(e, 'chase'); e.cd = rand(0.8, 1.8); }
        break;
      case 'stomp':
        cyPose(e, dt, false);
        if (T < 0.9) {
          const k = smooth(T / 0.9);
          h.legs[1].hp.rotation.x = -1.1 * k; h.legs[1].kn.rotation.x = 0.9 * k;
          h.torso.rotation.x = -0.15 * k;
        } else {
          const k = clamp((T - 0.9) / 0.1, 0, 1);
          h.legs[1].hp.rotation.x = lerp(-1.1, 0, k); h.legs[1].kn.rotation.x = lerp(0.9, 0, k);
          if (!e.didHit) {
            e.didHit = true;
            const ox = e.pos.x, oz = e.pos.z;
            let hit = false;
            shockwave(ox, oz, 1.5, 22, 1.5, 0xff7a30, (r) => {
              if (hit) return;
              const d = Math.hypot(P.pos.x - ox, P.pos.z - oz);
              if (Math.abs(d - r) < 0.9 && P.onGround) hit = hurtPlayer(15, { x: ox, z: oz }, 9) || hit;
            });
            FX.flames.emit(ox, e.pos.y + 0.3, oz, 30, { color: 0x6a5040, speed: 7, life: 1.0, grav: -1, flat: true });
            shake(0.7); S.boom();
          }
        }
        if (T > 1.8) { setState(e, 'chase'); e.cd = rand(1.0, 2.0); }
        break;
      case 'rock':
        cyPose(e, dt, false);
        faceTo(e, 3, dt);
        if (T < 0.9) {
          const k = smooth(T / 0.9);
          h.arms[1].sh.rotation.x = lerp(-0.2, -2.8, k);
          h.torso.rotation.y = -0.5 * k;
        } else {
          const k = clamp((T - 0.9) / 0.15, 0, 1);
          h.arms[1].sh.rotation.x = lerp(-2.8, -1.0, k);
          h.torso.rotation.y = lerp(-0.5, 0.3, k);
          if (!e.didHit) {
            e.didHit = true;
            e.root.updateMatrixWorld(true);
            const from = h.arms[1].hand.getWorldPosition(V3());
            const to = V3(P.pos.x + P.vel.x * 0.5, 0, P.pos.z + P.vel.z * 0.5);
            const dx = to.x - W.temple.x, dz = to.z - W.temple.z, d = Math.hypot(dx, dz);
            if (d > W.temple.R - 1) { to.x = W.temple.x + dx / d * (W.temple.R - 1); to.z = W.temple.z + dz / d * (W.temple.R - 1); }
            throwRock(from, to);
            S.swoosh(0.4);
          }
        }
        if (T > 1.7) { setState(e, 'chase'); e.cd = rand(0.8, 1.6); }
        break;
      case 'roar':
        cyPose(e, dt, false);
        h.neck.rotation.x = -0.6; h.torso.rotation.x = -0.25;
        h.arms[0].sh.rotation.z = -1.2; h.arms[1].sh.rotation.z = 1.2;
        if (!e.didHit && T > 0.3) {
          e.didHit = true;
          S.roar(0.55); shake(0.9);
          shockwave(e.pos.x, e.pos.z, 2, 14, 0.8, 0xff5a20);
          const n = e.adds === 'legion' ? 3 : 3;
          for (let i = 0; i < n; i++) {
            const a = rand(0, TAU), r = rand(8, W.temple.R - 6);
            spawnEnemy(e.adds, W.temple.x + Math.sin(a) * r, W.temple.z + Math.cos(a) * r, { rise: true, aggro: true });
          }
          banner('', e.adds === 'legion' ? 'The dead answer his call' : 'Hounds of Tartarus', 1.6, true);
        }
        if (T > 1.8) { setState(e, 'chase'); e.cd = 1.0; }
        break;
      case 'downed':
        A.resetPose(h);
        e.rig.position.y = lerp(e.rig.position.y, 0.97 * 3.1 - 1.5, damp(4, dt));
        h.torso.rotation.x = 0.55; h.neck.rotation.x = 0.3;
        for (const l of h.legs) { l.hp.rotation.x = -1.4; l.kn.rotation.x = 1.6; }
        h.arms[0].sh.rotation.x = -0.4; h.arms[1].sh.rotation.x = -0.4;
        h.iris.scale.setScalar(0.7 + Math.sin(game.time * 3) * 0.1);
        faceTo(e, 1, dt);
        break;
      case 'executed': {
        A.resetPose(h);
        const k = clamp((P.finT - 0.6) / 1.0, 0, 1);
        e.rig.position.y = 0.97 * 3.1 - 1.5 - k * 0.5;
        h.torso.rotation.x = 0.55 + k * 0.5; h.neck.rotation.x = 0.3 + k * 0.4;
        for (const l of h.legs) { l.hp.rotation.x = -1.4; l.kn.rotation.x = 1.6; }
        h.arms[0].sh.rotation.x = -1.5 - Math.sin(game.time * 30) * 0.2;
        h.arms[1].sh.rotation.x = -1.5 + Math.sin(game.time * 30) * 0.2;
        break;
      }
      default: setState(e, 'chase');
    }
  }
  function bossDowned(e) {
    e.hp = 0;
    setState(e, 'downed');
    e.finishable = true;
    S.roar(0.45); shake(0.8);
    banner('', 'Execute him', 2, true);
    for (const o of enemies) if (o !== e && o.alive) killEnemy(o, false);
    for (const p of projectiles) scene.remove(p.m);
    projectiles.length = 0;
  }

  // ===================================================================
  // Camera
  // ===================================================================
  const camT = V3();
  function updateCamera(dt, realDt) {
    if (game.state === 'title') {
      cam.yaw += realDt * 0.06;
      const sp = W.altars[0];
      camT.set(sp.x, ground(sp.x, sp.z) + 3, sp.z);
      cam.target.lerp(camT, damp(3, realDt));
      const d = 22, p = 0.28;
      camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(p) * d, cam.target.y + Math.sin(p) * d, cam.target.z + Math.cos(cam.yaw) * Math.cos(p) * d);
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 1.5);
      camera.lookAt(cam.target);
      return;
    }
    const rot = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
    cam.yaw += rot * realDt * 2.2;
    cam.pitch = clamp(cam.pitch + ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * realDt * 1.2, -0.25, 1.05);
    const fighting = enemies.filter((e) => e.alive && e.aggro && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 18).length;
    let want = fighting >= 3 ? 7 : fighting ? 6.2 : 5.4, side = 0.6;
    if (boss && boss.alive) { want = 12; side = 0; }
    if (P.state === 'finisher') { want = P.finTarget && P.finTarget.def.boss ? 11 : 4.6; side = 0.3; }
    if (camera.aspect < 1) want *= 1.35;
    cam.dist = lerp(cam.dist, want, damp(3, realDt));
    cam.side = lerp(cam.side, side, damp(3, realDt));
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    camT.set(P.pos.x + rx * cam.side, P.pos.y + 1.6, P.pos.z + rz * cam.side);
    cam.target.lerp(camT, damp(12, realDt));
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    let d = cam.dist;
    // pull in when the terrain is in the way
    // pull in when terrain, trees or ruins are in the way
    for (let i = 1; i <= 8; i++) {
      const k = i / 8, x = cam.target.x + Math.sin(cam.yaw) * cp * d * k, z = cam.target.z + Math.cos(cam.yaw) * cp * d * k, y = cam.target.y + sp * d * k;
      if (y < ground(x, z) + 0.4 || (y - ground(x, z) < 7 && !W.colliders.free(x, z, 0.75))) { d = Math.max(1.4, d * (k - 0.06)); break; }
    }
    cam.pos.set(cam.target.x + Math.sin(cam.yaw) * cp * d, cam.target.y + sp * d, cam.target.z + Math.cos(cam.yaw) * cp * d);
    cam.pos.y = Math.max(cam.pos.y, ground(cam.pos.x, cam.pos.z) + 0.45);
    trauma = Math.max(0, trauma - realDt * 1.6);
    const s = trauma * trauma * 0.5;
    camera.position.set(cam.pos.x + rand(-1, 1) * s, cam.pos.y + rand(-1, 1) * s, cam.pos.z + rand(-1, 1) * s);
    camera.lookAt(cam.target);
  }

  // ===================================================================
  // Main loop
  // ===================================================================
  let last = performance.now(), campT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const realDt = Math.min(0.05, (now - last) / 1000);
    last = now;
    let scale = 1;
    if (slowmo > 0) { slowmo -= realDt; scale = 0.45; }
    if (hitstop > 0) { hitstop -= realDt; scale = 0.05; }
    const dt = realDt * scale;
    const t = now / 1000;

    if (game.state === 'playing') {
      game.time += realDt;
      game.clock += dt;
      updatePlayer(dt);
      updateAtreus(dt);
      updateEnemies(dt);
      updateOrbs(dt);
      updateArrows(dt);
      updateProjectiles(dt);
      updateRoamers(dt);
      campT -= dt;
      if (campT <= 0) { campT = 0.5; campCheck(); }
      comboT -= dt;
      if (comboT <= 0) combo = 0;
      S.setCombat(enemies.some((e) => e.alive && e.aggro && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 45) ? 1 : 0);
      if (game.overT > 0) { game.overT -= realDt; if (game.overT <= 0) endScreen(game.victory); }
    } else if (game.state === 'title') {
      animatePlayer(realDt);
      animateAtreus(realDt, 0, null);
    }
    if (game.state === 'playing' || game.state === 'title') {
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);
      for (const f of flashPool) { f.t += dt; f.l.intensity = f.t < f.dur ? f.i0 * (1 - f.t / f.dur) : 0; }
      FX.sparks.update(dt); FX.flames.update(dt); FX.blood.update(dt);
    }
    updateBlades();
    W.update(realDt, t, P.pos.x, P.pos.z);
    G.sky.uniforms.time.value = t;
    G.sky.mesh.position.copy(camera.position);
    updateCamera(dt, realDt);
    G.sky.mesh.position.copy(camera.position);
    G.post.time.value = t % 100;
    if (game.state !== 'title') updateHUD(realDt);
    G.render();
  }

  // initial pose on the title screen
  placeAtSpawn(W.altars[0]);
  P.facing = 0;
  for (const k in CAMP_DEFS) spawnCamp(k);
  updateMenuLabels();
  requestAnimationFrame(frame);

  // advance the simulation without rendering (used by automated tests)
  function simulate(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds && game.state === 'playing'; t += dt) {
      game.time += dt; game.clock += dt;
      updatePlayer(dt); updateBlades(); updateAtreus(dt); updateEnemies(dt);
      updateOrbs(dt); updateArrows(dt); updateProjectiles(dt);
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);
      FX.blood.update(dt);
      campT -= dt; if (campT <= 0) { campT = 0.5; campCheck(); }
      if (game.overT > 0) { game.overT -= dt; if (game.overT <= 0) endScreen(game.victory); }
    }
  }
  window.__wrath = { game, P, AT, enemies, camps, Q, W, start: startGame, respawn, closeShop, renderShop, openShop, cam, simulate, act: ACTIONS };
})();
