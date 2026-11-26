// 程序化像素贴图生成：场景（地面/围栏/观众/远景）、特效面片、飞行道具。
// 全部使用 Canvas 逐像素绘制 + 15 位色量化 + 最近邻采样，还原 PS1 低分辨率贴图质感。
import * as THREE from 'three';
import { Rng } from '../core/math';
import { drawPixelText, measurePixelText, type PixelTextOptions } from '../ui/PixelFont';

export type RGB = [number, number, number];

export const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
export const css = (c: RGB, a = 1): string =>
  a < 1 ? `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})` : `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const c255 = (v: number) => Math.max(0, Math.min(255, v));
export const shade = (c: RGB, k: number): RGB => [c255(c[0] * k), c255(c[1] * k), c255(c[2] * k)];
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export class PixelCanvas {
  readonly c: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly rng = new Rng(1),
  ) {
    this.c = document.createElement('canvas');
    this.c.width = w;
    this.c.height = h;
    this.g = this.c.getContext('2d', { willReadFrequently: true })!;
    this.g.imageSmoothingEnabled = false;
  }

  fill(col: RGB, a = 1): this {
    return this.rect(0, 0, this.w, this.h, col, a);
  }

  rect(x: number, y: number, w: number, h: number, col: RGB, a = 1): this {
    this.g.fillStyle = css(col, a);
    this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    return this;
  }

  px(x: number, y: number, col: RGB, a = 1): this {
    return this.rect(x, y, 1, 1, col, a);
  }

  /** 颗粒噪点：在 base 颜色上按 amp 做明暗随机 */
  noise(x: number, y: number, w: number, h: number, base: RGB, amp: number, cell = 1): this {
    for (let j = 0; j < h; j += cell) {
      for (let i = 0; i < w; i += cell) {
        const k = 1 + (this.rng.next() - 0.5) * 2 * amp;
        this.rect(x + i, y + j, cell, cell, shade(base, k));
      }
    }
    return this;
  }

  /** 随机斑点 */
  speckle(x: number, y: number, w: number, h: number, col: RGB, count: number, a = 1): this {
    for (let i = 0; i < count; i++) this.px(x + this.rng.int(0, w - 1), y + this.rng.int(0, h - 1), col, a);
    return this;
  }

  circle(cx: number, cy: number, r: number, col: RGB, a = 1): this {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - y * y)));
      this.rect(cx - half, cy + y, half * 2 + 1, 1, col, a);
    }
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, col: RGB, a = 1): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), col, a);
    return this;
  }

  text(str: string, x: number, y: number, o: PixelTextOptions): this {
    drawPixelText(this.g, str, x, y, o);
    return this;
  }

  textCentered(str: string, cx: number, y: number, o: PixelTextOptions): this {
    const w = measurePixelText(str, o.scale ?? 1, o.bold ?? true, o.spacing ?? 1);
    return this.text(str, Math.round(cx - w / 2), y, o);
  }

  /** 逐像素绘制（返回 [r,g,b,a]，a 0..1） */
  shader(fn: (x: number, y: number) => [number, number, number, number]): this {
    const img = this.g.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const [r, g, b, a] = fn(x, y);
        const i = (y * this.w + x) * 4;
        d[i] = c255(r);
        d[i + 1] = c255(g);
        d[i + 2] = c255(b);
        d[i + 3] = c255(a * 255);
      }
    }
    this.g.putImageData(img, 0, 0);
    return this;
  }

  /** 量化为每通道 bits 位（PS1 为 5 位 = 15 位色），alpha 可量化为若干档 */
  quantize(bits = 5, alphaSteps = 0): this {
    const img = this.g.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const q = 255 / ((1 << bits) - 1);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] / q) * q;
      d[i + 1] = Math.round(d[i + 1] / q) * q;
      d[i + 2] = Math.round(d[i + 2] / q) * q;
      if (alphaSteps > 0) {
        const s = 255 / alphaSteps;
        d[i + 3] = Math.round(d[i + 3] / s) * s;
      }
    }
    this.g.putImageData(img, 0, 0);
    return this;
  }

  texture(repeat = false): THREE.CanvasTexture {
    return makeTexture(this.c, repeat);
  }
}

export function makeTexture(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return registerTexture(t);
}

// ------------------------------------------------------------ 贴图质量（PS1 / 高清）

const registry = new Set<THREE.Texture>();
let hdQuality = false;
let maxAnisotropy = 1;

function applyQuality(t: THREE.Texture): void {
  // 放大始终最近邻，保持像素贴图清晰；高清模式缩小时用 mipmap + 各向异性过滤，避免远处闪烁
  const mip = hdQuality && !t.userData.noMip;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.anisotropy = mip ? maxAnisotropy : 1;
  t.needsUpdate = true;
}

/** 登记贴图，切换画面模式时统一更新采样方式 */
export function registerTexture<T extends THREE.Texture>(t: T): T {
  registry.add(t);
  applyQuality(t);
  return t;
}

export function setTextureQuality(hd: boolean, anisotropy: number): void {
  if (hd === hdQuality && anisotropy === maxAnisotropy) return;
  hdQuality = hd;
  maxAnisotropy = Math.max(1, Math.min(8, anisotropy));
  for (const t of registry) applyQuality(t);
}

// ============================================================ 场景贴图

/** 擂台外地面：深灰水泥，颗粒 + 裂纹 + 污渍（256×256 可平铺） */
export function concreteTexture(seed = 3): THREE.CanvasTexture {
  const p = new PixelCanvas(256, 256, new Rng(seed));
  const base = hex(0x3b3f4a);
  p.noise(0, 0, 256, 256, base, 0.12, 2);
  for (let i = 0; i < 14; i++) {
    const x = p.rng.int(0, 255);
    const y = p.rng.int(0, 255);
    p.circle(x, y, p.rng.int(4, 14), shade(base, 0.82), 0.5);
  }
  for (let i = 0; i < 6; i++) {
    let x = p.rng.int(0, 255);
    let y = p.rng.int(0, 255);
    for (let k = 0; k < 40; k++) {
      p.px(x & 255, y & 255, shade(base, 0.6));
      x += p.rng.int(-1, 1);
      y += p.rng.int(0, 1) ? 1 : 0;
    }
  }
  p.speckle(0, 0, 256, 256, shade(base, 1.35), 500);
  return p.quantize(5).texture(true);
}

/** 擂台台面：水泥方砖拼接，砖缝 + 磨损 */
export function ringFloorTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(256, 256, new Rng(11));
  const base = hex(0x6b6e78);
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const k = 0.9 + p.rng.next() * 0.18;
      p.noise(tx * 64, ty * 64, 64, 64, shade(base, k), 0.07, 2);
      p.rect(tx * 64, ty * 64, 64, 2, shade(base, 0.55));
      p.rect(tx * 64, ty * 64, 2, 64, shade(base, 0.55));
      p.rect(tx * 64 + 2, ty * 64 + 2, 60, 1, shade(base, 1.15));
    }
  }
  for (let i = 0; i < 30; i++) p.circle(p.rng.int(0, 255), p.rng.int(0, 255), p.rng.int(2, 6), shade(base, 0.75), 0.35);
  p.speckle(0, 0, 256, 256, shade(base, 1.3), 400);
  return p.quantize(5).texture(true);
}

/** 擂台中心徽标（透明） */
export function emblemTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(128, 128);
  const red = hex(0xb3222a);
  const gold = hex(0xe8b440);
  p.shader((x, y) => {
    const d = Math.hypot(x - 63.5, y - 63.5);
    if (d < 62 && d > 55) return [...gold, 0.9];
    if (d <= 55 && d > 51) return [...red, 0.75];
    if (d <= 51) return [...shade(red, 0.75), 0.35];
    return [0, 0, 0, 0];
  });
  p.textCentered('WT', 64, 44, { scale: 5, gradient: ['#ffe08a', '#d8901c'], outline: '#3a0b0b' });
  return p.quantize(5, 4).texture();
}

/** 红白警示边界线 */
export function stripeTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(64, 16);
  p.shader((x, y) => {
    const s = Math.floor((x + y) / 8) % 2 === 0;
    const col = s ? hex(0xc8262c) : hex(0xe9e2d0);
    return [...col, 1];
  });
  p.rect(0, 0, 64, 1, hex(0x5a0d10)).rect(0, 15, 64, 1, hex(0x5a0d10));
  return p.quantize(5).texture(true);
}

/** 铁丝网围栏（透明，alphaTest 镂空） */
export function fenceTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(64, 64);
  const wire = hex(0x7d8aa3);
  p.shader((x, y) => {
    const a = (x + y) % 16;
    const b = (x - y + 64) % 16;
    if (a === 0 || b === 0) return [...shade(wire, 0.9 + ((x * 7 + y * 3) % 5) * 0.05), 1];
    if (a === 1 || b === 1) return [...shade(wire, 0.55), 1];
    return [0, 0, 0, 0];
  });
  const t = p.quantize(5, 1).texture(true);
  t.userData.noMip = true;
  return registerTexture(t);
}

/** 深蓝金属（围栏立柱 / 横梁） */
export function metalTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(64, 64, new Rng(5));
  const base = hex(0x263553);
  p.noise(0, 0, 64, 64, base, 0.08, 2);
  for (let y = 0; y < 64; y += 16) p.rect(0, y, 64, 2, shade(base, 1.5));
  for (let i = 0; i < 12; i++) p.circle(p.rng.int(0, 63), p.rng.int(0, 63), 1, shade(base, 1.8));
  p.speckle(0, 0, 64, 64, hex(0x6b3b22), 40);
  return p.quantize(5).texture(true);
}

/** 观众席（像素人群剪影，带闪光灯亮点） */
export function crowdTexture(seed = 21): THREE.CanvasTexture {
  const p = new PixelCanvas(256, 128, new Rng(seed));
  p.fill(hex(0x0d0f1a));
  const shirts: RGB[] = [hex(0x5a2632), hex(0x24395a), hex(0x3a4a2a), hex(0x5a4a2a), hex(0x44284f), hex(0x2c2c35), hex(0x6b5a40)];
  const skins: RGB[] = [hex(0xc49a7a), hex(0x8a6448), hex(0xe0b896), hex(0x5d3f2c)];
  for (let row = 0; row < 4; row++) {
    const y0 = 10 + row * 30;
    const k = 0.55 + row * 0.15;
    for (let x = -4; x < 256; x += 9 + p.rng.int(0, 3)) {
      const shirt = shade(p.rng.pick(shirts), k);
      const skin = shade(p.rng.pick(skins), k);
      const bob = p.rng.int(0, 3);
      p.rect(x, y0 + 12 + bob, 9, 18, shirt);
      p.rect(x + 2, y0 + 4 + bob, 5, 7, skin);
      p.rect(x + 2, y0 + 3 + bob, 5, 2, shade(hex(0x1c140e), k));
      if (p.rng.chance(0.25)) p.rect(x - 1 + p.rng.int(0, 1) * 9, y0 + 2 + bob, 2, 10, skin); // 举手
    }
    p.rect(0, y0 + 28, 256, 2, hex(0x1b2238));
  }
  for (let i = 0; i < 26; i++) p.px(p.rng.int(0, 255), p.rng.int(0, 127), hex(0xffffff));
  return p.quantize(5).texture(true);
}

/** 远景：夜空渐变 + 远山 + 城市剪影与灯光窗户（512×256） */
export function skylineTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(512, 256, new Rng(42));
  const top = hex(0x05060f);
  const bottom = hex(0x2a1d3d);
  p.shader((_x, y) => {
    const t = y / 255;
    const c = mixRGB(top, bottom, t * t);
    return [...c, 1];
  });
  for (let i = 0; i < 90; i++) p.px(p.rng.int(0, 511), p.rng.int(0, 120), hex(p.rng.chance(0.3) ? 0xfff2c0 : 0x9aa6d8));
  p.circle(410, 56, 14, hex(0xe8e0c0));
  p.circle(404, 52, 12, hex(0x1a1530), 0.4);
  // 远山
  let h = 170;
  for (let x = 0; x < 512; x++) {
    h += p.rng.int(-2, 2);
    h = Math.max(140, Math.min(190, h));
    p.rect(x, h, 1, 256 - h, hex(0x1c1830));
  }
  // 城市剪影
  for (let x = 0; x < 512; ) {
    const w = p.rng.int(12, 34);
    const bh = p.rng.int(30, 90);
    const y = 256 - bh;
    p.rect(x, y, w, bh, hex(0x0e0c1a));
    for (let wy = y + 4; wy < 250; wy += 6) {
      for (let wx = x + 3; wx < x + w - 2; wx += 5) {
        if (p.rng.chance(0.28)) p.rect(wx, wy, 2, 3, hex(p.rng.chance(0.7) ? 0xe8c060 : 0x7fb0e0));
      }
    }
    x += w + p.rng.int(0, 4);
  }
  return p.quantize(5).texture();
}

/** 场馆立柱 */
export function pillarTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(64, 128, new Rng(8));
  const base = hex(0x4a4d5a);
  p.noise(0, 0, 64, 128, base, 0.1, 2);
  for (let y = 0; y < 128; y += 32) {
    p.rect(0, y, 64, 3, shade(base, 0.6));
    p.rect(0, y + 3, 64, 1, shade(base, 1.3));
  }
  p.rect(0, 100, 64, 10, hex(0xd2a02a)).rect(0, 103, 64, 4, hex(0x1a1a1a));
  return p.quantize(5).texture(true);
}

/** 场馆横幅 */
export function bannerTexture(text: string, bg: number, fg: [string, string]): THREE.CanvasTexture {
  const p = new PixelCanvas(256, 48, new Rng(2));
  const b = hex(bg);
  p.noise(0, 0, 256, 48, b, 0.05, 2);
  p.rect(0, 0, 256, 3, shade(b, 1.6)).rect(0, 45, 256, 3, shade(b, 0.5));
  p.textCentered(text, 128, 10, { scale: 4, gradient: fg, outline: '#120a08' });
  return p.quantize(5).texture();
}

/** 聚光灯光柱（加法混合） */
export function beamTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(32, 64);
  p.shader((x, y) => {
    const edge = 1 - Math.abs(x - 15.5) / 16;
    const a = Math.max(0, edge) ** 1.5 * (1 - y / 64) * 0.55;
    return [255, 236, 190, Math.round(a * 6) / 6];
  });
  return p.texture();
}

// ============================================================ 特效贴图（128×128，透明像素风）

function radial(size: number, fn: (d: number, ang: number, x: number, y: number) => [number, number, number, number]): PixelCanvas {
  const p = new PixelCanvas(size, size);
  const c = (size - 1) / 2;
  p.shader((x, y) => fn(Math.hypot(x - c, y - c) / c, Math.atan2(y - c, x - c), x, y));
  return p;
}

/** 命中火花：8 角星爆 */
export function sparkTexture(core: RGB, edge: RGB): THREE.CanvasTexture {
  return radial(64, (d, ang) => {
    const spikes = Math.pow(Math.abs(Math.cos(ang * 4)), 12);
    const r = 0.28 + spikes * 0.7;
    if (d > r) return [0, 0, 0, 0];
    const t = d / r;
    const c = mixRGB(core, edge, t);
    return [...c, t > 0.8 ? 0.6 : 1];
  })
    .quantize(5, 3)
    .texture();
}

/** 爆闪 / 圆形光晕 */
export function flashTexture(core: RGB, edge: RGB): THREE.CanvasTexture {
  return radial(64, (d) => {
    if (d > 1) return [0, 0, 0, 0];
    const c = mixRGB(core, edge, d);
    return [...c, Math.round((1 - d) ** 1.4 * 4) / 4];
  })
    .quantize(5)
    .texture();
}

/** 圆环（地面光圈 / 冲击环 / 胜利光环） */
export function ringTexture(col: RGB, width = 0.16): THREE.CanvasTexture {
  return radial(128, (d) => {
    const w = Math.abs(d - (1 - width));
    if (w > width) return [0, 0, 0, 0];
    const k = 1 - w / width;
    return [...mixRGB(shade(col, 0.6), [255, 255, 255], k * 0.6), Math.round(k * 3) / 3];
  }).texture();
}

/** 烟尘 */
export function dustTexture(): THREE.CanvasTexture {
  const rng = new Rng(9);
  const blobs = Array.from({ length: 7 }, () => [rng.range(-0.4, 0.4), rng.range(-0.3, 0.4), rng.range(0.3, 0.55)]);
  return radial(64, (_d, _a, x, y) => {
    const u = (x - 31.5) / 32;
    const v = (y - 31.5) / 32;
    let a = 0;
    for (const [bx, by, br] of blobs) a = Math.max(a, 1 - Math.hypot(u - bx, v - by) / br);
    if (a <= 0) return [0, 0, 0, 0];
    const c = mixRGB(hex(0x8d8a86), hex(0xd0cbc0), a);
    return [...c, a > 0.5 ? 0.85 : 0.45];
  })
    .quantize(5)
    .texture();
}

/** 能量球：冲击波（橙红）/ 电击弹（蓝）/ 闪光弹（白黄）/ 重炮拳（红） */
export function orbTexture(kind: 'shockwave' | 'shock' | 'flash' | 'cannon'): THREE.CanvasTexture {
  const rng = new Rng(kind.length * 13);
  const pal: Record<string, [RGB, RGB, RGB]> = {
    shockwave: [hex(0xfff3c0), hex(0xff8a2a), hex(0xc0281e)],
    shock: [hex(0xf0ffff), hex(0x58c8ff), hex(0x1a3cc0)],
    flash: [hex(0xffffff), hex(0xfff08a), hex(0xd0a020)],
    cannon: [hex(0xffd0b0), hex(0xff3a2a), hex(0x6a0a10)],
  };
  const [c0, c1, c2] = pal[kind];
  const arcs = Array.from({ length: 6 }, () => rng.range(0, Math.PI * 2));
  return radial(128, (d, ang) => {
    let a = 0;
    let col: RGB = c2;
    if (d < 0.38) {
      col = mixRGB(c0, c1, d / 0.38);
      a = 1;
    } else if (d < 0.75) {
      const swirl = Math.sin(ang * 5 + d * 14) * 0.5 + 0.5;
      col = mixRGB(c1, c2, (d - 0.38) / 0.37);
      a = swirl > 0.35 ? 0.85 : 0.45;
    } else if (d < 1) {
      a = (1 - d) * 1.6 * (Math.sin(ang * 9) * 0.5 + 0.5);
      col = c2;
    }
    if (kind === 'shock' && d < 1) {
      for (const base of arcs) {
        const jag = base + Math.sin(d * 30 + base * 7) * 0.12;
        if (Math.abs(((ang - jag + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.06 && d > 0.3) {
          col = c0;
          a = 1;
        }
      }
    }
    return [...col, Math.min(1, Math.round(a * 4) / 4)];
  })
    .quantize(5)
    .texture();
}

/** 拖尾（横向渐隐长条） */
export function trailTexture(col: RGB): THREE.CanvasTexture {
  const p = new PixelCanvas(64, 16);
  p.shader((x, y) => {
    const t = x / 63;
    const v = 1 - Math.abs(y - 7.5) / 8;
    const a = t * v;
    return [...mixRGB(col, [255, 255, 255], v * 0.5), Math.round(a * 4) / 4];
  });
  return p.quantize(5).texture();
}

/** 小方块粒子 / 闪烁星 */
export function squareTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(8, 8);
  p.fill([255, 255, 255]);
  return p.texture();
}

export function starTexture(): THREE.CanvasTexture {
  const p = new PixelCanvas(16, 16);
  const w: RGB = [255, 255, 255];
  p.rect(7, 0, 2, 16, w, 0.9).rect(0, 7, 16, 2, w, 0.9).rect(5, 5, 6, 6, w);
  return p.texture();
}
