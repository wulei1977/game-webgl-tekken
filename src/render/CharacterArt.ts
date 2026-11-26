// 角色美术：程序化 256×256 贴图图集 + 分段式低多边形模型（PS1 铁拳式刚体分段角色）
// 骨骼：头、躯干、上臂、前臂、手、大腿、小腿、脚 + 警棍挂点；单角色约 800~1500 三角面
import * as THREE from 'three';
import { Rng } from '../core/math';
import type { CharacterDef } from '../core/types';
import { ps1Material, type PS1Material } from './PS1Material';
import { hex, makeTexture, mixRGB, PixelCanvas, shade, type RGB } from './TextureFactory';

export const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR',
] as const;
export type JointName = (typeof JOINTS)[number];

export interface CharacterModel {
  root: THREE.Group;
  joints: Record<JointName, THREE.Object3D>;
  rest: Record<JointName, THREE.Vector3>;
  material: PS1Material;
  scale: number;
  hipsHeight: number;
  lengths: { upperArm: number; forearm: number; thigh: number; shin: number };
  ankleHeight: number;
  batonHand: THREE.Object3D | null;
  batonHolster: THREE.Object3D | null;
  triangles: number;
}

// ------------------------------------------------------------------ 图集区域（4×4，每格 64×64）

type Region = [number, number];
const REG = {
  face: [0, 0], headSide: [1, 0], headBack: [2, 0], hairTop: [3, 0],
  torsoFront: [0, 1], torsoBack: [1, 1], torsoSide: [2, 1], skin: [3, 1],
  sleeve: [0, 2], pants: [1, 2], belt: [2, 2], glove: [3, 2],
  foot: [0, 3], acc1: [1, 3], acc2: [2, 3], hair: [3, 3],
} satisfies Record<string, Region>;

function uvRect(r: Region) {
  const inset = 0.6 / 256;
  return { u: r[0] / 4 + inset, v: 1 - (r[1] + 1) / 4 + inset, w: 0.25 - inset * 2, h: 0.25 - inset * 2 };
}

// ------------------------------------------------------------------ 贴图绘制

interface Palette {
  skin: RGB;
  hair: RGB;
  top: RGB;
  bottom: RGB;
  belt: RGB;
  accent: RGB;
  metal: RGB;
  shoe: RGB;
}

const PALETTES: Record<string, [Palette, Palette]> = {
  heishi: [
    { skin: hex(0xc99470), hair: hex(0x18120f), top: hex(0xe9e6de), bottom: hex(0xe2ded5), belt: hex(0xb0202a), accent: hex(0xb0202a), metal: hex(0x999999), shoe: hex(0xc99470) },
    { skin: hex(0xb98462), hair: hex(0x2a1c10), top: hex(0x2c2c36), bottom: hex(0x26262f), belt: hex(0xd8a628), accent: hex(0xd8a628), metal: hex(0x999999), shoe: hex(0xb98462) },
  ],
  golem: [
    { skin: hex(0xa8724f), hair: hex(0x3a2216), top: hex(0x5a3a22), bottom: hex(0x383a44), belt: hex(0x6a4024), accent: hex(0xd8a628), metal: hex(0x8c93a0), shoe: hex(0x2a2220) },
    { skin: hex(0x8f6142), hair: hex(0x1a120c), top: hex(0x3a2216), bottom: hex(0x6a1e22), belt: hex(0x3a2418), accent: hex(0xe0e0e8), metal: hex(0xb08040), shoe: hex(0x1e1a18) },
  ],
  rina: [
    { skin: hex(0xe6b994), hair: hex(0x2c1a12), top: hex(0x1f2d52), bottom: hex(0x1b2647), belt: hex(0x15151a), accent: hex(0xe0b040), metal: hex(0xc8ccd4), shoe: hex(0x101014) },
    { skin: hex(0xd9a985), hair: hex(0x5a2a14), top: hex(0x4f6fa8), bottom: hex(0x2f4672), belt: hex(0x1c1c22), accent: hex(0xe8e8f0), metal: hex(0xc8ccd4), shoe: hex(0x1a1a20) },
  ],
};

function at(r: Region): [number, number] {
  return [r[0] * 64, r[1] * 64];
}

/** 布料：底色 + 噪点 + 褶皱线 */
function cloth(p: PixelCanvas, r: Region, base: RGB, folds = 6): void {
  const [x, y] = at(r);
  p.noise(x, y, 64, 64, base, 0.05, 2);
  for (let i = 0; i < folds; i++) {
    const fx = x + p.rng.int(4, 58);
    const fy = y + p.rng.int(0, 40);
    const len = p.rng.int(10, 24);
    for (let k = 0; k < len; k++) {
      p.px(fx + Math.round(Math.sin(k * 0.3) * 2), fy + k, shade(base, 0.78));
      p.px(fx + 1 + Math.round(Math.sin(k * 0.3) * 2), fy + k, shade(base, 1.08));
    }
  }
  p.rect(x, y + 60, 64, 4, shade(base, 0.8));
}

