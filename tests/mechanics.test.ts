import { describe, expect, it } from 'vitest';
import { BTN, type GameEvent } from '../src/core/types';
import { makeGame, place, press, run, ScriptController, toFight } from './helpers';

const types = (ev: GameEvent[]) => ev.map((e) => e.type);

function setup(p1 = 'heishi', p2 = 'heishi', dist = 1.2) {
  const s1 = new ScriptController();
  const s2 = new ScriptController();
  const g = makeGame(p1, p2, s1, s2);
  toFight(g);
  place(g, dist);
  return { g, s1, s2, a: g.fighters[0], b: g.fighters[1] };
}

describe('移动：侧移 / 跳跃 / 冲刺 / 后撤', () => {
  it('轻点上 = 侧移（离开对手直线），按住上 = 跳跃', () => {
    const t = setup();
    t.s1.push(press(0, 8), press(0, 8), press(0, 5));
    const states: string[] = [];
    for (let i = 0; i < 20; i++) {
      t.g.step();
      states.push(t.a.state);
    }
    expect(states).toContain('sidestep');
    expect(states).not.toContain('jump');
    expect(Math.abs(t.a.pos.z)).toBeGreaterThan(0.3);

    const j = setup();
    j.s1.wait(14, press(0, 8));
    const st2: string[] = [];
    for (let i = 0; i < 20; i++) {
      j.g.step();
      st2.push(j.a.state);
    }
    expect(st2).toContain('jump');
    expect(st2).not.toContain('sidestep');
  });

  it('侧移可以躲开直线攻击', () => {
    const t = setup('heishi', 'heishi', 1.3);
    t.b.noGuard = true;
    t.s1.push(press(BTN.RP));
    t.s2.push(press(0, 8), press(0, 5));
    const ev = run(t.g, 40);
    expect(types(ev)).not.toContain('hit');
  });

  it('→→ 冲刺、←← 后撤步', () => {
    const t = setup('heishi', 'heishi', 3);
    t.s1.push(press(0, 6), press(0, 5), press(0, 6));
    const states: string[] = [];
    for (let i = 0; i < 10; i++) {
      t.g.step();
      states.push(t.a.state);
    }
    expect(states).toContain('dash');
    const b = setup('heishi', 'heishi', 2);
    const x0 = b.a.pos.x;
    b.s1.push(press(0, 4), press(0, 5), press(0, 4));
    run(b.g, 25);
    expect(b.a.pos.x).toBeLessThan(x0 - 0.8);
  });
});

describe('出招判定细节', () => {
  it('先按 LP、2 帧内补按 RP 仍判定为投技（双键升级）', () => {
    const t = setup('heishi', 'heishi', 0.8);
    t.s1.push(press(BTN.LP), press(BTN.LP), press(BTN.LP | BTN.RP), press(0));
    const ev = run(t.g, 30);
    expect(types(ev)).toContain('throwStart');
  });

  it('绕到背后投技 = 背后投，不可挣脱', () => {
    const t = setup('heishi', 'heishi', 0.8);
    t.b.facing = Math.PI / 2; // 对手背对攻击方
    t.b.sm.change('attack', { move: t.b.def.moves.lk });
    t.b.facing = Math.PI / 2;
    t.s1.push(press(BTN.LP | BTN.RP));
    let back = false;
    for (let i = 0; i < 120; i++) {
      t.g.step();
      for (const e of t.g.drainEvents()) if (e.type === 'throwStart' && e.back) back = true;
      if (t.b.sm.is('thrown') && t.b.sm.frame === 3) t.s2.push(press(BTN.LP | BTN.RP));
    }
    expect(back).toBe(true);
    expect(t.b.hp).toBeLessThan(100);
  });

  it('双方飞行道具相撞抵消', () => {
    const t = setup('heishi', 'heishi', 5);
    const qcf = [press(0, 2), press(0, 3), press(BTN.LP, 6), press(0, 5)];
    t.s1.push(...qcf);
    t.s2.push(...qcf);
    const ev = run(t.g, 120);
    const ends = ev.filter((e) => e.type === 'projectileEnd');
    expect(ends.length).toBe(2);
    expect(ends.every((e) => e.type === 'projectileEnd' && e.reason === 'clash')).toBe(true);
    expect(t.a.hp + t.b.hp).toBe(200);
  });

  it('连续格挡超过阈值触发崩防', () => {
    const t = setup('golem', 'heishi', 1.2);
    let broke = false;
    for (let i = 0; i < 600 && !broke; i++) {
      if (t.a.isActionable() && t.a.distToOpponent() < 1.6) t.s1.push(press(BTN.RK), press(0));
      if (t.a.distToOpponent() > 1.4) t.a.pos.x += 0.05;
      t.g.step();
      for (const e of t.g.drainEvents()) if (e.type === 'guardBreak') broke = true;
    }
    expect(broke).toBe(true);
  });

  it('戈勒姆蓄力锤击带霸体：前摇中被打不中断', () => {
    const t = setup('golem', 'heishi', 1.0);
    t.s1.push(press(BTN.RP, 4));
    run(t.g, 10);
    expect(t.a.state).toBe('attack');
    t.s2.push(press(BTN.LP));
    const ev = run(t.g, 30);
    expect(types(ev)).toContain('armor');
    expect(ev.some((e) => e.type === 'hit' && e.attacker === 0)).toBe(true);
  });
});
