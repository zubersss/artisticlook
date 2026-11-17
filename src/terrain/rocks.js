// Mossy boulders: two procedural shapes (noise-deformed icospheres), instanced.
// Placement follows the world's recipe (count, size range, preferences) and the
// heightfield masks; brushwork is world-anchored with strokes along horizontal
// contours on the sides and along the long axis on top (biplanar, 2 octaves).
import * as THREE from 'three';
import { makeMaterial } from '../shaders/common.js';
import { GLSL_LIGHTING } from '../shaders/lighting.js';
import { GLSL_BRUSH } from '../brushwork/brush.js';
import { Rng } from '../core/textures.js';
import { gnoise } from './noise.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lin } from '../core/color.js';

function boulderGeometry(seed) {
  // Smooth-shaded body; facets come back in the shader (blend of smooth and face normals).
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = gnoise(v.x * 1.3 + seed, v.z * 1.3 - seed, seed) * 0.22 + gnoise(v.x * 3.1, v.y * 3.1 + v.z, seed + 1) * 0.08;
    // Facets: flatten some planes like weathered granite.
    const facet = Math.max(0, Math.abs(gnoise(v.y * 0.9 + seed, v.x * 0.9, seed + 2)) - 0.2) * 0.35;
    v.multiplyScalar(1 + n - facet);
    v.y = v.y < 0 ? v.y * 0.35 : v.y * 0.72; // sit on the ground, squat
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Rocks {
  constructor(engine, hf) {
    const W = engine.world;
    const R = W.rocks || { count: 0 };
    this.engine = engine;
    const Gd = W.ground;
    const rng = new Rng(R.seed ?? 4242);
    const half = W.terrain.patchSize / 2;
    const items = [];
    // Explicit placements first (composition), then scattered ones.
    for (const p of R.place || []) items.push({ x: p[0], z: p[1], s: p[2], yaw: p[3] ?? rng.next() * 6.28 });
    let tries = 0;
    while (items.length < R.count && tries++ < R.count * 40) {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      const path = hf.maskAt(x, z, 0), water = hf.maskAt(x, z, 1), forest = hf.maskAt(x, z, 2), meadow = hf.maskAt(x, z, 3);
      if (path > 0.05 || water > 0.6) continue;
      // Preference: forest floor and clearing edges, a few in meadows.
      const pref = 0.35 * forest + 0.6 * Math.max(0, meadow * (1 - meadow) * 4) + 0.15;
      if (rng.next() > pref) continue;
      const s = R.size[0] * Math.pow(R.size[1] / R.size[0], Math.pow(rng.next(), 2.2));
      items.push({ x, z, s, yaw: rng.next() * 6.28 });
    }
    this.count = items.length;
    const geos = [boulderGeometry(1.7), boulderGeometry(5.3)];
    this.meshes = [];
    const mat = this.makeMaterial(Gd);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    for (let gi = 0; gi < 2; gi++) {
      const list = items.filter((_, i) => i % 2 === gi);
      const mesh = new THREE.InstancedMesh(geos[gi], mat, Math.max(1, list.length));
      mesh.count = list.length;
      list.forEach((it, i) => {
        const y = hf.heightAt(it.x, it.z) - it.s * 0.18;
        e.set((rng.next() - 0.5) * 0.25, it.yaw, (rng.next() - 0.5) * 0.25);
        q.setFromEuler(e);
        sc.set(it.s * rng.range(0.9, 1.4), it.s * rng.range(0.7, 1.05), it.s * rng.range(0.85, 1.25));
        pos.set(it.x, y, it.z);
        m4.compose(pos, q, sc);
        mesh.setMatrixAt(i, m4);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = false; // anchored mesh; bounds are in anchor space
      mesh.renderOrder = 1;
      engine.scene.add(mesh);
      engine.frame.anchor(mesh, 0, 0, 0);
      this.meshes.push(mesh);
    }
    this.items = items;
  }

  makeMaterial(Gd) {
    return makeMaterial({
      name: 'rocks',
      chunks: [GLSL_LIGHTING],
      fragChunks: [GLSL_BRUSH],
      uniforms: {
        uRockCol: { value: lin(Gd.rock) }, uRockDark: { value: lin(Gd.rockDark || '#5d5850') },
        uMossCol: { value: lin(Gd.moss) }, uLichen: { value: lin(Gd.lichen || '#a59a6a') }, uGrassBase: { value: lin(Gd.shadeGrass) },
      },
      vertex: /* glsl */ `
        out vec3 vRel;
        out vec3 vN;
        out vec3 vObj;
        flat out float vSeed;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vRel = wp.xyz;
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vObj = position;
          vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.731);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragment: /* glsl */ `
        uniform vec3 uRockCol, uRockDark, uMossCol, uLichen, uGrassBase;
        in vec3 vRel;
        in vec3 vN;
        in vec3 vObj;
        flat in float vSeed;
        void main() {
          float d = length(vRel);
          vec3 N = normalize(vN);
          vec3 wp = vRel + uCamWrapped;
          // Biplanar brushwork: sides use (horizontal tangent, height) so strokes run along
          // contours; the top uses the ground plane. Both world-anchored, 2 octaves each.
          // Facet normal from screen derivatives: one stroke direction per plane, softened
          // with the smooth normal so the silhouette is not low-poly.
          vec3 Nf = normalize(cross(dFdx(vRel), dFdy(vRel)));
          N = normalize(mix(N, Nf, 0.45));
          vec2 th = normalize(vec2(-Nf.z, Nf.x) + vec2(1e-4, 0.0));
          vec2 sideRel = vec2(dot(vRel.xz, th), vRel.y);
          float top = smoothstep(0.45, 0.8, Nf.y);
          float jitter = radians(30.0);
          float ci = abs(dot(vRel / d, N));
          // Knife strokes: larger than on the ground, one direction per facet.
          BrushOut bs = brushSample(sideRel * 0.75, d, 0.0, radians(8.0), ci);
          BrushOut bt = brushSample(vRel.xz * 0.75, d, vSeed * 6.2831, radians(8.0), ci);
          float h = mix(bs.h, bt.h, top);
          float id = mix(bs.id, bt.id, top);
          vec2 nTop = bt.nWorld;
          vec3 nSide = vec3(th.x, 0.0, th.y) * bs.nWorld.x + vec3(0.0, 1.0, 0.0) * bs.nWorld.y;
          vec3 Ns = normalize(N + 0.35 * uPainter.w * mix(nSide, vec3(nTop.x, 0.0, nTop.y), top));
          vec4 n = vnoise4(wp.xz * 0.5 + wp.y * 0.37);
          vec3 alb = mix(uRockDark, uRockCol, 0.45 + 0.3 * smoothstep(0.25, 0.75, n.x));
          alb = mix(alb, uLichen, smoothstep(0.75, 0.92, n.y) * 0.35);
          float moss = smoothstep(0.5, 0.8, N.y + (n.z - 0.5) * 0.5) + smoothstep(0.35, 0.0, vObj.y) * 0.35 * n.w;
          alb = mix(alb, uMossCol, clamp(moss, 0.0, 1.0));
          if (uViewMode > 1.5) {
            alb = brokenColor(alb, id, 14.0, 0.25, 0.16);
            alb = mix(alb * vec3(0.72, 0.74, 0.84), alb, smoothstep(0.08, 0.4, h));
            // Gold flecks on lit tops, moss laid as thick yellow-olive strokes along the top.
            alb = mix(alb, uMossCol * 1.25, smoothstep(0.9, 0.92, id) * top);
          }
          float ao = mix(0.75, 1.0, smoothstep(-0.2, 0.5, vObj.y));
          vec3 col = painterLight(alb, uViewMode > 1.5 ? Ns : N, 1.0, ao);
          // Warm reflected light from the sunlit ground and sky fill: darks stay >= v 0.19.
          col += alb * (uGroundBounce * 2.5 * saturate(0.5 - N.y) + uSkyZenith * 0.35) * painterK();
          if (uViewMode > 0.5) col = chromaScale(col, 0.85 + 0.25 * saturate(1.0 - dot(N, uSunDir) * 2.0));
          // Grass grows over the base.
          col = mix(col, painterLight(uGrassBase, vec3(0.0, 1.0, 0.0), 1.0, 0.8), smoothstep(-0.12, -0.3, vObj.y) * 0.85 * painterK());
          // Backlit rim: a warm edge where the silhouette faces the Sun.
          vec3 V = -vRel / d;
          float rim = pow(1.0 - saturate(abs(dot(N, V))), 3.0) * pow(saturate(dot(-V, uSunDir)), 2.0);
          col += uSunColor * uGlowHue * rim * 0.5 * painterK();
          col = applyAerial(col, vRel, d);
          if (uOverdraw > 0.5) { fragColor = vec4(1.0 / 255.0); return; }
          fragColor = sceneOut(col, d);
        }`,
    });
  }
}
