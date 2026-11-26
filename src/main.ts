// 入口：初始化 WebGL 渲染器、场景、相机、输入、音频与界面；60Hz 固定逻辑帧 + 每帧渲染
import * as THREE from 'three';
import './style.css';
import { AIController, DummyController } from './actor/AIFighter';
import { HumanController } from './actor/HumanController';
import { CHARACTER_IDS } from './actor/MoveSet';
import { AudioSystem } from './audio/AudioSystem';
import { Game, type InputController } from './core/Game';
import { KeyboardState, mergeRaw, rawFromGamepad, rawFromKeyboard } from './core/InputSystem';
import type { DummyMode, MatchSetup } from './core/types';
import { GameView } from './render/GameView';
import { ps1Uniforms, setPS1Resolution } from './render/PS1Material';
import { setTextureQuality } from './render/TextureFactory';
import { HUD } from './ui/HUD';
import { Menu, type MenuHost } from './ui/Menu';
import { PracticePanel } from './ui/PracticePanel';
import { loadSettings, type Settings } from './ui/Settings';

const DIFF_LABEL = { easy: 'CPU  EASY', normal: 'CPU  NORMAL', hard: 'CPU  HARD' } as const;
const DUMMY_LABEL: Record<DummyMode, string> = { stand: '静止', guard: '自动格挡', crouch: '下蹲', cpu: 'CPU' };

class App implements MenuHost {
  renderer!: THREE.WebGLRenderer;
  private rendererHD: boolean | null = null;
  readonly view = new GameView();
  readonly audio = new AudioSystem();
  readonly kb = new KeyboardState();
  readonly settings: Settings = loadSettings();
  readonly hud: HUD;
  readonly menu: Menu;
  readonly panel: PracticePanel;
  private game: Game | null = null;
  private demo: Game;
  private setup: MatchSetup | null = null;
  private dummy: DummyController | null = null;
  private paused = false;
  private acc = 0;
  private last = 0;
  private padPrev: boolean[][] = [[], []];
  practice = {
    hitboxes: false,
    frames: true,
    dummy: 'stand' as DummyMode,
    setDummy: (m: DummyMode) => {
      this.practice.dummy = m;
      if (this.dummy) this.dummy.mode = m;
    },
  };

  constructor() {
    const app = document.getElementById('app')!;
    this.createRenderer(app, this.settings.hd);
    const crt = document.createElement('div');
    crt.className = 'crt';
    app.appendChild(crt);
    this.hud = new HUD(app);
    this.panel = new PracticePanel(app);
    this.menu = new Menu(app, this);
    this.kb.attach(window);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());

