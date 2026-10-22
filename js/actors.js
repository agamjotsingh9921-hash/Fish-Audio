/* Wrath of Olympus — characters.
   Smooth procedural rigs: the Spartan, his son Atreus, and the creatures of Tartarus.
   Every rig keeps the same bone names so one set of animation code drives them all. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, rand } = G.util;

  const SPH = new THREE.SphereGeometry(1, 18, 14);
  const geoCache = new Map();
  function cyl(r1, r2, len, seg = 12, open = false) {
    const key = `${r1.toFixed(3)}|${r2.toFixed(3)}|${len.toFixed(3)}|${seg}|${open}`;
    if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(r1, r2, len, seg, 1, open));
    return geoCache.get(key);
  }
  const std = (color, rough = 0.6, metal = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  function mesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  const ell = (rx, ry, rz, mat, x, y, z, parent) => { const m = mesh(SPH, mat, x, y, z, parent); m.scale.set(rx, ry, rz); return m; };
  // a tapered limb hanging down from y0
  const limb = (r1, r2, len, mat, parent, y0 = 0) => mesh(cyl(r1, r2, len), mat, 0, y0 - len / 2, 0, parent);
  // a painted band (tattoo) following an ellipse in the y-z plane
  // (width is the stripe's width along x; the radial thickness stays thin)
  function band(ry, rz, arc, width, mat, x, y, z, parent, start = 0) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 5, 40, arc), mat);
    m.rotation.set(0, Math.PI / 2, 0);
    m.rotateZ(start);
    m.scale.set(rz, ry, width / 0.06);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // Merge each bone's static meshes per material, so a character costs a few dozen
  // draw calls instead of a hundred.
  function bake(root) {
    const groups = [];
    root.traverse((o) => { if (o.isGroup || o === root) groups.push(o); });
    for (const g of groups) {
      const byMat = new Map();
      for (const c of g.children) {
        if (!c.isMesh || c.userData.keep || c.children.length) continue;
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(c);
      }
      for (const [mat, list] of byMat) {
        if (list.length < 2) continue;
        const geos = list.map((m) => {
          m.updateMatrix();
          const gg = m.geometry.clone();
          gg.deleteAttribute('uv');
          gg.applyMatrix4(m.matrix);
          return gg;
        });
        const merged = G.mergeGeos(geos);
        merged.deleteAttribute('color');
        merged.computeBoundingSphere();
        const mm = new THREE.Mesh(merged, mat);
        mm.castShadow = true;
        list.forEach((m) => g.remove(m));
        g.add(mm);
      }
    }
  }

  // ===================================================================
  // Humanoid
  // ===================================================================
  function humanoid(o) {
    const b = o.bulk || 1;
    const mats = {
      skin: o.skinMat || std(o.skin, o.skinRough || 0.55),
      cloth: std(o.cloth, 0.92, 0, { side: THREE.DoubleSide }),
      metal: std(o.metal, 0.32, 0.9),
      leather: std(o.leather || 0x2a1810, 0.7),
      eye: o.eyeMat || std(0x140c08, 0.2),
    };
    const S = mats.skin;
    const body = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 1.02; body.add(hips);
    ell(0.19 * b, 0.13, 0.13 * b, S, 0, 0.02, 0, hips);
    mesh(cyl(0.21 * b, 0.33 * b, 0.42, 18, true), mats.cloth, 0, -0.15, 0, hips);
    mesh(cyl(0.215 * b, 0.215 * b, 0.08, 18), mats.metal, 0, 0.07, 0, hips);
    const torso = new THREE.Group(); torso.position.y = 0.1; hips.add(torso);
    ell(0.175 * b, 0.2, 0.13 * b, S, 0, 0.13, 0.005, torso);
    const chest = ell(0.27 * b, 0.22, 0.165 * b, S, 0, 0.4, 0, torso);
    for (const s of [-1, 1]) ell(0.115 * b, 0.085, 0.065 * b, S, s * 0.1 * b, 0.42, 0.11 * b, torso);
    ell(0.25 * b, 0.09, 0.12 * b, S, 0, 0.57, -0.01, torso);
    const neck = new THREE.Group(); neck.position.y = 0.62; torso.add(neck);
    mesh(cyl(0.068 * Math.min(b, 1.3), 0.078 * Math.min(b, 1.3), 0.16), S, 0, 0.04, 0, neck);
    const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
    ell(0.115, 0.14, 0.13, S, 0, 0.02, 0, head);
    ell(0.095, 0.075, 0.1, S, 0, -0.065, 0.025, head);
    ell(0.022, 0.036, 0.032, S, 0, -0.01, 0.128, head);
    ell(0.1, 0.026, 0.045, S, 0, 0.042, 0.1, head);
    for (const s of [-1, 1]) {
      ell(0.016, 0.014, 0.01, mats.eye, s * 0.043, 0.016, 0.115, head);
      ell(0.018, 0.034, 0.03, S, s * 0.115, 0.0, -0.005, head);
    }
    const arms = [], legs = [];
    for (const s of [-1, 1]) { // s = -1 is the character's right side (they face +z)
      const sh = new THREE.Group(); sh.position.set(s * 0.31 * b, 0.52, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
      ell(0.1 * b, 0.1, 0.1 * b, S, 0, -0.02, 0, sh);
      limb(0.078 * b, 0.063 * b, 0.3, S, sh, -0.02);
      const el = new THREE.Group(); el.position.y = -0.31; sh.add(el);
      ell(0.058 * b, 0.058, 0.058 * b, S, 0, 0, 0, el);
      limb(0.062 * b, 0.045 * b, 0.27, S, el, 0);
      mesh(cyl(0.07 * b, 0.058 * b, 0.15), mats.metal, 0, -0.17, 0, el);
      const hand = new THREE.Group(); hand.position.y = -0.29; el.add(hand);
      ell(0.042, 0.055, 0.034, S, 0, -0.03, 0, hand);
      arms.push({ sh, el, hand, s });
      const hp = new THREE.Group(); hp.position.set(s * 0.11 * b, -0.04, 0); hips.add(hp);
      limb(0.105 * b, 0.075 * b, 0.46, S, hp, 0);
      const kn = new THREE.Group(); kn.position.y = -0.46; hp.add(kn);
      ell(0.064 * b, 0.07, 0.07 * b, S, 0, 0, 0.012, kn);
      limb(0.068 * b, 0.047 * b, 0.43, S, kn, 0);
      ell(0.058 * b, 0.12, 0.06 * b, S, 0, -0.14, -0.028, kn);
      mesh(cyl(0.073 * b, 0.056 * b, 0.26), mats.metal, 0, -0.21, 0.004, kn);
      ell(0.052, 0.036, 0.118, mats.leather, 0, -0.45, 0.05, kn);
      legs.push({ hp, kn, s });
    }
    return { body, hips, torso, chest, neck, head, arms, legs, mats, baseHip: 1.02 };
  }
  function makeRig(h, scale, pivotY = 1) {
    const root = new THREE.Group(), rig = new THREE.Group();
    rig.position.y = pivotY * scale;
    rig.scale.setScalar(scale);
    h.body.position.y = -pivotY;
    rig.add(h.body);
    root.add(rig);
    return { root, rig };
  }
  function resetPose(h) {
    h.hips.position.y = h.baseHip;
    h.hips.rotation.set(0, 0, 0);
    h.torso.rotation.set(0, 0, 0);
    h.neck.rotation.set(0, 0, 0);
    for (const a of h.arms) { a.sh.rotation.set(0, 0, a.s * 0.1); a.el.rotation.set(-0.15, 0, 0); }
    for (const l of h.legs) { l.hp.rotation.set(0, 0, 0); l.kn.rotation.set(0, 0, 0); }
  }
  function poseWalk(h, ph, amt, run = 0) {
    const sw = Math.sin(ph) * amt;
    const stride = 0.7 + run * 0.35;
    h.legs[0].hp.rotation.x = -sw * stride;
    h.legs[1].hp.rotation.x = sw * stride;
    h.legs[0].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4)) * (1 + run * 0.6)) * amt;
    h.legs[1].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * (1 + run * 0.6)) * amt;
    h.arms[0].sh.rotation.x = sw * (0.55 + run * 0.4);
    h.arms[1].sh.rotation.x = -sw * (0.55 + run * 0.4);
    h.arms[0].el.rotation.x = -0.3 - run * 0.9 * amt;
    h.arms[1].el.rotation.x = -0.3 - run * 0.9 * amt;
    h.hips.position.y = h.baseHip + Math.abs(Math.cos(ph)) * 0.06 * amt;
    h.torso.rotation.x = (0.1 + run * 0.2) * amt;
    h.torso.rotation.y = -sw * 0.12;
  }

  // ===================================================================
  // The Spartan
  // ===================================================================
  function buildSpartan() {
    const h = humanoid({ skin: 0xd0c8bc, cloth: 0x4e140c, metal: 0x9a7a40, bulk: 1.12, skinRough: 0.5 });
    const tat = std(0x7a0a0d, 0.6);
    const beard = std(0x1c120c, 0.95);
    const b = 1.12;
    // the red tattoo: over the scalp and eye, down the torso, round the left arm
    band(0.137, 0.127, Math.PI + 0.9, 0.05, tat, 0.035, 0.022, 0, h.head, -0.45);
    band(0.207, 0.157, TAU, 0.075, tat, 0.12 * b, 0.4, 0, h.torso);
    band(0.192, 0.122, TAU, 0.065, tat, 0.08 * b, 0.13, 0.004, h.torso);
    for (const y of [-0.1, -0.2]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.075 * b, 0.012, 5, 20), tat);
      r.rotation.x = Math.PI / 2; r.position.y = y; h.arms[1].sh.add(r);
    }
    ell(0.088, 0.075, 0.065, beard, 0, -0.105, 0.072, h.head);
    ell(0.05, 0.016, 0.022, beard, 0, -0.048, 0.118, h.head);
    // left pauldron and chest strap
    const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI * 0.45), h.mats.metal);
    pad.scale.set(0.15 * b, 0.12, 0.15 * b); pad.position.set(0.02, 0.0, 0); pad.rotation.z = -0.35; pad.castShadow = true;
    h.arms[1].sh.add(pad);
    const strap = mesh(new THREE.BoxGeometry(0.06, 0.62, 0.03), h.mats.leather, -0.02, 0.38, 0.185 * b, h.torso);
    strap.rotation.z = 0.62;
    const strapB = mesh(new THREE.BoxGeometry(0.06, 0.62, 0.03), h.mats.leather, -0.02, 0.38, -0.18 * b, h.torso);
    strapB.rotation.z = 0.62;
    for (let i = 0; i < 5; i++) {
      const a = -0.6 + i * 0.3;
      const t = mesh(new THREE.BoxGeometry(0.1, 0.24, 0.02), h.mats.leather, Math.sin(a) * 0.3, -0.2, Math.cos(a) * 0.3, h.hips);
      t.rotation.y = a; t.rotation.x = -0.12;
    }
    mesh(new THREE.BoxGeometry(0.14, 0.12, 0.04), std(0xc9a040, 0.3, 1), 0, 0.07, 0.22 * b, h.hips);
    bake(h.body);
    return h;
  }

  // ===================================================================
  // Atreus
  // ===================================================================
  function buildAtreus() {
    const h = humanoid({ skin: 0xd9a483, cloth: 0x3a4426, metal: 0x5a4028, leather: 0x3a2414, bulk: 0.84 });
    const tunic = std(0x4a3a22, 0.95);
    const hair = std(0x3a2414, 0.9);
    ell(0.29 * 0.84, 0.25, 0.185 * 0.84, tunic, 0, 0.38, 0, h.torso);
    ell(0.2 * 0.84, 0.22, 0.145 * 0.84, tunic, 0, 0.13, 0.004, h.torso);
    for (const a of h.arms) ell(0.09, 0.15, 0.09, tunic, 0, -0.1, 0, a.sh);
    ell(0.126, 0.115, 0.137, hair, 0, 0.055, -0.012, h.head);
    ell(0.05, 0.11, 0.04, hair, 0, -0.04, -0.12, h.head);
    // quiver
    const quiver = new THREE.Group(); quiver.position.set(0.09, 0.42, -0.19); quiver.rotation.z = -0.35; h.torso.add(quiver);
    mesh(cyl(0.065, 0.055, 0.5), h.mats.leather, 0, 0, 0, quiver);
    const fl = std(0x7a1810, 0.9);
    for (let i = 0; i < 4; i++) {
      mesh(cyl(0.006, 0.006, 0.18, 4), std(0x6a5030), (i - 1.5) * 0.025, 0.32, 0, quiver);
      mesh(new THREE.BoxGeometry(0.03, 0.08, 0.003), fl, (i - 1.5) * 0.025, 0.36, 0, quiver);
    }
    mesh(new THREE.BoxGeometry(0.05, 0.5, 0.025), h.mats.leather, 0, 0.4, 0.165 * 0.84, h.torso).rotation.z = -0.6;
    bake(h.body);
    // bow, held in the left hand; limbs curve back toward him
    const bowMat = std(0x4a2a14, 0.6);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.11, 0.5), new THREE.Vector3(0, 0.02, 0.3), new THREE.Vector3(0, -0.035, 0),
      new THREE.Vector3(0, 0.02, -0.3), new THREE.Vector3(0, 0.11, -0.5),
    ]);
    const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.016, 6, false), bowMat);
    bow.castShadow = true;
    h.arms[1].hand.add(bow);
    const spos = new Float32Array(9);
    const sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    const string = new THREE.Line(sgeo, new THREE.LineBasicMaterial({ color: 0xd8ccb0 }));
    string.frustumCulled = false;
    h.arms[1].hand.add(string);
    h.bow = { bow, string, spos };
    return h;
  }

  // ===================================================================
  // Weapons
  // ===================================================================
  function buildBlade() {
    const g = new THREE.Group();
    mesh(new THREE.BoxGeometry(0.06, 0.06, 0.28), std(0x2a1a10, 0.8), 0, 0, 0.04, g);
    mesh(new THREE.BoxGeometry(0.26, 0.05, 0.07), std(0xa08040, 0.3, 1), 0, 0, 0.2, g);
    const mat = new THREE.MeshStandardMaterial({ color: 0xa8a29a, metalness: 1, roughness: 0.22, emissive: 0xff3a08, emissiveIntensity: 0.35 });
    const blade = mesh(new THREE.CylinderGeometry(0.075, 0.015, 0.95, 4), mat, 0, 0, 0.7, g);
    blade.rotation.x = Math.PI / 2; blade.scale.set(1, 1, 0.3);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 1.2, 0.3) }));
    edge.position.set(0.07, 0, 0.62); edge.rotation.y = -0.07; g.add(edge);
    const edge2 = edge.clone(); edge2.position.x = -0.07; edge2.rotation.y = 0.07; g.add(edge2);
    return { g, mat, edgeMat: edge.material };
  }
  const arrowGeo = (() => {
    const shaft = new THREE.CylinderGeometry(0.008, 0.008, 0.75, 4).rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.022, 0.08, 4).rotateX(Math.PI / 2).translate(0, 0, 0.41);
    const f1 = new THREE.BoxGeometry(0.003, 0.05, 0.1).translate(0, 0, -0.33);
    const f2 = new THREE.BoxGeometry(0.05, 0.003, 0.1).translate(0, 0, -0.33);
    return G.mergeGeos([shaft, head, f1, f2]);
  })();
  const arrowMat = std(0x7a5a38, 0.7);
  const chargedArrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 4.0) });
  function buildArrow(charged) {
    const m = new THREE.Mesh(arrowGeo, charged ? chargedArrowMat : arrowMat);
    m.castShadow = false;
    return m;
  }

  // ===================================================================
  // Enemies
  // ===================================================================
  const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
  function buildLegion() {
    const h = humanoid({ skin: 0x56604a, cloth: 0x3b2418, metal: 0x8a6428, bulk: 1, skinRough: 0.85, eyeMat: glow(1.2, 3.2, 0.9) });
    const crest = std(0x6a0c08, 0.95);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI * 0.55), h.mats.metal);
    helm.scale.set(0.135, 0.165, 0.15); helm.position.y = 0.01; helm.castShadow = true; h.head.add(helm);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.02, 0.1, 0.08), h.mats.metal, s * 0.11, -0.06, 0.06, h.head);
    for (let i = 0; i < 9; i++) mesh(new THREE.BoxGeometry(0.03, 0.08 + Math.sin((i / 8) * Math.PI) * 0.1, 0.035), crest, 0, 0.17 + Math.sin((i / 8) * Math.PI) * 0.05, -0.14 + i * 0.035, h.head);
    ell(0.285, 0.235, 0.18, h.mats.metal, 0, 0.4, 0, h.torso);
    // gladius along the arm (local -y of the hand)
    mesh(new THREE.BoxGeometry(0.2, 0.04, 0.06), h.mats.metal, 0, -0.08, 0, h.arms[0].hand);
    const sword = mesh(new THREE.CylinderGeometry(0.04, 0.01, 0.7, 4), std(0xb0aaa0, 0.3, 1), 0, -0.45, 0, h.arms[0].hand);
    sword.scale.z = 0.3;
    const shield = mesh(cyl(0.38, 0.38, 0.05, 22), h.mats.metal, 0.12, -0.15, 0, h.arms[1].el);
    shield.rotation.z = Math.PI / 2;
    const boss = mesh(new THREE.SphereGeometry(0.08, 10, 8), h.mats.metal, 0.15, -0.15, 0, h.arms[1].el);
    boss.scale.x = 0.6;
    bake(h.body);
    return { h, ...makeRig(h, 1, 0.97) };
  }
  function buildHarpy() {
    const body = new THREE.Group();
    const skin = std(0x8a7a80, 0.6), feather = std(0x2a1a2a, 0.85, 0, { side: THREE.DoubleSide }), dark = std(0x140c10, 0.8);
    const mats = { skin, cloth: feather, metal: dark };
    const torso = new THREE.Group(); torso.position.y = 0.6; body.add(torso);
    ell(0.2, 0.3, 0.15, skin, 0, 0, 0, torso);
    ell(0.22, 0.2, 0.18, feather, 0, -0.25, 0, torso);
    const head = new THREE.Group(); head.position.set(0, 0.42, 0.04); torso.add(head);
    ell(0.1, 0.12, 0.11, skin, 0, 0, 0, head);
    ell(0.13, 0.13, 0.14, dark, 0, 0.03, -0.04, head);
    const hairTail = ell(0.06, 0.22, 0.05, dark, 0, -0.1, -0.12, head);
    hairTail.rotation.x = 0.4;
    for (const s of [-1, 1]) ell(0.016, 0.01, 0.01, glow(3, 2.4, 0.4), s * 0.04, 0.015, 0.1, head);
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.16, 0.2, -0.04); torso.add(w);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(1.1, 0.25); shape.lineTo(1.0, -0.15); shape.lineTo(0.75, -0.35); shape.lineTo(0.45, -0.3); shape.lineTo(0.2, -0.2); shape.lineTo(0, -0.1);
      const wg = new THREE.ShapeGeometry(shape);
      if (s < 0) wg.scale(-1, 1, 1);
      wg.rotateX(-Math.PI / 2);
      const inner = mesh(wg, feather, 0, 0, 0, w);
      const tip = new THREE.Group(); tip.position.x = s * 1.0; w.add(tip);
      const tg = new THREE.ShapeGeometry(shape);
      tg.scale(s * 0.8, 0.8, 0.8); tg.rotateX(-Math.PI / 2);
      mesh(tg, feather, 0, 0, 0, tip);
      wings.push({ w, tip, s, inner });
      const leg = new THREE.Group(); leg.position.set(s * 0.09, -0.35, 0); torso.add(leg);
      limb(0.035, 0.022, 0.4, dark, leg, 0);
      for (let k = -1; k <= 1; k++) {
        const t = mesh(new THREE.ConeGeometry(0.012, 0.09, 4), std(0xd8c8a0, 0.5), k * 0.025, -0.42, 0.04, leg);
        t.rotation.x = 1.4;
      }
    }
    const h = { body, torso, head, wings, mats };
    return { h, ...makeRig(h, 1.15, 0.6) };
  }
  function buildHound() {
    const body = new THREE.Group();
    const skin = std(0x1e1512, 0.75), crack = glow(3.5, 0.9, 0.15), bone = std(0xd8ccb0, 0.5);
    const mats = { skin, cloth: skin, metal: skin };
    const torso = new THREE.Group(); torso.position.y = 0.82; body.add(torso);
    ell(0.27, 0.28, 0.62, skin, 0, 0, -0.05, torso);
    ell(0.31, 0.33, 0.36, skin, 0, 0.04, 0.32, torso);
    for (let i = 0; i < 5; i++) ell(0.035, 0.02, 0.07, crack, 0, 0.29 - i * 0.012, 0.3 - i * 0.2, torso);
    const neck = new THREE.Group(); neck.position.set(0, 0.12, 0.55); torso.add(neck);
    ell(0.16, 0.18, 0.26, skin, 0, 0.05, 0.12, neck);
    const head = new THREE.Group(); head.position.set(0, 0.12, 0.34); neck.add(head);
    ell(0.15, 0.14, 0.17, skin, 0, 0, 0, head);
    ell(0.085, 0.075, 0.17, skin, 0, -0.03, 0.17, head);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.08, 0.04); head.add(jaw);
    ell(0.075, 0.035, 0.16, skin, 0, 0, 0.12, jaw);
    for (const s of [-1, 1]) {
      ell(0.022, 0.016, 0.016, glow(4, 1.4, 0.2), s * 0.075, 0.035, 0.13, head);
      const ear = mesh(new THREE.ConeGeometry(0.04, 0.14, 5), skin, s * 0.08, 0.13, -0.04, head);
      ear.rotation.z = -s * 0.3;
      for (let k = 0; k < 3; k++) mesh(new THREE.ConeGeometry(0.008, 0.03, 4), bone, s * (0.03 + k * 0.015), -0.07, 0.26 - k * 0.04, head).rotation.x = Math.PI;
    }
    const legs = [];
    for (const [s, f] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const hp = new THREE.Group(); hp.position.set(s * 0.18, -0.08, f > 0 ? 0.36 : -0.42); torso.add(hp);
      ell(0.1, 0.14, 0.12, skin, 0, -0.04, 0, hp);
      limb(0.075, 0.05, 0.4, skin, hp, 0);
      const kn = new THREE.Group(); kn.position.y = -0.4; hp.add(kn);
      limb(0.045, 0.035, 0.34, skin, kn, 0);
      ell(0.055, 0.035, 0.08, skin, 0, -0.35, 0.03, kn);
      legs.push({ hp, kn, s, f });
    }
    const tail = new THREE.Group(); tail.position.set(0, 0.1, -0.66); torso.add(tail);
    const tl = limb(0.04, 0.012, 0.55, skin, tail, 0);
    tl.material = skin;
    bake(body);
    const h = { body, torso, neck, head, jaw, legs, tail, mats };
    return { h, ...makeRig(h, 1.05, 0) };
  }
  function buildMinotaur() {
    const h = humanoid({ skin: 0x3e261a, cloth: 0x22140c, metal: 0x5a4a32, bulk: 1.5, skinRough: 0.8, eyeMat: glow(4, 0.8, 0.2) });
    const fur = std(0x221410, 0.95), horn = std(0xd8ccb0, 0.45);
    ell(0.1, 0.085, 0.13, h.mats.skin, 0, -0.05, 0.12, h.head);
    for (const s of [-1, 1]) {
      const hr = mesh(new THREE.ConeGeometry(0.035, 0.32, 8), horn, s * 0.15, 0.1, 0, h.head);
      hr.rotation.z = -s * 1.2;
      ell(0.2, 0.15, 0.2, fur, s * 0.42, 0.62, 0, h.torso);
    }
    ell(0.3, 0.14, 0.22, fur, 0, 0.66, -0.04, h.torso);
    mesh(new THREE.TorusGeometry(0.03, 0.008, 4, 10), std(0xc9a040, 0.3, 1), 0, -0.11, 0.24, h.head);
    mesh(cyl(0.022, 0.022, 1.6, 6), std(0x3a2618, 0.8), 0, -0.6, 0, h.arms[0].hand);
    const axe = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 3, 1), std(0x9a9590, 0.3, 1), 0, -1.2, 0.18, h.arms[0].hand);
    axe.rotation.x = Math.PI / 2; axe.scale.set(1, 1, 1.3);
    bake(h.body);
    return { h, ...makeRig(h, 1.42, 0.97) };
  }
  function buildCyclops() {
    const h = humanoid({ skin: 0x8a6a52, cloth: 0x3a2416, metal: 0x4a3a2a, bulk: 1.65, skinRough: 0.7 });
    ell(0.3, 0.26, 0.24, h.mats.skin, 0, 0.18, 0.08, h.torso);
    ell(0.06, 0.06, 0.04, std(0xf0e8d8, 0.25), 0, 0.03, 0.12, h.head);
    const iris = ell(0.028, 0.028, 0.02, glow(4, 0.7, 0.2), 0, 0.03, 0.148, h.head);
    iris.userData.keep = true;
    mesh(new THREE.ConeGeometry(0.03, 0.12, 7), std(0xd8c8a8, 0.5), 0, 0.17, 0, h.head);
    mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), std(0xe8dcc0, 0.4), 0, -0.1, 0.11, h.head);
    mesh(cyl(0.06, 0.18, 2.0, 10), std(0x4a3020, 0.9), 0, -1.0, 0, h.arms[0].hand);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const sp = mesh(new THREE.ConeGeometry(0.025, 0.1, 4), std(0x9a9590, 0.35, 1), Math.sin(a) * 0.17, -1.45 - (k % 3) * 0.18, Math.cos(a) * 0.17, h.arms[0].hand);
      sp.rotation.set(Math.cos(a) * 1.57, 0, -Math.sin(a) * 1.57);
    }
    bake(h.body);
    h.iris = iris;
    return { h, ...makeRig(h, 3.1, 0.97) };
  }

  G.actors = {
    humanoid, makeRig, resetPose, poseWalk, bake,
    buildSpartan, buildAtreus, buildBlade, buildArrow,
    BUILDERS: { legion: buildLegion, harpy: buildHarpy, hound: buildHound, minotaur: buildMinotaur, cyclops: buildCyclops },
    rand,
  };
})();
