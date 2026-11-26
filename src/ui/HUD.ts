// 对战 HUD：2D Canvas 叠加在 WebGL 画布上层。血条（红血闪烁 + 掉血残影）、头像、角色名、回合标记、
// 计时器、连击数、COUNTER 等提示、READY / FIGHT / KO / WINNER 播报、KO 爆闪与回合间黑屏
import type { Game } from '../core/Game';
import type { AnnounceKind, GameEvent } from '../core/types';
import { portraitCanvas } from '../render/CharacterArt';
import { pixelTextCanvas, type PixelTextOptions } from './PixelFont';

interface Announce {
  text: string;
  kind: AnnounceKind;
  life: number;
  max: number;
}

interface Popup {
  text: string;
  side: number;
  life: number;
  colors: [string, string];
}

const ANNOUNCE_COLORS: Record<AnnounceKind, [string, string]> = {
  round: ['#ffffff', '#ffd040'],
  fight: ['#ffe060', '#ff3020'],
  ko: ['#ffe0e0', '#ff2020'],
  doubleko: ['#ffe0e0', '#ff2020'],
  time: ['#ffffff', '#60c0ff'],
  win: ['#fff6c0', '#ffb020'],
  perfect: ['#ffffff', '#40ffb0'],
  draw: ['#ffffff', '#a0a0b0'],
};