function skinFill(p: PixelCanvas, r: Region, skin: RGB): void {
  const [x, y] = at(r);
  p.noise(x, y, 64, 64, skin, 0.04, 2);
}

function drawEyes(p: PixelCanvas, x: number, y: number, pal: Palette, style: 'fierce' | 'heavy' | 'soft'): void {
  const white: RGB = [235, 232, 225];
  const dark: RGB = [20, 14, 12];
  const brow = shade(pal.hair, 0.9);
  if (style === 'soft') {
    p.rect(x + 14, y + 27, 10, 6, white).rect(x + 40, y + 27, 10, 6, white);
    p.rect(x + 17, y + 27, 5, 6, hex(0x3a2a1e)).rect(x + 43, y + 27, 5, 6, hex(0x3a2a1e));
    p.rect(x + 18, y + 28, 2, 2, white).rect(x + 44, y + 28, 2, 2, white);
    p.rect(x + 13, y + 25, 12, 2, dark).rect(x + 39, y + 25, 12, 2, dark);
    p.rect(x + 14, y + 21, 10, 2, brow).rect(x + 40, y + 21, 10, 2, brow);
  } else {
    p.rect(x + 14, y + 28, 11, 4, white).rect(x + 39, y + 28, 11, 4, white);
    p.rect(x + 19, y + 28, 4, 4, dark).rect(x + 41, y + 28, 4, 4, dark);
    if (style === 'fierce') {
      p.line(x + 12, y + 23, x + 26, y + 26, brow).line(x + 12, y + 24, x + 26, y + 27, brow);
      p.line(x + 52, y + 23, x + 38, y + 26, brow).line(x + 52, y + 24, x + 38, y + 27, brow);
    } else {
      p.rect(x + 11, y + 23, 16, 4, shade(pal.skin, 0.6)).rect(x + 37, y + 23, 16, 4, shade(pal.skin, 0.6));
    }
  }
}

function paintHeishi(p: PixelCanvas, pal: Palette): void {
  const { skin, hair, top, bottom } = pal;
  // 脸
  let [x, y] = at(REG.face);
  skinFill(p, REG.face, skin);
  p.rect(x, y, 64, 14, hair);
  for (let i = 0; i < 64; i += 6) p.rect(x + i, y + 14, 4, p.rng.int(2, 6), hair);
  drawEyes(p, x, y, pal, 'fierce');
  p.rect(x + 29, y + 32, 6, 10, shade(skin, 0.8)).rect(x + 30, y + 41, 6, 2, shade(skin, 0.6));
  p.rect(x + 23, y + 49, 18, 2, hex(0x5a2a24)).rect(x + 25, y + 51, 14, 1, shade(skin, 0.8));
  p.rect(x, y + 56, 64, 8, shade(skin, 0.85));
  p.rect(x, y + 14, 4, 40, shade(hair, 1.2)).rect(x + 60, y + 14, 4, 40, shade(hair, 1.2));
  // 侧面
  [x, y] = at(REG.headSide);
  skinFill(p, REG.headSide, skin);
  p.rect(x, y, 64, 18, hair).rect(x + 40, y, 24, 46, hair);
  p.rect(x + 28, y + 26, 9, 14, shade(skin, 0.8)).rect(x + 30, y + 29, 5, 8, shade(skin, 0.65));
  // 后脑
  [x, y] = at(REG.headBack);
  p.noise(x, y, 64, 48, hair, 0.12, 2);
  skinFill(p, [REG.headBack[0], REG.headBack[1]], skin);
  p.noise(x, y, 64, 46, hair, 0.12, 2);
  // 头顶
  p.noise(...at(REG.hairTop), 64, 64, hair, 0.15, 2);
  p.noise(...at(REG.hair), 64, 64, hair, 0.18, 2);
  // 道服正面：V 领露出胸口
  cloth(p, REG.torsoFront, top, 7);
  [x, y] = at(REG.torsoFront);
  for (let k = 0; k < 34; k++) {
    const half = Math.max(0, 16 - k * 0.48);
    p.rect(x + 32 - half, y + k, half * 2, 1, shade(skin, 1 - k * 0.004));
  }
  p.line(x + 15, y, x + 33, y + 36, shade(top, 0.6)).line(x + 49, y, x + 31, y + 36, shade(top, 0.6));
  p.line(x + 14, y, x + 32, y + 37, shade(top, 0.75));
  // 背面：红色圆徽
  cloth(p, REG.torsoBack, top, 6);
  [x, y] = at(REG.torsoBack);
  p.circle(x + 32, y + 24, 11, pal.accent).circle(x + 32, y + 24, 7, shade(pal.accent, 0.7));
  cloth(p, REG.torsoSide, top, 5);
  cloth(p, REG.sleeve, top, 5);
  cloth(p, REG.pants, bottom, 8);
  // 腰带
  [x, y] = at(REG.belt);
  p.noise(x, y, 64, 64, pal.belt, 0.06, 2);
  p.rect(x, y, 64, 3, shade(pal.belt, 0.6)).rect(x, y + 61, 64, 3, shade(pal.belt, 0.6));
  // 缠手（拳头）
  [x, y] = at(REG.glove);
  skinFill(p, REG.glove, skin);
  for (let i = 0; i < 64; i += 10) p.rect(x, y + i, 64, 5, hex(0xe8e2d4));
  [x, y] = at(REG.skin);
  skinFill(p, REG.skin, skin);
  // 赤脚
  [x, y] = at(REG.foot);
  skinFill(p, REG.foot, skin);
  for (let i = 0; i < 5; i++) p.rect(x + 6 + i * 11, y + 2, 2, 8, shade(skin, 0.7));
  p.noise(...at(REG.acc1), 64, 64, pal.belt, 0.06, 2);
}

