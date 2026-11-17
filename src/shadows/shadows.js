// Sun shadows: two cascades (near ~120 m, far ~900 m) rendered into sun-aligned
// 2048x1024 depth textures with hardware comparison (sampler2DShadow). Each cascade is
// re-rendered only when the camera or the Sun moved enough, and never both in one frame.
// Casters: a terrain grid per cascade (vertex-fetched heights), boulders, and trees as
// alpha-tested far-version leaf cards facing the Sun (their gaps make dappled light).
// Receivers call sunShadow() (GLSL_SHADOW) with camera-relative positions.
import * as THREE from 'three';
import { makeMaterial, G } from '../shaders/common.js';
import { GLSL_TERRAIN_HEIGHT } from '../terrain/terrain.js';

function gridGeometry(n) {
  const g = new THREE.PlaneGeometry(1, 1, n, n).rotateX(-Math.PI / 2);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}

export class Shadows {
  constructor(engine, hf, opts) {
    this.engine = engine;
    this.hf = hf;
    this.opts = opts;
    const r = engine.renderer;
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = true;
    this.cascades = [opts.near, opts.far].map((c, i) => this.makeCascade(c, i));
    this.terrainMats = [];
    // One terrain caster grid per cascade.
    for (const c of this.cascades) {
      const mat = makeMaterial({
        name: 'shadow.terrain', chunks: [GLSL_TERRAIN_HEIGHT],
        uniforms: Object.assign({}, engine.terrain.uniforms, { uGridC: { value: new THREE.Vector4() } }),
        vertex: /* glsl */ `
          uniform vec4 uGridC; // world centre x, z, size, unused
          void main() {
            vec2 xz = uGridC.xy + position.xz * uGridC.z;
            float h = terrainHeight(xz);
            vec4 wp = modelMatrix * vec4(xz.x, h, xz.y, 1.0);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragment: /* glsl */ `void main() { fragColor = vec4(1.0); }`,
      });
      const mesh = new THREE.Mesh(gridGeometry(c.cfg.grid ?? 128), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      engine.frame.anchor(mesh, 0, 0, 0);
      c.terrain = mesh;
    }
    this.casters = []; // { mesh, cascade: 0|1|'both' }
    G.uShadow0.value = this.cascades[0].rt.depthTexture;
    G.uShadow1.value = this.cascades[1].rt.depthTexture;
    G.uShadowP.value.set(0.12, 0.9, 1, opts.softness ?? 1.2);
    this.frameCount = 0;
    this.farInterval = opts.farInterval ?? 0.25;
    this.timeSinceFar = 1e9;
    this._v = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4();
    this.sunKey = new THREE.Vector3();
    this.forceAll = true;
  }

  makeCascade(cfg, index) {
    const [w, h] = cfg.size;
    const depth = new THREE.DepthTexture(w, h, THREE.UnsignedShortType);
    depth.compareFunction = THREE.LessEqualCompare;
    depth.minFilter = THREE.LinearFilter; depth.magFilter = THREE.LinearFilter;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: true, depthTexture: depth,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
    });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 4000);
    return { cfg, index, rt, cam, w, h, camAt: new Float64Array(3), valid: false, pv: new THREE.Matrix4(), texel: 0.1, center: new Float64Array(3) };
  }

  /** Register a caster mesh (already in this.scene) for a cascade: 0, 1 or 'both'. */
  addCaster(mesh, which = 'both') {
    mesh.frustumCulled = false;
    mesh.userData.shadowCascade = which;
    if (mesh.parent !== this.scene) this.scene.add(mesh);
    this.casters.push(mesh);
  }

  /** Which cascade (if any) should be re-rendered this frame. */
  choose(dt) {
    const f = this.engine.frame.cam;
    const sun = G.uSunDir.value;
    const sunMoved = this.sunKey.distanceToSquared(sun) > (this.opts.sunMove ?? 1e-6);
    if (sunMoved) { this.sunKey.copy(sun); this.cascades.forEach((c) => (c.valid = false)); }
    this.timeSinceFar += dt;
    const need = (c, thr) => {
      if (!c.valid) return true;
      const dx = f[0] - c.camAt[0], dy = f[1] - c.camAt[1], dz = f[2] - c.camAt[2];
      return dx * dx + dy * dy + dz * dz > thr * thr;
    };
    const n0 = need(this.cascades[0], this.opts.near.move);
    const n1 = need(this.cascades[1], this.opts.far.move) && (this.timeSinceFar >= this.farInterval || !this.cascades[1].valid);
    if (n0 && n1) return this.frameCount++ & 1 ? 1 : 0; // never both in one frame
    if (n0) return 0;
    if (n1) return 1;
    return -1;
  }

  /** Render one cascade if needed (called before the scene pass). */
  prerender(engine) {
    const which = this.choose(engine.lastDt ?? 1 / 60);
    if (which >= 0) this.renderCascade(this.cascades[which]);
    this.updateMatrices();
  }

  renderCascade(c) {
    const e = this.engine, r = e.renderer;
    const f = e.frame.cam;
    const sun = G.uSunDir.value;
    // Light basis: z toward the Sun, x horizontal, y completes it.
    const zA = this._v.copy(sun).normalize();
    const xA = new THREE.Vector3(-zA.z, 0, zA.x).normalize();
    const yA = new THREE.Vector3().crossVectors(zA, xA).normalize();
    const R = c.cfg.radius;
    const sinE = Math.max(0.05, sun.y);
    const cosE = Math.sqrt(1 - sinE * sinE);
    const halfW = R, halfH = R * sinE + (c.cfg.heightRange ?? 40) * cosE * 0.5 + R * 0.08;
    const texX = (2 * halfW) / c.w, texY = (2 * halfH) / c.h;
    // Snap the centre to whole texels in light space (no shimmering as the camera moves).
    const cxl = f[0] * xA.x + f[1] * xA.y + f[2] * xA.z;
    const cyl = f[0] * yA.x + f[1] * yA.y + f[2] * yA.z;
    const sx = Math.round(cxl / texX) * texX - cxl, sy = Math.round(cyl / texY) * texY - cyl;
    // Camera-relative light camera position (the scene is camera-relative).
    const back = c.cfg.depth ?? 1500;
    const cam = c.cam;
    cam.position.set(xA.x * sx + yA.x * sy + zA.x * back, xA.y * sx + yA.y * sy + zA.y * back, xA.z * sx + yA.z * sy + zA.z * back);
    cam.up.copy(yA);
    cam.lookAt(cam.position.x - zA.x, cam.position.y - zA.y, cam.position.z - zA.z);
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.near = 1; cam.far = back * 2;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    c.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    c.camAt[0] = f[0]; c.camAt[1] = f[1]; c.camAt[2] = f[2];
    c.texel = Math.max(texX, texY);
    c.valid = true;
    if (c.index === 1) this.timeSinceFar = 0;
    // Terrain caster grid centred on the camera.
    const t = c.terrain;
    t.material.uniforms.uGridC.value.set(Math.round(f[0] / 16) * 16, Math.round(f[2] / 16) * 16, R * 2.6, 0);
    t.visible = true;
    for (const m of this.casters) m.visible = m.userData.shadowCascade === 'both' || m.userData.shadowCascade === c.index;
    for (const other of this.cascades) if (other !== c) other.terrain.visible = false;
    this.engine.trees?.fillShadow(c.index, R);
    r.setRenderTarget(c.rt);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    r.setClearColor(0x000000, 1);
    this.engine.frame.update();
    r.render(this.scene, cam);
    t.visible = false;
    this.renders = (this.renders || 0) + 1;
  }

  /** Receiver matrices: cascade clip space from the *current* camera-relative position. */
  updateMatrices() {
    const f = this.engine.frame.cam;
    const P = G.uShadowP.value;
    for (const c of this.cascades) {
      const M = c.index === 0 ? G.uShadowM0.value : G.uShadowM1.value;
      // rel_now -> rel_then: add (camNow - camThen)
      this._t.makeTranslation(f[0] - c.camAt[0], f[1] - c.camAt[1], f[2] - c.camAt[2]);
      M.multiplyMatrices(c.pv, this._t);
    }
    P.x = this.cascades[0].texel; P.y = this.cascades[1].texel;
    G.uShadowT.value.set(1 / this.cascades[0].w, 1 / this.cascades[0].h, 1 / this.cascades[1].w, 1 / this.cascades[1].h);
  }

  applyQuality(state) {
    this.farInterval = state.farShadowInterval ?? 0.25;
  }

  onTeleport() { this.cascades.forEach((c) => (c.valid = false)); }
}
