// 招式帧数据解析器：读取招式 JSON，校验字段并解析出招指令
import {
  BTN,
  type ButtonName,
  type CharacterDef,
  type CharacterStats,
  type ChainDef,
  type DirToken,
  type HitProps,
  type HitType,
  type Level,
  type MoveContext,
  type MoveDef,
  type ParsedCommand,
  type ProjectileDef,
  type ProjectileKind,
  type ThrowType,
} from './types';

const DIR_TOKENS: DirToken[] = ['n', 'f', 'b', 'u', 'd', 'uf', 'ub', 'df', 'db'];
const LEVELS: Level[] = ['high', 'mid', 'low', 'throw', 'none'];
const HIT_TYPES: HitType[] = ['normal', 'stagger', 'launch', 'knockdown'];
const CONTEXTS: MoveContext[] = ['normal', 'ws', 'air', 'ground', 'run'];
const THROW_TYPES: ThrowType[] = ['over', 'lift', 'suplex', 'takedown', 'backslam'];
const PROJECTILE_KINDS: ProjectileKind[] = ['shockwave', 'shock', 'flash', 'cannon'];
/** 指令宏：四分之一圆 */
const MACROS: Record<string, string> = { qcf: 'd,df,f', qcb: 'd,db,b' };

/** 方向记号 → 小键盘数字（相对朝向，6 = 前） */
export const DIR_NUM: Record<DirToken, number> = { n: 5, f: 6, b: 4, u: 8, d: 2, uf: 9, ub: 7, df: 3, db: 1 };

export function popcount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}

export function buttonMask(text: string): number {
  if (text === 'none' || text === '') return 0;
  let mask = 0;
  for (const part of text.split('+')) {
    const b = BTN[part as ButtonName];
    if (!b) throw new Error(`未知按键 "${part}"（"${text}"）`);
    mask |= b;
  }
  return mask;
}

export function parseCommand(text: string): ParsedCommand {
  let t = text.replace(/\s+/g, '');
  t = t.replace(/\b(qcf|qcb)\b/g, (m) => MACROS[m]);
  const tokens = t.split(',');
  const last = tokens.pop() ?? '';
  let dir: DirToken | null = null;
  let buttons = 0;
  for (const part of last.split('+')) {
    if (part in BTN) {
      buttons |= BTN[part as ButtonName];
    } else if ((DIR_TOKENS as string[]).includes(part)) {
      if (dir) throw new Error(`指令 "${text}" 含有多个方向`);
      dir = part as DirToken;
    } else {
      throw new Error(`无法解析的指令片段 "${part}"（"${text}"）`);
    }
  }
  if (!buttons) throw new Error(`指令 "${text}" 缺少按键`);
  const motion = tokens.map((tok) => {
    if (!(DIR_TOKENS as string[]).includes(tok)) throw new Error(`无法解析的方向 "${tok}"（"${text}"）`);
    return tok as DirToken;
  });
  if (motion.length && !dir) throw new Error(`指令 "${text}" 的方向序列后必须接方向+按键`);
  const priority = popcount(buttons) * 1000 + motion.length * 100 + (dir ? 10 : 0);
  return { text, motion, dir, buttons, priority };
}

// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function num(o: Json, key: string, ctx: string, def?: number): number {
  const v = o[key];
  if (v === undefined) {
    if (def === undefined) throw new Error(`${ctx}: 缺少数值字段 "${key}"`);
    return def;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${ctx}: 字段 "${key}" 必须是数字`);
  return v;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], ctx: string, def?: T): T {
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new Error(`${ctx}: 取值 "${String(v)}" 不在 [${allowed.join(', ')}] 中`);
  }
  return v as T;
}

function hitProps(o: Json | undefined, base: HitProps, ctx: string): HitProps {
  if (!o) return { ...base };
  return {
    advantage: num(o, 'advantage', ctx, base.advantage),
    type: oneOf(o.type, HIT_TYPES, `${ctx}.type`, base.type),
    launch: num(o, 'launch', ctx, base.launch),
    knockback: num(o, 'knockback', ctx, base.knockback),
  };
}

function parseProjectile(o: Json, ctx: string): ProjectileDef {
  const onHit = (o.onHit as Json | undefined) ?? {};
  return {
    kind: oneOf(o.kind, PROJECTILE_KINDS, `${ctx}.kind`),
    spawnFrame: num(o, 'spawnFrame', ctx),
    speed: num(o, 'speed', ctx),
    lifetime: num(o, 'lifetime', ctx),
    radius: num(o, 'radius', ctx),
    height: num(o, 'height', ctx),
    damage: num(o, 'damage', ctx),
    level: oneOf(o.level, ['high', 'mid', 'low'] as const, `${ctx}.level`),
    hitStun: num(o, 'hitStun', ctx),
    blockStun: num(o, 'blockStun', ctx),
    pushback: num(o, 'pushback', ctx, 0.4),
    onHitType: oneOf(onHit.type, HIT_TYPES, `${ctx}.onHit.type`, 'normal'),
    launch: num(onHit, 'launch', ctx, 0),
    explodeRadius: num(o, 'explodeRadius', ctx, 0),
  };
}

export function parseMove(id: string, o: Json, ownerId: string): MoveDef {
  const ctx = `[${ownerId}.${id}]`;
  const startup = num(o, 'startup', ctx);
  const active = num(o, 'active', ctx);
  const recovery = num(o, 'recovery', ctx);
  if (startup < 1 || active < 1 || recovery < 0) throw new Error(`${ctx}: 帧数非法`);
  const activeEnd = startup + active - 1;
  const total = activeEnd + recovery;
  const level = oneOf(o.level, LEVELS, `${ctx}.level`);
  const commandText = String(o.command ?? '');
  if (!commandText) throw new Error(`${ctx}: 缺少 command`);
  const command = commandText === 'chain' || commandText === 'auto' ? null : parseCommand(commandText);

  const hb = o.hitbox as Json | undefined;
  const hitbox = hb
    ? { reach: num(hb, 'reach', ctx), height: num(hb, 'height', ctx), radius: num(hb, 'radius', ctx), lateral: num(hb, 'lateral', ctx, 0) }
    : null;
  if ((level === 'high' || level === 'mid' || level === 'low') && !hitbox) throw new Error(`${ctx}: 打击技必须配置 hitbox`);

  const onHit = hitProps(o.onHit as Json | undefined, { advantage: 0, type: 'normal', launch: 0, knockback: 0.25 }, `${ctx}.onHit`);
  const onCounter = hitProps(o.onCounter as Json | undefined, onHit, `${ctx}.onCounter`);
  const ob = (o.onBlock as Json | undefined) ?? {};
  const onBlock = { advantage: num(ob, 'advantage', ctx, -5), pushback: num(ob, 'pushback', ctx, 0.2) };

  const chain: ChainDef[] = ((o.chain as Json[] | undefined) ?? []).map((c, i) => {
    const cctx = `${ctx}.chain[${i}]`;
    const w = c.window as [number, number] | undefined;
    const inputText = String(c.input);
    return {
      inputText,
      input: parseCommand(inputText),
      moveId: String(c.move),
      window: w ? [w[0], w[1]] : [3, activeEnd + 8],
      cancel: num(c, 'cancel', cctx, activeEnd + 1),
    };
  });

  let throwDef = null;
  if (level === 'throw') {
    const t = o.throw as Json | undefined;
    if (!t) throw new Error(`${ctx}: 投技必须配置 throw`);
    const breakText = String(t.breakInput ?? 'none');
    throwDef = {
      range: num(t, 'range', ctx),
      breakInput: buttonMask(breakText),
      breakText,
      duration: num(t, 'duration', ctx),
      damageFrame: num(t, 'damageFrame', ctx),
      type: oneOf(t.type, THROW_TYPES, `${ctx}.throw.type`),
      swap: Boolean(t.swap),
    };
  }

  const projectile = o.projectile ? parseProjectile(o.projectile as Json, `${ctx}.projectile`) : null;
  const armor = o.armor as [number, number] | undefined;
  const anim = (o.anim as { type: string; limb?: never } | undefined) ?? { type: 'punch' };
  const rw = o.requiresWeapon;

  return {
    id,
    name: String(o.name ?? id),
    commandText,
    command,
    context: oneOf(o.context, CONTEXTS, `${ctx}.context`, 'normal'),
    startup,
    active,
    recovery,
    activeEnd,
    total,
    level,
    damage: num(o, 'damage', ctx, 0),
    weapon: Boolean(o.weapon),
    requiresWeapon: typeof rw === 'boolean' ? rw : null,
    hitbox,
    onHit,
    onCounter,
    onBlock,
    chain,
    tracking: num(o, 'tracking', ctx, 0),
    advance: num(o, 'advance', ctx, 0),
    crouching: Boolean(o.crouching),
    armor: armor ? [armor[0], armor[1]] : null,
    hitsGrounded: Boolean(o.hitsGrounded),
    clashesProjectiles: Boolean(o.clashesProjectiles),
    endsGrounded: Boolean(o.endsGrounded),
    throw: throwDef,
    projectile,
    toggleWeapon: num(o, 'toggleWeapon', ctx, 0),
    anim: { type: String(anim.type), limb: anim.limb },
  };
}

const STAT_KEYS: (keyof CharacterStats)[] = [
  'height', 'scale', 'weight', 'walkSpeed', 'backWalkSpeed', 'dashSpeed', 'dashFrames', 'runSpeed',
  'backdashDistance', 'backdashFrames', 'sidestepDistance', 'sidestepFrames', 'jumpVelocity',
  'jumpForwardSpeed', 'gravity', 'crouchHeight', 'hurtRadius', 'pushRadius',
];

/** 按“按键数 > 方向序列长度 > 是否带方向”排序，保证 LP+RP 优先于 LP、df+RP 优先于 RP */
export function sortByPriority(moves: MoveDef[]): MoveDef[] {
  return [...moves].sort((a, b) => (b.command?.priority ?? 0) - (a.command?.priority ?? 0));
}

export function buildCharacter(json: Json, common: Json): CharacterDef {
  const id = String(json.id);
  const statsJson = json.stats as Json;
  if (!statsJson) throw new Error(`[${id}] 缺少 stats`);
  const stats = {} as CharacterStats;
  for (const k of STAT_KEYS) stats[k] = num(statsJson, k, `[${id}].stats`);

  const moves: Record<string, MoveDef> = {};
  const merged: Record<string, Json> = { ...((common.moves as Record<string, Json>) ?? {}), ...((json.moves as Record<string, Json>) ?? {}) };
  for (const [mid, mj] of Object.entries(merged)) moves[mid] = parseMove(mid, mj, id);

  for (const m of Object.values(moves)) {
    for (const c of m.chain) {
      if (!moves[c.moveId]) throw new Error(`[${id}.${m.id}] 连段目标 "${c.moveId}" 不存在`);
    }
    if (m.weapon && !json.weapon) throw new Error(`[${id}.${m.id}] 武器招式需要角色配置 weapon`);
  }
  const w = json.weapon as Json | undefined;
  const r = (json.ratings as Json | undefined) ?? {};
  return {
    id,
    name: String(json.name ?? id),
    title: String(json.title ?? id),
    style: String(json.style ?? ''),
    archetype: String(json.archetype ?? ''),
    description: String(json.description ?? ''),
    ratings: {
      power: num(r, 'power', id, 3),
      speed: num(r, 'speed', id, 3),
      reach: num(r, 'reach', id, 3),
      difficulty: num(r, 'difficulty', id, 1),
    },
    weapon: w ? { name: String(w.name), damageMultiplier: num(w, 'damageMultiplier', `[${id}].weapon`) } : null,
    stats,
    moves,
    commandMoves: sortByPriority(Object.values(moves).filter((m) => m.command !== null)),
  };
}

/** 招式的最终伤害（持械倍率已计入） */
export function moveDamage(char: CharacterDef, move: MoveDef): number {
  const mult = move.weapon && char.weapon ? char.weapon.damageMultiplier : 1;
  return Math.round(move.damage * mult);
}
