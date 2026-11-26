// PS1 复古材质：顶点抖动（屏幕坐标取整）、逐顶点光照、仿射纹理映射、深度雾、4x4 有序抖动 + 15 位色量化
import * as THREE from 'three';

export const ps1Uniforms = {
  uLightDir: { value: new THREE.Vector3(-0.45, 0.85, 0.4).normalize() },
  uLightColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
  uAmbient: { value: new THREE.Color(0.3, 0.32, 0.42) },
  uFogColor: { value: new THREE.Color(0x0b0d1c) },
  uFogNear: { value: 14 },
  uFogFar: { value: 46 },
  /** 顶点吸附网格分辨率（越小抖动越明显） */
  uSnap: { value: new THREE.Vector2(320, 180) },
  uSnapOn: { value: 1 },
  uDither: { value: 1 },
  /** 1 = PS1 仿射贴图（透视扭曲），0 = 透视校正（高清模式） */
  uAffine: { value: 1 },
};

const vertexShader = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec2 uSnap;
uniform float uSnapOn;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUnlit;
uniform float uFogOn;
uniform mat3 uUvTransform;
uniform float uAffine;
varying vec3 vUvw;
varying vec3 vLight;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  if (uSnapOn > 0.5 && clip.w > 0.0) {
    vec2 grid = uSnap * 0.5;
    clip.xy = floor(clip.xy / clip.w * grid + 0.5) / grid * clip.w;
  }
  gl_Position = clip;
  vec3 n = normalize(normalMatrix * normal);
  vec3 l = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  float diff = max(dot(n, l), 0.0);
  vLight = mix(uAmbient + uLightColor * diff, vec3(1.0), uUnlit);
  // 仿射纹理：把 uv 乘以 w，片元里再除回去，抵消透视校正
  vec2 tuv = (uUvTransform * vec3(uv, 1.0)).xy;
  vUvw = mix(vec3(tuv, 1.0), vec3(tuv * clip.w, clip.w), uAffine);
  vFog = uFogOn * smoothstep(uFogNear, uFogFar, -mv.z);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uDither;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uOpacity;
uniform float uAlphaTest;
varying vec3 vUvw;
varying vec3 vLight;
varying float vFog;

float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUvw.xy / vUvw.z;
  vec4 tex = texture2D(map, uv);
  if (tex.a < uAlphaTest) discard;
  vec3 c = tex.rgb * uColor * vLight;
  c = mix(c, uFlashColor, uFlash);
  c = mix(c, uFogColor, vFog);
  vec3 s = toSRGB(clamp(c, 0.0, 1.0));
  if (uDither > 0.5) {
    float b = bayer4(gl_FragCoord.xy) - 0.5;
    s = clamp(floor(s * 31.0 + 0.5 + b * 0.9) / 31.0, 0.0, 1.0);
  }
  gl_FragColor = vec4(s, tex.a * uOpacity);
}
`;

let white: THREE.Texture | null = null;
function whiteTexture(): THREE.Texture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.colorSpace = THREE.SRGBColorSpace;
    white.needsUpdate = true;
  }
  return white;
}

export interface PS1Options {
  map?: THREE.Texture | null;
  color?: THREE.ColorRepresentation;
  unlit?: boolean;
  fog?: boolean;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  blending?: THREE.Blending;
}

export type PS1Material = THREE.ShaderMaterial & {
  uniforms: {
    uFlash: { value: number };
    uFlashColor: { value: THREE.Color };
    uOpacity: { value: number };
    uColor: { value: THREE.Color };
    map: { value: THREE.Texture };
  };
};

export function ps1Material(o: PS1Options = {}): PS1Material {
  // 自定义着色器不会自动应用 texture.offset / repeat，这里手动传入贴图变换矩阵
  o.map?.updateMatrix();
  return new THREE.ShaderMaterial({
    uniforms: {
      ...ps1Uniforms,
      map: { value: o.map ?? whiteTexture() },
      uUvTransform: { value: o.map ? o.map.matrix : new THREE.Matrix3() },
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uUnlit: { value: o.unlit ? 1 : 0 },
      uFogOn: { value: o.fog === false ? 0 : 1 },
      uFlash: { value: 0 },
      uFlashColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: o.opacity ?? 1 },
      uAlphaTest: { value: o.alphaTest ?? 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: o.transparent ?? false,
    side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? true,
    blending: o.blending ?? THREE.NormalBlending,
  }) as PS1Material;
}

/** 根据渲染内部分辨率设置顶点吸附网格 */
export function setPS1Resolution(w: number, h: number): void {
  ps1Uniforms.uSnap.value.set(Math.max(64, w / 2), Math.max(36, h / 2));
}
