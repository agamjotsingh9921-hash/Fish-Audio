/* Ashes of Varkova — creatures and models.
   Smooth procedural rigs for every monster, the merchant, item pickups and the
   first-person weapons. Rigs share bone names so one animation toolkit drives them. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, rand } = G.util;

  const SPH = new THREE.SphereGeometry(1, 18, 14);
  const cache = new Map();
  function cyl(r1, r2, len, seg = 12, open = false) {
    const k = `${r1.toFixed(3)}|${r2.toFixed(3)}|${len.toFixed(3)}|${seg}|${open}`;
    if (!cache.has(k)) cache.set(k, new THREE.CylinderGeometry(r1, r2, len, seg, 1, open));
    return cache.get(k);
  }
  const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
  function mesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    if (parent) parent.add(m);
    return m;
  }
  const ell = (rx, ry, rz, mat, x, y, z, parent) => { const m = mesh(SPH, mat, x, y, z, parent); m.scale.set(rx, ry, rz); return m; };
  const limb = (r1, r2, len, mat, parent, y0 = 0) => mesh(cyl(r1, r2, len), mat, 0, y0 - len / 2, 0, parent);

  // merge each bone's static meshes per material to keep draw calls low
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
        const geos = list.map((m) => { m.updateMatrix(); const gg = m.geometry.clone(); gg.deleteAttribute('uv'); gg.applyMatrix4(m.matrix); return gg; });
        const merged = G.mergeGeos(geos);
        if (merged.attributes.color) merged.deleteAttribute('color');
        const mm = new THREE.Mesh(merged, mat);
        mm.castShadow = true;
        list.forEach((m) => g.remove(m));
        g.add(mm);
      }
    }
  }

  // ===================================================================
  // Humanoid rig
  // ===================================================================
  function humanoid(o) {
    const b = o.bulk || 1;
    const mats = {
      skin: o.skinMat || std(o.skin, o.skinRough || 0.6),
      cloth: std(o.cloth, 0.95, 0, { side: THREE.DoubleSide }),
      metal: std(o.metal || 0x2a2826, 0.4, 0.8),
      leather: std(o.leather || 0x1e140e, 0.75),
      eye: o.eyeMat || std(0x0a0606, 0.2),
    };
    const S = mats.skin;
    const body = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 1.02; body.add(hips);
    ell(0.19 * b, 0.13, 0.13 * b, S, 0, 0.02, 0, hips);
    if (!o.noKilt) mesh(cyl(0.21 * b, 0.3 * b, 0.36, 16, true), mats.cloth, 0, -0.12, 0, hips);
    const torso = new THREE.Group(); torso.position.y = 0.1; hips.add(torso);
    ell(0.175 * b, 0.2, 0.13 * b, S, 0, 0.13, 0.005, torso);
    const chest = ell(0.26 * b, 0.22, 0.16 * b, S, 0, 0.4, 0, torso);
    ell(0.24 * b, 0.09, 0.12 * b, S, 0, 0.57, -0.01, torso);
    const neck = new THREE.Group(); neck.position.y = 0.62; torso.add(neck);
    mesh(cyl(0.065 * Math.min(b, 1.3), 0.075 * Math.min(b, 1.3), 0.16), S, 0, 0.04, 0, neck);
    const head = new THREE.Group(); head.position.y = 0.17; neck.add(head);
    if (!o.noHead) {
      ell(0.112, 0.138, 0.128, S, 0, 0.02, 0, head);
      ell(0.092, 0.072, 0.098, S, 0, -0.065, 0.025, head);
      ell(0.02, 0.034, 0.03, S, 0, -0.01, 0.126, head);
      for (const s of [-1, 1]) ell(0.015, 0.013, 0.01, mats.eye, s * 0.042, 0.016, 0.113, head);
    }
    const arms = [], legs = [];
    const al = o.armLen || 1;
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.3 * b, 0.52, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
      ell(0.095 * b, 0.095, 0.095 * b, S, 0, -0.02, 0, sh);
      limb(0.075 * b, 0.06 * b, 0.3 * al, S, sh, -0.02);
      const el = new THREE.Group(); el.position.y = -0.31 * al; sh.add(el);
      ell(0.056 * b, 0.056, 0.056 * b, S, 0, 0, 0, el);
      limb(0.06 * b, 0.044 * b, 0.27 * al, S, el, 0);
      const hand = new THREE.Group(); hand.position.y = -0.29 * al; el.add(hand);
      ell(0.042, 0.056, 0.034, S, 0, -0.03, 0, hand);
      arms.push({ sh, el, hand, s });
      const hp = new THREE.Group(); hp.position.set(s * 0.11 * b, -0.04, 0); hips.add(hp);
      limb(0.1 * b, 0.072 * b, 0.46, S, hp, 0);
      const kn = new THREE.Group(); kn.position.y = -0.46; hp.add(kn);
      ell(0.062 * b, 0.068, 0.068 * b, S, 0, 0, 0.012, kn);
      limb(0.066 * b, 0.046 * b, 0.43, S, kn, 0);
      ell(0.05, 0.034, 0.115, mats.leather, 0, -0.45, 0.05, kn);
      legs.push({ hp, kn, s });
    }
    return { body, hips, torso, chest, neck, head, arms, legs, mats, baseHip: 1.02 };
  }
  function makeRig(h, scale, pivotY = 0.97) {
    const root = new THREE.Group(), rig = new THREE.Group();
    rig.position.y = pivotY * scale;
    rig.scale.setScalar(scale);
    h.body.position.y = -pivotY;
    rig.add(h.body); root.add(rig);
    return { root, rig, scale };
  }
  function resetPose(h) {
    h.hips.position.y = h.baseHip;
    h.hips.rotation.set(0, 0, 0); h.torso.rotation.set(0, 0, 0); h.neck.rotation.set(0, 0, 0); h.head.rotation.set(0, 0, 0);
    for (const a of h.arms) { a.sh.rotation.set(0, 0, a.s * 0.1); a.el.rotation.set(-0.15, 0, 0); }
    for (const l of h.legs) { l.hp.rotation.set(0, 0, 0); l.kn.rotation.set(0, 0, 0); }
  }
  function poseWalk(h, ph, amt, run = 0) {
    const sw = Math.sin(ph) * amt, stride = 0.65 + run * 0.4;
    h.legs[0].hp.rotation.x = -sw * stride; h.legs[1].hp.rotation.x = sw * stride;
    h.legs[0].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4)) * (1 + run * 0.6)) * amt;
    h.legs[1].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4 + Math.PI)) * (1 + run * 0.6)) * amt;
    h.arms[0].sh.rotation.x = sw * (0.5 + run * 0.4); h.arms[1].sh.rotation.x = -sw * (0.5 + run * 0.4);
    h.arms[0].el.rotation.x = h.arms[1].el.rotation.x = -0.3 - run * 0.8 * amt;
    h.hips.position.y = h.baseHip + Math.abs(Math.cos(ph)) * 0.06 * amt;
    h.torso.rotation.x = (0.1 + run * 0.25) * amt;
  }

  // ===================================================================
  // Monsters
  // ===================================================================
  function wolfHead(h, fur, eyes) {
    const S = h.mats.skin;
    ell(0.13, 0.13, 0.14, fur, 0, 0.03, -0.01, h.head);
    ell(0.07, 0.06, 0.15, S, 0, -0.03, 0.14, h.head);
    ell(0.03, 0.025, 0.03, glow(0.02, 0.01, 0.01), 0, -0.01, 0.285, h.head);
    const jaw = new THREE.Group(); jaw.position.set(0, -0.07, 0.06); h.head.add(jaw);
    ell(0.06, 0.025, 0.14, S, 0, -0.01, 0.09, jaw);
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { const t = mesh(new THREE.ConeGeometry(0.008, 0.035, 4), std(0xd8ccb0, 0.4), s * 0.03, 0.02, 0.18 - k * 0.04, jaw); t.userData.keep = true; }
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.035, 0.12, 5), fur, s * 0.08, 0.15, -0.03, h.head); ear.rotation.z = -s * 0.35;
      const eye = ell(0.016, 0.012, 0.01, eyes, s * 0.05, 0.035, 0.115, h.head); eye.userData.keep = true;
    }
    h.jaw = jaw;
  }
  function claws(hand, mat, len = 0.08) {
    for (let k = -1.5; k <= 1.5; k++) { const c = mesh(new THREE.ConeGeometry(0.008, len, 4), mat, k * 0.018, -0.09 - len / 2, 0.01, hand); c.rotation.x = Math.PI; }
  }
  function buildHollowed(alpha = false) {
    const fur = std(alpha ? 0x1a1410 : 0x261d16, 0.95);
    const h = humanoid({ skin: alpha ? 0x3a2e26 : 0x4a3a30, cloth: 0x231a12, bulk: alpha ? 1.35 : 1.1, armLen: 1.25, skinRough: 0.85, noHead: true });
    const eyes = glow(3.5, 2.6, 0.4);
    wolfHead(h, fur, eyes);
    // fur on the back and shoulders
    ell(0.3, 0.14, 0.2, fur, 0, 0.55, -0.06, h.torso);
    ell(0.22, 0.24, 0.12, fur, 0, 0.35, -0.12, h.torso);
    for (const a of h.arms) { ell(0.11, 0.1, 0.11, fur, 0, 0.0, 0, a.sh); claws(a.hand, std(0x1a1410, 0.4)); }
    for (const l of h.legs) ell(0.11, 0.16, 0.11, fur, 0, -0.2, -0.02, l.hp);
    if (alpha) {
      ell(0.27 * 1.35, 0.2, 0.18 * 1.35, h.mats.metal, 0, 0.42, 0.02, h.torso);
      mesh(cyl(0.025, 0.025, 1.3, 6), std(0x2a1a10, 0.8), 0, -0.55, 0, h.arms[0].hand);
      const blade = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 3, 1), std(0x6a6662, 0.35, 0.9), 0, -1.1, 0.14, h.arms[0].hand);
      blade.rotation.x = Math.PI / 2; blade.scale.set(1, 1, 1.2);
    }
    bake(h.body);
    return { h, ...makeRig(h, alpha ? 1.3 : 1.05) };
  }
  function buildShepherd() {
    const h = humanoid({ skin: 0x6a5a50, cloth: 0x2a2218, bulk: 1.8, skinRough: 0.8, noHead: true });
    const sack = std(0x6a5a40, 1), rope = std(0x3a2a18, 1);
    ell(0.15, 0.17, 0.16, sack, 0, 0.03, 0, h.head);
    ell(0.16, 0.03, 0.17, rope, 0, -0.08, 0, h.head);
    for (const s of [-1, 1]) { const e = ell(0.022, 0.012, 0.01, glow(4, 0.6, 0.2), s * 0.05, 0.04, 0.155, h.head); e.userData.keep = true; }
    for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(0.006, 0.04, 0.004), rope, -0.04 + k * 0.016, -0.03, 0.158, h.head);
    // the robe and the bell he swore an oath to
    mesh(cyl(0.45, 0.62, 0.9, 18, true), h.mats.cloth, 0, -0.45, 0, h.hips);
    ell(0.48, 0.3, 0.32, h.mats.cloth, 0, 0.4, 0, h.torso);
    const bell = mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.18, 14, 1, true), std(0x6a4a24, 0.35, 0.9), 0, 0.32, 0.3, h.torso);
    bell.material.side = THREE.DoubleSide;
    // the growth on his back: his weak point
    const tumor = ell(0.17, 0.2, 0.12, std(0x5a1010, 0.3, 0, { emissive: new THREE.Color(1.6, 0.25, 0.05), emissiveIntensity: 1 }), 0, 0.42, -0.2, h.torso);
    tumor.userData.keep = true;
    for (let k = 0; k < 5; k++) { const v = ell(0.03, 0.05, 0.03, tumor.material, rand(-0.12, 0.12), 0.42 + rand(-0.12, 0.12), -0.28, h.torso); v.userData.keep = true; }
    // hammer
    mesh(cyl(0.035, 0.035, 1.9, 8), std(0x2a1a10, 0.8), 0, -0.85, 0, h.arms[0].hand);
    mesh(new THREE.BoxGeometry(0.3, 0.32, 0.55), std(0x3a3632, 0.5, 0.7), 0, -1.75, 0.08, h.arms[0].hand);
    bake(h.body);
    h.tumor = tumor;
    return { h, ...makeRig(h, 1.8) };
  }
  function buildMaiden() {
    const h = humanoid({ skin: 0x8e867c, cloth: 0x0c0a0a, bulk: 0.82, noKilt: true, skinRough: 0.5, noHead: true });
    const dress = std(0x0d0b0b, 0.9, 0, { side: THREE.DoubleSide }), apron = std(0x5a564e, 0.9, 0, { side: THREE.DoubleSide }), porcelain = std(0xb8b2a8, 0.25);
    mesh(cyl(0.2, 0.55, 1.05, 18, true), dress, 0, -0.5, 0, h.hips);
    ell(0.22, 0.24, 0.15, dress, 0, 0.36, 0, h.torso);
    const ap = mesh(new THREE.PlaneGeometry(0.34, 0.85), apron, 0, -0.4, 0.33, h.hips); ap.rotation.x = -0.3;
    ell(0.11, 0.135, 0.125, h.mats.skin, 0, 0.02, -0.01, h.head);
    ell(0.1, 0.12, 0.05, porcelain, 0, 0.0, 0.1, h.head);
    for (const s of [-1, 1]) { const e = ell(0.02, 0.012, 0.01, glow(0.02, 0.0, 0.0), s * 0.04, 0.02, 0.15, h.head); e.userData.keep = true; }
    ell(0.12, 0.1, 0.12, std(0x0a0806, 0.9), 0, 0.08, -0.04, h.head);
    ell(0.06, 0.06, 0.06, std(0x0a0806, 0.9), 0, 0.1, -0.14, h.head);
    for (const a of h.arms) { ell(0.07, 0.15, 0.07, dress, 0, -0.12, 0, a.sh); claws(a.hand, std(0x2a2420, 0.5), 0.1); }
    bake(h.body);
    return { h, ...makeRig(h, 1.0) };
  }
  function buildCountess() {
    const h = humanoid({ skin: 0xb8aea4, cloth: 0x9a9284, bulk: 0.9, noKilt: true, skinRough: 0.45, eyeMat: glow(2.5, 1.6, 0.4) });
    const gown = std(0xa49c8e, 0.8, 0, { side: THREE.DoubleSide }), black = std(0x0a0808, 0.6), pearl = std(0xd8d4cc, 0.15, 0.2);
    mesh(cyl(0.24, 0.78, 1.05, 24, true), gown, 0, -0.5, 0, h.hips);
    ell(0.26, 0.24, 0.17, gown, 0, 0.38, 0, h.torso);
    const brim = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.015, 28), black, 0, 0.12, 0, h.head); brim.rotation.x = -0.1;
    mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.14, 20), black, 0, 0.19, -0.01, h.head);
    const neckl = mesh(new THREE.TorusGeometry(0.085, 0.012, 6, 20), pearl, 0, 0.0, 0.02, h.neck); neckl.rotation.x = Math.PI / 2 - 0.3;
    ell(0.022, 0.009, 0.01, std(0x7a0a10, 0.4), 0, -0.055, 0.121, h.head);
    for (const a of h.arms) ell(0.08, 0.12, 0.08, gown, 0, -0.05, 0, a.sh);
    // the right hand's long blade-like nails
    const nails = new THREE.Group(); h.arms[0].hand.add(nails);
    for (let k = -2; k <= 2; k++) { const c = mesh(new THREE.ConeGeometry(0.01, 0.45, 4), std(0x1a1414, 0.3, 0.4), k * 0.016, -0.3, 0.01, nails); c.rotation.x = Math.PI; c.userData.keep = true; }
    h.nails = nails;
    bake(h.body);
    return { h, ...makeRig(h, 1.45) };
  }
  function buildBeast() {
    const body = new THREE.Group();
    const skin = std(0x8a8078, 0.55), dark = std(0x1a1012, 0.8, 0, { side: THREE.DoubleSide }), chit = std(0x2a1a1c, 0.4, 0.2);
    const torso = new THREE.Group(); body.add(torso);
    ell(0.9, 0.7, 1.4, chit, 0, 0, -0.6, torso);
    ell(0.75, 0.8, 0.8, skin, 0, 0.3, 0.6, torso);
    const core = ell(0.32, 0.38, 0.2, std(0x5a0808, 0.3, 0, { emissive: new THREE.Color(2.4, 0.2, 0.08), emissiveIntensity: 1 }), 0, 0.3, 1.32, torso);
    core.userData.keep = true;
    // her upper body rising from the beast
    const upper = new THREE.Group(); upper.position.set(0, 1.0, 0.7); torso.add(upper);
    ell(0.22, 0.32, 0.16, skin, 0, 0.3, 0, upper);
    const head = new THREE.Group(); head.position.set(0, 0.78, 0.02); upper.add(head);
    ell(0.13, 0.16, 0.15, skin, 0, 0, 0, head);
    for (const s of [-1, 1]) ell(0.02, 0.012, 0.01, glow(4, 1.2, 0.3), s * 0.05, 0.02, 0.135, head);
    const hair = ell(0.15, 0.25, 0.12, std(0x0a0808, 0.9), 0, -0.05, -0.08, head); void hair;
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.7, 0.55, 0.1); torso.add(w);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(3.2, 1.0); shape.lineTo(4.4, 0.2); shape.lineTo(3.6, -0.8); shape.lineTo(2.4, -1.1); shape.lineTo(1.2, -0.9); shape.lineTo(0, -0.4);
      const g = new THREE.ShapeGeometry(shape); if (s < 0) g.scale(-1, 1, 1); g.rotateX(-Math.PI / 2);
      mesh(g, dark, 0, 0, 0, w);
      const bone = mesh(cyl(0.06, 0.03, 4.4, 6), chit, s * 2.2, 0.03, -0.4, w); bone.rotation.z = Math.PI / 2; bone.rotation.y = s * 0.25;
      wings.push({ w, s });
    }
    const arms = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.6, -0.1, 1.0); torso.add(sh);
      limb(0.1, 0.06, 1.3, skin, sh, 0);
      const cl = new THREE.Group(); cl.position.y = -1.3; sh.add(cl);
      for (let k = -1; k <= 1; k++) { const c = mesh(new THREE.ConeGeometry(0.03, 0.45, 4), chit, k * 0.06, -0.2, 0, cl); c.rotation.x = Math.PI; }
      arms.push({ sh, s });
    }
    const tail = new THREE.Group(); tail.position.set(0, -0.1, -1.9); torso.add(tail);
    const tl = mesh(cyl(0.18, 0.02, 2.4, 8), chit, 0, 0, -1.2, tail); tl.rotation.x = Math.PI / 2;
    const h = { body, torso, upper, head, wings, arms, tail, core, mats: { skin } };
    return { h, ...makeRig(h, 1.6, 0) };
  }
  // the merchant, Brask: tall, hooded, carrying his lamp
  function buildMerchant() {
    const g = new THREE.Group();
    const cloak = std(0x2a1e16, 0.95, 0, { side: THREE.DoubleSide });
    mesh(new THREE.ConeGeometry(0.55, 2.0, 16, 1, true), cloak, 0, 1.0, 0, g);
    mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, TAU, 0, Math.PI * 0.6), cloak, 0, 2.02, 0, g);
    ell(0.15, 0.18, 0.12, std(0x080605, 0.9), 0, 1.92, 0.08, g);
    for (const s of [-1, 1]) ell(0.016, 0.01, 0.01, glow(2.5, 1.8, 0.8), s * 0.05, 1.96, 0.2, g);
    const pipe = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 5), std(0x3a2414), 0.04, 1.84, 0.26, g); pipe.rotation.x = 1.2;
    ell(0.025, 0.02, 0.025, glow(3, 0.9, 0.2), 0.05, 1.84, 0.34, g);
    const arm = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8), cloak, 0.42, 1.3, 0.15, g); arm.rotation.z = 0.6;
    mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), std(0x1a1410, 0.4, 0.8), 0.62, 0.95, 0.25, g);
    ell(0.05, 0.08, 0.05, glow(4, 2.4, 0.9), 0.62, 0.95, 0.25, g);
    // cart
    const wood = std(0x3a2618, 0.85);
    mesh(new THREE.BoxGeometry(1.6, 0.6, 0.9), wood, -1.1, 0.75, -0.2, g);
    for (const s of [-1, 1]) { const w = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14), wood, -1.1 + s * 0.6, 0.4, 0.3, g); w.rotation.x = Math.PI / 2; }
    for (let i = 0; i < 6; i++) mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), std(new THREE.Color().setHSL(rand(0, 0.12), 0.4, rand(0.15, 0.3)).getHex(), 0.8), -1.6 + i * 0.2, 1.15, -0.2 + rand(-0.2, 0.2), g);
    const lampLight = new THREE.PointLight(0xffb060, 0.9, 7, 2); lampLight.position.set(0.62, 1.0, 0.4); g.add(lampLight);
    g.userData.lamp = lampLight;
    return g;
  }

  // ===================================================================
  // Weapons (shared by pickups and the first-person view)
  // ===================================================================
  const gunMetal = std(0x1a1a1c, 0.35, 0.85), gunWood = std(0x4a2a16, 0.6), brass = std(0xb08a40, 0.3, 1);
  function pistolModel() {
    const g = new THREE.Group();
    mesh(new THREE.BoxGeometry(0.032, 0.036, 0.19), gunMetal, 0, 0.018, -0.02, g);
    mesh(new THREE.BoxGeometry(0.028, 0.026, 0.17), gunMetal, 0, -0.012, -0.01, g);
    const grip = mesh(new THREE.BoxGeometry(0.03, 0.1, 0.045), std(0x1a1410, 0.7), 0, -0.065, 0.055, g); grip.rotation.x = 0.25;
    const tg = mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), gunMetal, 0, -0.03, 0.015, g); tg.rotation.z = Math.PI;
    mesh(new THREE.BoxGeometry(0.006, 0.008, 0.006), gunMetal, 0, 0.04, -0.105, g);
    mesh(new THREE.BoxGeometry(0.02, 0.008, 0.006), gunMetal, 0, 0.04, 0.07, g);
    g.userData.muzzle = new THREE.Vector3(0, 0.018, -0.12);
    return g;
  }
  function shotgunModel() {
    const g = new THREE.Group();
    const bar = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.62, 10), gunMetal, 0, 0.02, -0.32, g); bar.rotation.x = Math.PI / 2;
    const tube = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 10), gunMetal, 0, -0.008, -0.27, g); tube.rotation.x = Math.PI / 2;
    const pump = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), gunWood, 0, -0.008, -0.3, g); pump.rotation.x = Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.04, 0.06, 0.18), gunMetal, 0, 0.0, 0.03, g);
    const stock = mesh(new THREE.BoxGeometry(0.035, 0.07, 0.3), gunWood, 0, -0.03, 0.26, g); stock.rotation.x = 0.12;
    g.userData.pump = pump;
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.64);
    return g;
  }
  function knifeModel() {
    const g = new THREE.Group();
    const blade = mesh(new THREE.ConeGeometry(0.018, 0.2, 4), std(0xb8b4ae, 0.2, 1), 0, 0, -0.13, g); blade.rotation.x = -Math.PI / 2; blade.scale.set(1, 1, 0.25);
    mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), gunMetal, 0, 0, -0.03, g);
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 8), std(0x2a1a10, 0.7), 0, 0, 0.02, g).rotation.x = Math.PI / 2;
    return g;
  }
  // first-person arms holding every weapon
  function viewModel() {
    const root = new THREE.Group();
    const sleeve = std(0x23262a, 0.9), skin = std(0xc89a80, 0.6), glove = std(0x15120f, 0.7);
    const arm = (side) => {
      const a = new THREE.Group();
      const s = mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 10), sleeve, 0, 0, 0.21, a); s.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.08, 10), skin, 0, 0, -0.02, a).rotation.x = Math.PI / 2;
      ell(0.034, 0.03, 0.05, glove, 0, -0.005, -0.07, a);
      a.userData.side = side;
      return a;
    };
    const right = arm(1), left = arm(-1);
    root.add(right, left);
    const pistol = pistolModel(), shotgun = shotgunModel(), knife = knifeModel();
    root.add(pistol, shotgun, knife);
    root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.glowTex, color: new THREE.Color(4, 2.6, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    flash.scale.set(0.18, 0.18, 1); flash.visible = false; root.add(flash);
    return { root, right, left, pistol, shotgun, knife, flash };
  }

  // ===================================================================
  // Item models for pickups
  // ===================================================================
  const paper = std(0xd8d0bc, 0.95, 0, { side: THREE.DoubleSide }), goldM = std(0xd4a840, 0.25, 1), ironM = std(0x2a2826, 0.5, 0.8);
  function itemModel(type) {
    const g = new THREE.Group();
    const [kind, sub] = type.split(':');
    if (kind === 'weapon') { const m = sub === 'pistol' ? pistolModel() : shotgunModel(); m.rotation.set(0, 0.6, Math.PI / 2); m.scale.setScalar(sub === 'pistol' ? 1.6 : 1.3); m.position.y = 0.02; g.add(m); }
    else if (type === 'pistolAmmo') { mesh(new THREE.BoxGeometry(0.12, 0.06, 0.08), std(0x2a3a22, 0.8), 0, 0.03, 0, g); for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 6), brass, -0.04 + i * 0.026, 0.07, 0, g); }
    else if (type === 'shells') { mesh(new THREE.BoxGeometry(0.13, 0.07, 0.09), std(0x6a1410, 0.8), 0, 0.035, 0, g); for (let i = 0; i < 3; i++) { const s = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), std(0x9a1a14, 0.5), -0.03 + i * 0.03, 0.09, 0, g); void s; } }
    else if (type === 'herb') { for (let i = 0; i < 4; i++) { const l = mesh(new THREE.ConeGeometry(0.035, 0.18, 5), std(0x2a6a2a, 0.7), Math.cos(i * 1.6) * 0.03, 0.08, Math.sin(i * 1.6) * 0.03, g); l.rotation.set(Math.cos(i * 1.6) * 0.4, 0, Math.sin(i * 1.6) * 0.4); l.scale.z = 0.3; } mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.04, 10), std(0x5a3a22, 0.9), 0, 0.02, 0, g); }
    else if (type === 'medicine') { mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.12, 12), std(0x6a2a2a, 0.1, 0.1, { transparent: true, opacity: 0.85 }), 0, 0.06, 0, g); mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 8), std(0x3a2414, 0.9), 0, 0.135, 0, g); }
    else if (kind === 'note') { const p = mesh(new THREE.PlaneGeometry(0.16, 0.22), paper, 0, 0.005, 0, g); p.rotation.x = -Math.PI / 2; p.rotation.z = rand(-0.4, 0.4); }
    else if (kind === 'key') {
      if (sub === 'crank') { const a = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), ironM, 0, 0.02, 0, g); a.rotation.z = Math.PI / 2; const b = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), ironM, 0.15, 0.08, 0, g); void b; }
      else if (sub === 'lamb') { const d = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 20), goldM, 0, 0.12, 0, g); d.rotation.x = Math.PI / 2; ell(0.03, 0.025, 0.012, std(0xe8e0d0, 0.4), 0, 0.12, 0.012, g); }
      else if (sub && sub.startsWith('mask')) { const col = { maskJoy: 0xe8e0d0, maskSorrow: 0x9aa8b8, maskSilence: 0x2a2a2e }[sub]; ell(0.08, 0.1, 0.04, std(col, 0.3), 0, 0.12, 0, g); for (const s of [-1, 1]) ell(0.015, 0.008, 0.01, std(0x050505), s * 0.03, 0.135, 0.035, g); }
      else { const r = mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 14), goldM, -0.05, 0.01, 0, g); r.rotation.x = Math.PI / 2; const s = mesh(new THREE.BoxGeometry(0.08, 0.008, 0.012), goldM, 0.01, 0.01, 0, g); void s; mesh(new THREE.BoxGeometry(0.008, 0.008, 0.025), goldM, 0.045, 0.01, 0.012, g); }
    } else if (kind === 'treasure') {
      if (sub === 'ring') { const r = mesh(new THREE.TorusGeometry(0.03, 0.007, 8, 18), std(0xd8dce0, 0.2, 1), 0, 0.03, 0, g); r.rotation.x = 1.2; ell(0.012, 0.012, 0.012, std(0x8a1020, 0.1, 0.2), 0, 0.06, 0.006, g); }
      else if (sub === 'egg') ell(0.05, 0.065, 0.05, std(0xc87a20, 0.1, 0.1, { emissive: 0x3a1a00 }), 0, 0.065, 0, g);
      else if (sub === 'chalice') { mesh(new THREE.CylinderGeometry(0.06, 0.03, 0.08, 14), goldM, 0, 0.14, 0, g); mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8), goldM, 0, 0.06, 0, g); mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.015, 14), goldM, 0, 0.01, 0, g); }
      else { for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; ell(0.012, 0.012, 0.012, std(0xf4f0e8, 0.15), Math.cos(a) * 0.05, 0.012, Math.sin(a) * 0.05, g); } }
    } else if (type === 'marks') { for (let i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 12), goldM, rand(-0.02, 0.02), 0.004 + i * 0.007, rand(-0.02, 0.02), g); }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  function crateModel() {
    const g = new THREE.Group();
    const wood = std(0x5a3a22, 0.85);
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), wood); c.position.y = 0.35; c.castShadow = true; c.receiveShadow = true; g.add(c);
    for (const y of [0.06, 0.64]) for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.74), std(0x3a2414, 0.9)); b.position.y = y; b.rotation.y = r; g.add(b); }
    return g;
  }

  G.monsters = {
    humanoid, makeRig, resetPose, poseWalk, bake,
    build: { hollowed: () => buildHollowed(false), alpha: () => buildHollowed(true), shepherd: buildShepherd, maiden: buildMaiden, countess: buildCountess, beast: buildBeast },
    buildMerchant,
  };
  G.models = { pistolModel, shotgunModel, knifeModel, viewModel, itemModel, crateModel };
})();
