/* Ashes of Varkova — the level.
   Three regions built side by side in one scene: the village (with the forest road,
   church and cemetery), the castle interior with its cellar, and the castle roof.
   Also builds colliders, the enemy navigation grids, doors, pickups and props. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, clamp, lerp, rand, sstep, fbm, hash2, V3 } = G.util;
  const scene = G.scene;

  // ===================================================================
  // Regions
  // ===================================================================
  const REGIONS = {
    village: { x0: -95, x1: 95, z0: -165, z1: 100, atmo: { fog: [0.018, 0.021, 0.028], density: 0.034, sky: true, exposure: 1.2 }, amb: 'outside', snow: true },
    castle: { x0: 955, x1: 1080, z0: -70, z1: 16, atmo: { fog: [0.01, 0.007, 0.005], density: 0.03, sky: false, exposure: 1.55 }, amb: 'castle', snow: false },
    roof: { x0: 1962, x1: 2038, z0: -38, z1: 38, atmo: { fog: [0.02, 0.022, 0.03], density: 0.018, sky: true, exposure: 1.2 }, amb: 'outside', snow: true },
  };
  const CX = 1000, RX = 2000; // world x offsets of the castle and the roof
  const regionOf = (x) => (x > 1500 ? 'roof' : x > 500 ? 'castle' : 'village');
  for (const k in REGIONS) {
    REGIONS[k].key = k;
    REGIONS[k].statics = new THREE.Group();
    REGIONS[k].dynamic = new THREE.Group();
    scene.add(REGIONS[k].statics, REGIONS[k].dynamic);
    REGIONS[k].merged = [];
  }

  // ===================================================================
  // Village terrain: a flat basin and road in snowy hills
  // ===================================================================
  const roadX = (z) => Math.sin(z * 0.05) * 6;
  function openness(x, z) {
    // signed distances (metres outside each open area)
    const ell = (Math.sqrt((x / 70) ** 2 + ((z + 38) / 82) ** 2) - 1) * 70;
    let road;
    if (z > 20 && z < 100) road = Math.abs(x - roadX(z)) - 6;
    else road = Math.hypot(x - roadX(clamp(z, 20, 100)), z - clamp(z, 20, 100)) - 6;
    const bridge = Math.max(Math.abs(x) - 6, z > -112 ? -112 - z + 0 : 0, z < -152 ? -152 - z : 0);
    const d = Math.min(ell, road, z < -110 && z > -154 ? Math.abs(x) - 6 : bridge + 50);
    return 1 - sstep(0, 14, d);
  }
  const VRES = 1; // metres per height sample
  const vw = Math.round((REGIONS.village.x1 - REGIONS.village.x0) / VRES), vh = Math.round((REGIONS.village.z1 - REGIONS.village.z0) / VRES);
  const vHeights = new Float32Array((vw + 1) * (vh + 1));
  const vMud = new Float32Array((vw + 1) * (vh + 1));
  for (let iz = 0; iz <= vh; iz++) for (let ix = 0; ix <= vw; ix++) {
    const x = REGIONS.village.x0 + ix * VRES, z = REGIONS.village.z0 + iz * VRES;
    const o = openness(x, z);
    const hill = 5 + fbm(x * 0.03 + 5, z * 0.03, 4) * 6 + fbm(x * 0.1, z * 0.1, 2) * 1.2;
    vHeights[iz * (vw + 1) + ix] = (1 - o) * Math.max(0, hill);
    const roadMud = 1 - sstep(2.5, 5, Math.abs(x - roadX(z))) * (z > 20 ? 1 : 0) - (z <= 20 ? 1 : 0);
    const square = 1 - sstep(10, 18, Math.hypot(x, z + 25));
    const lane = (z < 0 && z > -62 ? 1 - sstep(1.5, 3.5, Math.abs(x)) : 0);
    vMud[iz * (vw + 1) + ix] = clamp(Math.max(roadMud * (z > 20 ? 1 : 0), square * 0.8, lane * 0.8, 0) * (0.6 + 0.4 * (fbm(x * 0.2, z * 0.2, 2) * 0.5 + 0.5)), 0, 1);
  }
  function vSample(arr, x, z) {
    const gx = (x - REGIONS.village.x0) / VRES, gz = (z - REGIONS.village.z0) / VRES;
    const ix = clamp(Math.floor(gx), 0, vw - 1), iz = clamp(Math.floor(gz), 0, vh - 1);
    const fx = clamp(gx - ix, 0, 1), fz = clamp(gz - iz, 0, 1), i = iz * (vw + 1) + ix;
    const a = arr[i], b = arr[i + 1], c = arr[i + vw + 1], d = arr[i + vw + 2];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  const heightAt = (x, z) => (x > 500 ? 0 : vSample(vHeights, x, z));
  const _n = V3();
  G.heightAt = heightAt;
  G.normalAt = (x, z) => (x > 500 ? new THREE.Vector3(0, 1, 0) : _n.set(heightAt(x - 1, z) - heightAt(x + 1, z), 2, heightAt(x, z - 1) - heightAt(x, z + 1)).normalize().clone());
  const WALK_H = 1.15; // ground higher than this is a bank you cannot climb

  // ===================================================================
  // Textures and materials
  // ===================================================================
  const gt = G.genTex;
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const T = {
    snow: gt(256, (u, v) => { const n = fbm(u * 8, v * 8, 5, 8) * 0.5 + 0.5, s = fbm(u * 40, v * 40, 2, 40) * 0.5 + 0.5; return mix3([0.62, 0.66, 0.72], [0.9, 0.92, 0.95], n * 0.7 + s * 0.3); }),
    plaster: gt(256, (u, v) => { const n = fbm(u * 6, v * 6, 5, 6) * 0.5 + 0.5, st = sstep(0.62, 0.8, fbm(u * 3 + 4, v * 3, 3, 3) * 0.5 + 0.5); const c = mix3([0.5, 0.46, 0.4], [0.68, 0.64, 0.56], n); return mix3(c, [0.3, 0.27, 0.22], st * 0.6); }),
    planks: gt(256, (u, v) => { const row = Math.floor(v * 8), n = fbm(u * 2 + row * 7, v * 40, 4, 2) * 0.5 + 0.5, seam = (v * 8) % 1 < 0.06 ? 0.45 : 1; const k = (0.75 + hash2(row, 3) * 0.3) * seam; const c = mix3([0.2, 0.13, 0.08], [0.38, 0.26, 0.16], n); return [c[0] * k, c[1] * k, c[2] * k]; }),
    roof: gt(256, (u, v) => { const row = Math.floor(v * 10), off = (row % 2) * 0.5, col = Math.floor(u * 6 + off); const n = fbm(u * 8, v * 8, 3, 8) * 0.5 + 0.5; const edge = (v * 10) % 1 < 0.12 || (u * 6 + off) % 1 < 0.04 ? 0.5 : 1; const k = (0.7 + hash2(col, row) * 0.35) * edge; const c = mix3([0.14, 0.11, 0.1], [0.28, 0.22, 0.18], n); return [c[0] * k, c[1] * k, c[2] * k]; }),
    stone: gt(256, (u, v) => { const row = Math.floor(v * 5), off = (row % 2) * 0.5, col = Math.floor(u * 3 + off); const bu = (u * 3 + off) % 1, bv = (v * 5) % 1; const edge = Math.min(bu, 1 - bu, bv, 1 - bv); const n = fbm(u * 10, v * 10, 4, 10) * 0.5 + 0.5; const k = (0.7 + hash2(col, row) * 0.3) * (edge < 0.04 ? 0.45 : 1); const c = mix3([0.26, 0.25, 0.24], [0.44, 0.42, 0.4], n); return [c[0] * k, c[1] * k, c[2] * k]; }),
    darkStone: gt(256, (u, v) => { const row = Math.floor(v * 4), off = (row % 2) * 0.5, col = Math.floor(u * 2 + off); const bu = (u * 2 + off) % 1, bv = (v * 4) % 1; const edge = Math.min(bu, 1 - bu, bv, 1 - bv); const n = fbm(u * 10, v * 10, 4, 10) * 0.5 + 0.5; const k = (0.75 + hash2(col, row) * 0.25) * (edge < 0.03 ? 0.4 : 1); const c = mix3([0.13, 0.12, 0.12], [0.25, 0.23, 0.22], n); return [c[0] * k, c[1] * k, c[2] * k]; }),
    checker: gt(256, (u, v) => { const cx = Math.floor(u * 4), cz = Math.floor(v * 4), n = fbm(u * 6, v * 6, 4, 6) * 0.5 + 0.5; const veins = Math.pow(Math.abs(Math.sin((u * 5 + v * 3 + n * 2) * Math.PI)), 6) * 0.15; const w = (cx + cz) % 2 ? [0.08, 0.07, 0.07] : [0.62, 0.6, 0.57]; return [w[0] + veins, w[1] + veins, w[2] + veins]; }),
    damask: gt(256, (u, v) => { const x = (u * 4) % 1 - 0.5, y = (v * 3) % 1 - 0.5; const r = Math.hypot(x, y * 1.4), pat = Math.abs(Math.sin(Math.atan2(y, x) * 4)) * 0.18; const m = sstep(0.32 + pat, 0.3 + pat, r) * 0.5 + (Math.abs(x) < 0.02 ? 0.2 : 0); const n = fbm(u * 6, v * 6, 3, 6) * 0.1; return [0.22 + m * 0.2 + n, 0.035 + m * 0.05, 0.04 + m * 0.04]; }),
    carpet: gt(256, (u, v) => { const n = fbm(u * 30, v * 30, 2, 30) * 0.06; const border = Math.min(u, 1 - u) < 0.08 ? 1 : 0; const m = Math.abs(Math.sin(u * 20) * Math.sin(v * 20)) > 0.7 ? 0.05 : 0; return border ? [0.42 + n, 0.3 + n, 0.08] : [0.3 + n + m, 0.03 + n, 0.04 + n]; }),
    darkWood: gt(256, (u, v) => { const n = fbm(u * 2, v * 30, 4, 2) * 0.5 + 0.5; return mix3([0.06, 0.035, 0.022], [0.16, 0.1, 0.06], n); }),
    bark: gt(128, (u, v) => { const n = fbm(u * 6, v * 2, 4, 6) * 0.5 + 0.5; return mix3([0.08, 0.07, 0.06], [0.2, 0.18, 0.16], n); }),
  };
  const rep = (t, x, y) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y); return c; };
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, o));
  const M = {
    snowGround: std({ map: rep(T.snow, 40, 52), vertexColors: true, roughness: 0.85 }),
    plaster: std({ map: rep(T.plaster, 0.3, 0.3) }),
    planks: std({ map: rep(T.planks, 0.35, 0.35), roughness: 0.8 }),
    roof: std({ map: rep(T.roof, 0.4, 0.4) }),
    stone: std({ map: rep(T.stone, 0.25, 0.25) }),
    darkStone: std({ map: rep(T.darkStone, 0.2, 0.2) }),
    checker: std({ map: rep(T.checker, 0.25, 0.25), roughness: 0.35, metalness: 0.1 }),
    damask: std({ map: rep(T.damask, 0.35, 0.35), roughness: 0.75 }),
    carpet: std({ map: rep(T.carpet, 0.2, 0.08) }),
    darkWood: std({ map: rep(T.darkWood, 0.3, 0.3), roughness: 0.6 }),
    beam: std({ map: rep(T.darkWood, 0.5, 2), roughness: 0.8 }),
    wood: std({ map: rep(T.planks, 0.5, 0.5), roughness: 0.85 }),
    iron: std({ color: 0x1c1a19, roughness: 0.5, metalness: 0.8 }),
    bronze: std({ color: 0x6a4a24, roughness: 0.4, metalness: 0.85 }),
    gold: std({ color: 0xc9a040, roughness: 0.3, metalness: 1 }),
    cloth: std({ color: 0x3a1010, roughness: 0.95, side: THREE.DoubleSide }),
    linen: std({ color: 0x8a8070, roughness: 0.95 }),
    hay: std({ color: 0x8a7038, roughness: 1 }),
    meat: std({ color: 0x4a0c0a, roughness: 0.4 }),
    bone: std({ color: 0xc8bca0, roughness: 0.6 }),
    glassDark: std({ color: 0x0a0d12, roughness: 0.1, metalness: 0.5 }),
    windowLit: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.3, 0.5) }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 0.9) }),
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.15) }),
    stained: [0xff3030, 0x3060ff, 0xffc030, 0x30c060].map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.1) })),
    candle: std({ color: 0xd8d0b8, roughness: 0.7 }),
    silhouette: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.007, 0.011), fog: false }),
    silWindow: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 0.4), fog: false }),
  };

  // ===================================================================
  // Colliders: oriented boxes and circles in a spatial hash
  // ===================================================================
  const CS = 8, chash = new Map();
  const ckey = (ix, iz) => ix + ',' + iz;
  function insert(c, r) {
    for (let iz = Math.floor((c.cz - r) / CS); iz <= Math.floor((c.cz + r) / CS); iz++)
      for (let ix = Math.floor((c.cx - r) / CS); ix <= Math.floor((c.cx + r) / CS); ix++) {
        const k = ckey(ix, iz);
        if (!chash.has(k)) chash.set(k, []);
        chash.get(k).push(c);
      }
  }
  function addBox(cx, cz, hw, hd, rot = 0, o = {}) {
    const c = { type: 'box', cx, cz, hw, hd, c: Math.cos(rot), s: Math.sin(rot), tall: o.tall !== false, on: true, door: o.door || null, tag: o.tag || '' };
    insert(c, Math.hypot(hw, hd));
    return c;
  }
  function addCircle(cx, cz, r, o = {}) {
    const c = { type: 'circle', cx, cz, r, tall: o.tall !== false, on: true, tag: o.tag || '' };
    insert(c, r);
    return c;
  }
  function nearby(x, z) {
    const out = [];
    const ix = Math.floor(x / CS), iz = Math.floor(z / CS);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const a = chash.get(ckey(ix + dx, iz + dz)); if (a) out.push(a); }
    return out;
  }
  // distance from a point to a collider's surface (negative inside); also gives the push direction
  function sdf(c, x, z, out) {
    if (c.type === 'circle') {
      const dx = x - c.cx, dz = z - c.cz, d = Math.hypot(dx, dz) || 1e-6;
      out.x = dx / d; out.z = dz / d;
      return d - c.r;
    }
    const dx = x - c.cx, dz = z - c.cz;
    const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
    const qx = clamp(lx, -c.hw, c.hw), qz = clamp(lz, -c.hd, c.hd);
    let px = lx - qx, pz = lz - qz, d = Math.hypot(px, pz);
    if (d < 1e-6) {
      // inside: leave along the nearest face
      const ex = c.hw - Math.abs(lx), ez = c.hd - Math.abs(lz);
      if (ex < ez) { px = Math.sign(lx) || 1; pz = 0; d = -ex; } else { px = 0; pz = Math.sign(lz) || 1; d = -ez; }
      out.x = px * c.c + pz * c.s; out.z = -px * c.s + pz * c.c;
      return d;
    }
    px /= d; pz /= d;
    out.x = px * c.c + pz * c.s; out.z = -px * c.s + pz * c.c;
    return d;
  }
  const _dir = { x: 0, z: 0 };
  function push(pos, r, filter) {
    let hit = null;
    for (let iter = 0; iter < 2; iter++) {
      for (const list of nearby(pos.x, pos.z)) for (const c of list) {
        if (!c.on || (filter && !filter(c))) continue;
        const d = sdf(c, pos.x, pos.z, _dir);
        if (d < r) { pos.x += _dir.x * (r - d); pos.z += _dir.z * (r - d); hit = c; }
      }
    }
    return hit;
  }
  function blockedAt(x, z, margin, filter) {
    for (const list of nearby(x, z)) for (const c of list) {
      if (!c.on || (filter && !filter(c))) continue;
      if (sdf(c, x, z, _dir) < margin) return c;
    }
    return null;
  }

  // ===================================================================
  // Building helpers
  // ===================================================================
  let curRegion = REGIONS.village;
  function mesh(geo, mat, x, y, z, ry = 0, shadow = true, parent = null) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = shadow; m.receiveShadow = true;
    (parent || curRegion.statics).add(m);
    return m;
  }
  const boxGeo = (w, h, d, tile = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) {
      // world-scaled UVs so textures keep their size on long walls
      const uv = g.attributes.uv, p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        const a = ax > 0.5 ? p.getZ(i) : p.getX(i), b = ay > 0.5 ? p.getZ(i) : p.getY(i);
        uv.setXY(i, a / tile, b / tile);
      }
    }
    return g;
  };
  const box = (w, h, d, mat, x, y, z, ry = 0, shadow = true, tile = 1) => mesh(boxGeo(w, h, d, tile), mat, x, y, z, ry, shadow);
  const cyl = (rt, rb, h, seg, mat, x, y, z, shadow = true) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, 0, shadow);
  function frame(x, z, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x, z, rot, p: (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c] };
  }
  // a wall from local x1..x2 at local z (or along z when 'side'), with collider
  function fWall(f, x1, z1, x2, z2, h, t, mat, y0 = 0, low = false) {
    const [ax, az] = f.p(x1, z1), [bx, bz] = f.p(x2, z2);
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) return;
    const ang = -Math.atan2(bz - az, bx - ax);
    box(L, h, t, mat, (ax + bx) / 2, y0 + h / 2, (az + bz) / 2, ang);
    if (y0 < 1.5) addBox((ax + bx) / 2, (az + bz) / 2, L / 2, t / 2, ang, { tall: !low && h > 1.6 });
  }
  const fires = [];
  function fire(x, y, z, kind = 'lantern') {
    fires.push({ x, y, z, kind, region: curRegion.key });
    const s = kind === 'candle' ? 0.03 : kind === 'fire' ? 0.25 : 0.07;
    const m = mesh(new THREE.SphereGeometry(s, 8, 6), M.flame, x, y, z, 0, false);
    m.scale.y = 1.6;
  }

  // ---------- doors ----------
  const doors = [];
  function makeDoor(o) {
    // o: id, x, z (centre of the opening), rot (normal of the doorway), w, h, lock, kind, to, mat, region
    const reg = REGIONS[o.region || curRegion.key];
    const w = o.w || 1.2, h = o.h || 2.3, c = Math.cos(o.rot), s = Math.sin(o.rot);
    const hingeX = o.x - (w / 2) * c, hingeZ = o.z + (w / 2) * s;
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, heightAt(o.x, o.z), hingeZ);
    pivot.rotation.y = o.rot;
    const panel = new THREE.Mesh(boxGeo(w - 0.04, h, 0.09, 1), o.mat || M.darkWood);
    panel.position.set(w / 2, h / 2, 0);
    panel.castShadow = true; panel.receiveShadow = true;
    pivot.add(panel);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), M.iron);
    knob.position.set(w - 0.15, 1.05, 0.07); pivot.add(knob);
    const knob2 = knob.clone(); knob2.position.z = -0.07; pivot.add(knob2);
    if (o.lock) {
      const lockM = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.05), M.iron);
      lockM.position.set(w - 0.15, 0.85, 0.08); pivot.add(lockM);
    }
    reg.dynamic.add(pivot);
    const d = {
      id: o.id, region: reg.key, x: o.x, z: o.z, rot: o.rot, w, h, pivot, panel,
      lock: o.lock || null, locked: !!o.lock, kind: o.kind || 'hinge', to: o.to || null, open: false, openT: 0, dir: o.swing || -1, label: o.label || 'door',
    };
    d.collider = addBox(o.x, o.z, w / 2, 0.12, o.rot, { door: d, tall: true });
    doors.push(d);
    return d;
  }

  // ---------- pickups, crates, interactables, triggers, spawns ----------
  const pickups = [], crates = [], interact = [], triggers = [], spawns = [], safeZones = [];
  const pick = (id, item, count, x, y, z, extra = {}) => pickups.push({ id, item, count, x, y, z, region: regionOf(x), ...extra });
  function crate(id, x, z, loot, rot = rand(0, TAU)) {
    crates.push({ id, x, z, rot, loot, region: regionOf(x) });
    // collider added by the game when the crate is built (so it can be removed)
  }

  // ---------- furniture (in a building's local frame) ----------
  function table(f, lx, lz, r = 0, w = 1.5, d = 0.85) {
    const [x, z] = f.p(lx, lz), rot = f.rot + r, y = heightAt(x, z);
    box(w, 0.07, d, M.wood, x, y + 0.78, z, rot);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = a * (w / 2 - 0.08), cz = b * (d / 2 - 0.08), c = Math.cos(rot), s = Math.sin(rot);
      box(0.07, 0.76, 0.07, M.wood, x + cx * c + cz * s, y + 0.38, z - cx * s + cz * c, rot);
    }
    addBox(x, z, w / 2, d / 2, rot, { tall: false });
    return { x, z, y: y + 0.82 };
  }
  function chair(f, lx, lz, r = 0) {
    const [x, z] = f.p(lx, lz), rot = f.rot + r, y = heightAt(x, z);
    box(0.45, 0.05, 0.45, M.wood, x, y + 0.45, z, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    box(0.45, 0.55, 0.05, M.wood, x - 0.2 * s, y + 0.72, z - 0.2 * c, rot);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.04, 0.45, 0.04, M.wood, x + a * 0.19 * c + b * 0.19 * s, y + 0.22, z - a * 0.19 * s + b * 0.19 * c, rot);
  }
  function bed(f, lx, lz, r = 0) {
    const [x, z] = f.p(lx, lz), rot = f.rot + r, y = heightAt(x, z);
    box(1.0, 0.35, 2.0, M.wood, x, y + 0.2, z, rot);
    box(0.92, 0.15, 1.9, M.linen, x, y + 0.45, z, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    box(0.9, 0.12, 0.35, M.linen, x - 0.75 * s, y + 0.58, z - 0.75 * c, rot);
    box(1.0, 0.8, 0.06, M.wood, x - 1.0 * s, y + 0.4, z - 1.0 * c, rot);
    addBox(x, z, 0.5, 1.0, rot, { tall: false });
  }
  function shelf(f, lx, lz, r = 0, w = 1.4) {
    const [x, z] = f.p(lx, lz), rot = f.rot + r, y = heightAt(x, z);
    box(w, 2.0, 0.4, M.darkWood, x, y + 1.0, z, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) {
      if (Math.random() < 0.3) continue;
      const bx = -w / 2 + 0.15 + i * (w - 0.3) / 5;
      const bk = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(rand(0, 0.1), 0.5, rand(0.1, 0.25)), roughness: 0.8 });
      box(0.1, 0.3, 0.25, bk, x + bx * c + 0.21 * s, y + 0.45 + k * 0.6, z - bx * s + 0.21 * c, rot);
    }
    addBox(x, z, w / 2, 0.22, rot);
  }
  function barrel(x, z) {
    const y = heightAt(x, z);
    cyl(0.32, 0.36, 0.9, 12, M.wood, x, y + 0.45, z);
    cyl(0.335, 0.335, 0.05, 12, M.iron, x, y + 0.2, z, false);
    cyl(0.335, 0.335, 0.05, 12, M.iron, x, y + 0.7, z, false);
    addCircle(x, z, 0.36, { tall: false });
  }
  function fireplace(f, lx, lz, r = 0) {
    const [x, z] = f.p(lx, lz), rot = f.rot + r, y = heightAt(x, z);
    box(1.8, 1.4, 0.7, M.stone, x, y + 0.7, z, rot);
    const c = Math.cos(rot), s = Math.sin(rot);
    box(1.0, 0.8, 0.1, new THREE.MeshBasicMaterial({ color: 0x050302 }), x + 0.31 * s, y + 0.45, z + 0.31 * c, rot, false);
    box(0.6, 0.1, 0.25, M.ember, x + 0.25 * s, y + 0.12, z + 0.25 * c, rot, false);
    fire(x + 0.25 * s, y + 0.35, z + 0.25 * c, 'fire');
    addBox(x, z, 0.9, 0.35, rot);
  }
  function candle(x, y, z) {
    cyl(0.025, 0.025, 0.18, 6, M.candle, x, y + 0.09, z, false);
    fire(x, y + 0.21, z, 'candle');
  }

  // ---------- a timber-and-plaster house ----------
  function house(o) {
    const f = frame(o.x, o.z, o.rot), w = o.w, d = o.d, h = o.h || 3.2, t = 0.25;
    const wallMat = o.wallMat || M.plaster;
    const dx = o.doorX || 0, dw = o.doorW || 1.3;
    // floor
    const [fx, fz] = f.p(0, 0);
    box(w, 0.1, d, M.planks, fx, 0.03, fz, o.rot, false);
    // walls
    fWall(f, -w / 2, d / 2, dx - dw / 2, d / 2, h, t, wallMat);
    fWall(f, dx + dw / 2, d / 2, w / 2, d / 2, h, t, wallMat);
    const [lx, lz] = f.p(dx, d / 2);
    box(dw, h - 2.35, t, wallMat, lx, 2.35 + (h - 2.35) / 2, lz, o.rot);
    fWall(f, -w / 2, -d / 2, w / 2, -d / 2, h, t, wallMat);
    fWall(f, -w / 2, -d / 2 + t / 2, -w / 2, d / 2 - t / 2, h, t, wallMat);
    fWall(f, w / 2, -d / 2 + t / 2, w / 2, d / 2 - t / 2, h, t, wallMat);
    // timber framing on the outside corners
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [bx, bz] = f.p(a * (w / 2), b * (d / 2)); box(0.28, h, 0.28, M.beam, bx, h / 2, bz, o.rot); }
    const [tx, tz] = f.p(0, d / 2 + 0.01);
    box(w + 0.3, 0.22, 0.32, M.beam, tx, h - 0.1, tz, o.rot);
    // roof
    const rh = o.roofH || 2.1, ov = 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(-d / 2 - ov, 0); shape.lineTo(d / 2 + ov, 0); shape.lineTo(0, rh); shape.closePath();
    const rg = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
    rg.translate(0, 0, -(w + 0.6) / 2); rg.rotateY(-Math.PI / 2);
    const [rx, rz] = f.p(0, 0);
    mesh(rg, M.roof, rx, h, rz, o.rot);
    // windows on the side walls
    for (const side of [-1, 1]) {
      for (const wz of o.windows || [0]) {
        for (const face of [-1, 1]) {
          const off = side * (w / 2 + face * (t / 2 + 0.01));
          const [wx, wzz] = f.p(off, wz);
          const ry = o.rot + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (face === 1 ? 0 : Math.PI);
          mesh(new THREE.PlaneGeometry(0.8, 0.9), o.lit && face === 1 ? M.windowLit : M.glassDark, wx, 1.6, wzz, ry, false);
          mesh(boxGeo(0.1, 1.05, 0.95), M.beam, wx, 1.6, wzz, o.rot, false);
        }
      }
    }
    if (o.lit) { const [lx2, lz2] = f.p(0, 0); fires.push({ x: lx2, y: 2.2, z: lz2, kind: 'room', region: curRegion.key }); }
    // door
    if (!o.noDoor) {
      const [ddx, ddz] = f.p(dx, d / 2);
      makeDoor({ id: o.id + '_door', x: ddx, z: ddz, rot: o.rot, w: dw - 0.05, lock: o.lock, label: o.label || 'door' });
    }
    if (o.inside) o.inside(f, w, d);
    return f;
  }

  // ===================================================================
  // VILLAGE
  // ===================================================================
  curRegion = REGIONS.village;
  (function terrain() {
    const R = REGIONS.village;
    const g = new THREE.PlaneGeometry(R.x1 - R.x0, R.z1 - R.z0, vw, vh);
    g.rotateX(-Math.PI / 2);
    g.translate((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      p.setY(i, vHeights[i]);
      const m = vMud[i];
      const c = mix3([1, 1, 1], [0.32, 0.27, 0.23], m);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const t = new THREE.Mesh(g, M.snowGround);
    t.receiveShadow = true;
    R.dynamic.add(t);
    R.terrain = t;
  })();

  // forest: snowy pines and dead trees on the banks
  (function forest() {
    const pine = (() => {
      const parts = [];
      for (let k = 0; k < 5; k++) {
        const c = new THREE.ConeGeometry(2.2 - k * 0.4, 2.4, 8, 1).translate(0, 2.4 + k * 1.5, 0);
        const p = c.attributes.position, cc = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const top = p.getY(i) > 2.4 + k * 1.5 + 0.5;
          const v = top ? [0.75, 0.78, 0.82] : [0.03, 0.06, 0.04];
          cc[i * 3] = v[0]; cc[i * 3 + 1] = v[1]; cc[i * 3 + 2] = v[2];
        }
        c.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        parts.push(c);
      }
      const trunk = new THREE.CylinderGeometry(0.15, 0.3, 3, 6).translate(0, 1.5, 0);
      const tc = new Float32Array(trunk.attributes.position.count * 3).fill(0.12);
      trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
      parts.push(trunk);
      return G.mergeGeos(parts);
    })();
    const dead = (() => {
      const parts = [new THREE.CylinderGeometry(0.12, 0.3, 7, 6).translate(0, 3.5, 0)];
      for (let k = 0; k < 7; k++) {
        const b = new THREE.CylinderGeometry(0.03, 0.09, 2.4, 4).translate(0, 1.2, 0);
        b.rotateZ(rand(0.6, 1.2)); b.rotateY((k / 7) * TAU + rand(-0.3, 0.3)); b.translate(0, 2.5 + k * 0.6, 0);
        parts.push(b);
      }
      const g = G.mergeGeos(parts);
      g.deleteAttribute('color');
      return g;
    })();
    const pines = [], deads = [];
    for (let i = 0; i < 2600; i++) {
      const x = rand(REGIONS.village.x0, REGIONS.village.x1), z = rand(REGIONS.village.z0, REGIONS.village.z1);
      const o = openness(x, z);
      if (o > 0.5 && !(o < 0.9 && Math.random() < 0.03)) continue;
      if (Math.abs(x) < 30 && z < -100 && z > -160) continue; // keep the cemetery and bridge clear
      const h = heightAt(x, z);
      (Math.random() < 0.75 ? pines : deads).push([x, h, z, rand(0, TAU), rand(0.8, 1.4)]);
      if (h < WALK_H + 0.5) addCircle(x, z, 0.4, { tag: 'tree' });
    }
    const mk = (geo, mat, list) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = V3(0, 1, 0);
      list.forEach((t, i) => { q.setFromAxisAngle(up, t[3]); m.compose(V3(t[0], t[1] - 0.2, t[2]), q, V3(t[4], t[4] * rand(0.9, 1.2), t[4])); im.setMatrixAt(i, m); });
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      REGIONS.village.dynamic.add(im);
    };
    mk(pine, std({ vertexColors: true, roughness: 0.9 }), pines);
    mk(dead, std({ map: T.bark, color: 0x777777 }), deads);
  })();

  // the crashed car on the forest road
  (function crash() {
    const x = roadX(88) + 1.5, z = 88;
    const g = new THREE.Group();
    const body = std({ color: 0x2a3a3c, roughness: 0.4, metalness: 0.6 });
    const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); return m; };
    add(new THREE.BoxGeometry(1.8, 0.6, 4.2), body, 0, 0.6, 0);
    add(new THREE.BoxGeometry(1.6, 0.55, 2.0), body, 0, 1.15, 0.2);
    add(new THREE.BoxGeometry(1.5, 0.45, 0.05), M.glassDark, 0, 1.15, -0.82);
    for (const [a, b] of [[-0.9, -1.3], [0.9, -1.3], [-0.9, 1.3], [0.9, 1.3]]) add(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), M.iron, a, 0.34, b).rotation.z = Math.PI / 2;
    const lamp = add(new THREE.BoxGeometry(0.3, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 2) }), 0.6, 0.65, -2.11);
    void lamp;
    g.position.set(x, 0, z); g.rotation.set(0.05, 0.5, 0.18);
    REGIONS.village.statics.add(g);
    addBox(x, z, 1.1, 2.3, 0.5);
    fires.push({ x: x + 0.8, y: 0.8, z: z - 2.3, kind: 'headlight', region: 'village' });
  })();

  // the feeding place: a slaughtered goat in the snow
  (function feeding() {
    const x = 4, z = 44;
    mesh(new THREE.SphereGeometry(0.45, 10, 8), M.meat, x, 0.25, z).scale.set(1.4, 0.6, 0.8);
    for (let i = 0; i < 6; i++) { const b = mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 5), M.bone, x + rand(-1, 1), 0.05, z + rand(-1, 1), 0, false); b.rotation.set(Math.PI / 2, rand(0, TAU), 0); }
  })();

  // fences along the road
  for (let z = 22; z < 80; z += 3.2) {
    for (const side of [-1, 1]) {
      const x = roadX(z) + side * 7.5, x2 = roadX(z + 3.2) + side * 7.5;
      if (Math.random() < 0.2) continue;
      box(0.12, 1.1, 0.12, M.wood, x, heightAt(x, z) + 0.55, z, 0);
      const ang = -Math.atan2(3.2, x2 - x);
      box(0.06, 0.1, 3.2, M.wood, (x + x2) / 2, heightAt(x, z) + 0.85, z + 1.6, ang + Math.PI / 2);
    }
  }

  // --- outskirts
  const trapper = house({
    id: 'trapper', x: -15, z: 20, w: 7, d: 6, rot: Math.PI / 2, lit: true, label: 'Trapper\'s Cottage', windows: [0],
    inside(f) {
      const t = table(f, 0.5, -1.2);
      chair(f, 0.5, -0.4, Math.PI);
      bed(f, -2.2, 1.5, Math.PI / 2);
      fireplace(f, 3.1, 0.5, -Math.PI / 2);
      shelf(f, -1.5, -2.6);
      candle(t.x + 0.4, t.y, t.z);
      const [lx, lz] = f.p(-2.6, -1.8);
      interact.push({ id: 'ledger_trapper', kind: 'ledger', x: lx, z: lz, y: 0.9, region: 'village', label: 'Write in the ledger (save)' });
      table(f, -2.6, -1.8, 0, 0.9, 0.6);
      const [px, pz] = f.p(0.2, -1.2);
      pick('pistol', 'weapon:pistol', 1, px, t.y + 0.05, pz);
      const [ax, az] = f.p(0.9, -1.0);
      pick('trap_ammo', 'pistolAmmo', 15, ax, t.y + 0.05, az);
      const [hx, hz] = f.p(-1.4, -2.4);
      pick('trap_herb', 'herb', 1, hx, 1.25, hz);
      const [nx, nz] = f.p(-0.2, -1.4);
      pick('note_trapper', 'note:trapper', 1, nx, t.y + 0.02, nz);
    },
  });
  void trapper;
  safeZones.push({ region: 'village', x0: -18.5, z0: 16.5, x1: -11.5, z1: 23.5 });
  // barn with the crank
  house({
    id: 'barn', x: 22, z: 12, w: 10, d: 13, h: 4.2, rot: -Math.PI / 2, roofH: 3.4, doorW: 2.6, noDoor: true, windows: [-3, 3], wallMat: M.wood,
    inside(f) {
      for (let i = 0; i < 6; i++) { const [x, z] = f.p(rand(-3.5, 3.5), rand(-5, -1)); box(1.2, 0.8, 0.8, M.hay, x, 0.4, z, rand(0, 3)); addBox(x, z, 0.6, 0.4, 0, { tall: false }); }
      const [cx, cz] = f.p(2.5, -4.5);
      pick('crank', 'key:crank', 1, cx, 0.9, cz);
      box(1, 0.8, 0.6, M.wood, cx, 0.4, cz, 0); addBox(cx, cz, 0.5, 0.3, 0, { tall: false });
      const [hx, hz] = f.p(-3, 3);
      for (let k = 0; k < 2; k++) { const m = mesh(new THREE.SphereGeometry(0.35, 8, 6), M.meat, hx + k, 2.2, hz, 0, true); m.scale.set(0.8, 1.6, 0.6); box(0.02, 1.2, 0.02, M.iron, hx + k, 3.2, hz); }
      crate('barn_c1', ...f.p(-3.5, -5.5), 'pistolAmmo');
      crate('barn_c2', ...f.p(3.6, 4.5), 'marks');
    },
  });
  house({
    id: 'ruin', x: 20, z: 30, w: 6, d: 5, rot: -Math.PI / 2, label: 'Abandoned House', windows: [0],
    inside(f) {
      table(f, 0.8, -1); chair(f, -0.5, -1.2, 1.2); shelf(f, -2.2, -2.1, 0, 1.2);
      const [x, z] = f.p(0.8, -1);
      pick('ruin_ammo', 'pistolAmmo', 10, x, 0.87, z);
      const [nx, nz] = f.p(1.4, -1.1);
      pick('note_hunter', 'note:hunter', 1, nx, 0.85, nz);
      crate('ruin_c1', ...f.p(2.2, 1.6), 'herb');
    },
  });
  house({ id: 'shed', x: -18, z: 29, w: 4, d: 4, rot: Math.PI / 2, windows: [0], inside(f) { crate('shed_c1', ...f.p(0.8, -0.8), 'marks'); barrel(...f.p(-1, -1)); } });

  // --- the palisade wall and its gate
  (function palisade() {
    const stakes = [];
    for (let x = -64; x <= 64; x += 0.55) {
      if (Math.abs(x) < 2.8) continue;
      stakes.push([x + rand(-0.05, 0.05), heightAt(x, 0), rand(-0.1, 0.1), rand(3.2, 4.2)]);
    }
    const geo = G.mergeGeos([new THREE.CylinderGeometry(0.22, 0.26, 1, 6).translate(0, 0.5, 0), new THREE.ConeGeometry(0.22, 0.5, 6).translate(0, 1.25, 0)]);
    geo.deleteAttribute('color');
    const im = new THREE.InstancedMesh(geo, M.wood, stakes.length);
    const m = new THREE.Matrix4();
    stakes.forEach((s, i) => { m.compose(V3(s[0], s[1] - 0.2, s[2]), new THREE.Quaternion(), V3(1, s[3], 1)); im.setMatrixAt(i, m); });
    im.castShadow = true; im.frustumCulled = false;
    REGIONS.village.dynamic.add(im);
    addBox(-33.4, 0, 30.6, 0.3, 0); addBox(33.4, 0, 30.6, 0.3, 0);
    // gatehouse
    box(1, 6, 1, M.wood, -3.2, 3, 0); box(1, 6, 1, M.wood, 3.2, 3, 0); box(7.4, 0.8, 1, M.wood, 0, 5.6, 0);
    addBox(-3.2, 0, 0.5, 0.5); addBox(3.2, 0, 0.5, 0.5);
    fire(-3.2, 4.2, 0.65); fire(3.2, 4.2, 0.65);
    // winch
    box(0.8, 1, 0.8, M.wood, 5, 0.5, 2.2); addBox(5, 2.2, 0.4, 0.4, 0, { tall: false });
    cyl(0.25, 0.25, 1.0, 10, M.iron, 5, 1.2, 2.2).rotation.z = Math.PI / 2;
    interact.push({ id: 'winch', kind: 'winch', x: 5, z: 2.2, y: 1.2, region: 'village', label: 'Use the gate winch' });
  })();
  const gate = (() => {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 6), M.wood); s.position.set(-2.4 + i * 0.6, 2.3, 0); s.castShadow = true; g.add(s); }
    for (const y of [1, 3.2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 0.2), M.iron); b.position.set(0, y, 0); g.add(b); }
    REGIONS.village.dynamic.add(g);
    const c = addBox(0, 0, 2.7, 0.3, 0);
    return { mesh: g, collider: c, open: false, t: 0 };
  })();
  triggers.push({ id: 'enterVillage', region: 'village', x0: -50, z0: -16, x1: 50, z1: -3 });
  triggers.push({ id: 'feedingScare', region: 'village', x0: -8, z0: 46, x1: 14, z1: 60 });

  // --- the village centre
  (function centre() {
    // bell tower
    box(4.4, 12, 4.4, M.stone, 0, 6, -28);
    addBox(0, -28, 2.2, 2.2);
    box(5, 0.4, 5, M.stone, 0, 12.2, -28);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.5, 3, 0.5, M.stone, a * 2, 13.9, -28 + b * 2);
    mesh(new THREE.ConeGeometry(3.6, 3.5, 4), M.roof, 0, 17.1, -28, Math.PI / 4);
    const bell = mesh(new THREE.CylinderGeometry(0.5, 1.0, 1.4, 16, 1, true), M.bronze, 0, 13.6, -28, 0, true);
    bell.material = M.bronze;
    REGIONS.village.bell = bell;
    fire(2.3, 3, -25.7); fire(-2.3, 3, -25.7);
    // well
    cyl(1.1, 1.2, 0.9, 16, M.stone, -8, 0.45, -19);
    addCircle(-8, -19, 1.2, { tall: false });
    box(0.15, 2, 0.15, M.wood, -9, 1.4, -19); box(0.15, 2, 0.15, M.wood, -7, 1.4, -19); box(2.4, 0.15, 0.15, M.wood, -8, 2.4, -19);
    // carts, hay, lanterns
    for (const [x, z] of [[10, -20], [-12, -36], [12, -40]]) {
      box(1.4, 0.15, 2.4, M.wood, x, 0.8, z, 0.4);
      for (const s of [-1, 1]) cyl(0.5, 0.5, 0.1, 12, M.wood, x + s * 0.8, 0.5, z, true).rotation.z = Math.PI / 2;
      addBox(x, z, 0.8, 1.3, 0.4, { tall: false });
    }
    for (const [x, z] of [[-6, -6], [6, -6], [-14, -26], [14, -26], [-6, -52], [6, -52]]) {
      box(0.12, 3, 0.12, M.wood, x, 1.5, z); box(0.6, 0.08, 0.08, M.wood, x + 0.25, 2.9, z);
      fire(x + 0.5, 2.6, z); addCircle(x, z, 0.15, { tall: false });
    }
    // meat hooks: the village has been feeding on something
    for (let i = 0; i < 3; i++) {
      const x = -4 + i * 1.2, z = -8;
      box(0.1, 3.2, 0.1, M.wood, x, 1.6, z);
      const m = mesh(new THREE.SphereGeometry(0.3, 8, 6), M.meat, x + 0.3, 2.1, z, 0, true); m.scale.set(0.7, 1.5, 0.5);
      addCircle(x, z, 0.15, { tall: false });
    }
  })();
  house({
    id: 'h1', x: -19, z: -12, w: 6.5, d: 5.5, rot: Math.PI / 2, lit: true, windows: [0],
    inside(f) {
      const t = table(f, 0.5, -1.2); chair(f, 0.5, -0.4, Math.PI); bed(f, -2.0, 1.2, Math.PI / 2); shelf(f, 2.4, -2.3, 0, 1.2);
      candle(t.x - 0.3, t.y, t.z);
      pick('rusty_key', 'key:rusty', 1, t.x + 0.3, t.y + 0.03, t.z);
      const [nx, nz] = f.p(-0.1, -1.3);
      pick('note_elder', 'note:elder', 1, nx, t.y + 0.02, nz);
      crate('h1_c1', ...f.p(2.4, 1.8), 'pistolAmmo');
    },
  });
  // Chapel of Saint Ivo: the safe room where the merchant waits
  house({
    id: 'ivo', x: 19, z: -11, w: 6, d: 7, rot: -Math.PI / 2, lit: true, wallMat: M.stone, h: 3.8, roofH: 2.6, windows: [-1.5, 1.5], label: 'Chapel of Saint Ivo',
    inside(f) {
      const [ax, az] = f.p(0, -3.0);
      box(1.6, 1.0, 0.6, M.stone, ax, 0.5, az, f.rot); addBox(ax, az, 0.8, 0.3, f.rot);
      candle(...(() => { const [x, z] = f.p(-0.5, -3.0); return [x, 1.0, z]; })());
      candle(...(() => { const [x, z] = f.p(0.5, -3.0); return [x, 1.0, z]; })());
      const [lx, lz] = f.p(-2.2, -1.5);
      table(f, -2.2, -1.5, Math.PI / 2, 0.9, 0.6);
      interact.push({ id: 'ledger_ivo', kind: 'ledger', x: lx, z: lz, y: 0.9, region: 'village', label: 'Write in the ledger (save)' });
      const [mx, mz] = f.p(1.6, -1.0);
      interact.push({ id: 'merchant_ivo', kind: 'merchant', x: mx, z: mz, y: 0, region: 'village', label: 'Trade with Brask', rot: f.rot - Math.PI / 2, flag: 'siegeDone' });
    },
  });
  safeZones.push({ region: 'village', x0: 15.5, z0: -14, x1: 22.5, z1: -8 });
  house({
    id: 'h3', x: -25, z: -33, w: 6, d: 6, rot: Math.PI / 2, windows: [0],
    inside(f) {
      const t = table(f, 0, -1.5); shelf(f, -2.2, 2.6, Math.PI, 1.2); bed(f, 1.8, 1.4, -Math.PI / 2);
      pick('h3_herb', 'herb', 1, t.x, t.y + 0.05, t.z);
      pick('h3_ring', 'treasure:ring', 1, t.x + 0.5, t.y + 0.03, t.z);
      crate('h3_c1', ...f.p(-2.3, -2.3), 'marks');
    },
  });
  house({
    id: 'h4', x: 24, z: -35, w: 6.5, d: 6, rot: -Math.PI / 2, lock: 'rusty', windows: [0], label: 'Locked House',
    inside(f) {
      const t = table(f, 0, -1.5); chair(f, 0.8, -0.7, Math.PI);
      pick('h4_egg', 'treasure:egg', 1, t.x, t.y + 0.05, t.z);
      pick('h4_ammo', 'pistolAmmo', 15, t.x + 0.5, t.y + 0.05, t.z);
      const [mx, mz] = f.p(-2.0, 1.5);
      pick('h4_med', 'medicine', 1, mx, 0.05, mz);
      const [nx, nz] = f.p(-0.4, -1.6);
      pick('note_shepherd', 'note:shepherd', 1, nx, t.y + 0.02, nz);
    },
  });
  house({ id: 'h5', x: -14, z: -50, w: 6, d: 5, rot: 0, windows: [0], inside(f) { table(f, 1, -1); crate('h5_c1', ...f.p(-2, -1.4), 'herb'); crate('h5_c2', ...f.p(-2, 0.8), 'pistolAmmo'); } });
  house({ id: 'h6', x: 13, z: -51, w: 6, d: 5, rot: 0, lit: true, windows: [0], inside(f) { const t = table(f, 0, -1.2); pick('h6_ammo', 'pistolAmmo', 10, t.x, t.y + 0.05, t.z); bed(f, 2, 1, -Math.PI / 2); } });

  // the mill, where the Alpha guards the Lamb Crest
  house({
    id: 'mill', x: -40, z: -26, w: 9, d: 9, h: 5, rot: Math.PI / 2, roofH: 3, doorW: 1.6, windows: [-2, 2], wallMat: M.stone, label: 'Old Mill',
    inside(f) {
      for (let i = 0; i < 5; i++) { const [x, z] = f.p(rand(-3, 3), rand(-3.5, -1)); box(0.7, 0.9, 0.5, M.linen, x, 0.45, z, rand(0, 3)); addBox(x, z, 0.35, 0.25, 0, { tall: false }); }
      const [cx, cz] = f.p(0, 0); cyl(1.2, 1.2, 0.5, 18, M.stone, cx, 0.6, cz); addCircle(cx, cz, 1.2, { tall: false });
      const [px, pz] = f.p(0, -3.6);
      box(1.2, 0.9, 0.6, M.stone, px, 0.45, pz, f.rot); addBox(px, pz, 0.6, 0.3, f.rot, { tall: false });
      pick('lamb_crest', 'key:lamb', 1, px, 0.95, pz);
      crate('mill_c1', ...f.p(3.3, 3.3), 'pistolAmmo');
      crate('mill_c2', ...f.p(-3.3, 3.3), 'marks');
      const [nx, nz] = f.p(-3.0, -3.4);
      pick('mill_herb', 'herb', 1, nx, 0.05, nz);
    },
  });
  // sails
  (function sails() {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.05), M.wood); b.position.y = 3; const arm = new THREE.Group(); arm.rotation.z = (k / 4) * TAU; arm.add(b); const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 4.5), M.linen); sail.position.set(0.7, 3.4, 0.03); arm.add(sail); g.add(arm); }
    g.position.set(-35.2, 6.5, -26);
    g.rotation.y = Math.PI / 2;
    REGIONS.village.dynamic.add(g);
    REGIONS.village.sails = g;
  })();

  // the church
  (function church() {
    const f = frame(0, -72, 0), w = 14, d = 22, h = 7, t = 0.5;
    box(w, 0.1, d, M.stone, 0, 0.03, -72, 0, false);
    fWall(f, -w / 2, d / 2, -1, d / 2, h, t, M.stone); fWall(f, 1, d / 2, w / 2, d / 2, h, t, M.stone);
    box(2, h - 2.6, t, M.stone, 0, 2.6 + (h - 2.6) / 2, -61);
    fWall(f, -w / 2, -d / 2, -1, -d / 2, h, t, M.stone); fWall(f, 1, -d / 2, w / 2, -d / 2, h, t, M.stone);
    box(2, h - 2.6, t, M.stone, 0, 2.6 + (h - 2.6) / 2, -83);
    fWall(f, -w / 2, -d / 2, -w / 2, d / 2, h, t, M.stone); fWall(f, w / 2, -d / 2, w / 2, d / 2, h, t, M.stone);
    const shape = new THREE.Shape(); shape.moveTo(-w / 2 - 0.6, 0); shape.lineTo(w / 2 + 0.6, 0); shape.lineTo(0, 5.5); shape.closePath();
    const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false }); rg.translate(0, 0, -(d + 0.8) / 2);
    mesh(rg, M.roof, 0, h, -72);
    box(3, 11, 3, M.stone, -8.6, 5.5, -62.5); mesh(new THREE.ConeGeometry(2.4, 5, 4), M.roof, -8.6, 13.5, -62.5, Math.PI / 4);
    addBox(-8.6, -62.5, 1.5, 1.5);
    // pews and altar
    for (let r = 0; r < 6; r++) for (const s of [-1, 1]) {
      const x = s * 3.4, z = -66 - r * 2.2;
      box(4, 0.08, 0.5, M.wood, x, 0.5, z); box(4, 0.7, 0.06, M.wood, x, 0.8, z - 0.25);
      addBox(x, z, 2, 0.3, 0, { tall: false });
    }
    box(3, 1.1, 1.2, M.stone, 0, 0.55, -80); addBox(0, -80, 1.5, 0.6, 0, { tall: false });
    candle(-1, 1.1, -80); candle(1, 1.1, -80); candle(0, 1.1, -80.3);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const m = mesh(new THREE.PlaneGeometry(1.2, 2.6), M.stained[(i + (s > 0 ? 1 : 0)) % 4], s * (w / 2 - 0.26), 4, -65 - i * 4.5, s > 0 ? -Math.PI / 2 : Math.PI / 2, false); void m; }
    makeDoor({ id: 'church_front', x: 0, z: -61, rot: 0, w: 1.9, h: 2.55, lock: 'lamb', label: 'Church door' });
    makeDoor({ id: 'church_back', x: 0, z: -83, rot: Math.PI, w: 1.9, h: 2.55, label: 'Cemetery door' });
    const [nx, nz] = [0.6, -79.8];
    pick('note_matthias', 'note:matthias', 1, nx, 1.12, nz);
    pick('church_ammo', 'pistolAmmo', 12, -0.7, 1.12, -79.8);
    triggers.push({ id: 'churchAmbush', region: 'village', x0: -6, z0: -78, x1: 6, z1: -64 });
  })();

  // the cemetery: the Shepherd's ground
  (function cemetery() {
    const x0 = -20, x1 = 20, z0 = -114, z1 = -84;
    const f = frame(0, 0, 0);
    fWall(f, x0, z1, -1, z1, 2.4, 0.6, M.stone); fWall(f, 1, z1, x1, z1, 2.4, 0.6, M.stone);
    fWall(f, x0, z0, -3, z0, 2.4, 0.6, M.stone); fWall(f, 3, z0, x1, z0, 2.4, 0.6, M.stone);
    fWall(f, x0, z0, x0, z1, 2.4, 0.6, M.stone); fWall(f, x1, z0, x1, z1, 2.4, 0.6, M.stone);
    for (let i = 0; i < 46; i++) {
      const x = rand(x0 + 2, x1 - 2), z = rand(z0 + 2, z1 - 2);
      if (Math.hypot(x, z + 99) < 9) continue;
      const m = box(0.7, rand(0.8, 1.3), 0.18, M.stone, x, 0.5, z, rand(-0.2, 0.2));
      m.rotation.z = rand(-0.15, 0.15);
      addBox(x, z, 0.35, 0.1, 0, { tall: false });
    }
    for (const [x, z] of [[-16, -89], [16, -109], [-15, -109], [15, -90]]) {
      const g = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.35, 6, 6), std({ map: T.bark, color: 0x666666 })); tr.position.y = 3; tr.castShadow = true; g.add(tr);
      for (let k = 0; k < 5; k++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.09, 2.2, 4), tr.material); b.position.y = 3 + k * 0.5; b.rotation.set(rand(0.7, 1.2), (k / 5) * TAU, 0); b.translateY(1); b.castShadow = true; g.add(b); }
      g.position.set(x, 0, z); REGIONS.village.statics.add(g); addCircle(x, z, 0.4, { tag: 'tree' });
    }
    fire(-2.6, 2.2, -84.6); fire(2.6, 2.2, -84.6);
    // the iron gate to the castle bridge
    const gg = new THREE.Group();
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 5), M.iron); b.position.set(-2.6 + i * 0.65, 1.5, 0); gg.add(b); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.12, 0.1), M.iron); bar.position.y = 2.2; gg.add(bar);
    gg.position.set(0, 0, z0);
    REGIONS.village.dynamic.add(gg);
    REGIONS.village.cemGate = { mesh: gg, collider: addBox(0, z0, 3, 0.3, 0), open: false, t: 0 };
    triggers.push({ id: 'shepherd', region: 'village', x0: -12, z0: -106, x1: 12, z1: -88 });
  })();
  // the bridge and the castle gate
  (function bridge() {
    const f = frame(0, 0, 0);
    box(10, 0.4, 40, M.stone, 0, -0.1, -134, 0, false);
    fWall(f, -5.2, -114, -5.2, -154, 1.1, 0.4, M.stone, 0, true);
    fWall(f, 5.2, -114, 5.2, -154, 1.1, 0.4, M.stone, 0, true);
    box(14, 12, 2, M.darkStone, 0, 6, -155);
    addBox(0, -155, 7, 1);
    fire(-2.2, 3.2, -153.9, 'lantern'); fire(2.2, 3.2, -153.9, 'lantern');
    makeDoor({ id: 'castle_gate', x: 0, z: -154, rot: 0, w: 2.6, h: 3.5, kind: 'transition', to: { region: 'castle', x: CX, z: 8, yaw: 0 }, label: 'Castle doors', mat: M.darkWood, lock: 'flag:shepherdDead' });
  })();
  // the castle looming over the valley
  (function castleSilhouette() {
    const g = new THREE.Group(), add = (geo, x, y, z, mat = M.silhouette) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    add(new THREE.BoxGeometry(110, 60, 30), 0, 50, 0);
    add(new THREE.BoxGeometry(60, 40, 30), 0, 100, 0);
    for (const [x, h] of [[-62, 120], [62, 110], [-25, 150], [28, 140], [0, 170]]) {
      add(new THREE.CylinderGeometry(9, 10, h, 10), x, h / 2, 6);
      add(new THREE.ConeGeometry(12, 30, 10), x, h + 15, 6);
    }
    for (let i = 0; i < 26; i++) add(new THREE.PlaneGeometry(2.4, 4), rand(-50, 50), rand(30, 120), 15.2, M.silWindow);
    add(new THREE.BoxGeometry(220, 40, 60), 0, 0, -10); // the crag
    g.position.set(0, -10, -360);
    REGIONS.village.dynamic.add(g);
  })();
  spawns.push(
    { id: 'v_feed', type: 'hollowed', x: 4.6, z: 45.2, state: 'feed' },
    { id: 'v_barn1', type: 'hollowed', x: 22, z: 8 },
    { id: 'v_barn2', type: 'hollowed', x: 24, z: 16, state: 'feed' },
    { id: 'v_out1', type: 'hollowed', x: 10, z: 28 },
    { id: 'v_c1', type: 'hollowed', x: -10, z: -40, flag: 'siegeDone' },
    { id: 'v_c2', type: 'hollowed', x: 12, z: -45, flag: 'siegeDone' },
    { id: 'v_c3', type: 'hollowed', x: -28, z: -20, flag: 'siegeDone' },
    { id: 'v_alpha', type: 'alpha', x: -40, z: -27, flag: 'siegeDone' },
    { id: 'v_mill1', type: 'hollowed', x: -33, z: -36, flag: 'siegeDone' },
    { id: 'v_church1', type: 'hollowed', x: -4, z: -78, flag: 'churchOpen', state: 'dormant' },
    { id: 'v_church2', type: 'hollowed', x: 4, z: -76, flag: 'churchOpen', state: 'dormant' },
  );

  // ===================================================================
  // CASTLE (interior, offset to x = 1000)
  // ===================================================================
  curRegion = REGIONS.castle;
  const CH = 6; // ceiling height
  function wallLine(x1, z1, x2, z2, mat, gaps = [], h = CH, t = 0.5) {
    // axis-aligned wall with door gaps [{at, w}]
    const horiz = Math.abs(z2 - z1) < 1e-3, a0 = horiz ? Math.min(x1, x2) : Math.min(z1, z2), a1 = horiz ? Math.max(x1, x2) : Math.max(z1, z2);
    const cut = gaps.map((g) => [g.at - g.w / 2, g.at + g.w / 2]).sort((p, q) => p[0] - q[0]);
    let s = a0;
    const seg = (u0, u1) => {
      if (u1 - u0 < 0.05) return;
      const L = u1 - u0, m = (u0 + u1) / 2;
      if (horiz) { box(L, h, t, mat, CX + m, h / 2, z1, 0); addBox(CX + m, z1, L / 2, t / 2, 0); }
      else { box(t, h, L, mat, CX + x1, h / 2, m, 0); addBox(CX + x1, m, t / 2, L / 2, 0); }
    };
    for (const [g0, g1] of cut) {
      seg(s, g0);
      const L = g1 - g0, m = (g0 + g1) / 2, lh = h - 2.6;
      if (horiz) box(L, lh, t, mat, CX + m, 2.6 + lh / 2, z1, 0); else box(t, lh, L, mat, CX + x1, 2.6 + lh / 2, m, 0);
      s = g1;
    }
    seg(s, a1);
  }
  function floorRect(x0, z0, x1, z1, mat, tile, y = 0, ceil = true) {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    mesh(g, mat, CX + (x0 + x1) / 2, y + 0.01, (z0 + z1) / 2, 0, false);
    if (ceil) {
      const c = new THREE.PlaneGeometry(w, d); c.rotateX(Math.PI / 2);
      const cu = c.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * w / 3, cu.getY(i) * d / 3);
      mesh(c, M.darkWood, CX + (x0 + x1) / 2, CH, (z0 + z1) / 2, 0, false);
    }
  }
  const at = (x, z) => [CX + x, z];
  function chandelier(x, z) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.04, 6, 24), M.iron); ring.rotation.x = Math.PI / 2; g.add(ring);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), M.iron); chain.position.y = 0.75; g.add(chain);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU, c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 5), M.candle);
      c.position.set(Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9); g.add(c);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), M.flame); fl.position.set(Math.cos(a) * 0.9, 0.25, Math.sin(a) * 0.9); fl.scale.y = 1.6; g.add(fl);
    }
    g.position.set(CX + x, CH - 1.6, z);
    curRegion.statics.add(g);
    fires.push({ x: CX + x, y: CH - 1.4, z, kind: 'chandelier', region: 'castle' });
  }
  function sconce(x, z, face) {
    const [wx, wz] = at(x, z);
    box(0.12, 0.3, 0.12, M.iron, wx, 2.4, wz, face, false);
    fire(wx + Math.sin(face) * 0.15, 2.7, wz + Math.cos(face) * 0.15, 'candle');
    fires.push({ x: wx + Math.sin(face) * 0.3, y: 2.7, z: wz + Math.cos(face) * 0.3, kind: 'sconce', region: 'castle' });
  }
  function painting(x, z, face, w = 1.4, h = 1.8, seed = 0) {
    const [wx, wz] = at(x, z);
    box(w + 0.2, h + 0.2, 0.08, M.gold, wx, 2.6, wz, face, false);
    const tex = G.canvasTex(64, 80, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 80); gr.addColorStop(0, '#120a06'); gr.addColorStop(1, '#2a1a10'); g.fillStyle = gr; g.fillRect(0, 0, 64, 80);
      g.fillStyle = `hsl(${20 + seed * 30},25%,${25 + (seed % 3) * 8}%)`; g.beginPath(); g.ellipse(32, 30, 12, 15, 0, 0, TAU); g.fill();
      g.fillStyle = '#0a0606'; g.fillRect(14, 46, 36, 34);
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(26, 26, 3, 2); g.fillRect(35, 26, 3, 2);
    });
    tex.encoding = THREE.sRGBEncoding;
    const p = mesh(new THREE.PlaneGeometry(w, h), std({ map: tex, roughness: 0.6 }), wx + Math.sin(face) * 0.05, 2.6, wz + Math.cos(face) * 0.05, face, false);
    void p;
  }
  // rooms
  floorRect(-12, -10, 12, 10, M.checker, 3);          // Grand Hall
  floorRect(-34, -10, -12, 10, M.darkWood, 2.5);       // Dining
  floorRect(-34, -22, -12, -10, M.stone, 3);           // Armory
  floorRect(12, -12, 34, 12, M.carpet, 4);             // Library
  floorRect(-4, -42, 4, -10, M.carpet, 3);             // Gallery
  floorRect(4, -28, 16, -16, M.planks, 2.5);           // Servants' quarters
  floorRect(-10, -58, 10, -42, M.darkStone, 3);        // Chapel
  wallLine(-12, 10, 12, 10, M.damask, [{ at: 0, w: 2.6 }]);
  wallLine(-34, 10, -12, 10, M.damask);
  wallLine(12, 12, 34, 12, M.damask);
  wallLine(12, -12, 12, 12, M.damask, [{ at: 0, w: 2 }]);
  wallLine(-34, -22, -34, 10, M.darkStone);
  wallLine(-12, -10, -12, 10, M.damask, [{ at: 0, w: 2 }]);
  wallLine(-34, -10, -12, -10, M.darkStone, [{ at: -23, w: 2 }]);
  wallLine(-34, -22, -12, -22, M.darkStone);
  wallLine(-12, -22, -12, -10, M.darkStone);
  wallLine(-12, -10, 12, -10, M.damask, [{ at: 0, w: 2.4 }]);
  wallLine(12, -12, 34, -12, M.damask);
  wallLine(34, -12, 34, 12, M.damask);
  wallLine(-4, -42, -4, -10, M.damask, [{ at: -30, w: 1.6 }]);
  wallLine(4, -42, 4, -10, M.damask, [{ at: -22, w: 1.6 }]);
  wallLine(4, -28, 16, -28, M.plaster); wallLine(4, -16, 16, -16, M.plaster); wallLine(16, -28, 16, -16, M.plaster);
  wallLine(-10, -42, 10, -42, M.darkStone, [{ at: 0, w: 2.6 }]);
  wallLine(-10, -58, -10, -42, M.darkStone); wallLine(10, -58, 10, -42, M.darkStone);
  wallLine(-10, -58, 10, -58, M.darkStone, [{ at: 0, w: 1.8 }]);
  // Grand Hall: staircase to a balcony she watches from
  for (let i = 0; i < 10; i++) { box(3, 0.3, 0.75, M.checker, CX - 8, 0.15 + i * 0.3, -1.5 - i * 0.7); }
  addBox(CX - 8, -5, 1.5, 3.6);
  box(24, 0.4, 3, M.darkWood, CX, 3.2, -8.5);
  for (let i = 0; i < 12; i++) box(0.1, 1, 0.1, M.darkWood, CX - 11 + i * 2, 3.9, -7);
  box(24, 0.1, 0.12, M.darkWood, CX, 4.4, -7);
  chandelier(0, 3); chandelier(-6, -3); chandelier(6, -3);
  for (const s of [-1, 1]) { sconce(s * 11.7, 5, s > 0 ? -Math.PI / 2 : Math.PI / 2); painting(s * 11.7, -2, s > 0 ? -Math.PI / 2 : Math.PI / 2, 1.6, 2.2, s + 2); }
  for (const s of [-1, 1]) { const [x, z] = at(s * 9, 7); cyl(0.35, 0.45, 1.2, 12, M.darkStone, x, 0.6, z); addCircle(x, z, 0.45); const v = cyl(0.25, 0.15, 0.6, 10, M.bronze, x, 1.5, z); void v; }
  // Dining hall
  (function dining() {
    box(16, 0.1, 1.8, M.darkWood, CX - 23, 0.8, 0);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
      const x = CX - 30 + i * 2.8, z = s * 1.3;
      box(0.5, 0.06, 0.5, M.darkWood, x, 0.5, z); box(0.5, 1.0, 0.06, M.darkWood, x, 1.0, z + s * 0.25);
    }
    for (let i = 0; i < 8; i++) box(0.06, 0.78, 0.06, M.darkWood, CX - 30.5 + i * 2.2, 0.39, i % 2 ? 0.7 : -0.7);
    addBox(CX - 23, 0, 8.4, 1.6, 0, { tall: false });
    for (let i = 0; i < 5; i++) { candle(CX - 29 + i * 3, 0.85, 0); }
    for (let i = 0; i < 6; i++) { const m = mesh(new THREE.SphereGeometry(0.18, 8, 6), M.meat, CX - 28 + i * 2.4 + rand(-0.4, 0.4), 0.95, rand(-0.5, 0.5), 0, false); m.scale.set(1.3, 0.7, 1); }
    chandelier(-23, 0);
    for (const z of [-9.7, 9.7]) for (let i = 0; i < 3; i++) painting(-30 + i * 7, z, z > 0 ? Math.PI : 0, 1.3, 1.6, i + 3);
    fireplace({ p: (lx, lz) => [CX - 33.5 + lz, lx], rot: Math.PI / 2 }, 0, 0, 0);
    pick('mask_joy', 'key:maskJoy', 1, CX - 16, 0.9, 0);
    pick('dining_herb', 'herb', 1, CX - 31, 0.9, 0.3);
  })();
  // Armory
  (function armory() {
    for (let i = 0; i < 4; i++) {
      const [x, z] = at(-32 + i * 5, -21.4);
      box(1.6, 2.2, 0.3, M.darkWood, x, 1.1, z); addBox(x, z, 0.8, 0.15);
      for (let k = 0; k < 4; k++) box(0.05, 1.8, 0.05, M.iron, x - 0.6 + k * 0.4, 1.2, z + 0.2);
    }
    for (const [x, z] of [[-31, -14], [-15, -14]]) {
      const [wx, wz] = at(x, z);
      const g = new THREE.Group();
      const add = (geo, px, py, pz, mat = M.iron) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = true; g.add(m); };
      add(new THREE.CylinderGeometry(0.22, 0.2, 0.7, 10), 0, 1.4, 0); add(new THREE.SphereGeometry(0.15, 10, 8), 0, 1.95, 0); add(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), 0.1, 0.6, 0); add(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 8), -0.1, 0.6, 0);
      g.position.set(wx, 0, wz); curRegion.statics.add(g); addCircle(wx, wz, 0.35);
    }
    const t = (() => { const [x, z] = at(-23, -16); box(2.4, 0.08, 1.0, M.darkWood, x, 0.85, z); addBox(x, z, 1.2, 0.5, 0, { tall: false }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.08, 0.84, 0.08, M.darkWood, x + a * 1.1, 0.42, z + b * 0.42); return { x, z }; })();
    pick('shotgun', 'weapon:shotgun', 1, t.x, 0.92, t.z);
    pick('arm_shells', 'shells', 6, t.x + 0.8, 0.92, t.z);
    pick('cellar_key', 'key:cellar', 1, t.x - 0.8, 0.92, t.z);
    pick('note_armory', 'note:servant', 1, t.x - 0.3, 0.9, t.z + 0.3);
    sconce(-12.3, -16, -Math.PI / 2);
  })();
  // Library: shelves, a fireplace and three busts
  const busts = [];
  (function library() {
    for (let i = 0; i < 8; i++) { shelf({ p: (lx, lz) => [CX + 14 + i * 2.6 + lx, 11.6 + lz], rot: Math.PI }, 0, 0, 0, 2.4); }
    for (let i = 0; i < 8; i++) { shelf({ p: (lx, lz) => [CX + 14 + i * 2.6 + lx, -11.6 + lz], rot: 0 }, 0, 0, 0, 2.4); }
    fireplace({ p: (lx, lz) => [CX + 33.5 - lz, lx], rot: -Math.PI / 2 }, 0, 0, 0);
    const d = (() => { const [x, z] = at(20, 0); box(2, 0.08, 1, M.darkWood, x, 0.8, z); addBox(x, z, 1, 0.5, 0, { tall: false }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.08, 0.8, 0.08, M.darkWood, x + a * 0.9, 0.4, z + b * 0.4); return { x, z }; })();
    candle(d.x + 0.6, 0.84, d.z);
    pick('note_puzzle', 'note:listeners', 1, d.x - 0.2, 0.86, d.z);
    pick('lib_shells', 'shells', 4, d.x + 0.2, 0.86, d.z + 0.2);
    // the three listeners: correct when they face the fireplace (east, +x)
    [[26, -6], [26, 0], [26, 6]].forEach(([x, z], i) => {
      const [wx, wz] = at(x, z);
      cyl(0.3, 0.35, 1.1, 10, M.darkStone, wx, 0.55, wz); addCircle(wx, wz, 0.38);
      const g = new THREE.Group();
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), std({ color: 0xbab2a6, roughness: 0.5 })); head.scale.set(0.85, 1.05, 0.95); head.position.y = 0.32; head.castShadow = true; g.add(head);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 6), head.material); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.3, 0.2); g.add(nose);
      const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.3, 12), head.material); chest.position.y = 0.1; chest.castShadow = true; g.add(chest);
      g.position.set(wx, 1.1, wz);
      curRegion.dynamic.add(g);
      const start = [2, 3, 0][i]; // 0 = facing +z; correct is 1 (facing +x)
      busts.push({ id: 'bust' + i, g, idx: start, x: wx, z: wz });
      interact.push({ id: 'bust' + i, kind: 'bust', x: wx, z: wz, y: 1.4, region: 'castle', label: 'Turn the bust' });
    });
    chandelier(23, 0);
    const [sx, sz] = at(32.8, 0);
    interact.push({ id: 'mantle', kind: 'mantle', x: sx, z: sz, y: 1.5, region: 'castle', label: 'Search the mantle' });
  })();
  // Gallery
  for (let i = 0; i < 4; i++) {
    painting(-3.7, -14 - i * 7, Math.PI / 2, 1.2, 1.6, i + 6);
    painting(3.7, -16 - i * 7, -Math.PI / 2, 1.2, 1.6, i + 9);
    sconce(-3.7, -17.5 - i * 7, Math.PI / 2);
  }
  for (const z of [-20, -36]) { const [x, wz] = at(2.8, z); const g = new THREE.Group(); const m = (geo, y) => { const mm = new THREE.Mesh(geo, M.iron); mm.position.y = y; mm.castShadow = true; g.add(mm); }; m(new THREE.CylinderGeometry(0.22, 0.2, 0.7, 10), 1.4); m(new THREE.SphereGeometry(0.15, 10, 8), 1.95); m(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 8), 0.5); g.position.set(x, 0, wz); curRegion.statics.add(g); addCircle(x, wz, 0.35); }
  pick('gal_herb', 'herb', 1, CX + 2.9, 0.05, -26);
  pick('gal_pearls', 'treasure:pearls', 1, CX - 2.9, 0.05, -38);
  // Servants' quarters: safe room
  (function servants() {
    bed({ p: (lx, lz) => [CX + 6 + lx, -25.5 + lz], rot: 0 }, 0, 0, Math.PI / 2);
    bed({ p: (lx, lz) => [CX + 6 + lx, -19 + lz], rot: 0 }, 0, 0, Math.PI / 2);
    const t = table({ p: (lx, lz) => [CX + 13 + lx, -18 + lz], rot: 0 }, 0, 0, 0, 1.2, 0.7);
    candle(t.x - 0.3, t.y, t.z);
    interact.push({ id: 'ledger_castle', kind: 'ledger', x: t.x, z: t.z, y: 0.9, region: 'castle', label: 'Write in the ledger (save)' });
    interact.push({ id: 'merchant_castle', kind: 'merchant', x: CX + 14.2, z: -25, y: 0, region: 'castle', label: 'Trade with Brask', rot: -Math.PI / 2 });
    fires.push({ x: CX + 10, y: 2.4, z: -22, kind: 'room', region: 'castle' });
    pick('serv_herb', 'herb', 1, t.x + 0.3, t.y + 0.03, t.z);
  })();
  safeZones.push({ region: 'castle', x0: CX + 4, z0: -28, x1: CX + 16, z1: -16 });
  // Chapel
  (function chapel() {
    for (let r = 0; r < 4; r++) for (const s of [-1, 1]) { const [x, z] = at(s * 4.5, -45 - r * 2.4); box(5, 0.08, 0.5, M.darkWood, x, 0.5, z); box(5, 0.7, 0.06, M.darkWood, x, 0.8, z - 0.25); addBox(x, z, 2.5, 0.3, 0, { tall: false }); }
    const [ax, az] = at(0, -55.5); box(3, 1.1, 1.2, M.darkStone, ax, 0.55, az); addBox(ax, az, 1.5, 0.6, 0, { tall: false });
    candle(ax - 1, 1.1, az); candle(ax + 1, 1.1, az);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) mesh(new THREE.PlaneGeometry(1.1, 2.8), M.stained[(i + (s > 0 ? 2 : 0)) % 4], CX + s * 9.74, 3.4, -45.5 - i * 4.5, s > 0 ? -Math.PI / 2 : Math.PI / 2, false);
    pick('note_ilse', 'note:ilse', 1, ax + 0.3, 1.12, az);
    pick('chapel_med', 'medicine', 1, ax - 0.4, 1.12, az);
  })();
  // doors in the castle
  makeDoor({ id: 'c_entrance', x: CX, z: 10, rot: 0, w: 2.5, h: 3.2, kind: 'transition', to: { region: 'village', x: 0, z: -151.5, yaw: Math.PI }, label: 'Castle doors', lock: 'flag:never' });
  makeDoor({ id: 'c_dining', x: CX - 12, z: 0, rot: -Math.PI / 2, w: 1.9, h: 2.5, label: 'Dining hall' });
  makeDoor({ id: 'c_armory', x: CX - 23, z: -10, rot: Math.PI, w: 1.9, h: 2.5, label: 'Armory' });
  makeDoor({ id: 'c_library', x: CX + 12, z: 0, rot: Math.PI / 2, w: 1.9, h: 2.5, label: 'Library' });
  makeDoor({ id: 'c_gallery', x: CX, z: -10, rot: Math.PI, w: 2.3, h: 2.5, label: 'Gallery' });
  makeDoor({ id: 'c_servants', x: CX + 4, z: -22, rot: Math.PI / 2, w: 1.5, h: 2.4, label: 'Servants\' quarters' });
  makeDoor({ id: 'c_cellar', x: CX - 4, z: -30, rot: -Math.PI / 2, w: 1.5, h: 2.4, kind: 'transition', to: { region: 'castle', x: CX + 56, z: -32.5, yaw: 0 }, lock: 'cellar', label: 'Cellar stairs' });
  makeDoor({ id: 'c_chapel', x: CX, z: -42, rot: Math.PI, w: 2.5, h: 2.6, lock: 'masks', label: 'Chapel door', mat: M.bronze });
  makeDoor({ id: 'c_roof', x: CX, z: -58, rot: Math.PI, w: 1.7, h: 2.5, kind: 'transition', to: { region: 'roof', x: RX, z: 22, yaw: 0 }, label: 'Stairs to the roof' });
  // Cellar (a detached space reached by the stairs)
  (function cellar() {
    floorRect(40, -64, 72, -30, M.darkStone, 3);
    wallLine(40, -30, 72, -30, M.darkStone, [{ at: 56, w: 1.6 }]);
    wallLine(40, -64, 72, -64, M.darkStone);
    wallLine(40, -64, 40, -30, M.darkStone); wallLine(72, -64, 72, -30, M.darkStone);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { const [x, z] = at(56 + s * 7, -36 - i * 7); box(1.2, CH, 1.2, M.darkStone, x, CH / 2, z); addBox(x, z, 0.6, 0.6); }
    for (let i = 0; i < 6; i++) { const [x, z] = at(42, -34 - i * 4.8); for (let k = 0; k < 3; k++) cyl(0.4, 0.4, 0.9, 10, M.wood, x + 0.2, 0.5 + k * 0.85, z, true).rotation.x = Math.PI / 2; addBox(x + 0.2, z, 0.45, 1.6); }
    for (let i = 0; i < 3; i++) {
      const [x, z] = at(69, -40 - i * 8);
      for (let k = 0; k < 6; k++) box(0.05, 2.4, 0.05, M.iron, x - 1.4, 1.2, z - 1.25 + k * 0.5);
      box(0.05, 2.4, 2.6, M.iron, x - 1.4, 1.2, z, 0).visible = false;
      addBox(x - 1.4, z, 0.1, 1.3, 0, { tall: false });
      const m = mesh(new THREE.SphereGeometry(0.3, 8, 6), M.meat, x, 0.3, z, 0, true); m.scale.set(1.5, 0.5, 1);
    }
    for (let i = 0; i < 4; i++) { const [x, z] = at(48 + i * 5, -61.5); box(0.9, 0.5, 2.1, M.darkWood, x, 0.25, z); addBox(x, z, 0.45, 1.05, 0, { tall: false }); }
    const [ax, az] = at(56, -61); box(2, 1, 1, M.darkStone, ax, 0.5, az); addBox(ax, az, 1, 0.5, 0, { tall: false });
    candle(ax - 0.7, 1, az); candle(ax + 0.7, 1, az);
    pick('mask_sorrow', 'key:maskSorrow', 1, ax, 1.05, az);
    pick('cel_shells', 'shells', 5, CX + 44, 0.05, -50);
    pick('cel_chalice', 'treasure:chalice', 1, CX + 70, 0.05, -60);
    for (let i = 0; i < 4; i++) { const [x, z] = at(49 + (i % 2) * 14, -40 - Math.floor(i / 2) * 14); fires.push({ x, y: 2.4, z, kind: 'sconce', region: 'castle' }); fire(x, 2.4, z, 'candle'); }
    makeDoor({ id: 'c_cellar_exit', x: CX + 56, z: -30, rot: 0, w: 1.5, h: 2.4, kind: 'transition', to: { region: 'castle', x: CX - 2.5, z: -30, yaw: -Math.PI / 2 }, label: 'Stairs up' });
    crate('cel_c1', CX + 46, -45, 'shells'); crate('cel_c2', CX + 66, -34, 'marks');
    triggers.push({ id: 'cellarScare', region: 'castle', x0: CX + 48, z0: -46, x1: CX + 64, z1: -38 });
  })();
  crate('hall_c1', CX - 10, 8, 'pistolAmmo'); crate('din_c1', CX - 33, 8.5, 'marks'); crate('lib_c1', CX + 32.5, 10, 'pistolAmmo'); crate('arm_c1', CX - 33, -20.5, 'shells');
  triggers.push({ id: 'countessIntro', region: 'castle', x0: CX - 8, z0: -6, x1: CX + 8, z1: 6 });
  spawns.push(
    { id: 'c_maid1', type: 'maiden', x: CX - 28, z: 6, flag: 'maskJoyTaken', state: 'rise' },
    { id: 'c_maid2', type: 'maiden', x: CX - 18, z: -6, flag: 'maskJoyTaken', state: 'rise' },
    { id: 'c_maid3', type: 'maiden', x: CX - 30, z: -6, flag: 'maskJoyTaken', state: 'rise' },
    { id: 'c_maid4', type: 'maiden', x: CX + 20, z: 8, flag: 'countessIntro' },
    { id: 'c_maid5', type: 'maiden', x: CX - 2, z: -34, flag: 'countessIntro' },
    { id: 'c_cel1', type: 'hollowed', x: CX + 50, z: -50 },
    { id: 'c_cel2', type: 'hollowed', x: CX + 62, z: -54 },
    { id: 'c_cel3', type: 'maiden', x: CX + 56, z: -44, state: 'rise', wait: 'cellarScare' },
  );
  const countessPoints = [[CX - 8, 6], [CX + 8, -4], [CX - 26, -6], [CX + 26, 8], [CX + 18, -8], [CX, -20], [CX, -36], [CX - 20, -16]];

  // ===================================================================
  // ROOF (offset to x = 2000)
  // ===================================================================
  curRegion = REGIONS.roof;
  (function roof() {
    const R = 26;
    const g = new THREE.CircleGeometry(R + 2, 64); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (R + 2) / 1.5, uv.getY(i) * (R + 2) / 1.5);
    mesh(g, M.darkStone, RX, 0.01, 0, 0, false);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU, x = RX + Math.sin(a) * (R + 0.5), z = Math.cos(a) * (R + 0.5);
      const m = box(3.6, 1.2, 0.6, M.stone, x, 0.6, z, a + Math.PI / 2); void m;
      if (i % 2 === 0) box(0.8, 0.6, 0.7, M.stone, x, 1.5, z, a + Math.PI / 2);
    }
    for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; addCircle(RX + Math.sin(a) * (R + 0.6), Math.cos(a) * (R + 0.6), 0.9, { tall: false }); }
    for (const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
      cyl(4, 4.4, 22, 16, M.stone, RX + x, 11, z); mesh(new THREE.ConeGeometry(5, 9, 16), M.roof, RX + x, 26.5, z);
      addCircle(RX + x, z, 4.4);
      box(0.15, 2.6, 0.15, M.iron, RX + x * 0.68, 1.3, z * 0.68); fire(RX + x * 0.68, 2.75, z * 0.68, 'lantern');
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.3, r = rand(12, 20), x = RX + Math.sin(a) * r, z = Math.cos(a) * r;
      box(2.4, 1.0, 0.9, std({ color: 0x1a2416, roughness: 1 }), x, 0.5, z, a); addBox(x, z, 1.2, 0.45, a, { tall: false });
    }
    cyl(2.2, 2.4, 0.6, 20, M.stone, RX, 0.3, 0); addCircle(RX, 0, 2.4, { tall: false });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const m = mesh(new THREE.ConeGeometry(0.06, 0.3, 4), M.cloth, RX + Math.sin(a) * 2.1, 0.75, Math.cos(a) * 2.1); m.rotation.x = 0.3; }
    triggers.push({ id: 'roofBoss', region: 'roof', x0: RX - 18, z0: -18, x1: RX + 18, z1: 18 });
  })();

  // ===================================================================
  // Batch statics per region (one mesh per material per 40 m square)
  // ===================================================================
  for (const k in REGIONS) {
    const R = REGIONS[k];
    R.statics.updateMatrixWorld(true);
    const buckets = new Map();
    R.statics.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const key = `${o.material.uuid}|${Math.floor(wp.x / 40)}|${Math.floor(wp.z / 40)}|${o.castShadow ? 1 : 0}`;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, shadow: o.castShadow, list: [] });
      buckets.get(key).list.push(o);
    });
    scene.remove(R.statics);
    const group = new THREE.Group();
    for (const { mat, shadow, list } of buckets.values()) {
      const geos = list.map((m) => {
        const g = m.geometry.clone();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (g.attributes.color) g.deleteAttribute('color');
        g.applyMatrix4(m.matrixWorld);
        return g;
      });
      const merged = G.mergeGeos(geos);
      const mm = new THREE.Mesh(merged, mat);
      mm.castShadow = shadow; mm.receiveShadow = true;
      group.add(mm);
      if (!mat.isMeshBasicMaterial) R.merged.push(mm);
    }
    scene.add(group);
    R.staticGroup = group;
  }
  if (REGIONS.village.terrain) REGIONS.village.merged.push(REGIONS.village.terrain);

  // ===================================================================
  // Navigation grids (for enemies): walkable cells, doors, safe rooms
  // ===================================================================
  const NAV = 0.5;
  for (const k in REGIONS) {
    const R = REGIONS[k];
    const nx = Math.ceil((R.x1 - R.x0) / NAV), nz = Math.ceil((R.z1 - R.z0) / NAV);
    const cells = new Uint8Array(nx * nz); // 0 free, 1 blocked, 2 door, 3 safe room
    const doorAt = new Map();
    const sight = new Uint8Array(nx * nz); // 1 = blocks sight
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = R.x0 + (ix + 0.5) * NAV, z = R.z0 + (iz + 0.5) * NAV, i = iz * nx + ix;
      if (heightAt(x, z) > WALK_H) { cells[i] = 1; sight[i] = 1; continue; }
      let blocked = false, door = null, opaque = false;
      for (const list of nearby(x, z)) for (const c of list) {
        const d = sdf(c, x, z, _dir);
        if (c.door) { if (d < 0.25) door = c.door; continue; }
        if (d < 0.28) blocked = true;
        if (d < 0.25 && c.tall) opaque = true;
      }
      if (blocked) cells[i] = 1;
      else if (door) { cells[i] = 2; doorAt.set(i, door); }
      sight[i] = opaque ? 1 : 0;
    }
    for (const s of safeZones) {
      if (s.region !== k) continue;
      for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
        const x = R.x0 + (ix + 0.5) * NAV, z = R.z0 + (iz + 0.5) * NAV;
        if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && cells[iz * nx + ix] !== 1) cells[iz * nx + ix] = 3;
      }
    }
    R.nav = { nx, nz, cells, sight, doorAt, cell: NAV, dist: new Float32Array(nx * nz).fill(Infinity), touched: [], q: new Int32Array(Math.min(nx * nz, 80000)) };
  }
  function navIndex(R, x, z) {
    const ix = Math.floor((x - R.x0) / NAV), iz = Math.floor((z - R.z0) / NAV);
    if (ix < 0 || iz < 0 || ix >= R.nav.nx || iz >= R.nav.nz) return -1;
    return iz * R.nav.nx + ix;
  }
  // breadth-first flow field from a point (the player) out to maxCells steps
  function flowFrom(R, x, z, maxCells = 70) {
    const nav = R.nav, { nx, nz, cells, dist } = nav;
    for (const i of nav.touched) dist[i] = Infinity;
    nav.touched.length = 0;
    const start = navIndex(R, x, z);
    if (start < 0) return;
    const q = nav.q;
    let h = 0, t = 0;
    dist[start] = 0; nav.touched.push(start); q[t++] = start;
    const sx = start % nx, sz = (start / nx) | 0;
    while (h < t) {
      const i = q[h++], ix = i % nx, iz = (i / nx) | 0, di = dist[i];
      if (Math.abs(ix - sx) > maxCells || Math.abs(iz - sz) > maxCells) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const j = jz * nx + jx;
        if (dist[j] !== Infinity) continue;
        const cj = cells[j];
        if (cj === 1 || cj === 3) continue;
        if (cj === 2) { const d = nav.doorAt.get(j); if (d && d.locked) continue; }
        if (dx && dz && (cells[iz * nx + jx] === 1 || cells[jz * nx + ix] === 1)) continue;
        dist[j] = di + (dx && dz ? 1.414 : 1);
        nav.touched.push(j);
        if (t < q.length) q[t++] = j;
      }
    }
  }
  // the next waypoint toward the flow-field origin
  function flowStep(R, x, z, out) {
    const nav = R.nav, i = navIndex(R, x, z);
    if (i < 0) return false;
    const ix = i % nav.nx, iz = (i / nav.nx) | 0;
    let best = nav.dist[i], bj = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nav.nx || jz >= nav.nz) continue;
      const j = jz * nav.nx + jx;
      if (nav.dist[j] < best) { best = nav.dist[j]; bj = j; }
    }
    if (bj < 0) return false;
    out.x = R.x0 + ((bj % nav.nx) + 0.5) * NAV; out.z = R.z0 + (((bj / nav.nx) | 0) + 0.5) * NAV;
    return true;
  }
  function lineOfSight(R, x1, z1, x2, z2) {
    const nav = R.nav, d = Math.hypot(x2 - x1, z2 - z1), n = Math.ceil(d / 0.3);
    for (let k = 1; k < n; k++) {
      const t = k / n, i = navIndex(R, lerp(x1, x2, t), lerp(z1, z2, t));
      if (i < 0) return false;
      if (nav.sight[i]) return false;
      if (nav.cells[i] === 2) { const dd = nav.doorAt.get(i); if (dd && !dd.open) return false; }
    }
    return true;
  }
  function inSafe(region, x, z) {
    return safeZones.some((s) => s.region === region && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);
  }

  // ===================================================================
  // Lights, snow, per-frame updates
  // ===================================================================
  const moon = new THREE.DirectionalLight(0x8ea4d8, 0.35);
  moon.castShadow = true;
  moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03;
  scene.add(moon, moon.target);
  const hemi = new THREE.HemisphereLight(0x2a3450, 0x0a0806, 0.25);
  scene.add(hemi);
  function shadowQuality(high) {
    const s = high ? 2048 : 1024;
    moon.shadow.mapSize.set(s, s);
    Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 200 });
    moon.shadow.camera.updateProjectionMatrix();
    if (moon.shadow.map) { moon.shadow.map.dispose(); moon.shadow.map = null; }
  }
  shadowQuality(G.settings.quality === 'high');
  G.onQuality(shadowQuality);
  const lightPool = [0, 1, 2, 3, 4].map(() => { const l = new THREE.PointLight(0xff9a50, 0, 14, 2); scene.add(l); return l; });
  const FIRE_LIGHT = { lantern: [0xffa050, 1.6, 13], fire: [0xff7a30, 2.8, 15], candle: [0xffb060, 0.6, 6], room: [0xffa060, 1.3, 10], chandelier: [0xffb060, 3.2, 20], sconce: [0xffa050, 1.3, 10], headlight: [0xfff0d0, 1.4, 14] };
  const snow = (() => {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-25, 25); pos[i * 3 + 1] = rand(0, 18); pos[i * 3 + 2] = rand(-25, 25); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.06, color: 0xc8d0e0, transparent: true, opacity: 0.8, depthWrite: false }));
    pts.frustumCulled = false; scene.add(pts);
    return { pts, pos, n, geo };
  })();
  let lightT = 0, active = 'village';
  function setRegion(k) {
    active = k;
    for (const r in REGIONS) {
      const on = r === k;
      REGIONS[r].staticGroup.visible = on;
      REGIONS[r].dynamic.visible = on;
    }
    G.setAtmosphere(REGIONS[k].atmo);
    moon.intensity = REGIONS[k].snow ? 0.35 : 0;
    hemi.intensity = REGIONS[k].snow ? 0.3 : 0.4;
    hemi.color.setHex(REGIONS[k].snow ? 0x2a3450 : 0x4a3424);
    snow.pts.visible = REGIONS[k].snow;
    lightT = 0;
  }
  const sOff = V3();
  function update(dt, t, cam) {
    const px = cam.position.x, pz = cam.position.z;
    // moonlight shadows follow the player
    const texel = 60 / moon.shadow.mapSize.x;
    const sx = Math.round(px / texel) * texel, sz = Math.round(pz / texel) * texel;
    sOff.copy(G.sky.moonDir).multiplyScalar(80);
    moon.target.position.set(sx, 0, sz); moon.position.set(sx + sOff.x, sOff.y, sz + sOff.z);
    G.sky.mesh.position.copy(cam.position);
    // nearest flames get the real lights
    lightT -= dt;
    if (lightT <= 0) {
      lightT = 0.25;
      // brighter sources win over nearer candles
      const near = fires.filter((f) => f.region === active)
        .map((f) => { const d2 = (f.x - px) ** 2 + (f.z - pz) ** 2; return [f, d2, d2 / (FIRE_LIGHT[f.kind] || FIRE_LIGHT.lantern)[1]]; })
        .sort((a, b) => a[2] - b[2]).slice(0, lightPool.length);
      lightPool.forEach((l, i) => {
        const f = near[i];
        if (f && f[1] < 50 * 50) { const s = FIRE_LIGHT[f[0].kind] || FIRE_LIGHT.lantern; l.position.set(f[0].x, f[0].y + 0.1, f[0].z); l.color.setHex(s[0]); l.userData.base = s[1]; l.distance = s[2]; }
        else l.userData.base = 0;
      });
    }
    lightPool.forEach((l, i) => { l.intensity = (l.userData.base || 0) * (0.85 + Math.sin(t * 11 + i * 3) * 0.08 + Math.sin(t * 27 + i) * 0.07); });
    // snow drifts down around the camera
    if (snow.pts.visible) {
      const p = snow.pos;
      for (let i = 0; i < snow.n; i++) {
        p[i * 3 + 1] -= dt * (0.9 + (i % 7) * 0.12);
        p[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.3;
        if (p[i * 3 + 1] < 0) { p[i * 3 + 1] += 18; p[i * 3] = rand(-25, 25); p[i * 3 + 2] = rand(-25, 25); }
      }
      snow.pts.position.set(px, cam.position.y - 6, pz);
      snow.geo.attributes.position.needsUpdate = true;
    }
    if (REGIONS.village.sails && active === 'village') REGIONS.village.sails.rotation.z += dt * 0.15;
  }

  G.level = {
    REGIONS, CX, RX, regionOf, heightAt, WALK_H, M, T,
    colliders: { addBox, addCircle, push, blockedAt, sdf },
    doors, pickups, crates, interact, triggers, spawns, safeZones, busts, countessPoints,
    gate, fires, nav: { flowFrom, flowStep, lineOfSight, navIndex }, inSafe, setRegion, update, roadX,
    get active() { return active; },
  };
  G.linearize(scene);
  G.buildEnvironment();
})();