export class HUD {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 640;
  private H = 360;
  private ghost = [1, 1];
  private ghostDelay = [0, 0];
  private combo = [
    { hits: 0, dmg: 0, life: 0 },
    { hits: 0, dmg: 0, life: 0 },
  ];
  private announce: Announce | null = null;
  private popups: Popup[] = [];
  private flash = 0;
  private portraits: HTMLCanvasElement[] = [];
  modeLabel = '';

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.resize(window.innerWidth, window.innerHeight);
  }

  resize(w: number, h: number): void {
    this.H = 360;
    this.W = Math.max(480, Math.round((360 * w) / Math.max(1, h)));
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.g.imageSmoothingEnabled = false;
  }

  bind(game: Game): void {
    const same = game.fighters[0].def.id === game.fighters[1].def.id;
    this.portraits = game.fighters.map((f, i) => portraitCanvas(f.def.id, same && i === 1, 32));
    this.ghost = [1, 1];
    this.combo.forEach((c) => (c.life = 0));
    this.popups = [];
    this.announce = null;
    this.flash = 0;
  }

  setVisible(v: boolean): void {
    this.canvas.style.display = v ? 'block' : 'none';
  }

  private popup(text: string, side: number, colors: [string, string]): void {
    this.popups = this.popups.filter((p) => p.side !== side || p.text !== text);
    this.popups.push({ text, side, life: 70, colors });
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'hit':
        if (e.combo >= 2) this.combo[e.attacker] = { hits: e.combo, dmg: e.comboDamage, life: 100 };
        if (e.counter) this.popup('COUNTER!', e.attacker, ['#ffd0a0', '#ff3020']);
        break;
      case 'guardBreak':
        this.popup('GUARD BREAK', 1 - e.defender, ['#e0f4ff', '#40a0ff']);
        break;
      case 'throwBreak':
        this.popup('THROW BREAK', e.defender, ['#e0fff4', '#30d0a0']);
        break;
      case 'throwStart':
        if (e.back) this.popup('BACK THROW', e.attacker, ['#fff0c0', '#ff9020']);
        break;
      case 'armor':
        this.popup('ARMOR', e.defender, ['#ffe0e0', '#ff5050']);
        break;
      case 'announce':
        this.announce = { text: e.text, kind: e.kind, life: e.kind === 'fight' ? 55 : 100, max: e.kind === 'fight' ? 55 : 100 };
        break;
      case 'ko':
        this.flash = 1;
        break;
      case 'roundStart':
        this.ghost = [1, 1];
        this.combo.forEach((c) => (c.life = 0));
        break;
      default:
        break;
    }
  }

  private text(str: string, x: number, y: number, o: PixelTextOptions, align: 'left' | 'center' | 'right' = 'left', alpha = 1): void {
    const c = pixelTextCanvas(str, o);
    const pad = (o.scale ?? 1) * 2;
    let dx = x - pad;
    if (align === 'center') dx = Math.round(x - c.width / 2);
    else if (align === 'right') dx = x - c.width + pad;
    this.g.globalAlpha = alpha;
    this.g.drawImage(c, Math.round(dx), Math.round(y - pad));
    this.g.globalAlpha = 1;
  }

  draw(game: Game, dt: number): void {
    const g = this.g;
    const W = this.W;
    const H = this.H;
    g.clearRect(0, 0, W, H);
    const cfg = game.config;
    const barW = Math.min(250, W / 2 - 78);
    const barH = 11;
    const y = 16;
    const blink = Math.floor(game.tick / 8) % 2 === 0;

    game.fighters.forEach((f, i) => {
      const ratio = Math.max(0, f.hp / f.maxHp);
      if (this.ghost[i] < ratio) this.ghost[i] = ratio;
      if (this.ghost[i] > ratio) {
        if (f.isActionable() || f.sm.is('grounded', 'ko')) this.ghostDelay[i] += dt;
        if (this.ghostDelay[i] > 25) this.ghost[i] = Math.max(ratio, this.ghost[i] - 0.006 * dt);
      } else this.ghostDelay[i] = 0;
      const x0 = i === 0 ? W / 2 - 34 - barW : W / 2 + 34;
      g.fillStyle = '#000';
      g.fillRect(x0 - 2, y - 2, barW + 4, barH + 4);
      g.fillStyle = '#3a0c10';
      g.fillRect(x0, y, barW, barH);
      const span = (r: number): [number, number] => (i === 0 ? [x0, barW * r] : [x0 + barW * (1 - r), barW * r]);
      const [gx, gw] = span(this.ghost[i]);
      g.fillStyle = '#ff5a4a';
      g.fillRect(gx, y, gw, barH);
      const [hx, hw] = span(ratio);
      const low = ratio < cfg.lowHealthRatio;
      const grad = g.createLinearGradient(0, y, 0, y + barH);
      if (low) {
        grad.addColorStop(0, blink ? '#ff8080' : '#ff4040');
        grad.addColorStop(1, '#b00010');
      } else {
        grad.addColorStop(0, '#fff8a0');
        grad.addColorStop(0.5, '#ffd020');
        grad.addColorStop(1, '#e07a10');
      }
      g.fillStyle = grad;
      g.fillRect(hx, y, hw, barH);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(hx, y + 1, hw, 2);
      // 头像
      const px = i === 0 ? x0 - 38 : x0 + barW + 6;
      g.fillStyle = '#000';
      g.fillRect(px - 2, y - 6, 36, 36);
      if (this.portraits[i]) g.drawImage(this.portraits[i], px, y - 4, 32, 32);
      // 名字 + 回合标记
      const name = f.def.name;
      this.text(name, i === 0 ? x0 : x0 + barW, y + barH + 6, { scale: 1, color: '#ffffff', outline: '#000000' }, i === 0 ? 'left' : 'right');
      if (!game.practice) {
        for (let k = 0; k < cfg.roundsToWin; k++) {
          const cx = i === 0 ? x0 + barW - 6 - k * 13 : x0 + 6 + k * 13;
          const cy = y + barH + 10;
          g.fillStyle = '#000';
          g.beginPath();
          g.arc(cx, cy, 5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = game.wins[i] > k ? '#ffd040' : '#40404c';
          g.beginPath();
          g.arc(cx, cy, 3.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      // 连击数
      const c = this.combo[i];
      if (c.life > 0) {
        c.life -= dt;
        const a = Math.min(1, c.life / 20);
        const cxp = i === 0 ? 18 : W - 18;
        this.text(`${c.hits} HITS`, cxp, 92, { scale: 3, gradient: ['#fff8c0', '#ffa020'], outline: '#401000' }, i === 0 ? 'left' : 'right', a);
        this.text(`${c.dmg} DAMAGE`, cxp, 120, { scale: 1, color: '#ffffff', outline: '#000000' }, i === 0 ? 'left' : 'right', a);
      }
    });

    // 计时器 / 模式标签
    if (game.practice) {
      this.text('PRACTICE', W / 2, 14, { scale: 1, gradient: ['#c0ffe0', '#30c080'], outline: '#002010' }, 'center');
    } else {
      const sec = Math.ceil(game.timer / cfg.fps);
      g.fillStyle = '#000';
      g.fillRect(W / 2 - 22, 6, 44, 30);
      g.fillStyle = '#1a1e30';
      g.fillRect(W / 2 - 20, 8, 40, 26);
      const timeLow = sec <= 10 && game.phase === 'fight';
      this.text(String(sec).padStart(2, '0'), W / 2, 12, { scale: 3, gradient: timeLow ? ['#ffb0b0', '#ff3030'] : ['#ffffff', '#ffd040'], outline: '#000000' }, 'center');
    }
    if (this.modeLabel) this.text(this.modeLabel, W / 2, 42, { scale: 1, color: '#a0b0d0', outline: '#000000' }, 'center');

    // 提示弹字
    const slots = [0, 0];
    for (const p of this.popups) {
      p.life -= dt;
      const a = Math.min(1, p.life / 15);
      const yy = 140 + slots[p.side]++ * 16;
      const xx = p.side === 0 ? 18 : W - 18;
      this.text(p.text, xx, yy, { scale: 2, gradient: p.colors, outline: '#000000' }, p.side === 0 ? 'left' : 'right', a);
    }
    this.popups = this.popups.filter((p) => p.life > 0);

    // 中央播报
    const an = this.announce;
    if (an) {
      an.life -= dt;
      const age = an.max - an.life;
      const pop = age < 8 ? 1 + (1 - age / 8) * 0.6 : 1;
      const a = Math.min(1, an.life / 12);
      const base = an.text.length > 9 ? 5 : 7;
      const scale = Math.max(2, Math.round(base * pop));
      this.text(an.text, W / 2, H * 0.36, { scale, gradient: ANNOUNCE_COLORS[an.kind], outline: '#000000', shadow: '#00000080' }, 'center', a);
      if (an.life <= 0) this.announce = null;
    }

    // KO 爆闪
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.85})`;
      g.fillRect(0, 0, W, H);
      this.flash = Math.max(0, this.flash - 0.05 * dt);
    }

    // 回合间黑屏
    if (!game.practice && game.setup.mode !== 'demo') {
      const F = cfg.round.fadeFrames;
      let fade = 0;
      if (game.phase === 'intro') fade = 1 - Math.min(1, game.phaseFrame / F);
      const matchOver = game.wins.some((w) => w >= cfg.roundsToWin);
      if (game.phase === 'roundEnd' && !matchOver) fade = Math.max(0, (game.phaseFrame - (cfg.round.endFrames - F)) / F);
      if (fade > 0) {
        g.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`;
        g.fillRect(0, 0, W, H);
      }
    }
  }
}
