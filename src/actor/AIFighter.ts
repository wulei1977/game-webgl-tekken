// AI 对手：与玩家使用同一套输入接口（产生相对方向 + 按键帧），不直接修改角色状态
// 简单：随机出招、很少格挡、不连段；普通：读招格挡高低段、基础浮空连、后撤、投技；
// 困难：记录玩家习惯、确反大硬直、侧移规避直线招、压起身。
import { DIR_NUM, moveDamage } from '../core/FrameData';
import type { Game, InputController } from '../core/Game';
import { Rng } from '../core/math';
import type { ChainDef, Difficulty, DummyMode, InputFrame, MoveDef } from '../core/types';
import type { Fighter } from './Fighter';

interface AIParams {
  reaction: number;
  blockChance: number;
  lowBlockChance: number;
  duckHighChance: number;
  punishChance: number;
  comboChance: number;
  sidestepChance: number;
  throwChance: number;
  throwBreakChance: number;
  aggression: number;
  decision: [number, number];
  okiChance: number;
  backdashChance: number;
  adaptive: boolean;
  smart: boolean;
}

export const AI_PARAMS: Record<Difficulty, AIParams> = {
  easy: {
    reaction: 30, blockChance: 0.12, lowBlockChance: 0.05, duckHighChance: 0.03, punishChance: 0,
    comboChance: 0, sidestepChance: 0, throwChance: 0.06, throwBreakChance: 0.05, aggression: 0.45,
    decision: [20, 42], okiChance: 0, backdashChance: 0.02, adaptive: false, smart: false,
  },
  normal: {
    reaction: 16, blockChance: 0.6, lowBlockChance: 0.45, duckHighChance: 0.22, punishChance: 0.35,
    comboChance: 0.65, sidestepChance: 0.08, throwChance: 0.12, throwBreakChance: 0.35, aggression: 0.5,
    decision: [10, 26], okiChance: 0.3, backdashChance: 0.18, adaptive: false, smart: true,
  },
  hard: {
    reaction: 9, blockChance: 0.85, lowBlockChance: 0.72, duckHighChance: 0.45, punishChance: 0.92,
    comboChance: 1, sidestepChance: 0.35, throwChance: 0.15, throwBreakChance: 0.7, aggression: 0.58,
    decision: [6, 16], okiChance: 0.7, backdashChance: 0.2, adaptive: true, smart: true,
  },
};

const N: InputFrame = { dir: 5, held: 0 };

interface AIMove {
  move: MoveDef;
  inputs: InputFrame[];
  range: number;
  startup: number;
  damage: number;
}

/** 把出招指令转换成逐帧输入（AI 用） */
export function commandInputs(m: MoveDef): InputFrame[] {
  const c = m.command;
  if (!c) return [];
  const out: InputFrame[] = [];
  if (m.context === 'ws') {
    for (let i = 0; i < 6; i++) out.push({ dir: 2, held: 0 });
  }
  const seq = [...c.motion];
  for (let i = 0; i < seq.length; i++) {
    out.push({ dir: DIR_NUM[seq[i]], held: 0 });
    const next = i + 1 < seq.length ? seq[i + 1] : c.dir;
    if (next === seq[i]) out.push({ dir: 5, held: 0 });
  }
  const d = c.dir ? DIR_NUM[c.dir] : 5;
  out.push({ dir: d, held: c.buttons });
  out.push({ dir: d === 6 || d === 4 ? 5 : d, held: 0 });
  return out;
}

function buildMoves(self: Fighter): AIMove[] {
  const res: AIMove[] = [];
  for (const m of self.def.commandMoves) {
    if (m.context !== 'normal' && m.context !== 'ws') continue;
    let range = 0;
    if (m.hitbox) range = m.hitbox.reach + m.hitbox.radius + m.advance + 0.28;
    else if (m.throw) range = m.throw.range;
    else if (m.projectile) range = 9;
    else if (m.toggleWeapon) range = 99;
    res.push({ move: m, inputs: commandInputs(m), range, startup: m.startup + (m.command?.motion.length ?? 0), damage: moveDamage(self.def, m) });
  }
  return res;
}