function paintGolem(p: PixelCanvas, pal: Palette): void {
  const { skin, hair, top, bottom, metal } = pal;
  let [x, y] = at(REG.face);
  skinFill(p, REG.face, skin);
  p.rect(x, y, 64, 6, shade(skin, 1.12)).rect(x + 8, y + 2, 20, 2, shade(skin, 1.3));
  drawEyes(p, x, y, pal, 'heavy');
  p.rect(x + 27, y + 31, 10, 12, shade(skin, 0.78));
  p.line(x + 44, y + 12, x + 52, y + 40, hex(0x6a3a2a)); // 伤疤
  // 络腮胡
  p.noise(x, y + 40, 64, 24, hair, 0.18, 2);
  p.rect(x, y + 34, 8, 30, hair).rect(x + 56, y + 34, 8, 30, hair);
  p.rect(x + 20, y + 44, 24, 4, hex(0x4a1a14)).rect(x + 18, y + 40, 28, 4, hair);
  [x, y] = at(REG.headSide);
  skinFill(p, REG.headSide, skin);
  p.noise(x, y + 38, 40, 26, hair, 0.18, 2);
  p.rect(x + 26, y + 24, 10, 14, shade(skin, 0.75));
  skinFill(p, REG.headBack, skin);
  [x, y] = at(REG.headBack);
  p.rect(x, y + 50, 64, 14, shade(skin, 0.8));
  skinFill(p, REG.hairTop, skin);
  [x, y] = at(REG.hairTop);
  p.rect(x + 20, y + 20, 14, 6, shade(skin, 1.3));
  // 裸胸 + X 型皮革背带
  [x, y] = at(REG.torsoFront);
  skinFill(p, REG.torsoFront, skin);
  p.rect(x + 8, y + 22, 22, 2, shade(skin, 0.7)).rect(x + 34, y + 22, 22, 2, shade(skin, 0.7));
  for (let r = 0; r < 3; r++) p.rect(x + 24, y + 32 + r * 9, 16, 1, shade(skin, 0.72));
  p.rect(x + 31, y + 26, 2, 34, shade(skin, 0.75));
  for (let k = 0; k < 64; k++) {
    p.rect(x + k * 0.9, y + k, 8, 1, top).rect(x + 56 - k * 0.9, y + k, 8, 1, top);
  }
  p.rect(x + 26, y + 26, 12, 12, metal).rect(x + 29, y + 29, 6, 6, shade(metal, 0.6));
  [x, y] = at(REG.torsoBack);
  skinFill(p, REG.torsoBack, skin);
  for (let k = 0; k < 64; k++) {
    p.rect(x + k * 0.9, y + k, 8, 1, top).rect(x + 56 - k * 0.9, y + k, 8, 1, top);
  }
  skinFill(p, REG.torsoSide, skin);
  [x, y] = at(REG.torsoSide);
  p.rect(x + 24, y, 10, 64, top);
  skinFill(p, REG.sleeve, skin);
  [x, y] = at(REG.sleeve);
  p.rect(x, y + 40, 64, 10, top).rect(x, y + 43, 64, 2, pal.accent);
  cloth(p, REG.pants, bottom, 6);
  [x, y] = at(REG.pants);
  p.rect(x + 8, y + 26, 48, 14, shade(bottom, 0.75));
  // 宽皮带 + 金属扣
  [x, y] = at(REG.belt);
  p.noise(x, y, 64, 64, pal.belt, 0.08, 2);
  p.rect(x + 22, y + 14, 20, 36, pal.accent).rect(x + 26, y + 18, 12, 28, shade(pal.accent, 0.6));
  // 重型拳套：金属板 + 铆钉
  [x, y] = at(REG.glove);
  p.noise(x, y, 64, 64, metal, 0.06, 2);
  for (let i = 0; i < 64; i += 16) p.rect(x, y + i, 64, 2, shade(metal, 0.55));
  for (let i = 6; i < 64; i += 14) for (let j = 6; j < 64; j += 16) p.rect(x + i, y + j, 3, 3, shade(metal, 1.4));
  skinFill(p, REG.skin, skin);
  p.noise(...at(REG.foot), 64, 64, pal.shoe, 0.08, 2);
  // 护肩金属
  [x, y] = at(REG.acc1);
  p.noise(x, y, 64, 64, metal, 0.07, 2);
  p.rect(x, y, 64, 4, shade(metal, 1.4)).rect(x, y + 30, 64, 3, shade(metal, 0.5));
  for (let i = 4; i < 64; i += 12) p.rect(x + i, y + 8, 3, 3, shade(metal, 1.5)).rect(x + i, y + 50, 3, 3, shade(metal, 1.5));
  p.speckle(x, y, 64, 64, shade(metal, 0.4), 40);
  p.noise(...at(REG.hair), 64, 64, hair, 0.18, 2);
}

