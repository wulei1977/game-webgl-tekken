import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, getCharacter } from '../src/actor/MoveSet';
import { moveDamage, parseCommand } from '../src/core/FrameData';
import { BTN } from '../src/core/types';

describe('招式帧数据', () => {
  it('所有角色招式表都能通过校验', () => {
    for (const id of CHARACTER_IDS) {
      const c = getCharacter(id);
      expect(Object.keys(c.moves).length).toBeGreaterThan(10);
      for (const m of Object.values(c.moves)) {
        expect(m.total).toBe(m.startup + m.active - 1 + m.recovery);
        if (m.level === 'high' || m.level === 'mid' || m.level === 'low') expect(m.hitbox).not.toBeNull();
      }
    }
  });

  it('指令按优先级排序：双键 > 方向序列 > 方向 > 单键', () => {
    const c = getCharacter('heishi');
    const order = c.commandMoves.map((m) => m.commandText);
    expect(order.indexOf('LP+RP')).toBeLessThan(order.indexOf('LP'));
    expect(order.indexOf('qcf+LP')).toBeLessThan(order.indexOf('LP'));
    expect(order.indexOf('df+RP')).toBeLessThan(order.indexOf('RP'));
  });

  it('解析指令', () => {
    const q = parseCommand('qcf+LP');
    expect(q.motion).toEqual(['d', 'df']);
    expect(q.dir).toBe('f');
    expect(q.buttons).toBe(BTN.LP);
    const ff = parseCommand('f,f+RK');
    expect(ff.motion).toEqual(['f']);
    expect(ff.dir).toBe('f');
    expect(parseCommand('f+LP+RP').buttons).toBe(BTN.LP | BTN.RP);
    expect(() => parseCommand('xx+LP')).toThrow();
  });

  it('警棍伤害 = 空拳伤害 × 1.5', () => {
    const rina = getCharacter('rina');
    expect(moveDamage(rina, rina.moves.bt_lp)).toBe(9); // 6 × 1.5
    expect(moveDamage(rina, rina.moves.bt_rp)).toBe(12); // 8 × 1.5
    expect(moveDamage(rina, rina.moves.lp)).toBe(4);
  });
});
