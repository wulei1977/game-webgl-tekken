// 练习模式帧数据面板：显示 P1 最近一招的帧表数据 + 实测帧优势 + 双方状态
import { moveDamage } from '../core/FrameData';
import type { Game } from '../core/Game';

const LEVEL: Record<string, string> = { high: '上段', mid: '中段', low: '下段', throw: '投技', none: '—' };
const RESULT: Record<string, string> = { hit: '命中', block: '被防', counter: 'COUNTER' };
const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

export class PracticePanel {
  readonly el: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'practice-panel';
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  update(game: Game | null, visible: boolean, dummyLabel: string, hitboxes: boolean): void {
    if (!game || !visible) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'block';
    const [p1, p2] = game.fighters;
    const m = p1.lastMove;
    const lines: string[] = [];
    if (m) {
      const c = p1.def;
      lines.push(`招式  ${m.name}  [${m.commandText}]`);
      if (m.projectile) {
        lines.push(`段位  ${LEVEL[m.projectile.level]}·飞行道具   伤害 ${m.projectile.damage}`);
        lines.push(`发生  i${m.startup}   收招 ${m.recovery}   总帧 ${m.total}`);
      } else {
        lines.push(`段位  ${LEVEL[m.level]}   伤害 ${moveDamage(c, m)}${m.weapon ? ' (警棍×1.5)' : ''}`);
        lines.push(`发生  i${m.startup}   判定 ${m.active}   收招 ${m.recovery}   总帧 ${m.total}`);
        if (m.level !== 'throw' && m.level !== 'none') {
          const hit = m.onHit.type === 'normal' ? fmt(m.onHit.advantage) : { launch: '浮空', knockdown: '击倒', stagger: '踉跄' }[m.onHit.type];
          lines.push(`被防  ${fmt(m.onBlock.advantage)}   命中 ${hit}`);
        } else if (m.throw) {
          lines.push(`投技  ${m.throw.breakInput ? `挣脱 ${m.throw.breakText}` : '不可挣脱'}`);
        }
      }
    } else {
      lines.push('招式  —');
    }
    const ex = game.lastExchange;
    if (ex && ex.attacker === 0) {
      lines.push(`实测  ${RESULT[ex.result]}   帧优势 ${ex.advantage === null ? (ex.pending ? '测量中…' : '—') : fmt(ex.advantage)}`);
    }
    lines.push(`连击  ${p2.comboHits} hits / ${p2.comboDamage} dmg    崩防 ${Math.round(p2.guardMeter)}/${game.config.guardBreak.threshold}`);
    lines.push(`P1 ${p1.state}${p1.state === 'attack' ? ` f${p1.moveFrame}` : ''}   P2 ${p2.state}${p2.stun > 0 ? ` stun ${p2.stun}` : ''}`);
    lines.push(`假人 ${dummyLabel}   [1-4]切换  [H]判定框:${hitboxes ? '开' : '关'}  [F]面板  [R]重置`);
    const text = lines.join('\n');
    if (text !== this.last) {
      this.el.textContent = text;
      this.last = text;
    }
  }
}
