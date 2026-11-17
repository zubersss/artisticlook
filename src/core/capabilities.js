// Startup GPU capability checks: pick the cheapest renderable HDR format,
// MSAA sample counts, and collect strings for the HUD / benchmark report.
import * as THREE from 'three';

function testRenderable(gl, internalFormat) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, 4, 4);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  // Swallow any error the probe produced.
  while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
  return ok;
}

function maxSamplesFor(gl, internalFormat) {
  try {
    const s = gl.getInternalformatParameter(gl.RENDERBUFFER, internalFormat, gl.SAMPLES);
    return s && s.length ? Math.max(...s) : 0;
  } catch {
    return 0;
  }
}

export function detectCapabilities(renderer, wantedSamples) {
  const gl = renderer.getContext();
  const caps = {};
  caps.webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const cbf = gl.getExtension('EXT_color_buffer_float');
  const cbhf = gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');

  // Scene target choice. The post passes need view distance (distance warp, shaft
  // sky mask). Preferred: RGBA16F with distance in alpha -> no depth resolve at all,
  // MSAA may resolve on-tile. Same bytes per pixel as R11G11B10F + a resolved depth
  // texture, which is the fallback; RGBA8 with a compression curve is the last resort.
  let hdr;
  const f16 = (cbf || cbhf) && testRenderable(gl, gl.RGBA16F);
  if (f16) {
    hdr = { name: 'RGBA16F (dist in A)', format: THREE.RGBAFormat, type: THREE.HalfFloatType, gl: gl.RGBA16F, bytes: 8, encode: false, distInAlpha: true };
  } else if (cbf && testRenderable(gl, gl.R11F_G11F_B10F)) {
    hdr = { name: 'R11F_G11F_B10F + depth', format: THREE.RGBFormat, type: THREE.UnsignedInt101111Type, gl: gl.R11F_G11F_B10F, bytes: 4, encode: false, distInAlpha: false };
  } else {
    hdr = { name: 'RGBA8 encoded (dist in A)', format: THREE.RGBAFormat, type: THREE.UnsignedByteType, gl: gl.RGBA8, bytes: 4, encode: true, distInAlpha: true };
  }
  caps.hdr = hdr;

  // Bloom/shaft chain needs an alpha channel (shaft source) -> RGBA16F or encoded RGBA8.
  caps.bloom = f16
    ? { name: 'RGBA16F', type: THREE.HalfFloatType, encode: false }
    : { name: 'RGBA8+encode', type: THREE.UnsignedByteType, encode: true };
  caps.halfFloatTarget = !caps.bloom.encode;

  const fmtSamples = maxSamplesFor(gl, hdr.gl);
  caps.samples = Math.max(0, Math.min(wantedSamples, fmtSamples, gl.getParameter(gl.MAX_SAMPLES)));
  if (caps.samples === 1) caps.samples = 0;

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  caps.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  caps.vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  caps.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  caps.anisotropy = renderer.capabilities.getMaxAnisotropy();
  caps.msrtt = !!gl.getExtension('WEBGL_multisampled_render_to_texture');
  caps.parallelCompile = !!gl.getExtension('KHR_parallel_shader_compile');
  caps.three = THREE.REVISION;
  renderer.resetState();
  return caps;
}
