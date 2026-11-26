// 角色状态定义：待机 / 移动 / 跳跃 / 侧移 / 攻击 / 格挡 / 受击 / 浮空 / 倒地 / 起身 / 投技 / KO
// 每个状态只负责自己的帧逻辑与合法的状态切换，状态之间互斥。
import { popcount } from '../core/FrameData';
import { consumeCommand, detectDoubleTap, matchCommand } from '../core/InputSystem';
import { clamp, DEG, forwardOf } from '../core/math';
import type { StateDef } from '../core/StateMachine';
import { BTN, type BodyZone, type MoveContext, type MoveDef } from '../core/types';
import { moveDamage } from '../core/FrameData';
import type { Fighter, FighterStateId, KnockKind, ThrowInfo } from './Fighter';

type S = StateDef<Fighter, FighterStateId>;

const PREJUMP_FRAMES = 9;
const LAND_FRAMES = 4;
const RUN_STOP_FRAMES = 10;

const isFwd = (d: number) => d === 3 || d === 6 || d === 9;

/** 自由状态下的通用控制：出招 > 冲刺/后撤 > 跳/蹲/走。返回 true 表示保持原状态 */
export function neutralControl(f: Fighter, from: FighterStateId): boolean {
  const ctxs: MoveContext[] = f.wsWindow > 0 ? ['ws', 'normal'] : ['normal'];
  if (f.tryCommands(ctxs)) return false;
  if (detectDoubleTap(f.input, 6)) {
    f.sm.change('dash');
    return false;
  }
  if (detectDoubleTap(f.input, 4)) {
    f.sm.change('backdash');
    return false;
  }
  const d = f.input.dir();
  let target: FighterStateId;
  if (d >= 7) target = 'prejump';
  else if (d <= 3) target = 'crouch';
  else if (d === 6) target = 'walkF';
  else if (d === 4) target = 'walkB';
  else target = 'idle';
  if (target === from) return true;
  if (target === 'prejump') f.sm.change('prejump', { dir: d });
  else f.sm.change(target);
  return false;
}

const intro: S = {
  id: 'intro',
  update(f) {
    f.faceOpponent();
  },
};

const idle: S = {
  id: 'idle',
  enter(f) {
    f.hitCrouch = false;
    f.guardBroken = false;
  },
  update(f) {
    f.faceOpponent();
    neutralControl(f, 'idle');
  },
};

const walkF: S = {
  id: 'walkF',
  update(f, frame) {
    f.faceOpponent();
    if (!neutralControl(f, 'walkF')) return;
    f.moveForward(f.stats.walkSpeed);
    if (frame % 18 === 0) f.world.emit({ type: 'step', fighter: f.index });
  },
};

const walkB: S = {
  id: 'walkB',
  update(f, frame) {
    f.faceOpponent();
    if (!neutralControl(f, 'walkB')) return;
    f.moveForward(-f.stats.backWalkSpeed);
    if (frame % 20 === 0) f.world.emit({ type: 'step', fighter: f.index });
  },
};

const crouch: S = {
  id: 'crouch',
  enter(f, p) {
    const q = (p ?? {}) as { noTap?: boolean };
    f.crouchTap = !q.noTap && f.input.dir() === 2;
  },
  update(f, frame) {
    f.faceOpponent();
    const d = f.input.dir();
    if (d > 3) {
      // 轻点下 = 向镜头方向侧移
      if (f.crouchTap && frame <= f.cfg.input.tapFrames && d === 5 && !f.input.heldAt(0)) {
        f.sm.change('sidestep', { side: -1 });
        return;
      }
      if (frame > 3) f.wsWindow = f.cfg.input.wsWindowFrames;
    } else if (d !== 2) {
      f.crouchTap = false;
    }
    neutralControl(f, 'crouch');
  },
};

const prejump: S = {
  id: 'prejump',
  enter(f, p) {
    f.jumpDir = (p as { dir: number }).dir;
    f.upTap = f.jumpDir === 8;
  },
  update(f, frame) {
    f.faceOpponent();
    const d = f.input.dir();
    if (d >= 7) {
      f.jumpDir = d;
      if (d !== 8) f.upTap = false;
    } else if (f.upTap && frame <= f.cfg.input.tapFrames) {
      // 轻点上 = 向画面深处侧移
      f.sm.change('sidestep', { side: 1 });
      return;
    }
    if (f.tryCommands(['normal'])) return;
    if (frame >= PREJUMP_FRAMES) f.sm.change('jump', { dir: f.jumpDir });
  },
};

