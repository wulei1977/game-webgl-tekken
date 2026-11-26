// 战斗结算：打击命中 / 格挡 / Counter / 浮空连 / 倒地追击 / 霸体 / 崩防 / 投技与挣脱
import { Vector3 } from 'three';
import type { Fighter, ThrowInfo } from '../actor/Fighter';
import type { GameConfig } from './config';
import { activeAttackSphere, bodyCapsules, clampToArena, frontCos, sphereVsBody } from './CollisionSystem';
import { moveDamage } from './FrameData';
import { yawTo } from './math';
import type { BodyZone, GameEvent, HitType, MoveDef, ProjectileKind, StrikeLevel } from './types';

export interface CombatHost {
  readonly config: GameConfig;
  readonly practice: boolean;
  hitstop: number;
  emit(e: GameEvent): void;
  noteExchange(attacker: Fighter, defender: Fighter, result: 'hit' | 'block' | 'counter', move: MoveDef | null): void;
}

export interface HitSpec {
  attacker: Fighter;
  level: StrikeLevel;
  damage: number;
  zone: BodyZone;
  counter: boolean;
  pos: Vector3;
  /** 普通受击时的硬直帧数（已计入帧优势） */
  stun: number;
  type: HitType;
  launch: number;
  knockback: number;
  dirX: number;
  dirZ: number;
  weapon: boolean;
  projectile: ProjectileKind | null;
  move: MoveDef | null;
}

interface StrikeCheck {
  move: MoveDef;
  frame: number;
  zone: BodyZone;
  counter: boolean;
  pos: Vector3;
}

function checkStrike(att: Fighter, def: Fighter): StrikeCheck | null {
  const s = activeAttackSphere(att);
  if (!s) return null;
  const m = att.move!;
  if (!def.isHittable()) return null;
  if (def.isLying() && !m.hitsGrounded) return null;
  if (def.juggleProtected && def.isAirborne()) return null; // 落地保护
  if (m.level === 'high' && def.isCrouching() && !def.isAirborne()) return null; // 下蹲躲上段
  const zone = sphereVsBody(s, bodyCapsules(def));
  if (!zone) return null;
  return { move: m, frame: att.moveFrame, zone, counter: def.isCounterHittable(), pos: s.center.clone() };
}

function pushAlong(f: Fighter, dirX: number, dirZ: number, dist: number, cfg: GameConfig): void {
  const v = dist * (1 - cfg.friction);
  f.vel.x += dirX * v;
  f.vel.z += dirZ * v;
}

/** 双方的打击判定同时计算、同时结算（允许相杀） */
export function resolveStrikes(host: CombatHost, fighters: readonly Fighter[]): void {
  const checks = fighters.map((att) => checkStrike(att, att.opponent));
  checks.forEach((r, i) => {
    if (r) applyStrike(host, fighters[i], fighters[i].opponent, r);
  });
}

function applyStrike(host: CombatHost, att: Fighter, def: Fighter, r: StrikeCheck): void {
  const cfg = host.config;
  const m = r.move;
  att.moveConnected = true;
  const level = m.level as StrikeLevel;
  const dmg = moveDamage(att.def, m);
  const F = att.forward();

  if (def.isArmored()) {
    // 霸体：吃伤害但不进入硬直
    def.armorUsed = true;
    def.takeDamage(dmg);
    att.moveResult = 'hit';
    host.hitstop = Math.max(host.hitstop, cfg.hitstop.light);
    host.emit({ type: 'armor', defender: def.index, pos: vec(r.pos) });
    host.emit(hitEvent(att, def, dmg, level, r.zone, false, false, false, m.weapon, null, m.id, r.pos));
    return;
  }

  if (!def.isLying() && !def.isAirborne() && def.canBlock(level, att.pos.x, att.pos.z)) {
    const stun = Math.max(1, m.total - r.frame + m.onBlock.advantage);
    applyBlockStun(host, att, def, stun, dmg, m.onBlock.pushback, level, null, r.pos);
    host.noteExchange(att, def, 'block', m);
    return;
  }

  const props = r.counter ? m.onCounter : m.onHit;
  att.moveResult = r.counter ? 'counter' : 'hit';
  applyHit(host, def, {
    attacker: att,
    level,
    damage: dmg,
    zone: r.zone,
    counter: r.counter,
    pos: r.pos,
    stun: m.total - r.frame + props.advantage,
    type: props.type,
    launch: props.launch,
    knockback: props.knockback,
    dirX: F.x,
    dirZ: F.z,
    weapon: m.weapon,
    projectile: null,
    move: m,
  });
}