export class AIController implements InputController {
  private p: AIParams;
  private rng: Rng;
  private plan: InputFrame[] = [];
  private planInterruptible = true;
  private last: InputFrame = N;
  private cooldown = 0;
  private moves: AIMove[] | null = null;
  private seenOppMove = -1;
  private defendDir = 0;
  private punishedSerial = -1;
  private comboSerial = -1;
  private comboActive = false;
  private okiSerial = -1;
  private okiActive = false;
  private throwBreakAt = -1;
  private wakeAt = -1;
  private wakeChoice: InputFrame = N;
  private projSeen = -1;
  private projResponse: 'none' | 'side' | 'block' = 'none';
  private obsSerial = -1;
  private habits = { high: 1, mid: 1, low: 1, throw: 1 };

  constructor(
    readonly difficulty: Difficulty,
    seed = 20240607,
  ) {
    this.p = AI_PARAMS[difficulty];
    this.rng = new Rng(seed);
  }

  reset(): void {
    this.plan = [];
    this.cooldown = 10;
    this.last = N;
    this.seenOppMove = -1;
    this.punishedSerial = -1;
  }

  poll(game: Game, self: Fighter): InputFrame {
    if (game.hitstop > 0) return this.last;
    if (!this.moves) this.moves = buildMoves(self);
    this.selfMoves = self.def.moves;
    const out = this.think(game, self);
    this.last = out;
    return out;
  }

  private runPlan(frames: InputFrame[], interruptible: boolean): InputFrame {
    if (!frames.length) return N;
    this.plan = frames.slice(1);
    this.planInterruptible = interruptible;
    return frames[0];
  }

  private hold(dir: number, n: number): InputFrame {
    return this.runPlan(Array.from({ length: n }, () => ({ dir, held: 0 })), true);
  }

  private habitBias(level: 'high' | 'mid' | 'low' | 'throw'): number {
    if (!this.p.adaptive) return 0;
    const h = this.habits;
    const total = h.high + h.mid + h.low + h.throw;
    return Math.max(0, Math.min(0.3, (h[level] / total - 0.25) * 0.9));
  }

  private observe(opp: Fighter): void {
    if (opp.sm.is('attack') && opp.move && opp.moveSerial !== this.obsSerial) {
      this.obsSerial = opp.moveSerial;
      const lv = opp.move.level;
      if (lv === 'high' || lv === 'mid' || lv === 'low' || lv === 'throw') {
        for (const k of Object.keys(this.habits) as (keyof typeof this.habits)[]) this.habits[k] *= 0.92;
        this.habits[lv] += 1;
      }
    }
  }

  private threatened(self: Fighter, opp: Fighter): boolean {
    const m = opp.move;
    return opp.sm.is('attack') && !!m && opp.moveFrame >= this.p.reaction && opp.moveFrame <= m.activeEnd && self.distToOpponent() < 2.4;
  }

  private think(game: Game, self: Fighter): InputFrame {
    const opp = self.opponent;
    const p = this.p;
    this.observe(opp);
    const st = self.sm.id;

    if (st === 'thrown') {
      const t = self.throwInfo;
      if (t && !t.back && t.throwDef.breakInput) {
        if (this.throwBreakAt < 0) {
          const ok = this.rng.chance(p.throwBreakChance + this.habitBias('throw'));
          this.throwBreakAt = ok ? self.sm.frame + this.rng.int(2, Math.max(3, game.config.throw.breakWindow - 4)) : 9999;
        }
        if (self.sm.frame === this.throwBreakAt) return { dir: 5, held: t.throwDef.breakInput };
      }
      return N;
    }
    this.throwBreakAt = -1;

    if (st === 'grounded') return this.wakeup(game, self);
    this.wakeAt = -1;

    if (this.plan.length) {
      if (this.planInterruptible && (this.threatened(self, opp) || opp.sm.is('juggle'))) this.plan = [];
      else return this.plan.shift()!;
    }

    if (st === 'block') {
      const om = opp.move;
      if (om && opp.sm.is('attack') && this.punishedSerial !== opp.moveSerial && self.stun <= 3) {
        this.punishedSerial = opp.moveSerial;
        const window = -om.onBlock.advantage;
        if (window >= 10 && this.rng.chance(p.punishChance)) {
          const pm = this.pickPunisher(window, self.distToOpponent() + 0.2);
          if (pm) return this.runPlan(pm.inputs, false);
        }
      }
      return { dir: self.hitCrouch ? 1 : 5, held: 0 };
    }

    if (!self.isActionable()) return N;

    return this.defend(game, self, opp) ?? this.punish(self, opp) ?? this.juggle(self, opp) ?? this.oki(self, opp) ?? this.neutral(self, opp);
  }