function paintRina(p: PixelCanvas, pal: Palette): void {
  const { skin, hair, top, bottom, accent } = pal;
  let [x, y] = at(REG.face);
  skinFill(p, REG.face, skin);
  p.rect(x, y, 64, 12, hair);
  for (let i = 0; i < 64; i += 5) p.rect(x + i, y + 12, 4, p.rng.int(3, 9), hair);
  p.rect(x, y + 12, 5, 44, hair).rect(x + 59, y + 12, 5, 44, hair);
  drawEyes(p, x, y, pal, 'soft');
  p.rect(x + 30, y + 35, 4, 7, shade(skin, 0.85));
  p.rect(x + 25, y + 48, 14, 3, hex(0xb0404a)).rect(x + 27, y + 51, 10, 1, hex(0x80283a));
  p.rect(x + 10, y + 40, 6, 3, shade(hex(0xe08080), 0.95), 0.5).rect(x + 48, y + 40, 6, 3, shade(hex(0xe08080), 0.95), 0.5);
  [x, y] = at(REG.headSide);
  skinFill(p, REG.headSide, skin);
  p.rect(x, y, 64, 20, hair).rect(x + 36, y, 28, 56, hair);
  p.rect(x + 26, y + 26, 8, 12, shade(skin, 0.82));
  p.noise(...at(REG.headBack), 64, 64, hair, 0.12, 2);
  [x, y] = at(REG.headBack);
  p.rect(x + 26, y + 30, 12, 6, hex(0xc02a3a));
  p.noise(...at(REG.hairTop), 64, 64, hair, 0.12, 2);
  p.noise(...at(REG.hair), 64, 64, hair, 0.16, 2);
  // 警服正面：纽扣 + 领带 + 警徽
  cloth(p, REG.torsoFront, top, 4);
  [x, y] = at(REG.torsoFront);
  p.rect(x + 22, y, 20, 8, hex(0xd8dce4));
  p.rect(x + 29, y + 4, 6, 30, hex(0x101018)).rect(x + 28, y + 32, 8, 6, hex(0x101018));
  for (let i = 0; i < 4; i++) p.rect(x + 37, y + 14 + i * 12, 3, 3, accent);
  p.rect(x + 8, y + 16, 12, 14, accent).rect(x + 11, y + 19, 6, 8, shade(accent, 0.6)).px(x + 13, y + 22, hex(0xffffff));
  p.rect(x + 44, y + 18, 12, 3, hex(0xd8dce4));
  cloth(p, REG.torsoBack, top, 4);
  [x, y] = at(REG.torsoBack);
  p.textCentered('POLICE', x + 32, y + 18, { scale: 1, color: '#f0d060', bold: true });
  cloth(p, REG.torsoSide, top, 3);
  cloth(p, REG.sleeve, top, 3);
  [x, y] = at(REG.sleeve);
  p.rect(x + 20, y + 10, 24, 14, hex(0x2a3c6a)).rect(x + 24, y + 13, 16, 8, accent);
  // 腿（丝袜）
  [x, y] = at(REG.pants);
  p.noise(x, y, 64, 64, mixRGB(skin, hex(0x2a2230), 0.35), 0.03, 2);
  // 执勤腰带
  [x, y] = at(REG.belt);
  p.noise(x, y, 64, 64, pal.belt, 0.1, 2);
  p.rect(x + 26, y + 18, 12, 28, pal.metal).rect(x + 4, y + 10, 14, 44, shade(pal.belt, 1.6)).rect(x + 46, y + 10, 14, 44, shade(pal.belt, 1.6));
  skinFill(p, REG.glove, skin);
  skinFill(p, REG.skin, skin);
  // 黑色高跟鞋
  [x, y] = at(REG.foot);
  p.noise(x, y, 64, 64, pal.shoe, 0.05, 2);
  p.rect(x + 8, y + 6, 30, 3, hex(0x5a5a70));
  // 警帽
  [x, y] = at(REG.acc1);
  p.noise(x, y, 64, 64, shade(top, 0.9), 0.05, 2);
  p.rect(x, y + 44, 64, 20, hex(0x0e0e12)).rect(x, y + 40, 64, 4, accent);
  p.rect(x + 26, y + 18, 12, 16, accent).rect(x + 29, y + 21, 6, 10, shade(accent, 0.6));
  // 短裙
  [x, y] = at(REG.acc2);
  p.noise(x, y, 64, 64, bottom, 0.05, 2);
  for (let i = 4; i < 64; i += 9) p.rect(x + i, y, 2, 64, shade(bottom, 0.7));
  p.rect(x, y + 58, 64, 6, shade(bottom, 0.65));
}

