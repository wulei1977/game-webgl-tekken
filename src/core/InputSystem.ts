// 输入系统：键盘 / 手柄 → 原始输入 → 相对方向帧 → 输入缓冲 → 指令识别
import { gameConfig, type KeyBindings } from './config';
import { DIR_NUM } from './FrameData';
import { BTN, type DirToken, type InputFrame, type ParsedCommand, type RawInput } from './types';

const SIZE = 64;

/** 环形输入缓冲：记录最近 64 帧的方向、按住键、新按下键与已消耗标记 */
export class InputBuffer {
  private dirs = new Uint8Array(SIZE).fill(5);
  private held = new Uint8Array(SIZE);
  private pressed = new Uint8Array(SIZE);
  private consumed = new Uint8Array(SIZE);
  private head = 0;
  frames = 0;

  push(f: InputFrame): void {
    const prevHeld = this.frames ? this.held[this.head] : 0;
    this.head = (this.head + 1) % SIZE;
    this.dirs[this.head] = f.dir;
    this.held[this.head] = f.held & 0xf;
    this.pressed[this.head] = f.held & ~prevHeld & 0xf;
    this.consumed[this.head] = 0;
    this.frames++;
  }

  private idx(ago: number): number {
    return (((this.head - ago) % SIZE) + SIZE) % SIZE;
  }

  dir(ago = 0): number {
    return ago >= this.frames || ago >= SIZE ? 5 : this.dirs[this.idx(ago)];
  }

  heldAt(ago = 0): number {
    return ago >= this.frames || ago >= SIZE ? 0 : this.held[this.idx(ago)];
  }

  /** 第 ago 帧新按下且尚未被招式消耗的按键 */
  pressedAt(ago = 0, includeConsumed = false): number {
    if (ago >= this.frames || ago >= SIZE) return 0;
    const i = this.idx(ago);
    return includeConsumed ? this.pressed[i] : this.pressed[i] & ~this.consumed[i];
  }

  consume(ago: number, mask: number): void {
    if (ago >= this.frames || ago >= SIZE) return;
    this.consumed[this.idx(ago)] |= mask;
  }

  /** 消耗最近 frames 帧内的全部按键（用于防止旧输入在状态切换后误触发） */
  consumeAll(frames: number): void {
    for (let a = 0; a < frames; a++) this.consume(a, 0xf);
  }

  clear(): void {
    this.dirs.fill(5);
    this.held.fill(0);
    this.pressed.fill(0);
    this.consumed.fill(0);
    this.head = 0;
    this.frames = 0;
  }
}

export function dirMatch(tok: DirToken, d: number, loose: boolean): boolean {
  if (!loose) return DIR_NUM[tok] === d;
  switch (tok) {
    case 'f':
      return d === 3 || d === 6 || d === 9;
    case 'b':
      return d === 1 || d === 4 || d === 7;
    case 'u':
      return d >= 7;
    case 'd':
      return d <= 3;
    default:
      return DIR_NUM[tok] === d;
  }
}

const isDiagonal = (t: DirToken) => t.length === 2;

/** 从最终方向所在帧向前回溯，按顺序匹配方向序列（如 f,f 需要中间松开；qcf 的斜向可省略） */
function matchMotion(buf: InputBuffer, motion: DirToken[], finalDir: DirToken, finalAgo: number): boolean {
  const span = gameConfig.input.motionFrames;
  let cur = finalAgo;
  let next: DirToken = finalDir;
  for (let i = motion.length - 1; i >= 0; i--) {
    const tok = motion[i];
    const optional = isDiagonal(tok) && i > 0;
    let released = tok !== next;
    let found = -1;
    for (let t = cur + 1; t <= finalAgo + span; t++) {
      const d = buf.dir(t);
      if (!released) {
        if (!dirMatch(next, d, true)) released = true;
        continue;
      }
      if (dirMatch(tok, d, true)) {
        found = t;
        break;
      }
    }
    if (found < 0) {
      if (optional) continue;
      return false;
    }
    cur = found;
    next = tok;
  }
  return true;
}

/**
 * 在输入缓冲中查找指令。返回按键完成帧距今的帧数（ago），未匹配返回 -1。
 * window：允许的缓冲帧数（提前输入）；loose：方向宽松匹配（d 同时接受 d/b、d/f 等）。
 */
export function matchCommand(buf: InputBuffer, cmd: ParsedCommand, window: number, loose: boolean, includeConsumed = false): number {
  const simul = gameConfig.input.simultaneousFrames;
  for (let a = 0; a <= window; a++) {
    if (!(buf.pressedAt(a, includeConsumed) & cmd.buttons)) continue;
    let acc = 0;
    for (let k = a; k < a + simul; k++) acc |= buf.pressedAt(k, includeConsumed);
    if ((acc & cmd.buttons) !== cmd.buttons) continue;
    if (cmd.dir) {
      let dirAgo = -1;
      const useLoose = loose && cmd.motion.length === 0;
      for (let k = a; k <= a + 1; k++) {
        if (dirMatch(cmd.dir, buf.dir(k), useLoose)) {
          dirAgo = k;
          break;
        }
      }
      if (dirAgo < 0) continue;
      if (cmd.motion.length && !matchMotion(buf, cmd.motion, cmd.dir, dirAgo)) continue;
    }
    return a;
  }
  return -1;
}

