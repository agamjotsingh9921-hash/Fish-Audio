/* Wrath of Olympus — the open world.
   Height-mapped terrain with blended ground textures, a lake, wind-blown grass and
   forests, ruins, the three strongholds, the Temple of Polyphemos, chests and altars. */
(() => {
  'use strict';
  const G = window.G;
  const { TAU, clamp, lerp, rand, sstep, fbm, vnoise, hash2, V3 } = G.util;
  const scene = G.scene, renderer = G.renderer;

  // ===================================================================
  // Layout
  // ===================================================================
  const SIZE = 800, HALF = SIZE / 2, RES = 256, CELL = SIZE / RES;
  const POI = {
    start: { x: 0, z: 250, r: 22, name: 'Shrine of Hephaestus' },
    cross: { x: 40, z: 0, r: 14, name: 'Crossroads' },
    legion: { x: -190, z: 70, r: 34, name: 'Legion Camp', camp: true },
    harpy: { x: 200, z: 20, r: 26, raise: 15, name: 'Harpy Cliffs', camp: true },
    laby: { x: -60, z: -130, r: 40, name: 'Labyrinth Ruins', camp: true },
    temple: { x: 70, z: -262, r: 42, raise: 11, name: 'Temple of Polyphemos' },
  };
  const LAKE = { x: 140, z: 170, r: 75 };
  const PATHS = [['start', 'cross'], ['cross', 'legion'], ['cross', 'harpy'], ['cross', 'laby'], ['laby', 'temple'], ['start', [96, 214]], ['cross', 'temple']];

  // ===================================================================
  // Heights
  // ===================================================================
  function baseHeight(x, z) {
    let h = 9 + fbm(x * 0.0042 + 31.7, z * 0.0042 - 12.3, 5) * 22;
    h += (1 - Math.abs(fbm(x * 0.0021 - 7.1, z * 0.0021 + 5.3, 4))) * 16 - 8;
    h += fbm(x * 0.028, z * 0.028, 3) * 1.3;
    if (h < 2.5) h = 2.5 + (h - 2.5) * 0.25;
    const r = Math.max(Math.abs(x), Math.abs(z));
    const e = sstep(285, 390, r);
    h += e * e * 125 + e * fbm(x * 0.015, z * 0.015, 4) * 32;
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.r + fbm(x * 0.02, z * 0.02, 2) * 0.12;
    h = lerp(h, -5.5, 1 - sstep(0.5, 1.0, dl));
    return h;
  }
  for (const k in POI) {
    const p = POI[k];
    p.y = Math.max(3, baseHeight(p.x, p.z)) + (p.raise || 0);
  }
  // path polylines with a gentle wander
  const pathSegs = [];
  for (const [a, b] of PATHS) {
    const A = POI[a], Bp = Array.isArray(b) ? { x: b[0], z: b[1] } : POI[b];
    const n = 10;
    let px = A.x, pz = A.z;
    const dx = Bp.x - A.x, dz = Bp.z - A.z, L = Math.hypot(dx, dz);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const w = i === n ? 0 : Math.sin(t * Math.PI) * fbm(t * 3 + A.x * 0.01, A.z * 0.01, 2) * L * 0.18;
      const x = A.x + dx * t + (-dz / L) * w, z = A.z + dz * t + (dx / L) * w;
      pathSegs.push([px, pz, x, z]);
      px = x; pz = z;
    }
  }
  function pathDist(x, z) {
    let best = 1e9;
    for (const s of pathSegs) {
      const d = G.util.segDist2D(x, z, s[0], s[1], s[2], s[3])[0];
      if (d < best) best = d;
    }
    return best;
  }

  const N = RES + 1;
  const heights = new Float32Array(N * N);
  const grassW = new Float32Array(N * N);
  const pathW = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
      let h = baseHeight(x, z);
      for (const k in POI) {
        const p = POI[k];
        const d = Math.hypot(x - p.x, z - p.z);
        const w = 1 - sstep(p.r * 0.85, p.r * 1.5, d);
        if (w > 0) h = lerp(h, p.y, w);
      }
      const pd = pathDist(x, z);
      const pw = 1 - sstep(2.2, 4.5, pd);
      pathW[iz * N + ix] = pw;
      heights[iz * N + ix] = h;
    }
  }
  function sample(arr, x, z) {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    const ix = clamp(Math.floor(gx), 0, RES - 1), iz = clamp(Math.floor(gz), 0, RES - 1);
    const fx = clamp(gx - ix, 0, 1), fz = clamp(gz - iz, 0, 1);
    const i = iz * N + ix;
    const a = arr[i], b = arr[i + 1], c = arr[i + N], d = arr[i + N + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  const heightAt = (x, z) => sample(heights, x, z);
  const _n = new THREE.Vector3();
  function normalAt(x, z, out = _n) {
    const e = 1.2;
    return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  }
  G.heightAt = heightAt;
  G.normalAt = (x, z) => normalAt(x, z, new THREE.Vector3());

  // ===================================================================
  // Procedural textures
  // ===================================================================
  function genTex(size, fn, srgb) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const col = fn(x / size, y / size);
        const i = (y * size + x) * 4;
        d[i] = clamp(col[0], 0, 1) * 255; d[i + 1] = clamp(col[1], 0, 1) * 255; d[i + 2] = clamp(col[2], 0, 1) * 255; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas: c, tex: makeTex(c, srgb) };
  }
  function makeTex(canvas, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (srgb) t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const grassT = genTex(256, (u, v) => {
    const n = fbm(u * 8, v * 8, 5, 8) * 0.5 + 0.5, s = fbm(u * 48, v * 48, 2, 48) * 0.5 + 0.5;
    const dry = sstep(0.55, 0.8, fbm(u * 4 + 9, v * 4, 3, 4) * 0.5 + 0.5);
    let c = mix3([0.22, 0.29, 0.11], [0.46, 0.48, 0.2], n);
    c = mix3(c, [0.6, 0.53, 0.28], dry * 0.7);
    const k = 0.82 + s * 0.3;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  const rockT = genTex(256, (u, v) => {
    const n = fbm(u * 6, v * 6, 5, 6) * 0.5 + 0.5;
    const r = 1 - Math.abs(fbm(u * 10 + 3, v * 10, 4, 10));
    const crack = sstep(0.9, 0.97, r);
    const c = mix3([0.36, 0.33, 0.29], [0.62, 0.58, 0.52], n);
    const k = 1 - crack * 0.45;
    return [c[0] * k, c[1] * k, c[2] * k];
  });
  const dirtT = genTex(256, (u, v) => {
    const n = fbm(u * 10, v * 10, 5, 10) * 0.5 + 0.5;
    const p = hash2(Math.floor(u * 96), Math.floor(v * 96)) > 0.93 ? 0.18 : 0;
    const c = mix3([0.36, 0.27, 0.18], [0.56, 0.45, 0.31], n);
    return [c[0] + p, c[1] + p, c[2] + p * 0.8];
  });
  const sandT = genTex(256, (u, v) => {
    const n = fbm(u * 16, v * 16, 4, 16) * 0.5 + 0.5;
    const c = mix3([0.62, 0.54, 0.4], [0.78, 0.7, 0.54], n);
    return c;
  });
  const marbleT = genTex(256, (u, v) => {
    const n = fbm(u * 4, v * 4, 5, 4);
    const vein = Math.pow(Math.abs(Math.sin((u * 3 + v * 2 + n * 2.2) * Math.PI)), 0.25);
    const c = mix3([0.55, 0.5, 0.44], [0.88, 0.84, 0.77], vein);
    return c;
  }, true);
  const blockT = genTex(256, (u, v) => {
    const n = fbm(u * 8, v * 8, 4, 8) * 0.5 + 0.5;
    const row = Math.floor(v * 4), off = (row % 2) * 0.25;
    const bu = (u + off) * 2 % 1, bv = v * 4 % 1;
    const edge = Math.min(bu, 1 - bu, bv * 0.5, (1 - bv) * 0.5);
    const mortar = 1 - sstep(0.0, 0.03, edge);
    const shade = 0.85 + hash2(Math.floor((u + off) * 2), row) * 0.25;
    const c = mix3([0.5, 0.43, 0.34], [0.74, 0.65, 0.52], n);
    const k = shade * (1 - mortar * 0.45);
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true);
  const woodT = genTex(128, (u, v) => {
    const n = fbm(u * 2, v * 24, 4, 2) * 0.5 + 0.5;
    return mix3([0.22, 0.14, 0.08], [0.42, 0.28, 0.16], n);
  }, true);
  const tileT = genTex(256, (u, v) => {
    const n = fbm(u * 8, v * 8, 4, 8) * 0.5 + 0.5;
    const tu = u * 4 % 1, tv = v * 4 % 1;
    const edge = Math.min(tu, 1 - tu, tv, 1 - tv);
    const k = (0.8 + hash2(Math.floor(u * 4), Math.floor(v * 4)) * 0.3) * (1 - (1 - sstep(0, 0.025, edge)) * 0.5);
    const c = mix3([0.4, 0.33, 0.27], [0.6, 0.52, 0.43], n);
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true);
  const rockMapTex = makeTex(rockT.canvas, true);
  // water normal map from a tiling height field
  const waterN = (() => {
    const S = 256, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const hf = (x, y) => fbm(x / S * 8, y / S * 8, 4, 8);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (hf(x + 1, y) - hf(x - 1, y)) * 6, dy = (hf(x, y + 1) - hf(x, y - 1)) * 6;
      const L = Math.hypot(dx, dy, 1);
      const i = (y * S + x) * 4;
      d[i] = (-dx / L * 0.5 + 0.5) * 255; d[i + 1] = (-dy / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return makeTex(c, false);
  })();

  // ===================================================================
  // Lighting
  // ===================================================================
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0x9fb6d8, 0x5a4632, 0.28);
  scene.add(hemi);
  function setShadowQuality(high) {
    const s = high ? 2048 : 1024, e = high ? 42 : 30;
    sun.shadow.mapSize.set(s, s);
    Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 300 });
    sun.shadow.camera.updateProjectionMatrix();
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  setShadowQuality(G.settings.quality === 'high');
  G.onQuality(setShadowQuality);

  // ===================================================================
  // Terrain mesh
  // ===================================================================
  const tgeo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES);
  tgeo.rotateX(-Math.PI / 2);
  const tp = tgeo.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heights[i]);
  tgeo.computeVertexNormals();
  const tn = tgeo.attributes.normal;
  const blend = new Float32Array(tp.count * 4);
  for (let i = 0; i < tp.count; i++) {
    const h = heights[i], ny = tn.getY(i), x = tp.getX(i), z = tp.getZ(i);
    let rock = sstep(0.84, 0.66, ny) + sstep(55, 80, h) * 0.7;
    let sand = sstep(2.6, 0.6, h);
    let dirt = pathW[i] * 0.95;
    for (const k of ['legion', 'laby', 'start', 'cross']) {
      const p = POI[k], d = Math.hypot(x - p.x, z - p.z);
      dirt = Math.max(dirt, (1 - sstep(p.r * 0.5, p.r * 0.95, d)) * (k === 'legion' ? 0.85 : 0.55) * (0.6 + 0.4 * (fbm(x * 0.1, z * 0.1, 2) * 0.5 + 0.5)));
    }
    rock = clamp(rock, 0, 1); sand = clamp(sand * (1 - rock), 0, 1); dirt = clamp(dirt * (1 - rock), 0, 1);
    const grass = Math.max(0, 1 - rock - sand - dirt);
    blend[i * 4] = grass; blend[i * 4 + 1] = rock; blend[i * 4 + 2] = dirt; blend[i * 4 + 3] = sand;
    grassW[i] = grass * (h > 0.6 ? 1 : 0) * (h < 70 ? 1 : 0);
  }
  tgeo.setAttribute('blend', new THREE.BufferAttribute(blend, 4));
  const terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tGrass: { value: grassT.tex }, tRock: { value: rockT.tex }, tDirt: { value: dirtT.tex }, tSand: { value: sandT.tex } });
    sh.vertexShader = 'attribute vec4 blend;\nvarying vec4 vBlend;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = blend; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = 'uniform sampler2D tGrass, tRock, tDirt, tSand;\nvarying vec4 vBlend;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `
        vec2 tuv = vWPos.xz * 0.16;
        vec3 gr = mix(texture2D(tGrass, tuv).rgb, texture2D(tGrass, tuv * 0.23 + 0.37).rgb, 0.45);
        vec3 an = abs(normalize(vWNrm)); an /= (an.x + an.y + an.z);
        vec3 rk = texture2D(tRock, vWPos.zy * 0.09).rgb * an.x + texture2D(tRock, vWPos.xz * 0.09).rgb * an.y + texture2D(tRock, vWPos.xy * 0.09).rgb * an.z;
        vec3 dt = texture2D(tDirt, tuv * 1.2).rgb;
        vec3 sd = texture2D(tSand, tuv).rgb;
        vec4 bw = vBlend / max(dot(vBlend, vec4(1.0)), 1e-3);
        vec3 alb = gr * bw.x + rk * bw.y + dt * bw.z + sd * bw.w;
        float macro = texture2D(tGrass, vWPos.xz * 0.0035).g;
        alb *= 0.78 + macro * 0.5;
        diffuseColor.rgb *= pow(alb, vec3(2.2));
      `);
  };
  const terrain = new THREE.Mesh(tgeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ===================================================================
  // Water
  // ===================================================================
  waterN.repeat.set(18, 18);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE.r * 1.45, 72),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(0.015, 0.07, 0.085), roughness: 0.05, metalness: 0.2, normalMap: waterN, normalScale: new THREE.Vector2(0.4, 0.4), transparent: true, opacity: 0.9, envMapIntensity: 1.3 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, 0, LAKE.z);
  water.receiveShadow = true;
  scene.add(water);

  // ===================================================================
  // Colliders (circles in a spatial grid)
  // ===================================================================
  const CG = 10, CN = Math.ceil(SIZE / CG);
  const cgrid = Array.from({ length: CN * CN }, () => []);
  function cAdd(x, z, r, tag) {
    const c = { x, z, r, tag, on: true };
    const x0 = clamp(Math.floor((x - r + HALF) / CG), 0, CN - 1), x1 = clamp(Math.floor((x + r + HALF) / CG), 0, CN - 1);
    const z0 = clamp(Math.floor((z - r + HALF) / CG), 0, CN - 1), z1 = clamp(Math.floor((z + r + HALF) / CG), 0, CN - 1);
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) cgrid[iz * CN + ix].push(c);
    return c;
  }
  function cPush(pos, radius) {
    const cx = Math.floor((pos.x + HALF) / CG), cz = Math.floor((pos.z + HALF) / CG);
    let hit = null;
    for (let dz = -1; dz <= 1; dz++) {
      const iz = cz + dz; if (iz < 0 || iz >= CN) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx; if (ix < 0 || ix >= CN) continue;
        for (const c of cgrid[iz * CN + ix]) {
          if (!c.on) continue;
          const ddx = pos.x - c.x, ddz = pos.z - c.z, m = c.r + radius, d2 = ddx * ddx + ddz * ddz;
          if (d2 < m * m) {
            const d = Math.sqrt(d2) || 1e-3;
            pos.x = c.x + (ddx / d) * m; pos.z = c.z + (ddz / d) * m;
            hit = c;
          }
        }
      }
    }
    return hit;
  }
  function cFree(x, z, r) {
    const cx = Math.floor((x + HALF) / CG), cz = Math.floor((z + HALF) / CG);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const iz = cz + dz, ix = cx + dx;
      if (iz < 0 || ix < 0 || iz >= CN || ix >= CN) continue;
      for (const c of cgrid[iz * CN + ix]) if (c.on && Math.hypot(x - c.x, z - c.z) < c.r + r) return false;
    }
    return true;
  }
  function wallColliders(x1, z1, x2, z2, thick, tag = 'wall') {
    const L = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.ceil(L / (thick * 0.9)));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(cAdd(lerp(x1, x2, i / n), lerp(z1, z2, i / n), thick * 0.6, tag));
    return out;
  }
  const nearPOI = (x, z, pad = 0) => {
    for (const k in POI) { const p = POI[k]; if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return k; }
    return null;
  };

  // ===================================================================
  // Geometry helpers
  // ===================================================================
  function mergeGeos(list) {
    let total = 0;
    const parts = list.map((g) => { const ng = g.index ? g.toNonIndexed() : g; total += ng.attributes.position.count; return ng; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    let o = 0;
    for (const g of parts) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + n) * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += n;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }
  G.mergeGeos = mergeGeos;
  function tint(g, r, gg, b, jitter = 0.1, shadeY = 0) {
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.count; i++) { minY = Math.min(minY, p.getY(i)); maxY = Math.max(maxY, p.getY(i)); }
    for (let i = 0; i < p.count; i++) {
      const k = (1 - jitter / 2 + hash2(Math.round(p.getX(i) * 50), Math.round(p.getZ(i) * 50 + p.getY(i) * 30)) * jitter) *
        (1 - shadeY + shadeY * ((p.getY(i) - minY) / (maxY - minY || 1)));
      c[i * 3] = r * k; c[i * 3 + 1] = gg * k; c[i * 3 + 2] = b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  // a lumpy ellipsoid with soft spherical normals (foliage, rocks)
  function blob(rx, ry, rz, cx, cy, cz, seed, rough = 0.22, detail = 1, sphereNormals = true) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + vnoise(x * 2.1 + seed + z * 1.3, y * 2.1 - z * 0.7 + seed * 0.5) * rough;
      if (sphereNormals) n.setXYZ(i, x, y, z);
      p.setXYZ(i, cx + x * rx * k, cy + y * ry * k, cz + z * rz * k);
    }
    if (!sphereNormals) g.computeVertexNormals();
    return g;
  }
  const windTime = { value: 0 };
  function addWind(mat, amp) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float wv = sin(uTime * 1.3 + ip.x * 0.07 + ip.z * 0.05) + 0.5 * sin(uTime * 2.7 + ip.x * 0.21 + ip.z * 0.13);
        float hk = max(position.y, 0.0);
        transformed.x += wv * ${amp.toFixed(5)} * hk * hk;
        transformed.z += wv * ${(amp * 0.6).toFixed(5)} * hk * hk;`);
    };
    return mat;
  }
  // static props are parented here, then batched into a few meshes per area
  const statics = new THREE.Group();
  scene.add(statics);
  const std = (color, rough = 0.85, metal = 0, extra = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal }, extra));
  function place(mesh, x, y, z, parent = statics, shadow = true) {
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const mats = {
    marble: std(0xffffff, 0.5, 0, { map: marbleT.tex }),
    block: std(0xffffff, 0.9, 0, { map: blockT.tex }),
    wood: std(0xffffff, 0.85, 0, { map: woodT.tex }),
    tile: std(0xffffff, 0.8, 0, { map: tileT.tex }),
    bronze: std(0x8a5a26, 0.35, 0.85),
    gold: std(0xc9a040, 0.3, 1.0),
    clothRed: std(0x6a0c08, 0.95, 0, { side: THREE.DoubleSide }),
    canvas: std(0xa89270, 0.95, 0, { side: THREE.DoubleSide }),
    bone: std(0xd8ccb0, 0.6),
    dark: std(0x1a1410, 0.9),
    rock: std(0xffffff, 0.95, 0, { map: rockMapTex, flatShading: true }),
  };
  tileT.tex.repeat.set(10, 10);

  // ===================================================================
  // Vegetation
  // ===================================================================
  const treeTypes = {
    cypress: (() => {
      const parts = [];
      for (let k = 0; k < 5; k++) parts.push(blob(0.95 - k * 0.14, 1.5, 0.95 - k * 0.14, 0, 2.3 + k * 1.45, 0, k * 3.1));
      const fol = tint(mergeGeos(parts), 0.045, 0.085, 0.03, 0.25, 0.5);
      const trunk = tint(new THREE.CylinderGeometry(0.12, 0.22, 3, 7).translate(0, 1.5, 0), 0.12, 0.08, 0.05);
      return { fol, trunk, r: 0.35 };
    })(),
    olive: (() => {
      const parts = [];
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; parts.push(blob(1.4, 0.95, 1.4, Math.cos(a) * 1.2, 3.3 + Math.sin(k * 2.3) * 0.35, Math.sin(a) * 1.2, k * 1.7)); }
      parts.push(blob(1.5, 1.1, 1.5, 0, 3.9, 0, 9.1));
      const fol = tint(mergeGeos(parts), 0.13, 0.155, 0.075, 0.3, 0.45);
      const tg = new THREE.CylinderGeometry(0.18, 0.34, 3.4, 8, 6).translate(0, 1.7, 0);
      const p = tg.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 1.3) * 0.25); p.setZ(i, p.getZ(i) + Math.cos(y * 0.9) * 0.15); }
      tg.computeVertexNormals();
      return { fol, trunk: tint(tg, 0.16, 0.13, 0.1), r: 0.45 };
    })(),
    pine: (() => {
      const parts = [];
      for (let k = 0; k < 4; k++) {
        const c = new THREE.ConeGeometry(2.2 - k * 0.45, 2.6, 9, 1).translate(0, 3 + k * 1.6, 0);
        const p = c.attributes.position;
        for (let i = 0; i < p.count; i++) { const f = 1 + vnoise(p.getX(i) * 3 + k, p.getZ(i) * 3) * 0.15; p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); }
        c.computeVertexNormals();
        parts.push(c);
      }
      const fol = tint(mergeGeos(parts), 0.03, 0.065, 0.035, 0.3, 0.5);
      const trunk = tint(new THREE.CylinderGeometry(0.15, 0.3, 4, 7).translate(0, 2, 0), 0.13, 0.085, 0.05);
      return { fol, trunk, r: 0.4 };
    })(),
  };
  const folMat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 0.0011);
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const treeList = { cypress: [], olive: [], pine: [] };
  (function scatterTrees() {
    const occ = new Set();
    for (let i = 0; i < 12000; i++) {
      const x = rand(-340, 340), z = rand(-340, 340);
      const h = heightAt(x, z);
      if (h < 1.6 || h > 95) continue;
      const n = normalAt(x, z);
      if (n.y < 0.72) continue;
      if (sample(pathW, x, z) > 0.05) continue;
      if (nearPOI(x, z, 8)) continue;
      const forest = fbm(x * 0.008 + 3, z * 0.008 - 1, 3);
      if (forest < 0.02 && Math.random() > 0.06) continue;
      const key = Math.floor(x / 4) + ',' + Math.floor(z / 4);
      if (occ.has(key)) continue;
      occ.add(key);
      const type = h > 34 ? 'pine' : (Math.random() < 0.55 ? 'cypress' : 'olive');
      const s = rand(0.8, 1.35);
      treeList[type].push([x, h, z, rand(0, TAU), s]);
      cAdd(x, z, treeTypes[type].r * s, 'tree');
      if (treeList.cypress.length + treeList.olive.length + treeList.pine.length > 1700) break;
    }
  })();
  const treeMeshes = [];
  for (const type in treeList) {
    const list = treeList[type], T = treeTypes[type];
    if (!list.length) continue;
    const fol = new THREE.InstancedMesh(T.fol, folMat, list.length);
    const trunk = new THREE.InstancedMesh(T.trunk, trunkMat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => {
      p.set(t[0], t[1] - 0.25, t[2]); q.setFromAxisAngle(up, t[3]); s.set(t[4], t[4] * rand(0.9, 1.15), t[4]);
      m.compose(p, q, s); fol.setMatrixAt(i, m); trunk.setMatrixAt(i, m);
    });
    fol.castShadow = trunk.castShadow = true;
    fol.frustumCulled = trunk.frustumCulled = false;
    fol.receiveShadow = trunk.receiveShadow = true;
    scene.add(fol, trunk);
    treeMeshes.push(fol, trunk);
  }

  // rocks
  const rockGeos = [0, 1, 2].map((k) => blob(1, 0.75, 1.15, 0, 0.2, 0, k * 7.7, 0.32, 2, false));
  (function scatterRocks() {
    const lists = [[], [], []];
    for (let i = 0; i < 3000 && lists[0].length + lists[1].length + lists[2].length < 420; i++) {
      const x = rand(-370, 370), z = rand(-370, 370), h = heightAt(x, z);
      if (h < 0.5) continue;
      const n = normalAt(x, z);
      const steep = n.y < 0.85, mtn = h > 40;
      if (!steep && !mtn && Math.random() > 0.15) continue;
      if (sample(pathW, x, z) > 0.1) continue;
      const poi = nearPOI(x, z, 2);
      if (poi && poi !== 'harpy' && poi !== 'laby') continue;
      const s = mtn ? rand(1.5, 4.5) : rand(0.5, 2.2);
      lists[i % 3].push([x, h, z, s]);
      if (s > 0.9) cAdd(x, z, s * 0.85, 'rock');
    }
    lists.forEach((list, k) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(rockGeos[k], mats.rock, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
      list.forEach((r, i) => {
        e.set(rand(-0.3, 0.3), rand(0, TAU), rand(-0.3, 0.3)); q.setFromEuler(e);
        p.set(r[0], r[1] - r[3] * 0.25, r[2]); s.set(r[3], r[3] * rand(0.6, 1.1), r[3] * rand(0.8, 1.2));
        m.compose(p, q, s); im.setMatrixAt(i, m);
      });
      im.castShadow = im.receiveShadow = true;
      im.frustumCulled = false;
      scene.add(im);
    });
  })();

  // grass: a field of tufts that follows the player
  const tuftGeo = (() => {
    const pos = [], col = [], nor = [];
    for (let b = 0; b < 8; b++) {
      const a = rand(0, TAU), off = rand(0, 0.2), ox = Math.cos(a) * off, oz = Math.sin(a) * off;
      const h = rand(0.32, 0.72), w = rand(0.03, 0.055), lean = rand(0.05, 0.28), la = rand(0, TAU), fa = rand(0, TAU);
      const px = -Math.sin(fa), pz = Math.cos(fa);
      const dry = Math.random() < 0.3;
      const tipC = dry ? [0.42, 0.36, 0.14] : [0.26, 0.3, 0.09], baseC = [0.035, 0.05, 0.015];
      const rows = [];
      for (let j = 0; j <= 3; j++) {
        const t = j / 3, wid = w * (1 - t * 0.92), bend = lean * t * t;
        const cx = ox + Math.cos(la) * bend, cz = oz + Math.sin(la) * bend, y = h * t;
        rows.push([[cx - px * wid, y, cz - pz * wid], [cx + px * wid, y, cz + pz * wid], t]);
      }
      for (let j = 0; j < 3; j++) {
        const [l0, r0, t0] = rows[j], [l1, r1, t1] = rows[j + 1];
        const c0 = mix3(baseC, tipC, t0), c1 = mix3(baseC, tipC, t1);
        pos.push(...l0, ...r0, ...l1, ...r0, ...r1, ...l1);
        col.push(...c0, ...c0, ...c1, ...c0, ...c1, ...c1);
        for (let k = 0; k < 6; k++) nor.push(0, 1, 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return g;
  })();
  const grassMat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), 0.35);
  const grass = { mesh: null, n: 0, sp: 0.72, cx: 1e9, cz: 1e9 };
  function buildGrass(high) {
    if (grass.mesh) { scene.remove(grass.mesh); grass.mesh.dispose && grass.mesh.dispose(); }
    grass.n = high ? 168 : 96;
    grass.sp = high ? 0.7 : 1.05;
    grass.mesh = new THREE.InstancedMesh(tuftGeo, grassMat, grass.n * grass.n);
    grass.mesh.frustumCulled = false;
    grass.mesh.receiveShadow = true;
    grass.cx = grass.cz = 1e9;
    scene.add(grass.mesh);
  }
  function updateGrass(px, pz) {
    const sp = grass.sp, n = grass.n;
    const cx = Math.round(px / sp), cz = Math.round(pz / sp);
    if (Math.abs(cx - grass.cx) * sp < 6 && Math.abs(cz - grass.cz) * sp < 6) return;
    grass.cx = cx; grass.cz = cz;
    const arr = grass.mesh.instanceMatrix.array;
    const half = n / 2, R = half * sp;
    let k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++, k += 16) {
        const gx = cx + i - half, gz = cz + j - half;
        const h1 = hash2(gx, gz), h2 = hash2(gz + 911, gx - 37);
        const x = (gx + h1) * sp, z = (gz + h2) * sp;
        const gw = sample(grassW, x, z);
        const dist = Math.hypot(x - px, z - pz);
        let s = gw < 0.3 + h1 * 0.35 ? 0 : (0.6 + h2 * 0.9) * gw * (1 - sstep(R * 0.7, R, dist));
        if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) s = 0;
        const y = s > 0 ? heightAt(x, z) - 0.04 : -999;
        const a = h1 * TAU, c = Math.cos(a) * s, sn = Math.sin(a) * s;
        arr[k] = c; arr[k + 1] = 0; arr[k + 2] = -sn; arr[k + 3] = 0;
        arr[k + 4] = 0; arr[k + 5] = s * (0.8 + h2 * 0.5); arr[k + 6] = 0; arr[k + 7] = 0;
        arr[k + 8] = sn; arr[k + 9] = 0; arr[k + 10] = c; arr[k + 11] = 0;
        arr[k + 12] = x; arr[k + 13] = y; arr[k + 14] = z; arr[k + 15] = 1;
      }
    }
    grass.mesh.instanceMatrix.needsUpdate = true;
  }
  buildGrass(G.settings.quality === 'high');
  G.onQuality((high) => buildGrass(high));

  // ===================================================================
  // Structures
  // ===================================================================
  const fires = []; // {x, y, z, big}
  const flamesAt = (x, y, z, big = false) => fires.push({ x, y, z, big });
  function column(x, z, h, broken, y = heightAt(x, z), parent = statics) {
    const g = new THREE.Group();
    place(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 2.2), mats.marble), 0, 0.2, 0, g);
    place(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.84, h, 20), mats.marble), 0, 0.45 + h / 2, 0, g);
    if (!broken) {
      place(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.78, 0.38, 20), mats.marble), 0, h + 0.62, 0, g);
      place(new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.32, 2.1), mats.marble), 0, h + 0.97, 0, g);
    } else {
      const top = place(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.75, 0.7, 9), mats.marble), 0.1, h + 0.75, 0, g);
      top.rotation.z = rand(-0.35, 0.35);
      for (let k = 0; k < 2; k++) {
        const d = place(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, rand(1, 1.8), 16), mats.marble), rand(-3, 3), 0.7, rand(-3, 3), g);
        d.rotation.set(Math.PI / 2, rand(0, TAU), 0);
      }
    }
    g.position.set(x, y - 0.15, z);
    parent.add(g);
    cAdd(x, z, 1.15, 'column');
    return g;
  }
  function wall(x1, z1, x2, z2, h, thick = 1.2, y) {
    const L = Math.hypot(x2 - x1, z2 - z1);
    const geo = new THREE.BoxGeometry(L, h, thick);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 4, uv.getY(i) * h / 4);
    const m = new THREE.Mesh(geo, mats.block);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const gy = y !== undefined ? y : Math.min(heightAt(x1, z1), heightAt(x2, z2), heightAt(cx, cz));
    place(m, cx, gy + h / 2 - 0.3, cz);
    m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    wallColliders(x1, z1, x2, z2, thick);
    return m;
  }
  function altarModel(x, z) {
    const y = heightAt(x, z), g = new THREE.Group();
    place(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.5, 24), mats.marble), 0, 0.2, 0, g);
    place(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.0), mats.block), 0, 1.0, 0, g);
    place(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.6), mats.bronze), 0, 1.65, 0, g);   // anvil
    place(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.4), mats.bronze), 0.55, 1.65, 0, g);
    for (const s of [-1, 1]) {
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.6, 8), mats.bronze), s * 1.8, 1.0, 0.6, g);
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.22, 0.3, 12), mats.bronze), s * 1.8, 1.85, 0.6, g);
      flamesAt(x + s * 1.8, y + 2.05, z + 0.6);
    }
    g.position.set(x, y - 0.1, z);
    statics.add(g);
    cAdd(x, z, 1.3, 'altar');
    return { x, z, y, g };
  }
  function chestModel(x, z, ang) {
    const y = heightAt(x, z), g = new THREE.Group();
    const wood = mats.wood, band = mats.gold;
    place(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.75), wood), 0, 0.3, 0, g);
    for (const s of [-0.42, 0.42]) place(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.78), band), s, 0.3, 0, g);
    const lid = new THREE.Group(); lid.position.set(0, 0.6, -0.37); g.add(lid);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 1.2, 12, 1, false, 0, Math.PI), wood);
    top.rotation.z = Math.PI / 2; top.position.set(0, 0, 0.37); top.castShadow = true; lid.add(top);
    for (const s of [-0.42, 0.42]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.08, 12, 1, false, 0, Math.PI), band);
      b.rotation.z = Math.PI / 2; b.position.set(s, 0, 0.37); lid.add(b);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.5, 0.5) }));
    lock.position.set(0, 0.5, 0.4); g.add(lock);
    g.position.set(x, y, z); g.rotation.y = ang;
    const n = normalAt(x, z); g.rotation.x = Math.atan2(n.z, n.y) * 0.5;
    scene.add(g);
    cAdd(x, z, 0.75, 'chest');
    return { g, lid, lock };
  }
  function beacon(x, z, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 260, 16, 1, true), mat);
    m.position.set(x, heightAt(x, z) + 130, z);
    m.renderOrder = 4;
    scene.add(m);
    return m;
  }

  // --- the shrine where the journey begins
  const altars = [];
  (function shrine() {
    const p = POI.start;
    altars.push(altarModel(p.x, p.z - 4));
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6 - 0.5) * 2.4;
      column(p.x + Math.sin(a) * 13, p.z - 4 + Math.cos(a) * 13, rand(6, 8.5), i === 2 || i === 5);
    }
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.5, 40), mats.tile);
    place(disc, p.x, p.y - 0.12, p.z - 4, statics, false);
  })();
  (function crossroads() {
    const p = POI.cross;
    altars.push(altarModel(p.x + 4, p.z));
    column(p.x - 6, p.z - 5, 5.5, true);
    column(p.x - 7, p.z + 6, 7, false);
    // signpost
    const g = new THREE.Group();
    place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 3, 6), mats.wood), 0, 1.5, 0, g);
    for (const k of ['legion', 'harpy', 'laby', 'temple']) {
      const t = POI[k], a = Math.atan2(t.x - p.x, t.z - p.z);
      const b = place(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 1.2), mats.wood), 0, 2.2 + Math.random() * 0.6, 0, g);
      b.rotation.y = a; b.translateZ(0.5);
    }
    g.position.set(p.x - 3, heightAt(p.x - 3, p.z + 3), p.z + 3);
    statics.add(g);
    cAdd(p.x - 3, p.z + 3, 0.3, 'post');
  })();

  // --- Legion Camp: palisade, tents, a bonfire, banners
  (function legionCamp() {
    const p = POI.legion, R = 25;
    const toCross = Math.atan2(POI.cross.x - p.x, POI.cross.z - p.z);
    const stakeGeo = mergeGeos([new THREE.CylinderGeometry(0.2, 0.22, 3.4, 7).translate(0, 1.7, 0), new THREE.ConeGeometry(0.2, 0.6, 7).translate(0, 3.7, 0)]);
    const stakes = [];
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * TAU;
      const da = Math.abs(((a - toCross + Math.PI * 3) % TAU) - Math.PI), db = Math.abs(((a - toCross + TAU) % TAU) - Math.PI);
      if (da < 0.13 || db < 0.1) continue; // gates
      const x = p.x + Math.sin(a) * R, z = p.z + Math.cos(a) * R;
      stakes.push([x, heightAt(x, z), z, rand(-0.1, 0.1), rand(0.85, 1.15)]);
      cAdd(x, z, 0.45, 'stake');
    }
    const im = new THREE.InstancedMesh(stakeGeo, mats.wood, stakes.length);
    const m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion();
    stakes.forEach((s, i) => { e.set(s[3], 0, -s[3]); q.setFromEuler(e); m.compose(V3(s[0], s[1] - 0.3, s[2]), q, V3(1, s[4], 1)); im.setMatrixAt(i, m); });
    im.castShadow = im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4, x = p.x + Math.sin(a) * 14, z = p.z + Math.cos(a) * 14;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.8, 4, 1, true), i % 2 ? mats.canvas : mats.clothRed);
      tent.rotation.y = a + Math.PI / 4;
      place(tent, x, heightAt(x, z) + 1.3, z);
      cAdd(x, z, 2.0, 'tent');
    }
    // bonfire
    const y = heightAt(p.x, p.z);
    for (let k = 0; k < 6; k++) {
      const log = place(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.8, 6), mats.wood), p.x, y + 0.4, p.z);
      log.rotation.set(1.0, (k / 6) * TAU, 0);
    }
    for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; place(new THREE.Mesh(blob(0.35, 0.25, 0.35, 0, 0, 0, k), mats.rock), p.x + Math.sin(a) * 1.4, y + 0.1, p.z + Math.cos(a) * 1.4); }
    flamesAt(p.x, y + 0.9, p.z, true);
    cAdd(p.x, p.z, 1.3, 'fire');
    // banners
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.9, x = p.x + Math.sin(a) * 20, z = p.z + Math.cos(a) * 20, gy = heightAt(x, z);
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 6, 6), mats.wood), x, gy + 3, z);
      const flag = place(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.2, 1, 4), mats.clothRed), x, gy + 4.6, z);
      flag.rotation.y = a; flag.translateX(0.68);
      cAdd(x, z, 0.3, 'pole');
    }
    // crates & weapon racks
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TAU), r = rand(5, 20), x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      if (!cFree(x, z, 1.2)) continue;
      const c = place(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats.wood), x, heightAt(x, z) + 0.45, z);
      c.rotation.y = rand(0, TAU);
      cAdd(x, z, 0.7, 'crate');
    }
  })();

  // --- Harpy Cliffs: nests and bones on a mesa
  (function harpyCliffs() {
    const p = POI.harpy;
    const stickMat = std(0x3a2a18, 0.95);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3, r = rand(6, 15), x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, y = heightAt(x, z);
      const nest = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.42, 7, 14), stickMat);
      nest.rotation.x = Math.PI / 2;
      place(nest, x, y + 0.3, z);
      for (let k = 0; k < 3; k++) place(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mats.bone), x + rand(-0.4, 0.4), y + 0.35, z + rand(-0.4, 0.4)).scale.y = 1.3;
      cAdd(x, z, 1.4, 'nest');
    }
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), r = rand(2, 20), x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      const b = place(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, rand(0.4, 0.9), 5), mats.bone), x, heightAt(x, z) + 0.05, z, statics, false);
      b.rotation.set(Math.PI / 2, rand(0, TAU), 0);
    }
    // dead trees
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU), r = rand(10, 20), x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r, y = heightAt(x, z);
      const g = new THREE.Group();
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.32, 5, 6), mats.dark), 0, 2.5, 0, g);
      for (let k = 0; k < 4; k++) {
        const br = place(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.1, 2, 5), mats.dark), 0, 2.5 + k * 0.6, 0, g);
        br.rotation.set(rand(0.6, 1.2), (k / 4) * TAU, 0); br.translateY(0.9);
      }
      g.position.set(x, y, z); statics.add(g);
      cAdd(x, z, 0.4, 'tree');
    }
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU), r = rand(14, 24), x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      const s = rand(1.2, 3);
      const rk = place(new THREE.Mesh(rockGeos[i % 3], mats.rock), x, heightAt(x, z) - s * 0.2, z);
      rk.scale.set(s, s * 0.8, s); rk.rotation.y = rand(0, TAU);
      cAdd(x, z, s * 0.85, 'rock');
    }
  })();

  // --- Labyrinth Ruins: concentric broken walls
  (function labyrinth() {
    const p = POI.laby, toCross = Math.atan2(POI.cross.x - p.x, POI.cross.z - p.z);
    [13, 22, 31].forEach((R, ring) => {
      const segs = 14 + ring * 6;
      const gapA = toCross + ring * 2.1;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU;
        const mid = (a0 + a1) / 2;
        const dg = Math.abs(((mid - gapA + Math.PI * 3) % TAU) - Math.PI);
        if (dg < 0.35) continue;
        if (hash2(i, ring + 5) < 0.2) continue;
        const h = rand(2.5, 4.6) * (hash2(i + 9, ring) < 0.25 ? 0.5 : 1);
        wall(p.x + Math.sin(a0) * R, p.z + Math.cos(a0) * R, p.x + Math.sin(a1) * R, p.z + Math.cos(a1) * R, h, 1.2, p.y);
      }
    });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; column(p.x + Math.sin(a) * 7, p.z + Math.cos(a) * 7, rand(2, 6), i % 2 === 0, p.y); }
    // bull skull altar at the centre
    const y = p.y;
    place(new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.4), mats.block), p.x, y + 0.5, p.z);
    const skull = place(new THREE.Mesh(blob(0.45, 0.35, 0.6, 0, 0, 0, 3, 0.1), mats.bone), p.x, y + 1.35, p.z);
    for (const s of [-1, 1]) { const h = place(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 7), mats.bone), p.x + s * 0.55, y + 1.6, p.z); h.rotation.z = -s * 1.1; }
    void skull;
    cAdd(p.x, p.z, 1.4, 'altar');
    flamesAt(p.x - 3, y + 1.9, p.z + 2); flamesAt(p.x + 3, y + 1.9, p.z + 2);
    for (const s of [-1, 1]) place(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 1.7, 8), mats.bronze), p.x + s * 3, y + 0.85, p.z + 2);
  })();

  // --- Temple of Polyphemos: the circular arena, sealed by fire
  const temple = (() => {
    const p = POI.temple, R = 30, y = p.y;
    const ent = Math.atan2(POI.laby.x - p.x, POI.laby.z - p.z);
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(R + 2, R + 3, 1, 72), mats.tile);
    place(floor, p.x, y - 0.42, p.z, statics, false);
    // mosaic
    const mosaic = G.canvasTex(1024, 1024, (g, w) => {
      g.translate(w / 2, w / 2);
      g.strokeStyle = '#c99a52'; g.fillStyle = '#c99a52'; g.lineWidth = 10;
      g.beginPath(); g.arc(0, 0, 500, 0, TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, 420, 0, TAU); g.stroke();
      g.lineWidth = 7;
      for (let k = 0; k < 40; k++) {
        g.save(); g.rotate((k / 40) * TAU); g.beginPath();
        g.moveTo(-30, -430); g.lineTo(-30, -490); g.lineTo(28, -490); g.lineTo(28, -445); g.lineTo(-8, -445); g.lineTo(-8, -470); g.lineTo(10, -470);
        g.stroke(); g.restore();
      }
      g.fillStyle = 'rgba(140,18,22,.7)';
      for (let k = 0; k < 16; k++) { g.save(); g.rotate((k / 16) * TAU); g.beginPath(); g.moveTo(-26, -70); g.lineTo(0, -330); g.lineTo(26, -70); g.closePath(); g.fill(); g.restore(); }
      g.fillStyle = '#c99a52'; g.beginPath(); g.arc(0, 0, 80, 0, TAU); g.fill();
    });
    mosaic.encoding = THREE.sRGBEncoding;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshStandardMaterial({ map: mosaic, transparent: true, roughness: 0.5, metalness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    disc.rotation.x = -Math.PI / 2; place(disc, p.x, y + 0.09, p.z, statics, false);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + 0.1;
      const d = Math.abs(((a - ent + Math.PI * 3) % TAU) - Math.PI);
      if (d < 0.3) continue;
      column(p.x + Math.sin(a) * (R - 3), p.z + Math.cos(a) * (R - 3), i % 4 === 1 ? rand(3, 5) : rand(9, 12), i % 4 === 1, y);
    }
    // outer wall with an entrance facing the labyrinth
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * TAU, a1 = ((i + 1) / segs) * TAU, mid = (a0 + a1) / 2;
      if (Math.abs(((mid - ent + Math.PI * 3) % TAU) - Math.PI) < 0.2) continue;
      wall(p.x + Math.sin(a0) * (R + 1.5), p.z + Math.cos(a0) * (R + 1.5), p.x + Math.sin(a1) * (R + 1.5), p.z + Math.cos(a1) * (R + 1.5), 2.6, 1.4, y);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5, x = p.x + Math.sin(a) * (R - 8), z = p.z + Math.cos(a) * (R - 8);
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 2.2, 8), mats.bronze), x, y + 1.1, z);
      place(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.35, 0.5, 12), mats.bronze), x, y + 2.35, z);
      flamesAt(x, y + 2.6, z);
      cAdd(x, z, 0.7, 'brazier');
    }
    // fire barrier across the entrance
    const gx = p.x + Math.sin(ent) * (R + 1.5), gz = p.z + Math.cos(ent) * (R + 1.5);
    const half = Math.sin(0.2) * (R + 1.5) + 0.8;
    const tx = Math.cos(ent), tz = -Math.sin(ent);
    const barrierCols = wallColliders(gx - tx * half, gz - tz * half, gx + tx * half, gz + tz * half, 1.4, 'barrier');
    const fireMat = new THREE.ShaderMaterial({
      uniforms: { time: windTime },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main(){ vec2 p = vec2(vUv.x * 8.0, vUv.y * 3.0 - time * 2.2);
          float f = n(p) * 0.6 + n(p * 2.1) * 0.3 + n(p * 4.3) * 0.1;
          float a = smoothstep(0.0, 0.9, f * (1.25 - vUv.y));
          vec3 c = mix(vec3(3.0, 0.6, 0.05), vec3(4.0, 2.4, 0.8), f);
          gl_FragColor = vec4(c * a, a); }`,
    });
    const barrier = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 7), fireMat);
    barrier.position.set(gx, y + 3.2, gz);
    barrier.rotation.y = ent;
    scene.add(barrier);
    const t = { x: p.x, z: p.z, y, R, ent, gx, gz, sealed: true, barrier };
    t.setSealed = (b) => {
      t.sealed = b; barrier.visible = b;
      barrierCols.forEach((c) => { c.on = b; });
    };
    return t;
  })();

  // scattered ruins along the land
  (function ruins() {
    for (let i = 0; i < 40; i++) {
      const x = rand(-320, 320), z = rand(-320, 320), h = heightAt(x, z);
      if (h < 2 || h > 40 || nearPOI(x, z, 10) || sample(pathW, x, z) > 0.1 || normalAt(x, z).y < 0.88) continue;
      if (!cFree(x, z, 3)) continue;
      const r = Math.random();
      if (r < 0.45) column(x, z, rand(2, 7), true);
      else if (r < 0.75) {
        const a = rand(0, TAU);
        column(x, z, 6, false); column(x + Math.cos(a) * 5, z - Math.sin(a) * 5, 6, false);
        const lin = place(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.9, 1.6), mats.marble), x + Math.cos(a) * 2.5, h + 7.3, z - Math.sin(a) * 2.5);
        lin.rotation.y = a;
      } else {
        // a fallen colossus head
        const g = new THREE.Group();
        place(new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 18), mats.marble), 0, 0, 0, g).scale.set(0.9, 1.1, 1);
        place(new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.9), mats.marble), 0, 0.1, 2.2, g);
        place(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.8), mats.marble), 0, 0.9, 1.9, g);
        g.position.set(x, h + 0.6, z); g.rotation.set(rand(-0.5, 0.5), rand(0, TAU), rand(0.6, 1.2));
        statics.add(g);
        cAdd(x, z, 2.4, 'statue');
      }
    }
  })();

  // ===================================================================
  // Chests, altars, beacons
  // ===================================================================
  const CHEST_SPOTS = [
    [8, 238, 'orbs'], [118, 92, 'orbs'], [-250, -60, 'eye'], [250, -170, 'orbs'], [-120, 205, 'feather'],
    [30, -180, 'orbs'], [-270, 215, 'orbs'], [-205, -225, 'feather'], [160, -110, 'eye'], [270, 160, 'orbs'],
  ];
  const chests = [];
  for (const [x0, z0, kind] of CHEST_SPOTS) {
    let x = x0, z = z0;
    for (let k = 0; k < 20 && (!cFree(x, z, 1.5) || heightAt(x, z) < 1); k++) { x = x0 + rand(-6, 6); z = z0 + rand(-6, 6); }
    const m = chestModel(x, z, rand(0, TAU));
    chests.push({ x, z, y: heightAt(x, z), kind, open: false, ...m, openT: 0 });
  }
  for (const k of ['legion', 'harpy', 'laby']) {
    const p = POI[k];
    let x = p.x + 3, z = p.z + 4;
    if (k === 'laby') { x = p.x; z = p.z - 3; }
    const m = chestModel(x, z, rand(0, TAU));
    chests.push({ x, z, y: heightAt(x, z), kind: 'reward', camp: k, open: false, ...m, openT: 0 });
  }
  const beacons = {};
  for (const k of ['legion', 'harpy', 'laby']) beacons[k] = beacon(POI[k].x, POI[k].z, new THREE.Color(1.6, 1.0, 0.35));
  beacons.temple = beacon(POI.temple.x, POI.temple.z, new THREE.Color(1.8, 0.3, 0.15));
  beacons.temple.visible = false;

  // ===================================================================
  // Batch the static props: one mesh per material per 100 m square
  // ===================================================================
  (function batchStatics() {
    statics.updateMatrixWorld(true);
    const buckets = new Map();
    statics.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const key = `${o.material.uuid}|${Math.floor(wp.x / 100)}|${Math.floor(wp.z / 100)}|${o.castShadow ? 1 : 0}`;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, shadow: o.castShadow, list: [] });
      buckets.get(key).list.push(o);
    });
    scene.remove(statics);
    for (const { mat, shadow, list } of buckets.values()) {
      const geos = list.map((m) => {
        const g = m.geometry.clone();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(m.matrixWorld);
        return g;
      });
      const merged = mergeGeos(geos);
      merged.deleteAttribute('color');
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      scene.add(mesh);
    }
  })();

  // ===================================================================
  // Map image for the minimap and world map
  // ===================================================================
  const mapCanvas = (() => {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const L = new THREE.Vector3(-0.5, 0.7, -0.5).normalize();
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const x = -HALF + (px + 0.5) * SIZE / S, z = -HALF + (py + 0.5) * SIZE / S;
      const h = heightAt(x, z), n = normalAt(x, z);
      let col;
      if (h < 0) col = mix3([70, 120, 130], [25, 55, 75], clamp(-h / 5, 0, 1));
      else {
        const gw = sample(grassW, x, z), pw = sample(pathW, x, z);
        col = mix3([125, 118, 104], [118, 124, 70], gw);
        col = mix3(col, [196, 164, 112], pw * 0.9);
        if (h < 1.6) col = mix3(col, [200, 186, 140], 0.6);
        col = mix3(col, [160, 150, 140], sstep(50, 90, h));
      }
      const shade = 0.55 + 0.6 * Math.max(0, n.dot(L));
      const i = (py * S + px) * 4;
      d[i] = clamp(col[0] * shade, 0, 255); d[i + 1] = clamp(col[1] * shade, 0, 255); d[i + 2] = clamp(col[2] * shade, 0, 255); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(30,50,20,.55)';
    for (const type in treeList) for (const t of treeList[type]) {
      g.beginPath(); g.arc((t[0] + HALF) / SIZE * S, (t[2] + HALF) / SIZE * S, 1.3, 0, TAU); g.fill();
    }
    return c;
  })();

  // ===================================================================
  // Per-frame world update
  // ===================================================================
  const lightPool = [0, 1, 2, 3].map(() => {
    const l = new THREE.PointLight(0xff8a3a, 0, 22, 1.8);
    scene.add(l);
    return l;
  });
  let lightT = 0;
  const sunOff = new THREE.Vector3();
  function update(dt, t, px, pz) {
    windTime.value = t;
    waterN.offset.set(t * 0.012, t * 0.008);
    updateGrass(px, pz);
    // sun follows the player; snap to shadow texels to avoid shimmering
    const py = heightAt(px, pz);
    const texel = (sun.shadow.camera.right * 2) / sun.shadow.mapSize.x;
    const sx = Math.round(px / texel) * texel, sz = Math.round(pz / texel) * texel;
    sunOff.copy(G.sky.sunDir).multiplyScalar(140);
    sun.target.position.set(sx, py, sz);
    sun.position.set(sx + sunOff.x, py + sunOff.y, sz + sunOff.z);
    // fires: four real lights go to the nearest flames
    lightT -= dt;
    if (lightT <= 0) {
      lightT = 0.3;
      const near = fires.map((f) => [f, (f.x - px) ** 2 + (f.z - pz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 4);
      lightPool.forEach((l, i) => {
        const f = near[i];
        if (f && f[1] < 90 * 90) { l.position.set(f[0].x, f[0].y + 0.6, f[0].z); l.userData.f = f[0]; }
        else l.userData.f = null;
      });
    }
    lightPool.forEach((l, i) => {
      const f = l.userData.f;
      l.intensity = f ? (f.big ? 2.6 : 1.4) + Math.sin(t * 9 + i * 7) * 0.2 + Math.sin(t * 23 + i) * 0.12 : 0;
      l.distance = f && f.big ? 30 : 20;
    });
    for (const f of fires) {
      const d2 = (f.x - px) ** 2 + (f.z - pz) ** 2;
      if (d2 > 110 * 110) continue;
      if (Math.random() < (f.big ? 1 : 0.55)) G.fx.flames.emit(f.x + rand(-0.25, 0.25), f.y, f.z + rand(-0.25, 0.25), f.big ? 2 : 1, { color: 0xff6a18, color2: 0xffb040, speed: 0.6, up: f.big ? 3 : 2, life: f.big ? 0.9 : 0.55, grav: -1, spread: f.big ? 0.6 : 0.15, bright: 1.6 });
    }
    if (temple.sealed && temple.barrier.visible && Math.random() < 0.8) {
      const k = rand(-1, 1) * Math.sin(0.2) * (temple.R + 1.5);
      G.fx.flames.emit(temple.gx + Math.cos(temple.ent) * k, temple.y + 0.3, temple.gz - Math.sin(temple.ent) * k, 1, { color: 0xff5a10, color2: 0xffaa30, speed: 1, up: 4, life: 0.9, grav: -1, bright: 2.5 });
    }
    for (const k in beacons) {
      const b = beacons[k];
      if (!b.visible) continue;
      const near = sstep(25, 70, Math.hypot(b.position.x - px, b.position.z - pz)); // fade out as you arrive
      b.material.opacity = (0.16 + Math.sin(t * 2) * 0.05) * near;
    }
    for (const c of chests) {
      if (c.open) {
        if (c.openT < 1) { c.openT = Math.min(1, c.openT + dt * 2.5); c.lid.rotation.x = -c.openT * 1.9; }
        continue;
      }
      if ((c.x - px) ** 2 + (c.z - pz) ** 2 < 40 * 40 && Math.random() < 0.08) G.fx.sparks.emit(c.x + rand(-0.6, 0.6), c.y + rand(0.4, 1.2), c.z + rand(-0.6, 0.6), 1, { color: 0xffd070, speed: 0.3, life: 0.8, grav: -0.3, bright: 2 });
    }
  }

  G.world = {
    SIZE, HALF, POI, LAKE, temple, chests, altars, beacons, mapCanvas,
    heightAt, normalAt: G.normalAt, grassAt: (x, z) => sample(grassW, x, z), pathAt: (x, z) => sample(pathW, x, z),
    colliders: { add: cAdd, push: cPush, free: cFree },
    nearPOI, update, mats,
    isWater: (x, z) => heightAt(x, z) < -0.7,
  };
  G.buildEnvironment();
})();
