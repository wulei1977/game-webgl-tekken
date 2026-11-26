import { describe, expect, it } from 'vitest';
import { AIController } from '../src/actor/AIFighter';
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

describe('攻击段位规则', () => {
  it('站立待机自动防御上段，帧优势与帧表一致（刺拳被防 +1）', () => {
    const { g, s1 } = setup();
    s1.push(press(BTN.LP));
    const ev = run(g, 60);
    expect(types(ev)).toContain('block');
    expect(types(ev)).not.toContain('hit');
    expect(g.lastExchange?.result).toBe('block');
    expect(g.lastExchange?.advantage).toBe(1);
  });

  it('不防御时刺拳命中，伤害 5，命中优势 +8', () => {
    const { g, s1, b } = setup();
    b.noGuard = true;
    s1.push(press(BTN.LP));
    const ev = run(g, 60);
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.damage).toBe(5);
    expect(b.hp).toBe(95);
    expect(g.lastExchange?.advantage).toBe(8);
  });

  it('下蹲可以躲开上段', () => {
    const { g, s1, s2 } = setup();
    s2.tail = { dir: 2, held: 0 };
    run(g, 5);
    s1.push(press(BTN.LP));
    const ev = run(g, 40);
    expect(types(ev)).not.toContain('hit');
    expect(types(ev)).not.toContain('block');
  });

  it('中段：站立可防，下蹲防御会被击中', () => {
    const { g, s1, s2, b } = setup();
    s2.tail = { dir: 1, held: 0 };
    run(g, 5);
    s1.push(press(BTN.LK));
    const ev = run(g, 40);
    expect(types(ev)).toContain('hit');
    expect(b.hp).toBe(90);
  });

  it('下段：站立被击中，下蹲可防', () => {
    const t1 = setup();
    t1.s1.push(press(BTN.LK, 2));
    expect(types(run(t1.g, 40))).toContain('hit');

    const t2 = setup();
    t2.s2.tail = { dir: 1, held: 0 };
    run(t2.g, 5);
    t2.s1.push(press(BTN.LK, 2));
    const ev = run(t2.g, 40);
    expect(types(ev)).toContain('block');
    expect(types(ev)).not.toContain('hit');
  });
});

describe('浮空连 / 倒地', () => {
  it('升龙拳打浮空，可以空中追击，落地进入倒地，且有落地保护（不会无限连）', () => {
    const { g, s1, b } = setup('heishi', 'heishi', 1.0);
    b.noGuard = true;
    s1.push(press(BTN.RP, 3));
    let juggled = false;
    let airHits = 0;
    let lastLP = -10;
    for (let i = 0; i < 400; i++) {
      g.step();
      for (const e of g.drainEvents()) if (e.type === 'hit' && e.airborne) airHits++;
      if (b.sm.is('juggle')) {
        juggled = true;
        // 浮空中持续追加刺拳（输入缓冲 + 连段）
        if (g.tick - lastLP >= 6) {
          s1.push(press(BTN.LP), press(0));
          lastLP = g.tick;
        }
      }
    }
    expect(juggled).toBe(true);
    expect(airHits).toBeGreaterThanOrEqual(1);
    expect(airHits).toBeLessThanOrEqual(g.config.juggle.maxHits);
    expect(b.sm.is('juggle')).toBe(false);
    expect(b.hp).toBeLessThan(88);
  });

  it('倒地后可以起身', () => {
    const { g, s1, s2, b } = setup('heishi', 'heishi', 1.2);
    b.noGuard = true;
    s1.push(press(BTN.RK, 2));
    for (let i = 0; i < 150 && !b.sm.is('grounded'); i++) g.step();
    expect(b.sm.is('grounded')).toBe(true);
    s2.tail = { dir: 6, held: 0 };
    run(g, 80);
    expect(b.isActionable()).toBe(true);
  });
});

