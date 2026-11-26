// 判定框可视化（练习模式）：受击盒按上/中/下段着色，攻击盒为品红色，飞行道具为橙色
import * as THREE from 'three';
import { activeAttackSphere, bodyCapsules, moveSphere, type BodyCapsule } from '../core/CollisionSystem';
import type { Game } from '../core/Game';

export class HitboxDebugView {
  readonly group = new THREE.Group();
  visible = false;
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private pool: THREE.Mesh[] = [];
  private used = 0;
  private mats = {
    high: new THREE.MeshBasicMaterial({ color: 0xff4040, wireframe: true, transparent: true, opacity: 0.7, depthTest: false }),
    mid: new THREE.MeshBasicMaterial({ color: 0xffd040, wireframe: true, transparent: true, opacity: 0.7, depthTest: false }),
    low: new THREE.MeshBasicMaterial({ color: 0x40a0ff, wireframe: true, transparent: true, opacity: 0.7, depthTest: false }),
    attack: new THREE.MeshBasicMaterial({ color: 0xff30ff, transparent: true, opacity: 0.55, depthTest: false }),
    pending: new THREE.MeshBasicMaterial({ color: 0xff30ff, wireframe: true, transparent: true, opacity: 0.35, depthTest: false }),
    projectile: new THREE.MeshBasicMaterial({ color: 0xff8020, transparent: true, opacity: 0.5, depthTest: false }),
  };
  private up = new THREE.Vector3(0, 1, 0);
  private dir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 10;
    scene.add(this.group);
  }

  private geo(kind: 'cap' | 'sph', r: number, len = 0): THREE.BufferGeometry {
    const key = `${kind}|${r.toFixed(3)}|${len.toFixed(3)}`;
    let g = this.geoCache.get(key);
    if (!g) {
      g = kind === 'cap' ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 8) : new THREE.SphereGeometry(r, 10, 6);
      this.geoCache.set(key, g);
    }
    return g;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    let m = this.pool[this.used];
    if (!m) {
      m = new THREE.Mesh(geo, mat);
      m.renderOrder = 10;
      this.pool.push(m);
      this.group.add(m);
    }
    m.geometry = geo;
    m.material = mat;
    m.visible = true;
    m.quaternion.identity();
    this.used++;
    return m;
  }

  private capsule(c: BodyCapsule): void {
    this.dir.subVectors(c.b, c.a);
    const len = this.dir.length();
    const m = this.mesh(this.geo('cap', c.radius, len), this.mats[c.zone]);
    m.position.copy(c.a).lerp(c.b, 0.5);
    if (len > 1e-4) m.quaternion.setFromUnitVectors(this.up, this.dir.normalize());
  }

  update(game: Game): void {
    this.used = 0;
    if (this.visible) {
      for (const f of game.fighters) {
        for (const c of bodyCapsules(f)) this.capsule(c);
        const s = activeAttackSphere(f);
        if (s) {
          this.mesh(this.geo('sph', s.radius), this.mats.attack).position.copy(s.center);
        } else if (f.sm.is('attack') && f.move?.hitbox && f.moveFrame < f.move.startup) {
          const p = moveSphere(f, f.move);
          if (p) this.mesh(this.geo('sph', p.radius), this.mats.pending).position.copy(p.center);
        }
      }
      for (const p of game.projectiles.list) {
        if (p.alive) this.mesh(this.geo('sph', p.def.radius), this.mats.projectile).position.copy(p.pos);
      }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }
}