  private wakeup(game: Game, self: Fighter): InputFrame {
    const G = game.config.ground;
    if (this.wakeAt < 0) {
      this.wakeAt = G.minLieFrames + this.rng.int(0, this.p.smart ? 12 : 30);
      const r = this.rng.next();
      if (!this.p.smart || r < 0.4) this.wakeChoice = { dir: 6, held: 0 };
      else if (r < 0.55) this.wakeChoice = { dir: 4, held: 0 };
      else if (r < 0.7) this.wakeChoice = { dir: this.rng.chance(0.5) ? 8 : 2, held: 0 };
      else if (r < 0.85) this.wakeChoice = { dir: 5, held: 8 };
      else this.wakeChoice = { dir: 5, held: 4 };
    }
    if (self.lieFrames >= this.wakeAt) {
      this.wakeAt = 9999;
      return this.runPlan([this.wakeChoice, N], false);
    }
    return N;
  }

  private defend(game: Game, self: Fighter, opp: Fighter): InputFrame | null {
    const p = this.p;
    const rng = this.rng;
    // 飞行道具：侧移或格挡
    const proj = game.projectiles.list.find((pr) => pr.alive && pr.owner === opp);
    if (proj) {
      const dx = self.pos.x - proj.pos.x;
      const dz = self.pos.z - proj.pos.z;
      const dist = Math.hypot(dx, dz);
      const approaching = proj.dir.x * dx + proj.dir.z * dz > 0;
      if (approaching && dist < 3.2 && proj.age * 2 >= p.reaction) {
        if (this.projSeen !== proj.id) {
          this.projSeen = proj.id;
          this.projResponse = rng.chance(p.sidestepChance * 1.6) ? 'side' : rng.chance(p.blockChance) ? 'block' : 'none';
          if (this.projResponse === 'side') return this.runPlan([{ dir: rng.chance(0.5) ? 8 : 2, held: 0 }, N, N, N], false);
        }
        if (this.projResponse === 'block') {
          const lv = proj.def.level;
          return { dir: lv === 'low' ? 1 : lv === 'high' && rng.chance(0.5) ? 2 : 5, held: 0 };
        }
      }
    }

    const om = opp.move;
    if (!om || !opp.sm.is('attack') || opp.moveFrame < p.reaction || opp.moveFrame > om.activeEnd) return null;
    if (this.seenOppMove !== opp.moveSerial) {
      this.seenOppMove = opp.moveSerial;
      this.defendDir = 0;
      const dist = self.distToOpponent();
      const hb = om.hitbox;
      const reach = hb ? hb.reach + hb.radius + om.advance + self.stats.hurtRadius + 0.35 : om.throw ? om.throw.range + 0.3 : 0;
      if (dist <= reach) {
        const lv = om.level;
        if (lv === 'throw') {
          if (rng.chance(p.duckHighChance + this.habitBias('throw'))) this.defendDir = 2;
        } else if (lv === 'low') {
          if (rng.chance(p.lowBlockChance + this.habitBias('low'))) this.defendDir = 1;
        } else if (lv === 'high') {
          if (rng.chance(p.duckHighChance + this.habitBias('high') * 0.5)) this.defendDir = 2;
          else if (rng.chance(p.blockChance)) this.defendDir = 5;
        } else if (lv === 'mid') {
          if (rng.chance(p.blockChance + this.habitBias('mid') * 0.5)) this.defendDir = 5;
        }
        // 侧移躲直线招式
        if (lv !== 'throw' && om.tracking === 0 && om.startup - opp.moveFrame >= 5 && rng.chance(p.sidestepChance)) {
          this.defendDir = 0;
          return this.runPlan([{ dir: rng.chance(0.5) ? 8 : 2, held: 0 }, N, N, N, N, N], false);
        }
      }
    }
    if (this.defendDir) return { dir: this.defendDir, held: 0 };
    return null;
  }