const jump: S = {
  id: 'jump',
  enter(f, p) {
    const q = (p ?? {}) as { dir?: number; resume?: boolean };
    if (q.resume) {
      f.airAttackUsed = true;
      return;
    }
    f.airAttackUsed = false;
    const dir = q.dir ?? 8;
    const fwd = dir === 9 ? 1 : dir === 7 ? -1 : 0;
    const F = forwardOf(f.facing);
    const s = f.stats.jumpForwardSpeed * fwd;
    f.vel.set(F.x * s, f.stats.jumpVelocity, F.z * s);
    f.pos.y = Math.max(f.pos.y, 0.01);
    f.world.emit({ type: 'jump', fighter: f.index });
  },
  update(f) {
    if (!f.airAttackUsed && f.tryCommands(['air'])) {
      f.airAttackUsed = true;
      return;
    }
    if (f.airPhysics()) f.sm.change('land');
  },
};

const land: S = {
  id: 'land',
  update(f, frame) {
    f.faceOpponent();
    if (frame >= 2 && f.tryCommands(['normal'])) return;
    if (frame >= LAND_FRAMES) neutralControl(f, 'land');
  },
};

const dash: S = {
  id: 'dash',
  update(f, frame) {
    f.faceOpponent();
    const n = f.stats.dashFrames;
    f.moveForward(f.stats.dashSpeed * (1 - 0.5 * (frame / n)));
    if (frame >= 4 && f.tryCommands(['normal'])) return;
    if (frame >= n) {
      if (isFwd(f.input.dir())) f.sm.change('run');
      else neutralControl(f, 'dash');
    }
  },
};

const run: S = {
  id: 'run',
  update(f, frame) {
    f.faceOpponent(4 * DEG);
    f.moveForward(Math.min(f.stats.runSpeed, f.stats.dashSpeed * 0.55 + frame * 0.003));
    if (frame % 12 === 0) f.world.emit({ type: 'step', fighter: f.index });
    if (f.tryCommands(['run', 'normal'])) return;
    const opp = f.opponent;
    const close = f.distToOpponent() < f.stats.pushRadius + opp.stats.pushRadius + 0.3;
    if (frame >= 16 && close && !opp.isAirborne() && !opp.isLying()) {
      const tackle = f.def.moves['run_tackle'];
      if (tackle) {
        f.startMove(tackle, -1);
        return;
      }
    }
    if (!isFwd(f.input.dir())) f.sm.change('runStop');
  },
};

const runStop: S = {
  id: 'runStop',
  update(f, frame) {
    f.moveForward(f.stats.runSpeed * Math.max(0, 1 - frame / RUN_STOP_FRAMES) * 0.8);
    if (frame >= 4 && f.tryCommands(['normal'])) return;
    if (frame >= RUN_STOP_FRAMES) neutralControl(f, 'runStop');
  },
};

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2;

const backdash: S = {
  id: 'backdash',
  update(f, frame) {
    f.faceOpponent();
    const n = f.stats.backdashFrames;
    const d = f.stats.backdashDistance * (easeOut(Math.min(1, frame / n)) - easeOut((frame - 1) / n));
    f.moveForward(-d);
    if (frame >= Math.ceil(n * 0.6)) {
      if (detectDoubleTap(f.input, 4)) {
        f.sm.change('backdash');
        return;
      }
      if (f.tryCommands(['normal'])) return;
    }
    if (frame >= n) neutralControl(f, 'backdash');
  },
};

const sidestep: S = {
  id: 'sidestep',
  enter(f, p) {
    f.sideDir = (p as { side: number }).side;
  },
  update(f, frame) {
    const n = f.stats.sidestepFrames;
    const step = f.stats.sidestepDistance * (easeInOut(frame / n) - easeInOut((frame - 1) / n));
    f.circleStep(step * f.sideDir);
    f.faceOpponent();
    if (frame >= 6 && f.tryCommands(['normal'])) return;
    if (frame >= n) neutralControl(f, 'sidestep');
  },
};