export function applyBlockStun(
  host: CombatHost,
  att: Fighter,
  def: Fighter,
  stun: number,
  damage: number,
  pushback: number,
  level: StrikeLevel,
  projectile: ProjectileKind | null,
  pos: Vector3,
  from?: { x: number; z: number },
): void {
  const cfg = host.config;
  const src = from ?? att.pos;
  const crouch = def.guardStance() === 'crouch';
  def.facing = yawTo(def.pos, new Vector3(src.x, 0, src.z));
  def.sm.change('block', { stun });
  def.hitCrouch = crouch;
  const dx = def.pos.x - src.x;
  const dz = def.pos.z - src.z;
  const d = Math.hypot(dx, dz) || 1;
  pushAlong(def, dx / d, dz / d, pushback, cfg);
  def.guardMeter += projectile ? damage * 0.5 : damage;
  att.moveResult = 'block';
  host.hitstop = Math.max(host.hitstop, cfg.hitstop.block);
  host.emit({ type: 'block', attacker: att.index, defender: def.index, level, projectile, pos: vec(pos) });
  if (def.guardMeter >= cfg.guardBreak.threshold) {
    // 崩防：持续格挡超过阈值 → 大硬直，可被确反
    def.guardMeter = 0;
    def.sm.change('stagger', { stun: cfg.guardBreak.stunFrames, guardBreak: true });
    host.emit({ type: 'guardBreak', defender: def.index, pos: vec(pos) });
  }
}

export function applyHit(host: CombatHost, def: Fighter, h: HitSpec): void {
  const cfg = host.config;
  const J = cfg.juggle;
  const crouching = def.isCrouching();
  const lying = def.isLying();
  const juggling = def.sm.is('juggle');
  const airborne = def.isAirborne();
  const comboing = !def.isActionable() && !def.sm.is('attack', 'block') && def.comboHits > 0;

  let dmg = h.damage;
  if (h.counter) dmg *= cfg.counterHit.damageScale;
  if (juggling) dmg *= Math.max(J.minDamageScale, 1 - J.damageScalePerHit * (def.juggleHits + 1));
  dmg = Math.max(1, Math.round(dmg));
  def.comboHits = comboing ? def.comboHits + 1 : 1;
  def.comboDamage = (comboing ? def.comboDamage : 0) + dmg;
  def.takeDamage(dmg);

  let heavy = dmg >= cfg.hitstop.heavyDamage || h.type !== 'normal' || h.counter;
  let launch = false;
  const towardAttacker = yawTo(def.pos, h.attacker.pos);

  if (def.hp <= 0) {
    def.facing = towardAttacker;
    def.startJuggle(J.koLift, h.dirX, h.dirZ, J.koSpeed, 'ko');
    heavy = true;
  } else if (lying) {
    // 倒地追击：保持倒地，重新计算躺地时间
    if (!def.sm.is('grounded')) def.sm.change('grounded');
    def.lieFrames = 0;
    def.groundBounce = 10;
  } else if (juggling || airborne) {
    launch = true;
    if (!juggling) {
      def.facing = towardAttacker;
      def.startJuggle(Math.max(0.045, h.launch * 0.6), h.dirX, h.dirZ, J.driftSpeed, 'launch');
      def.juggleHits = 1;
    } else {
      def.juggleHits++;
      const decay = Math.pow(J.liftDecay, def.juggleHits - 1);
      let lift = J.lift * decay;
      if (h.type === 'launch') lift = Math.max(lift, h.launch * 0.55 * decay);
      if (h.type === 'knockdown') lift = Math.min(lift, 0.02);
      def.vel.y = Math.max(def.vel.y * 0.3, lift / Math.sqrt(def.stats.weight));
      const push = h.type === 'knockdown' ? 0.05 : 0.012;
      def.vel.x = h.dirX * push;
      def.vel.z = h.dirZ * push;
      if (def.juggleHits >= J.maxHits) def.juggleProtected = true;
    }
  } else {
    def.facing = towardAttacker;
    switch (h.type) {
      case 'launch':
        def.startJuggle(h.launch / def.stats.weight, h.dirX, h.dirZ, J.driftSpeed, 'launch');
        launch = true;
        break;
      case 'knockdown':
        def.startJuggle(J.knockdownLift, h.dirX, h.dirZ, J.knockdownSpeed, 'knockdown');
        break;
      case 'stagger':
        def.sm.change('stagger', { stun: Math.max(24, h.stun) });
        pushAlong(def, h.dirX, h.dirZ, h.knockback, cfg);
        break;
      default:
        def.sm.change('hit', {
          stun: Math.max(1, h.stun + (h.counter ? cfg.counterHit.extraStun : 0)),
          zone: h.zone,
          crouch: crouching,
        });
        pushAlong(def, h.dirX, h.dirZ, h.knockback, cfg);
    }
  }

  host.hitstop = Math.max(host.hitstop, heavy ? cfg.hitstop.heavy : cfg.hitstop.light);
  if (h.type === 'normal' && !juggling && !airborne && !lying && def.hp > 0) {
    host.noteExchange(h.attacker, def, h.counter ? 'counter' : 'hit', h.move);
  }
  const ev = hitEvent(h.attacker, def, dmg, h.level, h.zone, h.counter, heavy, launch, h.weapon, h.projectile, h.move?.id ?? 'projectile', h.pos);
  if (ev.type === 'hit') {
    ev.airborne = airborne;
    ev.grounded = lying;
  }
  host.emit(ev);
}