const atlasCache = new Map<string, { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }>();

export function characterAtlas(id: string, alt = false): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const key = `${id}|${alt}`;
  const hit = atlasCache.get(key);
  if (hit) return hit;
  const p = new PixelCanvas(256, 256, new Rng(id.length * 31 + (alt ? 7 : 0)));
  const pal = (PALETTES[id] ?? PALETTES.heishi)[alt ? 1 : 0];
  p.fill(pal.skin);
  if (id === 'golem') paintGolem(p, pal);
  else if (id === 'rina') paintRina(p, pal);
  else paintHeishi(p, pal);
  p.quantize(5);
  const res = { canvas: p.c, texture: makeTexture(p.c) };
  atlasCache.set(key, res);
  return res;
}

/** 角色头像（取图集脸部区域，加边框底色） */
export function portraitCanvas(id: string, alt = false, size = 64): HTMLCanvasElement {
  const { canvas } = characterAtlas(id, alt);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = alt ? '#3a1a1a' : '#1a2440';
  g.fillRect(0, 0, size, size);
  g.drawImage(canvas, 0, 0, 64, 64, 0, 0, size, size);
  g.strokeStyle = '#000';
  g.lineWidth = Math.max(1, size / 32);
  g.strokeRect(0, 0, size, size);
  return c;
}

// ------------------------------------------------------------------ 几何体

type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const FACE_ORDER: FaceKey[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/**
 * 低模方块：支持分段、上下渐变收窄（taper）与中部鼓起 + 倒角（bulge），用少量面数做出圆润的躯干 / 头部。
 * 每个面可以映射到图集的不同区域。
 */
function boxGeo(
  w: number,
  h: number,
  d: number,
  faces: Region | (Partial<Record<FaceKey, Region>> & { all?: Region }),
  anchor: 'center' | 'top' | 'bottom' = 'center',
  taperTop = 1,
  taperBottom = 1,
  seg: [number, number, number] = [1, 1, 1],
  bulge = 0,
): THREE.BufferGeometry {
  const [sx, sy, sz] = seg;
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + h / 2) / h;
    let k = taperBottom + (taperTop - taperBottom) * t;
    if (bulge) k *= 1 + bulge * (1 - (2 * t - 1) ** 2);
    let x = pos.getX(i) * k;
    let z = pos.getZ(i) * k;
    if (bulge) {
      const corner = (Math.abs(pos.getX(i)) / (w / 2)) * (Math.abs(pos.getZ(i)) / (d / 2));
      const r = 1 - bulge * 1.6 * corner * corner;
      x *= r;
      z *= r;
    }
    pos.setXYZ(i, x, y, z);
  }
  if (bulge) g.computeVertexNormals();
  if (anchor === 'top') g.translate(0, -h / 2, 0);
  else if (anchor === 'bottom') g.translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const map = Array.isArray(faces) ? { all: faces as Region } : (faces as Partial<Record<FaceKey, Region>> & { all?: Region });
  const counts = [(sz + 1) * (sy + 1), (sz + 1) * (sy + 1), (sx + 1) * (sz + 1), (sx + 1) * (sz + 1), (sx + 1) * (sy + 1), (sx + 1) * (sy + 1)];
  let start = 0;
  FACE_ORDER.forEach((key, f) => {
    const reg = map[key] ?? map.all ?? REG.skin;
    const r = uvRect(reg);
    for (let v = start; v < start + counts[f]; v++) {
      let u = uv.getX(v);
      if (key === 'nx') u = 1 - u;
      uv.setXY(v, r.u + u * r.w, r.v + uv.getY(v) * r.h);
    }
    start += counts[f];
  });
  return g;
}