const attack: S = {
  id: 'attack',
  enter(f, p) {
    const { move, chained } = p as { move: MoveDef; chained?: boolean };
    f.move = move;
    f.moveFrame = 0;
    f.moveConnected = false;
    f.moveResult = 'whiff';
    f.queuedChain = null;
    f.projectileFired = false;
    f.armorUsed = false;
    if (!chained && move.context !== 'air' && move.context !== 'ground') f.faceOpponent();
    f.lastMove = move;
    f.moveSerial++;
    if (move.level !== 'none') {
      f.world.emit({ type: 'attack', fighter: f.index, moveId: move.id, heavy: moveDamage(f.def, move) >= 12 || move.level === 'throw' });
    }
  },
  exit(f) {
    f.move = null;
  },
  update(f, frame) {
    const m = f.move!;
    if (frame > m.total) {
      f.endMove();
      return;
    }
    f.moveFrame = frame;

    // 单键招式前 2 帧内补按另一个键 → 升级为双键招式（如 LP 后补 RP = 投技）
    if (frame <= 2 && m.command && m.command.motion.length === 0 && popcount(m.command.buttons) === 1) {
      const btn = m.command.buttons;
      const up = f.findCommand([m.context], 2, true, (c) => popcount(c.command!.buttons) > 1 && (c.command!.buttons & btn) !== 0);
      if (up && up.move !== m) {
        f.startMove(up.move, up.ago);
        return;
      }
    }

    if (m.tracking > 0 && frame < m.startup) f.faceOpponent(m.tracking * DEG);
    if (m.advance > 0 && frame <= m.activeEnd) {
      const n = m.activeEnd;
      f.moveForward(m.advance * (easeOut(frame / n) - easeOut((frame - 1) / n)));
    }
    if (m.context === 'air' && f.airPhysics()) {
      f.sm.change('land');
      return;
    }
    if (m.projectile && frame === m.projectile.spawnFrame && !f.projectileFired) {
      f.projectileFired = true;
      f.world.spawnProjectile(f, m.projectile);
    }
    if (m.toggleWeapon && frame === m.toggleWeapon) {
      f.weaponDrawn = !f.weaponDrawn;
      f.world.emit({ type: 'weapon', fighter: f.index, drawn: f.weaponDrawn });
    }

    // 连段（字符串）输入：窗口内按下 → 到取消帧时切入下一段
    if (!f.queuedChain) {
      for (const c of m.chain) {
        if (frame < c.window[0] || frame > c.window[1]) continue;
        const ago = matchCommand(f.input, c.input, frame - c.window[0], true);
        if (ago >= 0) {
          consumeCommand(f.input, c.input, ago);
          f.queuedChain = c;
          break;
        }
      }
    }
    if (f.queuedChain && frame >= f.queuedChain.cancel) {
      const next = f.def.moves[f.queuedChain.moveId];
      f.startMove(next, -1, true);
    }
  },
};

const block: S = {
  id: 'block',
  enter(f, p) {
    const q = p as { stun: number };
    f.stun = q.stun;
    f.stunTotal = q.stun;
    f.move = null;
  },
  update(f) {
    if (f.stun <= 0) {
      f.recoverNeutral();
      return;
    }
    f.stun--;
    f.hitCrouch = f.input.dir() <= 3;
  },
};

const hit: S = {
  id: 'hit',
  enter(f, p) {
    const q = p as { stun: number; zone: BodyZone; crouch: boolean };
    f.stun = q.stun;
    f.stunTotal = q.stun;
    f.hitZone = q.zone;
    f.hitCrouch = q.crouch;
    f.move = null;
  },
  update(f) {
    if (f.stun <= 0) {
      f.recoverNeutral();
      return;
    }
    f.stun--;
  },
};

const stagger: S = {
  id: 'stagger',
  enter(f, p) {
    const q = p as { stun: number; guardBreak?: boolean };
    f.stun = q.stun;
    f.stunTotal = q.stun;
    f.guardBroken = Boolean(q.guardBreak);
    f.hitCrouch = false;
    f.move = null;
  },
  update(f) {
    if (f.stun <= 0) {
      f.guardBroken = false;
      f.recoverNeutral();
      return;
    }
    f.stun--;
  },
};

const juggle: S = {
  id: 'juggle',
  enter(f, p) {
    const q = p as { vy: number; dx: number; dz: number; speed: number; kind: KnockKind };
    if (f.sm.previous !== 'juggle') {
      f.juggleHits = 0;
      f.juggleProtected = false;
    }
    f.vel.set(q.dx * q.speed, q.vy, q.dz * q.speed);
    f.knockKind = q.kind;
    if (q.kind === 'ko') f.dead = true;
    if (f.pos.y < 0.02) f.pos.y = 0.02;
    f.move = null;
    f.throwInfo = null;
  },
  update(f) {
    const J = f.cfg.juggle;
    f.vel.y -= J.gravity * (1 + f.juggleHits * J.gravityScalePerHit);
    f.pos.add(f.vel);
    f.vel.x *= 0.985;
    f.vel.z *= 0.985;
    if (f.pos.y <= 0 && f.vel.y < 0) {
      f.pos.y = 0;
      f.vel.set(0, 0, 0);
      f.world.emit({ type: 'land', fighter: f.index, heavy: true, pos: { x: f.pos.x, y: 0, z: f.pos.z } });
      f.sm.change(f.hp <= 0 ? 'ko' : 'grounded');
    }
  },
};

