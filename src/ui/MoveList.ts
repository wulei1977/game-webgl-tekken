// 出招表生成：从招式 JSON 自动生成（指令图标化、段位、伤害、帧数）
import { moveDamage } from '../core/FrameData';
import type { CharacterDef, MoveDef } from '../core/types';

const ARROWS: Record<string, string> = { f: '→', b: '←', u: '↑', d: '↓', df: '↘', db: '↙', uf: '↗', ub: '↖', n: '☆' };
const LEVEL: Record<string, string> = { high: '上段', mid: '中段', low: '下段', throw: '投技', none: '—' };
const CONTEXT: Record<string, string> = { ws: '起身中 ', air: '跳跃中 ', ground: '倒地时 ', run: '奔跑中 ', normal: '' };

export function prettyCommand(cmd: string): string {
  const t = cmd.replace(/\bqcf\b/g, 'd,df,f').replace(/\bqcb\b/g, 'd,db,b');
  return t
    .split(',')
    .map((part) =>
      part
        .split('+')
        .map((p) => ARROWS[p] ?? `<b class="btn btn-${p}">${p}</b>`)
        .join(''),
    )
    .join(' ');
}

function chainSequence(c: CharacterDef, m: MoveDef): MoveDef[][] {
  const out: MoveDef[][] = [];
  const walk = (path: MoveDef[]) => {
    const last = path[path.length - 1];
    if (!last.chain.length) {
      if (path.length > 1) out.push(path);
      return;
    }
    for (const ch of last.chain) walk([...path, c.moves[ch.moveId]]);
  };
  walk([m]);
  return out;
}

function frameInfo(c: CharacterDef, m: MoveDef): { level: string; dmg: string; startup: string; block: string; hit: string } {
  if (m.projectile) {
    const p = m.projectile;
    return { level: `${LEVEL[p.level]}·飞行道具`, dmg: String(p.damage), startup: `i${m.startup}`, block: '—', hit: p.onHitType === 'knockdown' ? '击倒' : p.onHitType === 'stagger' ? '踉跄' : '—' };
  }
  if (m.level === 'none') return { level: '—', dmg: '—', startup: '—', block: '—', hit: '—' };
  const hitType = m.onHit.type === 'launch' ? '浮空' : m.onHit.type === 'knockdown' ? '击倒' : m.onHit.type === 'stagger' ? '踉跄' : fmt(m.onHit.advantage);
  return {
    level: LEVEL[m.level],
    dmg: String(moveDamage(c, m)),
    startup: `i${m.startup}`,
    block: m.level === 'throw' ? (m.throw?.breakInput ? `挣脱 ${m.throw.breakText}` : '不可挣脱') : fmt(m.onBlock.advantage),
    hit: m.level === 'throw' ? '倒地' : hitType,
  };
}

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

export function moveListHTML(c: CharacterDef): string {
  const rows: string[] = [];
  const add = (cmd: string, m: MoveDef, extra = '') => {
    const f = frameInfo(c, m);
    const tag = m.weapon ? '<span class="tag tag-w">警棍×1.5</span>' : m.requiresWeapon === false && c.weapon ? '<span class="tag">徒手</span>' : '';
    const flags = [m.armor ? '霸体' : '', m.hitsGrounded ? '可追击倒地' : '', m.tracking > 0 ? '追踪' : '', m.clashesProjectiles ? '可打消飞行道具' : '']
      .filter(Boolean)
      .map((x) => `<span class="tag">${x}</span>`)
      .join('');
    rows.push(
      `<tr><td class="mv-name">${m.name}${extra}${tag}${flags}</td><td class="mv-cmd">${cmd}</td><td>${f.level}</td><td>${f.dmg}</td><td>${f.startup}</td><td>${f.block}</td><td>${f.hit}</td></tr>`,
    );
  };
  const order = (m: MoveDef) => (m.throw ? 3 : m.projectile ? 2 : m.context !== 'normal' ? 1 : 0);
  for (const m of [...c.commandMoves].sort((a, b) => order(a) - order(b))) {
    add(CONTEXT[m.context] + prettyCommand(m.commandText), m);
    for (const seq of chainSequence(c, m)) {
      const cmd = seq.map((x, i) => (i === 0 ? prettyCommand(x.commandText) : prettyCommand(seq[i - 1].chain.find((ch) => ch.moveId === x.id)!.inputText))).join(' , ');
      add(cmd, seq[seq.length - 1], ` <small>(${seq.length} 段)</small>`);
    }
  }
  return `<table class="movelist"><thead><tr><th>招式</th><th>指令</th><th>段位</th><th>伤害</th><th>发生</th><th>被防</th><th>命中</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export const SYSTEM_MOVES_HTML = `
<table class="movelist system"><tbody>
<tr><td>防御（上/中段）</td><td>站立不动 或 ←</td><td>下蹲防御（下段）</td><td>↓ 或 ↙</td></tr>
<tr><td>冲刺 / 奔跑</td><td>→ → （按住 → 持续奔跑，靠近对手自动冲撞）</td><td>后撤步</td><td>← ←</td></tr>
<tr><td>侧移（进入画面深处）</td><td>轻点 ↑</td><td>侧移（朝向镜头）</td><td>轻点 ↓</td></tr>
<tr><td>跳跃</td><td>按住 ↑ / ↗ / ↖</td><td>起身技</td><td>下蹲后松开 ↓ 的瞬间出招</td></tr>
<tr><td>倒地：原地起身</td><td>→ 或 拳键</td><td>倒地：后滚 / 侧滚</td><td>← / ↑ ↓</td></tr>
<tr><td>倒地：躺地踢 / 起身踢</td><td>LK / RK</td><td>投技挣脱</td><td>被抓瞬间按对应挣脱键</td></tr>
<tr><td>背后投（不可挣脱）</td><td>绕到对手背后投技</td><td>崩防</td><td>连续格挡过多会被破防</td></tr>
</tbody></table>`;
