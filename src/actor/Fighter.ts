// 角色基类（纯逻辑）：血量、位置、朝向、状态机、硬直、招式执行
// 渲染层（FighterView）只读取这里的状态来摆姿势，不反向影响判定。
import { Vector3 } from 'three';
import type { GameConfig } from '../core/config';
import { frontCos } from '../core/CollisionSystem';
import { popcount } from '../core/FrameData';
import { consumeCommand, InputBuffer, matchCommand } from '../core/InputSystem';
import { approachAngle, forwardOf, horizontalDist, yawTo } from '../core/math';
import { StateMachine } from '../core/StateMachine';
import type {
  BodyZone,
  ChainDef,
  CharacterDef,
  CharacterStats,
  GameEvent,
  MoveContext,
  MoveDef,
  ProjectileDef,
  StrikeLevel,
  ThrowDef,
} from '../core/types';
import { FIGHTER_STATES, neutralControl } from './FighterStates';

export type FighterStateId =
  | 'intro'
  | 'idle'
  | 'walkF'
  | 'walkB'
  | 'crouch'
  | 'prejump'
  | 'jump'
  | 'land'
  | 'dash'
  | 'run'
  | 'runStop'
  | 'backdash'
  | 'sidestep'
  | 'attack'
  | 'throwing'
  | 'thrown'
  | 'throwBreak'
  | 'block'
  | 'hit'
  | 'stagger'
  | 'juggle'
  | 'grounded'
  | 'getup'
  | 'roll'
  | 'ko'
  | 'victory';

/** 可以自由行动（可出招、可移动）的状态 */
const ACTIONABLE: FighterStateId[] = ['idle', 'walkF', 'walkB', 'crouch', 'dash', 'run', 'runStop', 'backdash', 'sidestep', 'prejump', 'jump', 'land'];

/** 角色与游戏世界的交互接口（由 Game 实现） */
export interface FighterWorld {
  readonly config: GameConfig;
  readonly tick: number;
  readonly viewNormal: Vector3;
  readonly practice: boolean;
  emit(e: GameEvent): void;
  spawnProjectile(owner: Fighter, def: ProjectileDef): void;
  hasProjectile(owner: Fighter): boolean;
  applyThrowDamage(info: ThrowInfo): void;
  breakThrow(info: ThrowInfo): void;
}

export interface ThrowInfo {
  attacker: Fighter;
  victim: Fighter;
  move: MoveDef;
  throwDef: ThrowDef;
  damage: number;
  back: boolean;
  /** 投技开始时双方的位置与朝向（渲染层用来插值投掷轨迹） */
  attackerPos: Vector3;
  attackerFacing: number;
  victimStart: Vector3;
  landPos: Vector3;
  landed: boolean;
}

export type KnockKind = 'launch' | 'knockdown' | 'ko';

export class Fighter {
  readonly stats: CharacterStats;
  readonly cfg: GameConfig;
  opponent!: Fighter;
  readonly sm: StateMachine<Fighter, FighterStateId>;
  readonly input = new InputBuffer();

  pos = new Vector3();
  vel = new Vector3();
  /** 朝向角，前方 = (sin, 0, cos) */
  facing = 0;
  hp: number;
  maxHp: number;

  // —— 招式执行 ——
  move: MoveDef | null = null;
  moveFrame = 0;
  moveConnected = false;
  moveResult: 'whiff' | 'hit' | 'block' | 'counter' = 'whiff';
  queuedChain: ChainDef | null = null;
  projectileFired = false;
  armorUsed = false;
  lastMove: MoveDef | null = null;
  moveSerial = 0;

  // —— 硬直 / 受击 ——
  stun = 0;
  stunTotal = 0;
  hitZone: BodyZone = 'mid';
  hitCrouch = false;
  guardBroken = false;
  guardMeter = 0;
  juggleHits = 0;
  juggleProtected = false;
  knockKind: KnockKind = 'launch';
  comboHits = 0;
  comboDamage = 0;
  /** 被打中倒地追击时的弹起计时（渲染用） */
  groundBounce = 0;
  /** 受击闪白计时（渲染用） */
  flash = 0;

