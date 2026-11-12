import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { splAt, screenScoreAt, SPL_TARGET, money, fmtKg } from './calc.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Colour scales (shared with legend)
// ---------------------------------------------------------------------------
const splStops = [[78, '#1e1b4b'], [84, '#2563eb'], [90, '#10b981'], [97, '#84cc16'], [103, '#facc15'], [107, '#f97316'], [111, '#dc2626']];
const scrStops = [[2, '#10b981'], [4, '#22c55e'], [6, '#a3e635'], [8, '#facc15'], [10, '#f97316'], [13, '#dc2626']];
function ramp(stops, v, out = new THREE.Color()) {
  if (v <= stops[0][0]) return out.set(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const t = (v - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return out.set(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), t);
    }
  }
  return out.set(stops[stops.length - 1][1]);
}
export const splColor = (v, c) => ramp(splStops, v, c);
export const scrColor = (v, c) => (v > 50 ? (c || new THREE.Color()).set('#3f3f46') : ramp(scrStops, v, c));
export const legendGradient = (kind) => {
  const st = kind === 'audio' ? splStops : scrStops;
  const lo = st[0][0], hi = st[st.length - 1][0];
  return 'linear-gradient(90deg,' + st.map(([v, c]) => `${c} ${((v - lo) / (hi - lo)) * 100}%`).join(',') + ')';
};

// ---------------------------------------------------------------------------
// LED content shader
// ---------------------------------------------------------------------------
const ledVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `;
const ledFrag = `
uniform float uTime; uniform float uBright; uniform vec2 uRes; uniform float uDesat; varying vec2 vUv;
vec3 pal(float t){ return 0.5+0.5*cos(6.2831*(vec3(0.0,0.33,0.67)+t)); }
void main(){
  vec2 uv=vUv; float t=uTime*0.25;
  vec2 p=(uv-0.5)*vec2(uRes.x/uRes.y,1.0);
  float w=sin(p.x*3.0+t*2.0)+sin(p.y*4.0-t*1.5)+sin(length(p)*6.0-t*3.0);
  vec3 col=mix(vec3(0.05,0.02,0.15), pal(w*0.12+t*0.2)*vec3(0.6,0.45,1.0), 0.65);
  float ring=smoothstep(0.02,0.0,abs(length(p)-0.28-0.02*sin(t*4.0)));
  col+=vec3(0.9,0.85,1.0)*ring*1.2;
  float bar=step(abs(p.y+0.38),0.03)*step(abs(p.x),0.35);
  col+=vec3(1.0)*bar*0.8;
  vec2 g=fract(uv*uRes*12.0); float px=smoothstep(0.0,0.15,g.x)*smoothstep(0.0,0.15,g.y);
  col*=0.75+0.25*px;
  float l=dot(col,vec3(0.3,0.59,0.11)); col=mix(col,vec3(l),uDesat);
  gl_FragColor=vec4(col*uBright,1.0);
}`;

const beamVert = `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const beamFrag = `uniform vec3 uColor; uniform float uInt; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ float along=pow(vUv.y,2.2); float core=pow(abs(dot(normalize(vN),normalize(vV))),2.0);
  gl_FragColor=vec4(uColor*along*core*uInt,1.0); }`;