    this.demo = this.makeDemo();
    this.view.bind(this.demo);
    this.hud.bind(this.demo);
    this.hud.setVisible(false);
    this.applySettings();
    this.audio.quiet = true;
    this.menu.showTitle();
    document.getElementById('loading')?.remove();
    (window as unknown as { __webtekken: App }).__webtekken = this;
    requestAnimationFrame(this.loop);
  }

  private makeDemo(): Game {
    const ids = [...CHARACTER_IDS];
    const p1 = ids[Math.floor(Math.random() * ids.length)];
    const p2 = ids[(ids.indexOf(p1) + 1 + Math.floor(Math.random() * (ids.length - 1))) % ids.length];
    return new Game({ mode: 'demo', p1, p2, difficulty: 'hard', dummy: 'stand' }, [new AIController('hard', 1), new AIController('normal', 2)]);
  }

  private get active(): Game {
    return this.game ?? this.demo;
  }

  // ------------------------------------------------------------------ MenuHost

  currentSetup(): MatchSetup | null {
    return this.setup;
  }

  startMatch(setup: MatchSetup): void {
    this.audio.unlock();
    this.setup = setup;
    const s = this.settings;
    const single = setup.mode !== 'vs';
    // 单人模式下 P1 同时接受两套键位与任意手柄
    const c1 = new HumanController(() =>
      single
        ? mergeRaw(mergeRaw(mergeRaw(rawFromKeyboard(this.kb, s.p1), rawFromKeyboard(this.kb, s.p2)), rawFromGamepad(0)), rawFromGamepad(1))
        : mergeRaw(rawFromKeyboard(this.kb, s.p1), rawFromGamepad(0)),
    );
    let c2: InputController;
    this.dummy = null;
    if (setup.mode === 'vs') c2 = new HumanController(() => mergeRaw(rawFromKeyboard(this.kb, s.p2), rawFromGamepad(1)));
    else if (setup.mode === 'cpu') c2 = new AIController(setup.difficulty, (Date.now() & 0xffff) + 1);
    else {
      this.practice.dummy = setup.dummy;
      this.dummy = new DummyController(setup.dummy);
      c2 = this.dummy;
    }
    this.game = new Game(setup, [c1, c2]);
    this.view.bind(this.game);
    this.hud.bind(this.game);
    this.hud.modeLabel = setup.mode === 'cpu' ? DIFF_LABEL[setup.difficulty] : '';
    this.hud.setVisible(true);
    this.menu.hide();
    this.paused = false;
    this.acc = 0;
    this.audio.quiet = false;
    this.audio.startMusic('fight');
  }

  resume(): void {
    this.menu.hide();
    this.paused = false;
  }

  restart(): void {
    if (!this.setup) return;
    if (this.setup.mode === 'practice' && this.game) {
      this.game.startRound(this.game.round);
      this.resume();
      return;
    }
    this.startMatch(this.setup);
  }

  toMenu(): void {
    this.game = null;
    this.setup = null;
    this.dummy = null;
    this.paused = false;
    this.view.bind(this.demo);
    this.hud.bind(this.demo);
    this.hud.setVisible(false);
    this.audio.quiet = true;
    this.audio.startMusic('menu');
    this.menu.showMain();
  }

  /**
   * 创建 WebGL 渲染器。抗锯齿只能在创建上下文时指定，所以切换画面模式时整体重建；
   * 场景中的几何体 / 贴图 / 材质会在新渲染器首次绘制时自动重新上传。
   */
  private createRenderer(app: HTMLElement, hd: boolean): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'gl';
    const old = this.renderer as THREE.WebGLRenderer | undefined;
    if (old) {
      old.domElement.replaceWith(canvas);
      old.dispose();
      old.forceContextLoss();
    } else {
      app.prepend(canvas);
    }
    // PS1 模式：关闭抗锯齿、低内部分辨率 + 最近邻放大；高清模式：抗锯齿 + 原生分辨率
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: hd, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.rendererHD = hd;
  }

  applySettings(): void {
    const s = this.settings;
    this.audio.setMuted(s.muted);
    this.audio.setMusicVolume(s.music);
    this.audio.voice = s.voice;
    const hd = s.hd;
    if (this.rendererHD !== hd) this.createRenderer(document.getElementById('app')!, hd);
    ps1Uniforms.uSnapOn.value = !hd && s.jitter ? 1 : 0;
    ps1Uniforms.uDither.value = !hd && s.dither ? 1 : 0;
    ps1Uniforms.uAffine.value = hd ? 0 : 1;
    setTextureQuality(hd, this.renderer.capabilities.getMaxAnisotropy());
    document.body.classList.toggle('scanlines', !hd && s.scanlines);
    document.body.classList.toggle('hd', hd);
    const codes = [...Object.values(s.p1), ...Object.values(s.p2)];
    this.kb.setBlocked(codes);
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.settings.hd) {
      // 高清：按设备像素比渲染（最高 2 倍），画面 1:1 映射到屏幕像素
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      setPS1Resolution(w * dpr, h * dpr);
    } else {
      const target = this.settings.resolution || h;
      const k = Math.min(1, target / h);
      const rw = Math.max(320, Math.round(w * k));
      const rh = Math.max(180, Math.round(h * k));
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(rw, rh, false);
      setPS1Resolution(rw, rh);
    }
    this.view.cam.setAspect(w / h);
    this.hud.resize(w, h);
  }

  // ------------------------------------------------------------------ 主循环

  private pollPadMenu(): string[] {
    const out: string[] = [];
    if (!navigator.getGamepads) return out;
    const pads = navigator.getGamepads();
    for (let i = 0; i < 2; i++) {
      const gp = pads[i];
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const state = [
        ay < -0.6 || !!gp.buttons[12]?.pressed,
        ay > 0.6 || !!gp.buttons[13]?.pressed,
        ax < -0.6 || !!gp.buttons[14]?.pressed,
        ax > 0.6 || !!gp.buttons[15]?.pressed,
        !!gp.buttons[0]?.pressed,
        !!gp.buttons[1]?.pressed,
        !!gp.buttons[9]?.pressed,
      ];
      const codes = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'GamepadStart'];
      state.forEach((v, k) => {
        if (v && !this.padPrev[i][k]) out.push(codes[k]);
      });
      this.padPrev[i] = state;
    }
    return out;
  }

  private handleMatchKeys(codes: string[]): void {
    const g = this.game;
    if (!g) return;
    for (const code of codes) {
      if (code === 'Escape' || code === 'KeyP' || code === 'GamepadStart') {
        this.paused = true;
        this.menu.showPause();
        this.audio.ui('select');
        return;
      }
      if (g.practice) {
        if (code === 'KeyH') this.practice.hitboxes = !this.practice.hitboxes;
        if (code === 'KeyF') this.practice.frames = !this.practice.frames;
        if (code === 'KeyR') g.startRound(g.round);
        const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
        if (n >= 0) this.practice.setDummy((['stand', 'guard', 'crouch', 'cpu'] as DummyMode[])[n]);
      }
    }
  }

  private loop = (now: number): void => {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    const keys = [...this.kb.takePressed(), ...this.pollPadMenu()];
    if (this.menu.blocking) {
      this.menu.handleKeys(keys.map((k) => (k === 'GamepadStart' ? 'Enter' : k)));
    } else this.handleMatchKeys(keys);

    const g = this.active;
    if (!this.paused) {
      this.acc += dt * 60 * g.timeScale();
      let n = 0;
      while (this.acc >= 1 && n < 6) {
        g.step();
        this.kb.endTick();
        this.acc -= 1;
        n++;
      }
      if (n >= 6) this.acc = 0;
    }
    if (this.paused || this.menu.blocking) this.kb.endTick();
    const events = g.drainEvents();
    for (const e of events) {
      this.audio.onEvent(e);
      this.hud.onEvent(e);
      if (e.type === 'matchEnd' && g === this.game) {
        const w = e.winner >= 0 ? g.fighters[e.winner].def.name : null;
        this.menu.showResult(w, e.winner, g.wins);
      }
    }
    if (this.audio.ready && !this.audio.musicMode) this.audio.startMusic(this.game ? 'fight' : 'menu');
    this.view.hitboxes.visible = !!this.game?.practice && this.practice.hitboxes;
    this.view.update(dt, events);
    if (this.game) this.hud.draw(g, this.paused ? 0 : dt * 60 * g.timeScale());
    this.panel.update(this.game?.practice ? this.game : null, this.practice.frames && !this.menu.blocking, DUMMY_LABEL[this.practice.dummy], this.practice.hitboxes);
    this.view.render(this.renderer);
    requestAnimationFrame(this.loop);
  };
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    new App();
  } catch (err) {
    const el = document.getElementById('loading');
    if (el) el.textContent = `初始化失败：${(err as Error).message}（需要支持 WebGL2 的浏览器）`;
    throw err;
  }
});