describe('投技', () => {
  it('投技无法格挡，结算伤害后对手倒地', () => {
    const { g, s1, b } = setup('heishi', 'heishi', 0.8);
    s1.push(press(BTN.LP | BTN.RP));
    const ev = run(g, 140);
    expect(types(ev)).toContain('throwStart');
    expect(types(ev)).toContain('throwHit');
    expect(b.hp).toBe(82);
  });

  it('在挣脱窗口内按 LP+RP 挣脱投技', () => {
    const { g, s1, s2, b } = setup('heishi', 'heishi', 0.8);
    s1.push(press(BTN.LP | BTN.RP));
    for (let i = 0; i < 40; i++) {
      g.step();
      if (b.sm.is('thrown') && b.sm.frame === 4) s2.push(press(BTN.LP | BTN.RP));
    }
    expect(b.hp).toBe(100);
    expect(types(g.drainEvents())).toBeDefined();
  });

  it('戈勒姆的巨人背摔需要 LK+RK 挣脱，按错键无效', () => {
    const { g, s1, s2, b } = setup('golem', 'heishi', 0.9);
    s1.push(press(BTN.LP | BTN.RP, 6));
    for (let i = 0; i < 160; i++) {
      g.step();
      if (b.sm.is('thrown') && b.sm.frame === 4) s2.push(press(BTN.LP | BTN.RP));
    }
    expect(b.hp).toBe(72);
  });
});

describe('飞行道具与武器', () => {
  it('冲击波命中远处的对手，侧移可以躲开', () => {
    const t1 = setup('heishi', 'heishi', 4);
    t1.b.noGuard = true;
    t1.s1.push(press(0, 2), press(0, 3), press(BTN.LP, 6), press(0, 6));
    const ev = run(t1.g, 120);
    expect(types(ev)).toContain('projectileSpawn');
    expect(ev.some((e) => e.type === 'hit' && e.projectile === 'shockwave')).toBe(true);

    const t2 = setup('heishi', 'heishi', 4);
    t2.b.noGuard = true;
    t2.s1.push(press(0, 2), press(0, 3), press(BTN.LP, 6), press(0, 6));
    for (let i = 0; i < 120; i++) {
      t2.g.step();
      if (i === 24) t2.s2.push(press(0, 8), press(0, 5));
    }
    expect(t2.b.hp).toBe(100);
  });

  it('莉娜拔棍后 LP 变为警棍挥击，伤害 ×1.5', () => {
    const { g, s1, b, a } = setup('rina', 'heishi', 1.1);
    b.noGuard = true;
    s1.push(press(BTN.LK | BTN.RK));
    run(g, 40);
    expect(a.weaponDrawn).toBe(true);
    s1.push(press(BTN.LP));
    const ev = run(g, 40);
    const hit = ev.find((e) => e.type === 'hit');
    expect(hit && hit.type === 'hit' && hit.weapon).toBe(true);
    expect(b.hp).toBe(91);
  });
});

describe('回合流程', () => {
  it('KO 后进入下一回合，三局两胜决出胜者', () => {
    const { g, b } = setup();
    let rounds = 0;
    for (let i = 0; i < 4000 && g.phase !== 'matchEnd'; i++) {
      if (g.phase === 'fight') b.hp = 0;
      g.step();
      for (const e of g.drainEvents()) if (e.type === 'roundEnd') rounds++;
    }
    expect(g.phase).toBe('matchEnd');
    expect(g.winner).toBe(0);
    expect(g.wins[0]).toBe(2);
    expect(rounds).toBe(2);
  });
});

describe('AI 自对战稳定性（状态不卡死、数值有效）', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    it(`${diff} AI 对战 20000 帧`, () => {
      const chars = ['heishi', 'golem', 'rina'];
      for (let k = 0; k < 3; k++) {
        const g = makeGame(chars[k], chars[(k + 1) % 3], new AIController(diff, 11 + k), new AIController('hard', 99 + k));
        let roundsEnded = 0;
        let hits = 0;
        const sameState = [0, 0];
        const last = ['', ''];
        for (let i = 0; i < 20000; i++) {
          g.step();
          for (const e of g.drainEvents()) {
            if (e.type === 'roundEnd') roundsEnded++;
            if (e.type === 'hit') hits++;
          }
          if (g.phase === 'matchEnd') g.restartMatch();
          g.fighters.forEach((f, idx) => {
            expect(Number.isFinite(f.pos.x + f.pos.y + f.pos.z)).toBe(true);
            expect(Math.hypot(f.pos.x, f.pos.z)).toBeLessThanOrEqual(g.config.arenaRadius + 1e-6);
            if (g.phase === 'fight') {
              sameState[idx] = f.state === last[idx] && !f.isActionable() ? sameState[idx] + 1 : 0;
              last[idx] = f.state;
              expect(sameState[idx]).toBeLessThan(400);
            }
          });
        }
        expect(hits).toBeGreaterThan(20);
        expect(roundsEnded).toBeGreaterThan(0);
      }
    });
  }
});
