// Yukon Gold Claims — 3D claim explorer.
// Real terrain (Government of Yukon elevation) + 2023 aerial photos, claims from GeoYukon (see tools/bake.py).
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

THREE.ColorManagement.enabled = false; // all colours are plain sRGB values, passed straight through

const $ = (s) => document.querySelector(s);
const GROUP_COLORS = { Wildcat: '#ffc83d', Raven: '#5ec8ff', Hector: '#ff7a45', Glacier: '#7fe08a', Claim: '#e09bff' };
const LITE = /lite/.test(location.search) || Math.min(innerWidth, innerHeight) < 560;
const nf = (n, d = 0) => n.toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------------------------------------------------------------- loading
const bar = $('#loading .bar i');
let loaded = 0;
const tick = () => { loaded++; bar.style.width = `${(loaded / 5) * 100}%`; };

const S = await fetch('assets/scene.json').then((r) => r.json()); tick();
const T = S.terrain;
const [TW, TH] = T.size;
const raw = new Uint16Array(await fetch(`assets/${T.file}`).then((r) => r.arrayBuffer())); tick();
const HF = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) HF[i] = raw[i] / T.units;

const texLoader = new THREE.TextureLoader();
const loadTex = (f) => texLoader.loadAsync(`assets/${f}`).then((t) => { tick(); return t; });
const [texWorld, texDetail, texWater] = await Promise.all([loadTex(S.world.file), loadTex(S.detail.file), loadTex(S.water.file)]);
$('#checked').textContent = new Date(`${S.checked}T12:00:00`).toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' });

function heightAt(x, z) {
  let fx = ((x + TW / 2) / TW) * (T.w - 1);
  let fz = ((z + TH / 2) / TH) * (T.h - 1);
  fx = Math.min(Math.max(fx, 0), T.w - 1.001);
  fz = Math.min(Math.max(fz, 0), T.h - 1.001);
  const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0, i = z0 * T.w + x0;
  const a = HF[i] * (1 - tx) + HF[i + 1] * tx;
  const b = HF[i + T.w] * (1 - tx) + HF[i + T.w + 1] * tx;
  return a * (1 - tz) + b * tz;
}

// ---------------------------------------------------------------- renderer, camera, controls
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1.25 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 10, 70000);
const controls = new MapControls(camera, canvas);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.36, minDistance: 120, maxDistance: 15000,
  zoomToCursor: true, screenSpacePanning: false, autoRotateSpeed: 0.45,
});
controls.listenToKeyEvents(window);

const time = { value: 0 };
const SUN = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
const FOG = new THREE.Color(0.85, 0.85, 0.8);
const aniso = renderer.capabilities.getMaxAnisotropy();
for (const t of [texWorld, texDetail]) t.anisotropy = aniso;

// ---------------------------------------------------------------- sky
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(30000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uSun: { value: SUN }, uFog: { value: FOG }, uZen: { value: new THREE.Color(0.3, 0.53, 0.82) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `uniform vec3 uSun, uFog, uZen; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); vec3 c = mix(uFog, uZen, smoothstep(-0.02, 0.5, d.y));
        float s = max(dot(d, normalize(uSun)), 0.); c += vec3(1., .86, .6) * (pow(s, 900.) * 1.6 + pow(s, 10.) * .16);
        gl_FragColor = vec4(c, 1.); }`,
  }),
);
sky.renderOrder = -1;
scene.add(sky);

// ---------------------------------------------------------------- claims overlay (painted onto the ground)
const D = { x0: S.detail.min[0], z0: S.detail.min[1], x1: S.detail.max[0], z1: S.detail.max[1] };
const DW = D.x1 - D.x0, DH = D.z1 - D.z0;
const ov = document.createElement('canvas');
ov.width = LITE ? 1024 : 1800;
ov.height = Math.round((ov.width * DH) / DW);
const ovCtx = ov.getContext('2d');
const texOverlay = new THREE.CanvasTexture(ov);

// ---------------------------------------------------------------- terrain
const STEP = LITE ? 4 : 2; // one vertex every 20 m (40 m on phones)
const nx = (T.w - 1) / STEP + 1, nz = (T.h - 1) / STEP + 1;
const pos = new Float32Array(nx * nz * 3);
const cdx = TW / (T.w - 1), cdz = TH / (T.h - 1);
for (let j = 0, k = 0; j < nz; j++) {
  for (let i = 0; i < nx; i++, k += 3) {
    const gi = i * STEP, gj = j * STEP;
    pos[k] = -TW / 2 + gi * cdx;
    pos[k + 1] = HF[gj * T.w + gi];
    pos[k + 2] = -TH / 2 + gj * cdz;
  }
}
const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
for (let j = 0, k = 0; j < nz - 1; j++) {
  for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.set([a, c, b, b, c, d], k);
    k += 6;
  }
}
const terrainGeo = new THREE.BufferGeometry();
terrainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
terrainGeo.setIndex(new THREE.BufferAttribute(idx, 1));
terrainGeo.computeVertexNormals();

