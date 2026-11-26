// 游戏主逻辑：60Hz 固定帧推进、回合管理（三局两胜）、胜负判定、事件派发
// 只包含逻辑，可在 Node 中无渲染运行（单元测试 / AI 自对战）。
import { Vector3 } from 'three';
import { Fighter, type FighterWorld, type ThrowInfo } from '../actor/Fighter';
import { getCharacter } from '../actor/MoveSet';
import { ProjectileManager, type Projectile, type ProjectileHost } from '../projectile/ProjectileManager';
import { applyBlockStun, applyHit, applyThrowDamage, breakThrow, resolveStrikes, resolveThrows, type CombatHost } from './Combat';
import { bodyCapsules, clampToArena, pushApart, sphereVsBody } from './CollisionSystem';
import { gameConfig, type GameConfig } from './config';
import type { GameEvent, InputFrame, MatchSetup, MoveDef, ProjectileDef } from './types';

export interface InputController {
  poll(game: Game, self: Fighter): InputFrame;
  reset?(): void;
}

export const NEUTRAL: InputFrame = { dir: 5, held: 0 };

export type Phase = 'intro' | 'fight' | 'ko' | 'roundEnd' | 'matchEnd';

export interface ExchangeInfo {
  attacker: number;
  defender: number;
  moveId: string | null;
  result: 'hit' | 'block' | 'counter';
  /** 实测帧优势（攻击方视角），测量完成前为 null */
  advantage: number | null;
  tick: number;
  serial: number;
  pending: boolean;
}

export class Game implements FighterWorld, CombatHost, ProjectileHost {
  readonly config: GameConfig = gameConfig;
  readonly fighters: [Fighter, Fighter];
  readonly projectiles = new ProjectileManager();
  /** 镜头所在一侧的水平法线：始终垂直于两名角色的连线（铁拳式侧视角） */
  readonly viewNormal = new Vector3(0, 0, 1);
  events: GameEvent[] = [];
  tick = 0;
  /** 实际推进的模拟帧数（打击停顿期间不增加），渲染层用于动作计时 */
  simFrame = 0;
  phase: Phase = 'intro';
  phaseFrame = 0;
  round = 1;
  wins: [number, number] = [0, 0];
  timer = 0;
  hitstop = 0;
  winner = -1;
  roundWinner = -1;
  timeUp = false;
  lastExchange: ExchangeInfo | null = null;
  private pendingHeld = [0, 0];
  private pending = [false, false];

  constructor(
    readonly setup: MatchSetup,
    readonly controllers: [InputController, InputController],
  ) {
    const f1 = new Fighter(0, getCharacter(setup.p1), this);
    const f2 = new Fighter(1, getCharacter(setup.p2), this);
    f1.opponent = f2;
    f2.opponent = f1;
    this.fighters = [f1, f2];
    this.startRound(1);
  }

  get practice(): boolean {
    return this.setup.mode === 'practice';
  }

  get timerEnabled(): boolean {
    return !this.practice && this.config.roundTimeSeconds > 0;
  }

  /** 慢动作倍率（KO 瞬间） */
  timeScale(): number {
    if (this.phase === 'ko' && !this.timeUp && this.phaseFrame < this.config.ko.slowmoFrames) return this.config.ko.slowmoScale;
    return 1;
  }

  isFinalRound(): boolean {
    const n = this.config.roundsToWin - 1;
    return this.wins[0] === n && this.wins[1] === n;
  }

  startRound(n: number): void {
    this.round = n;
    this.phase = 'intro';
    this.phaseFrame = 0;
    this.hitstop = 0;
    this.timeUp = false;
    this.roundWinner = -1;
    this.lastExchange = null;
    const d = this.config.startDistance / 2;
    this.fighters[0].reset(-d, 0, Math.PI / 2);
    this.fighters[1].reset(d, 0, -Math.PI / 2);
    this.viewNormal.set(0, 0, 1);
    this.projectiles.clear();
    this.timer = this.config.roundTimeSeconds * this.config.fps;
    this.pending = [false, false];
    this.pendingHeld = [0, 0];
    for (const c of this.controllers) c.reset?.();
    this.emit({ type: 'roundStart', round: n });
  }

  restartMatch(): void {
    this.wins = [0, 0];
    this.winner = -1;
    this.startRound(1);
  }