  // —— 移动相关 ——
  invuln = 0;
  wsWindow = 0;
  sideDir = 0;
  rollKind: 'back' | 'side' = 'back';
  jumpDir = 8;
  upTap = false;
  crouchTap = false;
  airAttackUsed = false;
  lieFrames = 0;
  getupTotal = 26;
  freeFrames = 0;

  weaponDrawn = false;
  throwInfo: ThrowInfo | null = null;
  dead = false;
  /** 练习模式假人：不自动防御 */
  noGuard = false;

  private onRight = true;
  private contextMoves = new Map<MoveContext, MoveDef[]>();

  constructor(
    readonly index: number,
    readonly def: CharacterDef,
    public world: FighterWorld,
  ) {
    this.stats = def.stats;
    this.cfg = world.config;
    this.maxHp = this.cfg.maxHealth;
    this.hp = this.maxHp;
    for (const m of def.commandMoves) {
      const list = this.contextMoves.get(m.context) ?? [];
      list.push(m);
      this.contextMoves.set(m.context, list);
    }
    this.sm = new StateMachine<Fighter, FighterStateId>(this, FIGHTER_STATES, 'intro');
  }

  reset(x: number, z: number, facing: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.facing = facing;
    this.hp = this.maxHp;
    this.move = null;
    this.stun = 0;
    this.guardMeter = 0;
    this.juggleHits = 0;
    this.juggleProtected = false;
    this.comboHits = 0;
    this.comboDamage = 0;
    this.invuln = 0;
    this.wsWindow = 0;
    this.weaponDrawn = false;
    this.throwInfo = null;
    this.dead = false;
    this.flash = 0;
    this.groundBounce = 0;
    this.input.clear();
    this.sm.change('intro');
  }

  get state(): FighterStateId {
    return this.sm.id;
  }

  // ------------------------------------------------------------------ 每帧更新

  update(): void {
    if (this.invuln > 0) this.invuln--;
    if (this.wsWindow > 0) this.wsWindow--;
    if (this.flash > 0) this.flash--;
    if (this.groundBounce > 0) this.groundBounce--;
    if (!this.sm.is('block')) this.guardMeter = Math.max(0, this.guardMeter - this.cfg.guardBreak.decayPerFrame);

    this.sm.update();

    if (!this.isFlying()) {
      // 地面滑动速度（击退 / 格挡推开）带摩擦衰减
      this.pos.x += this.vel.x;
      this.pos.z += this.vel.z;
      const fr = this.cfg.friction;
      this.vel.x = Math.abs(this.vel.x * fr) < 1e-4 ? 0 : this.vel.x * fr;
      this.vel.z = Math.abs(this.vel.z * fr) < 1e-4 ? 0 : this.vel.z * fr;
      this.vel.y = 0;
      this.pos.y = 0;
    }

    if (this.isActionable()) {
      this.freeFrames++;
      if (!this.sm.is('jump')) {
        this.comboHits = 0;
        this.comboDamage = 0;
        this.juggleHits = 0;
        this.juggleProtected = false;
      }
    } else {
      this.freeFrames = 0;
    }
  }

