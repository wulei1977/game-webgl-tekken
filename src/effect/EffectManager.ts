// 特效管理器：全部为朝向镜头的 Billboard 面片（低像素贴图）+ 少量地面光圈
// 命中火花、重击闪光、格挡火花、Counter、浮空尘土、下段地面光圈、飞行道具拖尾与爆炸、KO 爆闪、胜利光环
import * as THREE from 'three';
import type { ProjectileKind, Vec3Like } from '../core/types';
import {
  dustTexture,
  flashTexture,
  hex,
  orbTexture,
  ringTexture,
  sparkTexture,
  squareTexture,
  starTexture,
  trailTexture,
} from '../render/TextureFactory';

interface Fx {
  obj: THREE.Sprite | THREE.Mesh;
  life: number;
  max: number;
  vel: THREE.Vector3;
  gravity: number;
  size0: number;
  size1: number;
  alpha0: number;
  spin: number;
  flat: boolean;
}

type TexKey =
  | 'spark' | 'sparkBlue' | 'sparkRed' | 'flash' | 'flashBlue' | 'ring' | 'ringRed' | 'ringGold' | 'ringBlue'
  | 'dust' | 'square' | 'star' | 'trailOrange' | 'trailBlue' | 'trailWhite' | 'trailRed'
  | 'orbShockwave' | 'orbShock' | 'orbFlash' | 'orbCannon';

export class EffectManager {
  private fx: Fx[] = [];
  private tex: Record<TexKey, THREE.Texture>;
  private ringGeo = new THREE.PlaneGeometry(1, 1);

  constructor(private scene: THREE.Scene) {
    this.tex = {
      spark: sparkTexture(hex(0xffffff), hex(0xffb020)),
      sparkBlue: sparkTexture(hex(0xffffff), hex(0x40a0ff)),
      sparkRed: sparkTexture(hex(0xffffe0), hex(0xff3020)),
      flash: flashTexture(hex(0xffffff), hex(0xffc040)),
      flashBlue: flashTexture(hex(0xffffff), hex(0x60b0ff)),
      ring: ringTexture(hex(0xffffff)),
      ringRed: ringTexture(hex(0xff4030)),
      ringGold: ringTexture(hex(0xffd040), 0.12),
      ringBlue: ringTexture(hex(0x60c0ff)),
      dust: dustTexture(),
      square: squareTexture(),
      star: starTexture(),
      trailOrange: trailTexture(hex(0xff8a2a)),
      trailBlue: trailTexture(hex(0x50c0ff)),
      trailWhite: trailTexture(hex(0xfff0a0)),
      trailRed: trailTexture(hex(0xff3020)),
      orbShockwave: orbTexture('shockwave'),
      orbShock: orbTexture('shock'),
      orbFlash: orbTexture('flash'),
      orbCannon: orbTexture('cannon'),
    };
  }

  texture(key: TexKey): THREE.Texture {
    return this.tex[key];
  }

  private sprite(
    key: TexKey,
    pos: Vec3Like,
    size0: number,
    size1: number,
    life: number,
    o: { additive?: boolean; color?: number; alpha?: number; vel?: THREE.Vector3; gravity?: number; spin?: number; rot?: number } = {},
  ): Fx {
    const mat = new THREE.SpriteMaterial({
      map: this.tex[key],
      color: o.color ?? 0xffffff,
      transparent: true,
      depthWrite: false,
      blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      rotation: o.rot ?? Math.random() * Math.PI * 2,
      opacity: o.alpha ?? 1,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(pos.x, pos.y, pos.z);
    s.scale.setScalar(size0);
    s.renderOrder = 5;
    this.scene.add(s);
    const fx: Fx = { obj: s, life, max: life, vel: o.vel ?? new THREE.Vector3(), gravity: o.gravity ?? 0, size0, size1, alpha0: o.alpha ?? 1, spin: o.spin ?? 0, flat: false };
    this.fx.push(fx);
    return fx;
  }

  private groundRing(key: TexKey, pos: Vec3Like, size0: number, size1: number, life: number): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex[key], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, 0.03, pos.z);
    m.scale.setScalar(size0);
    this.scene.add(m);
    this.fx.push({ obj: m, life, max: life, vel: new THREE.Vector3(), gravity: 0, size0, size1, alpha0: 1, spin: 0, flat: true });
  }

