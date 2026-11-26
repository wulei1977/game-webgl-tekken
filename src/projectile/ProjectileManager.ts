// 飞行道具管理器（逻辑）：独立实体，带速度、生命周期、攻击判定；可被格挡、侧移躲开、对消或被特定招式打掉
import { Vector3 } from 'three';
import type { Fighter } from '../actor/Fighter';
import { activeAttackSphere, bodyCapsules, sphereVsBody, spheresOverlap } from '../core/CollisionSystem';
import { forwardOf } from '../core/math';
import type { ProjectileDef } from '../core/types';

export class Projectile {
  alive = true;
  age = 0;
  readonly pos = new Vector3();
  readonly dir = new Vector3();
  constructor(
    readonly id: number,
    readonly owner: Fighter,
    readonly def: ProjectileDef,
  ) {}
}

export interface ProjectileHost {
  readonly config: { arenaRadius: number };
  projectileHit(p: Projectile, target: Fighter): void;
  projectileEnd(p: Projectile, reason: 'hit' | 'block' | 'clash' | 'expire'): void;
}

export class ProjectileManager {
  list: Projectile[] = [];
  private nextId = 1;

  spawn(owner: Fighter, def: ProjectileDef): Projectile {
    const p = new Projectile(this.nextId++, owner, def);
    forwardOf(owner.facing, p.dir);
    p.pos.set(owner.pos.x + p.dir.x * 0.55, def.height, owner.pos.z + p.dir.z * 0.55);
    this.list.push(p);
    return p;
  }

  has(owner: Fighter): boolean {
    return this.list.some((p) => p.alive && p.owner === owner);
  }

  clear(): void {
    this.list = [];
  }

  update(host: ProjectileHost, fighters: Fighter[]): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age++;
      p.pos.addScaledVector(p.dir, p.def.speed);
      const out = Math.hypot(p.pos.x, p.pos.z) > host.config.arenaRadius + 4;
      if (p.age >= p.def.lifetime || out) {
        // 闪光弹：生命周期结束时爆炸，范围内的对手也会被击中
        if (p.def.explodeRadius > 0 && !out) {
          const target = p.owner.opponent;
          const zone = sphereVsBody({ center: p.pos, radius: p.def.explodeRadius }, bodyCapsules(target));
          if (zone && target.isHittable() && !target.isLying()) {
            host.projectileHit(p, target);
            continue;
          }
        }
        p.alive = false;
        host.projectileEnd(p, 'expire');
      }
    }

    // 飞行道具互相抵消
    const live = this.list.filter((p) => p.alive);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        if (!a.alive || !b.alive || a.owner === b.owner) continue;
        if (spheresOverlap(a.pos, a.def.radius, b.pos, b.def.radius)) {
          a.alive = false;
          b.alive = false;
          host.projectileEnd(a, 'clash');
          host.projectileEnd(b, 'clash');
        }
      }
    }

    for (const p of this.list) {
      if (!p.alive) continue;
      const target = p.owner.opponent;
      // 部分招式（重拳、肘击、警棍）的攻击盒可以打掉飞行道具
      for (const f of fighters) {
        if (f === p.owner || !f.move?.clashesProjectiles) continue;
        const s = activeAttackSphere(f);
        if (s && spheresOverlap(s.center, s.radius, p.pos, p.def.radius)) {
          p.alive = false;
          host.projectileEnd(p, 'clash');
        }
      }
      if (!p.alive) continue;
      if (!target.isHittable() || target.isLying()) continue;
      if (p.def.level === 'high' && target.isCrouching() && !target.isAirborne()) continue;
      const zone = sphereVsBody({ center: p.pos, radius: p.def.radius }, bodyCapsules(target));
      if (zone) host.projectileHit(p, target);
    }
    this.list = this.list.filter((p) => p.alive);
  }
}