/** 肢体：8 边圆柱，中段略鼓（肌肉感），沿 -Y 悬挂 */
function limbGeo(len: number, rTop: number, rBottom: number, reg: Region, seg = 8, anchor: 'top' | 'bottom' = 'top', bulge = 0.08): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg, 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i)) < len * 0.01 && Math.hypot(pos.getX(i), pos.getZ(i)) > 1e-4) {
      pos.setX(i, pos.getX(i) * (1 + bulge));
      pos.setZ(i, pos.getZ(i) * (1 + bulge));
    }
  }
  g.computeVertexNormals();
  g.translate(0, anchor === 'top' ? -len / 2 : len / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const r = uvRect(reg);
  for (let v = 0; v < uv.count; v++) uv.setXY(v, r.u + uv.getX(v) * r.w, r.v + uv.getY(v) * r.h);
  return g;
}

/** 小圆锥（发梢 / 马尾） */
function coneGeo(r: number, len: number, reg: Region, seg = 4): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, len, seg, 1);
  g.translate(0, len / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const rr = uvRect(reg);
  for (let v = 0; v < uv.count; v++) uv.setXY(v, rr.u + uv.getX(v) * rr.w, rr.v + uv.getY(v) * rr.h);
  return g;
}

interface Build {
  shoulderW: number;
  hipW: number;
  chest: [number, number, number];
  abdomen: [number, number, number];
  pelvis: [number, number, number];
  arm: number;
  leg: number;
  head: [number, number, number];
  fist: number;
  neck: number;
}

const BUILDS: Record<string, Build> = {
  heishi: { shoulderW: 0.21, hipW: 0.1, chest: [0.42, 0.3, 0.24], abdomen: [0.32, 0.17, 0.2], pelvis: [0.34, 0.17, 0.22], arm: 0.062, leg: 0.085, head: [0.2, 0.24, 0.22], fist: 0.095, neck: 0.06 },
  golem: { shoulderW: 0.27, hipW: 0.12, chest: [0.58, 0.34, 0.34], abdomen: [0.46, 0.2, 0.3], pelvis: [0.42, 0.18, 0.28], arm: 0.088, leg: 0.11, head: [0.21, 0.23, 0.23], fist: 0.15, neck: 0.085 },
  rina: { shoulderW: 0.17, hipW: 0.095, chest: [0.33, 0.28, 0.2], abdomen: [0.26, 0.15, 0.17], pelvis: [0.3, 0.16, 0.2], arm: 0.047, leg: 0.068, head: [0.19, 0.23, 0.21], fist: 0.075, neck: 0.05 },
};

