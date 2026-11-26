// 飞行道具渲染：低模核心 + 面片光晕 + 拖尾（面片与小型 3D 模型组合）
import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { ProjectileKind } from '../core/types';
import type { EffectManager } from '../effect/EffectManager';
import type { Projectile } from './ProjectileManager';

interface Visual {
  group: THREE.Group;
  core: THREE.Object3D;
  glow: THREE.Sprite;
  arcs: THREE.LineSegments | null;
  kind: ProjectileKind;
}

const COLORS: Record<ProjectileKind, number> = { shockwave: 0xff7a20, shock: 0x50c8ff, flash: 0xfff4a0, cannon: 0xff2a20 };

export class ProjectileView {
  private visuals = new Map<number, Visual>();

  constructor(
    private scene: THREE.Scene,
    private effects: EffectManager,
  ) {}

  private create(p: Projectile): Visual {
    const kind = p.def.kind;
    const group = new THREE.Group();
    const add = (o: THREE.Object3D) => {
      group.add(o);
      return o;
    };
    const basic = (color: number, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    let core: THREE.Object3D;
    if (kind === 'shockwave') {
      core = add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 4, 10), basic(0xffa040, 0.9)));
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), basic(0xfff0c0)));
    } else if (kind === 'cannon') {
      core = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), basic(0xff3020, 0.85)));
      add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), basic(0xffd0a0)));
    } else if (kind === 'flash') {
      core = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), new THREE.MeshBasicMaterial({ color: 0xd8d8d0 })));
    } else {
      core = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), basic(0xe0ffff)));
    }
    const tex = kind === 'shock' ? 'orbShock' : kind === 'flash' ? 'orbFlash' : kind === 'cannon' ? 'orbCannon' : 'orbShockwave';
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.effects.texture(tex), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.scale.setScalar(kind === 'cannon' ? 1.5 : kind === 'flash' ? 0.45 : 0.85);
    group.add(glow);
    let arcs: THREE.LineSegments | null = null;
    if (kind === 'shock') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 2 * 3), 3));
      arcs = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc8f4ff, transparent: true, blending: THREE.AdditiveBlending }));
      group.add(arcs);
    }
    this.scene.add(group);
    return { group, core, glow, arcs, kind };
  }

  sync(game: Game): void {
    const alive = new Set<number>();
    for (const p of game.projectiles.list) {
      if (!p.alive) continue;
      alive.add(p.id);
      let v = this.visuals.get(p.id);
      if (!v) {
        v = this.create(p);
        this.visuals.set(p.id, v);
      }
      v.group.position.copy(p.pos);
      v.group.lookAt(p.pos.x + p.dir.x, p.pos.y, p.pos.z + p.dir.z);
      const t = game.simFrame;
      if (v.kind === 'shockwave') v.core.rotation.z = t * 0.4;
      else v.core.rotation.set(t * 0.21, t * 0.33, 0);
      (v.glow.material as THREE.SpriteMaterial).rotation = t * 0.15;
      if (v.arcs) this.updateArcs(v.arcs);
      if (t % 2 === 0) this.effects.projectileTrail(v.kind, { x: p.pos.x - p.dir.x * 0.15, y: p.pos.y, z: p.pos.z - p.dir.z * 0.15 });
    }
    for (const [id, v] of this.visuals) {
      if (!alive.has(id)) {
        this.scene.remove(v.group);
        this.visuals.delete(id);
      }
    }
  }

  /** 电击弹：随机折线电弧 */
  private updateArcs(lines: THREE.LineSegments): void {
    const pos = lines.geometry.attributes.position as THREE.BufferAttribute;
    let i = 0;
    for (let a = 0; a < 4; a++) {
      let x = 0;
      let y = 0;
      let z = 0;
      const ang = Math.random() * Math.PI * 2;
      for (let k = 0; k < 4; k++) {
        const nx = x + Math.cos(ang) * 0.09 + (Math.random() - 0.5) * 0.1;
        const ny = y + Math.sin(ang) * 0.09 + (Math.random() - 0.5) * 0.1;
        const nz = z + (Math.random() - 0.5) * 0.15;
        pos.setXYZ(i++, x, y, z);
        pos.setXYZ(i++, nx, ny, nz);
        x = nx;
        y = ny;
        z = nz;
      }
    }
    pos.needsUpdate = true;
  }

  clear(): void {
    for (const v of this.visuals.values()) this.scene.remove(v.group);
    this.visuals.clear();
  }

  static color(kind: ProjectileKind): number {
    return COLORS[kind];
  }
}