const grounded: S = {
  id: 'grounded',
  enter(f, p) {
    const q = (p ?? {}) as { resume?: boolean };
    f.lieFrames = q.resume ? f.cfg.ground.minLieFrames : 0;
    f.vel.set(0, 0, 0);
    f.pos.y = 0;
    f.move = null;
    f.throwInfo = null;
  },
  update(f) {
    f.lieFrames++;
    if (f.hp <= 0) {
      f.sm.change('ko');
      return;
    }
    const G = f.cfg.ground;
    if (f.lieFrames < G.minLieFrames) return;
    // 倒地选项：LK 躺地踢 / RK 起身踢 / 前或拳键 原地起身 / 后 后滚 / 上下 侧滚
    if (f.tryCommands(['ground'])) return;
    const d = f.input.dir();
    const punch = f.input.pressedAt(0) & (BTN.LP | BTN.RP);
    if (d === 4 || d === 1 || d === 7) f.sm.change('roll', { kind: 'back' });
    else if (d === 8) f.sm.change('roll', { kind: 'side', side: 1 });
    else if (d === 2) f.sm.change('roll', { kind: 'side', side: -1 });
    else if (d === 6 || d === 3 || d === 9 || punch || f.lieFrames >= G.maxLieFrames) f.sm.change('getup');
  },
};

const getup: S = {
  id: 'getup',
  enter(f, p) {
    const q = (p ?? {}) as { short?: boolean };
    f.getupTotal = q.short ? 14 : f.cfg.ground.getupFrames;
    f.invuln = q.short ? 6 : f.cfg.ground.getupInvulnFrames;
  },
  update(f, frame) {
    f.faceOpponent(10 * DEG);
    if (frame >= f.getupTotal) {
      f.sm.change('idle');
      neutralControl(f, 'idle');
    }
  },
};

const roll: S = {
  id: 'roll',
  enter(f, p) {
    const q = p as { kind: 'back' | 'side'; side?: number };
    f.rollKind = q.kind;
    f.sideDir = q.side ?? 0;
    f.invuln = f.cfg.ground.rollFrames + 2;
  },
  update(f, frame) {
    const G = f.cfg.ground;
    const step = G.rollDistance / G.rollFrames;
    if (f.rollKind === 'back') f.moveForward(-step);
    else f.circleStep(step * f.sideDir);
    if (frame >= G.rollFrames) f.sm.change('getup', { short: true });
  },
};

const throwing: S = {
  id: 'throwing',
  enter(f, p) {
    f.throwInfo = p as ThrowInfo;
    f.move = null;
    f.vel.set(0, 0, 0);
  },
  update(f, frame) {
    const t = f.throwInfo;
    if (!t) {
      f.sm.change('idle');
      return;
    }
    if (frame === t.throwDef.damageFrame) f.world.applyThrowDamage(t);
    if (frame >= t.throwDef.duration) {
      f.throwInfo = null;
      f.sm.change('idle');
      neutralControl(f, 'idle');
    }
  },
};

const thrown: S = {
  id: 'thrown',
  enter(f, p) {
    f.throwInfo = p as ThrowInfo;
    f.vel.set(0, 0, 0);
    f.move = null;
  },
  update(f, frame) {
    const t = f.throwInfo;
    if (!t) {
      f.sm.change('grounded');
      return;
    }
    const td = t.throwDef;
    if (!t.back && td.breakInput && frame <= f.cfg.throw.breakWindow) {
      const cmd = { text: td.breakText, motion: [], dir: null, buttons: td.breakInput, priority: 0 };
      if (matchCommand(f.input, cmd, frame - 1, true) >= 0) {
        f.world.breakThrow(t);
        return;
      }
    }
    if (frame >= td.duration) {
      f.throwInfo = null;
      f.sm.change(f.hp <= 0 ? 'ko' : 'grounded');
    }
  },
};

const throwBreak: S = {
  id: 'throwBreak',
  enter(f) {
    f.throwInfo = null;
    f.move = null;
    const F = forwardOf(f.facing);
    const v = f.cfg.throw.breakPushback * (1 - f.cfg.friction);
    f.vel.set(-F.x * v, 0, -F.z * v);
  },
  update(f, frame) {
    if (frame >= 20) {
      f.sm.change('idle');
      neutralControl(f, 'idle');
    }
  },
};

const ko: S = {
  id: 'ko',
  enter(f) {
    f.dead = true;
    f.vel.set(0, 0, 0);
    f.pos.y = 0;
    f.move = null;
    f.throwInfo = null;
  },
  update() {},
};

const victory: S = {
  id: 'victory',
  enter(f) {
    f.move = null;
    f.vel.set(0, 0, 0);
  },
  update() {},
};

export const FIGHTER_STATES: S[] = [
  intro, idle, walkF, walkB, crouch, prejump, jump, land, dash, run, runStop, backdash, sidestep,
  attack, block, hit, stagger, juggle, grounded, getup, roll, throwing, thrown, throwBreak, ko, victory,
];