  private debris(pos: Vec3Like, n: number, color: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      this.sprite('square', pos, 0.05, 0.03, 14 + Math.random() * 10, { color, vel: v, gravity: 0.004, rot: 0 });
    }
  }

  hit(pos: Vec3Like, heavy: boolean, counter: boolean, weapon: boolean): void {
    const key: TexKey = counter ? 'sparkRed' : 'spark';
    this.sprite(key, pos, heavy ? 0.5 : 0.35, heavy ? 1.1 : 0.7, heavy ? 12 : 9, { spin: 0.2 });
    this.sprite('flash', pos, 0.3, heavy ? 1.4 : 0.8, heavy ? 8 : 6, { alpha: 0.9 });
    if (heavy) this.sprite('ring', pos, 0.3, 1.6, 10, { alpha: 0.8 });
    this.debris(pos, heavy ? 10 : 5, counter ? 0xff6040 : weapon ? 0xc0e0ff : 0xffd060, heavy ? 0.06 : 0.04);
  }

  block(pos: Vec3Like): void {
    this.sprite('sparkBlue', pos, 0.3, 0.6, 8, { spin: 0.3 });
    this.sprite('flashBlue', pos, 0.2, 0.55, 6, { alpha: 0.7 });
    this.debris(pos, 4, 0x80c0ff, 0.035);
  }

  guardBreak(pos: Vec3Like): void {
    this.sprite('ringBlue', pos, 0.3, 2.2, 16);
    this.sprite('flashBlue', pos, 0.6, 1.6, 12);
    this.debris(pos, 14, 0x9fd0ff, 0.07);
  }

  armor(pos: Vec3Like): void {
    this.sprite('ringRed', pos, 0.4, 1.4, 10);
  }

  lowRing(pos: Vec3Like): void {
    this.groundRing('ringGold', pos, 0.3, 1.6, 14);
  }

  dust(pos: Vec3Like, big: boolean): void {
    const n = big ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * 0.02, 0.006, Math.sin(a) * 0.02);
      this.sprite('dust', { x: pos.x, y: 0.15, z: pos.z }, big ? 0.5 : 0.35, big ? 1.1 : 0.7, 22, { additive: false, alpha: 0.7, vel: v });
    }
    if (big) this.groundRing('ring', pos, 0.4, 2.2, 14);
  }

  throwImpact(pos: Vec3Like): void {
    this.dust(pos, true);
    this.sprite('flash', { x: pos.x, y: 0.5, z: pos.z }, 0.5, 1.8, 10, { alpha: 0.8 });
  }

  throwBreak(pos: Vec3Like): void {
    this.sprite('flashBlue', pos, 0.4, 1.2, 10);
    this.sprite('star', pos, 0.4, 0.9, 12, { spin: 0.25 });
  }

  clash(pos: Vec3Like): void {
    this.sprite('flash', pos, 0.5, 1.5, 10);
    this.sprite('ring', pos, 0.4, 1.8, 12);
    this.debris(pos, 10, 0xffffff, 0.06);
  }

  projectileTrail(kind: ProjectileKind, pos: Vec3Like): void {
    const key: TexKey = kind === 'shock' ? 'orbShock' : kind === 'flash' ? 'orbFlash' : kind === 'cannon' ? 'orbCannon' : 'orbShockwave';
    const size = kind === 'cannon' ? 0.9 : kind === 'flash' ? 0.25 : 0.5;
    this.sprite(key, pos, size, size * 0.3, 10, { alpha: 0.55 });
  }

  projectileEnd(kind: ProjectileKind, pos: Vec3Like): void {
    if (kind === 'flash') {
      this.sprite('flash', pos, 0.6, 3.2, 16);
      this.sprite('ring', pos, 0.5, 2.6, 14);
      this.debris(pos, 12, 0xffffc0, 0.07);
      return;
    }
    const ring: TexKey = kind === 'shock' ? 'ringBlue' : kind === 'cannon' ? 'ringRed' : 'ring';
    const flash: TexKey = kind === 'shock' ? 'flashBlue' : 'flash';
    this.sprite(flash, pos, 0.5, kind === 'cannon' ? 2.4 : 1.4, 12);
    this.sprite(ring, pos, 0.4, kind === 'cannon' ? 2.6 : 1.6, 14);
    this.debris(pos, kind === 'cannon' ? 14 : 8, kind === 'shock' ? 0x80d0ff : 0xff9040, 0.06);
  }

  koFlash(pos: Vec3Like): void {
    this.sprite('flash', pos, 1, 6, 24, { alpha: 1 });
    this.sprite('sparkRed', pos, 1, 3.5, 20, { spin: 0.1 });
    this.sprite('ring', pos, 0.6, 5, 24);
  }

  victoryRing(pos: Vec3Like): void {
    this.groundRing('ringGold', pos, 0.6, 3.2, 40);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const p = { x: pos.x + Math.cos(a) * 0.6, y: 0.2, z: pos.z + Math.sin(a) * 0.6 };
      this.sprite('star', p, 0.15, 0.05, 40 + i * 3, { vel: new THREE.Vector3(0, 0.03, 0), spin: 0.1, color: 0xffe080 });
    }
  }

  update(dt: number): void {
    for (const f of this.fx) {
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / f.max;
      const size = f.size0 + (f.size1 - f.size0) * Math.sqrt(t);
      f.vel.y -= f.gravity * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      if (f.flat) {
        f.obj.scale.set(size, size, size);
        (f.obj.material as THREE.MeshBasicMaterial).opacity = f.alpha0 * (1 - t);
      } else {
        f.obj.scale.setScalar(size);
        const m = f.obj.material as THREE.SpriteMaterial;
        m.opacity = f.alpha0 * (1 - t * t);
        m.rotation += f.spin * dt;
      }
    }
    const dead = this.fx.filter((f) => f.life <= 0);
    for (const f of dead) {
      this.scene.remove(f.obj);
      (f.obj.material as THREE.Material).dispose();
    }
    if (dead.length) this.fx = this.fx.filter((f) => f.life > 0);
  }

  clear(): void {
    for (const f of this.fx) {
      this.scene.remove(f.obj);
      (f.obj.material as THREE.Material).dispose();
    }
    this.fx = [];
  }
}
