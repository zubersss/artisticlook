// Stage-1 placeholder content (flat ground + gradient sky with a sun disk) used
// to prove the HDR pipeline before the real terrain and sky exist.
import * as THREE from 'three';
import { makeMaterial } from '../shaders/common.js';

export function buildPlaceholder(engine) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20000, 64).rotateX(-Math.PI / 2),
    makeMaterial({
      name: 'placeholder.ground',
      vertex: /* glsl */ `
        out vec3 vRel;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vRel = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragment: /* glsl */ `
        in vec3 vRel;
        void main() {
          vec3 wp = vRel + uCamWrapped;
          float chk = mod(floor(wp.x * 0.25) + floor(wp.z * 0.25), 2.0);
          vec3 alb = mix(vec3(0.16, 0.22, 0.06), vec3(0.22, 0.26, 0.08), chk);
          float ndl = max(uSunDir.y, 0.0);
          vec3 c = alb * (uSunColor * ndl + uSkyZenith * 0.6);
          float d = length(vRel);
          c = mix(c, uSkyHorizon * 1.2, 1.0 - exp(-d * 0.0004));
          fragColor = sceneOut(c, d);
        }`,
    }),
  );
  ground.frustumCulled = false;
  engine.scene.add(ground);
  engine.frame.anchor(ground, 0, 0, 0);

  const sky = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, 3, -1, 1, -1, 3, 1]), 3)),
    makeMaterial({
      name: 'placeholder.sky',
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      vertex: /* glsl */ `
        uniform mat4 uInvViewProj;
        out vec3 vDir;
        void main() {
          vec4 p = uInvViewProj * vec4(position.xy, 1.0, 1.0);
          vDir = p.xyz / p.w;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragment: /* glsl */ `
        in vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = mix(uSkyHorizon * 1.2, uSkyZenith, pow(max(d.y, 0.0), 0.5));
          float mu = dot(d, uSunDir);
          c += uGlowHue * 0.6 * pow(max(mu, 0.0), 12.0);
          c += vec3(400.0, 360.0, 300.0) * smoothstep(0.99996, 0.99999, mu);
          fragColor = sceneOut(c, 65000.0);
        }`,
      uniforms: { uInvViewProj: { value: new THREE.Matrix4() } },
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  engine.scene.add(sky);
  engine.onBeforeRender.push((cam) => {
    sky.material.uniforms.uInvViewProj.value.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
  });
  return { heightAt: () => 0 };
}
