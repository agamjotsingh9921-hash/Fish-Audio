/* Ashes of Varkova — engine.
   Math & noise, renderer with an HDR pipeline and a first-person overlay pass,
   night sky, horror audio, particles, blood and decals. */
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
  const angleLerp = (a, b, t) => { const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI; return a + d * t; };
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  function hash2(i, j) {
    let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, p = 0) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
    if (p > 0) { x0 = ((x0 % p) + p) % p; x1 = ((x1 % p) + p) % p; y0 = ((y0 % p) + p) % p; y1 = ((y1 % p) + p) % p; }
    const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  function fbm(x, y, oct = 5, p = 0) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, p ? p * f : 0); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
  G.util = { TAU, DEG, clamp, lerp, rand, smooth, sstep, damp, angleLerp, V3, hash2, vnoise, fbm };

  // ===================================================================
  // Settings
  // ===================================================================
  const isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('varkova-settings') || '{}') || {}; } catch (e) { saved = {}; }
  G.settings = { quality: saved.quality || (isTouch ? 'low' : 'high'), blood: saved.blood !== false, sens: saved.sens || 1, isTouch };
  G.saveSettings = () => {
    try { localStorage.setItem('varkova-settings', JSON.stringify({ quality: G.settings.quality, blood: G.settings.blood, sens: G.settings.sens })); } catch (e) { /* blocked */ }
  };

  // ===================================================================
  // Renderer
  // ===================================================================
  const host = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const canHDR = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 900);
  scene.add(camera);
  // first-person weapons render in their own pass so they never clip into walls
  const view = new THREE.Scene();
  const viewCam = new THREE.PerspectiveCamera(56, 1, 0.01, 10);
  G.renderer = renderer; G.scene = scene; G.camera = camera; G.view = view; G.viewCam = viewCam;
  G.heightAt = () => 0;
  G.normalAt = () => new THREE.Vector3(0, 1, 0);

  // ===================================================================
  // Post-processing
  // ===================================================================
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const quadScene = new THREE.Scene(), quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false; quadScene.add(quad);
  const passMat = (uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false });
  const brightMat = passMat({ tDiffuse: { value: null }, threshold: { value: 1.7 } }, `
    uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(max(c.r, c.g), c.b);
      gl_FragColor = vec4(min(c * max(l - threshold, 0.0) / max(l, 1e-4), vec3(20.0)), 1.0); }`);
  const blurMat = passMat({ tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, `
    uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
    void main(){ vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270;
      s += texture2D(tDiffuse, vUv + dir * 1.3846153).rgb * 0.3162162; s += texture2D(tDiffuse, vUv - dir * 1.3846153).rgb * 0.3162162;
      s += texture2D(tDiffuse, vUv + dir * 3.2307692).rgb * 0.0702702; s += texture2D(tDiffuse, vUv - dir * 3.2307692).rgb * 0.0702702;
      gl_FragColor = vec4(s, 1.0); }`);
  const compMat = passMat({
    tScene: { value: null }, tB1: { value: null }, tB2: { value: null },
    bloom: { value: 0.3 }, exposure: { value: 1.15 }, sat: { value: 0.82 }, vig: { value: 1.5 },
    time: { value: 0 }, hurt: { value: 0 }, fear: { value: 0 }, aspect: { value: 1 },
  }, `
    uniform sampler2D tScene, tB1, tB2;
    uniform float bloom, exposure, sat, vig, time, hurt, fear, aspect;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main(){
      vec2 q = vUv - 0.5;
      float ca = (0.0015 + fear * 0.004) * dot(q, q) * 4.0;
      vec3 c = vec3(texture2D(tScene, vUv + q * ca).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - q * ca).b);
      c += (texture2D(tB1, vUv).rgb + texture2D(tB2, vUv).rgb * 1.5) * bloom;
      c = aces(c * exposure);
      c = pow(c, vec3(1.0 / 2.2));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, sat - hurt * 0.5);
      c *= vec3(0.96, 1.0, 1.06);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      c *= 1.0 - dot(q * vec2(aspect, 1.0) * 0.8, q * vec2(aspect, 1.0) * 0.8) * vig;
      c = mix(c, vec3(0.25, 0.0, 0.0), hurt * smoothstep(0.2, 0.7, length(q)) * 0.7);
      float n = fract(sin(dot(vUv * vec2(1271.3, 917.1) + time, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.045;
      gl_FragColor = vec4(c, 1.0);
    }`);
  const post = { enabled: false, rt: null, bright: null, a: null, b: null, qa: null, qb: null };
  function makeRT(w, h, ms) {
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!ms, stencilBuffer: false };
    if (ms && THREE.WebGLMultisampleRenderTarget) { const rt = new THREE.WebGLMultisampleRenderTarget(w, h, opt); rt.samples = 4; return rt; }
    return new THREE.WebGLRenderTarget(w, h, opt);
  }
  function setupPost(w, h) {
    ['rt', 'bright', 'a', 'b', 'qa', 'qb'].forEach((k) => { if (post[k]) { post[k].dispose(); post[k] = null; } });
    post.enabled = G.settings.quality === 'high' && canHDR;
    if (!post.enabled) return;
    post.rt = makeRT(w, h, true);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    post.bright = makeRT(hw, hh); post.a = makeRT(hw, hh); post.b = makeRT(hw, hh); post.qa = makeRT(qw, qh); post.qb = makeRT(qw, qh);
  }
  function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); }
  G.post = compMat.uniforms;
  function drawWorld() {
    renderer.render(scene, camera);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(view, viewCam);
    renderer.autoClear = true;
  }
  G.render = function render() {
    if (post.enabled) {
      renderer.setRenderTarget(post.rt);
      drawWorld();
      brightMat.uniforms.tDiffuse.value = post.rt.texture; pass(brightMat, post.bright);
      const hw = post.bright.width, hh = post.bright.height, qw = post.qa.width, qh = post.qa.height;
      blurMat.uniforms.tDiffuse.value = post.bright.texture; blurMat.uniforms.dir.value.set(1 / hw, 0); pass(blurMat, post.a);
      blurMat.uniforms.tDiffuse.value = post.a.texture; blurMat.uniforms.dir.value.set(0, 1 / hh); pass(blurMat, post.b);
      blurMat.uniforms.tDiffuse.value = post.b.texture; blurMat.uniforms.dir.value.set(2 / qw, 0); pass(blurMat, post.qa);
      blurMat.uniforms.tDiffuse.value = post.qa.texture; blurMat.uniforms.dir.value.set(0, 2 / qh); pass(blurMat, post.qb);
      compMat.uniforms.tScene.value = post.rt.texture; compMat.uniforms.tB1.value = post.b.texture; compMat.uniforms.tB2.value = post.qb.texture;
      pass(compMat, null);
    } else {
      renderer.setRenderTarget(null);
      drawWorld();
    }
  };
  const qualityHooks = [];
  G.onQuality = (fn) => qualityHooks.push(fn);
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, G.settings.quality === 'high' ? 1.5 : 1);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h);
    camera.aspect = viewCam.aspect = w / h;
    camera.updateProjectionMatrix(); viewCam.updateProjectionMatrix();
    compMat.uniforms.aspect.value = w / h;
    setupPost(Math.floor(w * pr), Math.floor(h * pr));
    G.pointScale = (h * pr) / (2 * Math.tan((camera.fov * DEG) / 2));
    if (G.fx) G.fx.blood.mat.uniforms.scale.value = G.pointScale;
  }
  G.resize = resize;
  G.applyQuality = function applyQuality() {
    const usePost = G.settings.quality === 'high' && canHDR;
    renderer.toneMapping = usePost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputEncoding = usePost ? THREE.LinearEncoding : THREE.sRGBEncoding;
    const touch = (o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); };
    scene.traverse(touch); view.traverse(touch);
    resize();
    qualityHooks.forEach((fn) => fn(G.settings.quality === 'high'));
  };
  window.addEventListener('resize', resize);

  // ===================================================================
  // Night sky
  // ===================================================================
  const moonDir = new THREE.Vector3(0.35, 0.42, -0.84).normalize();
  const skyUniforms = {
    moonDir: { value: moonDir }, time: { value: 0 },
    zenith: { value: new THREE.Color(0.004, 0.006, 0.014) },
    horizon: { value: new THREE.Color(0.03, 0.036, 0.05) },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 moonDir, zenith, horizon; uniform float time; varying vec3 vDir;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float nn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fb(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * nn(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.5));
        float md = max(dot(d, moonDir), 0.0);
        if (y > 0.0) {
          vec2 sp = d.xz / (y + 0.35) * 260.0;
          float st = pow(hh(floor(sp)), 60.0) * smoothstep(0.05, 0.4, y);
          col += vec3(st) * (0.6 + 0.4 * sin(time * 3.0 + hh(floor(sp)) * 40.0));
        }
        col += vec3(0.5, 0.55, 0.7) * pow(md, 8.0) * 0.08 + vec3(0.7, 0.75, 0.9) * pow(md, 200.0) * 0.5;
        col += vec3(3.2, 3.3, 3.6) * smoothstep(0.99905, 0.9993, md);
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.12) * 1.1 + vec2(time * 0.006, time * 0.002);
          float c = smoothstep(0.42, 0.85, fb(uv * 1.4)) * smoothstep(0.0, 0.2, y);
          vec3 cc = vec3(0.02, 0.022, 0.03) + vec3(0.12, 0.13, 0.16) * pow(md, 6.0);
          col = mix(col, cc, c * 0.9);
        }
        col = mix(col, horizon * 0.6, smoothstep(0.05, -0.1, y));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(800, 40, 20), skyMat);
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -10;
  scene.add(skyMesh);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.02, 0.023, 0.03), 0.03);
  G.sky = { moonDir, uniforms: skyUniforms, mesh: skyMesh };
  G.setAtmosphere = function setAtmosphere(o) {
    scene.fog.color.setRGB(o.fog[0], o.fog[1], o.fog[2]);
    scene.fog.density = o.density;
    skyMesh.visible = !!o.sky;
    scene.background.setRGB(o.fog[0], o.fog[1], o.fog[2]);
    G.post.exposure.value = o.exposure || 1.15;
    renderer.toneMappingExposure = (o.exposure || 1.15) * 1.05;
  };
  // a dim night environment for reflections on metal and wet surfaces
  G.buildEnvironment = function buildEnvironment() {
    const W = 128, H = 64, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const theta = (0.5 - (py + 0.5) / H) * Math.PI, y = Math.sin(theta), cy = Math.cos(theta), phi = ((px + 0.5) / W - 0.5) * TAU;
      const md = Math.max(0, cy * Math.cos(phi) * moonDir.x + y * moonDir.y + cy * Math.sin(phi) * moonDir.z);
      const v = (y > 0 ? 0.06 + y * 0.03 : 0.035) + Math.pow(md, 30) * 0.5;
      const i = (py * W + px) * 4;
      d[i] = v * 0.8 * 255; d[i + 1] = v * 0.88 * 255; d[i + 2] = v * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromEquirectangular(tex).texture;
    view.environment = scene.environment;
    pm.dispose(); tex.dispose();
  };

  // ===================================================================
  // Audio — synthesised horror
  // ===================================================================
  G.sound = (() => {
    let ctx = null, master = null, music = null, noiseBuf = null, muted = false, verb = null;
    let amb = [], tense = null, tenseTarget = 0, timer = null, beat = 0, nextBeat = 0;
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // a simple reverb from a decaying noise impulse
      const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const b = ir.getChannelData(ch); for (let i = 0; i < len; i++) b[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      verb = ctx.createConvolver(); verb.buffer = ir;
      const vg = ctx.createGain(); vg.gain.value = 0.35; verb.connect(vg); vg.connect(master);
      music = ctx.createGain(); music.gain.value = 0.5; music.connect(master); music.connect(verb);
      tense = ctx.createGain(); tense.gain.value = 0; tense.connect(music);
    }
    const out = (wet) => { const g = ctx.createGain(); g.connect(master); if (wet) g.connect(verb); return g; };
    function noise(dur, f0, f1, q, vol, type = 'bandpass', when = 0, wet = true, dest = null) {
      if (!ctx) return;
      const t = ctx.currentTime + Math.max(0, when);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl); fl.connect(g); g.connect(dest || out(wet));
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    function tone(dur, f0, f1, vol, type = 'sine', when = 0, wet = true, dest = null, attack = 0.008) {
      if (!ctx) return;
      const t = ctx.currentTime + Math.max(0, when);
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || out(wet));
      o.start(t); o.stop(t + dur + 0.05);
    }
    function startAmbience(kind) {
      if (!ctx) return;
      stopAmbience();
      // wind (outdoors) or a low room tone (indoors)
      const ws = ctx.createBufferSource(); ws.buffer = noiseBuf; ws.loop = true;
      const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = kind === 'outside' ? 500 : 180;
      const wg = ctx.createGain(); wg.gain.value = kind === 'outside' ? 0.07 : 0.03;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = kind === 'outside' ? 0.05 : 0.01;
      lfo.connect(lg); lg.connect(wg.gain); ws.connect(wf); wf.connect(wg); wg.connect(master);
      ws.start(); lfo.start();
      // drone: a minor second rubbing in the dark
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      const dg = ctx.createGain(); dg.gain.value = 0.03;
      lp.connect(dg); dg.connect(music);
      const fs = kind === 'castle' ? [49, 51.9, 73.4] : [43.6, 46.2, 65.4];
      const oscs = fs.map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
      amb = [ws, lfo, wg, dg, ...oscs];
      // tension: a pulsing ostinato that swells during chases and fights
      nextBeat = ctx.currentTime + 0.1;
      timer = setInterval(() => {
        tense.gain.value += (tenseTarget - tense.gain.value) * 0.06;
        while (nextBeat < ctx.currentTime + 0.25) {
          const w = nextBeat - ctx.currentTime, s = beat % 8;
          if (s === 0 || s === 3 || s === 6) tone(0.4, 70, 34, 0.5, 'sine', w, true, tense);
          tone(0.18, s % 2 ? 110 : 116.5, s % 2 ? 108 : 114, 0.07, 'sawtooth', w, true, tense);
          nextBeat += 60 / 132 / 2; beat++;
        }
      }, 60);
    }
    function stopAmbience() {
      if (timer) { clearInterval(timer); timer = null; }
      amb.forEach((n) => { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* stopped */ } });
      amb = [];
    }
    return {
      init, startAmbience, stopAmbience,
      get muted() { return muted; },
      get ready() { return !!ctx; },
      toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.7; return muted; },
      setTension(v) { tenseTarget = clamp(v, 0, 1); },
      pistol() { noise(0.25, 3000, 400, 0.7, 0.9, 'lowpass'); tone(0.18, 160, 45, 0.7); noise(0.05, 6000, 3000, 1, 0.4, 'highpass', 0, false); },
      shotgun() { noise(0.5, 2500, 200, 0.6, 1.0, 'lowpass'); tone(0.35, 110, 30, 1.0); },
      empty() { noise(0.03, 5000, 3000, 4, 0.25, 'bandpass', 0, false); },
      reload() { noise(0.04, 3500, 2500, 5, 0.3, 'bandpass', 0, false); noise(0.05, 2500, 1800, 5, 0.3, 'bandpass', 0.35, false); },
      shell() { noise(0.06, 2200, 1500, 6, 0.3, 'bandpass', 0, false); },
      pump() { noise(0.07, 1600, 900, 3, 0.4, 'bandpass', 0, false); noise(0.06, 1400, 1000, 3, 0.35, 'bandpass', 0.12, false); },
      knife() { noise(0.16, 800, 3800, 1.6, 0.18, 'bandpass', 0, false); },
      flesh() { noise(0.14, 900, 160, 0.8, 0.35, 'lowpass'); tone(0.08, 90, 50, 0.2); },
      splat() { noise(0.3, 700, 120, 0.6, 0.45, 'lowpass'); },
      wood() { noise(0.2, 1200, 300, 1, 0.4, 'lowpass'); tone(0.12, 140, 70, 0.25, 'triangle'); },
      step(soft = 0) { noise(0.08, 1800 - soft * 900, 700, 1.4, 0.07 - soft * 0.03, 'bandpass', 0, false); },
      door() { tone(0.7, 110, 70, 0.08, 'sawtooth'); noise(0.5, 400, 200, 4, 0.08); },
      locked() { noise(0.06, 2000, 1200, 4, 0.3); noise(0.06, 1800, 1100, 4, 0.25, 'bandpass', 0.1); },
      growl(p = 1) { tone(0.6, 90 * p, 60 * p, 0.25, 'sawtooth', 0, true, null, 0.05); noise(0.6, 300 * p, 150, 2, 0.2); },
      snarl() { tone(0.35, 180, 90, 0.3, 'sawtooth'); noise(0.35, 1200, 400, 1.2, 0.3); },
      howl() { if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
        o.type = 'sawtooth'; vib.frequency.value = 5.5; vg.gain.value = 8; vib.connect(vg); vg.connect(o.frequency);
        o.frequency.setValueAtTime(280, t); o.frequency.linearRampToValueAtTime(520, t + 0.9); o.frequency.linearRampToValueAtTime(380, t + 2.6);
        const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 2;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
        o.connect(lp); lp.connect(g); g.connect(verb); g.connect(master); o.start(t); vib.start(t); o.stop(t + 3); vib.stop(t + 3); },
      scream(p = 1) { tone(0.7, 900 * p, 500 * p, 0.12, 'sawtooth'); noise(0.7, 2500 * p, 1200, 2, 0.15); },
      hurt() { tone(0.25, 220, 110, 0.18, 'square', 0, false); noise(0.15, 1400, 300, 1, 0.25); },
      heartbeat() { tone(0.12, 60, 40, 0.5, 'sine', 0, false); tone(0.12, 55, 38, 0.4, 'sine', 0.22, false); },
      stinger() { [55, 58.3, 82.4, 116.5, 123.5].forEach((f, i) => tone(2.2, f * 2, f * 1.9, 0.06, i % 2 ? 'sawtooth' : 'triangle', 0, true, null, 0.02)); noise(1.5, 200, 4000, 0.5, 0.25); },
      bell() { [220, 440, 528, 660, 880].forEach((f, i) => tone(5.5 - i * 0.8, f, f * 0.998, 0.12 / (i + 1), 'sine', 0, true, null, 0.004)); },
      pickup() { tone(0.12, 1046, 1568, 0.08, 'triangle', 0, false); tone(0.2, 1568, 2093, 0.06, 'sine', 0.08, false); },
      save() { [523, 659, 784].forEach((f, i) => tone(0.8, f, f, 0.06, 'sine', i * 0.15)); },
      merchant() { [392, 466, 523, 587, 523, 466].forEach((f, i) => tone(0.35, f, f, 0.05, 'triangle', i * 0.2)); },
      coin() { tone(0.1, 1800, 2400, 0.08, 'square', 0, false); },
      crate() { noise(0.25, 1500, 300, 0.8, 0.5, 'lowpass'); noise(0.15, 3000, 800, 1, 0.3, 'bandpass', 0.05); },
      boom() { tone(0.9, 80, 25, 0.9); noise(0.8, 900, 60, 0.7, 0.6, 'lowpass'); },
      flap() { noise(0.3, 300, 120, 1, 0.35, 'lowpass'); },
      bulletHit() { noise(0.05, 4000, 1500, 1.5, 0.15, 'bandpass', 0, false); },
      laugh() { [0, 0.18, 0.36].forEach((w) => tone(0.15, 420, 380, 0.06, 'sawtooth', w)); },
    };
  })();

  // ===================================================================
  // Particles, blood, decals
  // ===================================================================
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
  }
  G.canvasTex = canvasTex;
  const glowTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
  G.glowTex = glowTex;
  class Glow {
    constructor(max, size, additive = true) {
      this.max = max; this.cursor = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.base = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
      this.geo = geo;
      this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      this.points.frustumCulled = false; this.points.renderOrder = 3;
      scene.add(this.points);
      this.c1 = new THREE.Color(); this.c2 = new THREE.Color();
    }
    emit(x, y, z, n, o = {}) {
      this.c1.set(o.color !== undefined ? o.color : 0xff8a30);
      this.c2.set(o.color2 !== undefined ? o.color2 : (o.color !== undefined ? o.color : 0xff8a30));
      const bright = o.bright || 1, s = o.spread || 0, sp0 = o.speed !== undefined ? o.speed : 4;
      for (let k = 0; k < n; k++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = x + rand(-s, s); this.pos[i3 + 1] = y + rand(-s, s) * 0.5; this.pos[i3 + 2] = z + rand(-s, s);
        const vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1), L = Math.hypot(vx, vy, vz) || 1, sp = sp0 * rand(0.3, 1);
        this.vel[i3] = (vx / L) * sp + (o.dx || 0); this.vel[i3 + 1] = (vy / L) * sp + (o.up || 0); this.vel[i3 + 2] = (vz / L) * sp + (o.dz || 0);
        const life = (o.life || 0.6) * rand(0.6, 1.25);
        this.life[i] = life; this.maxLife[i] = life;
        const c = Math.random() < 0.5 ? this.c1 : this.c2;
        this.base[i3] = c.r * bright; this.base[i3 + 1] = c.g * bright; this.base[i3 + 2] = c.b * bright;
        this.grav[i] = o.grav !== undefined ? o.grav : 9; this.drag[i] = o.drag !== undefined ? o.drag : 1.5;
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
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.col.fill(0); for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999; }
  }
  const splatTex = canvasTex(128, 128, (g) => {
    g.translate(64, 64);
    const blob = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.7, `rgba(255,255,255,${a * 0.9})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    };
    blob(0, 0, 34, 1);
    for (let i = 0; i < 9; i++) { const a = rand(0, TAU), r = rand(10, 30); blob(Math.cos(a) * r, Math.sin(a) * r, rand(10, 20), 0.95); }
    for (let i = 0; i < 24; i++) { const a = rand(0, TAU), r = rand(36, 60); blob(Math.cos(a) * r, Math.sin(a) * r, rand(2, 6), 0.9); }
  });
  const holeTex = canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
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
        uniforms: { scale: { value: 600 }, color: { value: new THREE.Color(0.18, 0.003, 0.006) } },
        vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; uniform float scale;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; vA = aAlpha; }`,
        fragmentShader: `uniform vec3 color; varying float vA;
          void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.2, d) * vA; vec3 c = color * (0.75 + (0.5 - d) * 0.8);
          c += vec3(0.3, 0.06, 0.05) * pow(max(0.0, 0.22 - length(p - vec2(-0.13, -0.13))), 2.0) * 14.0;
          gl_FragColor = vec4(c, a); }`,
        transparent: true, depthWrite: false,
      });
      this.points = new THREE.Points(geo, this.mat);
      this.points.frustumCulled = false; this.points.renderOrder = 2;
      scene.add(this.points);
    }
    emit(x, y, z, n, o = {}) {
      if (!G.settings.blood) return;
      const sp0 = o.speed !== undefined ? o.speed : 4, s = o.spread || 0.1;
      for (let k = 0; k < n; k++) {
        const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
        const i3 = i * 3;
        this.pos[i3] = x + rand(-s, s); this.pos[i3 + 1] = y + rand(-s, s); this.pos[i3 + 2] = z + rand(-s, s);
        const vx = rand(-1, 1), vy = rand(-0.3, 1), vz = rand(-1, 1), L = Math.hypot(vx, vy, vz) || 1, sp = sp0 * rand(0.25, 1);
        this.vel[i3] = (vx / L) * sp + (o.dx || 0) * rand(0.5, 1.3);
        this.vel[i3 + 1] = (vy / L) * sp + (o.dy || 0) * rand(0.5, 1.3);
        this.vel[i3 + 2] = (vz / L) * sp + (o.dz || 0) * rand(0.5, 1.3);
        this.life[i] = (o.life || 1.6) * rand(0.6, 1.2);
        this.size[i] = (o.size || 0.08) * rand(0.5, 1.5);
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
        if (pos[i3 + 1] <= ground + 0.02 || life[i] <= 0) {
          if (life[i] > 0 && Math.random() < (this.stain || 0.12)) G.fx.decals.add(pos[i3], pos[i3 + 2], rand(0.15, 0.4));
          life[i] = 0; pos[i3 + 1] = -9999; alpha[i] = 0;
          continue;
        }
        alpha[i] = Math.min(1, life[i] / 0.25);
      }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
    }
    clear() { this.life.fill(0); this.alpha.fill(0); for (let i = 0; i < this.max; i++) this.pos[i * 3 + 1] = -9999; }
  }
  // flat decals: blood on floors, bullet holes on any surface
  class Decals {
    constructor(max, tex, color, rough, opacity = 1) {
      this.max = max; this.i = 0;
      const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
      this.mat = new THREE.MeshStandardMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, roughness: rough, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
      this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
      this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.q2 = new THREE.Quaternion();
      this.up = new THREE.Vector3(0, 1, 0); this.p = new THREE.Vector3(); this.s = new THREE.Vector3();
      this.clear();
      scene.add(this.mesh);
    }
    place(p, n, size) {
      this.p.copy(p);
      this.q.setFromUnitVectors(this.up, n);
      this.q2.setFromAxisAngle(this.up, rand(0, TAU));
      this.q.multiply(this.q2);
      this.s.set(size, 1, size);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(this.i, this.m);
      this.i = (this.i + 1) % this.max;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    add(x, z, size) {
      if (!G.settings.blood) return;
      this.place(new THREE.Vector3(x, G.heightAt(x, z) + 0.025, z), G.normalAt(x, z), size);
    }
    clear() { this.m.makeScale(0, 0, 0); for (let k = 0; k < this.max; k++) this.mesh.setMatrixAt(k, this.m); this.mesh.instanceMatrix.needsUpdate = true; }
  }
  G.fx = {
    sparks: new Glow(1500, 0.08),
    glow: new Glow(1200, 0.5),
    dust: new Glow(800, 0.35, false),
    blood: new Blood(3000),
    decals: new Decals(500, splatTex, new THREE.Color(0.1, 0.0, 0.004), 0.15),
    holes: new Decals(160, holeTex, new THREE.Color(0.01, 0.01, 0.01), 0.9, 0.9),
  };
  G.fx.clear = () => { ['sparks', 'glow', 'dust', 'blood', 'decals', 'holes'].forEach((k) => G.fx[k].clear()); };

  // screen-edge blood
  (function screenBlood() {
    const el = document.getElementById('bloodScreen');
    if (!el) return;
    const W = 1024, H = 576, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rim = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.62);
    rim.addColorStop(0, 'rgba(60,0,2,0)'); rim.addColorStop(1, 'rgba(70,0,3,.9)');
    g.fillStyle = rim; g.fillRect(0, 0, W, H);
    const drop = (x, y, r, a) => { g.fillStyle = `rgba(${80 + Math.random() * 40},0,${Math.random() * 6},${a})`; g.beginPath(); g.ellipse(x, y, r, r * rand(0.6, 1), rand(0, TAU), 0, TAU); g.fill(); };
    for (let i = 0; i < 16; i++) {
      const side = i % 4;
      const x = side === 0 ? rand(0, 90) : side === 1 ? rand(W - 90, W) : rand(0, W);
      const y = side === 2 ? rand(0, 60) : side === 3 ? rand(H - 60, H) : rand(0, H);
      drop(x, y, rand(10, 26), 0.8);
      for (let k = 0; k < 18; k++) { const a = rand(0, TAU), r = rand(12, 70); drop(x + Math.cos(a) * r, y + Math.sin(a) * r, rand(1.5, 6), 0.75); }
      if (Math.random() < 0.6) { g.fillStyle = 'rgba(90,0,4,.7)'; g.fillRect(x - 1.5, y, 3, rand(20, 70)); }
    }
    el.style.backgroundImage = `url(${c.toDataURL()})`;
  })();

  // ===================================================================
  // Geometry helpers shared by the level and the monsters
  // ===================================================================
  G.mergeGeos = function mergeGeos(list) {
    let total = 0;
    const parts = list.map((g) => { const ng = g.index ? g.toNonIndexed() : g; total += ng.attributes.position.count; return ng; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
    let o = 0, anyColor = false;
    for (const g of parts) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      if (g.attributes.color) { col.set(g.attributes.color.array, o * 3); anyColor = true; } else col.fill(1, o * 3, (o + n) * 3);
      o += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (anyColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  };
  // Flat colours are authored as sRGB hex; the renderer works in linear light.
  // Convert them once (glowing HDR colours above 1 are already linear and left alone).
  const lin = (c) => { if (c && Math.max(c.r, c.g, c.b) <= 1) c.convertSRGBToLinear(); };
  G.linearize = function linearize(root) {
    root.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (m.userData.lin || m.isShaderMaterial) continue;
        m.userData.lin = true;
        lin(m.color);
        if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) lin(m.emissive);
      }
    });
  };
  G.genTex = function genTex(size, fn, srgb = true) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const col = fn(x / size, y / size), i = (y * size + x) * 4;
      d[i] = clamp(col[0], 0, 1) * 255; d[i + 1] = clamp(col[1], 0, 1) * 255; d[i + 2] = clamp(col[2], 0, 1) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  };

  G.applyQuality();
})();
