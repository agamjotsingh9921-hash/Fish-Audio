/* Ashes of Varkova — gameplay.
   First-person survival horror: movement and flashlight, knife / pistol / shotgun,
   a grid inventory, the merchant, enemy AI, the story's events, saving, and the UI. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, clamp, lerp, rand, smooth, damp, angleLerp, V3 } = G.util;
  const L = G.level, S = G.sound, FX = G.fx, MO = G.monsters, MD = G.models;
  const scene = G.scene, camera = G.camera, view = G.view, viewCam = G.viewCam;
  const $ = (id) => document.getElementById(id);
  const CX = L.CX, RX = L.RX;
  const EYE = 1.62;
  const tmpA = V3(), tmpB = V3(), tmpC = V3();

  // ===================================================================
  // Data
  // ===================================================================
  const ITEMS = {
    pistolAmmo: { name: 'Pistol Rounds', stack: 50, desc: '9 mm rounds for the pistol.' },
    shells: { name: 'Shotgun Shells', stack: 16, desc: '12-gauge shells. Devastating up close.' },
    herb: { name: 'Bitterleaf', stack: 3, heal: 35, desc: 'A bitter mountain herb that closes wounds. Combine two into a tincture.' },
    medicine: { name: 'Tincture', stack: 1, heal: 100, desc: 'A strong tincture. Fully restores your health.' },
    'treasure:ring': { name: 'Silver Ring', stack: 1, value: 900, desc: 'A ring with a blood-red stone. Brask would pay for this.' },
    'treasure:egg': { name: 'Amber Egg', stack: 1, value: 1600, desc: 'A polished amber egg with something trapped inside.' },
    'treasure:chalice': { name: 'Gilded Chalice', stack: 1, value: 2600, w: 2, desc: 'A heavy chalice, stained dark at the bottom.' },
    'treasure:pearls': { name: 'Pearl Necklace', stack: 1, value: 1800, desc: 'Fine pearls. One is missing.' },
  };
  const KEYS = {
    crank: { name: 'Winch Crank', desc: 'An iron crank handle. It should fit the gate winch at the palisade.' },
    rusty: { name: 'Rusty Key', desc: 'An old house key, rough with rust.' },
    lamb: { name: 'Lamb Crest', desc: 'A gold crest with a lamb at its centre. It matches the carving on the church door.' },
    cellar: { name: 'Cellar Key', desc: 'A heavy key stamped with a wine barrel.' },
    maskJoy: { name: 'Mask of Joy', desc: 'A smiling porcelain mask.' },
    maskSorrow: { name: 'Mask of Sorrow', desc: 'A weeping blue-grey mask.' },
    maskSilence: { name: 'Mask of Silence', desc: 'A black mask with no mouth.' },
  };
  const NOTES = {
    car: { title: 'Letter from Ilse', text: 'Nadia,\n\nI know you told me not to take the post. The Countess pays three times what the hospital did, and the work is only bloodwork and record keeping.\n\nBut the villagers will not look at me. They bolt their doors before dusk and ring the bell at night for no reason anyone will tell me. Last week the Countess asked for my blood "for the Rite". I said no.\n\nIf you do not hear from me by the first snow, do not come to Varkova.\n\nI mean it.\n\n— Ilse' },
    trapper: { title: 'Trapper\'s Journal', text: 'The wolves are not wolves. I put a whole round into one and it got up and looked at me with Josef\'s eyes.\n\nThey hate the light of the cottage. They hate the ledger room in Saint Ivo\'s chapel even more. Old Brask says no beast will cross a threshold where a ledger is kept. I think he believes it. I think I do too.\n\nI left the pistol on the table. I won\'t be needing it.' },
    hunter: { title: 'Scrawled Note', text: 'BELL RINGS = GET INSIDE\n\nwhen the bell rings they all come. you can\'t outrun them, you hold out until the bell stops. the gate crank is in my barn, east of the road. don\'t go in there after dark' },
    elder: { title: 'Elder\'s Diary', text: 'The Hollowing took the Mirek boys this spring, and the miller\'s whole family by the first frost.\n\nThe Countess says it is a mercy. That the Hollowed are her flock, and Brother Matthias their shepherd. Matthias swore the bell oath and climbed down into the cemetery and did not come back up as himself.\n\nI keep a rusty key to the Novak house in my table. The Novaks had medicine. They will not need it now.' },
    shepherd: { title: 'Novak Family Letter', text: 'The Lamb Crest that opens the church is kept in the mill. The miller hid it there when the Countess\'s men came for it.\n\nBut something big has made its den in the mill. It carries an axe. It was the miller.\n\nThe church leads to the cemetery, and the cemetery is the only way to the castle bridge.' },
    matthias: { title: 'Bell Oath of Brother Matthias', text: 'I, Matthias, take the bell oath.\n\nI will keep the flock. I will keep the gate. None shall cross to the Lady\'s bridge while I draw breath.\n\nThe Lady has given me a gift for my service. It grows on my back and it whispers. It is the only part of me that still feels pain.' },
    servant: { title: 'Servant\'s Warning', text: 'To whoever finds this,\n\nThe Lady walks the halls at night. She cannot be killed, not by any gun in this armory. Do not fight. Run. She will not enter the servants\' quarters. Nothing will.\n\nThe chapel door wants the three masks: Joy from her table, Sorrow from the cellar, and Silence, which the Listeners guard in the library.\n\nThe cellar key is on this table. Take the shotgun too. You will need it.' },
    listeners: { title: 'The Three Listeners', text: 'Three old friends of the house sit in the library and listen.\n\nWhen all three turn to the warmth of the flame, the mantle will give up what it holds.' },
    ilse: { title: 'Ilse\'s Last Note', text: 'Nadia, if you have come this far I am so sorry.\n\nShe takes blood for the Rite on the roof, under the moon. She is not human any more, not really. When the moon is full she is something else.\n\nThey moved me below, to the old crypts, I think. I can hear water.\n\nIf you find her on the roof, aim for the heart. It glows. It is the only thing about her that is still alive.\n\n— I' },
  };
  const WEAPONS = {
    knife: { name: 'Knife', dmg: 20, rate: 0.5, range: 2.0, melee: true },
    pistol: { name: 'Pistol', dmg: 16, mag: 10, rate: 0.24, spread: 0.014, reload: 1.4, ammo: 'pistolAmmo', head: 2.6 },
    shotgun: { name: 'Shotgun', dmg: 11, pellets: 8, mag: 4, rate: 0.9, spread: 0.07, reload: 0.55, ammo: 'shells', head: 1.8 },
  };
  const ORDER = ['knife', 'pistol', 'shotgun'];
  const DEFS = {
    hollowed: { hp: 70, walk: 1.6, run: 5.6, radius: 0.4, dmg: 14, sight: 26, reach: 1.7, marks: [40, 120] },
    alpha: { hp: 260, walk: 1.4, run: 4.4, radius: 0.6, dmg: 28, sight: 22, reach: 2.4, marks: [400, 600] },
    maiden: { hp: 80, walk: 1.2, run: 2.9, radius: 0.4, dmg: 15, sight: 20, reach: 1.5, marks: [60, 140] },
    shepherd: { hp: 800, walk: 2.2, run: 8, radius: 1.0, dmg: 35, sight: 99, reach: 3, boss: true, marks: [2500, 2500] },
    countess: { hp: 1e9, walk: 2.45, run: 2.45, radius: 0.7, dmg: 34, sight: 99, reach: 2.6, stalker: true, marks: [0, 0] },
    beast: { hp: 1400, walk: 0, run: 0, radius: 2.4, dmg: 30, sight: 99, reach: 4, boss: true, marks: [0, 0] },
  };

  // ===================================================================
  // State
  // ===================================================================
  const P = {
    pos: V3(), vel: V3(), yaw: 0, pitch: 0, region: 'village', hp: 100, maxHp: 100, stamina: 100, staminaT: 0,
    weapon: 'knife', weapons: { knife: true }, mag: { pistol: 0, shotgun: 0 }, up: { pistolDmg: 0, pistolCap: 0, shotgunDmg: 0, shotgunCap: 0 },
    marks: 0, light: true, reloadDur: 1, flashT: 0, aim: 0, fireT: 0, reloadT: 0, reloading: false, switchT: 0, knifeT: 0, recoil: 0, bob: 0, stepT: 0, hurtT: 0, dead: false, deadT: 0,
  };
  const inv = { cols: 6, rows: 4, items: [], keys: [], files: [] };
  let uid = 1;
  const flags = {};
  const picked = new Set(), killed = new Set(), spawned = new Set(), firedTriggers = new Set();
  const game = { state: 'title', time: 0, kills: 0, objective: '', checkpoint: null };
  let shake = 0, fade = 0, fadeTarget = 0, hurtFx = 0, fear = 0;

  // ===================================================================
  // Flashlight, first-person view
  // ===================================================================
  const flashlight = new THREE.SpotLight(0xfff2dc, 2.4, 32, 0.42, 0.55, 2);
  flashlight.position.set(0.18, -0.12, 0.05);
  flashlight.castShadow = true;
  flashlight.shadow.mapSize.set(1024, 1024);
  flashlight.shadow.camera.near = 0.2; flashlight.shadow.camera.far = 34;
  flashlight.shadow.bias = -0.0006;
  camera.add(flashlight);
  flashlight.target.position.set(0.05, -0.06, -1);
  camera.add(flashlight.target);
  const bodyGlow = new THREE.PointLight(0x8090b0, 0.12, 5, 2);
  camera.add(bodyGlow);
  const muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
  camera.add(muzzleLight); muzzleLight.position.set(0.1, -0.1, -0.6);
  const vm = MD.viewModel();
  G.linearize(vm.root);
  view.add(vm.root);
  view.add(new THREE.HemisphereLight(0x5a6478, 0x141010, 0.55));
  const vmKey = new THREE.DirectionalLight(0xfff0dc, 0.7); vmKey.position.set(0.3, 1, 0.6); view.add(vmKey);
  const vmFlash = new THREE.PointLight(0xffb060, 0, 2, 2); vmFlash.position.set(0.1, 0, -0.6); view.add(vmFlash);
  const VIEW_POSE = {
    pistol: { gun: [0.15, -0.16, -0.42], ads: [0.0, -0.105, -0.34], right: [0.155, -0.24, -0.34], left: [0.11, -0.26, -0.36], lrot: [0.3, 0.5, 0.2] },
    shotgun: { gun: [0.14, -0.15, -0.32], ads: [0.0, -0.115, -0.26], right: [0.15, -0.2, -0.24], left: [0.12, -0.19, -0.62], lrot: [0.1, 0.2, 0] },
    knife: { gun: [0.2, -0.2, -0.38], ads: [0.2, -0.2, -0.38], right: [0.2, -0.24, -0.3], left: [-0.3, -0.5, -0.3], lrot: [0, 0, 0] },
  };
  let swayX = 0, swayY = 0;
  function updateViewModel(dt) {
    const pose = VIEW_POSE[P.weapon];
    vm.pistol.visible = P.weapon === 'pistol';
    vm.shotgun.visible = P.weapon === 'shotgun';
    vm.knife.visible = P.weapon === 'knife';
    const gun = P.weapon === 'pistol' ? vm.pistol : P.weapon === 'shotgun' ? vm.shotgun : vm.knife;
    const a = P.aim;
    const speed = Math.hypot(P.vel.x, P.vel.z);
    const bobA = Math.min(1, speed / 3) * (1 - a * 0.8);
    const bx = Math.sin(P.bob) * 0.012 * bobA, by = Math.abs(Math.cos(P.bob)) * 0.014 * bobA;
    swayX = lerp(swayX, 0, damp(6, dt)); swayY = lerp(swayY, 0, damp(6, dt));
    let gx = lerp(pose.gun[0], pose.ads[0], a) + bx + swayX * 0.02, gy = lerp(pose.gun[1], pose.ads[1], a) - by + swayY * 0.02, gz = lerp(pose.gun[2], pose.ads[2], a);
    let rx = 0, ry = 0, rz = 0;
    // switching: lower and raise
    if (P.switchT > 0) { const k = Math.sin((P.switchT / 0.45) * Math.PI); gy -= k * 0.25; rx -= k * 0.6; }
    // recoil
    gz += P.recoil * 0.06; rx += P.recoil * 0.25;
    // reload: dip and tilt
    if (P.reloading) { const k = Math.sin(clamp(1 - P.reloadT / P.reloadDur, 0, 1) * Math.PI); gy -= k * 0.08; rz += k * 0.5; rx += k * 0.25; }
    // knife swing
    if (P.weapon === 'knife' && P.knifeT > 0) { const k = 1 - P.knifeT / 0.38; ry = lerp(-1.1, 1.0, smooth(clamp(k * 1.4, 0, 1))); gx -= Math.sin(k * Math.PI) * 0.12; rz = -0.6 + k * 0.4; gz -= Math.sin(k * Math.PI) * 0.08; }
    gun.position.set(gx, gy, gz);
    gun.rotation.set(rx, ry + (P.weapon === 'knife' ? -0.3 : 0), rz);
    if (P.weapon === 'knife') gun.rotation.x = rx - 0.25;
    vm.right.position.set(gx + (pose.right[0] - pose.gun[0]), gy + (pose.right[1] - pose.gun[1]), gz + (pose.right[2] - pose.gun[2]));
    vm.right.rotation.set(rx + 0.1, ry * 0.8 + 0.12, rz);
    vm.left.visible = P.weapon !== 'knife';
    vm.left.position.set(gx + (pose.left[0] - pose.gun[0]), gy + (pose.left[1] - pose.gun[1]) - (P.reloading ? 0.05 : 0), gz + (pose.left[2] - pose.gun[2]));
    vm.left.rotation.set(rx + pose.lrot[0], pose.lrot[1], pose.lrot[2] + rz);
    if (P.weapon === 'shotgun' && vm.shotgun.userData.pump) vm.shotgun.userData.pump.position.z = -0.3 + Math.max(0, Math.sin(clamp((P.fireT - 0.25) / 0.5, 0, 1) * Math.PI)) * 0.08;
    // muzzle flash
    if (P.flashT > 0) {
      P.flashT -= dt;
      const m = gun.userData.muzzle;
      if (m) { tmpA.copy(m).applyEuler(gun.rotation).add(gun.position); vm.flash.position.copy(tmpA); }
      vm.flash.visible = true; vm.flash.material.rotation = rand(0, TAU);
      vmFlash.intensity = 3; muzzleLight.intensity = 4;
    } else { vm.flash.visible = false; vmFlash.intensity = 0; muzzleLight.intensity = 0; }
    vm.root.visible = !P.dead && game.state !== 'cutscene';
  }

  // ===================================================================
  // Enemies
  // ===================================================================
  const enemies = [];
  function spawnEnemy(sp) {
    const def = DEFS[sp.type];
    const b = MO.build[sp.type]();
    const region = L.regionOf(sp.x);
    const e = {
      id: sp.id, type: sp.type, def, h: b.h, root: b.root, rig: b.rig, scale: b.scale, pos: b.root.position, vel: V3(),
      yaw: rand(0, TAU), state: sp.state || 'idle', t: 0, hp: def.hp, maxHp: def.hp, alive: true, region, home: { x: sp.x, z: sp.z },
      cd: rand(0.5, 1.5), alerted: false, phase: rand(0, TAU), wait: sp.wait || null, walkPh: rand(0, 6), flash: 0, wander: { x: sp.x, z: sp.z, t: 0 }, spheres: [], didHit: false, lostT: 0, stepT: 0, deadT: 0,
    };
    e.pos.set(sp.x, L.heightAt(sp.x, sp.z), sp.z);
    if (sp.yaw !== undefined) e.yaw = sp.yaw;
    else if (e.state === 'feed' || e.state === 'dormant') e.yaw = rand(0, TAU);
    e.mats = [];
    e.root.traverse((o) => { if (o.isMesh && o.material && o.material.emissive && e.mats.indexOf(o.material) < 0) { e.mats.push(o.material); o.material.userData.e0 = o.material.emissive.clone(); } });
    G.linearize(e.root);
    L.REGIONS[region].dynamic.add(e.root);
    enemies.push(e);
    spawned.add(sp.id);
    if (e.state === 'rise') { e.pos.y -= 2; FX.dust.emit(e.pos.x, 0.3, e.pos.z, 40, { color: 0x3a3632, speed: 1.5, up: 1.5, life: 1.6, grav: -0.3, spread: 0.5 }); }
    return e;
  }
  function removeEnemy(e) {
    if (e.root.parent) e.root.parent.remove(e.root);
    const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1);
  }
  function spawnPending() {
    for (const sp of L.spawns) {
      if (spawned.has(sp.id) || killed.has(sp.id)) continue;
      if (L.regionOf(sp.x) !== P.region) continue;
      if (sp.flag && !flags[sp.flag]) continue;
      spawnEnemy(sp);
    }
  }
  function setFlag(k, v = true) { flags[k] = v; spawnPending(); }

  // hit spheres follow the bones
  function updateSpheres(e) {
    e.root.updateMatrixWorld(true);
    const sc = e.scale, s = e.spheres;
    s.length = 0;
    if (e.type === 'beast') {
      s.push({ c: e.h.core.getWorldPosition(V3()), r: 0.55 * sc, part: 'weak' });
      s.push({ c: e.h.torso.getWorldPosition(V3()), r: 1.25 * sc, part: 'body' });
      s.push({ c: e.h.head.getWorldPosition(V3()), r: 0.3 * sc, part: 'body' });
      return;
    }
    s.push({ c: e.h.head.getWorldPosition(V3()), r: 0.16 * sc, part: 'head' });
    const ch = e.h.torso.localToWorld(V3(0, 0.38, 0));
    s.push({ c: ch, r: 0.27 * sc, part: 'body' });
    s.push({ c: e.h.hips.getWorldPosition(V3()), r: 0.24 * sc, part: 'body' });
    const k1 = e.h.legs[0].kn.getWorldPosition(V3()), k2 = e.h.legs[1].kn.getWorldPosition(V3());
    s.push({ c: k1, r: 0.12 * sc, part: 'leg' }, { c: k2, r: 0.12 * sc, part: 'leg' });
    if (e.type === 'shepherd') s.push({ c: e.h.tumor.getWorldPosition(V3()), r: 0.3 * sc, part: 'weak' });
  }

  // ===================================================================
  // Inventory
  // ===================================================================
  function fits(x, y, w, h, ignore) {
    if (x < 0 || y < 0 || x + w > inv.cols || y + h > inv.rows) return false;
    for (const it of inv.items) { if (it === ignore) continue; if (x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y) return false; }
    return true;
  }
  function addItem(type, count) {
    const def = ITEMS[type];
    let left = count;
    for (const it of inv.items) if (it.type === type && it.count < def.stack) { const n = Math.min(def.stack - it.count, left); it.count += n; left -= n; if (!left) return 0; }
    while (left > 0) {
      const w = def.w || 1, h = def.h || 1;
      let spot = null;
      for (let y = 0; y < inv.rows && !spot; y++) for (let x = 0; x < inv.cols && !spot; x++) if (fits(x, y, w, h)) spot = [x, y];
      if (!spot) break;
      const n = Math.min(def.stack, left);
      inv.items.push({ id: uid++, type, count: n, x: spot[0], y: spot[1], w, h });
      left -= n;
    }
    return left;
  }
  const countItem = (type) => inv.items.reduce((s, it) => s + (it.type === type ? it.count : 0), 0);
  function takeItem(type, n) {
    let left = n;
    for (const it of inv.items.slice().sort((a, b) => a.count - b.count)) {
      if (it.type !== type || !left) continue;
      const k = Math.min(it.count, left); it.count -= k; left -= k;
    }
    inv.items = inv.items.filter((it) => it.count > 0);
    return n - left;
  }
  const hasKey = (k) => inv.keys.includes(k);
  function useKey(k) { inv.keys = inv.keys.filter((x) => x !== k); }
  function resizeCase(cols, rows) { inv.cols = cols; inv.rows = rows; }

  // ===================================================================
  // UI helpers
  // ===================================================================
  const ui = {
    hud: $('hud'), ammo: $('ammo'), ammoMag: $('ammoMag'), ammoRes: $('ammoRes'), ammoName: $('ammoName'), cross: $('cross'), hit: $('hitmark'),
    prompt: $('prompt'), sub: $('subtitle'), toast: $('toast'), obj: $('objective'), boss: $('boss'), bossName: $('bossName'), bossFill: $('bossFill'),
    vital: $('vital'), vitalRing: $('vitalRing'), vitalLabel: $('vitalLabel'), stamina: $('stamina'), staminaFill: $('staminaFill'),
    fade: $('fade'), letterbox: $('letterbox'), blood: $('bloodScreen'), touch: $('touch'),
  };
  let toastT = 0, subT = 0, objT = 0;
  function toast(text, dur = 2.2) { ui.toast.textContent = text; ui.toast.classList.add('show'); toastT = dur; }
  function say(who, text, dur = 4) { ui.sub.innerHTML = who ? `<b>${who}</b>${text}` : text; ui.sub.classList.add('show'); subT = dur; }
  function objective(text) { game.objective = text; ui.obj.innerHTML = `<small>Objective</small>${text}`; ui.obj.classList.add('show'); objT = 7; }
  function showScreen(id) { ['title', 'pause', 'inventory', 'merchant', 'note', 'map', 'dead', 'end', 'saveDlg'].forEach((s) => { $(s).hidden = s !== id; }); }
  const playing = () => game.state === 'play';

  // item thumbnails rendered from the 3D models
  const iconCache = {};
  const iconScene = new THREE.Scene();
  iconScene.add(new THREE.HemisphereLight(0xfff4e0, 0x202024, 1.4));
  const iconKey = new THREE.DirectionalLight(0xffffff, 1.2); iconKey.position.set(1, 2, 2); iconScene.add(iconKey);
  const iconCam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  let iconRT = null;
  function iconFor(type) {
    if (iconCache[type]) return iconCache[type];
    const r = G.renderer;
    if (!iconRT) { iconRT = new THREE.WebGLRenderTarget(96, 96); iconRT.texture.encoding = THREE.sRGBEncoding; }
    const m = MD.itemModel(type);
    G.linearize(m);
    const box = new THREE.Box3().setFromObject(m), size = box.getSize(V3()), center = box.getCenter(V3());
    m.position.sub(center);
    const holder = new THREE.Group(); holder.add(m); holder.rotation.set(0.5, -0.6, 0);
    iconScene.add(holder);
    const d = Math.max(size.x, size.y, size.z) * 2.4 + 0.01;
    iconCam.position.set(0, 0, d); iconCam.lookAt(0, 0, 0);
    const prevT = r.toneMapping; r.toneMapping = THREE.ACESFilmicToneMapping;
    const prevBg = iconScene.background;
    r.setRenderTarget(iconRT); r.setClearColor(0x000000, 0); r.clear(); r.render(iconScene, iconCam); r.setRenderTarget(null);
    r.toneMapping = prevT; iconScene.background = prevBg;
    const px = new Uint8Array(96 * 96 * 4);
    r.readRenderTargetPixels(iconRT, 0, 0, 96, 96, px);
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const g = c.getContext('2d'), img = g.createImageData(96, 96);
    for (let y = 0; y < 96; y++) img.data.set(px.subarray((95 - y) * 96 * 4, (96 - y) * 96 * 4), y * 96 * 4);
    g.putImageData(img, 0, 0);
    iconScene.remove(holder);
    r.setClearColor(0x000000, 1);
    iconCache[type] = c.toDataURL();
    return iconCache[type];
  }

  // ===================================================================
  // Pickups and crates
  // ===================================================================
  const pickups = [];
  function buildPickups() {
    for (const p of pickups) if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    pickups.length = 0;
    for (const spec of L.pickups) if (!picked.has(spec.id)) placePickup(spec);
  }
  function placePickup(spec) {
    const g = new THREE.Group();
    const model = MD.itemModel(spec.item);
    g.add(model);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.glowTex, color: new THREE.Color(1.4, 1.2, 0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.set(0.35, 0.35, 1); sp.position.y = 0.08; g.add(sp);
    g.position.set(spec.x, spec.y, spec.z);
    G.linearize(g);
    L.REGIONS[spec.region].dynamic.add(g);
    const p = { ...spec, mesh: g, glint: sp };
    pickups.push(p);
    return p;
  }
  function dropPickup(item, count, x, z, y) {
    const id = 'drop' + uid++;
    placePickup({ id, item, count, x, y: y !== undefined ? y : L.heightAt(x, z) + 0.02, z, region: L.regionOf(x), dropped: true });
  }
  const crates = [];
  function buildCrates() {
    for (const c of crates) { if (c.mesh.parent) c.mesh.parent.remove(c.mesh); c.col.on = false; }
    crates.length = 0;
    for (const spec of L.crates) {
      if (picked.has(spec.id)) continue;
      const m = MD.crateModel();
      G.linearize(m);
      m.position.set(spec.x, L.heightAt(spec.x, spec.z), spec.z); m.rotation.y = spec.rot;
      L.REGIONS[spec.region].dynamic.add(m);
      const col = L.colliders.addBox(spec.x, spec.z, 0.38, 0.38, spec.rot, { tall: false });
      crates.push({ ...spec, mesh: m, col, hp: 1 });
    }
  }
  function breakCrate(c) {
    if (!crates.includes(c)) return;
    S.crate();
    FX.dust.emit(c.x, 0.4, c.z, 30, { color: 0x5a4632, speed: 3, up: 1.5, life: 1, grav: 6, spread: 0.3 });
    if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
    c.col.on = false;
    crates.splice(crates.indexOf(c), 1);
    picked.add(c.id);
    const loot = c.loot;
    if (loot === 'marks') dropPickup('marks', Math.round(rand(150, 400) / 10) * 10, c.x, c.z);
    else if (loot === 'pistolAmmo') dropPickup('pistolAmmo', Math.round(rand(6, 11)), c.x, c.z);
    else if (loot === 'shells') dropPickup('shells', Math.round(rand(2, 4)), c.x, c.z);
    else if (loot === 'herb') dropPickup('herb', 1, c.x, c.z);
  }
  function collect(p) {
    const [kind, sub] = p.item.split(':');
    let done = true;
    if (kind === 'weapon') {
      P.weapons[sub] = true; P.mag[sub] = weaponCap(sub);
      equip(sub);
      toast(`Picked up the ${WEAPONS[sub].name}`);
      say('Nadia', sub === 'pistol' ? 'A pistol. Loaded. Good.' : 'A shotgun. That evens the odds.', 3);
    } else if (kind === 'key') {
      inv.keys.push(sub);
      toast(`Obtained: ${KEYS[sub].name}`, 3);
      if (sub === 'maskJoy') setTimeout(() => { setFlag('maskJoyTaken'); S.stinger(); say('', 'Ash stirs in the corners of the room.', 3); }, 400);
      if (sub.startsWith('mask')) checkMasks();
    } else if (kind === 'note') {
      if (!inv.files.includes(sub)) inv.files.push(sub);
      openNote(sub);
    } else if (p.item === 'marks') {
      P.marks += p.count; S.coin(); toast(`${p.count} marks`);
    } else {
      const left = addItem(p.item, p.count);
      if (left === p.count) { toast('Your case is full'); return false; }
      const name = ITEMS[p.item].name;
      toast(left ? `Picked up ${name} ×${p.count - left}. Case full.` : `Picked up ${name}${p.count > 1 ? ' ×' + p.count : ''}`);
      if (left) { p.count = left; done = false; }
    }
    S.pickup();
    if (done) {
      picked.add(p.id);
      if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
      pickups.splice(pickups.indexOf(p), 1);
    }
    return true;
  }
  function checkMasks() {
    const n = ['maskJoy', 'maskSorrow', 'maskSilence'].filter(hasKey).length;
    if (n === 3) objective('Place the three masks on the chapel door at the end of the gallery');
  }

  // ===================================================================
  // Doors and interaction
  // ===================================================================
  function setDoor(d, open) {
    d.open = open;
    d.collider.on = !open;
  }
  function tryDoor(d) {
    if (d.locked) {
      const lock = d.lock || '';
      if (lock.startsWith('flag:')) {
        const f = lock.slice(5);
        if (flags[f]) { d.locked = false; }
        else {
          S.locked();
          toast(d.id === 'c_entrance' ? 'The doors have been barred behind you.' : 'Barred from the other side.');
          return;
        }
      } else if (lock === 'masks') {
        const n = ['maskJoy', 'maskSorrow', 'maskSilence'].filter(hasKey).length;
        if (n < 3) { S.locked(); toast(`Three masks are carved into the door. You have ${n} of 3.`, 3); return; }
        ['maskJoy', 'maskSorrow', 'maskSilence'].forEach(useKey);
        d.locked = false; S.boom(); shake = 0.3;
        say('', 'The masks click into place. Somewhere above, a woman screams in rage.', 4.5);
        S.scream(0.7);
        setFlag('chapelOpen');
        const c = enemies.find((e) => e.type === 'countess');
        if (c) removeEnemy(c);
        objective('Climb the stairs behind the chapel altar to the roof');
      } else if (hasKey(lock)) {
        useKey(lock); d.locked = false;
        S.locked();
        toast(`Used the ${KEYS[lock].name}`);
        if (lock === 'lamb') { setFlag('churchOpen'); objective('Search the church and find a way into the cemetery'); }
      } else {
        S.locked();
        const hint = { rusty: 'Locked. The keyhole is crusted with rust.', lamb: 'Locked. A lamb is carved above the door.', cellar: 'Locked. A wine barrel is stamped on the lock.' }[lock] || 'Locked.';
        toast(hint, 2.6);
        return;
      }
    }
    if (d.kind === 'transition') { transition(d.to); S.door(); return; }
    setDoor(d, !d.open);
    S.door();
  }
  function interactTargets() {
    const fx = -Math.sin(P.yaw) * Math.cos(P.pitch), fy = Math.sin(P.pitch), fz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    const ex = P.pos.x, ey = P.pos.y + EYE, ez = P.pos.z;
    let best = null, bs = -Infinity;
    const consider = (obj, x, y, z, range, label) => {
      const dx = x - ex, dy = y - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
      if (d > range) return;
      const dot = (dx * fx + dy * fy + dz * fz) / (d || 1);
      if (dot < 0.55 && d > 0.9) return;
      const score = dot * 2 - d * 0.5;
      if (score > bs) { bs = score; best = { obj, label }; }
    };
    for (const p of pickups) if (p.region === P.region) consider({ type: 'pickup', p }, p.x, p.y + 0.05, p.z, 2.1, `Take ${pickupName(p)}`);
    for (const d of L.doors) if (d.region === P.region) consider({ type: 'door', d }, d.x, P.pos.y + 1.2, d.z, 2.3, d.kind === 'transition' ? `Enter: ${d.label}` : `${d.open ? 'Close' : 'Open'} ${d.label.toLowerCase()}`);
    for (const it of L.interact) {
      if (it.region !== P.region) continue;
      if (it.kind === 'merchant' && it.flag && !flags[it.flag]) continue;
      consider({ type: 'interact', it }, it.x, it.y + (it.kind === 'merchant' ? 1.4 : 0.1), it.z, it.kind === 'merchant' ? 2.8 : 2.2, it.label);
    }
    return best;
  }
  function pickupName(p) {
    const [kind, sub] = p.item.split(':');
    if (kind === 'weapon') return WEAPONS[sub].name;
    if (kind === 'key') return KEYS[sub].name;
    if (kind === 'note') return NOTES[sub].title;
    if (p.item === 'marks') return `${p.count} marks`;
    return ITEMS[p.item].name + (p.count > 1 ? ` ×${p.count}` : '');
  }
  function interactNow() {
    if (!playing()) return;
    const t = interactTargets();
    if (!t) return;
    const o = t.obj;
    if (o.type === 'pickup') collect(o.p);
    else if (o.type === 'door') tryDoor(o.d);
    else useInteract(o.it);
  }
  function useInteract(it) {
    switch (it.kind) {
      case 'ledger': openSave(it); break;
      case 'merchant': openMerchant(); break;
      case 'winch':
        if (L.gate.open) { toast('The gate is already open.'); break; }
        if (!hasKey('crank')) { S.locked(); toast('The winch is missing its crank handle.', 2.6); objective('Find a crank for the gate winch. Try the barn east of the road.'); break; }
        useKey('crank');
        L.gate.open = true; L.gate.collider.on = false;
        S.wood(); S.door(); shake = 0.2;
        say('', 'The chains rattle and the gate grinds upward.', 3);
        setFlag('gateOpen');
        objective('Enter the village beyond the palisade');
        break;
      case 'bust': {
        const b = L.busts.find((x) => x.id === it.id);
        if (flags.mantleOpen) { toast('The listeners are quiet now.'); break; }
        b.idx = (b.idx + 1) % 4; S.wood();
        if (L.busts.every((x) => x.idx === 1)) {
          setFlag('mantleOpen'); S.stinger();
          setTimeout(() => { S.boom(); say('', 'Something clicks open inside the fireplace mantle.', 3.5); }, 600);
        }
        break;
      }
      case 'mantle':
        if (!flags.mantleOpen) { toast('The mantle is carved with three listening faces, all turned to the flame.', 3); break; }
        if (hasKey('maskSilence') || flags.silenceTaken) { toast('The compartment is empty.'); break; }
        inv.keys.push('maskSilence'); flags.silenceTaken = true; S.pickup();
        toast('Obtained: Mask of Silence', 3);
        checkMasks();
        break;
      default: break;
    }
  }

  // ===================================================================
  // Weapons
  // ===================================================================
  const weaponCap = (w) => (w === 'pistol' ? WEAPONS.pistol.mag + P.up.pistolCap * 4 : w === 'shotgun' ? WEAPONS.shotgun.mag + P.up.shotgunCap * 2 : 0);
  const weaponDmg = (w) => (w === 'pistol' ? WEAPONS.pistol.dmg * (1 + P.up.pistolDmg * 0.25) : w === 'shotgun' ? WEAPONS.shotgun.dmg * (1 + P.up.shotgunDmg * 0.25) : WEAPONS.knife.dmg);
  function equip(w) {
    if (!P.weapons[w] || P.weapon === w) return;
    P.weapon = w; P.switchT = 0.45; P.reloading = false; P.aim = 0;
  }
  function cycleWeapon(dir) {
    const owned = ORDER.filter((w) => P.weapons[w]);
    const i = owned.indexOf(P.weapon);
    equip(owned[(i + dir + owned.length) % owned.length]);
  }
  function startReload() {
    const w = P.weapon;
    if (w === 'knife' || P.reloading || P.switchT > 0) return;
    const W = WEAPONS[w];
    if (P.mag[w] >= weaponCap(w) || countItem(W.ammo) <= 0) return;
    P.reloading = true;
    P.reloadDur = w === 'shotgun' ? W.reload : W.reload;
    P.reloadT = P.reloadDur;
    S.reload();
  }
  function finishReload() {
    const w = P.weapon, W = WEAPONS[w];
    if (w === 'shotgun') {
      if (takeItem(W.ammo, 1)) { P.mag.shotgun++; S.shell(); }
      if (P.mag.shotgun < weaponCap('shotgun') && countItem(W.ammo) > 0 && !P.cancelReload) { P.reloadT = W.reload; return; }
      P.reloading = false; P.cancelReload = false; S.pump();
      return;
    }
    const need = weaponCap(w) - P.mag[w];
    P.mag[w] += takeItem(W.ammo, need);
    P.reloading = false;
  }
  const raycaster = new THREE.Raycaster();
  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
    if (h < 0) return -1;
    const t = -b - Math.sqrt(h);
    return t > 0 ? t : -1;
  }
  function worldTargets() {
    const R = L.REGIONS[P.region];
    const list = R.merged.slice();
    for (const d of L.doors) if (d.region === P.region) list.push(d.panel);
    for (const c of crates) if (c.region === P.region) list.push(c.mesh);
    return list;
  }
  function shoot(origin, dir, dmg, headMul, maxD = 70) {
    let best = null, bt = maxD;
    for (const e of enemies) {
      if (!e.alive || e.region !== P.region) continue;
      for (const s of e.spheres) { const t = raySphere(origin, dir, s.c, s.r); if (t > 0 && t < bt) { bt = t; best = { e, part: s.part }; } }
    }
    raycaster.set(origin, dir); raycaster.far = bt;
    const hits = raycaster.intersectObjects(worldTargets(), true);
    if (hits.length && hits[0].distance < bt) {
      const h = hits[0];
      // crate?
      const c = crates.find((cr) => cr.mesh === h.object || cr.mesh === h.object.parent);
      if (c) { breakCrate(c); return; }
      const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : V3(0, 1, 0);
      if (n.dot(dir) > 0) n.negate();
      FX.holes.place(h.point.clone().addScaledVector(n, 0.01), n, rand(0.05, 0.08));
      FX.sparks.emit(h.point.x, h.point.y, h.point.z, 6, { color: 0xffd090, speed: 3, life: 0.25, grav: 9, bright: 1.6 });
      FX.dust.emit(h.point.x, h.point.y, h.point.z, 4, { color: 0x5a554e, speed: 0.8, life: 0.9, grav: -0.2, dx: n.x, dz: n.z });
      S.bulletHit();
      return;
    }
    if (best) {
      const p = origin.clone().addScaledVector(dir, bt);
      damageEnemy(best.e, dmg, best.part, headMul, p, dir);
    }
  }
  function fire() {
    if (!playing() || P.dead || P.switchT > 0) return;
    const w = P.weapon, W = WEAPONS[w];
    if (P.fireT > 0) return;
    if (w === 'knife') { knife(); return; }
    if (P.reloading) { if (w === 'shotgun' && P.mag.shotgun > 0) { P.reloading = false; } else return; }
    if (P.mag[w] <= 0) { S.empty(); P.fireT = 0.25; startReload(); return; }
    P.mag[w]--;
    P.fireT = W.rate;
    P.recoil = 1; P.flashT = 0.05;
    shake = Math.max(shake, w === 'shotgun' ? 0.25 : 0.08);
    P.pitch = clamp(P.pitch + (w === 'shotgun' ? 0.045 : 0.018), -1.4, 1.4);
    P.yaw += rand(-0.006, 0.006);
    w === 'shotgun' ? S.shotgun() : S.pistol();
    noise(P.pos.x, P.pos.z, w === 'shotgun' ? 34 : 28);
    camera.updateMatrixWorld();
    const origin = camera.getWorldPosition(V3());
    const fwd = V3(0, 0, -1).applyQuaternion(camera.quaternion);
    const spread = W.spread * (1 - P.aim * 0.7) * (1 + Math.min(1, Math.hypot(P.vel.x, P.vel.z) / 3) * 0.8);
    const n = W.pellets || 1;
    const up = V3(0, 1, 0).applyQuaternion(camera.quaternion), right = V3(1, 0, 0).applyQuaternion(camera.quaternion);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * spread;
      const d = fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      shoot(origin, d, weaponDmg(w), W.head);
    }
    FX.dust.emit(origin.x + fwd.x * 0.8, origin.y - 0.1 + fwd.y * 0.8, origin.z + fwd.z * 0.8, 4, { color: 0x6a6660, speed: 0.6, life: 0.8, grav: -0.4 });
    if (P.mag[w] === 0 && countItem(W.ammo) > 0) setTimeout(() => { if (P.weapon === w && P.mag[w] === 0) startReload(); }, 250);
  }
  function knife() {
    P.fireT = WEAPONS.knife.rate; P.knifeT = 0.38;
    S.knife();
    setTimeout(() => {
      if (P.dead) return;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      let hit = false;
      for (const e of enemies) {
        if (!e.alive || e.region !== P.region) continue;
        const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d - e.def.radius > WEAPONS.knife.range) continue;
        if ((dx * fx + dz * fz) / (d || 1) < 0.5) continue;
        const head = e.spheres[0];
        const p = head ? V3(e.pos.x - fx * e.def.radius, P.pos.y + 1.2, e.pos.z - fz * e.def.radius) : e.pos.clone();
        damageEnemy(e, WEAPONS.knife.dmg, 'body', 1, p, V3(fx, 0, fz), true);
        hit = true;
        break;
      }
      for (const c of crates.slice()) {
        if (c.region !== P.region) continue;
        const dx = c.x - P.pos.x, dz = c.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.9 && (dx * fx + dz * fz) / (d || 1) > 0.4) { breakCrate(c); hit = true; }
      }
      if (!hit) {
        tmpA.set(P.pos.x + fx * 1.0, P.pos.y + 1.3, P.pos.z + fz * 1.0);
        if (L.colliders.blockedAt(tmpA.x, tmpA.z, 0.2, (c) => c.tall)) { FX.sparks.emit(tmpA.x, tmpA.y, tmpA.z, 6, { color: 0xffe0b0, speed: 2.5, life: 0.2, grav: 8, bright: 1.6 }); S.bulletHit(); }
      }
    }, 140);
  }
  function noise(x, z, radius) {
    for (const e of enemies) {
      if (!e.alive || e.region !== P.region || e.alerted || e.state === 'dormant') continue;
      if (Math.hypot(e.pos.x - x, e.pos.z - z) < radius) alert(e);
    }
  }

  // ===================================================================
  // Damage
  // ===================================================================
  let hitMarkT = 0;
  function damageEnemy(e, dmg, part, headMul, p, dir, melee = false) {
    if (!e.alive) return;
    let mul = 1;
    if (part === 'head') mul = headMul;
    else if (part === 'weak') mul = 2.5;
    else if (part === 'leg') mul = 0.8;
    if (e.type === 'shepherd' && e.state === 'stunned') mul *= 1.4;
    if (e.type === 'beast' && e.state === 'grounded') mul *= 1.4;
    const amount = dmg * mul;
    hitMarkT = 0.15; ui.hit.classList.toggle('head', part === 'head' || part === 'weak');
    S.flesh();
    // blood
    if (e.type !== 'maiden') FX.blood.emit(p.x, p.y, p.z, part === 'head' ? 26 : 14, { dx: dir.x * 4, dy: 1.2, dz: dir.z * 4, speed: 3, size: 0.07, stain: 0.18 });
    else FX.dust.emit(p.x, p.y, p.z, 12, { color: 0x4a4642, speed: 2, life: 1, grav: 1 });
    if (G.settings.blood && Math.random() < 0.3 && e.type !== 'maiden') FX.decals.add(e.pos.x + dir.x * rand(0.5, 1.5), e.pos.z + dir.z * rand(0.5, 1.5), rand(0.3, 0.6));
    e.flash = 1;
    if (e.def.stalker) {
      // the Countess cannot be killed, only made to recoil
      if (e.state !== 'flinch' && e.state !== 'appear') { e.state = 'flinch'; e.t = 0; e.flinchDur = P.weapon === 'shotgun' ? 1.3 : (part === 'head' ? 0.8 : 0.35); S.scream(0.6); }
      return;
    }
    e.hp -= amount;
    alert(e);
    if (e.hp <= 0) { killEnemy(e, part, dir); return; }
    // flinch
    const heavy = e.type === 'alpha' || e.def.boss;
    if (!heavy && (part === 'head' || melee || P.weapon === 'shotgun' || Math.random() < 0.35)) { e.state = 'flinch'; e.t = 0; e.flinchDur = P.weapon === 'shotgun' ? 0.7 : 0.4; e.vel.x += dir.x * (P.weapon === 'shotgun' ? 5 : 1.5); e.vel.z += dir.z * (P.weapon === 'shotgun' ? 5 : 1.5); }
    else if (e.type === 'alpha' && part === 'head' && Math.random() < 0.4) { e.state = 'flinch'; e.t = 0; e.flinchDur = 0.6; }
  }
  function killEnemy(e, part, dir) {
    e.alive = false; e.state = 'dead'; e.t = 0; e.deadT = 0;
    killed.add(e.id); game.kills++;
    S.splat();
    const c = e.pos;
    if (e.type === 'maiden') {
      FX.dust.emit(c.x, c.y + 1, c.z, 60, { color: 0x3a3632, color2: 0x6a6460, speed: 2.5, up: 1, life: 1.8, grav: 0.4, spread: 0.4 });
      e.ash = true;
    } else {
      FX.blood.emit(c.x, c.y + 1.2 * e.scale, c.z, 40, { dx: dir.x * 3, dz: dir.z * 3, speed: 4, dy: 1.5, size: 0.09, stain: 0.2 });
      if (part === 'head' && e.h.head && e.type !== 'beast') {
        // the head bursts
        e.h.head.visible = false;
        const hp = e.spheres[0] ? e.spheres[0].c : c;
        FX.blood.emit(hp.x, hp.y, hp.z, 90, { speed: 6, dy: 2, size: 0.1, stain: 0.25, spread: 0.1 });
        for (let i = 0; i < 6; i++) gib(hp);
        S.splat();
      }
    }
    const [m0, m1] = e.def.marks;
    if (m1 > 0 && (e.def.boss || Math.random() < 0.55)) dropPickup('marks', Math.round(rand(m0, m1) / 10) * 10, c.x + rand(-0.4, 0.4), c.z + rand(-0.4, 0.4));
    if (!e.def.boss && Math.random() < 0.3) dropPickup(P.weapons.shotgun && Math.random() < 0.4 ? 'shells' : 'pistolAmmo', P.weapons.shotgun ? 3 : 6, c.x + rand(-0.5, 0.5), c.z + rand(-0.5, 0.5));
    if (e.type === 'alpha') dropPickup('treasure:ring', 1, c.x + 0.6, c.z);
    if (e.type === 'shepherd') { bossBar('The Shepherd', 0); onShepherdDead(e); }
    if (e.type === 'beast') onBeastDead(e);
  }
  const gibs = [];
  const gibGeo = new THREE.DodecahedronGeometry(0.05, 0);
  const gibMat = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.35 });
  function gib(p) {
    if (!G.settings.blood) return;
    const m = new THREE.Mesh(gibGeo, gibMat);
    m.position.copy(p); m.scale.setScalar(rand(0.6, 1.6));
    L.REGIONS[P.region].dynamic.add(m);
    gibs.push({ m, v: V3(rand(-3, 3), rand(2, 5), rand(-3, 3)), t: 0, rest: false });
    if (gibs.length > 40) { const g = gibs.shift(); if (g.m.parent) g.m.parent.remove(g.m); }
  }
  function hurtPlayer(dmg, from) {
    if (P.dead || game.state !== 'play') return;
    P.hp -= dmg;
    P.hurtT = 0.4; hurtFx = 1; shake = Math.max(shake, 0.35);
    S.hurt();
    FX.blood.emit(P.pos.x, P.pos.y + 1.3, P.pos.z, 12, { speed: 3, size: 0.06 });
    if (from) { const dx = P.pos.x - from.x, dz = P.pos.z - from.z, d = Math.hypot(dx, dz) || 1; P.vel.x += dx / d * 4; P.vel.z += dz / d * 4; }
    if (P.hp <= 0) { P.hp = 0; die(); }
  }
  function heal(amount) { P.hp = Math.min(P.maxHp, P.hp + amount); }
  function quickHeal() {
    if (!playing() || P.hp >= P.maxHp) return;
    const need = P.maxHp - P.hp;
    const type = need > 50 && countItem('medicine') ? 'medicine' : countItem('herb') ? 'herb' : countItem('medicine') ? 'medicine' : null;
    if (!type) { toast('Nothing to heal with'); return; }
    takeItem(type, 1); heal(ITEMS[type].heal); S.pickup();
    toast(`Used ${ITEMS[type].name}`);
  }
  function die() {
    P.dead = true; P.deadT = 0;
    S.setTension(0);
    setTimeout(() => {
      game.state = 'dead';
      unlockPointer();
      $('deadContinue').textContent = hasSave() ? 'Continue from the ledger' : 'Try again';
      showScreen('dead');
    }, 2200);
  }

  // ===================================================================
  // Enemy AI
  // ===================================================================
  const navTmp = { x: 0, z: 0 };
  let flowT = 0;
  function alert(e) {
    if (e.alerted || !e.alive) return;
    e.alerted = true;
    if (e.state === 'idle' || e.state === 'feed' || e.state === 'wander' || e.state === 'dormant') { e.state = 'chase'; e.t = 0; }
    if (e.type === 'hollowed' || e.type === 'alpha') S.snarl();
    if (e.type === 'maiden') S.scream(1.4);
  }
  function canSee(e, range) {
    const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 5) {
      const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
      if ((dx * fx + dz * fz) / d < 0.2 && d > 9) return false;
    }
    return L.nav.lineOfSight(L.REGIONS[e.region], e.pos.x, e.pos.z, P.pos.x, P.pos.z);
  }
  function navigate(e, tx, tz, speed, dt, zig = 0) {
    const R = L.REGIONS[e.region];
    let gx = tx, gz = tz;
    const d = Math.hypot(tx - e.pos.x, tz - e.pos.z);
    const los = d < 22 && L.nav.lineOfSight(R, e.pos.x, e.pos.z, tx, tz);
    if (!los && L.nav.flowStep(R, e.pos.x, e.pos.z, navTmp)) { gx = navTmp.x; gz = navTmp.z; }
    let dx = gx - e.pos.x, dz = gz - e.pos.z;
    const L2 = Math.hypot(dx, dz) || 1;
    dx /= L2; dz /= L2;
    if (zig && los && d > 4) { const s = Math.sin(game.time * 2.6 + e.phase) * zig; const px = -dz, pz = dx; dx += px * s; dz += pz * s; const n = Math.hypot(dx, dz); dx /= n; dz /= n; }
    e.pos.x += dx * speed * dt; e.pos.z += dz * speed * dt;
    e.yaw = angleLerp(e.yaw, Math.atan2(dx, dz), damp(8, dt));
    // open doors along the way
    for (const door of L.doors) {
      if (door.region !== e.region || door.open || door.locked || door.kind === 'transition') continue;
      if (Math.hypot(door.x - e.pos.x, door.z - e.pos.z) < 1.3) { setDoor(door, true); S.door(); }
    }
  }
  const faceP = (e, dt, rate = 8) => { e.yaw = angleLerp(e.yaw, Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z), damp(rate, dt)); };
  const facingDot = (e) => { const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1; return (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d; };
  function updateEnemies(dt) {
    const R = L.REGIONS[P.region];
    // the flow field toward the player, shared by every chaser
    flowT -= dt;
    if (flowT <= 0 && enemies.some((e) => e.alive && e.region === P.region && (e.alerted || e.def.stalker))) { flowT = 0.3; L.nav.flowFrom(R, P.pos.x, P.pos.z, 80); }
    let threat = 0;
    for (const e of enemies.slice()) {
      if (e.region !== P.region) continue;
      e.t += dt;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, dist = Math.hypot(dx, dz);
      if (e.alive) {
        e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
        e.vel.multiplyScalar(Math.exp(-6 * dt));
        if (e.alerted && dist < 18) threat = Math.max(threat, e.def.boss ? 1 : 0.7);
        if (e.def.stalker && dist < 26) threat = 1;
        // notice the player
        if (!e.alerted && !P.dead && e.state !== 'dormant' && e.state !== 'rise' && !L.inSafe(P.region, P.pos.x, P.pos.z) && canSee(e, e.def.sight * (P.light ? 1 : 0.6))) alert(e);
        switch (e.type) {
          case 'hollowed': case 'alpha': aiHollowed(e, dt, dist); break;
          case 'maiden': aiMaiden(e, dt, dist); break;
          case 'shepherd': aiShepherd(e, dt, dist); break;
          case 'countess': aiCountess(e, dt, dist); break;
          case 'beast': aiBeast(e, dt, dist); break;
          default: break;
        }
        if (e.type !== 'beast') {
          for (const o of enemies) {
            if (o === e || !o.alive || o.region !== e.region || o.type === 'beast') continue;
            const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, od = Math.hypot(ox, oz), m = e.def.radius + o.def.radius;
            if (od < m && od > 1e-4) { e.pos.x += ox / od * (m - od) * 0.5; e.pos.z += oz / od * (m - od) * 0.5; }
          }
          const m = e.def.radius + 0.32;
          if (dist < m && dist > 1e-4 && !P.dead) { e.pos.x -= dx / dist * (m - dist); e.pos.z -= dz / dist * (m - dist); }
          L.colliders.push(e.pos, e.def.radius * 0.8);
          if (e.state !== 'rise' && e.state !== 'perch') e.pos.y = L.heightAt(e.pos.x, e.pos.z);
        }
        e.root.rotation.y = e.yaw;
        updateSpheres(e);
        // footsteps you can hear
        e.stepT -= dt;
        if (e.stepT <= 0 && dist < 16 && (e.state === 'chase' || e.state === 'stalk')) { e.stepT = e.type === 'countess' ? 0.75 : e.type === 'shepherd' ? 0.6 : 0.35; S.step(e.type === 'countess' || e.type === 'shepherd' ? 0 : 0.5); }
        if (e.flash > 0) { e.flash = Math.max(0, e.flash - dt * 6); for (const m2 of e.mats) { const b = m2.userData.e0; m2.emissive.setRGB(b.r + e.flash * 0.5, b.g + e.flash * 0.08, b.b + e.flash * 0.05); } }
      } else {
        animDead(e, dt);
      }
    }
    fear = lerp(fear, threat, damp(1.5, dt));
    S.setTension(threat);
  }
  // --- animation helpers
  function animMove(e, dt, speed, hunch = 0.35) {
    const h = e.h;
    MO.resetPose(h);
    const run = clamp((speed - 2) / 4, 0, 1);
    e.walkPh += dt * (4 + speed * 2.2);
    MO.poseWalk(h, e.walkPh, clamp(speed / 2, 0, 1), run);
    h.torso.rotation.x += hunch;
    h.neck.rotation.x = -hunch * 0.6;
    if (h.jaw) h.jaw.rotation.x = 0.15 + Math.max(0, Math.sin(game.time * 6 + e.phase)) * 0.15;
  }
  function animDead(e, dt) {
    e.deadT += dt;
    const k = clamp(e.deadT / 0.5, 0, 1);
    if (e.type === 'beast') return;
    if (e.ash) { e.root.scale.setScalar(Math.max(0.01, 1 - e.deadT * 1.2)); if (e.deadT > 1) removeEnemy(e); return; }
    e.rig.rotation.x = -smooth(k) * Math.PI / 2;
    e.rig.position.y = lerp(0.97 * e.scale, 0.25 * e.scale, smooth(k));
    if (!e.pooled && e.deadT > 0.6) { e.pooled = true; FX.decals.add(e.pos.x - Math.sin(e.yaw) * 0.8 * e.scale, e.pos.z - Math.cos(e.yaw) * 0.8 * e.scale, rand(1.0, 1.6) * e.scale); }
  }
  // --- Hollowed and the Alpha
  function aiHollowed(e, dt, dist) {
    const h = e.h, alpha = e.type === 'alpha';
    switch (e.state) {
      case 'feed':
        MO.resetPose(h);
        h.hips.position.y = 0.55; h.torso.rotation.x = 1.1; h.neck.rotation.x = 0.3 + Math.sin(game.time * 7 + e.phase) * 0.25;
        for (const l of h.legs) { l.hp.rotation.x = -1.6; l.kn.rotation.x = 2.2; }
        for (const a of h.arms) { a.sh.rotation.x = -1.3 + Math.sin(game.time * 5 + a.s) * 0.2; a.el.rotation.x = -1.0; }
        if (h.jaw) h.jaw.rotation.x = 0.2 + Math.abs(Math.sin(game.time * 9)) * 0.3;
        if (dist < 4 && !P.dead) alert(e);
        break;
      case 'idle': case 'wander': {
        e.wander.t -= dt;
        if (e.wander.t <= 0) { e.wander.t = rand(3, 7); const a = rand(0, TAU), r = rand(0, 5); e.wander.x = e.home.x + Math.sin(a) * r; e.wander.z = e.home.z + Math.cos(a) * r; }
        const wx = e.wander.x - e.pos.x, wz = e.wander.z - e.pos.z, wd = Math.hypot(wx, wz);
        if (wd > 0.6) { e.pos.x += wx / wd * e.def.walk * dt; e.pos.z += wz / wd * e.def.walk * dt; e.yaw = angleLerp(e.yaw, Math.atan2(wx, wz), damp(4, dt)); animMove(e, dt, e.def.walk); }
        else { animMove(e, dt, 0); h.neck.rotation.y = Math.sin(game.time * 0.7 + e.phase) * 0.6; }
        break;
      }
      case 'dormant':
        MO.resetPose(h); h.torso.rotation.x = 0.5; h.neck.rotation.x = 0.6;
        break;
      case 'chase': {
        if (P.dead || L.inSafe(P.region, P.pos.x, P.pos.z)) { e.state = 'wander'; e.alerted = false; break; }
        const speed = alpha ? e.def.run : (dist > 3 ? e.def.run : 2.5);
        navigate(e, P.pos.x, P.pos.z, speed, dt, alpha ? 0 : 0.7);
        animMove(e, dt, speed, alpha ? 0.25 : 0.5);
        e.cd -= dt;
        if (dist < e.def.reach + 0.3 && e.cd <= 0) { e.state = 'windup'; e.t = 0; S.growl(alpha ? 0.7 : 1.1); }
        else if (!alpha && dist > 3.5 && dist < 6 && e.cd <= 0 && Math.random() < dt * 0.8 && L.nav.lineOfSight(L.REGIONS[e.region], e.pos.x, e.pos.z, P.pos.x, P.pos.z)) { e.state = 'pounce'; e.t = 0; S.snarl(); }
        break;
      }
      case 'windup': {
        faceP(e, dt, 6);
        animMove(e, dt, 0);
        const k = clamp(e.t / (alpha ? 0.8 : 0.42), 0, 1);
        h.arms[0].sh.rotation.x = -2.6 * k; h.arms[0].sh.rotation.y = -0.5 * k;
        if (!alpha) { h.arms[1].sh.rotation.x = -2.3 * k; }
        h.torso.rotation.y = 0.5 * k;
        if (e.t > (alpha ? 0.8 : 0.42)) { e.state = 'strike'; e.t = 0; e.didHit = false; S.knife(); }
        break;
      }
      case 'strike': {
        animMove(e, dt, 0);
        const k = clamp(e.t / 0.15, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-2.6, -0.4, k); h.torso.rotation.y = lerp(0.5, -0.5, k); h.torso.rotation.x = 0.5;
        if (!alpha) h.arms[1].sh.rotation.x = lerp(-2.3, -0.3, k);
        if (!e.didHit && e.t > 0.1) { e.didHit = true; if (dist < e.def.reach + 0.5 && facingDot(e) > 0.3) hurtPlayer(e.def.dmg, e.pos); }
        if (e.t > 0.35) { e.state = 'recover'; e.t = 0; }
        break;
      }
      case 'recover':
        animMove(e, dt, 0); h.torso.rotation.x = 0.6;
        if (e.t > (alpha ? 0.9 : 0.55)) { e.state = 'chase'; e.cd = rand(0.5, 1.4); }
        break;
      case 'pounce': {
        const k = e.t;
        if (k < 0.35) { faceP(e, dt, 10); animMove(e, dt, 0); h.hips.position.y = 0.8; h.torso.rotation.x = 0.9; e.leap = V3(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z).normalize(); }
        else {
          e.pos.x += e.leap.x * 9 * dt; e.pos.z += e.leap.z * 9 * dt;
          animMove(e, dt, 6); h.torso.rotation.x = 0.4;
          for (const a of h.arms) a.sh.rotation.x = -1.8;
          if (!e.didHit && dist < 1.3) { e.didHit = true; hurtPlayer(e.def.dmg + 4, e.pos); }
          if (k > 0.8) { e.state = 'recover'; e.t = 0; e.didHit = false; }
        }
        break;
      }
      case 'flinch':
        animMove(e, dt, 0); h.torso.rotation.x = -0.4; h.neck.rotation.x = -0.5;
        for (const a of h.arms) a.sh.rotation.z = a.s * 0.8;
        if (e.t > e.flinchDur) { e.state = 'chase'; e.cd = rand(0.2, 0.6); }
        break;
      default: e.state = 'chase';
    }
  }
  // --- Ashmaidens: slow, relentless, grabbing
  function aiMaiden(e, dt, dist) {
    const h = e.h;
    if (Math.random() < dt * 3) FX.dust.emit(e.pos.x + rand(-0.3, 0.3), e.pos.y + rand(0.2, 1.6), e.pos.z + rand(-0.3, 0.3), 1, { color: 0x4a4642, speed: 0.3, life: 1.5, grav: -0.3 });
    switch (e.state) {
      case 'rise': {
        const gy = L.heightAt(e.pos.x, e.pos.z);
        if (e.wait && !firedTriggers.has(e.wait)) { e.t = 0; e.pos.y = gy - 2; break; }
        const k = clamp(e.t / 1.6, 0, 1);
        e.pos.y = lerp(gy - 2, gy, smooth(k));
        MO.resetPose(h); for (const a of h.arms) a.sh.rotation.x = -2.6 + k;
        if (Math.random() < 0.5) FX.dust.emit(e.pos.x, gy + 0.2, e.pos.z, 2, { color: 0x3a3632, speed: 1, up: 1, life: 1.2, grav: -0.3, spread: 0.4 });
        faceP(e, dt, 3);
        if (k >= 1) { e.state = 'chase'; e.alerted = true; S.scream(1.3); }
        break;
      }
      case 'idle': case 'wander':
        MO.resetPose(h); h.neck.rotation.z = Math.sin(game.time + e.phase) * 0.3; h.torso.rotation.x = 0.2;
        break;
      case 'chase':
        if (P.dead || L.inSafe(P.region, P.pos.x, P.pos.z)) { e.state = 'idle'; e.alerted = false; break; }
        navigate(e, P.pos.x, P.pos.z, dist < 6 ? e.def.run : e.def.walk * 1.5, dt);
        animMove(e, dt, 1.5, 0.15);
        h.neck.rotation.z = Math.sin(game.time * 3 + e.phase) * 0.4;
        for (const a of h.arms) { a.sh.rotation.x = -1.3; a.el.rotation.x = -0.2; }
        e.cd -= dt;
        if (dist < e.def.reach + 0.2 && e.cd <= 0) { e.state = 'windup'; e.t = 0; }
        break;
      case 'windup':
        faceP(e, dt, 5); MO.resetPose(h);
        for (const a of h.arms) a.sh.rotation.x = -1.8 - e.t;
        if (e.t > 0.6) { e.state = 'strike'; e.t = 0; e.didHit = false; }
        break;
      case 'strike':
        MO.resetPose(h); for (const a of h.arms) a.sh.rotation.x = -1.4;
        h.torso.rotation.x = 0.4;
        e.pos.x += Math.sin(e.yaw) * 3 * dt * (e.t < 0.2 ? 1 : 0); e.pos.z += Math.cos(e.yaw) * 3 * dt * (e.t < 0.2 ? 1 : 0);
        if (!e.didHit && e.t > 0.12) { e.didHit = true; if (dist < e.def.reach + 0.6 && facingDot(e) > 0.3) { hurtPlayer(e.def.dmg, e.pos); S.scream(1.6); } }
        if (e.t > 0.5) { e.state = 'chase'; e.cd = rand(0.8, 1.6); }
        break;
      case 'flinch':
        MO.resetPose(h); h.torso.rotation.x = -0.3; h.neck.rotation.x = -0.4;
        if (e.t > e.flinchDur) e.state = 'chase';
        break;
      default: e.state = 'chase';
    }
  }
  // --- the Shepherd
  function aiShepherd(e, dt, dist) {
    const h = e.h;
    switch (e.state) {
      case 'rise': {
        const k = clamp(e.t / 2.4, 0, 1);
        e.pos.y = lerp(-3.5, 0, smooth(k));
        MO.resetPose(h); h.neck.rotation.x = -0.5; h.arms[0].sh.rotation.x = -0.4;
        if (Math.random() < 0.7) FX.dust.emit(e.pos.x + rand(-1, 1), 0.3, e.pos.z + rand(-1, 1), 3, { color: 0x6a6460, speed: 2, up: 2, life: 1.2, grav: -0.3 });
        if (k >= 1) { e.state = 'chase'; e.alerted = true; e.cd = 1.5; e.chargeCd = 4; }
        break;
      }
      case 'chase': {
        if (P.dead) break;
        bossBar('The Shepherd', e.hp / e.maxHp);
        navigate(e, P.pos.x, P.pos.z, e.def.walk, dt);
        animMove(e, dt, e.def.walk, 0.2);
        h.arms[0].sh.rotation.x = -0.3;
        e.cd -= dt; e.chargeCd -= dt;
        if (!e.summoned1 && e.hp < e.maxHp * 0.6) { e.summoned1 = true; summon(e); }
        if (!e.summoned2 && e.hp < e.maxHp * 0.3) { e.summoned2 = true; summon(e); }
        if (dist < 3.6 && e.cd <= 0) { e.state = 'slam'; e.t = 0; e.didHit = false; S.growl(0.5); }
        else if (dist > 7 && e.chargeCd <= 0 && L.nav.lineOfSight(L.REGIONS[e.region], e.pos.x, e.pos.z, P.pos.x, P.pos.z)) { e.state = 'charge0'; e.t = 0; e.didHit = false; S.scream(0.4); }
        break;
      }
      case 'slam': {
        MO.resetPose(h);
        if (e.t < 1.0) { faceP(e, dt, 3); const k = smooth(e.t); h.arms[0].sh.rotation.x = -3.0 * k; h.torso.rotation.x = -0.2 * k; }
        else {
          const k = clamp((e.t - 1.0) / 0.15, 0, 1); h.arms[0].sh.rotation.x = lerp(-3.0, -0.7, k); h.torso.rotation.x = 0.5 * k;
          if (!e.didHit && k >= 1) {
            e.didHit = true; S.boom(); shake = Math.max(shake, 0.5);
            const ix = e.pos.x + Math.sin(e.yaw) * 2.8, iz = e.pos.z + Math.cos(e.yaw) * 2.8;
            FX.dust.emit(ix, 0.2, iz, 40, { color: 0x6a6460, speed: 5, up: 2, life: 1, grav: 3 });
            if (Math.hypot(P.pos.x - ix, P.pos.z - iz) < 2.8) hurtPlayer(e.def.dmg, e.pos);
          }
        }
        if (e.t > 1.9) { e.state = 'chase'; e.cd = rand(1.2, 2.2); }
        break;
      }
      case 'charge0':
        faceP(e, dt, 4); animMove(e, dt, 0, 0.6); h.neck.rotation.x = 0.3;
        if (e.t > 0.9) { e.state = 'charge'; e.t = 0; e.dir = V3(Math.sin(e.yaw), 0, Math.cos(e.yaw)); }
        break;
      case 'charge': {
        e.pos.x += e.dir.x * e.def.run * dt; e.pos.z += e.dir.z * e.def.run * dt;
        animMove(e, dt, 8, 0.6);
        if (!e.didHit && dist < 2.0) { e.didHit = true; hurtPlayer(30, e.pos); }
        const hit = L.colliders.blockedAt(e.pos.x + e.dir.x * 1.2, e.pos.z + e.dir.z * 1.2, 0.2, (c) => !c.door);
        if (hit && e.t > 0.2) { e.state = 'stunned'; e.t = 0; S.boom(); shake = Math.max(shake, 0.5); toast('He is stunned. Shoot the growth on his back!', 2.4); }
        else if (e.t > 1.6) { e.state = 'chase'; e.cd = 1; e.chargeCd = rand(4, 7); }
        break;
      }
      case 'stunned':
        MO.resetPose(h); h.hips.position.y = 0.75; h.torso.rotation.x = 0.9; h.neck.rotation.x = 0.4;
        for (const l of h.legs) { l.hp.rotation.x = -1.2; l.kn.rotation.x = 1.6; }
        if (e.t > 3.2) { e.state = 'chase'; e.cd = 1; e.chargeCd = rand(4, 7); }
        break;
      default: e.state = 'chase';
    }
  }
  function summon(e) {
    S.bell(); S.scream(0.5);
    say('The Shepherd', 'The flock... must be kept!', 3);
    for (let i = 0; i < 2; i++) {
      const a = rand(0, TAU), x = clamp(e.pos.x + Math.sin(a) * 8, -17, 17), z = clamp(e.pos.z + Math.cos(a) * 8, -110, -88);
      const m = spawnEnemy({ id: 'summon' + uid++, type: 'hollowed', x, z, state: 'chase' });
      m.alerted = true;
    }
  }
  function onShepherdDead() {
    setFlag('shepherdDead');
    bossBar(null);
    S.stinger();
    const g = L.REGIONS.village.cemGate;
    g.open = true; g.collider.on = false;
    const back = L.doors.find((d) => d.id === 'church_back'); back.locked = false;
    setTimeout(() => { say('Nadia', 'Rest now, Brother Matthias.', 3); objective('Cross the bridge north of the cemetery to the castle'); }, 1500);
  }
  // --- Countess Velmira
  function aiCountess(e, dt, dist) {
    const h = e.h;
    const inCellar = P.pos.x > CX + 38;
    if (e.state === 'perch') { MO.resetPose(h); h.neck.rotation.x = 0.3; faceP(e, dt, 2); return; }
    if (e.state === 'appear') {
      MO.resetPose(h);
      if (e.t > 1.6) { e.state = 'stalk'; e.t = 0; }
      return;
    }
    if (e.state === 'flinch') {
      MO.resetPose(h); h.torso.rotation.x = -0.35; h.neck.rotation.x = -0.4; h.arms[0].sh.rotation.x = -1.2;
      if (e.t > e.flinchDur) { e.state = 'stalk'; e.t = 0; }
      return;
    }
    const safe = L.inSafe(P.region, P.pos.x, P.pos.z) || inCellar || P.dead;
    if (e.state === 'stalk') {
      if (safe) {
        MO.resetPose(h); h.neck.rotation.y = Math.sin(game.time * 0.5) * 0.4;
        e.lostT += dt;
      } else {
        navigate(e, P.pos.x, P.pos.z, e.def.walk, dt);
        animMove(e, dt, 1.4, 0.05);
        h.arms[0].sh.rotation.x = -0.4; h.arms[0].el.rotation.x = -0.6;
        const seen = dist < 30 && L.nav.lineOfSight(L.REGIONS[e.region], e.pos.x, e.pos.z, P.pos.x, P.pos.z);
        e.lostT = seen ? 0 : e.lostT + dt;
        if (dist < e.def.reach && !P.dead) { e.state = 'swipe'; e.t = 0; e.didHit = false; }
        if (Math.random() < dt * 0.05) S.laugh();
      }
      // if she has lost you for a while, she finds another way to you
      if (e.lostT > 9 && !safe) {
        let best = null, bd = Infinity;
        for (const [x, z] of L.countessPoints) {
          const d = Math.hypot(x - P.pos.x, z - P.pos.z);
          if (d > 12 && d < bd && !L.nav.lineOfSight(L.REGIONS.castle, x, z, P.pos.x, P.pos.z)) { bd = d; best = [x, z]; }
        }
        if (best) { e.pos.set(best[0], 0, best[1]); e.lostT = 0; S.laugh(); }
      }
      return;
    }
    if (e.state === 'swipe') {
      MO.resetPose(h);
      if (e.t < 0.55) { faceP(e, dt, 6); const k = smooth(e.t / 0.55); h.arms[0].sh.rotation.x = -2.2 * k; h.arms[0].sh.rotation.y = -0.8 * k; h.torso.rotation.y = 0.5 * k; }
      else {
        const k = clamp((e.t - 0.55) / 0.12, 0, 1); h.arms[0].sh.rotation.x = lerp(-2.2, -0.8, k); h.arms[0].sh.rotation.y = lerp(-0.8, 0.9, k); h.torso.rotation.y = lerp(0.5, -0.5, k);
        if (!e.didHit && k >= 1) { e.didHit = true; S.knife(); if (dist < e.def.reach + 0.6 && facingDot(e) > 0.2) { hurtPlayer(e.def.dmg, e.pos); FX.blood.emit(P.pos.x, P.pos.y + 1.4, P.pos.z, 25, { speed: 4, size: 0.08 }); } }
      }
      if (e.t > 1.6) { e.state = 'stalk'; e.t = 0; }
    }
  }
  // --- the Countess's true form
  function aiBeast(e, dt, dist) {
    const h = e.h, cx = RX, cz = 0;
    const flap = (rate, amp) => { for (const w of h.wings) w.w.rotation.z = -w.s * Math.sin(game.time * rate) * amp; };
    switch (e.state) {
      case 'rise': {
        const k = clamp(e.t / 2.5, 0, 1);
        e.pos.set(cx, lerp(-8, 6, smooth(k)), cz - 14);
        flap(6, 0.6);
        e.yaw = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z);
        if (k >= 1) { e.state = 'fly'; e.t = 0; e.ang = Math.atan2(e.pos.x - cx, e.pos.z - cz); e.cd = 3; }
        break;
      }
      case 'fly': {
        e.ang += dt * 0.45;
        const tx = cx + Math.sin(e.ang) * 15, tz = cz + Math.cos(e.ang) * 15;
        e.pos.x = lerp(e.pos.x, tx, damp(2, dt)); e.pos.z = lerp(e.pos.z, tz, damp(2, dt)); e.pos.y = lerp(e.pos.y, 6 + Math.sin(game.time * 1.3) * 0.8, damp(2, dt));
        e.yaw = angleLerp(e.yaw, Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z), damp(3, dt));
        h.torso.rotation.x = 0.2;
        flap(5, 0.55);
        if (Math.random() < dt * 0.6) S.flap();
        e.cd -= dt;
        if (e.cd <= 0) {
          if (Math.random() < 0.6) { e.state = 'screech'; e.t = 0; S.scream(0.5); }
          else { e.state = 'land'; e.t = 0; e.landAt = V3(cx + rand(-6, 6), 0, cz + rand(-6, 6)); }
        }
        break;
      }
      case 'screech':
        flap(9, 0.8); h.head.rotation.x = -0.5;
        e.yaw = angleLerp(e.yaw, Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z), damp(6, dt));
        if (e.t > 0.9) { e.state = 'dive'; e.t = 0; e.didHit = false; e.target = V3(P.pos.x, 0.8, P.pos.z); e.start = e.pos.clone(); }
        break;
      case 'dive': {
        const k = clamp(e.t / 0.7, 0, 1);
        e.pos.lerpVectors(e.start, e.target, smooth(k));
        flap(2, 0.2); h.torso.rotation.x = 0.7;
        if (!e.didHit && Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z) < 2.6 && e.pos.y < 2.5) { e.didHit = true; hurtPlayer(e.def.dmg, e.pos); }
        if (k >= 1) { S.boom(); shake = Math.max(shake, 0.5); FX.dust.emit(e.pos.x, 0.3, e.pos.z, 40, { color: 0x6a6460, speed: 5, up: 2, life: 1, grav: 3 }); e.state = 'grounded'; e.t = 0; e.cd = 0.8; }
        break;
      }
      case 'land': {
        const k = clamp(e.t / 1.5, 0, 1);
        e.pos.x = lerp(e.pos.x, e.landAt.x, damp(3, dt)); e.pos.z = lerp(e.pos.z, e.landAt.z, damp(3, dt)); e.pos.y = lerp(e.pos.y, 0.9, damp(3, dt));
        flap(7, 0.6);
        if (k >= 1) { e.state = 'grounded'; e.t = 0; e.cd = 0.6; }
        break;
      }
      case 'grounded': {
        flap(1.5, 0.15); h.torso.rotation.x = 0.1;
        e.yaw = angleLerp(e.yaw, Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z), damp(3, dt));
        if (dist > 4) { e.pos.x += Math.sin(e.yaw) * 2.2 * dt; e.pos.z += Math.cos(e.yaw) * 2.2 * dt; }
        e.cd -= dt;
        for (const a of h.arms) a.sh.rotation.x = Math.sin(game.time * 3 + a.s) * 0.2;
        if (dist < 4.8 && e.cd <= 0) { e.state = 'claw'; e.t = 0; e.didHit = false; S.scream(0.8); }
        if (e.t > 5.5) { e.state = 'fly'; e.t = 0; e.cd = rand(2, 4); e.ang = Math.atan2(e.pos.x - cx, e.pos.z - cz); S.flap(); }
        break;
      }
      case 'claw': {
        const k = clamp(e.t / 0.5, 0, 1);
        for (const a of h.arms) a.sh.rotation.x = k < 1 ? -1.6 * k : lerp(-1.6, 0.6, clamp((e.t - 0.5) / 0.12, 0, 1));
        if (!e.didHit && e.t > 0.6) { e.didHit = true; if (dist < 5.2 && facingDot(e) > 0.3) hurtPlayer(26, e.pos); }
        if (e.t > 1.1) { e.state = 'grounded'; e.cd = rand(0.8, 1.6); }
        break;
      }
      default: e.state = 'fly';
    }
    e.pos.x = clamp(e.pos.x, cx - 25, cx + 25); e.pos.z = clamp(e.pos.z, cz - 25, cz + 25);
    if (e.alive) bossBar('Velmira, the Night Mother', e.hp / e.maxHp);
  }
  function onBeastDead(e) {
    bossBar(null);
    S.scream(0.4); S.boom();
    e.state = 'dead';
    setFlag('beastDead');
    const start = e.pos.clone();
    let t = 0;
    const fall = () => {
      t += 1 / 60;
      e.pos.y = Math.max(0.6, start.y - t * t * 6);
      e.root.rotation.z = Math.min(1.2, t * 0.8);
      if (Math.random() < 0.6) FX.blood.emit(e.pos.x, e.pos.y + 1, e.pos.z, 4, { speed: 3, size: 0.12 });
      if (t < 2) requestAnimationFrame(fall);
    };
    fall();
    setTimeout(ending, 3000);
  }

  // ===================================================================
  // Boss bar
  // ===================================================================
  function bossBar(name, frac) {
    if (!name) { ui.boss.hidden = true; return; }
    ui.boss.hidden = false; ui.bossName.textContent = name; ui.bossFill.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%';
  }

  // ===================================================================
  // Events
  // ===================================================================
  let siege = null;
  function checkTriggers() {
    for (const tr of L.triggers) {
      if (firedTriggers.has(tr.id) || tr.region !== P.region) continue;
      if (P.pos.x > tr.x0 && P.pos.x < tr.x1 && P.pos.z > tr.z0 && P.pos.z < tr.z1) { firedTriggers.add(tr.id); onTrigger(tr.id); }
    }
  }
  function onTrigger(id) {
    switch (id) {
      case 'feedingScare': {
        const f = enemies.find((e) => e.id === 'v_feed');
        if (f && f.alive && !f.alerted) { S.stinger(); setTimeout(() => { if (f.alive) alert(f); }, 900); say('Nadia', 'Oh God... what is that?', 3); }
        break;
      }
      case 'enterVillage':
        if (!flags.gateOpen) { firedTriggers.delete(id); break; }
        startSiege();
        break;
      case 'churchAmbush':
        if (!flags.churchOpen) { firedTriggers.delete(id); break; }
        S.stinger();
        for (const e of enemies) if (e.id.startsWith('v_church') && e.alive) { e.state = 'chase'; alert(e); }
        break;
      case 'shepherd': shepherdIntro(); break;
      case 'countessIntro': countessIntro(); break;
      case 'cellarScare':
        S.stinger(); S.scream(1.2);
        for (const e of enemies) if (e.id.startsWith('c_cel') && e.alive) { if (e.state === 'rise') e.t = 0; else alert(e); }
        break;
      case 'roofBoss': beastIntro(); break;
      default: break;
    }
  }
  function startSiege() {
    if (flags.siegeDone || siege) return;
    siege = { t: 0, dur: 95, spawned: 0, total: 14, next: 3, bell: 0 };
    S.bell();
    say('Nadia', 'The bell... the note said to hold out until it stops.', 4);
    objective('Survive until the bell stops ringing');
    toast('Survive', 3);
  }
  const SIEGE_SPOTS = [[-30, -50], [30, -48], [-40, -12], [40, -18], [0, -58], [-22, -62], [24, -60], [-45, -40], [44, -38]];
  function updateSiege(dt) {
    if (!siege) return;
    siege.t += dt;
    siege.bell -= dt;
    if (siege.bell <= 0) { siege.bell = 6; S.bell(); }
    siege.next -= dt;
    const alive = enemies.filter((e) => e.alive && e.siege).length;
    if (siege.next <= 0 && siege.spawned < siege.total && alive < 5 && siege.t < siege.dur - 10) {
      siege.next = rand(4, 7);
      const spots = SIEGE_SPOTS.filter(([x, z]) => Math.hypot(x - P.pos.x, z - P.pos.z) > 16);
      const [x, z] = spots[Math.floor(Math.random() * spots.length)] || SIEGE_SPOTS[0];
      const e = spawnEnemy({ id: 'siege' + uid++, type: 'hollowed', x: x + rand(-2, 2), z: z + rand(-2, 2), state: 'chase' });
      e.siege = true; e.alerted = true;
      siege.spawned++;
      if (Math.random() < 0.4) S.howl();
    }
    $('siegeTimer').hidden = false;
    $('siegeTimer').textContent = `${Math.max(0, Math.ceil(siege.dur - siege.t))}`;
    if (siege.t >= siege.dur) {
      siege = null;
      $('siegeTimer').hidden = true;
      for (const e of enemies.slice()) if (e.siege && e.alive) { e.state = 'flee'; e.alive = false; removeEnemy(e); }
      S.howl();
      say('', 'The bell falls silent. The creatures melt back into the dark.', 4);
      setFlag('siegeDone');
      setTimeout(() => {
        objective('Find a way into the church. Light burns in the Chapel of Saint Ivo to the east.');
        toast('A merchant has arrived at the Chapel of Saint Ivo', 4);
      }, 2500);
    }
  }
  function shepherdIntro() {
    const back = L.doors.find((d) => d.id === 'church_back');
    setDoor(back, false); back.locked = true; back.lock = 'flag:shepherdDead';
    const e = spawnEnemy({ id: 'shepherd', type: 'shepherd', x: 0, z: -101, state: 'rise', yaw: 0 });
    e.alerted = true;
    S.bell(); S.stinger();
    cutscene([
      { dur: 2.4, look: [0, 2.5, -101], line: ['', 'The ground of the cemetery heaves.'] },
      { dur: 2.2, look: [0, 4, -101], line: ['The Shepherd', 'None... cross... to the Lady\'s bridge.'] },
    ], () => { bossBar('The Shepherd', 1); objective('Defeat the Shepherd'); });
  }
  function countessIntro() {
    const e = spawnEnemy({ id: 'countess', type: 'countess', x: CX, z: -8.6, state: 'perch', yaw: 0 });
    e.pos.y = 3.4;
    setFlag('countessIntro');
    S.stinger();
    cutscene([
      { dur: 3.2, look: [CX, 5.5, -8.6], line: ['Countess Velmira', 'Another Vos at my door. Your sister bled so beautifully.'] },
      { dur: 3.0, look: [CX, 5.5, -8.6], line: ['Countess Velmira', 'Let us see if you are as generous. Run, little one.'] },
      { dur: 0.8, look: [CX, 2.2, -4], at: () => { e.pos.set(CX, 0, -4); S.boom(); shake = 0.6; S.laugh(); } },
    ], () => {
      e.state = 'appear'; e.t = 0;
      objective('Find the three masks. Avoid the Countess. You cannot kill her.');
      toast('Run', 2);
    });
  }
  function beastIntro() {
    if (flags.beastDead) return;
    const e = spawnEnemy({ id: 'beast', type: 'beast', x: RX, z: -14, state: 'rise' });
    e.alerted = true;
    S.stinger(); S.scream(0.4);
    cutscene([
      { dur: 3, look: [RX, 4, -14], line: ['Velmira', 'You took my masks. You took my halls. You will not take my night!'] },
    ], () => { bossBar('Velmira, the Night Mother', 1); objective('Destroy Velmira. Aim for the glowing heart.'); });
  }
  function ending() {
    cutscene([
      { dur: 3.5, look: [RX, 1, -10], line: ['', 'The thing that was the Countess shudders, and is still.'] },
      { dur: 4, look: [RX, 0.5, 0], line: ['Nadia', 'Ilse\'s locket... she wore it when she left home.'] },
      { dur: 4.5, look: [RX, 6, -30], line: ['Ilse (faint, from somewhere below)', 'Nadia... the crypts... please...'] },
    ], () => {
      game.state = 'end';
      unlockPointer();
      const mins = Math.floor(game.time / 60), secs = Math.floor(game.time % 60);
      $('endStats').textContent = `${game.kills} creatures slain · ${mins}:${String(secs).padStart(2, '0')} played · ${P.marks} marks left`;
      showScreen('end');
      S.setTension(0);
    });
  }

  // ===================================================================
  // Cutscenes
  // ===================================================================
  let cut = null;
  function cutscene(steps, done) {
    game.state = 'cutscene';
    cut = { steps, i: 0, t: 0, done, from: null };
    ui.letterbox.classList.add('on');
    startStep();
  }
  function startStep() {
    const s = cut.steps[cut.i];
    if (!s) return;
    cut.t = 0;
    cut.fromQ = camera.quaternion.clone();
    if (s.line) say(s.line[0], s.line[1], s.dur + 0.3);
    if (s.at) s.at();
  }
  const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion();
  function updateCutscene(dt) {
    const s = cut.steps[cut.i];
    cut.t += dt;
    if (s.look) {
      lookM.lookAt(camera.position, tmpA.set(s.look[0], s.look[1], s.look[2]), V3(0, 1, 0));
      lookQ.setFromRotationMatrix(lookM);
      camera.quaternion.slerpQuaternions(cut.fromQ, lookQ, smooth(clamp(cut.t / Math.min(1.2, s.dur), 0, 1)));
    }
    if (cut.t >= s.dur) {
      cut.i++;
      if (cut.i >= cut.steps.length) {
        const done = cut.done; cut = null;
        ui.letterbox.classList.remove('on');
        // hand the view back to the player, facing where the camera ended up
        const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        P.yaw = e.y; P.pitch = clamp(e.x, -1.2, 1.2);
        game.state = 'play';
        if (done) done();
        return;
      }
      startStep();
    }
  }

  // ===================================================================
  // Region transitions
  // ===================================================================
  let pendingTransition = null;
  function transition(to) {
    if (pendingTransition) return;
    pendingTransition = to;
    fadeTarget = 1;
    setTimeout(() => {
      enterRegion(to.region, to.x, to.z, to.yaw);
      pendingTransition = null;
      fadeTarget = 0;
    }, 450);
  }
  function enterRegion(region, x, z, yaw) {
    // creatures of the old region rest; the placed ones return when you come back
    for (const e of enemies.slice()) {
      if (e.region !== region) { if (e.alive && !e.siege && !e.id.startsWith('summon')) spawned.delete(e.id); removeEnemy(e); }
    }
    P.region = region;
    L.setRegion(region);
    P.pos.set(x, L.heightAt(x, z), z);
    P.vel.set(0, 0, 0);
    if (yaw !== undefined) P.yaw = yaw;
    P.pitch = 0;
    bossBar(null);
    spawnPending();
    // the Countess follows you back into the main halls
    if (region === 'castle' && flags.countessIntro && !flags.chapelOpen && !enemies.some((e) => e.type === 'countess')) {
      const pt = L.countessPoints.slice().sort((a, b) => Math.hypot(b[0] - x, b[1] - z) - Math.hypot(a[0] - x, a[1] - z))[0];
      const c = spawnEnemy({ id: 'countess', type: 'countess', x: pt[0], z: pt[1], state: 'stalk' });
      c.alerted = true;
    }
    if (S.ready) S.startAmbience(L.REGIONS[region].amb);
  }

  // ===================================================================
  // Saving
  // ===================================================================
  const SAVE_KEY = 'varkova-save';
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function saveGame(at) {
    const data = {
      v: 1, region: P.region, x: at ? at.x : P.pos.x, z: at ? at.z : P.pos.z, yaw: P.yaw,
      hp: P.hp, weapons: P.weapons, mag: P.mag, up: P.up, marks: P.marks, weapon: P.weapon,
      inv: { cols: inv.cols, rows: inv.rows, items: inv.items, keys: inv.keys, files: inv.files },
      flags, picked: [...picked], killed: [...killed], triggers: [...firedTriggers], time: game.time, kills: game.kills, objective: game.objective,
      doors: L.doors.map((d) => [d.id, d.locked]), busts: L.busts.map((b) => b.idx), gate: L.gate.open, cem: L.REGIONS.village.cemGate.open,
      caseLvl: P.caseLvl || 0,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  function loadGame() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
    if (!data) return false;
    resetWorld();
    Object.assign(flags, data.flags);
    data.picked.forEach((id) => picked.add(id));
    data.killed.forEach((id) => killed.add(id));
    data.triggers.forEach((id) => firedTriggers.add(id));
    Object.assign(P, { hp: data.hp, weapons: data.weapons, mag: data.mag, up: data.up, marks: data.marks, weapon: data.weapon, caseLvl: data.caseLvl || 0 });
    inv.cols = data.inv.cols; inv.rows = data.inv.rows; inv.items = data.inv.items; inv.keys = data.inv.keys; inv.files = data.inv.files;
    uid = inv.items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
    game.time = data.time; game.kills = data.kills;
    for (const [id, locked] of data.doors) { const d = L.doors.find((x) => x.id === id); if (d) d.locked = locked; }
    data.busts.forEach((idx, i) => { L.busts[i].idx = idx; });
    L.gate.open = data.gate; L.gate.collider.on = !data.gate;
    const cg = L.REGIONS.village.cemGate; cg.open = data.cem; cg.collider.on = !data.cem;
    buildPickups(); buildCrates();
    enterRegion(data.region, data.x, data.z, data.yaw);
    objective(data.objective || '');
    return true;
  }
  function resetWorld() {
    for (const e of enemies.slice()) removeEnemy(e);
    for (const g of gibs) if (g.m.parent) g.m.parent.remove(g.m);
    gibs.length = 0;
    [picked, killed, spawned, firedTriggers].forEach((s) => s.clear());
    for (const k in flags) delete flags[k];
    for (const d of L.doors) { d.locked = !!d.lock; setDoor(d, false); d.openT = 0; }
    L.busts.forEach((b, i) => { b.idx = [2, 3, 0][i]; });
    L.gate.open = false; L.gate.t = 0; L.gate.collider.on = true;
    const cg = L.REGIONS.village.cemGate; cg.open = false; cg.t = 0; cg.collider.on = true;
    Object.assign(P, { hp: 100, maxHp: 100, stamina: 100, weapon: 'knife', weapons: { knife: true }, mag: { pistol: 0, shotgun: 0 }, up: { pistolDmg: 0, pistolCap: 0, shotgunDmg: 0, shotgunCap: 0 }, marks: 0, dead: false, deadT: 0, reloading: false, aim: 0, caseLvl: 0 });
    inv.cols = 6; inv.rows = 4; inv.items = []; inv.keys = []; inv.files = [];
    siege = null; $('siegeTimer').hidden = true;
    bossBar(null);
    FX.clear();
    game.time = 0; game.kills = 0;
  }

  // ===================================================================
  // Menus: inventory, notes, merchant, map, save
  // ===================================================================
  let selected = null;
  function openInventory() {
    if (!playing()) return;
    game.state = 'menu'; unlockPointer();
    renderInventory(); showScreen('inventory');
  }
  function condition() {
    const f = P.hp / P.maxHp;
    return f > 0.66 ? ['Fine', 'fine'] : f > 0.33 ? ['Caution', 'caution'] : ['Danger', 'danger'];
  }
  function renderInventory() {
    const grid = $('caseGrid');
    grid.style.setProperty('--cols', inv.cols); grid.style.setProperty('--rows', inv.rows);
    grid.innerHTML = '';
    for (let i = 0; i < inv.cols * inv.rows; i++) { const c = document.createElement('div'); c.className = 'cell'; grid.appendChild(c); }
    for (const it of inv.items) {
      const el = document.createElement('button');
      el.type = 'button'; el.className = 'item' + (selected === it ? ' sel' : '');
      el.style.gridColumn = `${it.x + 1} / span ${it.w}`; el.style.gridRow = `${it.y + 1} / span ${it.h}`;
      el.innerHTML = `<img alt="" src="${iconFor(it.type)}"><span>${it.count > 1 ? it.count : ''}</span>`;
      el.title = ITEMS[it.type].name;
      el.addEventListener('click', () => { selected = it; renderInventory(); });
      grid.appendChild(el);
    }
    // detail
    const d = $('itemDetail');
    if (selected && inv.items.includes(selected)) {
      const def = ITEMS[selected.type];
      const btns = [];
      if (def.heal) btns.push(`<button class="btn" id="useBtn" type="button">Use</button>`);
      if (selected.type === 'herb' && countItem('herb') >= 2) btns.push(`<button class="btn ghost" id="craftBtn" type="button">Combine into tincture</button>`);
      btns.push(`<button class="btn ghost" id="dropBtn" type="button">Discard</button>`);
      d.innerHTML = `<h3>${def.name}${selected.count > 1 ? ` ×${selected.count}` : ''}</h3><p>${def.desc}</p>${def.value ? `<p class="val">Worth ${def.value} marks to a merchant</p>` : ''}<div class="row">${btns.join('')}</div>`;
      const u = $('useBtn'); if (u) u.onclick = () => { takeItem(selected.type, 1); heal(def.heal); S.pickup(); selected = null; renderInventory(); };
      const c = $('craftBtn'); if (c) c.onclick = () => { takeItem('herb', 2); const left = addItem('medicine', 1); if (left) { addItem('herb', 2); toast('No room'); } else S.pickup(); selected = null; renderInventory(); };
      const dr = $('dropBtn'); dr.onclick = () => { inv.items = inv.items.filter((x) => x !== selected); dropPickup(selected.type, selected.count, P.pos.x - Math.sin(P.yaw) * 0.8, P.pos.z - Math.cos(P.yaw) * 0.8); selected = null; renderInventory(); };
    } else d.innerHTML = '<p class="muted">Select an item to see what it does.</p>';
    // weapons
    $('weaponList').innerHTML = ORDER.filter((w) => P.weapons[w]).map((w) => {
      const W = WEAPONS[w];
      const ammo = w === 'knife' ? '—' : `${P.mag[w]} / ${weaponCap(w)} · ${countItem(W.ammo)} in case`;
      return `<li class="${P.weapon === w ? 'on' : ''}" data-w="${w}"><b>${W.name}</b><span>${ammo}</span></li>`;
    }).join('');
    document.querySelectorAll('#weaponList li').forEach((li) => li.addEventListener('click', () => { equip(li.dataset.w); renderInventory(); }));
    $('keyList').innerHTML = inv.keys.length ? inv.keys.map((k) => `<li title="${KEYS[k].desc}"><b>${KEYS[k].name}</b><span>${KEYS[k].desc}</span></li>`).join('') : '<li class="muted">No key items</li>';
    $('fileList').innerHTML = inv.files.map((f) => `<li><button type="button" data-f="${f}">${NOTES[f].title}</button></li>`).join('') || '<li class="muted">No documents</li>';
    document.querySelectorAll('#fileList button').forEach((b) => b.addEventListener('click', () => openNote(b.dataset.f, 'inventory')));
    const [cond, cls] = condition();
    $('invCondition').textContent = cond; $('invCondition').className = 'cond ' + cls;
    $('invMarks').textContent = P.marks;
    $('invObjective').textContent = game.objective;
  }
  let noteReturn = null;
  function openNote(id, ret = null) {
    noteReturn = ret;
    game.state = 'menu'; unlockPointer();
    $('noteTitle').textContent = NOTES[id].title;
    $('noteText').textContent = NOTES[id].text;
    showScreen('note');
  }
  function closeMenu() {
    if (noteReturn === 'inventory' && !$('note').hidden) { noteReturn = null; renderInventory(); showScreen('inventory'); return; }
    showScreen(null);
    game.state = 'play';
    lockPointer();
  }
  // merchant
  const SHOP = [
    { id: 'ammoP', name: 'Pistol Rounds ×12', price: 400, buy: () => addItem('pistolAmmo', 12) === 0 },
    { id: 'ammoS', name: 'Shotgun Shells ×4', price: 650, need: 'shotgun', buy: () => addItem('shells', 4) === 0 },
    { id: 'herb', name: 'Bitterleaf', price: 450, buy: () => addItem('herb', 1) === 0 },
    { id: 'med', name: 'Tincture', price: 1500, buy: () => addItem('medicine', 1) === 0 },
    { id: 'case1', name: 'Larger Case (7 × 5)', price: 2500, once: 1, buy: () => { resizeCase(7, 5); P.caseLvl = 1; return true; } },
    { id: 'case2', name: 'Larger Case (8 × 6)', price: 4500, once: 2, buy: () => { resizeCase(8, 6); P.caseLvl = 2; return true; } },
  ];
  const UPG = [
    { id: 'pistolDmg', name: 'Pistol: power +25%', weapon: 'pistol', max: 3, price: (l) => 1500 + l * 1000 },
    { id: 'pistolCap', name: 'Pistol: magazine +4', weapon: 'pistol', max: 2, price: (l) => 1200 + l * 800 },
    { id: 'shotgunDmg', name: 'Shotgun: power +25%', weapon: 'shotgun', max: 3, price: (l) => 2500 + l * 1500 },
    { id: 'shotgunCap', name: 'Shotgun: capacity +2', weapon: 'shotgun', max: 2, price: (l) => 2000 + l * 1000 },
  ];
  let shopTab = 'buy';
  function openMerchant() {
    game.state = 'menu'; unlockPointer();
    S.merchant();
    say('Brask', ['A living customer! The beasts never buy anything.', 'Come in, come in. Brask has what you need. For a price.', 'Still breathing? Good for business.'][Math.floor(Math.random() * 3)], 3);
    renderMerchant(); showScreen('merchant');
  }
  function renderMerchant() {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === shopTab));
    $('shopMarks').textContent = P.marks;
    const list = $('shopList');
    let rows = [];
    if (shopTab === 'buy') {
      rows = SHOP.filter((s) => (!s.need || P.weapons[s.need]) && (!s.once || (P.caseLvl || 0) === s.once - 1)).map((s) => ({ name: s.name, price: s.price, act: () => { if (P.marks < s.price) return; if (s.buy()) { P.marks -= s.price; S.coin(); } else toast('No room in your case'); } }));
    } else if (shopTab === 'sell') {
      rows = inv.items.filter((it) => ITEMS[it.type].value).map((it) => ({ name: ITEMS[it.type].name, price: ITEMS[it.type].value, sell: true, act: () => { inv.items = inv.items.filter((x) => x !== it); P.marks += ITEMS[it.type].value; S.coin(); } }));
      if (!rows.length) list.innerHTML = '<li class="muted">Brask buys treasures. You have none to sell.</li>';
    } else {
      rows = UPG.filter((u) => P.weapons[u.weapon]).map((u) => {
        const l = P.up[u.id], maxed = l >= u.max, price = u.price(l);
        return { name: `${u.name} <small>${'◆'.repeat(l)}${'◇'.repeat(u.max - l)}</small>`, price: maxed ? null : price, act: () => { if (maxed || P.marks < price) return; P.marks -= price; P.up[u.id]++; S.coin(); S.reload(); } };
      });
    }
    if (rows.length || shopTab !== 'sell') {
      list.innerHTML = '';
      for (const r of rows) {
        const li = document.createElement('li');
        const can = r.sell || (r.price !== null && P.marks >= r.price);
        li.innerHTML = `<span>${r.name}</span>`;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn' + (r.sell ? ' ghost' : '');
        b.textContent = r.price === null ? 'Maxed' : r.sell ? `Sell · ${r.price}` : `${r.price}`;
        b.disabled = !can;
        b.addEventListener('click', () => { r.act(); renderMerchant(); });
        li.appendChild(b);
        list.appendChild(li);
      }
    }
  }
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { shopTab = b.dataset.tab; renderMerchant(); }));
  // save dialog
  let saveAt = null;
  function openSave(at) {
    saveAt = at;
    game.state = 'menu'; unlockPointer();
    $('saveMsg').textContent = 'The ledger is open. Your progress will be written here.';
    showScreen('saveDlg');
  }
  $('saveYes').addEventListener('click', () => {
    const ok = saveGame({ x: P.pos.x, z: P.pos.z });
    S.save();
    $('saveMsg').textContent = ok ? 'Progress saved.' : 'Your browser blocked saving.';
    setTimeout(closeMenu, 700);
  });
  // map
  const mapCache = {};
  function openMap() {
    if (!playing()) return;
    game.state = 'menu'; unlockPointer();
    const R = L.REGIONS[P.region], nav = R.nav;
    if (!mapCache[P.region]) {
      const c = document.createElement('canvas'); c.width = nav.nx; c.height = nav.nz;
      const g = c.getContext('2d'), img = g.createImageData(nav.nx, nav.nz);
      for (let i = 0; i < nav.cells.length; i++) {
        const v = nav.cells[i], k = i * 4;
        const col = v === 1 ? [26, 20, 16] : v === 2 ? [190, 150, 80] : v === 3 ? [80, 140, 90] : [92, 84, 72];
        img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      mapCache[P.region] = c;
    }
    const src = mapCache[P.region], cv = $('mapCanvas'), g = cv.getContext('2d');
    // crop to the explored-relevant part: the whole region, fitted
    const s = Math.min(cv.width / src.width, cv.height / src.height);
    g.fillStyle = '#0d0a08'; g.fillRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false;
    const ox = (cv.width - src.width * s) / 2, oy = (cv.height - src.height * s) / 2;
    g.drawImage(src, ox, oy, src.width * s, src.height * s);
    const toMap = (x, z) => [ox + (x - R.x0) / nav.cell * s, oy + (z - R.z0) / nav.cell * s];
    g.fillStyle = '#6ab0ff';
    for (const it of L.interact) if (it.region === P.region && it.kind === 'ledger') { const [mx, my] = toMap(it.x, it.z); g.beginPath(); g.arc(mx, my, 5, 0, TAU); g.fill(); }
    const [px, py] = toMap(P.pos.x, P.pos.z);
    g.save(); g.translate(px, py); g.rotate(-P.yaw + Math.PI);
    g.beginPath(); g.moveTo(0, 9); g.lineTo(6, -6); g.lineTo(0, -3); g.lineTo(-6, -6); g.closePath();
    g.fillStyle = '#ff5a3a'; g.fill(); g.strokeStyle = '#000'; g.stroke(); g.restore();
    $('mapTitle').textContent = { village: 'Varkova', castle: 'Castle Velmira', roof: 'The Roof Garden' }[P.region];
    $('mapObjective').textContent = game.objective;
    showScreen('map');
  }

  // ===================================================================
  // Input
  // ===================================================================
  const keys = {};
  const canvas = G.renderer.domElement;
  const isTouch = G.settings.isTouch;
  const touchMove = { x: 0, y: 0 };
  let aimHeld = false, lockedOnce = false;
  const locked = () => document.pointerLockElement === canvas;
  function lockPointer() { if (isTouch || !canvas.requestPointerLock) return; try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* unavailable */ } }
  function unlockPointer() { if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); } }
  window.addEventListener('keydown', (e) => {
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === 'menu') { closeMenu(); return; }
      if (playing()) pause(); else if (game.state === 'pause') resume();
      return;
    }
    if (e.code === 'Tab' || e.code === 'KeyI') { if (game.state === 'menu' && !$('inventory').hidden) closeMenu(); else openInventory(); return; }
    if (e.code === 'KeyM') { if (game.state === 'menu' && !$('map').hidden) closeMenu(); else openMap(); return; }
    if (!playing()) return;
    switch (e.code) {
      case 'KeyE': interactNow(); break;
      case 'KeyR': startReload(); break;
      case 'KeyF': P.light = !P.light; S.empty(); break;
      case 'KeyQ': quickHeal(); break;
      case 'Digit1': equip('knife'); break;
      case 'Digit2': equip('pistol'); break;
      case 'Digit3': equip('shotgun'); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; aimHeld = false; if (playing()) pause(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (isTouch || !playing()) return;
    if (!locked()) { lockPointer(); return; }
    if (e.button === 0) { P.mouseDown = true; fire(); }
    if (e.button === 2) aimHeld = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) aimHeld = false; if (e.button === 0) P.mouseDown = false; });
  window.addEventListener('wheel', (e) => { if (playing()) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  window.addEventListener('mousemove', (e) => {
    if (!playing() || !locked()) return;
    // browsers can report one huge jump right after the pointer locks; ignore spikes
    if (Math.abs(e.movementX) > 180 || Math.abs(e.movementY) > 180) return;
    const s = 0.0021 * G.settings.sens * (1 - P.aim * 0.4);
    P.yaw -= e.movementX * s; P.pitch = clamp(P.pitch - e.movementY * s, -1.4, 1.4);
    swayX += clamp(e.movementX * 0.02, -1, 1); swayY += clamp(-e.movementY * 0.02, -1, 1);
  });
  document.addEventListener('pointerlockchange', () => {
    if (locked()) lockedOnce = true;
    else if (lockedOnce && playing()) pause();
  });
  (function touch() {
    const stick = $('stick'), knob = $('knob');
    let sid = null, lid = null, lx = 0, ly = 0;
    const moveStick = (e) => {
      if (e.pointerId !== sid) return;
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const L2 = Math.hypot(dx, dy), max = r.width / 2;
      if (L2 > max) { dx = dx / L2 * max; dy = dy / L2 * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      touchMove.x = dx / max; touchMove.y = -dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
    stick.addEventListener('pointermove', moveStick);
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; touchMove.x = touchMove.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const acts = {
      fire: () => fire(), aim: () => { aimHeld = !aimHeld; }, reload: startReload, use: interactNow, light: () => { P.light = !P.light; },
      bag: openInventory, swap: () => cycleWeapon(1), heal: quickHeal, map: openMap, pause: () => pause(),
    };
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const f = acts[b.dataset.act]; if (f) f(); }));
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || lid !== null) return; lid = e.pointerId; lx = e.clientX; ly = e.clientY; });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lid || !playing()) return;
      P.yaw -= (e.clientX - lx) * 0.005 * G.settings.sens; P.pitch = clamp(P.pitch - (e.clientY - ly) * 0.004 * G.settings.sens, -1.4, 1.4);
      lx = e.clientX; ly = e.clientY;
    });
    const endL = (e) => { if (e.pointerId === lid) lid = null; };
    canvas.addEventListener('pointerup', endL); canvas.addEventListener('pointercancel', endL);
  })();

  // ===================================================================
  // Flow: title, pause, death
  // ===================================================================
  function placeCamera() {
    camera.position.set(P.pos.x, P.pos.y + EYE, P.pos.z);
    camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
  }
  function newGame() {
    S.init();
    resetWorld();
    buildPickups(); buildCrates();
    enterRegion('village', L.roadX(84) + 0.5, 84, 0);
    placeCamera();
    game.state = 'play';
    showScreen(null);
    ui.hud.hidden = false; ui.touch.hidden = !isTouch;
    lockPointer();
    // waking up beside the car
    P.pitch = -0.3;
    fade = 1; fadeTarget = 0;
    inv.files.push('car');
    cutscene([
      { dur: 3.2, look: [L.roadX(88) + 1.5, 0.6, 88], line: ['Nadia', 'The road just... ended. The car is finished.'] },
      { dur: 3.6, look: [0, 1.8, 60], line: ['Nadia', 'Ilse\'s letter said Varkova. It has to be close. I\'ll walk.'] },
    ], () => {
      objective('Follow the road north to the village of Varkova');
      toast('Press E to interact · Tab opens your case · M opens the map', 5);
    });
  }
  function pause() {
    if (!playing()) return;
    game.state = 'pause'; unlockPointer();
    $('pauseObjective').textContent = game.objective;
    menuLabels();
    showScreen('pause');
  }
  function resume() { if (game.state !== 'pause') return; game.state = 'play'; showScreen(null); lockPointer(); }
  function menuLabels() {
    $('qualityBtn').textContent = `Graphics: ${G.settings.quality}`;
    $('bloodBtn').textContent = `Blood: ${G.settings.blood ? 'on' : 'off'}`;
    $('sensBtn').textContent = `Mouse: ${G.settings.sens <= 0.7 ? 'slow' : G.settings.sens >= 1.4 ? 'fast' : 'normal'}`;
    $('muteBtn').textContent = S.muted ? 'Sound: off' : 'Sound: on';
  }
  function toTitle() {
    game.state = 'title';
    S.setTension(0); S.stopAmbience();
    ui.hud.hidden = true; ui.touch.hidden = true;
    $('continueBtn').hidden = !hasSave();
    showScreen('title');
  }
  $('newBtn').addEventListener('click', newGame);
  $('continueBtn').addEventListener('click', () => { S.init(); if (loadGame()) { game.state = 'play'; showScreen(null); ui.hud.hidden = false; ui.touch.hidden = !isTouch; lockPointer(); fade = 1; fadeTarget = 0; } });
  $('resumeBtn').addEventListener('click', resume);
  $('loadBtn').addEventListener('click', () => { if (hasSave()) $('continueBtn').click(); else newGame(); });
  $('titleBtn').addEventListener('click', toTitle);
  $('qualityBtn').addEventListener('click', () => { G.settings.quality = G.settings.quality === 'high' ? 'low' : 'high'; G.saveSettings(); G.applyQuality(); menuLabels(); });
  $('bloodBtn').addEventListener('click', () => { G.settings.blood = !G.settings.blood; if (!G.settings.blood) { FX.blood.clear(); FX.decals.clear(); } G.saveSettings(); menuLabels(); });
  $('sensBtn').addEventListener('click', () => { G.settings.sens = G.settings.sens <= 0.7 ? 1 : G.settings.sens >= 1.4 ? 0.6 : 1.5; G.saveSettings(); menuLabels(); });
  $('muteBtn').addEventListener('click', () => { S.toggleMute(); menuLabels(); });
  $('deadContinue').addEventListener('click', () => { if (hasSave()) $('continueBtn').click(); else newGame(); });
  $('deadTitle').addEventListener('click', toTitle);
  $('endTitle').addEventListener('click', toTitle);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMenu));

  // ===================================================================
  // Player update
  // ===================================================================
  function updatePlayer(dt) {
    if (P.dead) {
      P.deadT += dt;
      const k = clamp(P.deadT / 1.0, 0, 1);
      camera.position.set(P.pos.x, P.pos.y + lerp(EYE, 0.3, smooth(k)), P.pos.z);
      camera.rotation.set(P.pitch * (1 - k) + k * 0.4, P.yaw, k * 1.2, 'YXZ');
      return;
    }
    const fwdIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchMove.y;
    const sideIn = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
    const len = Math.hypot(fwdIn, sideIn);
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    P.aim = lerp(P.aim, aimHeld && P.weapon !== 'knife' && !P.reloading && P.switchT <= 0 ? 1 : 0, damp(12, dt));
    const wantSprint = (keys.ShiftLeft || keys.ShiftRight || (isTouch && len > 0.95)) && fwdIn > 0.3 && P.aim < 0.3 && P.stamina > 1;
    let speed = wantSprint ? 5.4 : 3.1;
    if (fwdIn < 0) speed = 2.3;
    if (P.aim > 0.5) speed = 1.7;
    if (P.hp < P.maxHp * 0.33) speed *= 0.85;
    let mx = 0, mz = 0;
    if (len > 0.05) { const n = Math.min(1, len); mx = (fx * fwdIn + rx * sideIn) / len * n * speed; mz = (fz * fwdIn + rz * sideIn) / len * n * speed; }
    P.vel.x = lerp(P.vel.x, mx, damp(10, dt)); P.vel.z = lerp(P.vel.z, mz, damp(10, dt));
    if (wantSprint && len > 0.1) { P.stamina = Math.max(0, P.stamina - dt * 16); P.staminaT = 1.2; }
    else { P.staminaT -= dt; if (P.staminaT <= 0) P.stamina = Math.min(100, P.stamina + dt * 18); }
    // move with collisions; banks too high to climb stop you
    const ox = P.pos.x, oz = P.pos.z;
    P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
    if (L.heightAt(P.pos.x, P.pos.z) > L.WALK_H) {
      P.pos.x = ox; if (L.heightAt(P.pos.x, P.pos.z + 0) > L.WALK_H) P.pos.z = oz;
      P.pos.x = ox + P.vel.x * dt; if (L.heightAt(P.pos.x, P.pos.z) > L.WALK_H) P.pos.x = ox;
    }
    L.colliders.push(P.pos, 0.32);
    const R = L.REGIONS[P.region];
    P.pos.x = clamp(P.pos.x, R.x0 + 1, R.x1 - 1); P.pos.z = clamp(P.pos.z, R.z0 + 1, R.z1 - 1);
    P.pos.y = L.heightAt(P.pos.x, P.pos.z);
    const hs = Math.hypot(P.vel.x, P.vel.z);
    P.bob += dt * hs * 2.2;
    P.stepT -= dt * hs;
    if (P.stepT <= 0 && hs > 0.5) { P.stepT = 1.25; S.step(P.region === 'village' ? 0 : 0.3); }
    // weapon timers
    P.fireT = Math.max(0, P.fireT - dt);
    P.switchT = Math.max(0, P.switchT - dt);
    P.knifeT = Math.max(0, P.knifeT - dt);
    P.recoil = Math.max(0, P.recoil - dt * 6);
    if (P.reloading) { P.reloadT -= dt; if (P.reloadT <= 0) finishReload(); }
    if (P.mouseDown && P.weapon === 'knife' && P.fireT <= 0 && playing()) fire();
    // camera
    shake = Math.max(0, shake - dt * 1.6);
    const s = shake * shake * 0.6;
    const bob = Math.sin(P.bob * 2) * 0.03 * Math.min(1, hs / 3) * (1 - P.aim);
    camera.position.set(P.pos.x, P.pos.y + EYE + bob, P.pos.z);
    camera.rotation.set(P.pitch + rand(-1, 1) * s * 0.1, P.yaw + rand(-1, 1) * s * 0.1, Math.sin(P.bob) * 0.006 * Math.min(1, hs / 3), 'YXZ');
    camera.fov = lerp(70, 55, P.aim); camera.updateProjectionMatrix();
    flashlight.visible = P.light;
    flashlight.intensity = P.light ? 2.4 * (0.97 + Math.sin(game.time * 13) * 0.015) : 0;
    // low health heartbeat
    P.hbT = (P.hbT || 0) - dt;
    if (P.hp < P.maxHp * 0.33 && P.hbT <= 0) { P.hbT = 0.9; S.heartbeat(); }
  }
  // doors swing, gates slide
  function updateDoors(dt) {
    for (const d of L.doors) {
      if (d.region !== P.region) continue;
      const target = d.open ? 1 : 0;
      d.openT = lerp(d.openT, target, damp(7, dt));
      d.pivot.rotation.y = d.rot + d.openT * 1.65 * d.dir;
    }
    const g = L.gate;
    g.t = lerp(g.t, g.open ? 1 : 0, damp(1.2, dt));
    g.mesh.position.y = g.t * 4.2;
    const cg = L.REGIONS.village.cemGate;
    cg.t = lerp(cg.t, cg.open ? 1 : 0, damp(1.5, dt));
    cg.mesh.position.y = cg.t * 3.2;
    for (const b of L.busts) b.g.rotation.y = lerp(b.g.rotation.y, b.idx * Math.PI / 2, damp(8, dt));
    for (const { m, it } of merchants) m.visible = !it.flag || !!flags[it.flag];
  }
  function updatePickups(dt) {
    for (const p of pickups) {
      if (p.region !== P.region) continue;
      p.glint.material.opacity = 0.35 + Math.sin(game.time * 3 + p.x) * 0.25;
    }
    for (const g of gibs) {
      if (g.rest) continue;
      g.v.y -= 14 * dt; g.m.position.addScaledVector(g.v, dt);
      g.m.rotation.x += dt * 5;
      const gy = L.heightAt(g.m.position.x, g.m.position.z) + 0.03;
      if (g.m.position.y < gy) { g.m.position.y = gy; g.v.multiplyScalar(0.3); g.v.y = Math.abs(g.v.y) * 0.3; if (g.v.length() < 0.3) g.rest = true; }
    }
  }

  // ===================================================================
  // HUD
  // ===================================================================
  let lastPrompt = '';
  function updateHUD(dt) {
    const w = P.weapon, W = WEAPONS[w];
    if (w === 'knife') { ui.ammoMag.textContent = '—'; ui.ammoRes.textContent = ''; }
    else { ui.ammoMag.textContent = P.mag[w]; ui.ammoRes.textContent = countItem(W.ammo); }
    ui.ammoName.textContent = W.name + (P.reloading ? ' · reloading' : '');
    ui.ammo.classList.toggle('empty', w !== 'knife' && P.mag[w] === 0);
    const spread = (P.weapon === 'shotgun' ? 22 : 10) * (1 - P.aim * 0.6) + Math.hypot(P.vel.x, P.vel.z) * 3 + P.recoil * 10;
    ui.cross.style.setProperty('--s', spread.toFixed(1) + 'px');
    ui.cross.style.opacity = P.weapon === 'knife' ? 0.35 : 1;
    hitMarkT = Math.max(0, hitMarkT - dt);
    ui.hit.style.opacity = hitMarkT > 0 ? 1 : 0;
    let prompt = '';
    if (playing()) { const t = interactTargets(); if (t) prompt = `<kbd>${isTouch ? 'Use' : 'E'}</kbd>${t.label}`; }
    if (prompt !== lastPrompt) { ui.prompt.innerHTML = prompt; ui.prompt.hidden = !prompt; lastPrompt = prompt; }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) ui.toast.classList.remove('show'); }
    if (subT > 0) { subT -= dt; if (subT <= 0) ui.sub.classList.remove('show'); }
    if (objT > 0) { objT -= dt; if (objT <= 0) ui.obj.classList.remove('show'); }
    const f = P.hp / P.maxHp;
    const [cond, cls] = condition();
    ui.vital.className = 'vital ' + cls + (f < 0.999 || P.hurtT > 0 ? ' show' : '');
    ui.vitalRing.style.setProperty('--f', (f * 100).toFixed(1));
    ui.vitalLabel.textContent = cond;
    P.hurtT = Math.max(0, P.hurtT - dt);
    ui.stamina.classList.toggle('show', P.stamina < 99);
    ui.staminaFill.style.width = P.stamina.toFixed(0) + '%';
    hurtFx = Math.max(0, hurtFx - dt * 1.1);
    const low = f < 0.33 && !P.dead ? 0.45 + 0.15 * Math.sin(game.time * 6) : 0;
    ui.blood.style.opacity = G.settings.blood ? (Math.max(hurtFx, low) * 0.85).toFixed(2) : 0;
    G.post.hurt.value = Math.max(hurtFx * 0.5, low * 0.7);
    G.post.fear.value = fear;
    fade = lerp(fade, fadeTarget, damp(6, dt));
    ui.fade.style.opacity = fade.toFixed(3);
  }

  // ===================================================================
  // Main loop
  // ===================================================================
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    if (game.state === 'play') {
      game.time += dt;
      updatePlayer(dt);
      updateEnemies(dt);
      updateSiege(dt);
      checkTriggers();
    } else if (game.state === 'cutscene') {
      updateCutscene(dt);
      updateEnemies(dt);
    } else if (game.state === 'title') {
      // a slow drift down the forest road
      camera.position.set(L.roadX(70) + Math.sin(t * 0.05) * 2, 1.7, 70 - (t * 0.4) % 30);
      camera.rotation.set(0.02, Math.sin(t * 0.1) * 0.2, 0, 'YXZ');
    }
    if (game.state !== 'pause' && game.state !== 'menu') {
      updateDoors(dt);
      updatePickups(dt);
      FX.sparks.update(dt); FX.glow.update(dt); FX.dust.update(dt); FX.blood.update(dt);
    }
    updateViewModel(dt);
    L.update(dt, t, camera);
    G.sky.uniforms.time.value = t;
    G.post.time.value = t % 100;
    if (game.state !== 'title') updateHUD(dt);
    G.render();
  }
  // props for interactables: Brask at his cart, an open ledger on each desk
  const merchants = [];
  for (const it of L.interact) {
    if (it.kind === 'merchant') {
      const m = MO.buildMerchant();
      G.linearize(m);
      m.position.set(it.x, L.heightAt(it.x, it.z), it.z); m.rotation.y = it.rot || 0;
      L.REGIONS[it.region].dynamic.add(m);
      merchants.push({ m, it });
    } else if (it.kind === 'ledger') {
      const g = new THREE.Group();
      const page = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.9 });
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.28), page); p.position.set(s * 0.1, 0, 0); p.rotation.z = -s * 0.08; g.add(p); }
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.015, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a0e0a, roughness: 0.6 })); cover.position.y = -0.015; g.add(cover);
      const quill = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.25, 5), new THREE.MeshStandardMaterial({ color: 0xe8e0d0 })); quill.rotation.z = 1.2; quill.position.set(0.18, 0.06, 0.05); g.add(quill);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.glowTex, color: new THREE.Color(0.6, 0.9, 1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.set(0.6, 0.6, 1); sp.position.y = 0.1; g.add(sp);
      g.position.set(it.x, it.y - 0.04, it.z);
      L.REGIONS[it.region].dynamic.add(g);
    }
  }
  G.linearize(scene);
  L.setRegion('village');
  toTitle();
  requestAnimationFrame(frame);

  // a small handle for automated tests
  window.__varkova = {
    game, P, inv, flags, enemies, L, picked, killed,
    sim(seconds, dt = 1 / 60) { for (let s = 0; s < seconds; s += dt) { if (game.state === 'play') { game.time += dt; updatePlayer(dt); updateEnemies(dt); updateSiege(dt); checkTriggers(); } else if (game.state === 'cutscene') { updateCutscene(dt); updateEnemies(dt); } updateDoors(dt); FX.blood.update(dt); } },
    newGame, fire, interactNow, tryDoor, collect, pickups, crates, equip, addItem, saveGame, loadGame, transition, enterRegion, useInteract, openInventory, closeMenu, openMerchant, openMap,
    setFlag, damageEnemy, killEnemy,
  };
})();
