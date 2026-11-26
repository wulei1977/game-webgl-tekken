import type { Fighter } from '../src/actor/Fighter';
import { Game, NEUTRAL, type InputController } from '../src/core/Game';
import type { GameEvent, InputFrame, MatchSetup } from '../src/core/types';

/** 用回调函数产生输入的控制器 */
export class FnController implements InputController {
  constructor(public fn: (game: Game, self: Fighter) => InputFrame = () => NEUTRAL) {}
  poll(game: Game, self: Fighter): InputFrame {
    return this.fn(game, self);
  }
}

/** 按顺序播放输入帧的控制器，播完后保持 tail */
export class ScriptController implements InputController {
  queue: InputFrame[] = [];
  tail: InputFrame = NEUTRAL;
  push(...frames: InputFrame[]): this {
    this.queue.push(...frames);
    return this;
  }
  wait(n: number, frame: InputFrame = NEUTRAL): this {
    for (let i = 0; i < n; i++) this.queue.push(frame);
    return this;
  }
  poll(): InputFrame {
    return this.queue.shift() ?? this.tail;
  }
}

export function makeGame(p1: string, p2: string, c1: InputController, c2: InputController, mode: MatchSetup['mode'] = 'vs'): Game {
  return new Game({ mode, p1, p2, difficulty: 'normal', dummy: 'stand' }, [c1, c2]);
}

/** 跳过回合开场，进入 FIGHT 阶段 */
export function toFight(g: Game): void {
  let guard = 0;
  while (g.phase !== 'fight' && guard++ < 1000) g.step();
  g.drainEvents();
}

/** 把两名角色放在 x 轴上指定距离并面对面 */
export function place(g: Game, dist: number): void {
  const [a, b] = g.fighters;
  a.pos.set(-dist / 2, 0, 0);
  b.pos.set(dist / 2, 0, 0);
  a.facing = Math.PI / 2;
  b.facing = -Math.PI / 2;
}

export function run(g: Game, ticks: number): GameEvent[] {
  const ev: GameEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
}

export const press = (held: number, dir = 5): InputFrame => ({ dir, held });
