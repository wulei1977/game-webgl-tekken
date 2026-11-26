// 全局共享类型与常量（逻辑层，不依赖渲染）

/** 铁拳四键：左拳 / 右拳 / 左脚 / 右脚（位掩码） */
export const BTN = { LP: 1, RP: 2, LK: 4, RK: 8 } as const;
export type ButtonName = keyof typeof BTN;
export const BUTTON_NAMES: ButtonName[] = ['LP', 'RP', 'LK', 'RK'];

/** 攻击段位。none = 本体无攻击判定（如拔棍、发射飞行道具的出手动作） */
export type Level = 'high' | 'mid' | 'low' | 'throw' | 'none';
export type StrikeLevel = 'high' | 'mid' | 'low';
export type HitType = 'normal' | 'stagger' | 'launch' | 'knockdown';
/** 招式可用的姿态上下文：normal 站立/下蹲/行走，ws 起身中，air 空中，ground 倒地，run 奔跑 */
export type MoveContext = 'normal' | 'ws' | 'air' | 'ground' | 'run';
export type Limb = 'handL' | 'handR' | 'footL' | 'footR';
export type ThrowType = 'over' | 'lift' | 'suplex' | 'takedown' | 'backslam';
export type ProjectileKind = 'shockwave' | 'shock' | 'flash' | 'cannon';
export type BodyZone = 'high' | 'mid' | 'low';

/** 方向记号（相对角色朝向）：f 前 b 后 u 上 d 下，n 中立 */
export type DirToken = 'n' | 'f' | 'b' | 'u' | 'd' | 'uf' | 'ub' | 'df' | 'db';

export interface ParsedCommand {
  text: string;
  /** 按键之前的方向序列，例如 f,f+RK 的 ['f']、qcf 的 ['d','df'] */
  motion: DirToken[];
  /** 按键时需要保持的方向；null 表示任意方向 */
  dir: DirToken | null;
  buttons: number;
  priority: number;
}

export interface HitboxDef {
  /** 攻击盒中心相对角色脚底：前方距离 / 高度 / 侧向偏移（米） */
  reach: number;
  height: number;
  lateral: number;
  radius: number;
}

export interface HitProps {
  /** 命中后的帧优势（正数 = 攻击方先恢复） */
  advantage: number;
  type: HitType;
  /** 浮空初速度（米/帧） */
  launch: number;
  /** 命中击退距离（米） */
  knockback: number;
}

export interface BlockProps {
  advantage: number;
  pushback: number;
}

export interface ChainDef {
  inputText: string;
  input: ParsedCommand;
  moveId: string;
  /** 允许输入的帧区间 [from, to]（母招式帧号，1 起） */
  window: [number, number];
  /** 最早可以切入下一段的帧 */
  cancel: number;
}

export interface ThrowDef {
  range: number;
  /** 挣脱所需按键掩码，0 表示不可挣脱 */
  breakInput: number;
  breakText: string;
  duration: number;
  damageFrame: number;
  type: ThrowType;
  swap: boolean;
}

export interface ProjectileDef {
  kind: ProjectileKind;
  spawnFrame: number;
  speed: number;
  lifetime: number;
  radius: number;
  height: number;
  damage: number;
  level: StrikeLevel;
  hitStun: number;
  blockStun: number;
  pushback: number;
  onHitType: HitType;
  launch: number;
  explodeRadius: number;
}

export interface AnimDef {
  type: string;
  limb?: Limb;
}

export interface MoveDef {
  id: string;
  name: string;
  commandText: string;
  /** null：只能通过连段或系统触发（chain / auto） */
  command: ParsedCommand | null;
  context: MoveContext;
  startup: number;
  active: number;
  recovery: number;
  /** 最后一个判定帧 */
  activeEnd: number;
  total: number;
  level: Level;
  damage: number;
  weapon: boolean;
  /** true 只在持械时可用，false 只在徒手时可用，null 不限 */
  requiresWeapon: boolean | null;
  hitbox: HitboxDef | null;
  onHit: HitProps;
  onCounter: HitProps;
  onBlock: BlockProps;
  chain: ChainDef[];
  tracking: number;
  advance: number;
  crouching: boolean;
  armor: [number, number] | null;
  hitsGrounded: boolean;
  clashesProjectiles: boolean;
  endsGrounded: boolean;
  throw: ThrowDef | null;
  projectile: ProjectileDef | null;
  toggleWeapon: number;
  anim: AnimDef;
}