  /** 推进一个逻辑帧（1/60 秒） */
  step(): void {
    this.tick++;
    const live = this.phase === 'fight';
    for (let i = 0; i < 2; i++) {
      const f = this.fighters[i];
      let frame = live ? this.controllers[i].poll(this, f) : NEUTRAL;
      if (this.hitstop > 0) {
        // 打击停顿期间按下的键先暂存，停顿结束后再写入缓冲，避免输入“过期”
        this.pendingHeld[i] |= frame.held;
        this.pending[i] = true;
        continue;
      }
      if (this.pending[i]) {
        frame = { dir: frame.dir, held: frame.held | this.pendingHeld[i] };
        this.pending[i] = false;
        this.pendingHeld[i] = 0;
      }
      f.input.push(frame);
    }
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.simFrame++;
    this.phaseFrame++;
    for (const f of this.fighters) f.update();
    this.projectiles.update(this, this.fighters);
    resolveStrikes(this, this.fighters);
    resolveThrows(this, this.fighters);
    const [a, b] = this.fighters;
    pushApart(a, b);
    clampToArena(a, this.config.arenaRadius);
    clampToArena(b, this.config.arenaRadius);
    this.updateViewNormal();
    this.updateExchange();
    if (this.practice) this.practiceRefill();
    this.updatePhase();
  }

  /** 取出本帧之前累计的事件（渲染 / 音效 / UI 消费） */
  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private updateViewNormal(): void {
    const [a, b] = this.fighters;
    const ax = b.pos.x - a.pos.x;
    const az = b.pos.z - a.pos.z;
    const len = Math.hypot(ax, az);
    if (len < 0.1) return;
    let nx = -az / len;
    let nz = ax / len;
    const vn = this.viewNormal;
    if (nx * vn.x + nz * vn.z < 0) {
      nx = -nx;
      nz = -nz;
    }
    vn.x += (nx - vn.x) * 0.06;
    vn.z += (nz - vn.z) * 0.06;
    vn.y = 0;
    vn.normalize();
  }

  private updatePhase(): void {
    const R = this.config.round;
    switch (this.phase) {
      case 'intro': {
        const len = this.practice ? 30 : R.introFrames;
        if (!this.practice && this.phaseFrame === R.announceRoundFrame) {
          this.emit({ type: 'announce', kind: 'round', text: this.isFinalRound() ? 'FINAL ROUND' : `ROUND ${this.round}` });
        }
        if (!this.practice && this.phaseFrame === Math.round((R.announceRoundFrame + R.announceFightFrame) / 2) + 6) {
          this.emit({ type: 'announce', kind: 'round', text: 'READY' });
        }
        if (this.phaseFrame === (this.practice ? 8 : R.announceFightFrame)) this.emit({ type: 'announce', kind: 'fight', text: 'FIGHT!' });
        if (this.phaseFrame >= len) {
          this.phase = 'fight';
          this.phaseFrame = 0;
          for (const f of this.fighters) f.sm.change('idle');
          this.emit({ type: 'fight' });
        }
        break;
      }
      case 'fight': {
        const dead = this.fighters.filter((f) => f.hp <= 0);
        if (dead.length) {
          this.enterKO(dead.length === 2 ? -1 : dead[0].index === 0 ? 1 : 0, dead.length === 2);
          break;
        }
        if (this.timerEnabled) {
          this.timer--;
          if (this.timer <= 0) {
            this.timer = 0;
            this.timeUp = true;
            const [p1, p2] = this.fighters;
            const r1 = p1.hp / p1.maxHp;
            const r2 = p2.hp / p2.maxHp;
            this.roundWinner = r1 > r2 ? 0 : r2 > r1 ? 1 : -1;
            this.phase = 'ko';
            this.phaseFrame = 0;
            this.emit({ type: 'announce', kind: 'time', text: 'TIME UP' });
          }
        }
        break;
      }
      case 'ko': {
        const settled = this.fighters.every((f) => !f.isAirborne() && !f.sm.is('thrown', 'throwing'));
        if (this.phaseFrame >= this.config.ko.holdFrames && (settled || this.phaseFrame > this.config.ko.holdFrames + 120)) this.endRound();
        break;
      }
      case 'roundEnd': {
        if (this.phaseFrame >= R.endFrames) {
          const need = this.config.roundsToWin;
          if (this.wins[0] >= need || this.wins[1] >= need) {
            this.phase = 'matchEnd';
            this.phaseFrame = 0;
            this.winner = this.wins[0] > this.wins[1] ? 0 : this.wins[1] > this.wins[0] ? 1 : -1;
            this.emit({ type: 'matchEnd', winner: this.winner });
          } else {
            this.startRound(this.round + 1);
          }
        }
        break;
      }
      case 'matchEnd': {
        // 演示模式（菜单背景 AI 自对战）自动重开
        if (this.setup.mode === 'demo' && this.phaseFrame > 180) this.restartMatch();
        break;
      }
    }
  }

