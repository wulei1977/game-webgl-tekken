// 音效系统：Web Audio API 实时合成打击 / 格挡 / 挥空 / 投技 / 飞行道具 / KO 音效 + 芯片风格擂台 BGM，
// 播报使用浏览器 SpeechSynthesis（不可用时退化为合成提示音）。无需任何音频文件。
import type { GameEvent, ProjectileKind } from '../core/types';

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const SPEECH: Record<string, string> = {
  'FINAL ROUND': 'Final round',
  'FIGHT!': 'Fight!',
  'K.O.': 'K. O.',
  'DOUBLE K.O.': 'Double K. O.',
  'TIME UP': 'Time up',
  PERFECT: 'Perfect!',
  DRAW: 'Draw',
};

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private timer: number | null = null;
  private nextTime = 0;
  private stepIdx = 0;
  private mode: 'menu' | 'fight' | null = null;
  muted = false;
  musicVolume = 0.55;
  voice = true;
  /** 演示模式（菜单背景）中只播 BGM，不播打击音效 */
  quiet = false;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume * 0.5;
      this.musicBus.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
    if (m && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------------ 合成基础

  private get now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, bus?: AudioNode): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1, bus?: AudioNode): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(bus ?? this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private ok(): boolean {
    return !!this.ctx && !this.muted && !this.quiet;
  }

  // ------------------------------------------------------------------ 音效

  hit(heavy: boolean, counter: boolean, weapon: boolean): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'sine', heavy ? 160 : 210, 45, heavy ? 0.22 : 0.12, heavy ? 0.9 : 0.6);
    this.noise(t, heavy ? 0.16 : 0.08, 'bandpass', heavy ? 1800 : 2600, 600, heavy ? 0.8 : 0.55, 0.8);
    if (weapon) this.tone(t, 'square', 1400, 900, 0.08, 0.15);
    if (counter) this.tone(t + 0.01, 'square', 1800, 1700, 0.12, 0.12);
  }

  block(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'square', 950, 700, 0.05, 0.18);
    this.noise(t, 0.05, 'highpass', 4000, 2500, 0.3);
  }

  whiff(heavy: boolean): void {
    if (!this.ok()) return;
    const t = this.now + 0.02;
    this.noise(t, heavy ? 0.16 : 0.1, 'bandpass', 500, heavy ? 1800 : 2400, heavy ? 0.22 : 0.14, 1.5);
  }

  throwGrab(): void {
    if (!this.ok()) return;
    this.noise(this.now, 0.08, 'lowpass', 1200, 300, 0.4);
  }

  slam(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'sine', 120, 35, 0.4, 1);
    this.noise(t, 0.3, 'lowpass', 1500, 120, 0.9);
  }

  land(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'sine', 90, 40, 0.18, 0.5);
    this.noise(t, 0.12, 'lowpass', 800, 150, 0.35);
  }

  jump(): void {
    if (!this.ok()) return;
    this.noise(this.now, 0.06, 'bandpass', 900, 1600, 0.08, 2);
  }

  step(): void {
    if (!this.ok()) return;
    this.noise(this.now, 0.03, 'lowpass', 600, 200, 0.06);
  }

  guardBreak(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.noise(t, 0.4, 'highpass', 6000, 1500, 0.5);
    this.tone(t, 'sawtooth', 600, 120, 0.35, 0.25);
  }

  armor(): void {
    if (!this.ok()) return;
    this.tone(this.now, 'triangle', 300, 260, 0.15, 0.35);
  }

  weapon(drawn: boolean): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'square', drawn ? 600 : 900, drawn ? 1200 : 500, 0.07, 0.1);
    this.noise(t, 0.05, 'highpass', 5000, 3000, 0.15);
  }

  projectile(kind: ProjectileKind): void {
    if (!this.ok()) return;
    const t = this.now;
    if (kind === 'shock') {
      this.tone(t, 'square', 1600, 400, 0.25, 0.15);
      this.noise(t, 0.25, 'bandpass', 3000, 5000, 0.2, 4);
    } else if (kind === 'flash') {
      this.tone(t, 'triangle', 700, 1400, 0.12, 0.2);
    } else if (kind === 'cannon') {
      this.tone(t, 'sawtooth', 220, 60, 0.5, 0.35);
      this.noise(t, 0.4, 'lowpass', 900, 200, 0.4);
    } else {
      this.tone(t, 'sawtooth', 900, 180, 0.3, 0.22);
      this.noise(t, 0.2, 'bandpass', 1200, 500, 0.2);
    }
  }

  explosion(kind: ProjectileKind): void {
    if (!this.ok()) return;
    const t = this.now;
    if (kind === 'flash') {
      this.noise(t, 0.35, 'highpass', 8000, 2000, 0.6);
      this.tone(t, 'square', 2400, 2000, 0.2, 0.12);
    } else {
      this.noise(t, 0.3, 'lowpass', 2000, 200, 0.6);
    }
  }

  ko(): void {
    if (!this.ok()) return;
    const t = this.now;
    this.tone(t, 'sine', 140, 30, 0.9, 1);
    this.noise(t, 0.7, 'lowpass', 3000, 100, 0.9);
    this.tone(t + 0.05, 'sawtooth', 300, 40, 0.8, 0.25);
  }

  ui(kind: 'move' | 'select' | 'back'): void {
    if (!this.ctx || this.muted) return;
    const t = this.now;
    if (kind === 'move') this.tone(t, 'square', 660, 660, 0.04, 0.08);
    else if (kind === 'select') {
      this.tone(t, 'square', 880, 880, 0.06, 0.1);
      this.tone(t + 0.06, 'square', 1320, 1320, 0.08, 0.1);
    } else this.tone(t, 'square', 440, 330, 0.08, 0.08);
  }

  announce(text: string): void {
    if (!this.ctx || this.muted || this.quiet) return;
    const t = this.now;
    this.tone(t, 'square', 523, 523, 0.08, 0.07);
    this.tone(t + 0.08, 'square', 784, 784, 0.14, 0.07);
    if (!this.voice || !('speechSynthesis' in window)) return;
    const say = SPEECH[text] ?? text.replace(/ROUND (\d)/, 'Round $1').toLowerCase();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(say);
      u.lang = 'en-US';
      u.rate = 0.92;
      u.pitch = 0.55;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch {
      // 浏览器不支持语音合成时忽略
    }
  }

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'attack':
        this.whiff(e.heavy);
        break;
      case 'hit':
        this.hit(e.heavy, e.counter, e.weapon);
        if (e.projectile) this.explosion(e.projectile);
        break;
      case 'block':
        this.block();
        break;
      case 'guardBreak':
        this.guardBreak();
        break;
      case 'armor':
        this.armor();
        break;
      case 'throwStart':
        this.throwGrab();
        break;
      case 'throwHit':
        this.slam();
        break;
      case 'throwBreak':
        this.block();
        this.weapon(true);
        break;
      case 'projectileSpawn':
        this.projectile(e.kind);
        break;
      case 'projectileEnd':
        if (e.reason === 'clash' || (e.reason === 'expire' && e.kind === 'flash')) this.explosion(e.kind);
        break;
      case 'land':
        if (e.heavy) this.land();
        break;
      case 'jump':
        this.jump();
        break;
      case 'step':
        this.step();
        break;
      case 'weapon':
        this.weapon(e.drawn);
        break;
      case 'announce':
        this.announce(e.text);
        break;
      case 'ko':
        this.ko();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ BGM（步进音序器）

  get musicMode(): 'menu' | 'fight' | null {
    return this.timer !== null ? this.mode : null;
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  startMusic(mode: 'menu' | 'fight'): void {
    if (!this.ctx) return;
    if (this.mode === mode && this.timer !== null) return;
    this.stopMusic();
    this.mode = mode;
    this.stepIdx = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.mode = null;
  }

  private schedule(): void {
    const c = this.ctx;
    if (!c || !this.mode) return;
    const bpm = this.mode === 'fight' ? 152 : 108;
    const stepDur = 60 / bpm / 4;
    while (this.nextTime < c.currentTime + 0.15) {
      this.playStep(this.stepIdx, this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.stepIdx = (this.stepIdx + 1) % 64;
    }
  }

  private playStep(i: number, t: number, d: number): void {
    const bus = this.musicBus;
    const bar = Math.floor(i / 16);
    const s = i % 16;
    const roots = this.mode === 'fight' ? [45, 45, 41, 43] : [45, 41, 43, 40];
    const root = roots[bar];
    if (this.mode === 'fight') {
      const bassPat = [0, -1, 0, 12, -1, 0, -1, 12, 0, -1, 0, 7, -1, 0, 12, -1];
      const n = bassPat[s];
      if (n >= 0) this.tone(t, 'sawtooth', midi(root + n - 12), midi(root + n - 12), d * 0.9, 0.22, bus);
      if (s % 4 === 0) this.tone(t, 'sine', 150, 40, 0.14, 0.75, bus);
      if (s === 4 || s === 12) this.noise(t, 0.12, 'bandpass', 2200, 1200, 0.45, 0.7, bus);
      if (s % 2 === 0) this.noise(t, 0.03, 'highpass', 9000, 7000, 0.12, 1, bus);
      if (bar >= 2 || s % 8 === 6) {
        const chord = bar === 2 ? [0, 4, 7] : bar === 3 ? [0, 4, 7, 10] : [0, 3, 7];
        const note = root + 24 + chord[s % chord.length] + (s >= 8 ? 12 : 0);
        this.tone(t, 'square', midi(note), midi(note), d * 0.7, 0.05, bus);
      }
    } else {
      if (s % 8 === 0) this.tone(t, 'triangle', midi(root - 12), midi(root - 12), d * 7, 0.25, bus);
      if (s % 4 === 2) this.noise(t, 0.03, 'highpass', 8000, 6000, 0.06, 1, bus);
      const arp = [0, 7, 12, 15, 12, 7];
      if (s % 2 === 0) {
        const note = root + 24 + arp[(s / 2) % arp.length];
        this.tone(t, 'square', midi(note), midi(note), d * 1.5, 0.035, bus);
      }
    }
  }
}