export function buildCharacterModel(def: CharacterDef, alt = false): CharacterModel {
  const id = def.id;
  const s = def.stats.scale;
  const B = BUILDS[id] ?? BUILDS.heishi;
  const { texture } = characterAtlas(id, alt);
  const mat = ps1Material({ map: texture });
  const root = new THREE.Group();
  root.name = `fighter-${id}`;
  const joints = {} as Record<JointName, THREE.Object3D>;
  const mk = (name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(x * s, y * s, z * s);
    parent.add(o);
    joints[name] = o;
    return o;
  };
  const mesh = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0, m: THREE.Material = mat) => {
    geo.scale(s, s, s);
    const me = new THREE.Mesh(geo, m);
    me.position.set(x * s, y * s, z * s);
    parent.add(me);
    return me;
  };

  const upperArm = 0.28;
  const forearm = 0.25;
  const thigh = 0.44;
  const shin = 0.43;
  const hipH = 0.96;

  const hips = mk('hips', root, 0, hipH, 0);
  const spine = mk('spine', hips, 0, 0.08, 0);
  const chest = mk('chest', spine, 0, 0.17, 0);
  const neck = mk('neck', chest, 0, 0.3, 0);
  const head = mk('head', neck, 0, 0.07, 0);

  mesh(boxGeo(...B.pelvis, { all: REG.pants, py: REG.belt }, 'center', 1, 0.82, [2, 1, 2], 0.06), hips, 0, -0.02, 0);
  mesh(boxGeo(...B.abdomen, { all: REG.torsoSide, pz: REG.torsoFront }, 'bottom', 1.06, 0.94, [2, 1, 2], 0.06), spine, 0, -0.01, 0);
  mesh(boxGeo(...B.chest, { all: REG.torsoSide, pz: REG.torsoFront, nz: REG.torsoBack }, 'bottom', 1.1, 0.84, [2, 2, 2], 0.09), chest, 0, 0, 0);
  mesh(limbGeo(0.1, B.neck, B.neck * 1.12, REG.skin, 6, 'bottom', 0), neck, 0, -0.02, 0);
  const [hw, hh, hd] = B.head;
  mesh(boxGeo(hw, hh, hd, { px: REG.headSide, nx: REG.headSide, pz: REG.face, nz: REG.headBack, py: REG.hairTop, ny: REG.skin }, 'bottom', 0.9, 0.84, [2, 2, 2], 0.13), head, 0, 0, 0);
  // 耳朵
  for (const sx of [1, -1]) mesh(boxGeo(0.025, 0.06, 0.045, REG.skin), head, sx * hw * 0.52, hh * 0.45, -0.01);

  const arm = (side: 'L' | 'R') => {
    const sx = side === 'L' ? 1 : -1;
    const sh = mk(`shoulder${side}`, chest, sx * B.shoulderW, 0.25, 0);
    mesh(limbGeo(upperArm, B.arm * 1.05, B.arm * 0.88, REG.sleeve), sh);
    const el = mk(`elbow${side}`, sh, 0, -upperArm, 0);
    mesh(limbGeo(forearm, B.arm * 0.92, B.arm * 0.7, id === 'golem' ? REG.glove : REG.skin, 8, 'top', 0.12), el);
    const hd2 = mk(`hand${side}`, el, 0, -forearm, 0);
    mesh(boxGeo(B.fist, B.fist * 1.05, B.fist * 1.1, REG.glove, 'top', 1, 1, [2, 1, 2], 0.12), hd2, 0, 0.005, 0.005);
    return sh;
  };
  const shL = arm('L');
  const shR = arm('R');

  const leg = (side: 'L' | 'R') => {
    const sx = side === 'L' ? 1 : -1;
    const th = mk(`thigh${side}`, hips, sx * B.hipW, -0.04, 0);
    mesh(limbGeo(thigh, B.leg * 1.12, B.leg * 0.84, REG.pants, 8, 'top', 0.1), th);
    const kn = mk(`knee${side}`, th, 0, -thigh, 0);
    mesh(limbGeo(shin, B.leg * 0.86, B.leg * 0.6, REG.pants, 8, 'top', 0.14), kn);
    if (id === 'golem') mesh(boxGeo(B.leg * 1.9, 0.12, 0.08, REG.acc1, 'center', 0.8, 1, [2, 1, 1], 0.1), kn, 0, -0.03, B.leg * 0.75);
    const ft = mk(`foot${side}`, kn, 0, -shin, 0);
    const fl = id === 'golem' ? 0.26 : id === 'rina' ? 0.19 : 0.22;
    mesh(boxGeo(B.leg * 1.1, 0.06, fl, REG.foot, 'center', 0.9, 1), ft, 0, -0.02, fl * 0.28);
    if (id === 'rina') mesh(boxGeo(0.025, 0.06, 0.025, REG.foot), ft, 0, -0.03, -0.05);
  };
  leg('L');
  leg('R');

  // —— 角色专属配件 ——
  let batonHand: THREE.Object3D | null = null;
  let batonHolster: THREE.Object3D | null = null;
  if (id === 'heishi') {
    mesh(boxGeo(hw * 1.08, 0.08, hd * 1.1, { all: REG.hair }, 'bottom', 0.78, 1, [2, 1, 2], 0.1), head, 0, hh * 0.84, -0.008);
    // 短发发梢（刺猬头）
    const spikes: [number, number, number, number, number][] = [
      [0.05, 0.95, 0.06, -0.5, 0.3], [-0.05, 0.95, 0.06, -0.5, -0.3], [0, 0.98, -0.02, 0.2, 0], [0.06, 0.9, -0.07, 0.7, 0.4], [-0.06, 0.9, -0.07, 0.7, -0.4], [0, 0.85, -0.1, 1.1, 0],
    ];
    for (const [x, y, z, rx, rz] of spikes) {
      const sp = mesh(coneGeo(0.035, 0.07, REG.hair), head, x, hh * y, z);
      sp.rotation.set(rx, 0, rz);
    }
    // 道服下摆盖住裤腰
    mesh(boxGeo(B.pelvis[0] * 1.12, 0.15, B.pelvis[2] * 1.16, REG.torsoSide, 'top', 1, 1.12, [2, 1, 2], 0.04), hips, 0, 0.06, 0);
    mesh(boxGeo(B.abdomen[0] * 1.1, 0.05, B.abdomen[2] * 1.15, REG.belt), spine, 0, 0.0, 0);
    mesh(boxGeo(0.05, 0.12, 0.02, REG.belt, 'top'), spine, 0.06, 0.0, B.abdomen[2] * 0.6);
    mesh(boxGeo(0.05, 0.1, 0.02, REG.belt, 'top'), spine, 0.0, 0.0, B.abdomen[2] * 0.6);
  } else if (id === 'golem') {
    for (const [sh, sx] of [[shL, 1], [shR, -1]] as const) {
      mesh(boxGeo(0.2, 0.11, 0.24, REG.acc1, 'center', 0.75, 1), sh, sx * 0.03, 0.03, 0).rotation.z = sx * 0.35;
    }
    mesh(boxGeo(B.abdomen[0] * 1.06, 0.1, B.abdomen[2] * 1.08, REG.belt), spine, 0, 0.02, 0);
    mesh(boxGeo(0.17, 0.09, 0.1, { all: REG.hair }, 'top', 1, 0.6, [2, 1, 1], 0.1), head, 0, 0.07, hd * 0.45);
    mesh(boxGeo(hw * 0.9, 0.035, 0.04, REG.skin), head, 0, hh * 0.66, hd * 0.5);
    for (const side of ['L', 'R'] as const) mesh(limbGeo(0.1, B.arm * 1.05, B.arm * 1.05, REG.acc1, 6), joints[`elbow${side}`], 0, -forearm + 0.12, 0);
  } else if (id === 'rina') {
    const cap = new THREE.Group();
    cap.position.set(0, hh * 0.9 * s, 0);
    head.add(cap);
    mesh(limbGeo(0.07, hw * 0.62, hw * 0.56, REG.acc1, 8, 'bottom'), cap, 0, 0, 0);
    mesh(boxGeo(hw * 0.95, 0.02, 0.1, REG.acc1), cap, 0, 0.0, hd * 0.55);
    const tail = mesh(limbGeo(0.3, 0.045, 0.012, REG.hair, 6, 'top', 0.2), head, 0, hh * 0.62, -hd * 0.48);
    tail.rotation.x = -0.55;
    // 鬓发 + 肩章 + 白色衣领
    for (const sx of [1, -1]) {
      mesh(boxGeo(0.035, 0.13, 0.07, REG.hair, 'top', 1, 0.6), head, sx * hw * 0.47, hh * 0.86, hd * 0.25);
      mesh(boxGeo(0.09, 0.025, 0.11, REG.acc1), chest, sx * B.shoulderW * 0.95, 0.29, 0);
    }
    mesh(boxGeo(B.chest[0] * 0.5, 0.04, B.chest[2] * 0.75, REG.skin, 'center', 0.8, 1), chest, 0, 0.29, 0.01).material = ps1Material({ color: 0xd8dce4 });
    mesh(limbGeo(0.24, B.pelvis[0] * 0.55, B.pelvis[0] * 0.82, REG.acc2, 8), hips, 0, 0.06, 0);
    mesh(boxGeo(B.abdomen[0] * 1.08, 0.05, B.abdomen[2] * 1.12, REG.belt), spine, 0, 0.0, 0);
    // 警棍：手持挂点（显示 / 隐藏），腰间备用警棍
    const batonMat = ps1Material({ color: 0x2b2b33 });
    const tipMat = ps1Material({ color: 0xb8bcc8 });
    batonHand = new THREE.Group();
    joints.handR.add(batonHand);
    batonHand.position.set(0, -0.04 * s, 0.02 * s);
    batonHand.rotation.x = -0.75;
    const bh = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * s, 0.022 * s, 0.56 * s, 6), batonMat);
    bh.position.y = -0.2 * s;
    batonHand.add(bh);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * s, 0.024 * s, 0.04 * s, 6), tipMat);
    tip.position.y = -0.48 * s;
    batonHand.add(tip);
    batonHolster = new THREE.Group();
    hips.add(batonHolster);
    batonHolster.position.set(B.pelvis[0] * 0.55 * s, -0.02 * s, 0.02 * s);
    batonHolster.rotation.z = 0.12;
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * s, 0.022 * s, 0.5 * s, 6), batonMat);
    hb.position.y = -0.18 * s;
    batonHolster.add(hb);
    const cuffs = new THREE.Mesh(new THREE.TorusGeometry(0.035 * s, 0.008 * s, 4, 8), tipMat);
    cuffs.position.set(-B.pelvis[0] * 0.5 * s, -0.04 * s, -0.04 * s);
    cuffs.rotation.y = Math.PI / 2;
    hips.add(cuffs);
  }

  const rest = {} as Record<JointName, THREE.Vector3>;
  for (const j of JOINTS) rest[j] = joints[j].position.clone();

  let triangles = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });

  return {
    root,
    joints,
    rest,
    material: mat,
    scale: s,
    hipsHeight: hipH * s,
    lengths: { upperArm: upperArm * s, forearm: forearm * s, thigh: thigh * s, shin: shin * s },
    ankleHeight: 0.05 * s,
    batonHand,
    batonHolster,
    triangles,
  };
}