  private enterKO(winner: number, double: boolean): void {
    this.phase = 'ko';
    this.phaseFrame = 0;
    this.roundWinner = winner;
    const loser = double ? -1 : 1 - winner;
    this.emit({ type: 'ko', loser, double });
    this.emit({ type: 'announce', kind: double ? 'doubleko' : 'ko', text: double ? 'DOUBLE K.O.' : 'K.O.' });
  }

  private endRound(): void {
    const w = this.roundWinner;
    const need = this.config.roundsToWin;
    if (w >= 0) {
      this.wins[w]++;
    } else if (!(this.wins[0] + 1 >= need && this.wins[1] + 1 >= need)) {
      // 平局双方各得一分；若会导致双方同时获胜则重赛本回合
      this.wins[0]++;
      this.wins[1]++;
    }
    const perfect = w >= 0 && this.fighters[w].hp >= this.fighters[w].maxHp;
    if (w >= 0 && !this.fighters[w].dead) this.fighters[w].sm.change('victory');
    this.phase = 'roundEnd';
    this.phaseFrame = 0;
    this.emit({ type: 'roundEnd', winner: w, perfect });
    this.emit({
      type: 'announce',
      kind: w < 0 ? 'draw' : perfect ? 'perfect' : 'win',
      text: w < 0 ? 'DRAW' : perfect ? 'PERFECT' : `${this.fighters[w].def.name} WINS`,
    });
  }

  private practiceRefill(): void {
    for (const f of this.fighters) {
      if (f.freeFrames >= this.config.practice.refillDelayFrames && f.hp < f.maxHp) f.hp = f.maxHp;
    }
  }

  // ------------------------------------------------------------------ 帧优势实测（练习模式帧数据面板）

  noteExchange(attacker: Fighter, defender: Fighter, result: 'hit' | 'block' | 'counter', move: MoveDef | null): void {
    this.lastExchange = {
      attacker: attacker.index,
      defender: defender.index,
      moveId: move?.id ?? null,
      result,
      advantage: null,
      tick: this.tick,
      serial: attacker.moveSerial,
      pending: true,
    };
  }

  private updateExchange(): void {
    const ex = this.lastExchange;
    if (!ex || !ex.pending) return;
    const a = this.fighters[ex.attacker];
    const d = this.fighters[ex.defender];
    if (a.moveSerial !== ex.serial || this.tick - ex.tick > 180) {
      ex.pending = false;
      return;
    }
    if (a.isActionable() && d.isActionable()) {
      ex.advantage = a.freeFrames - d.freeFrames;
      ex.pending = false;
    }
  }

  // ------------------------------------------------------------------ FighterWorld / CombatHost / ProjectileHost

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  spawnProjectile(owner: Fighter, def: ProjectileDef): void {
    const p = this.projectiles.spawn(owner, def);
    this.emit({ type: 'projectileSpawn', owner: owner.index, id: p.id, kind: def.kind });
  }

  hasProjectile(owner: Fighter): boolean {
    return this.projectiles.has(owner);
  }

  applyThrowDamage(info: ThrowInfo): void {
    applyThrowDamage(this, info);
  }

  breakThrow(info: ThrowInfo): void {
    breakThrow(this, info);
  }

  projectileHit(p: Projectile, target: Fighter): void {
    p.alive = false;
    const d = p.def;
    const fromX = target.pos.x - p.dir.x;
    const fromZ = target.pos.z - p.dir.z;
    const zone = sphereVsBody({ center: p.pos, radius: Math.max(d.radius, d.explodeRadius) }, bodyCapsules(target)) ?? 'mid';
    if (!target.isAirborne() && target.canBlock(d.level, fromX, fromZ)) {
      applyBlockStun(this, p.owner, target, d.blockStun, d.damage, d.pushback, d.level, d.kind, p.pos, { x: fromX, z: fromZ });
      this.projectileEnd(p, 'block');
      return;
    }
    applyHit(this, target, {
      attacker: p.owner,
      level: d.level,
      damage: d.damage,
      zone,
      counter: target.isCounterHittable(),
      pos: p.pos.clone(),
      stun: d.hitStun,
      type: d.onHitType,
      launch: d.launch,
      knockback: d.pushback,
      dirX: p.dir.x,
      dirZ: p.dir.z,
      weapon: false,
      projectile: d.kind,
      move: null,
    });
    this.projectileEnd(p, 'hit');
  }

  projectileEnd(p: Projectile, reason: 'hit' | 'block' | 'clash' | 'expire'): void {
    this.emit({ type: 'projectileEnd', id: p.id, kind: p.def.kind, reason, pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z } });
  }
}