  private pickPunisher(frames: number, dist: number): AIMove | null {
    let best: AIMove | null = null;
    let bestScore = -1;
    for (const m of this.moves!) {
      const mv = m.move;
      if (mv.projectile || mv.throw || mv.toggleWeapon || mv.context !== 'normal') continue;
      if (m.startup > frames || m.range < dist) continue;
      const score = m.damage + (mv.onHit.type === 'launch' ? 14 : mv.onHit.type === 'knockdown' ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  private punish(self: Fighter, opp: Fighter): InputFrame | null {
    const om = opp.move;
    if (!om || !opp.sm.is('attack') || opp.moveFrame <= om.activeEnd + Math.floor(this.p.reaction / 2)) return null;
    if (this.punishedSerial === opp.moveSerial) return null;
    this.punishedSerial = opp.moveSerial;
    const remaining = om.total - opp.moveFrame;
    if (remaining < 8 || !this.rng.chance(this.p.punishChance)) return null;
    const pm = this.pickPunisher(remaining, self.distToOpponent());
    return pm ? this.runPlan(pm.inputs, false) : null;
  }

  private juggleRoutine(): InputFrame[] {
    const ms = this.moves!;
    const starter = ms.find((m) => m.move.chain.length > 0 && m.move.level !== 'low');
    const out: InputFrame[] = [];
    if (starter) {
      out.push(...starter.inputs);
      let cur: MoveDef | undefined = starter.move;
      let guard = 0;
      while (cur && cur.chain.length && guard++ < 4) {
        const c: ChainDef = cur.chain[0];
        for (let i = 0; i < 5; i++) out.push(N);
        out.push({ dir: 5, held: c.input.buttons }, N);
        cur = this.selfMoves?.[c.moveId];
      }
      return out;
    }
    const fast = [...ms].filter((m) => m.move.hitbox && m.move.level !== 'low').sort((a, b) => a.startup - b.startup)[0];
    return fast ? fast.inputs : [N];
  }

  private selfMoves: Record<string, MoveDef> | null = null;

  private juggle(self: Fighter, opp: Fighter): InputFrame | null {
    if (!opp.sm.is('juggle') || opp.juggleProtected || opp.dead) return null;
    if (this.comboSerial !== opp.sm.serial) {
      this.comboSerial = opp.sm.serial;
      this.comboActive = this.rng.chance(this.p.comboChance);
    }
    if (!this.comboActive) return null;
    const dist = self.distToOpponent();
    if (dist > 1.35) return { dir: 6, held: 0 };
    if (opp.pos.y > 1.7) return N;
    this.comboActive = false;
    return this.runPlan(this.juggleRoutine(), false);
  }

  private oki(self: Fighter, opp: Fighter): InputFrame | null {
    if (!opp.isLying() || opp.dead) return null;
    if (this.okiSerial !== opp.sm.serial) {
      this.okiSerial = opp.sm.serial;
      this.okiActive = this.rng.chance(this.p.okiChance);
    }
    if (!this.okiActive) return null;
    const dist = self.distToOpponent();
    const gm = this.moves!.find((m) => m.move.hitsGrounded && self.moveAvailable(m.move));
    if (gm && dist <= gm.range && opp.sm.is('grounded')) {
      this.okiActive = this.rng.chance(0.4);
      return this.runPlan(gm.inputs, false);
    }
    if (dist > 1.3) return { dir: 6, held: 0 };
    return N;
  }

  private chooseAttack(self: Fighter, opp: Fighter, dist: number): AIMove | null {
    const rng = this.rng;
    const cands = this.moves!.filter((m) => self.moveAvailable(m.move) && !m.move.projectile && (m.range >= dist || m.move.toggleWeapon));
    if (!cands.length) return null;
    if (!this.p.smart) return rng.pick(cands);
    const oppCrouchy = opp.isCrouching();
    const weights = cands.map((m) => {
      const mv = m.move;
      if (mv.toggleWeapon) return self.weaponDrawn ? 0.05 : 0.25;
      if (mv.throw) return dist <= mv.throw.range ? this.p.throwChance * 6 : 0;
      let w = 1;
      if (mv.level === 'mid') w += oppCrouchy ? 1.2 : 0.4;
      if (mv.level === 'high' && oppCrouchy) w *= 0.2;
      if (mv.level === 'low') w += 0.3;
      if (mv.onHit.type === 'launch') w += 0.4;
      if (mv.chain.length) w += 0.5;
      if (mv.onBlock.advantage < -12) w *= 0.6;
      return w;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  private stringInputs(m: AIMove): InputFrame[] {
    const out = [...m.inputs];
    let cur: MoveDef | undefined = m.move;
    let guard = 0;
    while (cur && cur.chain.length && guard++ < 4 && this.rng.chance(0.75)) {
      const c: ChainDef = cur.chain[0];
      for (let i = 0; i < 5; i++) out.push(N);
      out.push({ dir: 5, held: c.input.buttons }, N);
      cur = this.selfMoves?.[c.moveId];
    }
    return out;
  }

  private neutral(self: Fighter, opp: Fighter): InputFrame {
    const p = this.p;
    const rng = this.rng;
    if (this.cooldown > 0) {
      this.cooldown--;
      return N;
    }
    this.cooldown = rng.int(p.decision[0], p.decision[1]);
    const dist = self.distToOpponent();
    const proj = this.moves!.find((m) => m.move.projectile && self.moveAvailable(m.move));

    if (dist > 3.2) {
      if (proj && rng.chance(0.25)) return this.runPlan(proj.inputs, false);
      if (rng.chance(0.3)) return this.runPlan([{ dir: 6, held: 0 }, N, ...Array.from({ length: 16 }, () => ({ dir: 6, held: 0 }))], true);
      return this.hold(6, this.cooldown + 6);
    }
    if (dist > 1.6) {
      if (proj && rng.chance(0.12)) return this.runPlan(proj.inputs, false);
      const dashAttack = this.moves!.find((m) => m.move.command?.motion.length && m.move.command.dir === 'f' && !m.move.projectile);
      if (dashAttack && dist < dashAttack.range + 0.4 && rng.chance(0.15)) return this.runPlan(dashAttack.inputs, false);
      return this.hold(6, Math.min(this.cooldown + 4, 22));
    }
    if (!p.smart) {
      // 简单 AI：多数时候硬冲和乱出招，很少防守
      if (rng.chance(p.aggression + 0.2)) {
        const m = this.chooseAttack(self, opp, dist);
        if (m) return this.runPlan(m.inputs, false);
      }
      return rng.chance(0.6) ? this.hold(6, 10) : this.hold(5, 10);
    }
    if (rng.chance(p.aggression)) {
      const m = this.chooseAttack(self, opp, dist);
      if (m) return this.runPlan(m.move.chain.length ? this.stringInputs(m) : m.inputs, false);
    }
    const r = rng.next();
    if (r < p.backdashChance) return this.runPlan([{ dir: 4, held: 0 }, N, { dir: 4, held: 0 }, ...Array.from({ length: 10 }, () => N)], false);
    if (r < p.backdashChance + p.sidestepChance * 0.5) return this.runPlan([{ dir: rng.chance(0.5) ? 8 : 2, held: 0 }, N, N, N], false);
    if (r < 0.55) return this.hold(5, this.cooldown);
    if (r < 0.75) return this.hold(4, Math.min(this.cooldown, 12));
    return this.hold(6, 8);
  }
}

/** 练习模式假人：静止（不防御）/ 自动格挡 / 下蹲 / CPU */
export class DummyController implements InputController {
  private ai = new AIController('normal', 777);

  constructor(public mode: DummyMode) {}

  reset(): void {
    this.ai.reset();
  }

  poll(game: Game, self: Fighter): InputFrame {
    self.noGuard = this.mode === 'stand';
    if (this.mode === 'cpu') return this.ai.poll(game, self);
    if (self.sm.is('grounded')) return self.lieFrames > game.config.ground.minLieFrames ? { dir: 6, held: 0 } : N;
    if (this.mode === 'crouch') return { dir: 2, held: 0 };
    if (this.mode === 'guard') {
      const t = self.throwInfo;
      if (self.sm.is('thrown') && t && !t.back) return self.sm.frame === 3 ? { dir: 5, held: t.throwDef.breakInput } : N;
      const opp = self.opponent;
      const om = opp.move;
      if (opp.sm.is('attack') && om) {
        if (om.level === 'low') return { dir: 1, held: 0 };
        if (om.level === 'throw') return { dir: 2, held: 0 };
      }
      const proj = game.projectiles.list.find((pr) => pr.alive && pr.owner === opp && pr.def.level === 'low');
      if (proj) return { dir: 1, held: 0 };
      return N;
    }
    return N;
  }
}