export function consumeCommand(buf: InputBuffer, cmd: ParsedCommand, ago: number): void {
  const simul = gameConfig.input.simultaneousFrames;
  for (let k = ago; k < ago + simul; k++) buf.consume(k, cmd.buttons);
}

/** 双击方向（f,f 冲刺 / b,b 后撤） */
export function detectDoubleTap(buf: InputBuffer, num: number): boolean {
  if (buf.dir(0) !== num || buf.dir(1) === num) return false;
  const span = gameConfig.input.motionFrames;
  for (let t = 2; t <= span; t++) if (buf.dir(t) === num) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 原始输入源

export const EMPTY_RAW: RawInput = { up: false, down: false, left: false, right: false, LP: false, RP: false, LK: false, RK: false };

export function mergeRaw(a: RawInput, b: RawInput | null): RawInput {
  if (!b) return a;
  return {
    up: a.up || b.up,
    down: a.down || b.down,
    left: a.left || b.left,
    right: a.right || b.right,
    LP: a.LP || b.LP,
    RP: a.RP || b.RP,
    LK: a.LK || b.LK,
    RK: a.RK || b.RK,
  };
}

/** 把屏幕方向转换为相对朝向的小键盘方向。opponentOnRight：对手在屏幕右侧 */
export function rawToFrame(raw: RawInput, opponentOnRight: boolean): InputFrame {
  let h = 0;
  if (raw.right && !raw.left) h = 1;
  else if (raw.left && !raw.right) h = -1;
  let v = 0;
  if (raw.up && !raw.down) v = 1;
  else if (raw.down && !raw.up) v = -1;
  const fwd = opponentOnRight ? h : -h;
  const held = (raw.LP ? BTN.LP : 0) | (raw.RP ? BTN.RP : 0) | (raw.LK ? BTN.LK : 0) | (raw.RK ? BTN.RK : 0);
  return { dir: 5 + fwd + v * 3, held };
}

export class KeyboardState {
  private down = new Set<string>();
  /** 按下后尚未被逻辑帧读取的键：保证不足一帧的快速轻点也能被识别 */
  private latched = new Set<string>();
  private pressedQueue: string[] = [];
  /** 这些键按下时阻止浏览器默认行为（页面滚动等） */
  private blockDefault = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
  listenTarget: Window | null = null;
  /** 改键时截获下一次按键 */
  captureNext: ((code: string) => void) | null = null;

  attach(target: Window): void {
    this.listenTarget = target;
    target.addEventListener('keydown', (e) => {
      if (this.captureNext) {
        e.preventDefault();
        const cb = this.captureNext;
        this.captureNext = null;
        cb(e.code);
        return;
      }
      if (this.blockDefault.has(e.code) || e.code.startsWith('Numpad')) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.latched.add(e.code);
      }
      this.pressedQueue.push(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    target.addEventListener('blur', () => {
      this.down.clear();
      this.latched.clear();
    });
  }

  setBlocked(codes: string[]): void {
    for (const c of codes) this.blockDefault.add(c);
  }

  isDown(code: string): boolean {
    return this.down.has(code) || this.latched.has(code);
  }

  /** 每个逻辑帧读取输入后调用，清除锁存 */
  endTick(): void {
    this.latched.clear();
  }

  /** 取出自上次调用以来按下的键（菜单导航用，含自动连发） */
  takePressed(): string[] {
    const q = this.pressedQueue;
    this.pressedQueue = [];
    return q;
  }
}

export function rawFromKeyboard(kb: KeyboardState, b: KeyBindings): RawInput {
  return {
    up: kb.isDown(b.up),
    down: kb.isDown(b.down),
    left: kb.isDown(b.left),
    right: kb.isDown(b.right),
    LP: kb.isDown(b.LP),
    RP: kb.isDown(b.RP),
    LK: kb.isDown(b.LK),
    RK: kb.isDown(b.RK),
  };
}

/** Gamepad API（标准映射）：□/X=LP △/Y=RP ×/A=LK ○/B=RK，R1=LP+RP，R2=LK+RK */
export function rawFromGamepad(index: number): RawInput | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const gp = navigator.getGamepads()[index];
  if (!gp || !gp.connected) return null;
  const dead = 0.45;
  const ax = gp.axes[0] ?? 0;
  const ay = gp.axes[1] ?? 0;
  const b = (i: number) => Boolean(gp.buttons[i]?.pressed);
  const r1 = b(5);
  const r2 = b(7);
  return {
    up: ay < -dead || b(12),
    down: ay > dead || b(13),
    left: ax < -dead || b(14),
    right: ax > dead || b(15),
    LP: b(2) || r1,
    RP: b(3) || r1,
    LK: b(0) || r2,
    RK: b(1) || r2,
  };
}