export class StageScene {
  constructor(container, { onHover }) {
    this.container = container;
    this.onHover = onHover;
    this.overlay = 'none';
    this.time = 0;
    this.ledMats = [];
    this.beams = [];
    this.hoverables = [];

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    container.prepend(r.domElement);

    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: 'absolute', top: 0, left: 0, pointerEvents: 'none' });
    container.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(40, 30, 40);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('start', () => (this.tween = null));

    this.scene.add(new THREE.HemisphereLight(0x9fb0ff, 0x302820, 1.1));
    this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.0);
    this.sun.position.set(30, 80, 40);
    this.scene.add(this.sun);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.95 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x3a2a3e, roughness: 1 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x1f3a1c, roughness: 1 }),
      wall: new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      deck: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.6, metalness: 0.1 }),
      skirt: new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0c0f, roughness: 0.7 }),
      speaker: new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.45, metalness: 0.4 }),
      grill: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8, metalness: 0.2, emissive: 0x111118 }),
      truss: new THREE.MeshStandardMaterial({ color: 0xa1a1aa, roughness: 0.35, metalness: 0.85 }),
      cable: new THREE.LineBasicMaterial({ color: 0x71717a, transparent: true, opacity: 0.3 }),
      projScreen: new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 1 }),
      chair: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }),
      roof: new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.8, side: THREE.DoubleSide }),
      err: new THREE.MeshBasicMaterial({ color: 0xff3344, wireframe: true }),
    };

    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    r.domElement.addEventListener('pointermove', (e) => {
      const b = r.domElement.getBoundingClientRect();
      this.mouse.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      this.mousePx = { x: e.clientX - b.left, y: e.clientY - b.top };
      this.needPick = true;
    });
    r.domElement.addEventListener('pointerleave', () => { this.mousePx = null; this.onHover(null); });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  clear() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.userData?.own) o.material.dispose();
      if (o.isCSS2DObject) o.element.remove();
    });
    this.root.clear();
    this.ledMats = []; this.beams = []; this.hoverables = []; this.overlayObjs = [];
  }

  label(text, pos, cls = '') {
    const el = document.createElement('div');
    el.className = 'lbl3d ' + cls;
    el.textContent = text;
    const o = new CSS2DObject(el);
    o.position.copy(pos);
    this.root.add(o);
    return o;
  }

  hoverable(obj, info) {
    obj.userData.info = info;
    this.hoverables.push(obj);
    return obj;
  }

  // -------------------------------------------------------------------------
  build(res) {
    this.res = res;
    this.clear();
    const { lay } = res;
    const { V, S } = lay;
    const R = this.root;
    const errScreen = res.issues.some((i) => i.title.startsWith('Screen does not fit'));

    // ---- environment ----
    if (V.indoor) {
      this.scene.background = new THREE.Color(0x07080c);
      this.scene.fog = new THREE.Fog(0x07080c, 80, 260);
      this.sun.intensity = 0.0;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(V.w, V.d), cfgMat(this.mats.carpet));
      floor.rotation.x = -Math.PI / 2;
      R.add(floor);
      const wallH = V.ceiling;
      const mk = (w, h, x, y, z, ry) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mats.wall);
        m.position.set(x, y, z); m.rotation.y = ry; R.add(m);
      };
      mk(V.w, wallH, 0, wallH / 2, -V.d / 2, 0);
      mk(V.d, wallH, -V.w / 2, wallH / 2, 0, Math.PI / 2);
      mk(V.d, wallH, V.w / 2, wallH / 2, 0, -Math.PI / 2);
      // ceiling grid = rigging plane
      const pts = [];
      const step = V.w > 50 ? 4 : 2;
      for (let x = -V.w / 2; x <= V.w / 2 + 0.01; x += step) pts.push(x, wallH, -V.d / 2, x, wallH, V.d / 2);
      for (let z = -V.d / 2; z <= V.d / 2 + 0.01; z += step) pts.push(-V.w / 2, wallH, z, V.w / 2, wallH, z);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const over = res.flown > V.rigLimitKg;
      const cm = new THREE.LineBasicMaterial({ color: over ? 0xff5566 : 0x3b4a6b, transparent: true, opacity: over ? 0.55 : 0.35 });
      cm.userData.own = true;
      R.add(new THREE.LineSegments(g, cm));
      this.label(`Ceiling ${V.ceiling} m · rig ${fmtKg(res.flown)} / ${fmtKg(V.rigLimitKg)}`, new THREE.Vector3(-V.w / 2 + 2, wallH + 0.4, -V.d / 2 + 2), over ? 'err' : 'dim');
    } else {
      this.scene.background = new THREE.Color(0x0b1020);
      this.scene.fog = new THREE.Fog(0x0b1020, 140, 420);
      this.sun.intensity = 0.25;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(V.w * 3, V.d * 3), this.mats.grass);
      ground.rotation.x = -Math.PI / 2;
      R.add(ground);
      const site = new THREE.Mesh(new THREE.PlaneGeometry(V.w, V.d), cfgMat(new THREE.MeshStandardMaterial({ color: 0x27401f, roughness: 1 }), true));
      site.rotation.x = -Math.PI / 2; site.position.y = 0.01;
      R.add(site);
      // perimeter fence
      const fp = [[-V.w / 2, -V.d / 2], [V.w / 2, -V.d / 2], [V.w / 2, V.d / 2], [-V.w / 2, V.d / 2], [-V.w / 2, -V.d / 2]];
      const fg = new THREE.BufferGeometry().setFromPoints(fp.map(([x, z]) => new THREE.Vector3(x, 1.1, z)));
      R.add(new THREE.Line(fg, new THREE.LineBasicMaterial({ color: 0x9ca3af })));
      // stars
      const sg = new THREE.BufferGeometry();
      const sp = [];
      for (let i = 0; i < 800; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 0.45 + 0.05; sp.push(Math.cos(a) * Math.cos(e) * 600, Math.sin(e) * 600, Math.sin(a) * Math.cos(e) * 600); }
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      R.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false })));
    }

    // ---- stage ----
    const stage = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(S.w, S.h, S.d), [this.mats.skirt, this.mats.skirt, this.mats.deck, this.mats.skirt, this.mats.skirt, this.mats.skirt]);
    deck.position.set(0, S.h / 2, lay.z0 + S.d / 2);
    stage.add(deck);
    this.hoverable(deck, { title: S.name, rows: [['Size', S.desc], ['Deck height', S.h + ' m'], ['Rental', money(S.cost)], ['Install', S.crewHours + ' crew-h']] });
    if (S.thrust) {
      const th = new THREE.Mesh(new THREE.BoxGeometry(4, S.h, 6), [this.mats.skirt, this.mats.skirt, this.mats.deck, this.mats.skirt, this.mats.skirt, this.mats.skirt]);
      th.position.set(0, S.h / 2, lay.zFront + 3);
      stage.add(th);
    }
    // stage edge light strip
    const strip = new THREE.Mesh(new THREE.BoxGeometry(S.w, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0x7c5cff }));
    strip.position.set(0, S.h, lay.zFront);
    stage.add(strip);
    // backdrop
    const back = new THREE.Mesh(new THREE.PlaneGeometry(S.w + 4, Math.min(V.indoor ? V.ceiling - 0.5 : 12, S.h + 9)), this.mats.black);
    back.position.set(0, back.geometry.parameters.height / 2, lay.z0 - 0.3);
    stage.add(back);
    // lectern / band riser
    const lectern = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.3, roughness: 0.4 }));
    lectern.position.set(S.w * 0.28, S.h + 0.575, lay.zFront - 2);
    stage.add(lectern);
    R.add(stage);
    this.label(`${S.name} · ${S.desc}`, new THREE.Vector3(0, S.h + 0.3, lay.zFront + 0.6), 'dim');

    // stage roof (outdoor)
    if (!V.indoor && res.structureItems.includes('Stage roof system')) {
      const rw = S.w + 10, rd = S.d + 4, rh = lay.trussY + 2;
      for (const sx of [-1, 1]) for (const sz of [0, 1]) {
        const tw = new THREE.Mesh(new THREE.BoxGeometry(0.6, rh, 0.6), this.mats.truss);
        tw.position.set(sx * rw / 2, rh / 2, lay.z0 - 1 + sz * rd);
        R.add(tw);
      }
      const rm = new THREE.MeshStandardMaterial({ color: 0x1b1d24, roughness: 0.8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
      rm.userData.own = true;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(rw + 1, 0.15, rd + 1), rm);
      const rf = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(rw + 1, 1.2, rd + 1)), new THREE.LineBasicMaterial({ color: 0xa1a1aa }));
      rf.position.set(0, rh, lay.z0 - 1 + rd / 2);
      R.add(rf);
      roof.position.set(0, rh + 0.6, lay.z0 - 1 + rd / 2);
      R.add(roof);
      this.hoverable(roof, { title: 'Stage roof system', rows: [['Why', 'Open air: flown gear needs a structure'], ['Cost', money(38000)], ['Build', '140 crew-h']] });
    }

    this.buildScreens(res, errScreen);
    this.buildAudio(res);
    this.buildLighting(res);
    this.buildAudience(res);

    // FOH
    const foh = new THREE.Group();
    const desk = new THREE.Mesh(new THREE.BoxGeometry(5, 1.0, 2.2), this.mats.black);
    desk.position.y = 0.5;
    foh.add(desk);
    const consoleTop = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 1.2), new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0x1e3a8a, emissiveIntensity: 0.6 }));
    consoleTop.position.set(0, 1.05, 0);
    foh.add(consoleTop);
    foh.position.set(0, 0, lay.fohZ);
    R.add(foh);
    this.hoverable(desk, { title: 'FOH mix position', rows: [['Distance to stage', (lay.fohZ - lay.zFront).toFixed(0) + ' m'], ['Seats displaced', '≈ 40']] });
    this.label('FOH', new THREE.Vector3(0, 1.8, lay.fohZ), 'dim');

    // dimension: back row distance
    if (lay.seats.length) {
      const d = lay.zBack - lay.zFront;
      const pts = [new THREE.Vector3(-lay.width / 2 - 1.5, 0.05, lay.zFront), new THREE.Vector3(-lay.width / 2 - 1.5, 0.05, lay.zBack)];
      R.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x94a3b8 })));
      this.label(`Back row ${d.toFixed(0)} m`, new THREE.Vector3(-lay.width / 2 - 1.5, 0.4, (lay.zFront + lay.zBack) / 2), 'dim');
    }

    this.buildOverlay(res);
    this.applyOverlay();
    if (!this.viewInit) { this.setView('overview', true); this.viewInit = true; }
  }

  // -------------------------------------------------------------------------
  buildScreens(res, errScreen) {
    const { lay } = res;
    const { SP, V } = lay;
    for (const sc of lay.screens) {
      const g = new THREE.Group();
      const isLed = sc.type === 'led';
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBright: { value: isLed ? 1.25 : 0.75 }, uRes: { value: new THREE.Vector2(sc.w, sc.h) }, uDesat: { value: isLed ? 0 : 0.35 } },
        vertexShader: ledVert, fragmentShader: ledFrag, toneMapped: false,
      });
      mat.userData.own = true;
      this.ledMats.push(mat);
      let surf;
      if (sc.curved) {
        const radius = sc.w * 0.9, theta = sc.w / radius;
        const geo = new THREE.CylinderGeometry(radius, radius, sc.h, 48, 1, true, Math.PI - theta / 2, theta);
        surf = new THREE.Mesh(geo, mat);
        mat.side = THREE.DoubleSide;
        surf.position.z = radius; // arc centre sits at z=0, edges wrap toward audience
      } else {
        surf = new THREE.Mesh(new THREE.PlaneGeometry(sc.w, sc.h), mat);
      }
      g.add(surf);
      if (isLed && !sc.side) { const gl = new THREE.PointLight(0x9a7cff, 30 + sc.w * 4, sc.w * 2.5, 1.5); gl.position.set(0, 0, 2.5); g.add(gl); }
      const frame = new THREE.Mesh(new THREE.BoxGeometry(sc.w + 0.2, sc.h + 0.2, 0.25), this.mats.black);
      frame.position.z = -0.15;
      if (!sc.curved) g.add(frame);
      g.position.set(sc.cx, sc.cy, sc.cz);
      g.rotation.y = sc.yaw;
      if (errScreen && sc.cy + sc.h / 2 > V.ceiling - 0.8 && V.indoor) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(sc.w + 0.3, sc.h + 0.3, 0.4), this.mats.err);
        g.add(e);
        this.label('⚠ exceeds trim height', new THREE.Vector3(sc.cx, sc.cy + sc.h / 2 + 0.6, sc.cz), 'err');
      }
      // rigging cables
      const top = V.indoor ? V.ceiling : sc.cy + sc.h / 2 + 3;
      const cg = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-sc.w / 2 + 0.3, sc.h / 2, 0), new THREE.Vector3(-sc.w / 2 + 0.3, top - sc.cy, 0),
        new THREE.Vector3(sc.w / 2 - 0.3, sc.h / 2, 0), new THREE.Vector3(sc.w / 2 - 0.3, top - sc.cy, 0)]);
      g.add(new THREE.LineSegments(cg, this.mats.cable));
      this.root.add(g);
      const info = { title: (isLed ? 'LED screen ' : 'Projection screen ') + `${sc.w} × ${sc.h} m`, rows: [['Package', SP.name], ['Package rental', money(SP.cost)], ['Flown weight', fmtKg(SP.flownKg / SP.screens.length)], ['Comfortable view to', (sc.h * 8).toFixed(0) + ' m']] };
      this.hoverable(surf, info);
      if (!sc.side) this.label(`${isLed ? 'LED' : 'Screen'} ${sc.w}×${sc.h} m`, new THREE.Vector3(sc.cx, sc.cy - sc.h / 2 - 0.35, sc.cz + 0.5));
      if (!isLed) {
        const proj = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.9), this.mats.speaker);
        const pz = sc.cz + 14;
        proj.position.set(sc.cx * 1.1, 4.5, pz);
        this.root.add(proj);
        const beamG = new THREE.BufferGeometry().setFromPoints([proj.position.clone(), new THREE.Vector3(sc.cx, sc.cy, sc.cz)]);
        this.root.add(new THREE.Line(beamG, new THREE.LineBasicMaterial({ color: 0xbfdbfe, transparent: true, opacity: 0.25 })));
      }
    }
  }

  // -------------------------------------------------------------------------
  buildAudio(res) {
    const { lay } = res;
    const { A, V, S } = lay;
    const mainInfo = { title: A.name, rows: [['Rental', money(A.cost)], ['Flown weight', fmtKg(A.flownKg)], ['Power', A.amps + ' A'], ['Install', A.crewHours + ' crew-h']] };
    for (const s of lay.sources) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.rotation.order = 'YXZ';
      g.rotation.y = s.yaw;
      if (s.line) {
        const boxes = Math.round((s.len || 4) / 0.42);
        let y = 0, ang = s.pitch;
        const gg = new THREE.Group();
        for (let i = 0; i < boxes; i++) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.36, 0.7), this.mats.speaker);
          const fr = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), this.mats.grill);
          fr.position.z = 0.351;
          b.add(fr);
          b.position.set(0, y, 0);
          b.rotation.x = -ang;
          gg.add(b);
          y -= 0.36 * Math.cos(ang);
          ang -= (i / boxes) * 2.2 * DEG;
          this.hoverable(b, s.kind === 'delay' ? { title: 'Delay tower', rows: [['Purpose', 'Re-inforces rear audience'], ['Rental', money(9500)], ['Time-aligned to mains', '✓']] } : mainInfo);
        }
        g.add(gg);
        const top = V.indoor ? V.ceiling - s.y : 4;
        if (s.kind !== 'delay') g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, top, 0)]), this.mats.cable));
        else {
          const tw = new THREE.Mesh(new THREE.BoxGeometry(0.5, s.y, 0.5), this.mats.truss);
          tw.position.set(s.x, s.y / 2, s.z - 0.6);
          this.root.add(tw);
          this.label('Delay', new THREE.Vector3(s.x, s.y + 1.2, s.z), 'dim');
        }
      } else {
        const sz = s.kind === 'front' ? [0.5, 0.3, 0.35] : [0.6, 1.0, 0.5];
        const b = new THREE.Mesh(new THREE.BoxGeometry(...sz), this.mats.speaker);
        b.rotation.x = -s.pitch;
        g.add(b);
        this.hoverable(b, s.kind === 'front' ? { title: 'Front-fill', rows: [['Covers', 'First rows below the mains']] } : mainInfo);
        if (s.kind !== 'front') {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, s.y), this.mats.truss);
          pole.position.y = -s.y / 2;
          g.add(pole);
        }
      }
      this.root.add(g);
    }
    // subs
    const nSubs = A.sources.length > 2 ? 8 : A.sources[0].line ? 6 : 2;
    for (let i = 0; i < nSubs; i++) {
      const x = nSubs === 2 ? (i ? 1 : -1) * (S.w / 2 + 1.6) : (-0.5 + (i + 0.5) / nSubs) * (S.w + 2);
      const sub = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.9), this.mats.speaker);
      sub.position.set(x, 0.3, lay.zFront + (nSubs === 2 ? -0.6 : 0.6));
      this.root.add(sub);
      this.hoverable(sub, { title: 'Subwoofer', rows: [['Array', nSubs + ' × sub'], ['System', A.name]] });
    }
    const main = lay.sources.find((s) => s.kind === 'main');
    if (main) this.label(A.name, new THREE.Vector3(Math.abs(main.x), main.y + 1.2, main.z));
  }

  // -------------------------------------------------------------------------
  buildLighting(res) {
    const { lay } = res;
    const { L, S, V } = lay;
    const y = lay.trussY;
    const info = { title: L.name, rows: [['Rental', money(L.cost)], ['Moving heads', L.movers], ['Flown weight', fmtKg(L.flownKg)], ['Power', L.amps + ' A'], ['Programming', L.programHours + ' h']] };
    const zs = [];
    for (let i = 0; i < L.truss; i++) zs.push(lay.z0 + 1 + (L.truss === 1 ? S.d + 4 : (i / (L.truss - 1)) * (S.d + 2)));
    if (L.truss === 1) {
      // front truss / stands for basic wash
      for (const sx of [-1, 1]) {
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), this.mats.truss);
        stand.position.set(sx * (lay.width / 2 + 0.5), 2, lay.zFront + 5);
        this.root.add(stand);
        this.hoverable(stand, info);
      }
    }
    for (const z of zs) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(S.w + 4, 0.4, 0.4), this.mats.truss);
      t.position.set(0, y, z);
      if (L.truss === 1) { t.position.y = 4.1; t.position.z = lay.zFront + 5; t.scale.x = (lay.width + 1) / (S.w + 4); }
      this.root.add(t);
      this.hoverable(t, info);
      if (V.indoor && L.truss > 1) this.root.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-S.w / 2, y, z), new THREE.Vector3(-S.w / 2, V.ceiling, z), new THREE.Vector3(S.w / 2, y, z), new THREE.Vector3(S.w / 2, V.ceiling, z)]), this.mats.cable));
    }
    if (L.truss > 1) this.label(`${L.name} · trim ${y.toFixed(1)} m`, new THREE.Vector3(-(S.w / 2 + 2), y + 0.6, zs[0]), 'dim');

    // real lights: stage wash
    const colors = L.movers >= 40 ? [0x7c5cff, 0x4cc9f0, 0xf72585] : [0xffe7c4, 0xc7d2fe];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const sl = new THREE.SpotLight(colors[i % colors.length], L.movers ? 260 : 300, 40, 40 * DEG, 0.6, 1.4);
      sl.position.set((i - 1) * S.w * 0.35, L.truss === 1 ? 4.2 : y, L.truss === 1 ? lay.zFront + 5 : lay.zFront + 2);
      sl.target.position.set((i - 1) * S.w * 0.3, S.h, lay.z0 + S.d * 0.5);
      this.root.add(sl, sl.target);
    }

    // movers + beams
    const visible = Math.min(L.movers, 28);
    const beamGeo = new THREE.ConeGeometry(1, 1, 20, 1, true);
    beamGeo.translate(0, -0.5, 0);
    for (let i = 0; i < visible; i++) {
      const tz = zs[i % zs.length];
      const k = Math.floor(i / zs.length), per = Math.ceil(visible / zs.length);
      const x = (-0.5 + (k + 0.5) / per) * (S.w + 2);
      const head = new THREE.Group();
      head.position.set(x, y - 0.45, tz);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.45, 10), this.mats.speaker);
      head.add(body);
      this.hoverable(body, { title: 'Moving head', rows: [['Package', L.name], ['Count', L.movers]] });
      const col = new THREE.Color(colors[i % colors.length]);
      const bm = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: col }, uInt: { value: L.movers >= 40 ? 0.55 : 0.4 } },
        vertexShader: beamVert, fragmentShader: beamFrag,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      bm.userData.own = true;
      const beam = new THREE.Mesh(beamGeo, bm);
      const len = y + 6;
      beam.scale.set(len * 0.07, len, len * 0.07);
      const pivot = new THREE.Group();
      pivot.add(beam);
      head.add(pivot);
      this.root.add(head);
      this.beams.push({ pivot, phase: i * 0.7, side: Math.sign(x) || 1 });
    }
  }

  // -------------------------------------------------------------------------
  buildAudience(res) {
    const { lay } = res;
    const n = lay.seats.length;
    if (!n) return;
    const seated = lay.seated;
    const parts = [];
    if (seated) {
      parts.push(new THREE.BoxGeometry(0.46, 0.08, 0.46).translate(0, 0.45, 0));          // seat
      parts.push(new THREE.BoxGeometry(0.46, 0.5, 0.06).translate(0, 0.72, 0.22));         // back
      parts.push(new THREE.CapsuleGeometry(0.17, 0.42, 2, 6).translate(0, 0.86, 0.05));    // torso
      parts.push(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.3, 0.03));            // head
    } else {
      parts.push(new THREE.CapsuleGeometry(0.19, 1.0, 2, 6).translate(0, 0.7, 0));
      parts.push(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 1.55, 0));
    }
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    mat.userData.own = true;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    lay.seats.forEach((s, i) => {
      m.makeTranslation(s.x, 0, s.z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(0x3a3f4b));
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    this.audienceMesh = mesh;
    mesh.userData.info = 'seat';
    this.hoverables.push(mesh);
  }

  // -------------------------------------------------------------------------
  buildOverlay(res) {
    const { lay } = res;
    const { V } = lay;
    // floor heatmap texture covering audience zone
    const x0 = -V.w / 2, x1 = V.w / 2, z0 = lay.zFront, z1 = V.d / 2;
    const W = 200, H = Math.max(40, Math.round((200 * (z1 - z0)) / (x1 - x0)));
    const mk = (fn) => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(W, H);
      const c = new THREE.Color();
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x = x0 + ((i + 0.5) / W) * (x1 - x0), z = z0 + ((j + 0.5) / H) * (z1 - z0);
        fn(x, z, c);
        const k = (j * W + i) * 4;
        img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 200;
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false });
      m.userData.own = true;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), m);
      p.rotation.x = -Math.PI / 2;
      p.position.set(0, 0.04, (z0 + z1) / 2);
      p.renderOrder = 2;
      this.root.add(p);
      return p;
    };
    const absorb = V.indoor ? 0.012 : 0.05;
    this.audioPlane = mk((x, z, c) => splColor(splAt(lay.sources, x, lay.ear, z, absorb), c));
    this.screenPlane = mk((x, z, c) => scrColor(lay.screens.length ? screenScoreAt(lay, x, z) : 99, c));

    // coverage cones
    this.cones = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
    coneGeo.translate(0, -0.5, 0);
    coneGeo.rotateX(-Math.PI / 2);
    for (const s of lay.sources) {
      // throw distance: where on-axis level drops to lower target
      let L = 5;
      const dir = new THREE.Vector3(Math.sin(s.yaw) * Math.cos(s.pitch), Math.sin(s.pitch), Math.cos(s.yaw) * Math.cos(s.pitch));
      for (; L < 160; L += 2) {
        const p = dir.clone().multiplyScalar(L).add(new THREE.Vector3(s.x, s.y, s.z));
        if (splAt([s], p.x, p.y, p.z, absorb) < SPL_TARGET[0] || p.y < 0) break;
      }
      const col = s.kind === 'delay' ? 0x22d3ee : s.kind === 'front' ? 0xa3e635 : s.kind === 'outfill' ? 0xf0abfc : 0xf72585;
      const m = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      m.userData.own = true;
      const cone = new THREE.Mesh(coneGeo, m);
      cone.scale.set(Math.tan((s.hCov / 2) * DEG) * L, Math.tan((s.vCov / 2) * DEG) * L, L);
      cone.position.set(s.x, s.y, s.z);
      cone.rotation.order = 'YXZ';
      cone.rotation.y = s.yaw; cone.rotation.x = -s.pitch;
      this.cones.add(cone);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.ConeGeometry(1, 1, 8, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2), 1), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.22 }));
      edges.scale.copy(cone.scale); edges.position.copy(cone.position); edges.rotation.copy(cone.rotation);
      this.cones.add(edges);
    }
    this.root.add(this.cones);

    // sightline fans
    this.fans = new THREE.Group();
    for (const sc of lay.screens) {
      const r = sc.h * 8;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.absarc(0, 0, r, -65 * DEG, 65 * DEG, false);
      shape.lineTo(0, 0);
      const pts = shape.getPoints(48).map((p) => new THREE.Vector3(p.y, 0, p.x));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: sc.side ? 0x4cc9f0 : 0xffffff, transparent: true, opacity: 0.7 }));
      line.position.set(sc.cx, 0.08, sc.cz);
      line.rotation.y = sc.yaw;
      this.fans.add(line);
      // frustum lines from screen corners to the farthest comfortable point
      const far = new THREE.Vector3(sc.cx + Math.sin(sc.yaw) * r, lay.ear, sc.cz + Math.cos(sc.yaw) * r);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(sc.cx + a * (sc.w / 2) * Math.cos(sc.yaw), sc.cy + b * sc.h / 2, sc.cz - a * (sc.w / 2) * Math.sin(sc.yaw)));
      const fl = [];
      for (const c of corners) fl.push(c, far);
      this.fans.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fl), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 })));
      if (!sc.side) this.fanLabel = this.label(`8× image height = ${r.toFixed(0)} m`, new THREE.Vector3(sc.cx, 0.5, sc.cz + r), 'dim');
    }
    this.root.add(this.fans);
  }

  setOverlay(mode) {
    this.overlay = mode;
    this.applyOverlay();
  }

  applyOverlay() {
    if (!this.res) return;
    const mode = this.overlay;
    this.audioPlane.visible = mode === 'audio';
    this.screenPlane.visible = mode === 'screen';
    this.cones.visible = mode === 'audio';
    this.fans.visible = mode === 'screen';
    if (this.fanLabel) this.fanLabel.visible = mode === 'screen';
    const mesh = this.audienceMesh;
    if (mesh) {
      const c = new THREE.Color();
      const vals = mode === 'audio' ? this.res.audio.values : mode === 'screen' ? this.res.screen.values : null;
      const palette = [0x6a7080, 0x8a6f63, 0x55607a, 0x7a5a6a, 0x5f7a6a, 0x9a8a70];
      for (let i = 0; i < mesh.count; i++) {
        if (!vals) c.set(this.res.lay.seated ? 0x6b7180 : palette[(i * 7919) % palette.length]);
        else if (mode === 'audio') splColor(vals[i], c);
        else scrColor(vals[i], c);
        mesh.setColorAt(i, c);
      }
      mesh.instanceColor.needsUpdate = true;
    }
    this.beams.forEach((b) => (b.pivot.visible = mode === 'none'));
    this.bloom.strength = mode === 'none' ? 0.55 : 0.25;
  }

  // -------------------------------------------------------------------------
  setView(name, instant = false) {
    if (!this.res) return;
    const { lay } = this.res;
    const { V, S } = lay;
    const mid = (lay.z0 + lay.zBack) / 2;
    const span = Math.max(V.w, lay.zBack - lay.z0 + 10);
    const views = {
      overview: [new THREE.Vector3(span * 0.42, span * 0.36, lay.zBack + span * 0.08), new THREE.Vector3(0, 2, mid - 4)],
      audience: [new THREE.Vector3(0.9, lay.ear + 0.5, lay.zBack + 1.2), new THREE.Vector3(0, S.h + 3.5, lay.z0)],
      foh: [new THREE.Vector3(0, 2.2, lay.fohZ + 1.5), new THREE.Vector3(0, S.h + 3, lay.z0)],
      stage: [new THREE.Vector3(S.w * 0.1, S.h + 3.2, lay.z0 + 1.5), new THREE.Vector3(0, 1.2, lay.zFront + 25)],
      side: [new THREE.Vector3(V.w / 2 + span * 0.55, Math.max(6, V.ceiling * 0.6), mid), new THREE.Vector3(0, Math.min(V.ceiling, 12) * 0.4, mid)],
    };
    const [p, t] = views[name];
    if (instant) { this.camera.position.copy(p); this.controls.target.copy(t); this.controls.update(); return; }
    this.tween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: p, t1: t, k: 0 };
  }

  // -------------------------------------------------------------------------
  pick() {
    this.needPick = false;
    if (!this.mousePx) return;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.hoverables, false);
    if (!hits.length) return this.onHover(null);
    const h = hits[0];
    let info = h.object.userData.info;
    if (info === 'seat') {
      const i = h.instanceId;
      const s = this.res.lay.seats[i];
      const db = this.res.audio.values[i];
      const sr = this.res.screen.values[i];
      info = {
        title: this.res.lay.seated ? 'Guest seat' : 'Standing guest',
        rows: [['Distance to stage', (s.z - this.res.lay.zFront).toFixed(1) + ' m'], ['Sound level', db.toFixed(1) + ' dB(A) ' + (db < SPL_TARGET[0] ? '⚠ quiet' : db > SPL_TARGET[1] ? '⚠ loud' : '✓')], ['Screen view', sr > 50 ? 'no screen visible' : sr.toFixed(1) + '× image height ' + (sr <= 8 ? '✓' : '⚠')]],
      };
    }
    this.onHover(info, this.mousePx);
  }

  frame() {
    const dt = this.clock.getDelta();
    this.time += dt;
    for (const m of this.ledMats) m.uniforms.uTime.value = this.time;
    for (const b of this.beams) {
      b.pivot.rotation.z = Math.sin(this.time * 0.6 + b.phase) * 0.45 * b.side;
      b.pivot.rotation.x = Math.sin(this.time * 0.43 + b.phase * 1.3) * 0.35 - 0.15;
    }
    if (this.tween) {
      const tw = this.tween;
      tw.k = Math.min(1, tw.k + dt * 1.1);
      const e = tw.k < 0.5 ? 4 * tw.k ** 3 : 1 - (-2 * tw.k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tw.p0, tw.p1, e);
      this.controls.target.lerpVectors(tw.t0, tw.t1, e);
      if (tw.k >= 1) this.tween = null;
    }
    this.controls.update();
    if (this.needPick) this.pick();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }
}

function cfgMat(m, own) { if (own) m.userData.own = true; return m; }