export interface CharacterStats {
  height: number;
  scale: number;
  weight: number;
  walkSpeed: number;
  backWalkSpeed: number;
  dashSpeed: number;
  dashFrames: number;
  runSpeed: number;
  backdashDistance: number;
  backdashFrames: number;
  sidestepDistance: number;
  sidestepFrames: number;
  jumpVelocity: number;
  jumpForwardSpeed: number;
  gravity: number;
  crouchHeight: number;
  hurtRadius: number;
  pushRadius: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  style: string;
  archetype: string;
  description: string;
  ratings: { power: number; speed: number; reach: number; difficulty: number };
  weapon: { name: string; damageMultiplier: number } | null;
  stats: CharacterStats;
  moves: Record<string, MoveDef>;
  /** 可由指令直接触发的招式，按指令复杂度从高到低排序 */
  commandMoves: MoveDef[];
}

/** 每帧一个玩家的输入（方向为相对角色朝向的小键盘记号 1~9，5 为中立） */
export interface InputFrame {
  dir: number;
  held: number;
}

/** 屏幕方向的原始输入（键盘 / 手柄） */
export interface RawInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  LP: boolean;
  RP: boolean;
  LK: boolean;
  RK: boolean;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export type AnnounceKind = 'round' | 'fight' | 'ko' | 'doubleko' | 'time' | 'win' | 'draw' | 'perfect';

export type GameEvent =
  | {
      type: 'hit';
      attacker: number;
      defender: number;
      damage: number;
      level: StrikeLevel;
      zone: BodyZone;
      counter: boolean;
      heavy: boolean;
      launch: boolean;
      airborne: boolean;
      grounded: boolean;
      weapon: boolean;
      projectile: ProjectileKind | null;
      moveId: string;
      combo: number;
      comboDamage: number;
      pos: Vec3Like;
    }
  | { type: 'block'; attacker: number; defender: number; level: StrikeLevel; projectile: ProjectileKind | null; pos: Vec3Like }
  | { type: 'guardBreak'; defender: number; pos: Vec3Like }
  | { type: 'armor'; defender: number; pos: Vec3Like }
  | { type: 'attack'; fighter: number; moveId: string; heavy: boolean }
  | { type: 'throwStart'; attacker: number; defender: number; moveId: string; back: boolean }
  | { type: 'throwHit'; attacker: number; defender: number; damage: number; pos: Vec3Like }
  | { type: 'throwBreak'; attacker: number; defender: number; pos: Vec3Like }
  | { type: 'projectileSpawn'; owner: number; id: number; kind: ProjectileKind }
  | { type: 'projectileEnd'; id: number; kind: ProjectileKind; reason: 'hit' | 'block' | 'clash' | 'expire'; pos: Vec3Like }
  | { type: 'land'; fighter: number; heavy: boolean; pos: Vec3Like }
  | { type: 'jump'; fighter: number }
  | { type: 'step'; fighter: number }
  | { type: 'weapon'; fighter: number; drawn: boolean }
  | { type: 'announce'; kind: AnnounceKind; text: string }
  | { type: 'ko'; loser: number; double: boolean }
  | { type: 'roundStart'; round: number }
  | { type: 'fight' }
  | { type: 'roundEnd'; winner: number; perfect: boolean }
  | { type: 'matchEnd'; winner: number };

export type MatchMode = 'vs' | 'cpu' | 'practice' | 'demo';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type DummyMode = 'stand' | 'guard' | 'crouch' | 'cpu';

export interface MatchSetup {
  mode: MatchMode;
  p1: string;
  p2: string;
  difficulty: Difficulty;
  dummy: DummyMode;
}
