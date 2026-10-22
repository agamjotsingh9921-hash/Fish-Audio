/* Wrath of Olympus — a Greek-myth hack-and-slash built on Three.js (r128).
   Everything (models, textures, sound) is generated in code; no external assets. */
(() => {
  'use strict';

  // ===================================================================
  // Utilities
  // ===================================================================
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (t) => t * t * (3 - 2 * t);
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  const angleLerp = (a, b, t) => {
    const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    return a + d * t;
  };
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const tmpA = V3(), tmpB = V3(), tmpC = V3();

  // distance from point (px,pz) to segment a-b in the XZ plane; returns [dist, t]
  function segDist2D(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const L = dx * dx + dz * dz;
    let t = L > 1e-6 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return [Math.sqrt(cx * cx + cz * cz), t];
  }

  // ===================================================================
  // Renderer, scene, camera
  // ===================================================================
  const host = $('game');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x140806);
  scene.fog = new THREE.FogExp2(0x2b120b, 0.011);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 700);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ===================================================================
  // Mesh helpers
  // ===================================================================
  const M = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.05, flatShading: true }, o));
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const C = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
  function part(geo, mat, x, y, z, parent, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = shadow;
    if (parent) parent.add(m);
    return m;
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });

  // ===================================================================
  // Audio — everything is synthesised with WebAudio
  // ===================================================================
  const Sound = (() => {
    let ctx = null, master = null, music = null, noiseBuf = null, muted = false;
    let drumTimer = null, nextBeat = 0, beat = 0, droneNodes = [];

    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
      music = ctx.createGain(); music.gain.value = 0.45; music.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function noise(dur, f0, f1, q, vol, type = 'bandpass', at = null, dest = null) {
      if (!ctx) return;
      const t = at === null ? ctx.currentTime : at;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl); fl.connect(g); g.connect(dest || master);
      src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    function tone(dur, f0, f1, vol, type = 'sine', at = null, dest = null) {
      if (!ctx) return;
      const t = at === null ? ctx.currentTime : at;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || master);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function startMusic() {
      if (!ctx || drumTimer) return;
      // low drone of two detuned saws through a dark filter
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
      const dg = ctx.createGain(); dg.gain.value = 0.05;
      lp.connect(dg); dg.connect(music);
      [55, 82.4, 55.4].forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start();
        droneNodes.push(o);
      });
      droneNodes.push(dg);
      nextBeat = ctx.currentTime + 0.1; beat = 0;
      const pattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0];
      drumTimer = setInterval(() => {
        while (nextBeat < ctx.currentTime + 0.25) {
          const s = beat % 16;
          if (pattern[s]) tone(0.35, 120, 38, s % 4 === 0 ? 0.55 : 0.35, 'sine', nextBeat, music);
          if (s === 4 || s === 12) noise(0.18, 1800, 600, 0.9, 0.12, 'bandpass', nextBeat, music);
          nextBeat += 60 / 112 / 2; beat++;
        }
      }, 60);
    }
    function stopMusic() {
      if (drumTimer) { clearInterval(drumTimer); drumTimer = null; }
      droneNodes.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already stopped */ } });
      droneNodes = [];
    }
    return {
      init, startMusic, stopMusic,
      get muted() { return muted; },
      toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.6;
        return muted;
      },
      swoosh(p = 1) { noise(0.22, 500 * p, 2600 * p, 1.4, 0.22); },
      hit(heavy = 0) { noise(0.12, 2800, 300, 0.8, 0.3 + heavy * 0.2, 'lowpass'); tone(0.16, 170, 50, 0.45 + heavy * 0.3); },
      clang() { tone(0.25, 1300, 900, 0.08, 'triangle'); noise(0.1, 4000, 2000, 2, 0.12); },
      boom() { tone(0.8, 95, 26, 0.9); noise(0.7, 900, 60, 0.7, 0.5, 'lowpass'); },
      hurt() { tone(0.2, 190, 80, 0.22, 'square'); noise(0.12, 1400, 300, 1, 0.2); },
      pickup(kind) { const f = { red: 880, green: 620, blue: 1040 }[kind] || 800; tone(0.12, f, f * 1.5, 0.08, 'triangle'); },
      roar(pitch = 1) { tone(1.3, 120 * pitch, 50 * pitch, 0.45, 'sawtooth'); noise(1.3, 500 * pitch, 140, 2, 0.3); },
      screech() { tone(0.45, 1500, 2600, 0.07, 'sawtooth'); noise(0.4, 3000, 5000, 3, 0.1); },
      magic() { tone(1.0, 220, 880, 0.2, 'sawtooth'); noise(1.0, 200, 4000, 0.6, 0.35); tone(0.9, 70, 30, 0.8); },
      rage() { tone(1.2, 80, 160, 0.4, 'sawtooth'); noise(1.0, 300, 1200, 1, 0.3); },
    };
  })();

  // ===================================================================
  // Particles (one additive point cloud per size)
  // ===================================================================
  class Particles {
    constructor(max, size) {
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
      this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.geo = geo;
      const mat = new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.points = new THREE.Points(geo, mat);
      this.points.frustumCulled = false;
      scene.add(this.points);
      this.c1 = new THREE.Color(); this.c2 = new THREE.Color();
    }
    emit(x, y, z, n, o = {}) {
      this.c1.set(o.color !== undefined ? o.color : 0xff8a30);
      this.c2.set(o.color2 !== undefined ? o.color2 : (o.color !== undefined ? o.color : 0xff8a30));
      const s = o.spread || 0, sp0 = o.speed !== undefined ? o.speed : 4;
      for (let k = 0; k < n; k++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = x + rand(-s, s); this.pos[i3 + 1] = y + rand(-s, s) * 0.5; this.pos[i3 + 2] = z + rand(-s, s);
        let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
        const L = Math.hypot(vx, vy, vz) || 1, sp = sp0 * rand(0.3, 1);
        this.vel[i3] = (vx / L) * sp + (o.dx || 0);
        this.vel[i3 + 1] = (vy / L) * sp * (o.flat ? 0.2 : 1) + (o.up || 0);
        this.vel[i3 + 2] = (vz / L) * sp + (o.dz || 0);
        const life = (o.life || 0.6) * rand(0.6, 1.25);
        this.life[i] = life; this.maxLife[i] = life;
        const c = Math.random() < 0.5 ? this.c1 : this.c2;
        this.base[i3] = c.r; this.base[i3 + 1] = c.g; this.base[i3 + 2] = c.b;
        this.grav[i] = o.grav !== undefined ? o.grav : 9;
        this.drag[i] = o.drag !== undefined ? o.drag : 1.5;
      }
    }
    update(dt) {
      const { pos, vel, col, base, life, maxLife, grav, drag } = this;
      for (let i = 0; i < this.max; i++) {
        if (life[i] <= 0) continue;
        const i3 = i * 3;
        life[i] -= dt;
        if (life[i] <= 0) { pos[i3 + 1] = -999; col[i3] = col[i3 + 1] = col[i3 + 2] = 0; continue; }
        const d = Math.exp(-drag[i] * dt);
        vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - grav[i] * dt; vel[i3 + 2] *= d;
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        if (pos[i3 + 1] < 0.03 && grav[i] > 0) { pos[i3 + 1] = 0.03; vel[i3 + 1] *= -0.35; }
        const f = life[i] / maxLife[i];
        col[i3] = base[i3] * f; col[i3 + 1] = base[i3 + 1] * f; col[i3 + 2] = base[i3 + 2] * f;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    clear() { this.life.fill(0); for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -999; this.col.fill(0); }
  }
  const sparks = new Particles(2200, 0.32);
  const flames = new Particles(1400, 0.95);

  // ===================================================================
  // The arena
  // ===================================================================
  const ARENA_R = 29.5;
  const world = {};
  const colliders = []; // {x, z, r}
  const braziers = [];

  (function buildWorld() {
    // light
    scene.add(new THREE.HemisphereLight(0xffb27a, 0x1a0a14, 0.55));
    const sun = new THREE.DirectionalLight(0xffcf9a, 1.15);
    sun.position.set(-25, 45, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 130 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5070b0, 0.3);
    rim.position.set(30, 20, -30);
    scene.add(rim);

    // sky dome
    const skyTex = canvasTex(4, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#040205'); gr.addColorStop(0.38, '#1a0909'); gr.addColorStop(0.5, '#6e2611');
      gr.addColorStop(0.56, '#2b120b'); gr.addColorStop(1, '#120705');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(16, 40), new THREE.MeshBasicMaterial({ color: 0xf6d6a6, fog: false }));
    moon.position.set(-150, 120, -260); moon.lookAt(0, 0, 0); scene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a50, transparent: true, opacity: 0.35, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(110, 110, 1); halo.position.copy(moon.position).multiplyScalar(0.99); scene.add(halo);

    // floor
    const floorTex = canvasTex(512, 512, (g, w) => {
      g.fillStyle = '#211813'; g.fillRect(0, 0, w, w);
      const n = 4, s = w / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        g.fillStyle = `hsl(${18 + Math.random() * 12},${10 + Math.random() * 9}%,${22 + Math.random() * 11}%)`;
        g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
      }
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,230,200,.05)';
        g.fillRect(Math.random() * w, Math.random() * w, 2, 2);
      }
      g.strokeStyle = 'rgba(15,8,5,.6)'; g.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        let x = Math.random() * w, y = Math.random() * w;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += rand(-25, 25); y += rand(-25, 25); g.lineTo(x, y); }
        g.stroke();
      }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(9, 9);
    floorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R + 3, 80), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

    // central mosaic: a meander border and the sixteen-ray Vergina sun
    const mosaic = canvasTex(1024, 1024, (g, w) => {
      const c = w / 2;
      g.translate(c, c);
      g.strokeStyle = '#c99a52'; g.fillStyle = '#c99a52';
      g.lineWidth = 10;
      g.beginPath(); g.arc(0, 0, 500, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, 420, 0, TAU); g.stroke();
      // meander (Greek key) running round the ring
      g.lineWidth = 7;
      const keys = 40;
      for (let k = 0; k < keys; k++) {
        g.save(); g.rotate((k / keys) * TAU);
        g.beginPath();
        g.moveTo(-30, -430); g.lineTo(-30, -490); g.lineTo(28, -490); g.lineTo(28, -445);
        g.lineTo(-8, -445); g.lineTo(-8, -470); g.lineTo(10, -470);
        g.stroke(); g.restore();
      }
      // vergina sun
      g.fillStyle = 'rgba(150,20,24,.6)';
      for (let k = 0; k < 16; k++) {
        g.save(); g.rotate((k / 16) * TAU);
        g.beginPath(); g.moveTo(-26, -70); g.lineTo(0, -330); g.lineTo(26, -70); g.closePath(); g.fill();
        g.restore();
      }
      g.fillStyle = '#c99a52';
      g.beginPath(); g.arc(0, 0, 80, 0, TAU); g.fill();
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(7.5, 64), new THREE.MeshStandardMaterial({ map: mosaic, transparent: true, roughness: 0.6, metalness: 0.3, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.02; disc.receiveShadow = true; scene.add(disc);

    // platform sides and lava sea
    const rock = M(0x2a1c16, { roughness: 1 });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R + 3, ARENA_R + 6, 10, 80, 1, true), rock);
    side.position.y = -5; scene.add(side);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 3, 0.35, 6, 80), M(0x3b2a20));
    rimRing.rotation.x = Math.PI / 2; rimRing.position.y = 0.05; scene.add(rimRing);

    const lavaTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = '#ff5a12'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 30},12,6,${0.7 + Math.random() * 0.3})`;
        g.beginPath(); g.arc(Math.random() * w, Math.random() * w, rand(8, 30), 0, TAU); g.fill();
      }
      g.fillStyle = 'rgba(255,200,80,.35)';
      for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * w, rand(2, 6), 0, TAU); g.fill(); }
    });
    lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping; lavaTex.repeat.set(40, 40);
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ map: lavaTex }));
    lava.rotation.x = -Math.PI / 2; lava.position.y = -8; scene.add(lava);
    world.lavaTex = lavaTex;

    // distant mountains
    const mtn = M(0x140a08, { roughness: 1 });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + rand(-0.1, 0.1), r = rand(150, 220), h = rand(40, 95);
      const m = new THREE.Mesh(new THREE.ConeGeometry(rand(30, 55), h, 6), mtn);
      m.position.set(Math.sin(a) * r, h / 2 - 10, Math.cos(a) * r); m.rotation.y = rand(0, TAU); scene.add(m);
    }

    // columns
    const marble = M(0x8d7f6d, { roughness: 0.85 });
    const marbleDark = M(0x6c5f50, { roughness: 0.9 });
    function column(x, z, h, broken) {
      const g = new THREE.Group();
      const base = part(B(2.5, 0.5, 2.5), marbleDark, 0, 0.25, 0, g); base.receiveShadow = true;
      const shaft = part(C(0.85, 0.98, h, 14), marble, 0, 0.5 + h / 2, 0, g); shaft.receiveShadow = true;
      if (!broken) {
        part(B(2.3, 0.35, 2.3), marbleDark, 0, h + 0.68, 0, g);
        part(C(1.2, 0.9, 0.4, 14), marble, 0, h + 0.35, 0, g);
      } else {
        const cap = part(new THREE.ConeGeometry(0.9, 0.9, 7), marble, 0, h + 0.8, 0, g);
        cap.rotation.z = rand(-0.4, 0.4);
        for (let k = 0; k < 3; k++) {
          const ch = part(B(rand(0.6, 1.2), rand(0.4, 0.8), rand(0.6, 1.2)), marbleDark, rand(-2.4, 2.4), 0.3, rand(-2.4, 2.4), g);
          ch.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
        }
      }
      g.position.set(x, 0, z);
      scene.add(g);
      colliders.push({ x, z, r: 1.25 });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + 0.11;
      const broken = i % 3 === 1;
      column(Math.sin(a) * 26.5, Math.cos(a) * 26.5, broken ? rand(2.5, 5) : rand(8, 11), broken);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      column(Math.sin(a) * 13.5, Math.cos(a) * 13.5, rand(1.6, 3.2), true);
    }

    // braziers
    const bronze = M(0x7a5a2c, { metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const x = Math.sin(a) * 21, z = Math.cos(a) * 21;
      const g = new THREE.Group();
      part(C(0.15, 0.25, 2.2, 8), bronze, 0, 1.1, 0, g);
      part(C(0.75, 0.35, 0.5, 10), bronze, 0, 2.35, 0, g);
      part(C(0.6, 0.6, 0.12, 10), M(0xff7a20, { emissive: 0xff5a10, emissiveIntensity: 1.5 }), 0, 2.55, 0, g, false);
      g.position.set(x, 0, z); scene.add(g);
      const light = new THREE.PointLight(0xff7a2a, 1.6, 26, 1.6);
      light.position.set(x, 3.4, z); scene.add(light);
      braziers.push({ x, z, light, seed: Math.random() * 100 });
      colliders.push({ x, z, r: 0.75 });
    }

    // a colossal statue of a forgotten god watching from beyond the lava
    const stone = 0x4a3b30;
    const st = humanoid({ skin: stone, cloth: 0x3a2d24, metal: 0x5a4a3a, bulk: 1.15 });
    const stRig = makeRig(st, 17, 1);
    stRig.root.position.set(0, -18, -130);
    st.arms[0].sh.rotation.x = -2.6; st.arms[0].el.rotation.x = -0.4;
    st.arms[1].sh.rotation.x = -0.5; st.arms[1].sh.rotation.z = 0.3;
    part(B(0.1, 1.8, 0.03), M(0x5a4a3a), 0, -1.0, 0, st.arms[0].hand, false);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff5a1a, fog: false });
    part(B(0.08, 0.05, 0.02), eyeMat, -0.08, 0.03, 0.2, st.head, false);
    part(B(0.08, 0.05, 0.02), eyeMat, 0.08, 0.03, 0.2, st.head, false);
    stRig.root.traverse((o) => { o.castShadow = false; });
    scene.add(stRig.root);
  })();

  // floating embers across the arena
  const embers = (() => {
    const n = 260, pos = new Float32Array(n * 3), spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = rand(-40, 40); pos[i * 3 + 1] = rand(0, 22); pos[i * 3 + 2] = rand(-40, 40); spd[i] = rand(0.6, 2);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.22, map: glowTex, color: 0xff8a3a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; scene.add(pts);
    return { update(dt, t) {
      for (let i = 0; i < n; i++) {
        pos[i * 3 + 1] += spd[i] * dt;
        pos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.4;
        if (pos[i * 3 + 1] > 22) pos[i * 3 + 1] = 0;
      }
      geo.attributes.position.needsUpdate = true;
    } };
  })();

  // ===================================================================
  // Procedural humanoid rig shared by the Spartan and his enemies
  // ===================================================================
  function humanoid({ skin, cloth, metal, bulk = 1 }) {
    const mats = {
      skin: M(skin),
      cloth: M(cloth),
      metal: M(metal, { metalness: 0.6, roughness: 0.38 }),
      leather: M(0x3a2216),
    };
    const body = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 1.05; body.add(hips);
    part(C(0.36 * bulk, 0.52 * bulk, 0.5, 8), mats.cloth, 0, -0.08, 0, hips);
    part(C(0.38 * bulk, 0.38 * bulk, 0.13, 8), mats.metal, 0, 0.2, 0, hips);
    const torso = new THREE.Group(); torso.position.y = 0.25; hips.add(torso);
    part(B(0.62 * bulk, 0.34, 0.34 * bulk), mats.skin, 0, 0.1, 0, torso);
    const chest = part(B(0.9 * bulk, 0.62, 0.46 * bulk), mats.skin, 0, 0.5, 0, torso);
    const neck = new THREE.Group(); neck.position.y = 0.83; torso.add(neck);
    part(B(0.18, 0.12, 0.18), mats.skin, 0, 0.02, 0, neck);
    const head = new THREE.Group(); head.position.y = 0.26; neck.add(head);
    part(B(0.36, 0.42, 0.38), mats.skin, 0, 0, 0, head);
    const arms = [], legs = [];
    for (const s of [-1, 1]) { // s = -1 is the character's right side (they face +z)
      const sh = new THREE.Group(); sh.position.set(s * 0.56 * bulk, 0.68, 0); sh.rotation.order = 'YXZ'; torso.add(sh);
      part(B(0.25 * bulk, 0.5, 0.25 * bulk), mats.skin, 0, -0.24, 0, sh);
      const el = new THREE.Group(); el.position.y = -0.5; sh.add(el);
      part(B(0.21 * bulk, 0.44, 0.21 * bulk), mats.skin, 0, -0.2, 0, el);
      part(B(0.25 * bulk, 0.22, 0.25 * bulk), mats.metal, 0, -0.27, 0, el);
      const hand = new THREE.Group(); hand.position.y = -0.48; el.add(hand);
      part(B(0.16, 0.16, 0.16), mats.skin, 0, 0, 0, hand);
      arms.push({ sh, el, hand, s });
      const hp = new THREE.Group(); hp.position.set(s * 0.2 * bulk, -0.1, 0); hips.add(hp);
      part(B(0.27 * bulk, 0.5, 0.28 * bulk), mats.skin, 0, -0.24, 0, hp);
      const kn = new THREE.Group(); kn.position.y = -0.48; hp.add(kn);
      part(B(0.22 * bulk, 0.46, 0.22 * bulk), mats.skin, 0, -0.22, 0, kn);
      part(B(0.26 * bulk, 0.3, 0.26 * bulk), mats.metal, 0, -0.2, 0.02, kn);
      part(B(0.24, 0.1, 0.36), mats.leather, 0, -0.47, 0.06, kn);
      legs.push({ hp, kn, s });
    }
    return { body, hips, torso, chest, neck, head, arms, legs, mats };
  }
  function makeRig(h, scale, pivotY = 1) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    rig.position.y = pivotY * scale;
    rig.scale.setScalar(scale);
    h.body.position.y = -pivotY;
    rig.add(h.body);
    root.add(rig);
    return { root, rig };
  }
  function resetPose(h) {
    h.hips.position.y = 1.05;
    h.hips.rotation.set(0, 0, 0);
    h.torso.rotation.set(0, 0, 0);
    h.neck.rotation.set(0, 0, 0);
    for (const a of h.arms) { a.sh.rotation.set(0, 0, a.s * 0.12); a.el.rotation.set(-0.15, 0, 0); }
    for (const l of h.legs) { l.hp.rotation.set(0, 0, 0); l.kn.rotation.set(0, 0, 0); }
  }
  function poseWalk(h, ph, amt) {
    const sw = Math.sin(ph) * amt;
    h.legs[0].hp.rotation.x = -sw * 0.75;
    h.legs[1].hp.rotation.x = sw * 0.75;
    h.legs[0].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4))) * amt;
    h.legs[1].kn.rotation.x = (0.15 + Math.max(0, Math.sin(ph + 1.4 + Math.PI))) * amt;
    h.arms[0].sh.rotation.x = sw * 0.6;
    h.arms[1].sh.rotation.x = -sw * 0.6;
    h.hips.position.y = 1.05 + Math.abs(Math.cos(ph)) * 0.07 * amt;
    h.torso.rotation.x = 0.12 * amt;
  }

  // ===================================================================
  // The Spartan
  // ===================================================================
  const P = {
    state: 'idle', stateT: 0, facing: 0,
    vel: V3(), onGround: true, jumps: 0,
    hp: 100, maxHp: 100, mp: 100, maxMp: 100,
    rage: 0, rageT: 0, rageDur: 8, rageGain: 1, dmgMult: 1,
    invuln: 0, walkPh: 0, attack: null, atkName: '', atkT: 0, impactDone: false,
    comboIdx: 0, comboTimer: 0, queued: null, hitMap: new Map(),
    finTarget: null, finT: 0, dodgeDir: V3(), orbs: 0,
  };
  const spartan = humanoid({ skin: 0xd2cabb, cloth: 0x7a1c12, metal: 0xa08552, bulk: 1.08 });
  {
    const h = spartan, tat = M(0xa8121b, { emissive: 0x400000 }), dark = M(0x2a1a12);
    part(B(0.14, 0.64, 0.02), tat, 0.2, 0.5, 0.255, h.torso);       // tattoo down the chest
    part(B(0.14, 0.02, 0.5), tat, 0.2, 0.815, 0, h.torso);          // over the shoulder
    part(B(0.14, 0.64, 0.02), tat, 0.2, 0.5, -0.255, h.torso);      // down the back
    part(B(0.27, 0.52, 0.27), tat, 0, -0.24, 0, h.arms[1].sh).scale.set(1.01, 0.3, 1.01);
    part(B(0.1, 0.02, 0.39), tat, 0.07, 0.215, 0, h.head);          // across the scalp
    part(B(0.1, 0.3, 0.02), tat, 0.07, 0.07, 0.195, h.head);        // over the left eye
    part(B(0.32, 0.2, 0.12), dark, 0, -0.16, 0.17, h.head);         // beard
    part(B(0.38, 0.06, 0.06), h.mats.skin, 0, 0.08, 0.19, h.head);  // brow
    const eye = new THREE.MeshBasicMaterial({ color: 0xffd27a });
    part(B(0.06, 0.03, 0.02), eye, -0.08, 0.03, 0.2, h.head, false);
    part(B(0.06, 0.03, 0.02), eye, 0.08, 0.03, 0.2, h.head, false);
    const pad = part(B(0.4, 0.16, 0.42), h.mats.metal, 0.06, 0.04, 0, h.arms[1].sh);
    pad.rotation.z = -0.3;
    part(B(0.5, 0.04, 0.04), h.mats.leather, 0, 0.5, 0.26, h.torso).rotation.z = 0.6; // strap
  }
  const pRig = makeRig(spartan, 1, 0.95);
  scene.add(pRig.root);
  P.root = pRig.root; P.rig = pRig.rig; P.pos = pRig.root.position;
  const pLight = new THREE.PointLight(0xff6a20, 0.6, 9, 2);
  pLight.position.y = 1.6; P.root.add(pLight);

  // Blades of Ash on their chains
  function makeBlade(handIdx) {
    const g = new THREE.Group();
    part(B(0.07, 0.07, 0.3), M(0x2a1a10), 0, 0, 0.05, g);
    part(B(0.28, 0.06, 0.07), M(0xa08552, { metalness: 0.7, roughness: 0.3 }), 0, 0, 0.22, g);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8f8a84, metalness: 0.8, roughness: 0.3, emissive: 0xff4a0a, emissiveIntensity: 0.45, flatShading: true });
    part(B(0.17, 0.035, 0.85), mat, 0, 0, 0.66, g);
    const tip = part(new THREE.ConeGeometry(0.085, 0.32, 4), mat, 0, 0, 1.24, g);
    tip.rotation.x = Math.PI / 2; tip.scale.set(1, 1, 0.4);
    scene.add(g);
    // chain: a sagging polyline
    const NCH = 14, cpos = new Float32Array(NCH * 3);
    const cgeo = new THREE.BufferGeometry(); cgeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    const chain = new THREE.Line(cgeo, new THREE.LineBasicMaterial({ color: 0x8a7a68 }));
    chain.frustumCulled = false; scene.add(chain);
    // fire trail ribbon
    const NT = 10, tpos = new Float32Array(NT * 2 * 3), tcol = new Float32Array(NT * 2 * 3), idx = [];
    for (let i = 0; i < NT - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
    tgeo.setIndex(idx);
    const trail = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    trail.frustumCulled = false; scene.add(trail);
    return { g, mat, handIdx, flying: false, chain, cpos, NCH, trail, tpos, tcol, NT, hist: [], hand: V3() };
  }
  const blades = { R: makeBlade(0), L: makeBlade(1) };

  // local (relative to the Spartan's facing) -> world
  function toWorld(x, y, z, out) {
    const c = Math.cos(P.facing), s = Math.sin(P.facing);
    return out.set(P.pos.x + x * c + z * s, P.pos.y + y, P.pos.z - x * s + z * c);
  }

  // Attack paths: t in [0,1] -> [x, y, z] in the Spartan's local frame (+z forward, -x is his right)
  const sweep = (from, to, y, reach) => (t) => {
    const a = lerp(from, to, smooth(t));
    const r = 0.6 + reach * Math.pow(Math.sin(Math.PI * t), 0.6);
    return [Math.sin(a) * r, y + Math.sin(Math.PI * t) * 0.25, Math.cos(a) * r];
  };
  const slam = (x) => (t) => {
    let phi, r;
    if (t < 0.25) { const k = t / 0.25; phi = lerp(90, 150, k) * DEG; r = lerp(0.6, 2.6, k); }
    else if (t < 0.5) { const k = smooth((t - 0.25) / 0.25); phi = lerp(150, -12, k) * DEG; r = lerp(2.6, 6.6, k); }
    else { phi = -12 * DEG; r = lerp(6.6, 0.6, smooth((t - 0.5) / 0.5)); }
    return [x, 1.6 + Math.sin(phi) * r, Math.cos(phi) * r];
  };
  const spin = (off) => (t) => {
    const a = off - smooth(t) * TAU * 2;
    const r = 0.6 + 5.2 * Math.min(1, t * 5, (1 - t) * 5);
    return [Math.sin(a) * r, 1.15 + 0.25 * Math.sin(a * 2), Math.cos(a) * r];
  };
  const dive = (x) => (t) => [x, 0.4 + (1 - t) * 1.2, 1.6 + t * 0.8];
  const ATTACKS = {
    l1: { dur: 0.4, hit: [0.18, 0.66], dmg: 10, knock: 4, stag: 0.35, R: sweep(-120 * DEG, 100 * DEG, 1.3, 5.2) },
    l2: { dur: 0.4, hit: [0.18, 0.66], dmg: 10, knock: 4, stag: 0.35, L: sweep(120 * DEG, -100 * DEG, 1.45, 5.2) },
    l3: { dur: 0.5, hit: [0.15, 0.68], dmg: 12, knock: 5, stag: 0.4, R: sweep(-130 * DEG, 110 * DEG, 1.0, 5.6), L: sweep(130 * DEG, -110 * DEG, 1.75, 5.6) },
    l4: { dur: 0.72, hit: [0.4, 0.62], dmg: 22, knock: 11, stag: 0.9, R: slam(-0.5), L: slam(0.5), impact: 0.5, impactR: 3.4 },
    h1: { dur: 0.95, hit: [0.1, 0.88], dmg: 8, knock: 6, stag: 0.5, rehit: 0.17, R: spin(0), L: spin(Math.PI), heavy: true },
    air: { dur: 9, hit: [0, 1], dmg: 12, knock: 6, stag: 0.5, R: dive(-0.6), L: dive(0.6), air: true },
  };
  const CHAIN = ['l1', 'l2', 'l3', 'l4'];

  // ===================================================================
  // Enemies
  // ===================================================================
  const enemies = [];
  const DEFS = {
    legion:   { hp: 45,   speed: 3.3, radius: 0.6, height: 2.5, dmg: 9,  poise: 0,   red: 25,  name: 'Undead Legionnaire' },
    harpy:    { hp: 28,   speed: 6,   radius: 0.7, height: 1.2, dmg: 8,  poise: 0,   red: 20,  name: 'Harpy' },
    minotaur: { hp: 170,  speed: 2.9, radius: 1.1, height: 3.8, dmg: 18, poise: 40,  red: 90,  name: 'Minotaur' },
    cyclops:  { hp: 1150, speed: 2.4, radius: 2.3, height: 8.5, dmg: 25, poise: 1e9, red: 400, name: 'Cyclops', boss: true },
  };

  function buildLegion() {
    const h = humanoid({ skin: 0x4f6142, cloth: 0x3b2a1e, metal: 0x93702f });
    const red = M(0x8a1a14);
    part(B(0.42, 0.28, 0.44), h.mats.metal, 0, 0.12, 0, h.head);
    part(B(0.06, 0.24, 0.52), red, 0, 0.36, -0.02, h.head);
    part(B(0.08, 0.26, 0.2), h.mats.metal, -0.19, -0.08, 0.1, h.head);
    part(B(0.08, 0.26, 0.2), h.mats.metal, 0.19, -0.08, 0.1, h.head);
    const eye = new THREE.MeshBasicMaterial({ color: 0x7dff6a });
    part(B(0.07, 0.04, 0.02), eye, -0.08, 0.02, 0.2, h.head, false);
    part(B(0.07, 0.04, 0.02), eye, 0.08, 0.02, 0.2, h.head, false);
    part(B(0.94, 0.4, 0.5), h.mats.metal, 0, 0.55, 0, h.torso); // breastplate
    // gladius extends along the arm (local -y of the hand)
    part(B(0.24, 0.05, 0.08), h.mats.metal, 0, -0.1, 0, h.arms[0].hand);
    part(B(0.09, 0.85, 0.03), M(0xb8b0a0, { metalness: 0.8, roughness: 0.3 }), 0, -0.55, 0, h.arms[0].hand);
    const shield = part(C(0.5, 0.5, 0.07, 14), h.mats.metal, 0.17, -0.2, 0, h.arms[1].el);
    shield.rotation.z = Math.PI / 2;
    part(C(0.12, 0.12, 0.09, 8), red, 0.2, -0.2, 0, h.arms[1].el).rotation.z = Math.PI / 2;
    return { h, ...makeRig(h, 1, 0.95) };
  }
  function buildHarpy() {
    const body = new THREE.Group();
    const skin = M(0x9a8a9e), wing = M(0x3a2440, { side: THREE.DoubleSide }), dark = M(0x1a1018);
    const mats = { skin, cloth: wing, metal: dark };
    const torso = part(new THREE.SphereGeometry(0.3, 8, 6), skin, 0, 0.6, 0, body);
    torso.scale.set(1, 1.5, 0.8);
    const head = new THREE.Group(); head.position.set(0, 1.18, 0.05); body.add(head);
    part(new THREE.SphereGeometry(0.17, 8, 6), skin, 0, 0, 0, head);
    part(new THREE.ConeGeometry(0.2, 0.5, 6), dark, 0, 0.05, -0.15, head).rotation.x = -1.1;
    const eye = new THREE.MeshBasicMaterial({ color: 0xffe14a });
    part(B(0.05, 0.03, 0.02), eye, -0.06, 0.02, 0.15, head, false);
    part(B(0.05, 0.03, 0.02), eye, 0.06, 0.02, 0.15, head, false);
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.2, 0.85, -0.05); body.add(w);
      const a = part(B(1.0, 0.04, 0.55), wing, s * 0.55, 0, 0, w);
      const tip = new THREE.Group(); tip.position.x = s * 1.05; w.add(tip);
      part(B(0.9, 0.03, 0.42), wing, s * 0.45, 0, -0.08, tip);
      wings.push({ w, tip, s, a });
      const leg = part(B(0.08, 0.5, 0.08), dark, s * 0.13, 0.12, 0, body);
      leg.rotation.x = 0.4;
      part(new THREE.ConeGeometry(0.06, 0.2, 4), M(0xd8c8a0), s * 0.13, -0.15, 0.12, body).rotation.x = 1.6;
    }
    const h = { body, head, wings, mats, torso };
    return { h, ...makeRig(h, 1.1, 0.6) };
  }
  function buildMinotaur() {
    const h = humanoid({ skin: 0x4a2e22, cloth: 0x2a1a12, metal: 0x6b5a3a, bulk: 1.5 });
    const bone = M(0xe6d9bc), fur = M(0x2c1a12);
    part(B(0.34, 0.24, 0.3), h.mats.skin, 0, -0.08, 0.28, h.head);     // snout
    part(new THREE.TorusGeometry(0.06, 0.015, 4, 10), M(0xd4a640, { metalness: 0.8 }), 0, -0.2, 0.43, h.head);
    for (const s of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.07, 0.6, 6), bone, s * 0.32, 0.2, 0, h.head);
      horn.rotation.z = -s * 1.15;
      part(B(0.5, 0.35, 0.55), fur, s * 0.6, 0.72, 0, h.torso);
    }
    part(B(0.6, 0.3, 0.6), fur, 0, 0.82, -0.05, h.torso);
    const eye = new THREE.MeshBasicMaterial({ color: 0xff3a1a });
    part(B(0.07, 0.04, 0.02), eye, -0.11, 0.06, 0.2, h.head, false);
    part(B(0.07, 0.04, 0.02), eye, 0.11, 0.06, 0.2, h.head, false);
    part(C(0.05, 0.05, 1.7, 6), M(0x3a2618), 0, -0.6, 0, h.arms[0].hand);
    part(B(0.07, 0.55, 0.6), M(0x9a9590, { metalness: 0.8, roughness: 0.35 }), 0, -1.25, 0.2, h.arms[0].hand);
    return { h, ...makeRig(h, 1.45, 0.95) };
  }
  function buildCyclops() {
    const h = humanoid({ skin: 0x8c6c52, cloth: 0x4a2e1e, metal: 0x5a4a3a, bulk: 1.6 });
    const bellyMat = h.mats.skin;
    part(new THREE.SphereGeometry(0.42, 10, 8), bellyMat, 0, 0.25, 0.14, h.torso).scale.set(1.2, 1, 0.9);
    part(new THREE.SphereGeometry(0.12, 12, 10), M(0xf2ead8, { roughness: 0.3 }), 0, 0.06, 0.17, h.head, false);
    const iris = part(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3010 }), 0, 0.06, 0.26, h.head, false);
    part(new THREE.ConeGeometry(0.07, 0.25, 6), M(0xd8c8a8), 0, 0.3, 0, h.head);
    part(B(0.24, 0.05, 0.04), M(0xe8dcc0), 0, -0.14, 0.2, h.head);
    // the club
    part(C(0.1, 0.27, 2.0, 8), M(0x4a3020), 0, -1.0, 0, h.arms[0].hand);
    for (let k = 0; k < 6; k++) {
      const sp = part(new THREE.ConeGeometry(0.05, 0.18, 4), M(0x9a9590, { metalness: 0.7 }), 0, -1.4 - (k % 3) * 0.2, 0, h.arms[0].hand);
      const a = (k / 6) * TAU; sp.position.x = Math.sin(a) * 0.24; sp.position.z = Math.cos(a) * 0.24;
      sp.rotation.set(Math.cos(a) * 1.57, 0, -Math.sin(a) * 1.57);
    }
    h.iris = iris;
    return { h, ...makeRig(h, 3.3, 0.95) };
  }
  const BUILDERS = { legion: buildLegion, harpy: buildHarpy, minotaur: buildMinotaur, cyclops: buildCyclops };

  function enemyHpBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x110806, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.08), new THREE.MeshBasicMaterial({ color: 0xc81c22, fog: false, depthWrite: false }));
    fg.position.z = 0.001;
    g.add(bg, fg); g.visible = false; g.renderOrder = 5;
    return { g, fg };
  }
  const markerGeo = new THREE.TorusGeometry(0.35, 0.06, 6, 24);

  function spawnEnemy(type, x, z) {
    const def = DEFS[type];
    const b = BUILDERS[type]();
    const e = {
      type, def, h: b.h, root: b.root, rig: b.rig, pos: b.root.position,
      hp: def.hp, maxHp: def.hp, radius: def.radius, height: def.height,
      vel: V3(), facing: 0, state: 'spawn', stateT: 0, cd: rand(0.5, 1.5), alive: true,
      flash: 0, poiseDmg: 0, stagT: 0, walkPh: rand(0, 6), didHit: false, finishable: false,
      tempo: 1, speedMul: rand(0.9, 1.1), orbitA: rand(0, TAU), orbitDir: Math.random() < 0.5 ? 1 : -1, alt: 2.2,
      chargeCd: rand(2, 4), deadT: 0,
    };
    e.pos.set(x, type === 'harpy' ? 14 : -e.height * 0.9, z);
    e.facing = Math.atan2(P.pos.x - x, P.pos.z - z);
    // collect materials for the hit flash
    e.flashMats = [];
    e.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && e.flashMats.indexOf(o.material) < 0) e.flashMats.push(o.material);
    });
    e.flashMats.forEach((m) => { m.userData.baseEmissive = m.emissive.clone(); });
    if (!def.boss) {
      e.bar = enemyHpBar(); scene.add(e.bar.g);
      e.marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, fog: false }));
      e.marker.visible = false; scene.add(e.marker);
    }
    scene.add(e.root);
    enemies.push(e);
    // spawn effect
    if (type === 'harpy') flames.emit(x, 10, z, 20, { color: 0x9a5aff, color2: 0x4a2a8a, speed: 3, life: 0.8, grav: -1 });
    else flames.emit(x, 0.3, z, 30, { color: 0x6aff5a, color2: 0x1a8a3a, speed: 3, up: 3, life: 0.9, grav: -2, spread: e.radius });
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

  // ===================================================================
  // Effects, orbs, projectiles
  // ===================================================================
  const effects = [];
  const addEffect = (fx) => effects.push(fx);
  function telegraph(x, z, r, dur, color = 0xff2a10) {
    const g = new THREE.Group(); g.position.set(x, 0.05, z);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, fog: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.92, r, 48), ringMat);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 48), fillMat);
    ring.rotation.x = fill.rotation.x = -Math.PI / 2;
    g.add(ring, fill); scene.add(g);
    let t = 0;
    addEffect({
      update(dt) {
        t += dt;
        fill.scale.setScalar(Math.max(0.001, Math.min(1, t / dur)));
        ringMat.opacity = 0.55 + 0.35 * Math.sin(t * 22);
        if (t >= dur) { this.dispose(); return false; }
        return true;
      },
      dispose() { scene.remove(g); ring.geometry.dispose(); fill.geometry.dispose(); },
    });
  }
  function telegraphLane(x, z, angle, length, width, dur) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = angle;
    m.position.set(x + Math.sin(angle) * length / 2, 0.05, z + Math.cos(angle) * length / 2);
    scene.add(m);
    let t = 0;
    addEffect({
      update(dt) { t += dt; mat.opacity = 0.2 + 0.2 * Math.sin(t * 20); if (t >= dur) { this.dispose(); return false; } return true; },
      dispose() { scene.remove(m); m.geometry.dispose(); },
    });
  }
  function shockwave(x, z, r0, r1, dur, color = 0xffaa55, onRadius = null) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.12, z); scene.add(m);
    let t = 0;
    addEffect({
      update(dt) {
        t += dt;
        const k = Math.min(1, t / dur), r = lerp(r0, r1, k);
        m.scale.set(r, r, 1);
        mat.opacity = 0.9 * (1 - k);
        if (onRadius) onRadius(r);
        if (t >= dur) { this.dispose(); return false; }
        return true;
      },
      dispose() { scene.remove(m); m.geometry.dispose(); },
    });
  }
  function flashLight(x, y, z, color, intensity, dur) {
    const l = new THREE.PointLight(color, intensity, 30, 2);
    l.position.set(x, y, z); scene.add(l);
    let t = 0;
    addEffect({
      update(dt) { t += dt; l.intensity = intensity * (1 - t / dur); if (t >= dur) { this.dispose(); return false; } return true; },
      dispose() { scene.remove(l); },
    });
  }
  function lightning(x, z) {
    const pts = [];
    let px = x + rand(-2, 2), py = 30, pz = z + rand(-2, 2);
    while (py > 0) { pts.push(new THREE.Vector3(px, py, pz)); py -= rand(1.5, 3.5); px += rand(-1.5, 1.5) + (x - px) * 0.25; pz += rand(-1.5, 1.5) + (z - pz) * 0.25; }
    pts.push(new THREE.Vector3(x, 0, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xbfe0ff, transparent: true, fog: false });
    const line = new THREE.Line(geo, mat); scene.add(line);
    let t = 0;
    addEffect({
      update(dt) { t += dt; mat.opacity = 1 - t / 0.35; if (t >= 0.35) { this.dispose(); return false; } return true; },
      dispose() { scene.remove(line); geo.dispose(); },
    });
  }

  const orbs = [];
  const orbGeo = new THREE.SphereGeometry(0.17, 8, 6);
  const ORB_COLORS = { red: 0xff3a2a, green: 0x5aff5a, blue: 0x4aa8ff };
  const orbMats = {};
  for (const k in ORB_COLORS) orbMats[k] = new THREE.MeshBasicMaterial({ color: ORB_COLORS[k] });
  function dropOrbs(pos, red, green, blue) {
    const add = (kind, n, value) => {
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(orbGeo, orbMats[kind]);
        m.position.set(pos.x, pos.y + 1.2, pos.z);
        scene.add(m);
        orbs.push({ m, kind, value, vel: V3(rand(-4, 4), rand(4, 8), rand(-4, 4)), t: 0 });
      }
    };
    const redCount = Math.max(1, Math.round(red / 10));
    add('red', redCount, red / redCount);
    add('green', green, 12);
    add('blue', blue, 12);
  }
  function updateOrbs(dt) {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i], p = o.m.position;
      o.t += dt;
      tmpA.set(P.pos.x - p.x, P.pos.y + 1.1 - p.y, P.pos.z - p.z);
      const d = tmpA.length();
      if (o.t > 0.55 && d < 9 && P.state !== 'dead') {
        o.vel.lerp(tmpA.normalize().multiplyScalar(18), damp(8, dt));
      } else {
        o.vel.y -= 14 * dt;
        o.vel.x *= Math.exp(-2 * dt); o.vel.z *= Math.exp(-2 * dt);
      }
      p.addScaledVector(o.vel, dt);
      if (p.y < 0.2) { p.y = 0.2; o.vel.y = Math.abs(o.vel.y) * 0.4; }
      if (o.t > 0.55 && d < 0.9) {
        if (o.kind === 'red') { P.orbs += o.value; stats.orbs += o.value; }
        else if (o.kind === 'green') P.hp = Math.min(P.maxHp, P.hp + o.value);
        else P.mp = Math.min(P.maxMp, P.mp + o.value);
        sparks.emit(p.x, p.y, p.z, 6, { color: ORB_COLORS[o.kind], speed: 2, life: 0.3, grav: 0 });
        Sound.pickup(o.kind);
        scene.remove(o.m); orbs.splice(i, 1);
      } else if (o.t > 25) { scene.remove(o.m); orbs.splice(i, 1); }
    }
  }

  const projectiles = [];
  const rockGeo = new THREE.DodecahedronGeometry(1.1, 0);
  const rockMat = M(0x5a4a3c, { roughness: 1 });
  function throwRock(from, to) {
    const m = new THREE.Mesh(rockGeo, rockMat); m.castShadow = true;
    m.position.copy(from); scene.add(m);
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
        sparks.emit(p.x, 0.5, p.z, 40, { color: 0xa08a70, color2: 0xff8a30, speed: 9, up: 4, life: 0.8 });
        flames.emit(p.x, 0.5, p.z, 12, { color: 0x6a5040, speed: 3, life: 1, grav: -1 });
        shockwave(p.x, p.z, 0.5, 3.2, 0.35, 0xffa060);
        shake(0.45); Sound.boom();
        if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 2.8 && P.pos.y < 2) hurtPlayer(18, p, 10);
      }
    }
  }

  // ===================================================================
  // Game state
  // ===================================================================
  const game = { state: 'title', wave: -1, spawnQueue: [], spawnT: 0, clearT: -1, time: 0, clock: 0, overT: -1, victory: false };
  const stats = { kills: 0, maxCombo: 0, orbs: 0 };
  const upgrades = { blades: 0, vigor: 0, aether: 0, fury: 0 };
  let combo = 0, comboT = 0, hitstop = 0, slowmo = 0, trauma = 0;
  let boss = null;

  const WAVES = [
    { name: 'The Fallen Legion', spawns: [['legion', 4]] },
    { name: 'Wings of Tartarus', spawns: [['legion', 5], ['harpy', 3]] },
    { name: 'The Labyrinth Beast', spawns: [['minotaur', 1], ['legion', 4]] },
    { name: 'Siege of the Damned', spawns: [['legion', 5], ['harpy', 3], ['minotaur', 2]] },
    { name: 'The Cyclops King', spawns: [['cyclops', 1]] },
  ];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

  const shake = (a) => { trauma = Math.min(1, trauma + a); };
  function doHitstop(t) { hitstop = Math.max(hitstop, t); }

  // ===================================================================
  // Combat
  // ===================================================================
  function damageEnemy(e, dmg, dirX, dirZ, knock, stag, px, py, pz, heavy = false) {
    if (!e.alive || e.state === 'spawn' || e.state === 'finished') return;
    if (e.def.boss && e.state === 'downed') return;
    if (P.rageT > 0) { dmg *= 1.6; P.hp = Math.min(P.maxHp, P.hp + 1.2); }
    dmg *= P.dmgMult;
    e.hp -= dmg;
    e.flash = 1;
    e.showBar = 3;
    sparks.emit(px, py, pz, heavy ? 22 : 12, { color: 0xffb040, color2: 0xff3a10, speed: heavy ? 9 : 6, life: 0.35, grav: 12 });
    sparks.emit(px, py, pz, 8, { color: e.type === 'legion' ? 0x6aff3a : 0xc0101a, speed: 4, life: 0.5, grav: 14 });
    let kb = knock;
    if (e.def.boss) kb *= 0.03; else if (e.type === 'minotaur') kb *= 0.3;
    e.vel.x += dirX * kb; e.vel.z += dirZ * kb;
    e.poiseDmg += dmg;
    if (stag > 0 && e.poiseDmg >= e.def.poise && e.hp > 0) {
      e.poiseDmg = 0;
      if (e.state !== 'stunned') { setState(e, 'stagger'); e.stagT = stag; }
    }
    doHitstop(heavy ? 0.09 : 0.05);
    shake(heavy ? 0.25 : 0.12);
    Sound.hit(heavy ? 1 : 0);
    combo++; comboT = 2.2;
    stats.maxCombo = Math.max(stats.maxCombo, combo);
    if (P.rageT <= 0) P.rage = Math.min(100, P.rage + 2.2 * P.rageGain);
    if (e.hp <= 0) {
      if (e.def.boss) bossDowned(e);
      else killEnemy(e, false);
    } else if (!e.def.boss && e.hp <= e.maxHp * 0.22) {
      e.finishable = true;
    }
  }
  function killEnemy(e, executed) {
    if (!e.alive) return;
    e.alive = false; e.finishable = false;
    stats.kills++;
    const d = e.def;
    if (executed) {
      dropOrbs(e.pos, d.red * 1.6, 3, 2);
    } else {
      dropOrbs(e.pos, d.red, Math.random() < 0.4 ? 1 : 0, Math.random() < 0.35 ? 1 : 0);
    }
    if (executed) {
      const c = e.pos;
      sparks.emit(c.x, c.y + e.height * 0.5, c.z, 70, { color: 0xff4020, color2: 0xffc060, speed: 11, life: 0.8, grav: 10 });
      flames.emit(c.x, c.y + e.height * 0.5, c.z, 25, { color: 0xff5a10, color2: 0x8a1a08, speed: 4, life: 0.8, grav: -2 });
      removeEnemy(e);
    } else {
      setState(e, 'dying');
    }
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
    const scale = P.rageT > 0 ? 0.5 : 1;
    P.hp -= dmg * scale;
    P.invuln = 0.55;
    combo = 0;
    shake(0.4);
    Sound.hurt();
    vignette = 1;
    sparks.emit(P.pos.x, P.pos.y + 1.3, P.pos.z, 14, { color: 0xc0101a, speed: 5, life: 0.5, grav: 12 });
    let dx = P.pos.x - from.x, dz = P.pos.z - from.z;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    P.vel.x = dx * knock; P.vel.z = dz * knock;
    if (P.rageT <= 0) P.rage = Math.min(100, P.rage + dmg * 0.6 * P.rageGain);
    if (P.hp <= 0) { P.hp = 0; playerDie(); return true; }
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
    game.overT = 2.4;
    banner('', 'You have fallen', 2.2);
  }

  function nearestEnemy(maxD, cone = -0.2) {
    let best = null, bd = maxD;
    const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
    for (const e of enemies) {
      if (!e.alive || e.state === 'spawn') continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz) - e.radius;
      if (d < bd && (dx * fx + dz * fz) / (d + e.radius || 1) > cone) { bd = d; best = e; }
    }
    return best;
  }
  function aimFacing() {
    const mv = moveInput();
    if (mv.lengthSq() > 0.04) return Math.atan2(mv.x, mv.z);
    const e = nearestEnemy(9);
    if (e) return Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    return P.facing;
  }

  function startAttack(name) {
    const A = ATTACKS[name];
    P.attack = A; P.atkName = name; P.atkT = 0; P.state = 'attack'; P.stateT = 0;
    P.hitMap.clear(); P.queued = null; P.impactDone = false;
    P.facing = aimFacing();
    if (!A.heavy && !A.air) { P.vel.x = Math.sin(P.facing) * 6; P.vel.z = Math.cos(P.facing) * 6; }
    blades.R.flying = !!A.R; blades.L.flying = !!A.L;
    Sound.swoosh(A.heavy ? 0.7 : rand(0.9, 1.15));
    if (A.heavy) setTimeout(() => Sound.swoosh(0.8), 380);
  }
  function endAttack() {
    P.attack = null; P.state = 'idle'; P.stateT = 0;
    blades.R.flying = blades.L.flying = false;
    if (P.queued === 'light') { P.comboIdx = (P.comboIdx + 1) % CHAIN.length; startAttack(CHAIN[P.comboIdx]); }
    else if (P.queued === 'heavy') { P.comboIdx = -1; startAttack('h1'); }
    else P.comboTimer = 0.45;
  }

  // ---------- actions ----------
  const canAct = () => game.state === 'playing' && P.state !== 'dead' && P.state !== 'finisher' && P.state !== 'hurt' && P.state !== 'magic';
  function actLight() {
    if (!canAct()) return;
    if (P.state === 'dodge') { if (P.stateT > 0.25) P.queued = 'light'; return; }
    if (!P.onGround && P.state !== 'attack') { startAttack('air'); P.vel.y = -24; return; }
    if (P.state === 'attack') {
      if (P.attack.air) return;
      if (P.atkT > 0.4) P.queued = 'light';
      return;
    }
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
    Sound.swoosh(0.5);
    flames.emit(P.pos.x, 0.2, P.pos.z, 6, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
  }
  function actJump() {
    if (!canAct()) return;
    if (P.state === 'attack' || P.state === 'dodge') return;
    if (P.onGround) { P.vel.y = 10.5; P.onGround = false; P.jumps = 1; Sound.swoosh(0.4); }
    else if (P.jumps < 2) {
      P.vel.y = 9; P.jumps = 2; Sound.swoosh(0.6);
      flames.emit(P.pos.x, P.pos.y, P.pos.z, 10, { color: 0xff8a30, speed: 3, life: 0.4, grav: 0 });
    }
  }
  function actMagic() {
    if (!canAct() || P.mp < 50 || P.state === 'dodge') return;
    P.mp -= 50;
    P.attack = null; blades.R.flying = blades.L.flying = false;
    P.state = 'magic'; P.stateT = 0;
    Sound.magic();
    banner('', 'Olympian Wrath', 1.0, true);
  }
  function actRage() {
    if (!canAct() || P.rage < 100 || P.rageT > 0) return;
    P.rageT = P.rageDur;
    Sound.rage();
    shake(0.5);
    flames.emit(P.pos.x, 1.2, P.pos.z, 60, { color: 0xff5a10, color2: 0xffc060, speed: 8, life: 0.8, grav: -2 });
    flashLight(P.pos.x, 2, P.pos.z, 0xff5a20, 6, 0.8);
    banner('', 'Rage of Sparta', 1.0, true);
  }
  function actFinish() {
    if (!canAct() || P.state === 'attack' || P.state === 'dodge') return;
    const e = finishCandidate();
    if (!e) return;
    P.state = 'finisher'; P.stateT = 0; P.finT = 0; P.finTarget = e;
    P.attack = null; blades.R.flying = blades.L.flying = true;
    P.facing = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    P.vel.set(0, 0, 0);
    e.vel.set(0, 0, 0);
    if (e.def.boss) { setState(e, 'executed'); slowmo = 2.6; }
    else { setState(e, 'finished'); slowmo = 0.9; }
    Sound.swoosh(0.6);
  }
  function finishCandidate() {
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (!e.alive || !e.finishable) continue;
      if (e.state === 'finished' || e.state === 'executed' || e.state === 'spawn') continue;
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) - e.radius;
      const reach = e.def.boss ? 6 : 3.2;
      if (d < reach && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ===================================================================
  // Input
  // ===================================================================
  const keys = {};
  const touchMove = { x: 0, y: 0 };
  const cam = { yaw: Math.PI, pitch: 0.36, dist: 10.5, target: V3(0, 2, 0), pos: V3() };
  const moveVec = V3();
  function moveInput() {
    let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touchMove.x;
    let my = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + touchMove.y;
    const L = Math.hypot(mx, my);
    if (L > 1) { mx /= L; my /= L; }
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return moveVec.set(rx * mx + fx * my, 0, rz * mx + fz * my);
  }
  const ACTIONS = { light: actLight, heavy: actHeavy, dodge: actDodge, jump: actJump, magic: actMagic, rage: actRage, finish: actFinish };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (game.state === 'playing') pauseGame(); else if (game.state === 'paused') resumeGame();
      return;
    }
    if (e.code === 'KeyM') { updateMuteLabel(Sound.toggleMute()); return; }
    if (game.state !== 'playing') return;
    switch (e.code) {
      case 'KeyJ': actLight(); break;
      case 'KeyK': actHeavy(); break;
      case 'Space': actJump(); break;
      case 'ShiftLeft': case 'ShiftRight': case 'KeyL': actDodge(); break;
      case 'KeyF': actMagic(); break;
      case 'KeyQ': actRage(); break;
      case 'KeyE': actFinish(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (game.state === 'playing') pauseGame(); });

  const canvas = renderer.domElement;
  let mouseDown = false, wantLock = false;
  const locked = () => document.pointerLockElement === canvas;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (game.state !== 'playing' || isTouch) return;
    if (!locked() && wantLock && canvas.requestPointerLock) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* pointer lock unavailable */ }
    }
    mouseDown = true;
    if (e.button === 0) actLight();
    else if (e.button === 2) actHeavy();
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  window.addEventListener('mousemove', (e) => {
    if (game.state !== 'playing') return;
    if (locked() || mouseDown) {
      cam.yaw -= e.movementX * 0.0026;
      cam.pitch = clamp(cam.pitch + e.movementY * 0.002, 0.05, 1.1);
    }
  });
  let lockedOnce = false;
  document.addEventListener('pointerlockchange', () => {
    if (locked()) lockedOnce = true;
    else if (lockedOnce && game.state === 'playing') pauseGame();
  });

  // touch controls
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  (function setupTouch() {
    const stick = $('stick'), knob = $('knob');
    let stickId = null, camId = null, camX = 0, camY = 0;
    const setKnob = (x, y) => { knob.style.transform = `translate(${x}px, ${y}px)`; };
    stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); });
    const moveStick = (e) => {
      if (e.pointerId !== stickId) return;
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const L = Math.hypot(dx, dy), max = r.width / 2;
      if (L > max) { dx = (dx / L) * max; dy = (dy / L) * max; }
      setKnob(dx, dy);
      touchMove.x = dx / max; touchMove.y = -dy / max;
    };
    stick.addEventListener('pointermove', moveStick);
    const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; touchMove.x = touchMove.y = 0; setKnob(0, 0); };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    document.querySelectorAll('.tbtns button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const f = ACTIONS[b.dataset.act]; if (f) f(); });
    });
    $('tPause').addEventListener('click', () => pauseGame());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || camId !== null) return;
      camId = e.pointerId; camX = e.clientX; camY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== camId) return;
      cam.yaw -= (e.clientX - camX) * 0.006;
      cam.pitch = clamp(cam.pitch + (e.clientY - camY) * 0.004, 0.05, 1.1);
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
    wave: $('waveLabel'), combo: $('combo'), comboN: $('comboN'), bossBar: $('bossBar'), bossFill: $('bossFill'),
    prompt: $('prompt'), banner: $('banner'), bannerSub: $('bannerSub'), bannerMain: $('bannerMain'),
    vignette: $('vignette'), rageTint: $('rageTint'), touch: $('touch'),
  };
  let vignette = 0, bannerT = 0;
  function banner(sub, main, dur = 2.5, quick = false) {
    ui.bannerSub.textContent = sub; ui.bannerMain.textContent = main;
    ui.banner.classList.add('show');
    ui.banner.style.top = quick ? '30%' : '24%';
    bannerT = dur;
  }
  function updateMuteLabel(m) { $('muteBtn').textContent = m ? 'Sound: off' : 'Sound: on'; }
  let lastPrompt = '';
  function updateHUD(dt) {
    ui.hp.style.width = (100 * P.hp / P.maxHp).toFixed(1) + '%';
    ui.mp.style.width = (100 * P.mp / P.maxMp).toFixed(1) + '%';
    const rageFrac = P.rageT > 0 ? P.rageT / P.rageDur : P.rage / 100;
    ui.rage.style.width = (100 * rageFrac).toFixed(1) + '%';
    ui.rageBar.classList.toggle('ready', P.rage >= 100 && P.rageT <= 0);
    ui.orbs.textContent = Math.floor(P.orbs);
    ui.combo.style.opacity = combo >= 3 ? 1 : 0;
    ui.comboN.textContent = combo;
    if (boss && boss.alive) {
      ui.bossBar.hidden = false;
      ui.bossFill.style.width = (100 * Math.max(0, boss.hp) / boss.maxHp).toFixed(1) + '%';
    } else ui.bossBar.hidden = true;
    let prompt = '';
    if (game.state === 'playing' && canAct()) {
      const fc = finishCandidate();
      if (fc) prompt = isTouch ? '<kbd>Finish</kbd>Execute' : '<kbd>E</kbd>Execute';
    }
    if (prompt !== lastPrompt) { ui.prompt.innerHTML = prompt; ui.prompt.hidden = !prompt; lastPrompt = prompt; }
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) ui.banner.classList.remove('show'); }
    vignette = Math.max(0, vignette - dt * 2);
    const low = P.hp < P.maxHp * 0.25 && P.state !== 'dead' ? 0.35 + 0.15 * Math.sin(game.time * 6) : 0;
    ui.vignette.style.opacity = Math.max(vignette, low).toFixed(2);
    ui.rageTint.style.opacity = P.rageT > 0 ? (0.7 + 0.3 * Math.sin(game.time * 8)).toFixed(2) : 0;
  }
  function showScreen(id) {
    ['title', 'pause', 'shop', 'over'].forEach((s) => { $(s).hidden = s !== id; });
  }

  // ===================================================================
  // Game flow
  // ===================================================================
  function clearWorld() {
    for (const e of enemies.slice()) removeEnemy(e);
    for (const o of orbs) scene.remove(o.m);
    orbs.length = 0;
    for (const fx of effects) fx.dispose();
    effects.length = 0;
    for (const p of projectiles) scene.remove(p.m);
    projectiles.length = 0;
    sparks.clear(); flames.clear();
    boss = null;
  }
  function applyUpgrades() {
    P.dmgMult = 1 + 0.2 * upgrades.blades;
    P.maxHp = 100 + 25 * upgrades.vigor;
    P.maxMp = 100 + 25 * upgrades.aether;
    P.rageDur = 8 + 2 * upgrades.fury;
    P.rageGain = 1 + 0.25 * upgrades.fury;
  }
  function startGame() {
    Sound.init(); Sound.stopMusic(); Sound.startMusic();
    clearWorld();
    for (const k in upgrades) upgrades[k] = 0;
    applyUpgrades();
    Object.assign(P, { hp: P.maxHp, mp: P.maxMp, rage: 0, rageT: 0, orbs: 0, state: 'idle', stateT: 0, attack: null, invuln: 0, comboIdx: 0, comboTimer: 0, queued: null, onGround: true, jumps: 0, facing: 0 });
    P.pos.set(0, 0, 0); P.vel.set(0, 0, 0);
    P.rig.rotation.set(0, 0, 0); P.rig.position.y = 0.95;
    Object.assign(stats, { kills: 0, maxCombo: 0, orbs: 0 });
    combo = 0; slowmo = 0; hitstop = 0;
    cam.yaw = Math.PI; cam.pitch = 0.36;
    game.time = 0; game.wave = -1; game.overT = -1; game.victory = false;
    game.state = 'playing';
    showScreen(null);
    ui.hud.hidden = false;
    ui.touch.hidden = !isTouch;
    wantLock = !isTouch;
    nextWave();
  }
  function nextWave() {
    game.wave++;
    const w = WAVES[game.wave];
    const q = [];
    for (const [type, n] of w.spawns) for (let i = 0; i < n; i++) q.push(type);
    // shuffle, but keep heavies early so the wave has a centrepiece
    for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
    q.sort((a, b) => (DEFS[b].hp > 100) - (DEFS[a].hp > 100));
    game.spawnQueue = q; game.spawnT = 1.8; game.clearT = -1;
    ui.wave.innerHTML = `Wave ${ROMAN[game.wave]} of V<b>${w.name}</b>`;
    banner(`Wave ${ROMAN[game.wave]}`, w.name, 2.6);
  }
  function spawnPoint(minFromPlayer) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rand(0, TAU), r = rand(10, 24);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (Math.hypot(x - P.pos.x, z - P.pos.z) < minFromPlayer) continue;
      if (colliders.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 1.5)) continue;
      return [x, z];
    }
    return [0, -20];
  }
  function updateWaves(dt) {
    if (P.state === 'dead') return;
    if (game.spawnQueue.length) {
      game.spawnT -= dt;
      const alive = enemies.filter((e) => e.alive).length;
      if (game.spawnT <= 0 && alive < 7) {
        const type = game.spawnQueue.shift();
        if (type === 'cyclops') {
          const a = Math.atan2(-P.pos.x, -P.pos.z) + rand(-0.3, 0.3);
          boss = spawnEnemy('cyclops', P.pos.x + Math.sin(a) * 16, P.pos.z + Math.cos(a) * 16);
          const br = Math.hypot(boss.pos.x, boss.pos.z);
          if (br > 20) { boss.pos.x *= 20 / br; boss.pos.z *= 20 / br; }
          banner('The Cyclops King', 'Polyphemos', 3);
          Sound.roar(0.6);
          shake(0.8);
        } else {
          const [x, z] = spawnPoint(8);
          spawnEnemy(type, x, z);
        }
        game.spawnT = rand(0.5, 0.9);
      }
      return;
    }
    if (game.clearT < 0 && !enemies.some((e) => e.alive)) {
      if (game.wave >= WAVES.length - 1) return; // the boss finisher ends the game
      game.clearT = 2.6;
      banner('Victory', 'Wave cleared', 2.2);
    }
    if (game.clearT > 0) {
      game.clearT -= dt;
      if (game.clearT <= 0) openShop();
    }
  }

  // shop
  const UPGRADES = [
    { id: 'blades', name: 'Blades of Ash', desc: '+20% damage from every blade strike', base: 120, max: 5 },
    { id: 'vigor', name: 'Spartan Vigor', desc: '+25 maximum health', base: 100, max: 5 },
    { id: 'aether', name: 'Aether Reservoir', desc: '+25 maximum magic for Olympian Wrath', base: 90, max: 4 },
    { id: 'fury', name: 'Undying Fury', desc: '+2 s Rage of Sparta, and rage builds 25% faster', base: 110, max: 4 },
  ];
  function openShop() {
    game.state = 'shop';
    if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); }
    P.hp = P.maxHp; P.mp = P.maxMp;
    $('shopTitle').textContent = `Wave ${ROMAN[game.wave]} cleared`;
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
        Sound.pickup('red'); Sound.clang();
        renderShop();
      });
      el.appendChild(btn);
      list.appendChild(el);
    }
  }
  function closeShop() {
    game.state = 'playing';
    showScreen(null);
    ui.touch.hidden = !isTouch;
    nextWave();
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    showScreen('pause');
    ui.touch.hidden = true;
  }
  function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    showScreen(null);
    ui.touch.hidden = !isTouch;
    if (wantLock && canvas.requestPointerLock) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* ignore */ }
    }
  }
  function endScreen(victory) {
    game.state = 'over';
    if (document.exitPointerLock && locked()) { lockedOnce = false; document.exitPointerLock(); }
    ui.touch.hidden = true;
    $('overEyebrow').textContent = victory ? 'The trial is complete' : 'The Fates cut your thread';
    $('overTitle').textContent = victory ? 'Olympus trembles' : 'You have fallen';
    $('overText').textContent = victory
      ? 'Polyphemos lies blinded in the ash. The temple is yours, and the gods have noticed.'
      : 'The dead drag you down to Tartarus. Climb back out and try again.';
    $('stKills').textContent = stats.kills;
    $('stCombo').textContent = stats.maxCombo;
    $('stWave').textContent = ROMAN[Math.max(0, game.wave)] || 'I';
    const t = Math.floor(game.time);
    $('stTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    $('againBtn').textContent = victory ? 'Fight again' : 'Rise again';
    showScreen('over');
  }

  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('restartBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resumeGame);
  $('nextBtn').addEventListener('click', closeShop);
  $('muteBtn').addEventListener('click', () => updateMuteLabel(Sound.toggleMute()));

  // ===================================================================
  // Player update
  // ===================================================================
  function collide(pos, radius) {
    for (const c of colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + radius;
      if (d < m && d > 1e-4) { pos.x = c.x + (dx / d) * m; pos.z = c.z + (dz / d) * m; }
    }
    const r = Math.hypot(pos.x, pos.z), lim = ARENA_R - radius;
    if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; return true; }
    return false;
  }

  function updatePlayer(dt) {
    P.stateT += dt;
    P.invuln = Math.max(0, P.invuln - dt);
    P.comboTimer = Math.max(0, P.comboTimer - dt);
    if (P.rageT > 0) {
      P.rageT -= dt; P.rage = 100 * Math.max(0, P.rageT) / P.rageDur;
      if (P.rageT <= 0) { P.rageT = 0; P.rage = 0; }
      if (Math.random() < 0.5) flames.emit(P.pos.x, P.pos.y + rand(0.5, 2), P.pos.z, 1, { color: 0xff5a10, speed: 1, life: 0.5, grav: -3, spread: 0.4 });
    }
    const mv = moveInput();
    const moving = mv.lengthSq() > 0.01;
    const speed = P.rageT > 0 ? 8.6 : 7.6;

    switch (P.state) {
      case 'idle': case 'run': {
        const tx = mv.x * speed, tz = mv.z * speed;
        const k = damp(P.onGround ? 14 : 5, dt);
        P.vel.x = lerp(P.vel.x, tx, k); P.vel.z = lerp(P.vel.z, tz, k);
        if (moving) P.facing = angleLerp(P.facing, Math.atan2(mv.x, mv.z), damp(16, dt));
        P.state = moving ? 'run' : 'idle';
        break;
      }
      case 'attack': {
        const A = P.attack;
        const spd = P.rageT > 0 ? 1.3 : 1;
        P.atkT += (dt * spd) / A.dur;
        P.vel.x *= Math.exp(-9 * dt); P.vel.z *= Math.exp(-9 * dt);
        if (A.air) {
          P.atkT = 0.5;
          if (P.onGround) { airSlamImpact(); endAttack(); }
          break;
        }
        if (A.impact && !P.impactDone && P.atkT >= A.impact) {
          P.impactDone = true;
          const fx = Math.sin(P.facing), fz = Math.cos(P.facing);
          const cx = P.pos.x + fx * 6, cz = P.pos.z + fz * 6;
          aoe(cx, cz, A.impactR, A.dmg * 0.6, A.knock, A.stag);
          shockwave(cx, cz, 0.5, A.impactR + 1, 0.35);
          sparks.emit(cx, 0.3, cz, 35, { color: 0xffa040, color2: 0xff5010, speed: 9, up: 3, life: 0.5 });
          flames.emit(cx, 0.3, cz, 10, { color: 0x6a5040, speed: 3, life: 0.8, grav: -1 });
          shake(0.45); Sound.boom();
        }
        if (P.atkT >= 1) endAttack();
        break;
      }
      case 'dodge': {
        const dur = 0.45, k = P.stateT / dur;
        const sp = 17 * Math.pow(Math.max(0, 1 - k), 0.6);
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
      case 'magic': {
        P.vel.x *= Math.exp(-10 * dt); P.vel.z *= Math.exp(-10 * dt);
        P.invuln = Math.max(P.invuln, 0.1);
        if (!P.magicDone && P.stateT > 0.35) {
          P.magicDone = true;
          shockwave(P.pos.x, P.pos.z, 1, 11, 0.6, 0x7ab8ff);
          shockwave(P.pos.x, P.pos.z, 1, 8, 0.45, 0xffa040);
          for (let i = 0; i < 7; i++) {
            const a = rand(0, TAU), r = rand(2, 9);
            lightning(P.pos.x + Math.sin(a) * r, P.pos.z + Math.cos(a) * r);
          }
          for (const e of enemies) if (e.alive && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 11) lightning(e.pos.x, e.pos.z);
          flashLight(P.pos.x, 4, P.pos.z, 0x9ac8ff, 9, 0.7);
          sparks.emit(P.pos.x, 1, P.pos.z, 120, { color: 0x9ac8ff, color2: 0xffffff, speed: 16, life: 0.6, grav: 4, flat: true });
          aoe(P.pos.x, P.pos.z, 11, 38, 14, 1.0);
          shake(0.7);
          Sound.boom();
        }
        if (P.stateT > 0.8) { P.state = 'idle'; P.stateT = 0; P.magicDone = false; }
        break;
      }
      case 'finisher':
        updateFinisher(dt);
        break;
      case 'dead':
        P.vel.x *= Math.exp(-5 * dt); P.vel.z *= Math.exp(-5 * dt);
        break;
      default: break;
    }

    // gravity & integration
    if (!P.onGround) {
      P.vel.y -= 28 * dt;
    }
    P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; P.pos.y += P.vel.y * dt;
    if (P.pos.y <= 0) {
      if (!P.onGround && P.vel.y < -12) flames.emit(P.pos.x, 0.2, P.pos.z, 6, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
      P.pos.y = 0; P.vel.y = 0; P.onGround = true; P.jumps = 0;
    } else if (P.pos.y > 0.001) P.onGround = false;
    collide(P.pos, 0.55);
    // push out of enemies
    for (const e of enemies) {
      if (!e.alive || e.type === 'harpy' || e.state === 'spawn') continue;
      const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz), m = e.radius + 0.5;
      if (d < m && d > 1e-4 && P.state !== 'dodge') { P.pos.x = e.pos.x + (dx / d) * m; P.pos.z = e.pos.z + (dz / d) * m; }
    }
    P.root.rotation.y = P.facing;
    animatePlayer(dt);
  }

  function airSlamImpact() {
    aoe(P.pos.x, P.pos.z, 4.6, 20, 9, 0.8);
    shockwave(P.pos.x, P.pos.z, 0.5, 5.5, 0.4);
    sparks.emit(P.pos.x, 0.3, P.pos.z, 50, { color: 0xffa040, color2: 0xff5010, speed: 11, up: 3, life: 0.5 });
    flames.emit(P.pos.x, 0.3, P.pos.z, 16, { color: 0x6a5040, speed: 4, life: 0.8, grav: -1 });
    shake(0.55); Sound.boom();
    P.vel.set(0, 0, 0);
  }

  function updateFinisher(dt) {
    const e = P.finTarget;
    P.finT += dt;
    if (!e) { P.state = 'idle'; return; }
    P.invuln = 0.3;
    P.facing = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    if (!e.def.boss) {
      // dash in, impale with both blades, tear them apart
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      const want = e.radius + 1.0;
      if (d > want) { const k = Math.min(1, (d - want) * 0.25 + 0.15); P.pos.x = lerp(P.pos.x, e.pos.x - Math.sin(P.facing) * want, k); P.pos.z = lerp(P.pos.z, e.pos.z - Math.cos(P.facing) * want, k); }
      if (P.finT > 0.35 && !e.didHit) {
        e.didHit = true;
        doHitstop(0.12); shake(0.6); Sound.hit(1); Sound.boom();
        P.hp = Math.min(P.maxHp, P.hp + 6);
        combo++; comboT = 2.2; stats.maxCombo = Math.max(stats.maxCombo, combo);
        killEnemy(e, true);
      }
      if (P.finT > 0.65) { P.state = 'idle'; P.stateT = 0; P.finTarget = null; blades.R.flying = blades.L.flying = false; }
    } else {
      // the boss: chains into the eye, pull him down, rip
      if (P.finT > 0.6 && !e.didHit) { e.didHit = true; Sound.hit(1); shake(0.4); doHitstop(0.1); }
      if (P.finT > 0.6 && P.finT < 1.6) {
        sparks.emit(e.pos.x, e.pos.y + 6.5, e.pos.z, 2, { color: 0xff2a10, speed: 3, life: 0.5, grav: 10 });
      }
      if (P.finT > 1.7 && e.alive) {
        e.alive = false;
        const c = e.pos;
        for (let i = 0; i < 4; i++) sparks.emit(c.x, c.y + 6, c.z, 60, { color: 0xff4020, color2: 0xffd080, speed: 16, life: 1.2, grav: 8 });
        flames.emit(c.x, 4, c.z, 60, { color: 0xff5a10, color2: 0x8a1a08, speed: 6, life: 1.4, grav: -2, spread: 2 });
        flashLight(c.x, 6, c.z, 0xff7a30, 10, 1.2);
        shake(1); Sound.boom(); Sound.roar(0.5);
        stats.kills++;
        dropOrbs(c, 400, 0, 0);
        setState(e, 'dying');
        game.victory = true; game.overT = 3.2;
        banner('Polyphemos is slain', 'Victory', 3);
      }
      if (P.finT > 2.2) { P.state = 'idle'; P.stateT = 0; P.finTarget = null; blades.R.flying = blades.L.flying = false; }
    }
  }

  function animatePlayer(dt) {
    const h = spartan;
    resetPose(h);
    P.rig.rotation.set(0, 0, 0);
    P.rig.position.y = 0.95;
    const hs = Math.hypot(P.vel.x, P.vel.z);
    switch (P.state) {
      case 'idle': case 'run': {
        const amt = clamp(hs / 7.6, 0, 1);
        P.walkPh += dt * (6 + hs * 0.9);
        poseWalk(h, P.walkPh, amt);
        if (amt < 0.1) { h.hips.position.y = 1.05 + Math.sin(game.time * 2.2) * 0.015; h.torso.rotation.x = 0.06; }
        for (const a of h.arms) { a.sh.rotation.z = a.s * 0.25; a.el.rotation.x = -0.5; }
        if (!P.onGround) for (const l of h.legs) { l.hp.rotation.x = -0.7; l.kn.rotation.x = 1.2; }
        break;
      }
      case 'attack': {
        const A = P.attack;
        let ang = 0, any = false;
        for (const side of ['R', 'L']) {
          const f = A[side]; if (!f) continue;
          const [x, y, z] = f(Math.min(1, P.atkT));
          const a = Math.atan2(x, z);
          if (!any) { ang = a; any = true; }
          const arm = h.arms[side === 'R' ? 0 : 1];
          const horiz = Math.hypot(x, z);
          const elev = Math.atan2(y - 1.9, horiz);
          arm.sh.rotation.y = clamp(a - h.torso.rotation.y, -2.4, 2.4);
          arm.sh.rotation.x = clamp(-(Math.PI / 2 + elev), -3.1, 0.3);
          arm.sh.rotation.z = 0;
          arm.el.rotation.x = -0.1;
        }
        h.torso.rotation.y = clamp(ang * 0.45, -0.9, 0.9);
        for (const a of h.arms) if (a.sh.rotation.y !== 0) a.sh.rotation.y -= h.torso.rotation.y;
        h.legs[0].hp.rotation.x = -0.35; h.legs[1].hp.rotation.x = 0.3; h.legs[1].kn.rotation.x = 0.4;
        h.hips.position.y = 0.98;
        if (A.air) { for (const l of h.legs) { l.hp.rotation.x = -0.5; l.kn.rotation.x = 0.9; } h.torso.rotation.x = 0.5; }
        if (A === ATTACKS.l4) h.torso.rotation.x = P.atkT < 0.25 ? -0.3 : 0.45;
        break;
      }
      case 'dodge': {
        const k = clamp(P.stateT / 0.45, 0, 1);
        P.rig.rotation.x = smooth(k) * TAU;
        P.rig.position.y = 0.95 - Math.sin(k * Math.PI) * 0.45;
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
        h.hips.position.y = 1.05 - (P.stateT > 0.35 ? 0.15 : 0);
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
        P.rig.position.y = lerp(0.95, 0.25, smooth(k));
        for (const a of h.arms) { a.sh.rotation.z = a.s * 1.2; }
        break;
      }
      default: break;
    }
    // double-jump flip
    if (P.state !== 'dodge' && P.state !== 'dead' && !P.onGround && P.jumps === 2 && P.vel.y > -4) {
      P.rig.rotation.x = clamp((9 - P.vel.y) / 13, 0, 1) * TAU;
    }
    // hit flicker while invulnerable after damage
    pLight.intensity = P.rageT > 0 ? 2.4 + Math.sin(game.time * 20) * 0.6 : 0.5;
    pLight.color.setHex(P.rageT > 0 ? 0xff3a10 : 0xff7a30);
  }

  // blades, chains and trails
  const handPos = V3(), downDir = V3(), bladeTarget = V3();
  function updateBlades(dt) {
    P.root.updateMatrixWorld(true);
    const rage = P.rageT > 0;
    for (const side of ['R', 'L']) {
      const b = blades[side];
      const hand = spartan.arms[b.handIdx].hand;
      hand.getWorldPosition(handPos);
      b.hand.copy(handPos);
      let flying = false;
      if (P.state === 'attack' && P.attack && P.attack[side]) {
        const [x, y, z] = P.attack[side](Math.min(1, P.atkT));
        toWorld(x, Math.max(0.15 - P.pos.y, y), z, bladeTarget);
        flying = true;
      } else if (P.state === 'finisher' && P.finTarget) {
        const e = P.finTarget;
        const k = clamp(P.finT / 0.3, 0, 1);
        const off = side === 'R' ? -0.35 : 0.35;
        const ty = e.def.boss ? e.pos.y + 6.6 * (e.rig.scale.y / 3.3) : e.pos.y + e.height * 0.55;
        tmpA.set(e.pos.x + Math.cos(P.facing) * off, ty, e.pos.z - Math.sin(P.facing) * off);
        bladeTarget.lerpVectors(handPos, tmpA, smooth(k));
        if (!e.def.boss && P.finT > 0.4) {
          // rip outward
          const r = (P.finT - 0.4) * 10;
          bladeTarget.x += Math.cos(P.facing) * off * r * 2; bladeTarget.z -= Math.sin(P.facing) * off * r * 2;
        }
        if (e.def.boss && P.finT > 1.65) bladeTarget.lerp(handPos, clamp((P.finT - 1.65) / 0.3, 0, 1));
        flying = true;
      } else if (P.state === 'magic') {
        const a = P.stateT * 18 + (side === 'R' ? 0 : Math.PI);
        const r = Math.min(1, P.stateT * 4) * 3;
        toWorld(Math.sin(a) * r, 1.4, Math.cos(a) * r, bladeTarget);
        flying = true;
      }
      if (flying) {
        b.g.position.copy(bladeTarget);
        tmpB.subVectors(bladeTarget, handPos); tmpB.y *= 0.3;
        if (tmpB.lengthSq() < 0.01) tmpB.set(Math.sin(P.facing), 0, Math.cos(P.facing));
        tmpB.normalize();
        b.g.lookAt(tmpC.copy(bladeTarget).add(tmpB));
        b.g.scale.setScalar(rage ? 1.35 : 1.15);
      } else {
        downDir.set(0, -1, 0).transformDirection(hand.matrixWorld);
        b.g.position.copy(handPos).addScaledVector(downDir, 0.05);
        b.g.lookAt(tmpC.copy(handPos).add(downDir));
        b.g.scale.setScalar(rage ? 1.2 : 1);
      }
      b.flying = flying;
      b.mat.emissiveIntensity = rage ? 1.4 + Math.sin(game.time * 25) * 0.3 : 0.45;
      b.mat.emissive.setHex(rage ? 0xff2a00 : 0xff4a0a);

      // chain from wrist to grip with a little sag
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
      const intensity = rage ? 0.85 : 0.55;
      for (let i = 0; i < b.NT; i++) {
        const hp = b.hist[Math.min(i, b.hist.length - 1)];
        const f = Math.pow(1 - i / (b.NT - 1), 2) * intensity;
        b.tpos.set([hp[0].x, hp[0].y, hp[0].z], i * 6);
        b.tpos.set([hp[1].x, hp[1].y, hp[1].z], i * 6 + 3);
        b.tcol.set([0.6 * f, 0.15 * f, 0.02 * f, 1.0 * f, 0.55 * f, 0.15 * f], i * 6);
      }
      b.trail.geometry.attributes.position.needsUpdate = true;
      b.trail.geometry.attributes.color.needsUpdate = true;
      if (flying && Math.random() < 0.6) flames.emit(bp.x, bp.y, bp.z, 1, { color: 0xff6a1a, speed: 0.6, life: 0.3, grav: -2 });

      // hit detection along the chain while the attack window is open
      if (P.state === 'attack' && P.attack && P.attack[side]) {
        const A = P.attack;
        if (P.atkT >= A.hit[0] && P.atkT <= A.hit[1]) bladeHits(handPos, bp, A);
      }
    }
  }
  function bladeHits(a, b, A) {
    for (const e of enemies.slice()) {
      if (!e.alive || e.state === 'spawn' || e.state === 'finished' || e.state === 'executed') continue;
      const last = P.hitMap.get(e);
      if (last !== undefined && (!A.rehit || game.clock - last < A.rehit)) continue;
      const [d, t] = segDist2D(e.pos.x, e.pos.z, a.x, a.z, b.x, b.z);
      const py = lerp(a.y, b.y, t);
      const cy = e.pos.y + e.height * 0.5;
      if (d < e.radius + 0.5 && Math.abs(py - cy) < e.height * 0.5 + 1.0) {
        P.hitMap.set(e, game.clock);
        let dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
        const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
        const hx = lerp(a.x, b.x, t), hz = lerp(a.z, b.z, t);
        damageEnemy(e, A.dmg, dx, dz, A.knock, A.stag, hx, py, hz, A === ATTACKS.l4);
      }
    }
  }

  // ===================================================================
  // Enemy update
  // ===================================================================
  const toP = V3();
  function faceTo(e, rate, dt) { e.facing = angleLerp(e.facing, Math.atan2(toP.x, toP.z), damp(rate, dt)); }
  function stepToward(e, dir, speed, dt) { e.pos.x += dir.x * speed * dt; e.pos.z += dir.z * speed * dt; }
  function facingDot(e) { return Math.sin(e.facing) * toP.x + Math.cos(e.facing) * toP.z; }

  function updateEnemies(dt) {
    for (const e of enemies.slice()) {
      const tempoDt = dt * e.tempo;
      e.stateT += tempoDt;
      toP.set(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z);
      const dist = toP.length();
      if (dist > 1e-4) toP.divideScalar(dist);

      // knockback
      e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
      e.vel.multiplyScalar(Math.exp(-6 * dt));

      if (e.state === 'spawn') {
        const k = clamp(e.stateT / 0.9, 0, 1);
        if (e.type === 'harpy') e.pos.y = lerp(14, e.alt, smooth(k));
        else e.pos.y = lerp(-e.height * 0.9, 0, smooth(k));
        if (Math.random() < 0.5 && e.type !== 'harpy') flames.emit(e.pos.x, 0.2, e.pos.z, 2, { color: 0x6aff5a, color2: 0x1a8a3a, speed: 2, up: 2, life: 0.6, grav: -2, spread: e.radius });
        e.facing = Math.atan2(toP.x, toP.z);
        if (k >= 1) setState(e, e.def.boss ? 'intro' : (e.type === 'harpy' ? 'circle' : 'chase'));
      } else if (e.state === 'dying') {
        e.deadT += dt;
        const k = clamp(e.deadT / 0.4, 0, 1);
        e.rig.rotation.x = -smooth(k) * Math.PI / 2;
        if (e.type === 'harpy') e.pos.y = Math.max(0, e.pos.y - dt * 8);
        if (e.deadT > 1.1) e.pos.y -= dt * (e.def.boss ? 2 : 1.4);
        if (e.deadT > (e.def.boss ? 5 : 2.6)) { removeEnemy(e); continue; }
      } else if (e.state === 'finished') {
        // held in place for the execution; trembling
        e.rig.position.x = Math.sin(game.time * 60) * 0.03;
      } else {
        switch (e.type) {
          case 'legion': updateLegion(e, dt, dist); break;
          case 'harpy': updateHarpy(e, dt, dist); break;
          case 'minotaur': updateMinotaur(e, dt, dist); break;
          case 'cyclops': updateCyclops(e, dt, dist); break;
          default: break;
        }
      }

      // separation
      if (e.alive && e.type !== 'harpy' && e.state !== 'spawn') {
        for (const o of enemies) {
          if (o === e || !o.alive || o.type === 'harpy' || o.state === 'spawn') continue;
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = e.radius + o.radius;
          if (d < m && d > 1e-4) {
            const push = (m - d) * (o.def.boss ? 1 : 0.5);
            e.pos.x += (dx / d) * push; e.pos.z += (dz / d) * push;
          }
        }
        // keep off the player
        const m = e.radius + 0.5;
        if (dist < m && dist > 1e-4 && P.state !== 'dead') { e.pos.x -= toP.x * (m - dist) * 0.5; e.pos.z -= toP.z * (m - dist) * 0.5; }
      }
      if (e.state !== 'spawn' && e.state !== 'dying') {
        const hitEdge = collide(e.pos, e.radius);
        if (hitEdge && e.state === 'charge') setState(e, 'recover');
      }
      e.root.rotation.y = e.facing;

      // flash
      if (e.flash > 0) {
        e.flash = Math.max(0, e.flash - dt * 6);
        for (const m of e.flashMats) {
          const be = m.userData.baseEmissive;
          m.emissive.setRGB(be.r + e.flash * 0.9, be.g + e.flash * 0.5, be.b + e.flash * 0.3);
        }
      }
      // health bar and finisher marker
      if (e.bar) {
        e.showBar = Math.max(0, (e.showBar || 0) - dt);
        const show = e.alive && e.hp < e.maxHp && e.state !== 'spawn';
        e.bar.g.visible = show;
        if (show) {
          e.bar.g.position.set(e.pos.x, e.pos.y + e.height + 0.5, e.pos.z);
          e.bar.g.quaternion.copy(camera.quaternion);
          const f = Math.max(0, e.hp / e.maxHp);
          e.bar.fg.scale.x = Math.max(0.001, f);
          e.bar.fg.position.x = -(1 - f) * 0.57;
        }
        e.marker.visible = e.alive && e.finishable && e.state !== 'finished';
        if (e.marker.visible) {
          e.marker.position.set(e.pos.x, e.pos.y + e.height + 0.95, e.pos.z);
          e.marker.quaternion.copy(camera.quaternion);
          const s = 1 + Math.sin(game.time * 8) * 0.15;
          e.marker.scale.setScalar(s);
        }
      }
    }
  }

  function legionPose(e, dt, moving) {
    const h = e.h;
    resetPose(h);
    if (moving) { e.walkPh += dt * 9; poseWalk(h, e.walkPh, 1); }
    h.arms[1].sh.rotation.x = -1.0; h.arms[1].el.rotation.x = -0.6; h.arms[1].sh.rotation.y = -0.5;
    h.arms[0].sh.rotation.x = moving ? h.arms[0].sh.rotation.x - 0.4 : -0.5;
  }
  function updateLegion(e, dt, dist) {
    const h = e.h;
    switch (e.state) {
      case 'chase': {
        faceTo(e, 8, dt);
        const moving = dist > 2.0 && P.state !== 'dead';
        if (moving) stepToward(e, toP, e.def.speed * e.speedMul, dt);
        legionPose(e, dt, moving);
        e.cd -= dt;
        if (dist < 2.7 && e.cd <= 0 && P.state !== 'dead') setState(e, 'windup');
        break;
      }
      case 'windup': {
        faceTo(e, 6, dt);
        legionPose(e, dt, false);
        const k = clamp(e.stateT / 0.6, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-0.5, -2.9, smooth(k));
        h.torso.rotation.y = 0.4 * k;
        if (e.stateT > 0.6) { setState(e, 'strike'); Sound.swoosh(0.7); e.vel.x += Math.sin(e.facing) * 5; e.vel.z += Math.cos(e.facing) * 5; }
        break;
      }
      case 'strike': {
        legionPose(e, dt, false);
        const k = clamp(e.stateT / 0.12, 0, 1);
        h.arms[0].sh.rotation.x = lerp(-2.9, -0.5, k);
        h.torso.rotation.y = lerp(0.4, -0.4, k);
        h.torso.rotation.x = 0.25 * k;
        if (!e.didHit && e.stateT > 0.08) {
          e.didHit = true;
          if (dist < 2.9 + e.radius * 0.5 && facingDot(e) > 0.35) hurtPlayer(e.def.dmg, e.pos, 6);
        }
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
        h.torso.rotation.x = -0.45; h.neck.rotation.x = -0.4;
        h.arms[0].sh.rotation.z = -0.7; h.arms[1].sh.rotation.x = 0.2;
        if (e.stateT > e.stagT) { setState(e, 'chase'); e.cd = rand(0.3, 0.9); }
        break;
      default: setState(e, 'chase');
    }
  }

  function harpyPose(e, dt, flapRate = 14) {
    const h = e.h;
    const f = Math.sin(game.time * flapRate + e.walkPh);
    for (const w of h.wings) { w.w.rotation.z = w.s * f * 0.7; w.tip.rotation.z = w.s * f * 0.4; }
    h.torso.rotation.x = 0;
  }
  function updateHarpy(e, dt, dist) {
    const chestY = P.pos.y + 1.3;
    switch (e.state) {
      case 'circle': {
        e.orbitA += dt * e.orbitDir * 0.8;
        const tx = P.pos.x + Math.sin(e.orbitA) * 7, tz = P.pos.z + Math.cos(e.orbitA) * 7;
        tmpA.set(tx - e.pos.x, 0, tz - e.pos.z);
        const L = tmpA.length();
        if (L > 0.2) stepToward(e, tmpA.divideScalar(L), Math.min(e.def.speed, L * 2), dt);
        e.pos.y = lerp(e.pos.y, e.alt + Math.sin(game.time * 2 + e.walkPh) * 0.3, damp(3, dt));
        faceTo(e, 6, dt);
        harpyPose(e, dt);
        e.rig.rotation.x = 0.2;
        e.cd -= dt;
        if (e.cd <= 0 && P.state !== 'dead') { setState(e, 'screech'); Sound.screech(); }
        break;
      }
      case 'screech':
        faceTo(e, 10, dt);
        harpyPose(e, dt, 24);
        e.rig.rotation.x = -0.4;
        e.rig.position.x = Math.sin(game.time * 50) * 0.05;
        if (e.stateT > 0.55) {
          e.rig.position.x = 0;
          e.diveDir = V3(P.pos.x - e.pos.x, chestY - 0.3 - e.pos.y, P.pos.z - e.pos.z).normalize();
          setState(e, 'dive');
        }
        break;
      case 'dive': {
        e.pos.addScaledVector(e.diveDir, 16 * dt);
        harpyPose(e, dt, 4);
        e.rig.rotation.x = 0.9;
        const d3 = Math.hypot(P.pos.x - e.pos.x, chestY - (e.pos.y + 0.6), P.pos.z - e.pos.z);
        if (!e.didHit && d3 < 1.5) { e.didHit = true; hurtPlayer(e.def.dmg, e.pos, 7); }
        if (e.stateT > 0.75 || e.pos.y < 0.4) { e.pos.y = Math.max(0.4, e.pos.y); setState(e, 'climb'); }
        break;
      }
      case 'climb':
        e.pos.y = lerp(e.pos.y, e.alt, damp(3, dt));
        stepToward(e, toP, -3, dt);
        harpyPose(e, dt, 18);
        e.rig.rotation.x = -0.2;
        if (e.stateT > 0.9) { setState(e, 'circle'); e.cd = rand(1.8, 3.8); }
        break;
      case 'stagger':
        harpyPose(e, dt, 6);
        e.rig.rotation.x = -0.6;
        e.pos.y = Math.max(1.2, e.pos.y - dt * 2);
        if (e.stateT > e.stagT) setState(e, 'climb');
        break;
      default: setState(e, 'circle');
    }
  }

  function minoPose(e, dt, moving, rate = 7) {
    const h = e.h;
    resetPose(h);
    if (moving) { e.walkPh += dt * rate; poseWalk(h, e.walkPh, 1); }
    h.torso.rotation.x += 0.2;
    h.arms[0].sh.rotation.x = moving ? -0.3 : -0.5;
  }
  function updateMinotaur(e, dt, dist) {
    const h = e.h;
    e.chargeCd -= dt;
    switch (e.state) {
      case 'chase': {
        faceTo(e, 5, dt);
        const moving = dist > 2.9 && P.state !== 'dead';
        if (moving) stepToward(e, toP, e.def.speed * e.speedMul, dt);
        minoPose(e, dt, moving);
        e.cd -= dt;
        if (P.state === 'dead') break;
        if (dist > 7.5 && e.chargeCd <= 0) {
          setState(e, 'paw');
          e.facing = Math.atan2(toP.x, toP.z);
          e.chargeDir = V3(toP.x, 0, toP.z);
          telegraphLane(e.pos.x, e.pos.z, e.facing, 16, 2.4, 1.0);
          Sound.roar(1.3);
        } else if (dist < 3.8 && e.cd <= 0) setState(e, 'windup');
        break;
      }
      case 'paw':
        minoPose(e, dt, false);
        h.torso.rotation.x = 0.6; h.neck.rotation.x = 0.3;
        h.legs[1].hp.rotation.x = Math.sin(e.stateT * 18) * 0.5;
        if (Math.random() < 0.4) flames.emit(e.pos.x, 0.2, e.pos.z, 1, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
        if (e.stateT > 1.0) setState(e, 'charge');
        break;
      case 'charge': {
        stepToward(e, e.chargeDir, 16, dt);
        minoPose(e, dt, true, 18);
        h.torso.rotation.x = 0.7; h.neck.rotation.x = 0.4;
        if (Math.random() < 0.6) flames.emit(e.pos.x, 0.2, e.pos.z, 1, { color: 0x6a5a4a, speed: 2, life: 0.5, grav: -0.5, flat: true });
        if (!e.didHit && dist < e.radius + 1.0 && P.pos.y < 2.2) { e.didHit = true; hurtPlayer(22, e.pos, 15); }
        for (const c of colliders) {
          if (e.stateT > 0.15 && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < c.r + e.radius + 0.25) {
            setState(e, 'stunned');
            shake(0.6); Sound.boom();
            sparks.emit(e.pos.x, 2.5, e.pos.z, 30, { color: 0xc0b090, speed: 7, life: 0.6 });
            banner('', 'Stunned', 0.8, true);
            break;
          }
        }
        if (e.state === 'charge' && e.stateT > 1.4) setState(e, 'recover');
        break;
      }
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
          const cx = e.pos.x + Math.sin(e.facing) * 2.8, cz = e.pos.z + Math.cos(e.facing) * 2.8;
          shockwave(cx, cz, 0.4, 2.8, 0.3, 0xffa060);
          sparks.emit(cx, 0.3, cz, 25, { color: 0xc0a080, color2: 0xff8a30, speed: 7, up: 3, life: 0.5 });
          shake(0.4); Sound.boom();
          if (Math.hypot(P.pos.x - cx, P.pos.z - cz) < 2.6 && P.pos.y < 1.5) hurtPlayer(e.def.dmg, e.pos, 11);
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
        h.torso.rotation.x = -0.2; h.neck.rotation.x = -0.4;
        h.neck.rotation.z = Math.sin(game.time * 4) * 0.3;
        if (Math.random() < 0.3) sparks.emit(e.pos.x + rand(-0.6, 0.6), e.pos.y + e.height + 0.3, e.pos.z + rand(-0.6, 0.6), 1, { color: 0xfff0a0, speed: 0.5, life: 0.6, grav: 0 });
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
    resetPose(h);
    if (moving) { e.walkPh += dt * 4.5; poseWalk(h, e.walkPh, 0.8); }
    h.arms[0].sh.rotation.x = moving ? h.arms[0].sh.rotation.x - 0.3 : -0.35;
    h.torso.rotation.x += 0.1;
    h.iris.scale.setScalar(1 + Math.sin(game.time * 5) * 0.1);
  }
  function updateCyclops(e, dt, dist) {
    const h = e.h, T = e.stateT;
    const fwdX = Math.sin(e.facing), fwdZ = Math.cos(e.facing);
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
        if (moving) stepToward(e, toP, e.def.speed * (e.phase2 ? 1.25 : 1), dt);
        cyPose(e, dt, moving);
        if (P.state === 'dead') break;
        if (!e.phase2 && e.hp < e.maxHp * 0.5) { e.phase2 = true; e.tempo = 1.25; setState(e, 'roar'); e.adds = 'legion'; break; }
        if (!e.phase3 && e.hp < e.maxHp * 0.25) { e.phase3 = true; setState(e, 'roar'); e.adds = 'harpy'; break; }
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
            const reach = clamp(dist, 6, 9);
            e.slamAt = V3(e.pos.x + Math.sin(e.facing) * reach, 0, e.pos.z + Math.cos(e.facing) * reach);
            telegraph(e.slamAt.x, e.slamAt.z, 3.6, 1.1);
          }
        }
        break;
      }
      case 'slam': {
        cyPose(e, dt, false);
        const raise = clamp(T / 1.1, 0, 1);
        if (T < 1.1) {
          h.arms[0].sh.rotation.x = lerp(-0.35, -3.0, smooth(raise));
          h.torso.rotation.x = lerp(0.1, -0.3, raise);
        } else {
          const k = clamp((T - 1.1) / 0.12, 0, 1);
          h.arms[0].sh.rotation.x = lerp(-3.0, -1.0, k);
          h.torso.rotation.x = lerp(-0.3, 0.5, k);
          if (!e.didHit) {
            e.didHit = true;
            const p = e.slamAt;
            shockwave(p.x, p.z, 0.5, 5, 0.4, 0xffa060);
            sparks.emit(p.x, 0.4, p.z, 50, { color: 0xc0a080, color2: 0xff8a30, speed: 10, up: 4, life: 0.7 });
            flames.emit(p.x, 0.4, p.z, 14, { color: 0x6a5040, speed: 4, life: 1.0, grav: -1 });
            shake(0.75); Sound.boom();
            if (Math.hypot(P.pos.x - p.x, P.pos.z - p.z) < 3.6 && P.pos.y < 2) hurtPlayer(28, p, 14);
          }
        }
        if (T > 2.0) { setState(e, 'chase'); e.cd = rand(1.0, 2.0); }
        break;
      }
      case 'sweep': {
        cyPose(e, dt, false);
        if (T < 0.9) {
          faceTo(e, 3, dt);
          const k = smooth(T / 0.9);
          h.torso.rotation.y = lerp(0, 1.1, k);
          h.arms[0].sh.rotation.x = lerp(-0.35, -1.5, k);
          h.arms[0].sh.rotation.y = 0.6 * k;
        } else {
          const k = clamp((T - 0.9) / 0.35, 0, 1);
          h.torso.rotation.y = lerp(1.1, -1.2, smooth(k));
          h.arms[0].sh.rotation.x = -1.5;
          h.arms[0].sh.rotation.y = lerp(0.6, -0.6, k);
          if (!e.didHit && T > 1.0) {
            e.didHit = true; Sound.swoosh(0.4);
            if (dist < 10.5 && facingDot(e) > -0.15 && P.pos.y < 3) hurtPlayer(20, e.pos, 17);
          }
        }
        if (T > 2.0) { setState(e, 'chase'); e.cd = rand(0.8, 1.8); }
        break;
      }
      case 'stomp': {
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
              if (Math.abs(d - r) < 0.9 && P.pos.y < 0.45) { hit = hurtPlayer(15, { x: ox, z: oz }, 9) || hit; }
            });
            flames.emit(ox, 0.3, oz, 30, { color: 0x6a5040, speed: 7, life: 1.0, grav: -1, flat: true });
            shake(0.7); Sound.boom();
          }
        }
        if (T > 1.8) { setState(e, 'chase'); e.cd = rand(1.0, 2.0); }
        break;
      }
      case 'rock': {
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
            const r = Math.hypot(to.x, to.z);
            if (r > ARENA_R - 1) to.multiplyScalar((ARENA_R - 1) / r);
            throwRock(from, to);
            Sound.swoosh(0.4);
          }
        }
        if (T > 1.7) { setState(e, 'chase'); e.cd = rand(0.8, 1.6); }
        break;
      }
      case 'roar':
        cyPose(e, dt, false);
        h.neck.rotation.x = -0.6; h.torso.rotation.x = -0.25;
        h.arms[0].sh.rotation.z = -1.2; h.arms[1].sh.rotation.z = 1.2;
        if (!e.didHit && T > 0.3) {
          e.didHit = true;
          Sound.roar(0.55); shake(0.9);
          shockwave(e.pos.x, e.pos.z, 2, 14, 0.8, 0xff5a20);
          const n = e.adds === 'legion' ? 3 : 2;
          for (let i = 0; i < n; i++) { const [x, z] = spawnPoint(7); spawnEnemy(e.adds, x, z); }
          banner('', e.adds === 'legion' ? 'The dead answer his call' : 'The sky darkens', 1.6, true);
        }
        if (T > 1.8) { setState(e, 'chase'); e.cd = 1.0; }
        break;
      case 'downed':
        resetPose(h);
        e.rig.position.y = lerp(e.rig.position.y, 0.95 * 3.3 - 1.6, damp(4, dt));
        h.torso.rotation.x = 0.55; h.neck.rotation.x = 0.3;
        for (const l of h.legs) { l.hp.rotation.x = -1.4; l.kn.rotation.x = 1.6; }
        h.arms[0].sh.rotation.x = -0.4; h.arms[1].sh.rotation.x = -0.4;
        h.iris.scale.setScalar(0.7 + Math.sin(game.time * 3) * 0.1);
        faceTo(e, 1, dt);
        break;
      case 'executed': {
        resetPose(h);
        const k = clamp((P.finT - 0.6) / 1.0, 0, 1);
        e.rig.position.y = 0.95 * 3.3 - 1.6 - k * 0.6;
        h.torso.rotation.x = 0.55 + k * 0.5; h.neck.rotation.x = 0.3 + k * 0.4;
        for (const l of h.legs) { l.hp.rotation.x = -1.4; l.kn.rotation.x = 1.6; }
        h.arms[0].sh.rotation.x = -1.5 - Math.sin(game.time * 30) * 0.2;
        h.arms[1].sh.rotation.x = -1.5 + Math.sin(game.time * 30) * 0.2;
        break;
      }
      case 'stagger':
        setState(e, 'chase');
        break;
      default: setState(e, 'chase');
    }
  }
  function bossDowned(e) {
    e.hp = 0;
    setState(e, 'downed');
    e.finishable = true;
    Sound.roar(0.45); shake(0.8);
    banner('', 'Execute him', 2, true);
    for (const o of enemies) if (o !== e && o.alive) killEnemy(o, false);
    for (const p of projectiles) scene.remove(p.m);
    projectiles.length = 0;
  }

  // ===================================================================
  // Camera
  // ===================================================================
  function updateCamera(dt, realDt) {
    if (game.state === 'title') cam.yaw += realDt * 0.07;
    else {
      const rot = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0);
      cam.yaw += rot * realDt * 2.2;
      cam.pitch = clamp(cam.pitch + ((keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0)) * realDt * 1.2, 0.05, 1.1);
    }
    let wantDist = boss && boss.alive ? 14 : 10.5;
    if (P.state === 'finisher') wantDist = P.finTarget && P.finTarget.def.boss ? 12 : 7;
    if (game.state === 'title') wantDist = 13;
    if (camera.aspect < 1) wantDist *= 1.4;
    cam.dist = lerp(cam.dist, wantDist, damp(3, realDt));
    cam.target.lerp(tmpA.set(P.pos.x, P.pos.y * 0.6 + 2.0, P.pos.z), damp(10, realDt));
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    cam.pos.set(
      cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
      cam.target.y + sp * cam.dist,
      cam.target.z + Math.cos(cam.yaw) * cp * cam.dist,
    );
    trauma = Math.max(0, trauma - realDt * 1.6);
    const s = trauma * trauma;
    camera.position.set(cam.pos.x + rand(-1, 1) * s * 0.6, Math.max(0.6, cam.pos.y + rand(-1, 1) * s * 0.6), cam.pos.z + rand(-1, 1) * s * 0.6);
    camera.lookAt(cam.target);
  }

  // ===================================================================
  // Main loop
  // ===================================================================
  let last = performance.now();
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
      updateEnemies(dt);
      updateWaves(dt);
      updateOrbs(dt);
      updateProjectiles(dt);
      comboT -= dt;
      if (comboT <= 0) combo = 0;
      if (game.overT > 0) {
        game.overT -= realDt;
        if (game.overT <= 0) endScreen(game.victory);
      }
    } else if (game.state === 'title') {
      animatePlayer(realDt);
    }
    if (game.state === 'playing' || game.state === 'title') {
      for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);
      sparks.update(dt);
      flames.update(dt);
    }
    updateBlades(dt);
    embers.update(realDt, t);
    for (const b of braziers) {
      b.light.intensity = 1.5 + Math.sin(t * 9 + b.seed) * 0.25 + Math.sin(t * 23 + b.seed * 2) * 0.15;
      if (Math.random() < 0.6) flames.emit(b.x + rand(-0.3, 0.3), 2.7, b.z + rand(-0.3, 0.3), 1, { color: 0xff7a20, color2: 0xffb040, speed: 0.6, up: 2.2, life: 0.6, grav: -1 });
    }
    world.lavaTex.offset.x = t * 0.004; world.lavaTex.offset.y = t * 0.002;
    updateCamera(dt, realDt);
    if (game.state !== 'title') updateHUD(realDt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // expose a tiny handle for debugging and automated smoke tests
  window.__wrath = { game, P, enemies, start: startGame, closeShop, renderShop };
})();