function vec(v: Vector3) {
  return { x: v.x, y: v.y, z: v.z };
}

function hitEvent(
  att: Fighter,
  def: Fighter,
  damage: number,
  level: StrikeLevel,
  zone: BodyZone,
  counter: boolean,
  heavy: boolean,
  launch: boolean,
  weapon: boolean,
  projectile: ProjectileKind | null,
  moveId: string,
  pos: Vector3,
): GameEvent {
  return {
    type: 'hit',
    attacker: att.index,
    defender: def.index,
    damage,
    level,
    zone,
    counter,
    heavy,
    launch,
    airborne: false,
    grounded: false,
    weapon,
    projectile,
    moveId,
    combo: def.comboHits,
    comboDamage: def.comboDamage,
    pos: vec(pos),
  };
}

// ------------------------------------------------------------------ 投技

function checkThrow(att: Fighter, def: Fighter): { back: boolean } | null {
  const m = att.move;
  if (!m || !att.sm.is('attack') || m.level !== 'throw' || !m.throw) return null;
  if (att.moveFrame < m.startup || att.moveFrame > m.activeEnd || att.moveConnected) return null;
  if (!def.isThrowable()) return null;
  if (att.distToOpponent() > m.throw.range + def.stats.pushRadius * 0.3) return null;
  if (frontCos(att, def.pos.x, def.pos.z) < 0.6) return null;
  return { back: frontCos(def, att.pos.x, att.pos.z) < -0.3 };
}

export function resolveThrows(host: CombatHost, fighters: readonly Fighter[]): void {
  const c = fighters.map((att) => checkThrow(att, att.opponent));
  if (c[0] && c[1]) {
    // 双方同时投 → 互相挣脱
    for (const f of fighters) {
      f.moveConnected = true;
      f.faceOpponent();
      f.sm.change('throwBreak');
    }
    const p = fighters[0].pos.clone().lerp(fighters[1].pos, 0.5).setY(1.3);
    host.emit({ type: 'throwBreak', attacker: 0, defender: 1, pos: vec(p) });
    return;
  }
  c.forEach((r, i) => {
    if (r) startThrow(host, fighters[i], fighters[i].opponent, r.back);
  });
}

function startThrow(host: CombatHost, att: Fighter, def: Fighter, back: boolean): void {
  const cfg = host.config;
  const m = att.move!;
  att.moveConnected = true;
  const bt = back ? att.def.moves['back_throw'] : undefined;
  const useMove = bt ?? m;
  const throwDef = useMove.throw!;
  const damage = back && !bt ? Math.round(moveDamage(att.def, m) * cfg.throw.backThrowDamageScale) : moveDamage(att.def, useMove);
  const F = att.forward();
  const grab = Math.max(0.62, att.stats.pushRadius + def.stats.pushRadius);
  def.pos.set(att.pos.x + F.x * grab, 0, att.pos.z + F.z * grab);
  def.facing = back ? att.facing : yawTo(def.pos, att.pos);
  const landDist = throwDef.swap ? -1.0 : 1.05;
  const info: ThrowInfo = {
    attacker: att,
    victim: def,
    move: useMove,
    throwDef,
    damage,
    back,
    attackerPos: att.pos.clone(),
    attackerFacing: att.facing,
    victimStart: def.pos.clone(),
    landPos: new Vector3(att.pos.x + F.x * landDist, 0, att.pos.z + F.z * landDist),
    landed: false,
  };
  att.sm.change('throwing', info);
  def.sm.change('thrown', info);
  host.emit({ type: 'throwStart', attacker: att.index, defender: def.index, moveId: useMove.id, back });
}

export function applyThrowDamage(host: CombatHost, info: ThrowInfo): void {
  const cfg = host.config;
  const { attacker: att, victim: def } = info;
  def.takeDamage(info.damage);
  def.comboHits = 1;
  def.comboDamage = info.damage;
  def.pos.copy(info.landPos);
  clampToArena(def, cfg.arenaRadius);
  info.landPos.copy(def.pos);
  def.facing = yawTo(def.pos, att.pos);
  info.landed = true;
  if (def.hp <= 0) def.dead = true;
  host.hitstop = Math.max(host.hitstop, cfg.hitstop.throw);
  host.emit({ type: 'throwHit', attacker: att.index, defender: def.index, damage: info.damage, pos: { x: def.pos.x, y: 0.4, z: def.pos.z } });
}

export function breakThrow(host: CombatHost, info: ThrowInfo): void {
  const { attacker: att, victim: def } = info;
  att.faceOpponent();
  def.faceOpponent();
  att.sm.change('throwBreak');
  def.sm.change('throwBreak');
  const p = att.pos.clone().lerp(def.pos, 0.5).setY(1.35);
  host.emit({ type: 'throwBreak', attacker: att.index, defender: def.index, pos: vec(p) });
}
