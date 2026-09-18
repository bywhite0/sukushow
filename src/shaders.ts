import * as THREE from 'three';

/** Sprites/Default, GLES platform 9, resources path 10753.
 *  c = tex * vertexColor; out = (c.a * c.rgb, c.a)
 *  Pass blend is One / OneMinusSrcAlpha (src 1, dst 10). PixelSnap is off on Sprites-Default.
 */
const spriteVert = `
attribute vec4 tint;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = tint;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const spriteFrag = `
uniform sampler2D map;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv) * vColor;
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;

/** RhythmGame/Plane Fade, path 903. Does not sample _MainTex.
 *  a = _Color.a - max(_Min - uv.y, 0) * _Power; out = (a * rgb, a)
 */
const planeVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const planeFrag = `
uniform vec4 color;
uniform float minV;
uniform float power;
varying vec2 vUv;
void main() {
  float a = color.a - max(minV - vUv.y, 0.0) * power;
  gl_FragColor = vec4(color.rgb * a, a);
}`;

/** Mobile/Particles/Additive path 894: out = tex * vertexColor, color clamped in the vertex stage.
 *  SC2 9Slice path 940 keeps that blend (SrcAlpha, One) and remaps U:
 *    s = sizeX / _TexW; k = min(1/s, 1); left = k*_BorderW; right = 1 - _BorderW*k
 *    left cap u = uv.x * s; right cap u = 1 - (1-uv.x)*s; middle u = 0.5
 *  Num Combo Effect path 91 samples a 11-glyph strip. Note prefabs do not reference it;
 *  the port is here so a mat that does is not flattened to a plain sample.
 */
const fxVert = `
attribute vec4 tint;
attribute float sliceW;
varying vec4 vColor;
varying vec2 vUv;
varying float vSlice;
void main() {
  vColor = clamp(tint, 0.0, 1.0);
  vUv = uv;
  vSlice = sliceW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fxFrag = `
uniform sampler2D map;
uniform float borderW;
uniform float texW;
uniform float numCombo;
varying vec4 vColor;
varying vec2 vUv;
varying float vSlice;
float glyph(int i) {
  if (i <= 0) return 0.0;
  if (i == 1) return 0.102272697;
  if (i == 2) return 0.181818202;
  if (i == 3) return 0.284090906;
  if (i == 4) return 0.386363596;
  if (i == 5) return 0.488636404;
  if (i == 6) return 0.590909123;
  if (i == 7) return 0.693181813;
  if (i == 8) return 0.795454502;
  if (i == 9) return 0.897727311;
  return 1.0;
}
void main() {
  vec2 tuv = vUv;
  if (numCombo > 0.5) {
    // TEXCOORD0 is vec3: x = blend, y = v, z = digit. sizeX slot carries z.
    float span = glyph(int(vSlice + 1.0)) - glyph(int(vSlice));
    float y = min(max(vUv.x - 0.111111097, 0.02) * 1.28571427, 1.0);
    float factor = (span >= 0.1 ? vUv.x : 0.0) + (span <= 0.1 ? y : 0.0);
    tuv.x = span * factor + glyph(int(vSlice));
    tuv.y = vUv.y;
  } else if (borderW > 0.0) {
    float s = vSlice / max(texW, 1.0);
    float k = min(1.0 / max(s, 1e-5), 1.0);
    float left = k * borderW;
    float right = 1.0 - borderW * k;
    float u = 0.5;
    if (vUv.x <= left) u = vUv.x * s;
    else if (vUv.x >= right) u = 1.0 - (1.0 - vUv.x) * s;
    tuv = vec2(u, vUv.y);
  }
  gl_FragColor = texture2D(map, tuv) * vColor;
}`;

function shader(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, blending: THREE.Blending | 'premul' | 'add') {
  const premul = blending === 'premul';
  const add = blending === 'add';
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    blending: premul || add ? THREE.CustomBlending : blending,
    blendSrc: premul ? THREE.OneFactor : THREE.SrcAlphaFactor,
    blendDst: premul ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
    blendSrcAlpha: premul ? THREE.OneFactor : THREE.SrcAlphaFactor,
    blendDstAlpha: premul ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor,
  });
}

export function spriteMaterial(map: THREE.Texture) {
  return shader(spriteVert, spriteFrag, { map: { value: map } }, 'premul');
}

/** Material PlaneFade path 176: _Min 0.75, _Power 0.75, _Color (0,0,0,0.8). */
export function planeMaterial() {
  return shader(planeVert, planeFrag, {
    color: { value: new THREE.Vector4(0, 0, 0, 0.8) },
    minV: { value: 0.75 },
    power: { value: 0.75 },
  }, 'premul');
}

/** borderW 0.495 / texW 256 are materials 194 and 195. numCombo selects path 91. */
export function fxMaterial(map: THREE.Texture, borderW = 0, texW = 256, numCombo = false) {
  return shader(fxVert, fxFrag, {
    map: { value: map },
    borderW: { value: borderW },
    texW: { value: texW },
    numCombo: { value: numCombo ? 1 : 0 },
  }, 'add');
}