  /** 空中物理；落地返回 true */
  airPhysics(): boolean {
    this.vel.y -= this.stats.gravity;
    this.pos.add(this.vel);
    if (this.pos.y <= 0 && this.vel.y < 0) {
      this.pos.y = 0;
      this.vel.set(0, 0, 0);
      this.world.emit({ type: 'land', fighter: this.index, heavy: false, pos: { x: this.pos.x, y: 0, z: this.pos.z } });
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ 查询

  isActionable(): boolean {
    return ACTIONABLE.includes(this.sm.id);
  }

  /** 处于空中物理控制下的状态 */
  isFlying(): boolean {
    return this.sm.is('jump', 'juggle') || (this.sm.is('attack') && this.move?.context === 'air');
  }

  isAirborne(): boolean {
    return this.isFlying() || this.pos.y > 0.05;
  }

  isLying(): boolean {
    if (this.sm.is('grounded', 'ko', 'roll')) return true;
    if (this.sm.is('getup')) return this.sm.frame < this.getupTotal * 0.4;
    if (this.sm.is('attack') && this.move?.context === 'ground') {
      return this.move.endsGrounded || this.moveFrame < this.move.startup * 0.5;
    }
    if (this.sm.is('thrown')) return this.throwInfo?.landed ?? false;
    return false;
  }

  isCrouching(): boolean {
    if (this.sm.is('crouch')) return true;
    if (this.sm.is('attack') && this.move) {
      if (this.move.crouching) return this.moveFrame <= this.move.total - 4;
      if (this.move.context === 'ground') return !this.isLying() && this.moveFrame < this.move.startup;
      return false;
    }
    if (this.sm.is('hit', 'block')) return this.hitCrouch;
    if (this.sm.is('getup')) return this.sm.frame < this.getupTotal * 0.75;
    return false;
  }

  /** 当前防御姿态：stand 防上中段，crouch 防下段，null 不能防御 */
  guardStance(): 'stand' | 'crouch' | null {
    if (this.noGuard) return null;
    const d = this.input.dir();
    switch (this.sm.id) {
      case 'idle':
      case 'walkB':
      case 'land':
      case 'block':
        return d <= 3 ? 'crouch' : 'stand';
      case 'crouch':
        return d === 1 || d === 2 ? 'crouch' : null;
      case 'backdash':
        return this.sm.frame >= this.stats.backdashFrames * 0.6 ? 'stand' : null;
      case 'getup':
        return this.sm.frame >= this.getupTotal - 6 ? 'stand' : null;
      default:
        return null;
    }
  }

  canBlock(level: StrikeLevel, fromX: number, fromZ: number): boolean {
    const g = this.guardStance();
    if (!g) return false;
    if (frontCos(this, fromX, fromZ) < -0.17) return false; // 背后受击无法防御
    return level === 'low' ? g === 'crouch' : g === 'stand';
  }

  /** 出招前摇 / 判定中被打 = Counter Hit */
  isCounterHittable(): boolean {
    return this.sm.is('attack') && this.move !== null && this.moveFrame <= this.move.activeEnd && this.move.context !== 'ground';
  }

  isHittable(): boolean {
    if (this.invuln > 0 || this.dead) return false;
    return !this.sm.is('thrown', 'throwing', 'throwBreak', 'ko', 'intro', 'victory', 'roll');
  }

  isThrowable(): boolean {
    if (!this.isHittable()) return false;
    if (this.isAirborne() || this.isLying() || this.isCrouching()) return false;
    return !this.sm.is('hit', 'block', 'juggle', 'getup', 'grounded');
  }

  isArmored(): boolean {
    const m = this.move;
    return this.sm.is('attack') && !!m?.armor && !this.armorUsed && this.moveFrame >= m.armor[0] && this.moveFrame <= m.armor[1];
  }

  ignoresPush(): boolean {
    return this.sm.is('thrown', 'throwing') || this.isLying();
  }

  distToOpponent(): number {
    return horizontalDist(this.pos, this.opponent.pos);
  }

  forward(out = new Vector3()): Vector3 {
    return forwardOf(this.facing, out);
  }

  /** 对手是否在屏幕右侧（用于把键盘左右转换成前后），带滞回避免抖动 */
  opponentOnRight(): boolean {
    const n = this.world.viewNormal;
    const dx = this.opponent.pos.x - this.pos.x;
    const dz = this.opponent.pos.z - this.pos.z;
    const s = dx * n.z - dz * n.x; // 屏幕右方向 = (n.z, 0, -n.x)
    if (Math.abs(s) > 0.05) this.onRight = s > 0;
    return this.onRight;
  }

  // ------------------------------------------------------------------ 动作

  faceOpponent(maxStep = Infinity): void {
    if (this.distToOpponent() < 0.05) return;
    const target = yawTo(this.pos, this.opponent.pos);
    this.facing = maxStep === Infinity ? target : approachAngle(this.facing, target, maxStep);
  }

  moveForward(d: number): void {
    this.pos.x += Math.sin(this.facing) * d;
    this.pos.z += Math.cos(this.facing) * d;
  }

  /** 绕对手做圆周移动（侧移 / 侧滚）；正值 = 远离镜头（进入画面深处） */
  circleStep(amount: number): void {
    const o = this.opponent.pos;
    let dx = this.pos.x - o.x;
    let dz = this.pos.z - o.z;
    const dist = Math.hypot(dx, dz) || 1;
    let px = -dz / dist;
    let pz = dx / dist;
    const vn = this.world.viewNormal;
    if (px * -vn.x + pz * -vn.z < 0) {
      px = -px;
      pz = -pz;
    }
    this.pos.x += px * amount;
    this.pos.z += pz * amount;
    if (dist > 0.4) {
      dx = this.pos.x - o.x;
      dz = this.pos.z - o.z;
      const nd = Math.hypot(dx, dz) || 1;
      this.pos.x = o.x + (dx / nd) * dist;
      this.pos.z = o.z + (dz / nd) * dist;
    }
  }

  moveAvailable(m: MoveDef): boolean {
    if (m.requiresWeapon === true && !this.weaponDrawn) return false;
    if (m.requiresWeapon === false && this.weaponDrawn) return false;
    if (m.projectile && this.world.hasProjectile(this)) return false;
    return true;
  }

  /**
   * 在输入缓冲中按优先级查找可用招式。
   * 顺序：上下文优先级 → 按键数多的 → 严格方向/方向序列 → 宽松方向 → 无方向。
   */
  findCommand(
    contexts: MoveContext[],
    window: number,
    includeConsumed = false,
    filter?: (m: MoveDef) => boolean,
  ): { move: MoveDef; ago: number } | null {
    for (const ctx of contexts) {
      const list = this.contextMoves.get(ctx);
      if (!list) continue;
      let i = 0;
      while (i < list.length) {
        const bc = popcount(list[i].command!.buttons);
        let j = i;
        while (j < list.length && popcount(list[j].command!.buttons) === bc) j++;
        for (let pass = 0; pass < 3; pass++) {
          for (let k = i; k < j; k++) {
            const m = list[k];
            const c = m.command!;
            if (pass === 0 && !c.dir) continue;
            if (pass === 1 && (!c.dir || c.motion.length)) continue;
            if (pass === 2 && c.dir) continue;
            if (!this.moveAvailable(m) || (filter && !filter(m))) continue;
            const ago = matchCommand(this.input, c, window, pass === 1, includeConsumed);
            if (ago >= 0) return { move: m, ago };
          }
        }
        i = j;
      }
    }
    return null;
  }

  tryCommands(contexts: MoveContext[]): boolean {
    const found = this.findCommand(contexts, this.cfg.input.bufferFrames);
    if (!found) return false;
    this.startMove(found.move, found.ago);
    return true;
  }

  startMove(m: MoveDef, ago: number, chained = false): void {
    if (ago >= 0 && m.command) consumeCommand(this.input, m.command, ago);
    this.sm.change('attack', { move: m, chained });
  }

  /** 招式结束：回到站立 / 下蹲 / 倒地，并在同一帧处理缓冲输入 */
  endMove(): void {
    const m = this.move;
    if (m?.endsGrounded) {
      this.sm.change('grounded', { resume: true });
      return;
    }
    if (m?.context === 'air' && this.pos.y > 0.001) {
      this.sm.change('jump', { resume: true });
      return;
    }
    const d = this.input.dir();
    if (m?.crouching && d <= 3) {
      this.sm.change('crouch', { noTap: true });
    } else {
      if (m?.crouching) this.wsWindow = this.cfg.input.wsWindowFrames;
      this.sm.change('idle');
    }
    neutralControl(this, this.sm.id);
  }

  /** 硬直结束：根据当前方向回到站立或下蹲，同帧可出招（保证帧优势精确） */
  recoverNeutral(): void {
    const d = this.input.dir();
    if (d <= 3) this.sm.change('crouch', { noTap: true });
    else this.sm.change('idle');
    neutralControl(this, this.sm.id);
  }

  takeDamage(dmg: number): void {
    this.hp -= dmg;
    if (this.world.practice) this.hp = Math.max(1, this.hp);
    else if (this.hp < 0) this.hp = 0;
    this.flash = 6;
  }

  startJuggle(vy: number, dx: number, dz: number, speed: number, kind: KnockKind): void {
    this.sm.change('juggle', { vy, dx, dz, speed, kind });
  }
}
