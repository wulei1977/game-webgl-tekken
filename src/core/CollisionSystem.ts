// 碰撞系统：攻击盒（招式激活时生成的球体）与受击盒（按上/中/下段分区的胶囊体）
// 战斗判定完全使用这里的逻辑体积，与渲染模型无关，避免低模穿模影响判定。
import { Vector3 } from 'three';
import type { Fighter } from '../actor/Fighter';
import type { BodyZone, MoveDef } from './types';
import { clamp, distSqPointSegment, forwardOf, leftOf } from './math';

export interface AttackSphere {
  center: Vector3;
  radius: number;
}

export interface BodyCapsule {
  a: Vector3;
  b: Vector3;
  radius: number;
  zone: BodyZone;
}

const tmpF = new Vector3();
const tmpL = new Vector3();

/** 招式攻击盒在世界空间的位置（不判断是否处于判定帧） */
export function moveSphere(f: Fighter, move: MoveDef, out = new Vector3()): AttackSphere | null {
  const hb = move.hitbox;
  if (!hb) return null;
  forwardOf(f.facing, tmpF);
  leftOf(f.facing, tmpL);
  out.set(
    f.pos.x + tmpF.x * hb.reach + tmpL.x * hb.lateral,
    f.pos.y + hb.height,
    f.pos.z + tmpF.z * hb.reach + tmpL.z * hb.lateral,
  );
  return { center: out, radius: hb.radius };
}

/** 当前帧生效的攻击盒；不在判定帧或已命中则返回 null */
export function activeAttackSphere(f: Fighter): AttackSphere | null {
  const m = f.move;
  if (!m || !f.sm.is('attack')) return null;
  if (m.level !== 'high' && m.level !== 'mid' && m.level !== 'low') return null;
  if (f.moveFrame < m.startup || f.moveFrame > m.activeEnd || f.moveConnected) return null;
  return moveSphere(f, m);
}

function cap(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, zone: BodyZone): BodyCapsule {
  return { a: new Vector3(ax, ay, az), b: new Vector3(bx, by, bz), radius: r, zone };
}

/** 角色受击盒：站立 3 段、下蹲 2 段、浮空 1 段、倒地为水平胶囊 */
export function bodyCapsules(f: Fighter): BodyCapsule[] {
  const { x, y, z } = f.pos;
  const r = f.stats.hurtRadius;
  if (f.isLying()) {
    forwardOf(f.facing, tmpF);
    return [cap(x - tmpF.x * 0.85, 0.18, z - tmpF.z * 0.85, x + tmpF.x * 0.75, 0.18, z + tmpF.z * 0.75, 0.22, 'low')];
  }
  if (f.sm.is('juggle')) {
    return [cap(x, y + 0.05, z, x, y + 0.85, z, r + 0.12, 'mid')];
  }
  if (f.isCrouching()) {
    const c = f.stats.crouchHeight;
    return [
      cap(x, y + 0.05, z, x, y + c * 0.45, z, r, 'low'),
      cap(x, y + c * 0.45, z, x, y + c - r * 0.5, z, r, 'mid'),
    ];
  }
  const h = f.stats.height;
  return [
    cap(x, y + 0.05, z, x, y + h * 0.38, z, r * 0.9, 'low'),
    cap(x, y + h * 0.38, z, x, y + h * 0.7, z, r, 'mid'),
    cap(x, y + h * 0.7, z, x, y + h - r * 0.6, z, r * 0.85, 'high'),
  ];
}

/** 球体对受击盒检测，返回命中的身体分区（取距离最近的分区） */
export function sphereVsBody(s: AttackSphere, body: BodyCapsule[]): BodyZone | null {
  let best: BodyZone | null = null;
  let bestD = Infinity;
  for (const c of body) {
    const rr = s.radius + c.radius;
    const d2 = distSqPointSegment(s.center, c.a, c.b);
    if (d2 <= rr * rr && d2 < bestD) {
      bestD = d2;
      best = c.zone;
    }
  }
  return best;
}

export function spheresOverlap(a: Vector3, ra: number, b: Vector3, rb: number): boolean {
  const rr = ra + rb;
  return a.distanceToSquared(b) <= rr * rr;
}

/** 推挤盒：防止两名角色重叠 */
export function pushApart(a: Fighter, b: Fighter): void {
  if (a.ignoresPush() || b.ignoresPush()) return;
  // 一方高高跃起（越过头顶）时不推挤
  if (Math.abs(a.pos.y - b.pos.y) > 1.1) return;
  const minD = a.stats.pushRadius + b.stats.pushRadius;
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist >= minD) return;
  let nx: number;
  let nz: number;
  if (dist < 1e-4) {
    nx = Math.sin(a.facing);
    nz = Math.cos(a.facing);
  } else {
    nx = dx / dist;
    nz = dz / dist;
  }
  const push = (minD - dist) / 2;
  a.pos.x -= nx * push;
  a.pos.z -= nz * push;
  b.pos.x += nx * push;
  b.pos.z += nz * push;
}

/** 擂台边界约束 */
export function clampToArena(f: Fighter, radius: number): boolean {
  const d = Math.hypot(f.pos.x, f.pos.z);
  if (d <= radius) return false;
  const k = radius / d;
  f.pos.x *= k;
  f.pos.z *= k;
  return true;
}

/** 两角色水平夹角：b 在 a 前方的余弦 */
export function frontCos(a: Fighter, bx: number, bz: number): number {
  forwardOf(a.facing, tmpF);
  const dx = bx - a.pos.x;
  const dz = bz - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return 1;
  return clamp((tmpF.x * dx + tmpF.z * dz) / d, -1, 1);
}
