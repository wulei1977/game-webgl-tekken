import { describe, expect, it } from 'vitest';
import { AIController } from '../src/actor/AIFighter';
import type { Difficulty } from '../src/core/types';
import { makeGame } from './helpers';

const NEUTRAL_STATES = ['idle', 'walkF', 'walkB', 'crouch'];

function playMatch(d1: Difficulty, d2: Difficulty, c1: string, c2: string, seed: number) {
  const g = makeGame(c1, c2, new AIController(d1, seed), new AIController(d2, seed * 7 + 3));
  // neutralHits：在可以防御的中立状态下被打中；blocks：成功格挡
  const s = { neutralHits: [0, 0], blocks: [0, 0], juggles: [0, 0] };
  for (let i = 0; i < 60 * 60 * 6 && g.phase !== 'matchEnd'; i++) {
    const before = g.fighters.map((f) => f.state);
    g.step();
    for (const e of g.drainEvents()) {
      if (e.type === 'hit') {
        if (NEUTRAL_STATES.includes(before[e.defender])) s.neutralHits[e.defender]++;
        if (e.airborne) s.juggles[e.attacker]++;
      }
      if (e.type === 'block') s.blocks[e.defender]++;
    }
  }
  return { winner: g.winner, s };
}

describe('AI 难度差异', () => {
  it('困难 AI 明显强于简单 AI：胜率高、中立状态防守更好、会浮空追击', () => {
    const chars = ['heishi', 'golem', 'rina'];
    let hardWins = 0;
    const agg = { hard: { nh: 0, bl: 0 }, easy: { nh: 0, bl: 0 } };
    let hardJuggles = 0;
    const matches = 9;
    for (let k = 1; k <= matches; k++) {
      const swap = k % 2 === 0; // 交换左右位置，避免站位偏差
      const r = swap ? playMatch('easy', 'hard', chars[k % 3], chars[(k + 1) % 3], k) : playMatch('hard', 'easy', chars[k % 3], chars[(k + 1) % 3], k);
      const h = swap ? 1 : 0;
      if (r.winner === h) hardWins++;
      agg.hard.nh += r.s.neutralHits[h];
      agg.hard.bl += r.s.blocks[h];
      agg.easy.nh += r.s.neutralHits[1 - h];
      agg.easy.bl += r.s.blocks[1 - h];
      hardJuggles += r.s.juggles[h];
    }
    const rate = (x: { nh: number; bl: number }) => x.nh / Math.max(1, x.nh + x.bl);
    console.log(`hard wins ${hardWins}/${matches}; neutral-hit rate hard=${rate(agg.hard).toFixed(2)} easy=${rate(agg.easy).toFixed(2)}; hard juggle hits ${hardJuggles}`);
    expect(hardWins / matches).toBeGreaterThanOrEqual(0.75);
    expect(rate(agg.hard)).toBeLessThan(rate(agg.easy));
    expect(hardJuggles).toBeGreaterThan(0);
  });
});