const terrainMat = new THREE.ShaderMaterial({
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  uniforms: {
    tWorld: { value: texWorld }, tDetail: { value: texDetail }, tWater: { value: texWater }, tOverlay: { value: texOverlay },
    uSize: { value: new THREE.Vector2(TW, TH) }, uDetail: { value: new THREE.Vector4(D.x0, D.z0, D.x1, D.z1) },
    uTime: time, uSun: { value: SUN }, uFog: { value: FOG }, uCam: { value: new THREE.Vector3() },
    uFogRange: { value: new THREE.Vector2(4000, 30000) },
  },
  vertexShader: `varying vec3 vPos; varying vec3 vN;
    void main(){ vPos = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `
    uniform sampler2D tWorld, tDetail, tWater, tOverlay;
    uniform vec2 uSize, uFogRange; uniform vec4 uDetail; uniform float uTime;
    uniform vec3 uSun, uFog, uCam;
    varying vec3 vPos; varying vec3 vN;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= .5; } return v; }
    void main(){
      vec2 uvW = vec2((vPos.x + uSize.x * .5) / uSize.x, 1. - (vPos.z + uSize.y * .5) / uSize.y);
      vec3 col = texture2D(tWorld, uvW).rgb;
      vec2 uvD = vec2((vPos.x - uDetail.x) / (uDetail.z - uDetail.x), 1. - (vPos.z - uDetail.y) / (uDetail.w - uDetail.y));
      float inD = step(0., uvD.x) * step(uvD.x, 1.) * step(0., uvD.y) * step(uvD.y, 1.);
      if (inD > .5) {
        vec2 e = min(uvD, 1. - uvD);
        col = mix(col, texture2D(tDetail, uvD).rgb, smoothstep(0., .035, min(e.x, e.y)));
      }
      vec3 n = normalize(vN);
      col *= .74 + .46 * clamp(dot(n, uSun), 0., 1.);                                   // hill shading
      float cs = fbm(vPos.xz * .00032 + vec2(uTime * .006, uTime * .004));
      col *= mix(1., .8, smoothstep(.56, .78, cs));                                      // drifting cloud shadows
      float w = texture2D(tWater, uvW).r;
      if (w > .01) {                                                                     // animated river
        vec2 q = vPos.xz * .04;
        float r = fbm(q + vec2(uTime * .3, uTime * .16)) - fbm(q * 1.7 - vec2(uTime * .21, -uTime * .27));
        vec3 wc = mix(vec3(.13, .29, .33), vec3(.36, .55, .56), .5 + .6 * r);
        vec3 v = normalize(uCam - vPos);
        wc += vec3(1., .95, .82) * (pow(max(r, 0.), 2.) * 1.6 + pow(1. - max(v.y, 0.), 4.) * .3);
        col = mix(col, wc, w * .72);
      }
      vec4 o = texture2D(tOverlay, uvD) * inD;
      col = mix(col, o.rgb, o.a);
      float l = dot(col, vec3(.299, .587, .114));
      col = mix(vec3(l), col, 1.14) * vec3(1.05, 1.0, .94);                              // warm game grade
      float f = smoothstep(uFogRange.x, uFogRange.y, length(uCam - vPos));
      vec2 ed = min(vPos.xz + uSize * .5, uSize * .5 - vPos.xz);
      f = max(f, 1. - smoothstep(0., 2200., min(ed.x, ed.y)));                           // world edge fades into haze
      gl_FragColor = vec4(mix(col, uFog, f), 1.);
    }`,
});
const terrain = new THREE.Mesh(terrainGeo, terrainMat);
scene.add(terrain);

// ---------------------------------------------------------------- helpers for draped lines & glowing walls
function densify(ring, step) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  out.push(ring[ring.length - 1]);
  return out;
}

function lineGeo(rings, lift = 3, step = 12) {
  const p = [];
  for (const ring of rings) {
    const d = densify(ring, step);
    for (let i = 0; i < d.length - 1; i++) {
      p.push(d[i][0], heightAt(d[i][0], d[i][1]) + lift, d[i][1], d[i + 1][0], heightAt(d[i + 1][0], d[i + 1][1]) + lift, d[i + 1][1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

function wallGeo(rings, height, step = 10) {
  const p = [], v = [], ix = [];
  for (const ring of rings) {
    const d = densify(ring, step);
    const base = p.length / 3;
    for (const [x, z] of d) {
      const h = heightAt(x, z);
      p.push(x, h - 3, z, x, h + height, z);
      v.push(0, 1);
    }
    for (let i = 0; i < d.length - 1; i++) {
      const a = base + i * 2;
      ix.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  g.setIndex(ix);
  return g;
}

const wallMat = (color, opacity, pulse = 0) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uPulse: { value: pulse }, uTime: time },
  vertexShader: `attribute float aV; varying float vV;
    void main(){ vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uPulse, uTime; varying float vV;
    void main(){
      float a = pow(1. - vV, 1.5);
      a *= mix(1., .55 + .45 * (.5 + .5 * sin(vV * 16. - uTime * 3.2)), uPulse);
      a *= uOpacity * (1. + uPulse * .3 * sin(uTime * 2.4));
      gl_FragColor = vec4(uColor * a, a);
    }`,
});

const lineMat = (color, opacity) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });

// ---------------------------------------------------------------- claims, groups, package
const PKG = S.package;
const pkgSet = new Set(PKG.grants);
const groupByName = Object.fromEntries(S.groups.map((g) => [g.name, g]));
for (const c of S.claims) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of c.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  c.bb = [x0, z0, x1, z1];
}

scene.add(new THREE.LineSegments(lineGeo(S.others, 2.5, 20), lineMat(0xe8e8e8, 0.14)));
for (const g of S.groups) {
  const col = GROUP_COLORS[g.name] || '#fff';
  const rings = S.claims.filter((c) => c.group === g.name).map((c) => c.ring);
  scene.add(new THREE.LineSegments(lineGeo(rings, 3), lineMat(col, 0.95)));
  scene.add(new THREE.Mesh(wallGeo(rings, 6), wallMat(col, 0.35)));
  scene.add(new THREE.Mesh(wallGeo(g.outline, 22), wallMat(col, 0.6)));
}
scene.add(new THREE.Mesh(wallGeo(PKG.outline, 70), wallMat('#ffd25a', 1.0, 1)));

for (const r of S.roads) {
  const hw = r.kind === 'highway';
  scene.add(new THREE.LineSegments(lineGeo([r.pts], hw ? 4 : 3, 15), lineMat(hw ? 0xffd27a : 0xffe7bd, hw ? 0.95 : 0.6)));
}

const selWall = new THREE.Mesh(new THREE.BufferGeometry(), wallMat('#fff3c4', 1.0, 1));
scene.add(selWall);

// beacon of light over the package, like a quest marker
const pc = new THREE.Vector3(PKG.c[0], PKG.c[2], PKG.c[1]);
const beaconGeo = new THREE.CylinderGeometry(16, 26, 650, 32, 1, true).translate(0, 325, 0);
const beacon = new THREE.Mesh(beaconGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: time },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform float uTime; varying vec2 vUv;
    void main(){ float a = pow(1. - vUv.y, 1.6) * (.6 + .4 * sin(vUv.y * 40. - uTime * 4.));
      a *= (.9 + .1 * sin(uTime * 2.)) * 1.5;
      gl_FragColor = vec4(vec3(1., .8, .35) * a, a); }`,
}));
beacon.position.copy(pc);
scene.add(beacon);

const ringMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: time },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: `uniform float uTime; varying vec2 vUv;
    void main(){ float d = length(vUv - .5) * 2.; float t = fract(uTime * .35);
      float ring = smoothstep(.06, 0., abs(d - t)) * (1. - t);
      float core = smoothstep(.25, 0., d) * .5;
      float a = (ring + core) * step(d, 1.);
      gl_FragColor = vec4(vec3(1., .8, .35) * a, a); }`,
}));
ringMesh.scale.setScalar(260);
ringMesh.position.set(pc.x, pc.y + 4, pc.z);
scene.add(ringMesh);

// floating gold sparkles over the package
{
  const N = LITE ? 180 : 420, p = [], seed = [];
  const [ring] = PKG.outline;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  while (p.length < N * 3) {
    const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
    if (!inRing(x, z, ring)) continue;
    p.push(x, heightAt(x, z) + 2, z);
    seed.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  const sparkMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: time, uScale: { value: 1 } },
    vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA;
      void main(){ vec3 p = position; float t = fract(uTime * .045 + aSeed);
        p.y += t * 90.; p.x += sin(uTime * .7 + aSeed * 30.) * 4.;
        vA = sin(t * 3.14159) * (.45 + .55 * sin(uTime * 5. + aSeed * 60.));
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_PointSize = clamp(5. * uScale / -mv.z, 1.5, 36.);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA;
      void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a *= a * vA;
        gl_FragColor = vec4(vec3(1., .84, .4) * a, a); }`,
  });
  const sparks = new THREE.Points(g, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const setScale = () => { sparkMat.uniforms.uScale.value = (innerHeight * renderer.getPixelRatio()) / 2 / Math.tan((camera.fov * Math.PI) / 360); };
  setScale();
  addEventListener('resize', setScale);
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- state + overlay painting
const state = { sel: null, hover: null };

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawOverlay() {
  ovCtx.clearRect(0, 0, ov.width, ov.height);
  const sx = ov.width / DW, sz = ov.height / DH;
  for (const c of S.claims) {
    let a = pkgSet.has(c.grant) ? 0.3 : 0.15;
    if (state.sel?.kind === 'group' && state.sel.item.name === c.group) a = 0.34;
    if (state.sel?.kind === 'package' && pkgSet.has(c.grant)) a = 0.45;
    if (state.hover === c) a = Math.max(a, 0.42);
    if (state.sel?.kind === 'claim' && state.sel.item === c) a = 0.55;
    ovCtx.fillStyle = rgba(GROUP_COLORS[c.group] || '#ffffff', a);
    ovCtx.beginPath();
    c.ring.forEach(([x, z], i) => (i ? ovCtx.lineTo : ovCtx.moveTo).call(ovCtx, (x - D.x0) * sx, (z - D.z0) * sz));
    ovCtx.closePath();
    ovCtx.fill();
  }
  texOverlay.needsUpdate = true;
}
drawOverlay();

// ---------------------------------------------------------------- labels that float over the 3D world
const labelsEl = $('#labels');
const labels = [];
const PRIORITY = { pkg: 5, group: 4, road: 3, place: 2, num: 1 };
function addLabel(html, p, cls, { min = 0, max = Infinity, onClick, color } = {}) {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.innerHTML = html;
  if (color) el.style.setProperty('--c', color);
  if (onClick) {
    el.classList.add('click');
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  labelsEl.append(el);
  const L = { el, p, min, max, shown: true, pri: PRIORITY[cls] || 0, w: 0, h: 0 };
  labels.push(L);
  return L;
}
const v3 = new THREE.Vector3();
const placed = [];
function updateLabels() {
  // Higher-priority tags claim their screen space first; anything overlapping them hides (no pile-ups).
  placed.length = 0;
  for (const L of labels) {
    v3.copy(L.p).project(camera);
    const d = camera.position.distanceTo(L.p);
    let ok = v3.z < 1 && Math.abs(v3.x) < 1.15 && Math.abs(v3.y) < 1.15 && d >= L.min && d <= L.max;
    let x = 0, y = 0;
    if (ok) {
      x = (v3.x * 0.5 + 0.5) * innerWidth;
      y = (-v3.y * 0.5 + 0.5) * innerHeight;
      if (!L.w) { L.el.style.display = ''; L.shown = true; L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
      // big tags may climb up on a longer stem to dodge a tag that's already there; small ones just hide
      const tries = L.pri >= 4 ? 4 : 1;
      let lift = 0;
      ok = false;
      for (let k = 0; k < tries && !ok; k++) {
        lift = k * (L.h - 12);
        const r = [x - L.w / 2 - 4, y - L.h - lift - 4, x + L.w / 2 + 4, y - lift - 20 * Math.sign(lift) + 2];
        ok = !placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
        if (ok) placed.push(r);
      }
      if (ok && lift !== L.lift) { L.lift = lift; L.el.style.setProperty('--lift', `${lift}px`); }
    }
    if (ok !== L.shown) { L.el.style.display = ok ? '' : 'none'; L.shown = ok; }
    if (ok) L.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
  }
}

const P = (c, lift = 0) => new THREE.Vector3(c[0], c[2] + lift, c[1]);
addLabel(`<div class="in"><div class="tag"><b>★ Wildcat 1 &amp; 2</b><span>For lease</span></div><div class="stem"></div></div>`,
  P(PKG.c, 150), 'pkg', { onClick: () => selectPackage(true) });
for (const g of S.groups) {
  // Wildcat's group tag sits right next to the package marker, so it only appears once you're close
  addLabel(`<div class="in"><div class="tag"><i></i>${g.name}<small>${g.count} claims</small></div><div class="stem"></div></div>`,
    P(g.c, 60), 'group', { color: GROUP_COLORS[g.name], max: g.name === 'Wildcat' ? 2600 : 9000, onClick: () => selectGroup(g, true) });
}
for (const c of S.claims) {
  addLabel(`${c.num}`, P(c.c, 8), 'num', { color: GROUP_COLORS[c.group], max: 1500, onClick: () => selectClaim(c) });
}
const seen = new Set();
for (const pl of S.places) {
  if (seen.has(pl.name)) continue;
  seen.add(pl.name);
  addLabel(pl.name, P(pl.p, 30), 'place', { max: 14000 });
}
if (PKG.hwy_pt) {
  const hp = PKG.hwy_pt;
  addLabel('Klondike Highway', new THREE.Vector3(hp[0], heightAt(hp[0], hp[1]) + 20, hp[1]), 'road', { max: 9000 });
}
labels.sort((a, b) => b.pri - a.pri);

// ---------------------------------------------------------------- camera moves
let flight = null;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function viewFor(x, z, dist, az = 0.3, pol = 0.95) {
  const ty = heightAt(x, z);
  return {
    target: new THREE.Vector3(x, ty, z),
    pos: new THREE.Vector3(x + dist * Math.sin(pol) * Math.sin(az), ty + dist * Math.cos(pol), z + dist * Math.sin(pol) * Math.cos(az)),
  };
}
function currentOrbit() {
  const o = camera.position.clone().sub(controls.target);
  const dist = o.length();
  return { dist, az: Math.atan2(o.x, o.z), pol: Math.acos(Math.min(1, o.y / dist)) };
}
function flyTo(v, secs) {
  controls.autoRotate = false;
  setSpin(false);
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const d = p0.distanceTo(v.pos) + t0.distanceTo(v.target);
  const dur = (secs ?? Math.min(5.5, Math.max(1.4, 1.2 + d / 2500))) * 1000;
  return new Promise((done) => {
    flight = { p0, t0, p1: v.pos, t1: v.target, start: performance.now(), dur, lift: Math.min(2200, d * 0.18), done };
  });
}
function stepFlight(now) {
  const k = Math.min(1, (now - flight.start) / flight.dur), e = ease(k);
  camera.position.lerpVectors(flight.p0, flight.p1, e);
  camera.position.y += Math.sin(Math.PI * e) * flight.lift;
  controls.target.lerpVectors(flight.t0, flight.t1, e);
  camera.lookAt(controls.target);
  if (k === 1) { const f = flight; flight = null; controls.update(); f.done(); }
}
function cancelFlight() {
  if (flight) { const f = flight; flight = null; f.done(); }
}

// claims centre (for overview shots)
let cx0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cz1 = -Infinity;
for (const c of S.claims) { cx0 = Math.min(cx0, c.bb[0]); cz0 = Math.min(cz0, c.bb[1]); cx1 = Math.max(cx1, c.bb[2]); cz1 = Math.max(cz1, c.bb[3]); }
const CC = [(cx0 + cx1) / 2, (cz0 + cz1) / 2];
// wide shots pull back further on tall, narrow (phone) screens
const fit = (d) => d * Math.min(2, Math.max(1, 1.15 / camera.aspect));
const VIEWS = {
  title: () => viewFor(CC[0], CC[1] + 300, fit(5600), 0.5, 1.12),
  home: () => viewFor(CC[0], CC[1] + 200, fit(6200), 0.2, 0.9),
  package: () => viewFor(PKG.c[0], PKG.c[1], fit(1050), 0.35, 1.0),
  group: (g) => {
    const cl = S.claims.filter((c) => c.group === g.name);
    const ext = Math.max(...cl.map((c) => c.bb[2])) - Math.min(...cl.map((c) => c.bb[0]))
      + Math.max(...cl.map((c) => c.bb[3])) - Math.min(...cl.map((c) => c.bb[1]));
    return viewFor(g.c[0], g.c[1], fit(Math.max(900, ext * 1.15)), 0.25, 0.95);
  },
  claim: (c) => viewFor(c.c[0], c.c[1], 650, currentOrbit().az, 0.95),
};

// ---------------------------------------------------------------- picking (ray-march the height field)
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickGround(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let t = 0, prev = 0;
  for (let i = 0; i < 3000 && t < 40000; i++) {
    const above = o.y + d.y * t - heightAt(o.x + d.x * t, o.z + d.z * t);
    if (above < 0) {
      let a = prev, b = t;
      for (let k = 0; k < 14; k++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m - heightAt(o.x + d.x * m, o.z + d.z * m) < 0) b = m; else a = m;
      }
      return [o.x + d.x * b, o.z + d.z * b];
    }
    prev = t;
    t += Math.max(2, above * 0.35);
  }
  return null;
}
function claimAt(cx, cy) {
  const g = pickGround(cx, cy);
  if (!g) return null;
  const [x, z] = g;
  return S.claims.find((c) => x >= c.bb[0] && x <= c.bb[2] && z >= c.bb[1] && z <= c.bb[3] && inRing(x, z, c.ring)) || null;
}

// ---------------------------------------------------------------- info card
const card = $('#card');
const ha = (m2) => nf(m2 / 10000, 1);
const acres = (m2) => nf(m2 / 4046.86);
const fields = (m2) => nf(Math.max(1, Math.round(m2 / S.football_m2)));
const ICON = {
  phone: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  plane: '<svg viewBox="0 0 24 24"><path d="M2 16l20-8-8 14-2-6z"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18l-6.5 4 1.7-7.4-5.7-5 7.5-.7z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const GOV = `<span class="src ok">✔ Yukon government record</span>`;
const MAPD = `<span class="src map">Government map data</span>`;
const DRAFT = `<span class="src draft">Draft — being finalised</span>`;
const fact = (k, v, src = '') => `<li><span class="k">${k}</span><span class="v">${v}</span>${src}</li>`;
const stats = (m2) => `<div class="stats"><div><b>${acres(m2)}</b><span>acres</span></div><div><b>${ha(m2)}</b><span>hectares</span></div><div><b>~${fields(m2)}</b><span>football fields</span></div></div>`;

function showCard(html, color) {
  $('#groups').hidden = true;
  card.innerHTML = `<button class="btn sq ghost x" data-close aria-label="Close">${ICON.x}</button>${html}`;
  card.style.setProperty('--c', color || '#ffc83d');
  card.hidden = false;
  card.scrollTop = 0;
}
function closeCard() {
  card.hidden = true;
  state.sel = null;
  selWall.geometry.dispose();
  selWall.geometry = new THREE.BufferGeometry();
  drawOverlay();
}
card.addEventListener('click', (e) => {
  const b = e.target.closest('[data-close],[data-go],[data-interest]');
  if (!b) return;
  if (b.dataset.close !== undefined) closeCard();
  if (b.dataset.go === 'claim') flyTo(VIEWS.claim(state.sel.item));
  if (b.dataset.go === 'group') flyTo(VIEWS.group(state.sel.item));
  if (b.dataset.go === 'package') selectPackage(true);
  if (b.dataset.interest !== undefined) openContact(b.dataset.interest);
});

function selectClaim(c, fly = false) {
  state.sel = { kind: 'claim', item: c };
  selWall.geometry.dispose();
  selWall.geometry = wallGeo([c.ring], 34, 6);
  drawOverlay();
  const inPkg = pkgSet.has(c.grant);
  const name = `${c.group} ${c.num}`;
  showCard(`
    <div class="eyebrow">${c.group} group</div>
    <h2>${name}</h2>
    ${inPkg ? `<span class="badge">${ICON.star}&nbsp;Available for lease</span>` : `<span class="badge plain">Ask us about this claim</span>`}
    ${stats(c.area)}
    <ul class="facts">
      ${fact('Government claim number', c.grant, GOV)}
      ${fact('Status', c.status, GOV)}
      ${fact('Type', 'Placer gold claim · Mayo Mining District', GOV)}
      ${inPkg ? fact('Part of', 'The Wildcat 1 &amp; 2 lease package') : ''}
    </ul>
    <div class="card-btns">
      <button class="btn gold xl" data-interest="${name} (${c.grant})">${ICON.phone}<span>I'm interested</span></button>
      ${inPkg ? `<button class="btn xl" data-go="package">${ICON.star}<span>See the package</span></button>` : ''}
      <button class="btn xl" data-go="claim">${ICON.plane}<span>Fly to this claim</span></button>
    </div>`, GROUP_COLORS[c.group]);
  if (fly) flyTo(VIEWS.claim(c));
}

function selectGroup(g, fly = false) {
  state.sel = { kind: 'group', item: g };
  selWall.geometry.dispose();
  selWall.geometry = new THREE.BufferGeometry();
  drawOverlay();
  const isWild = g.name === 'Wildcat';
  showCard(`
    <div class="eyebrow">Claim group</div>
    <h2>${g.name}</h2>
    <span class="badge plain">${g.count} placer claims</span>
    ${stats(g.area)}
    <ul class="facts">
      ${fact('Status', `All ${g.count} claims active`, GOV)}
      ${fact('Where', 'North bank of the McQuesten River, Mayo Mining District', GOV)}
      ${fact('Packages', isWild ? 'Wildcat 1 &amp; 2 are available for lease now' : 'Lease packages for these claims are coming soon')}
    </ul>
    <div class="card-btns">
      <button class="btn gold xl" data-interest="${g.name} group">${ICON.phone}<span>I'm interested</span></button>
      ${isWild ? `<button class="btn xl" data-go="package">${ICON.star}<span>See Wildcat 1 &amp; 2</span></button>` : ''}
      <button class="btn xl" data-go="group">${ICON.plane}<span>Show me these claims</span></button>
    </div>`, GROUP_COLORS[g.name]);
  if (fly) flyTo(VIEWS.group(g));
}

function selectPackage(fly = false) {
  state.sel = { kind: 'package', item: PKG };
  selWall.geometry.dispose();
  selWall.geometry = new THREE.BufferGeometry();
  drawOverlay();
  const pk = S.claims.filter((c) => pkgSet.has(c.grant));
  showCard(`
    <div class="eyebrow">First package · available now</div>
    <h2>Wildcat 1 &amp; 2</h2>
    <span class="badge">${ICON.star}&nbsp;For lease</span>
    ${stats(PKG.area)}
    <ul class="facts">
      ${fact('Claims', pk.map((c) => `${c.group} ${c.num} · ${c.grant}`).join('<br>'), GOV)}
      ${fact('Status', 'Active', GOV)}
      ${fact('Where', 'North bank of the McQuesten River, Mayo Mining District', GOV)}
      ${PKG.hwy_km != null ? fact('Road', `Klondike Highway is about ${nf(PKG.hwy_km, 1)} km away (straight line)`, MAPD) : ''}
      ${fact('Proposed deal', '10-year lease · the owner receives 10% of the gold recovered', DRAFT)}
    </ul>
    <div class="card-btns">
      <button class="btn gold xl" data-interest="Wildcat 1 &amp; 2 lease package">${ICON.phone}<span>I'm interested</span></button>
      <button class="btn xl" data-go="package">${ICON.plane}<span>Fly there</span></button>
    </div>`, '#ffc83d');
  if (fly) flyTo(VIEWS.package());
}

// group list sheet
$('#group-list').innerHTML =
  `<button class="grp star" data-pkg style="--c:#ffc83d"><i></i><div><b>★ Wildcat 1 &amp; 2</b><span>For lease now · ${acres(PKG.area)} acres</span></div></button>` +
  S.groups.map((g) => `<button class="grp" data-g="${g.name}" style="--c:${GROUP_COLORS[g.name]}"><i></i><div><b>${g.name}</b><span>${g.count} claims · ${acres(g.area)} acres</span></div></button>`).join('');
$('#groups').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { $('#groups').hidden = true; return; }
  const b = e.target.closest('.grp');
  if (!b) return;
  if (b.dataset.pkg !== undefined) selectPackage(true);
  else selectGroup(groupByName[b.dataset.g], true);
});

// ---------------------------------------------------------------- contact modal (not wired to a backend yet)
function openContact(about) {
  $('#contact-title').textContent = `Interested in ${about.replace(/ \(.*\)$/, '').replace('&amp;', '&')}?`;
  const f = $('#contact-form');
  f.hidden = false;
  f.about.value = about.replace('&amp;', '&');
  $('#contact-note').hidden = true;
  $('#contact').hidden = false;
  f.name.focus();
}
$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  e.target.hidden = true;
  $('#contact-note').hidden = false;
  setTimeout(() => { $('#contact').hidden = true; }, 4500);
});
for (const m of document.querySelectorAll('.modal')) {
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.hidden = true; });
}

// ---------------------------------------------------------------- tour
let tourI = -1, tourTimer = 0;
const TOUR = [
  { text: "Welcome to the McQuesten River valley in Canada's Yukon.", view: () => viewFor(CC[0] - 600, CC[1] + 900, fit(8200), -0.35, 0.95) },
  { text: `The Klondike Highway runs right past the claims — about ${nf(PKG.hwy_km ?? 1, 1)} km from Wildcat.`,
    view: () => {
      if (!PKG.hwy_pt) return VIEWS.home();
      // stand behind the highway, looking across it at the claims
      const az = Math.atan2(PKG.hwy_pt[0] - PKG.c[0], PKG.hwy_pt[1] - PKG.c[1]);
      return viewFor(PKG.c[0] * 0.7 + PKG.hwy_pt[0] * 0.3, PKG.c[1] * 0.7 + PKG.hwy_pt[1] * 0.3, fit(2300), az, 1.08);
    } },
  { text: '103 placer gold claims line the north bank of the river, in five groups.', view: () => viewFor(CC[0], CC[1], fit(4800), 0.45, 0.9),
    before: () => { $('#groups').hidden = true; card.hidden = true; } },
  { text: 'First up: Wildcat 1 & 2 — 36 acres, available for lease.', view: () => VIEWS.package(), after: () => selectPackage(false) },
  { text: 'Tap any coloured claim to see its details. Press “Whole area” any time to come back.', view: () => viewFor(PKG.c[0], PKG.c[1], 1400, 1.2, 1.05) },
];
function setCaption(i) {
  $('#caption').hidden = false;
  $('#caption .cap-step').textContent = `Tour · ${i + 1} of ${TOUR.length}`;
  $('#caption .cap-text').textContent = TOUR[i].text;
  $('#caption [data-cap="next"] span').textContent = i === TOUR.length - 1 ? 'Finish' : 'Next';
}
async function tourGo(i) {
  clearTimeout(tourTimer);
  if (i >= TOUR.length) return endTour();
  tourI = i;
  setCaption(i);
  const s = TOUR[i];
  s.before?.();
  await flyTo(s.view(), i === 0 ? 4.5 : undefined);
  if (tourI !== i) return;
  s.after?.();
  if (i === TOUR.length - 1) { controls.autoRotate = true; setSpin(true); }
  tourTimer = setTimeout(() => tourGo(i + 1), i === TOUR.length - 1 ? 9000 : 6500);
}
function endTour() {
  clearTimeout(tourTimer);
  tourI = -1;
  $('#caption').hidden = true;
}
$('#caption').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cap]');
  if (!b) return;
  if (b.dataset.cap === 'next') tourGo(tourI + 1); else endTour();
});

// ---------------------------------------------------------------- buttons
function setSpin(on) {
  controls.autoRotate = on;
  $('[data-act="spin"]').setAttribute('aria-pressed', String(on));
}
function toast(msg, ms = 4500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function nudge(kind) {
  const o = currentOrbit();
  let { dist, az, pol } = o;
  if (kind === 'in') dist = Math.max(controls.minDistance, dist * 0.6);
  if (kind === 'out') dist = Math.min(controls.maxDistance, dist * 1.6);
  if (kind === 'left') az -= Math.PI / 5;
  if (kind === 'right') az += Math.PI / 5;
  const t = controls.target;
  flyTo({
    target: t.clone(),
    pos: new THREE.Vector3(t.x + dist * Math.sin(pol) * Math.sin(az), t.y + dist * Math.cos(pol), t.z + dist * Math.sin(pol) * Math.cos(az)),
  }, 0.9);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a !== 'tour' && a !== 'spin') endTour();
  if (a === 'home') { closeCard(); $('#groups').hidden = true; flyTo(VIEWS.home()); }
  if (a === 'package') selectPackage(true);
  if (a === 'groups') { card.hidden = true; $('#groups').hidden = !$('#groups').hidden; }
  if (a === 'tour') { closeCard(); $('#groups').hidden = true; tourGo(0); }
  if (a === 'spin') setSpin(!controls.autoRotate);
  if (a === 'help') $('#help').hidden = false;
  if (['in', 'out', 'left', 'right'].includes(a)) nudge(a);
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  for (const m of document.querySelectorAll('.modal')) m.hidden = true;
  if (!card.hidden) closeCard();
  $('#groups').hidden = true;
});

// ---------------------------------------------------------------- pointer: tap to select, hover to preview
let down = null, hoverAt = null;
const tip = $('#tip');
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY };
  cancelFlight();
  if (tourI >= 0) clearTimeout(tourTimer);
  if (controls.autoRotate && $('#intro').hidden) setSpin(false);
});
canvas.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7) {
    const c = claimAt(e.clientX, e.clientY);
    if (c) selectClaim(c);
  }
  down = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' && !down) hoverAt = [e.clientX, e.clientY];
});
canvas.addEventListener('pointerleave', () => { hoverAt = null; setHover(null); });
function setHover(c, x, y) {
  if (c) {
    tip.textContent = `${c.group} ${c.num} — click for details`;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  tip.hidden = !c;
  document.body.classList.toggle('hovering', !!c);
  if (c !== state.hover) { state.hover = c; drawOverlay(); }
}

// ---------------------------------------------------------------- minimap
const mm = $('#minimap canvas');
const mmCtx = mm.getContext('2d');
const mmBase = document.createElement('canvas');
function buildMinimap() {
  const r = mm.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  mm.width = mmBase.width = Math.round(r.width * dpr);
  mm.height = mmBase.height = Math.round(r.height * dpr);
  const g = mmBase.getContext('2d');
  // show the middle of the world (the claims area) rather than the faded edges
  g.drawImage(texWorld.image, ...mmSrc(texWorld.image), 0, 0, mm.width, mm.height);
  g.lineWidth = Math.max(1, dpr * 0.8);
  for (const c of S.claims) {
    g.fillStyle = rgba(GROUP_COLORS[c.group], pkgSet.has(c.grant) ? 0.9 : 0.55);
    g.beginPath();
    c.ring.forEach(([x, z], i) => { const [px, py] = w2m(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.fill();
  }
  g.strokeStyle = '#ffd27a';
  g.lineWidth = 2 * dpr;
  for (const rd of S.roads.filter((r) => r.kind === 'highway')) {
    g.beginPath();
    rd.pts.forEach(([x, z], i) => { const [px, py] = w2m(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
  }
}
const MM = { x0: CC[0] - 4800, x1: CC[0] + 4800, z0: CC[1] - 3600, z1: CC[1] + 3600 };
function mmSrc(img) {
  const sx = img.width / TW, sz = img.height / TH;
  return [(MM.x0 + TW / 2) * sx, (MM.z0 + TH / 2) * sz, (MM.x1 - MM.x0) * sx, (MM.z1 - MM.z0) * sz];
}
const w2m = (x, z) => [((x - MM.x0) / (MM.x1 - MM.x0)) * mm.width, ((z - MM.z0) / (MM.z1 - MM.z0)) * mm.height];
function drawMinimap() {
  mmCtx.drawImage(mmBase, 0, 0);
  const [px, py] = w2m(camera.position.x, camera.position.z);
  const [tx, ty] = w2m(controls.target.x, controls.target.z);
  const ang = Math.atan2(ty - py, tx - px);
  const s = mm.width / 248;
  mmCtx.save();
  mmCtx.translate(tx, ty);
  mmCtx.fillStyle = 'rgba(255,255,255,.18)';
  mmCtx.beginPath();
  mmCtx.moveTo(0, 0);
  mmCtx.arc(0, 0, 60 * s, ang + Math.PI - 0.5, ang + Math.PI + 0.5);
  mmCtx.fill();
  mmCtx.rotate(ang);
  mmCtx.fillStyle = '#fff';
  mmCtx.strokeStyle = '#000';
  mmCtx.lineWidth = 2 * s;
  mmCtx.beginPath();
  mmCtx.moveTo(10 * s, 0); mmCtx.lineTo(-7 * s, -7 * s); mmCtx.lineTo(-3 * s, 0); mmCtx.lineTo(-7 * s, 7 * s); mmCtx.closePath();
  mmCtx.stroke();
  mmCtx.fill();
  mmCtx.restore();
}
$('#minimap').addEventListener('click', (e) => {
  const r = mm.getBoundingClientRect();
  const x = MM.x0 + ((e.clientX - r.left) / r.width) * (MM.x1 - MM.x0);
  const z = MM.z0 + ((e.clientY - r.top) / r.height) * (MM.z1 - MM.z0);
  endTour();
  const o = currentOrbit();
  flyTo(viewFor(x, z, Math.min(o.dist, 3000), o.az, o.pol));
});

// ---------------------------------------------------------------- keep the camera sane
const LIM = [TW / 2 - 2500, TH / 2 - 2500];
function clampCamera() {
  const t = controls.target;
  const dx = Math.max(-LIM[0], Math.min(LIM[0], t.x)) - t.x;
  const dz = Math.max(-LIM[1], Math.min(LIM[1], t.z)) - t.z;
  if (dx || dz) { t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
  t.y += (heightAt(t.x, t.z) - t.y) * 0.12;
  const g = heightAt(camera.position.x, camera.position.z) + 40;
  if (camera.position.y < g) camera.position.y = g;
}

// ---------------------------------------------------------------- go
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  buildMinimap();
}
addEventListener('resize', resize);
buildMinimap();

const start = VIEWS.title();
camera.position.copy(start.pos);
controls.target.copy(start.target);
controls.update();
setSpin(true);
controls.autoRotateSpeed = 0.35;

// adaptive quality: if the first seconds run slowly, render fewer pixels (older laptops & phones)
const perf = { frames: 0, t0: 0, done: false, from: performance.now() + 2500 }; // skip start-up hitches
function watchPerf(now) {
  if (perf.done || now < perf.from || document.hidden) return;
  if (!perf.t0) { perf.t0 = now; return; }
  perf.frames++;
  if (now - perf.t0 < 3000) return;
  const fps = (perf.frames * 1000) / (now - perf.t0);
  const pr = renderer.getPixelRatio();
  if (fps < 40 && pr > 1) {
    renderer.setPixelRatio(Math.max(1, pr * 0.7));
    renderer.setSize(innerWidth, innerHeight);
    perf.t0 = now; perf.frames = 0; // measure again at the new size
    return;
  }
  perf.done = true;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  time.value = clock.getElapsedTime();
  watchPerf(performance.now());
  if (flight) stepFlight(performance.now());
  else { controls.update(); clampCamera(); }
  terrainMat.uniforms.uCam.value.copy(camera.position);
  sky.position.copy(camera.position);
  if (hoverAt && !flight) {
    const [x, y] = hoverAt;
    hoverAt = null;
    setHover(claimAt(x, y), x, y);
  }
  updateLabels();
  drawMinimap();
  renderer.render(scene, camera);
});

renderer.compile(scene, camera);
$('#loading').classList.add('done');
setTimeout(() => $('#loading').remove(), 700);
$('#intro').hidden = false;
document.body.classList.add('intro');
$('#intro').addEventListener('click', (e) => {
  const b = e.target.closest('[data-intro]');
  if (!b) return;
  $('#intro').hidden = true;
  document.body.classList.remove('intro');
  controls.autoRotateSpeed = 0.45;
  setSpin(false);
  if (b.dataset.intro === 'tour') tourGo(0);
  else {
    flyTo(VIEWS.home());
    toast('Tip: tap any coloured area to see that claim. Press Help if you get stuck.', 6000);
  }
});

// handy for testing from the console
window.YGC = { S, camera, controls, flyTo, VIEWS, selectClaim, selectGroup, selectPackage, heightAt };
