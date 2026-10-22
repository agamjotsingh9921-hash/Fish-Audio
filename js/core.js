/* Wrath of Olympus — core systems.
   Math & noise, the renderer with an HDR bloom pipeline, the procedural sky and
   image-based lighting, synthesised audio, particles, and blood. */
(() => {
  'use strict';
  const G = (window.G = {});

  // ===================================================================
  // Math & noise
  // ===================================================================
  const TAU = Math.PI * 2, DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (t) => t * t * (3 - 2 * t);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  const angleLerp = (a, b, t) => {
    const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    return a + d * t;
  };
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  function segDist2D(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    let t = L > 1e-6 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
    t = clamp(t, 0, 1);
    const cx = ax + dx * t - px, cz = az + dz * t - pz;
    return [Math.sqrt(cx * cx + cz * cz), t];
  }
  function hash2(i, j) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // value noise in [-1, 1]; with a period p > 0 it tiles
  function vnoise(x, y, p = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
    if (p > 0) { x0 = ((x0 % p) + p) % p; x1 = ((x1 % p) + p) % p; y0 = ((y0 % p) + p) % p; y1 = ((y1 % p) + p) % p; }
    const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function fbm(x, y, oct = 5, p = 0) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * vnoise(x * f, y * f, p ? p * f : 0);
      n += a; a *= 0.5; f *= 2;
    }
    return s / n;
  }
  G.util = { TAU, DEG, clamp, lerp, rand, smooth, sstep, damp, angleLerp, V3, segDist2D, hash2, vnoise, fbm };

  // ===================================================================
  // Settings (remembered per browser)
  // ===================================================================
  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('wrath-settings') || '{}') || {}; } catch (e) { saved = {}; }
  G.settings = { quality: saved.quality || (isTouch ? 'low' : 'high'), blood: saved.blood !== false, isTouch };
  G.saveSettings = () => {
    try { localStorage.setItem('wrath-settings', JSON.stringify({ quality: G.settings.quality, blood: G.settings.blood })); } catch (e) { /* storage blocked */ }
  };

  // ===================================================================
  // Renderer, scene, camera
  // ===================================================================
  const host = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const isWebGL2 = renderer.capabilities.isWebGL2;
  const canHDR = isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1600);
  G.renderer = renderer; G.scene = scene; G.camera = camera;
  G.heightAt = () => 0;
  G.normalAt = () => new THREE.Vector3(0, 1, 0);

  // ===================================================================
  // Post-processing: HDR scene -> bloom (two blur levels) -> ACES grade
  // ===================================================================
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);
  const passMat = (uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
  const brightMat = passMat({ tDiffuse: { value: null }, threshold: { value: 1.5 } }, `
    uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = max(max(c.r, c.g), c.b);
      float k = max(l - threshold, 0.0) / max(l, 1e-4);
      gl_FragColor = vec4(min(c * k, vec3(30.0)), 1.0);
    }`);
  const blurMat = passMat({ tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, `
    uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
    void main(){
      vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270;
      s += texture2D(tDiffuse, vUv + dir * 1.3846153).rgb * 0.3162162;
      s += texture2D(tDiffuse, vUv - dir * 1.3846153).rgb * 0.3162162;
      s += texture2D(tDiffuse, vUv + dir * 3.2307692).rgb * 0.0702702;
      s += texture2D(tDiffuse, vUv - dir * 3.2307692).rgb * 0.0702702;
      gl_FragColor = vec4(s, 1.0);
    }`);
  const compMat = passMat({
    tScene: { value: null }, tB1: { value: null }, tB2: { value: null },
    bloom: { value: 0.32 }, exposure: { value: 0.82 }, sat: { value: 1.08 }, vig: { value: 1.0 },
    time: { value: 0 }, hurt: { value: 0 }, rage: { value: 0 },
  }, `
    uniform sampler2D tScene, tB1, tB2;
    uniform float bloom, exposure, sat, vig, time, hurt, rage;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb;
      vec3 b = texture2D(tB1, vUv).rgb + texture2D(tB2, vUv).rgb * 1.4;
      c += b * bloom;
      c = aces(c * exposure);
      c = pow(c, vec3(1.0 / 2.2));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat - hurt * 0.6);
      c = mix(c, c * vec3(1.15, 0.88, 0.78), rage * 0.55);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * vig * 1.05;
      c = mix(c, vec3(0.3, 0.0, 0.0), hurt * smoothstep(0.25, 0.75, length(q)) * 0.65);
      float n = fract(sin(dot(vUv * vec2(1271.3, 917.1) + time, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.018;
      gl_FragColor = vec4(c, 1.0);
    }`);
  const post = { enabled: false, rt: null, bright: null, a: null, b: null, qa: null, qb: null, w: 1, h: 1 };
  function disposePost() {
    ['rt', 'bright', 'a', 'b', 'qa', 'qb'].forEach((k) => { if (post[k]) { post[k].dispose(); post[k] = null; } });
  }
  function makeRT(w, h, ms) {
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!ms, stencilBuffer: false };
    if (ms && THREE.WebGLMultisampleRenderTarget) {
      const rt = new THREE.WebGLMultisampleRenderTarget(w, h, opt);
      rt.samples = 4;
      return rt;
    }
    return new THREE.WebGLRenderTarget(w, h, opt);
  }
  function setupPost(w, h) {
    disposePost();
    post.enabled = G.settings.quality === 'high' && canHDR;
    post.w = w; post.h = h;
    if (!post.enabled) return;
    post.rt = makeRT(w, h, true);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    post.bright = makeRT(hw, hh); post.a = makeRT(hw, hh); post.b = makeRT(hw, hh);
    post.qa = makeRT(qw, qh); post.qb = makeRT(qw, qh);
  }
  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }
  G.post = compMat.uniforms;
  G.render = function render() {
    if (post.enabled) {
      renderer.setRenderTarget(post.rt);
      renderer.render(scene, camera);
      brightMat.uniforms.tDiffuse.value = post.rt.texture;
      pass(brightMat, post.bright);
      const hw = post.bright.width, hh = post.bright.height;
      blurMat.uniforms.tDiffuse.value = post.bright.texture; blurMat.uniforms.dir.value.set(1 / hw, 0); pass(blurMat, post.a);
      blurMat.uniforms.tDiffuse.value = post.a.texture; blurMat.uniforms.dir.value.set(0, 1 / hh); pass(blurMat, post.b);
      const qw = post.qa.width, qh = post.qa.height;
      blurMat.uniforms.tDiffuse.value = post.b.texture; blurMat.uniforms.dir.value.set(2 / qw, 0); pass(blurMat, post.qa);
      blurMat.uniforms.tDiffuse.value = post.qa.texture; blurMat.uniforms.dir.value.set(0, 2 / qh); pass(blurMat, post.qb);
      compMat.uniforms.tScene.value = post.rt.texture;
      compMat.uniforms.tB1.value = post.b.texture;
      compMat.uniforms.tB2.value = post.qb.texture;
      pass(compMat, null);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  };

  const qualityHooks = [];
  G.onQuality = (fn) => qualityHooks.push(fn);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, G.settings.quality === 'high' ? 1.5 : 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setupPost(Math.floor(w * pr), Math.floor(h * pr));
    G.pointScale = (h * pr) / (2 * Math.tan((camera.fov * DEG) / 2));
    if (G.fx) G.fx.blood.mat.uniforms.scale.value = G.pointScale;
  }
  G.applyQuality = function applyQuality() {
    const high = G.settings.quality === 'high';
    // When post-processing is on we tone-map ourselves; otherwise three does it.
    const usePost = high && canHDR;
    renderer.toneMapping = usePost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = usePost ? THREE.LinearEncoding : THREE.sRGBEncoding;
    scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    resize();
    qualityHooks.forEach((fn) => fn(high));
  };
  window.addEventListener('resize', resize);

  // ===================================================================
  // Sky: gradient, sun, drifting clouds — also baked into the environment map
  // ===================================================================
  const sunDir = new THREE.Vector3(-0.52, 0.34, -0.78).normalize();
  const skyUniforms = {
    sunDir: { value: sunDir }, time: { value: 0 },
    zenith: { value: new THREE.Color(0.11, 0.24, 0.55) },
    horizon: { value: new THREE.Color(0.98, 0.66, 0.44) },
    ground: { value: new THREE.Color(0.5, 0.42, 0.34) },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 sunDir, zenith, horizon, ground; uniform float time;
      varying vec3 vDir;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fb(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * nn(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        float sd = max(dot(d, sunDir), 0.0);
        vec3 hz = mix(horizon, horizon * vec3(0.75, 0.82, 1.0), 1.0 - pow(sd, 2.0));
        vec3 col = mix(hz, zenith, pow(clamp(y, 0.0, 1.0), 0.42));
        col += vec3(1.0, 0.55, 0.25) * pow(sd, 6.0) * 0.55;
        col += vec3(1.0, 0.75, 0.45) * pow(sd, 60.0) * 1.4;
        col += vec3(28.0, 22.0, 15.0) * smoothstep(0.9993, 0.9997, sd);
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.1) * 1.2 + vec2(time * 0.008, time * 0.003);
          float c = fb(uv * 1.3);
          c = smoothstep(0.52, 0.86, c) * smoothstep(0.0, 0.22, y);
          vec3 lit = mix(vec3(0.62, 0.55, 0.56), vec3(1.6, 1.15, 0.8), pow(sd, 3.0) * 0.9 + 0.25);
          col = mix(col, lit, c * 0.85);
        }
        col = mix(col, ground, smoothstep(0.0, -0.12, y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;
  scene.add(skyMesh);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.8, 0.62, 0.5), 0.0027);
  G.sky = { sunDir, uniforms: skyUniforms, mesh: skyMesh };
  // Image-based lighting: the sky is redrawn into an equirectangular canvas on the CPU
  // (sun glow and gradient, no clouds) and prefiltered. More robust than baking the shader.
  G.buildEnvironment = function buildEnvironment() {
    const W = 256, H = 128, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    const z = skyUniforms.zenith.value, hz = skyUniforms.horizon.value, gr = skyUniforms.ground.value;
    for (let py = 0; py < H; py++) {
      const theta = (0.5 - (py + 0.5) / H) * Math.PI, y = Math.sin(theta), cy = Math.cos(theta);
      for (let px = 0; px < W; px++) {
        const phi = ((px + 0.5) / W - 0.5) * TAU;
        const dx = cy * Math.cos(phi), dz = cy * Math.sin(phi);
        const sd = Math.max(0, dx * sunDir.x + y * sunDir.y + dz * sunDir.z);
        const t = Math.pow(clamp(y, 0, 1), 0.42), k = 1 - sd * sd;
        let r = lerp(hz.r * (1 - 0.25 * k), z.r, t), gg = lerp(hz.g * (1 - 0.18 * k), z.g, t), bb = lerp(hz.b, z.b, t);
        const glow = Math.pow(sd, 6) * 0.55 + Math.pow(sd, 60) * 1.4;
        r += glow; gg += glow * 0.65; bb += glow * 0.35;
        const below = sstep(0, -0.12, y);
        r = lerp(r, gr.r, below); gg = lerp(gg, gr.g, below); bb = lerp(bb, gr.b, below);
        const i = (py * W + px) * 4;
        d[i] = Math.pow(clamp(r, 0, 1), 1 / 2.2) * 255; d[i + 1] = Math.pow(clamp(gg, 0, 1), 1 / 2.2) * 255; d[i + 2] = Math.pow(clamp(bb, 0, 1), 1 / 2.2) * 255; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromEquirectangular(tex).texture;
    pm.dispose(); tex.dispose();
  };


  // ===================================================================
  // Audio — all synthesised
  // ===================================================================
  G.sound = (() => {
    let ctx = null, master = null, music = null, drums = null, noiseBuf = null, muted = false;
    let timer = null, nextBeat = 0, beat = 0, combatTarget = 0, ambience = [];
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination);
      music = ctx.createGain(); music.gain.value = 0.45; music.connect(master);
      drums = ctx.createGain(); drums.gain.value = 0; drums.connect(music);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function noise(dur, f0, f1, q, vol, type = 'bandpass', when = 0, dest = null) {
      if (!ctx) return;
      const t = ctx.currentTime + Math.max(0, when);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl); fl.connect(g); g.connect(dest || master);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    function tone(dur, f0, f1, vol, type = 'sine', when = 0, dest = null) {
      if (!ctx) return;
      const t = ctx.currentTime + Math.max(0, when);
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
      if (!ctx || timer) return;
      // drone
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      const dg = ctx.createGain(); dg.gain.value = 0.035;
      lp.connect(dg); dg.connect(music);
      [55, 82.4, 55.3].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); ambience.push(o); });
      ambience.push(dg);
      // wind
      const ws = ctx.createBufferSource(); ws.buffer = noiseBuf; ws.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420;
      const wg = ctx.createGain(); wg.gain.value = 0.05;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lg = ctx.createGain(); lg.gain.value = 0.03;
      lfo.connect(lg); lg.connect(wg.gain);
      ws.connect(wf); wf.connect(wg); wg.connect(master);
      ws.start(); lfo.start();
      ambience.push(ws, lfo, wg);
      nextBeat = ctx.currentTime + 0.1; beat = 0;
      const pattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0];
      timer = setInterval(() => {
        drums.gain.value += (combatTarget - drums.gain.value) * 0.08;
        while (nextBeat < ctx.currentTime + 0.25) {
          const s = beat % 16, w = nextBeat - ctx.currentTime;
          if (pattern[s]) tone(0.35, 120, 38, s % 4 === 0 ? 0.6 : 0.38, 'sine', w, drums);
          if (s === 4 || s === 12) noise(0.18, 1800, 600, 0.9, 0.14, 'bandpass', w, drums);
          nextBeat += 60 / 116 / 2; beat++;
        }
      }, 60);
    }
    function stopMusic() {
      if (timer) { clearInterval(timer); timer = null; }
      ambience.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already stopped */ } });
      ambience = [];
    }
    return {
      init, startMusic, stopMusic,
      get muted() { return muted; },
      toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.6; return muted; },
      setCombat(v) { combatTarget = clamp(v, 0, 1); },
      swoosh(p = 1) { noise(0.22, 500 * p, 2600 * p, 1.4, 0.2); },
      hit(heavy = 0) { noise(0.12, 2800, 300, 0.8, 0.28 + heavy * 0.2, 'lowpass'); tone(0.16, 170, 50, 0.42 + heavy * 0.3); },
      flesh() { noise(0.14, 900, 180, 0.7, 0.22, 'lowpass'); },
      clang() { tone(0.25, 1300, 900, 0.07, 'triangle'); noise(0.1, 4000, 2000, 2, 0.1); },
      boom() { tone(0.8, 95, 26, 0.9); noise(0.7, 900, 60, 0.7, 0.5, 'lowpass'); },
      hurt() { tone(0.2, 190, 80, 0.2, 'square'); noise(0.12, 1400, 300, 1, 0.2); },
      pickup(kind) { const f = { red: 880, green: 620, blue: 1040 }[kind] || 800; tone(0.12, f, f * 1.5, 0.07, 'triangle'); },
      roar(p = 1) { tone(1.3, 120 * p, 50 * p, 0.45, 'sawtooth'); noise(1.3, 500 * p, 140, 2, 0.3); },
      growl() { tone(0.5, 95, 60, 0.22, 'sawtooth'); noise(0.5, 320, 140, 2, 0.18); },
      screech() { tone(0.45, 1500, 2600, 0.06, 'sawtooth'); noise(0.4, 3000, 5000, 3, 0.09); },
      magic() { tone(1.0, 220, 880, 0.18, 'sawtooth'); noise(1.0, 200, 4000, 0.6, 0.32); tone(0.9, 70, 30, 0.8); },
      rage() { tone(1.2, 80, 160, 0.4, 'sawtooth'); noise(1.0, 300, 1200, 1, 0.3); },
      bow() { tone(0.14, 420, 160, 0.1, 'triangle'); noise(0.2, 3500, 900, 1.6, 0.1); },
      arrowHit() { noise(0.08, 2200, 500, 1, 0.14, 'lowpass'); },
      zap() { tone(0.3, 1800, 300, 0.1, 'sawtooth'); noise(0.3, 6000, 1500, 0.8, 0.2); },
      chest() { tone(0.25, 520, 780, 0.09, 'triangle'); tone(0.5, 880, 1760, 0.07, 'sine', 0.12); tone(0.6, 1320, 2640, 0.05, 'sine', 0.24); },
      altar() { tone(1.2, 220, 330, 0.12, 'sine'); tone(1.2, 330, 495, 0.08, 'sine', 0.1); },
    };
  })();

  // ===================================================================
  // Particles
  // ===================================================================
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
  }
  G.canvasTex = canvasTex;
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  G.glowTex = glowTex;

  // additive glowing particles (sparks, fire, magic)
  class Glow {
    constructor(max, size) {
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
      this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.geo = geo;
      this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.points.frustumCulled = false;
      this.points.renderOrder = 3;
      scene.add(this.points);
      this.c1 = new THREE.Color(); this.c2 = new THREE.Color();
    }
    emit(x, y, z, n, o = {}) {
      this.c1.set(o.color !== undefined ? o.color : 0xff8a30);
      this.c2.set(o.color2 !== undefined ? o.color2 : (o.color !== undefined ? o.color : 0xff8a30));
      const bright = o.bright || 1;
      const s = o.spread || 0, sp0 = o.speed !== undefined ? o.speed : 4;
      for (let k = 0; k < n; k++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = x + rand(-s, s); this.pos[i3 + 1] = y + rand(-s, s) * 0.5; this.pos[i3 + 2] = z + rand(-s, s);
        const vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
        const L = Math.hypot(vx, vy, vz) || 1, sp = sp0 * rand(0.3, 1);
        this.vel[i3] = (vx / L) * sp + (o.dx || 0);
        this.vel[i3 + 1] = (vy / L) * sp * (o.flat ? 0.2 : 1) + (o.up || 0);
        this.vel[i3 + 2] = (vz / L) * sp + (o.dz || 0);
        const life = (o.life || 0.6) * rand(0.6, 1.25);
        this.life[i] = life; this.maxLife[i] = life;
        const c = Math.random() < 0.5 ? this.c1 : this.c2;
        this.base[i3] = c.r * bright; this.base[i3 + 1] = c.g * bright; this.base[i3 + 2] = c.b * bright;
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
        if (life[i] <= 0) { pos[i3 + 1] = -9999; col[i3] = col[i3 + 1] = col[i3 + 2] = 0; continue; }
        const d = Math.exp(-drag[i] * dt);
        vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - grav[i] * dt; vel[i3 + 2] *= d;
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        const f = life[i] / maxLife[i];
        col[i3] = base[i3] * f; col[i3 + 1] = base[i3 + 1] * f; col[i3 + 2] = base[i3 + 2] * f;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.col.fill(0); for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999; }
  }

  // ---------- blood: droplets that fall, hit the ground, and leave stains ----------
  const splatTex = canvasTex(128, 128, (g) => {
    g.translate(64, 64);
    const blob = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.9})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    };
    blob(0, 0, 34, 1);
    for (let i = 0; i < 9; i++) { const a = rand(0, TAU), r = rand(10, 30); blob(Math.cos(a) * r, Math.sin(a) * r, rand(10, 20), 0.95); }
    for (let i = 0; i < 22; i++) { const a = rand(0, TAU), r = rand(36, 60); blob(Math.cos(a) * r, Math.sin(a) * r, rand(2, 6), 0.9); }
  });

  class Blood {
    constructor(max) {
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
      this.geo = geo;
      this.mat = new THREE.ShaderMaterial({
        uniforms: { scale: { value: 600 }, color: { value: new THREE.Color(0.30, 0.004, 0.008) } },
        vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float scale;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv; vA = aAlpha; }`,
        fragmentShader: `uniform vec3 color; varying float vA;
          void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.2, d) * vA;
          vec3 c = color * (0.75 + (0.5 - d) * 0.8);
          c += vec3(0.5, 0.12, 0.1) * pow(max(0.0, 0.22 - length(p - vec2(-0.13, -0.13))), 2.0) * 14.0;
          gl_FragColor = vec4(c, a); }`,
        transparent: true, depthWrite: false,
      });
      this.points = new THREE.Points(geo, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = 2;
      scene.add(this.points);
    }
    // o: dx/dy/dz bias, speed, spread, size, life, stain (chance a droplet leaves a decal)
    emit(x, y, z, n, o = {}) {
      if (!G.settings.blood) return;
      const sp0 = o.speed !== undefined ? o.speed : 4, s = o.spread || 0.1;
      for (let k = 0; k < n; k++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = x + rand(-s, s); this.pos[i3 + 1] = y + rand(-s, s); this.pos[i3 + 2] = z + rand(-s, s);
        const vx = rand(-1, 1), vy = rand(-0.3, 1), vz = rand(-1, 1);
        const L = Math.hypot(vx, vy, vz) || 1, sp = sp0 * rand(0.25, 1);
        this.vel[i3] = (vx / L) * sp + (o.dx || 0) * rand(0.5, 1.3);
        this.vel[i3 + 1] = (vy / L) * sp + (o.dy || 0) * rand(0.5, 1.3);
        this.vel[i3 + 2] = (vz / L) * sp + (o.dz || 0) * rand(0.5, 1.3);
        this.life[i] = (o.life || 1.6) * rand(0.6, 1.2);
        this.size[i] = (o.size || 0.11) * rand(0.5, 1.5);
        this.alpha[i] = 1;
      }
      this.stain = o.stain !== undefined ? o.stain : 0.12;
    }
    update(dt) {
      const { pos, vel, life, alpha } = this;
      for (let i = 0; i < this.max; i++) {
        if (life[i] <= 0) continue;
        const i3 = i * 3;
        life[i] -= dt;
        vel[i3 + 1] -= 17 * dt;
        const d = Math.exp(-0.8 * dt);
        vel[i3] *= d; vel[i3 + 2] *= d;
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        const ground = G.heightAt(pos[i3], pos[i3 + 2]);
        if (pos[i3 + 1] <= ground + 0.03 || life[i] <= 0) {
          if (life[i] > 0 && Math.random() < (this.stain || 0.12)) G.fx.decals.add(pos[i3], pos[i3 + 2], rand(0.18, 0.45));
          life[i] = 0; pos[i3 + 1] = -9999; alpha[i] = 0;
          continue;
        }
        alpha[i] = Math.min(1, life[i] / 0.25);
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.alpha.fill(0); for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999; }
  }

  // blood stains on the ground, conforming to the terrain slope
  class Decals {
    constructor(max) {
      this.max = max; this.i = 0;
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      this.mat = new THREE.MeshStandardMaterial({
        map: splatTex, color: new THREE.Color(0.16, 0.0, 0.006), transparent: true, depthWrite: false,
        roughness: 0.15, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
      this.mesh.frustumCulled = false;
      this.mesh.receiveShadow = true;
      this.mesh.renderOrder = 1;
      this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
      this.up = new THREE.Vector3(0, 1, 0); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
      this.clear();
      scene.add(this.mesh);
    }
    add(x, z, size) {
      if (!G.settings.blood) return;
      const n = G.normalAt(x, z);
      this.p.set(x, G.heightAt(x, z) + 0.03, z);
      this.q.setFromUnitVectors(this.up, n);
      this.q2.setFromAxisAngle(this.up, rand(0, TAU));
      this.q.multiply(this.q2);
      this.s.set(size, 1, size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(this.i, this.m);
      this.i = (this.i + 1) % this.max;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    clear() {
      this.m.makeScale(0, 0, 0);
      for (let k = 0; k < this.max; k++) this.mesh.setMatrixAt(k, this.m);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  G.fx = {
    sparks: new Glow(2400, 0.26),
    flames: new Glow(1800, 0.9),
    blood: new Blood(2500),
    decals: new Decals(450),
  };
  G.fx.clear = () => { G.fx.sparks.clear(); G.fx.flames.clear(); G.fx.blood.clear(); G.fx.decals.clear(); };

  // screen-edge blood when the Spartan is wounded
  (function screenBlood() {
    const el = document.getElementById('bloodScreen');
    if (!el) return;
    const W = 1024, H = 576, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // a dark rim that thickens into the corners
    const rim = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    rim.addColorStop(0, 'rgba(60,0,2,0)'); rim.addColorStop(1, 'rgba(70,0,3,.85)');
    g.fillStyle = rim; g.fillRect(0, 0, W, H);
    const drop = (x, y, r, a) => {
      g.fillStyle = `rgba(${90 + Math.random() * 40},0,${Math.random() * 6},${a})`;
      g.beginPath(); g.ellipse(x, y, r, r * rand(0.6, 1), rand(0, TAU), 0, TAU); g.fill();
    };
    for (let i = 0; i < 14; i++) {
      // splatter clusters hugging the edges
      const side = i % 4;
      const x = side === 0 ? rand(0, 90) : side === 1 ? rand(W - 90, W) : rand(0, W);
      const y = side === 2 ? rand(0, 60) : side === 3 ? rand(H - 60, H) : rand(0, H);
      drop(x, y, rand(10, 26), 0.8);
      for (let k = 0; k < 18; k++) { const a = rand(0, TAU), r = rand(12, 70); drop(x + Math.cos(a) * r, y + Math.sin(a) * r, rand(1.5, 6), 0.75); }
      if (Math.random() < 0.6) { g.fillStyle = 'rgba(100,0,4,.7)'; g.fillRect(x - 1.5, y, 3, rand(20, 70)); }
    }
    el.style.backgroundImage = `url(${c.toDataURL()})`;
  })();;

  G.applyQuality();
})();
