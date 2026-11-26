// 菜单与界面（DOM 叠加层）：标题、主菜单、选人、暂停、结算、出招表、操作说明、设置（改键）
import { CHARACTER_IDS, getCharacter } from '../actor/MoveSet';
import type { AudioSystem } from '../audio/AudioSystem';
import type { KeyboardState } from '../core/InputSystem';
import type { Difficulty, DummyMode, MatchMode, MatchSetup } from '../core/types';
import { portraitCanvas } from '../render/CharacterArt';
import { moveListHTML, SYSTEM_MOVES_HTML } from './MoveList';
import { pixelTextCanvas } from './PixelFont';
import { defaultSettings, keyLabel, saveSettings, type Settings } from './Settings';

export interface MenuHost {
  audio: AudioSystem;
  kb: KeyboardState;
  settings: Settings;
  startMatch(setup: MatchSetup): void;
  resume(): void;
  restart(): void;
  toMenu(): void;
  applySettings(): void;
  currentSetup(): MatchSetup | null;
  practice: { hitboxes: boolean; frames: boolean; dummy: DummyMode; setDummy(m: DummyMode): void };
}

type Screen = 'title' | 'main' | 'select' | 'pause' | 'result' | 'movelist' | 'help' | 'settings' | 'none';

const MODE_TITLE: Record<MatchMode, string> = { vs: '对战模式 · P1 VS P2', cpu: '单人模式 · VS CPU', practice: '练习模式', demo: '' };
const DIFF: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: '简单' },
  { id: 'normal', label: '普通' },
  { id: 'hard', label: '困难' },
];
const DUMMY: { id: DummyMode; label: string }[] = [
  { id: 'stand', label: '静止（不防御）' },
  { id: 'guard', label: '自动格挡' },
  { id: 'crouch', label: '下蹲防御' },
  { id: 'cpu', label: 'CPU 对打' },
];
const ACTIONS: { key: keyof Settings['p1']; label: string }[] = [
  { key: 'up', label: '上' },
  { key: 'down', label: '下' },
  { key: 'left', label: '左' },
  { key: 'right', label: '右' },
  { key: 'LP', label: '左拳 LP' },
  { key: 'RP', label: '右拳 RP' },
  { key: 'LK', label: '左脚 LK' },
  { key: 'RK', label: '右脚 RK' },
];

function logo(text: string, scale: number, grad: [string, string]): string {
  return pixelTextCanvas(text, { scale, gradient: grad, outline: '#000000', shadow: '#00000099' }).toDataURL();
}

export class Menu {
  readonly root: HTMLElement;
  screen: Screen = 'none';
  private items: HTMLElement[] = [];
  private focus = 0;
  private onBack: (() => void) | null = null;
  private keyHook: ((code: string) => boolean) | null = null;

  constructor(
    parent: HTMLElement,
    private host: MenuHost,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'ui';
    parent.appendChild(this.root);
  }

  get blocking(): boolean {
    return this.screen !== 'none';
  }

  // ------------------------------------------------------------------ 键盘导航

  private is(code: string, kind: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'): boolean {
    const { p1, p2 } = this.host.settings;
    switch (kind) {
      case 'up':
        return code === 'ArrowUp' || code === 'KeyW' || code === p1.up || code === p2.up;
      case 'down':
        return code === 'ArrowDown' || code === 'KeyS' || code === p1.down || code === p2.down;
      case 'left':
        return code === 'ArrowLeft' || code === 'KeyA' || code === p1.left || code === p2.left;
      case 'right':
        return code === 'ArrowRight' || code === 'KeyD' || code === p1.right || code === p2.right;
      case 'ok':
        return code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === p1.LP || code === p2.LP;
      case 'back':
        return code === 'Escape' || code === 'Backspace' || code === p1.RP || code === p2.RP;
    }
  }

  handleKeys(codes: string[]): void {
    for (const code of codes) {
      if (this.screen === 'none') return;
      if (this.keyHook && this.keyHook(code)) continue;
      if (this.is(code, 'up')) this.move(-1);
      else if (this.is(code, 'down')) this.move(1);
      else if (this.is(code, 'left') || this.is(code, 'right')) {
        const el = this.items[this.focus];
        if (el?.dataset.cycle) {
          el.dispatchEvent(new CustomEvent('cycle', { detail: this.is(code, 'left') ? -1 : 1 }));
        }
      } else if (this.is(code, 'ok')) this.items[this.focus]?.click();
      else if (this.is(code, 'back') && this.onBack) {
        this.host.audio.ui('back');
        this.onBack();
      }
    }
  }

  private move(d: number): void {
    if (!this.items.length) return;
    this.focus = (this.focus + d + this.items.length) % this.items.length;
    this.host.audio.ui('move');
    this.paintFocus();
  }

  private paintFocus(): void {
    this.items.forEach((el, i) => el.classList.toggle('focus', i === this.focus));
  }

  private mount(screen: Screen, html: string, onBack: (() => void) | null, focus = 0): void {
    this.screen = screen;
    this.keyHook = null;
    this.onBack = onBack;
    this.root.innerHTML = html;
    this.root.className = `screen-${screen}`;
    this.items = Array.from(this.root.querySelectorAll<HTMLElement>('.mi'));
    this.focus = Math.min(focus, Math.max(0, this.items.length - 1));
    this.items.forEach((el, i) =>
      el.addEventListener('mouseenter', () => {
        this.focus = i;
        this.paintFocus();
      }),
    );
    this.paintFocus();
  }

  private on(sel: string, fn: (el: HTMLElement) => void): void {
    this.root.querySelectorAll<HTMLElement>(sel).forEach((el) =>
      el.addEventListener('click', () => {
        this.host.audio.unlock();
        this.host.audio.ui('select');
        fn(el);
      }),
    );
  }

  hide(): void {
    this.screen = 'none';
    this.root.innerHTML = '';
    this.root.className = '';
    this.items = [];
    this.keyHook = null;
  }

  // ------------------------------------------------------------------ 标题 / 主菜单

  showTitle(): void {
    this.mount(
      'title',
      `<div class="title">
        <img class="logo" src="${logo('WEB TEKKEN', 10, ['#fff6c0', '#ff3a20'])}" alt="WEB TEKKEN"/>
        <div class="subtitle">铁拳 · WebGL 复古 3D 格斗</div>
        <div class="press mi" data-go="1"><img src="${logo('PRESS START', 3, ['#ffffff', '#ffd040'])}" alt="PRESS START"/></div>
        <div class="foot">回车 / 空格 / 点击开始　·　PS1 低多边形风格 · Three.js WebGL</div>
      </div>`,
      null,
    );
    this.on('[data-go]', () => this.showMain());
    this.keyHook = (code) => {
      if (this.is(code, 'ok') || code === 'Escape') {
        this.host.audio.unlock();
        this.host.audio.ui('select');
        this.showMain();
        return true;
      }
      return false;
    };
  }

  showMain(focus = 0): void {
    const s = this.host.settings;
    this.mount(
      'main',
      `<div class="panel main-menu">
        <img class="logo small" src="${logo('WEB TEKKEN', 6, ['#fff6c0', '#ff3a20'])}" alt=""/>
        <button class="mi" data-mode="vs">对战模式 <small>本地双人 P1 VS P2</small></button>
        <button class="mi" data-mode="cpu">单人模式 <small>VS CPU · 三档难度</small></button>
        <button class="mi" data-mode="practice">练习模式 <small>无限血量 · 判定框 · 帧数据</small></button>
        <button class="mi" data-act="moves">出招表</button>
        <button class="mi" data-act="help">操作说明</button>
        <button class="mi" data-act="gfx" data-cycle="1">画面模式：<b>${s.hd ? '高清' : 'PS1 复古'}</b> ◀▶ <small>${s.hd ? '原生分辨率 · 抗锯齿 · 透视校正贴图' : '低分辨率 · 顶点抖动 · 扫描线'}</small></button>
        <button class="mi" data-act="settings">设置 <small>改键 · 声音 · 画面</small></button>
      </div>`,
      () => this.showTitle(),
      focus,
    );
    this.on('[data-mode]', (el) => this.showSelect(el.dataset.mode as MatchMode));
    this.on('[data-act="moves"]', () => this.showMoveList(() => this.showMain(3)));
    this.on('[data-act="help"]', () => this.showHelp(() => this.showMain(4)));
    this.on('[data-act="settings"]', () => this.showSettings(() => this.showMain(6)));
    const toggleGfx = () => {
      s.hd = !s.hd;
      saveSettings(s);
      this.host.applySettings();
      this.showMain(5);
    };
    this.on('[data-act="gfx"]', toggleGfx);
    this.root.querySelector('[data-act="gfx"]')?.addEventListener('cycle', () => {
      this.host.audio.ui('select');
      toggleGfx();
    });
  }

  // ------------------------------------------------------------------ 选人

  showSelect(mode: MatchMode, preset?: MatchSetup): void {
    const ids = [...CHARACTER_IDS] as string[];
    const st = {
      step: 0,
      cursor: preset ? ids.indexOf(preset.p1) : 0,
      p1: preset?.p1 ?? '',
      p2: preset?.p2 ?? '',
      diff: DIFF.findIndex((d) => d.id === (preset?.difficulty ?? 'normal')),
      dummy: DUMMY.findIndex((d) => d.id === (preset?.dummy ?? 'stand')),
    };
    const hasOptions = mode !== 'vs';
    const p2Label = mode === 'vs' ? 'P2' : mode === 'cpu' ? 'CPU' : '假人';
    const cards = ids
      .map((id) => {
        const c = getCharacter(id);
        return `<div class="card" data-id="${id}"><img src="${portraitCanvas(id, false, 96).toDataURL()}" alt=""/><div class="cname">${c.name}</div><div class="ctitle">${c.title} · ${c.archetype}</div></div>`;
      })
      .join('');
    const bars = (v: number) => `<span class="bar">${'■'.repeat(v)}${'□'.repeat(5 - v)}</span>`;
    const slot = (who: string, id: string, cls: string) => {
      if (!id) return `<div class="slot ${cls} empty"><div class="who">${who}</div><div class="cname">?</div></div>`;
      const c = getCharacter(id);
      return `<div class="slot ${cls}"><div class="who">${who}</div><img src="${portraitCanvas(id, cls === 'p2' && id === st.p1, 128).toDataURL()}" alt=""/>
        <div class="cname">${c.name} <small>${c.title}</small></div><div class="ctitle">${c.style} · ${c.archetype}</div>
        <div class="ratings">力量 ${bars(c.ratings.power)} 速度 ${bars(c.ratings.speed)}<br/>距离 ${bars(c.ratings.reach)} 难度 ${bars(c.ratings.difficulty)}</div>
        <div class="desc">${c.description}</div></div>`;
    };
    const render = () => {
      const hover = ids[st.cursor];
      const s1 = st.step === 0 ? hover : st.p1;
      const s2 = st.step === 1 ? hover : st.p2;
      const opts =
        mode === 'cpu'
          ? `<div class="opts ${st.step === 2 ? 'active' : ''}"><span>难度：</span>${DIFF.map((d, i) => `<button class="opt ${i === st.diff ? 'on' : ''}" data-diff="${i}">${d.label}</button>`).join('')}</div>`
          : mode === 'practice'
            ? `<div class="opts ${st.step === 2 ? 'active' : ''}"><span>假人：</span>${DUMMY.map((d, i) => `<button class="opt ${i === st.dummy ? 'on' : ''}" data-dummy="${i}">${d.label}</button>`).join('')}</div>`
            : '';
      const stepHint = ['P1 选择角色', `${p2Label} 选择角色`, mode === 'cpu' ? '选择难度' : '选择假人行为', '准备开始'][st.step];
      this.mount(
        'select',
        `<div class="panel select">
          <h2>${MODE_TITLE[mode]}</h2>
          <div class="vs-row">${slot('P1', s1, 'p1')}<div class="vs">VS</div>${slot(p2Label, s2, 'p2')}</div>
          <div class="roster ${st.step <= 1 ? 'active' : ''}">${cards}</div>
          ${opts}
          <div class="hint">${stepHint}　·　←/→ 选择　回车 / LP 确定　Esc 返回</div>
          <div class="row"><button class="mi" data-act="start">开始战斗</button><button class="mi" data-act="back">返回</button></div>
        </div>`,
        back,
      );
      this.root.querySelectorAll<HTMLElement>('.card').forEach((el, i) => {
        el.classList.toggle('cursor', st.step <= 1 && i === st.cursor);
        el.classList.toggle('pick1', el.dataset.id === st.p1);
        el.classList.toggle('pick2', el.dataset.id === st.p2);
        el.addEventListener('click', () => {
          this.host.audio.unlock();
          st.cursor = i;
          if (st.step > 1) st.step = st.p1 ? 1 : 0;
          confirm();
        });
      });
      this.on('[data-diff]', (el) => {
        st.diff = Number(el.dataset.diff);
        st.step = Math.max(st.step, 2);
        render();
      });
      this.on('[data-dummy]', (el) => {
        st.dummy = Number(el.dataset.dummy);
        st.step = Math.max(st.step, 2);
        render();
      });
      this.on('[data-act="start"]', () => start());
      this.on('[data-act="back"]', () => this.showMain());
      this.keyHook = (code) => {
        if (this.is(code, 'left') || this.is(code, 'right')) {
          const d = this.is(code, 'left') ? -1 : 1;
          if (st.step <= 1) st.cursor = (st.cursor + d + ids.length) % ids.length;
          else if (st.step === 2 && mode === 'cpu') st.diff = (st.diff + d + DIFF.length) % DIFF.length;
          else if (st.step === 2) st.dummy = (st.dummy + d + DUMMY.length) % DUMMY.length;
          this.host.audio.ui('move');
          render();
          return true;
        }
        if (this.is(code, 'ok')) {
          this.host.audio.unlock();
          if (st.step >= (hasOptions ? 3 : 2)) start();
          else confirm();
          return true;
        }
        if (this.is(code, 'up') || this.is(code, 'down')) return true;
        return false;
      };
    };
    const confirm = () => {
      this.host.audio.ui('select');
      if (st.step === 0) {
        st.p1 = ids[st.cursor];
        st.step = 1;
        st.cursor = st.p2 ? ids.indexOf(st.p2) : (st.cursor + 1) % ids.length;
      } else if (st.step === 1) {
        st.p2 = ids[st.cursor];
        st.step = 2;
      } else if (st.step === 2) {
        st.step = 3;
      }
      if (!hasOptions && st.step >= 2) {
        start();
        return;
      }
      render();
    };
    const back = () => {
      if (st.step === 0) this.showMain();
      else {
        st.step--;
        if (st.step === 0) st.cursor = Math.max(0, ids.indexOf(st.p1));
        render();
      }
    };
    const start = () => {
      const p1 = st.p1 || ids[st.step === 0 ? st.cursor : 0];
      const p2 = st.p2 || ids[st.step === 1 ? st.cursor : (ids.indexOf(p1) + 1) % ids.length];
      const setup: MatchSetup = { mode, p1, p2, difficulty: DIFF[st.diff].id, dummy: DUMMY[st.dummy].id };
      this.host.audio.ui('select');
      this.host.startMatch(setup);
    };
    render();
  }

  // ------------------------------------------------------------------ 暂停 / 结算

  showPause(focus = 0): void {
    const setup = this.host.currentSetup();
    const practice = setup?.mode === 'practice';
    const pr = this.host.practice;
    const dummyLabel = DUMMY.find((d) => d.id === pr.dummy)?.label ?? '';
    this.mount(
      'pause',
      `<div class="panel pause">
        <h2>暂停</h2>
        <button class="mi" data-act="resume">继续</button>
        <button class="mi" data-act="moves">出招表</button>
        <button class="mi" data-act="help">操作说明</button>
        ${practice ? `<button class="mi" data-act="dummy" data-cycle="1">假人行为：<b>${dummyLabel}</b> ◀▶</button>
        <button class="mi" data-act="hitbox" data-cycle="1">判定框显示：<b>${pr.hitboxes ? '开' : '关'}</b></button>
        <button class="mi" data-act="frames" data-cycle="1">帧数据面板：<b>${pr.frames ? '开' : '关'}</b></button>` : ''}
        <button class="mi" data-act="restart">${practice ? '重置位置' : '重新开始'}</button>
        <button class="mi" data-act="select">重新选择角色</button>
        <button class="mi" data-act="menu">返回主菜单</button>
      </div>`,
      () => this.host.resume(),
      focus,
    );
    const idx = (act: string) => this.items.findIndex((el) => el.dataset.act === act);
    this.on('[data-act="resume"]', () => this.host.resume());
    this.on('[data-act="moves"]', () => this.showMoveList(() => this.showPause(idx('moves'))));
    this.on('[data-act="help"]', () => this.showHelp(() => this.showPause(idx('help'))));
    this.on('[data-act="restart"]', () => this.host.restart());
    this.on('[data-act="select"]', () => setup && this.showSelect(setup.mode, setup));
    this.on('[data-act="menu"]', () => this.host.toMenu());
    const cycleDummy = (d: number) => {
      const i = DUMMY.findIndex((x) => x.id === pr.dummy);
      pr.setDummy(DUMMY[(i + d + DUMMY.length) % DUMMY.length].id);
      this.showPause(idx('dummy'));
    };
    const toggle = (act: 'hitbox' | 'frames') => {
      if (act === 'hitbox') pr.hitboxes = !pr.hitboxes;
      else pr.frames = !pr.frames;
      this.showPause(idx(act));
    };
    this.on('[data-act="dummy"]', () => cycleDummy(1));
    this.on('[data-act="hitbox"]', () => toggle('hitbox'));
    this.on('[data-act="frames"]', () => toggle('frames'));
    this.root.querySelector('[data-act="dummy"]')?.addEventListener('cycle', (e) => cycleDummy((e as CustomEvent<number>).detail));
    this.root.querySelector('[data-act="hitbox"]')?.addEventListener('cycle', () => toggle('hitbox'));
    this.root.querySelector('[data-act="frames"]')?.addEventListener('cycle', () => toggle('frames'));
  }

  showResult(winnerName: string | null, winnerIndex: number, wins: [number, number]): void {
    const setup = this.host.currentSetup();
    const title = winnerName ? `${winnerName} WINS` : 'DRAW';
    const sub = winnerIndex === 0 ? 'P1 胜利' : winnerIndex === 1 ? (setup?.mode === 'cpu' ? 'CPU 胜利' : 'P2 胜利') : '平局';
    this.mount(
      'result',
      `<div class="panel result">
        ${winnerName ? `<img class="logo small" src="${logo('WINNER', 4, ['#ffffff', '#40ffb0'])}" alt="WINNER"/>` : ''}
        <img class="logo" src="${logo(title, 7, ['#fff6c0', '#ffa020'])}" alt="${title}"/>
        <div class="subtitle">${sub}　·　回合 ${wins[0]} : ${wins[1]}</div>
        <button class="mi" data-act="again">再战一局</button>
        <button class="mi" data-act="select">重新选择角色</button>
        <button class="mi" data-act="menu">返回主菜单</button>
      </div>`,
      () => this.host.toMenu(),
    );
    this.on('[data-act="again"]', () => this.host.restart());
    this.on('[data-act="select"]', () => setup && this.showSelect(setup.mode, setup));
    this.on('[data-act="menu"]', () => this.host.toMenu());
  }

  // ------------------------------------------------------------------ 出招表 / 操作说明

  showMoveList(back: () => void, charIndex = 0): void {
    const ids = [...CHARACTER_IDS] as string[];
    const setup = this.host.currentSetup();
    const start = setup ? ids.indexOf(setup.p1) : charIndex;
    let cur = charIndex || Math.max(0, start);
    const render = () => {
      const c = getCharacter(ids[cur]);
      this.mount(
        'movelist',
        `<div class="panel wide movelist-panel">
          <h2>出招表</h2>
          <div class="tabs">${ids.map((id, i) => `<button class="tab ${i === cur ? 'on' : ''}" data-tab="${i}">${getCharacter(id).name} · ${getCharacter(id).title}</button>`).join('')}</div>
          <div class="scroll">${moveListHTML(c)}<h3>通用系统操作</h3>${SYSTEM_MOVES_HTML}</div>
          <div class="hint">←/→ 切换角色　Esc 返回　·　帧数据全部来自 config/movesets/*.json</div>
          <div class="row"><button class="mi" data-act="back">返回</button></div>
        </div>`,
        back,
      );
      this.on('[data-tab]', (el) => {
        cur = Number(el.dataset.tab);
        render();
      });
      this.on('[data-act="back"]', back);
      this.keyHook = (code) => {
        if (this.is(code, 'left') || this.is(code, 'right')) {
          cur = (cur + (this.is(code, 'left') ? -1 : 1) + ids.length) % ids.length;
          this.host.audio.ui('move');
          render();
          return true;
        }
        if (this.is(code, 'up') || this.is(code, 'down')) {
          this.root.querySelector('.scroll')?.scrollBy(0, this.is(code, 'up') ? -80 : 80);
          return true;
        }
        return false;
      };
    };
    render();
  }

  showHelp(back: () => void): void {
    const { p1, p2 } = this.host.settings;
    const row = (label: string, k: keyof Settings['p1']) => `<tr><td>${label}</td><td>${keyLabel(p1[k])}</td><td>${keyLabel(p2[k])}</td></tr>`;
    this.mount(
      'help',
      `<div class="panel wide help">
        <h2>操作说明</h2>
        <div class="scroll">
          <div class="cols">
            <table class="keys"><thead><tr><th>动作</th><th>P1</th><th>P2</th></tr></thead><tbody>
              ${row('上（跳 / 轻点侧移）', 'up')}${row('下（蹲 / 轻点侧移）', 'down')}${row('左', 'left')}${row('右', 'right')}
              ${row('左拳 LP', 'LP')}${row('右拳 RP', 'RP')}${row('左脚 LK', 'LK')}${row('右脚 RK', 'RK')}
              <tr><td>暂停</td><td colspan="2">Esc / P</td></tr>
            </tbody></table>
            <div class="notes">
              <p><b>手柄</b>（标准映射）：□/X = LP，△/Y = RP，×/A = LK，○/B = RK，R1 = LP+RP（投），R2 = LK+RK；方向键 / 左摇杆移动。1 号手柄 = P1，2 号手柄 = P2。</p>
              <p><b>段位</b>：上段可站立防御、可下蹲躲开；中段必须站立防御；下段必须下蹲防御；投技无法防御，只能在被抓瞬间按对应键挣脱（背后投不可挣脱）。</p>
              <p><b>帧系统</b>：每招都有发生 / 判定 / 收招帧。被防后硬直大的招式（如升龙拳 -13）可以被对手确反。</p>
              <p><b>浮空连</b>：带「浮空」属性的招式命中后可在空中追击，连段越长浮空衰减越快，最多 8 段后进入落地保护。</p>
              <p><b>练习模式</b>：H 判定框、F 帧数据面板、R 重置位置、1~4 切换假人行为。</p>
            </div>
          </div>
          <h3>系统操作</h3>${SYSTEM_MOVES_HTML}
        </div>
        <div class="row"><button class="mi" data-act="back">返回</button></div>
      </div>`,
      back,
    );
    this.on('[data-act="back"]', back);
  }

  // ------------------------------------------------------------------ 设置

  showSettings(back: () => void, focus = 0): void {
    const s = this.host.settings;
    const res = s.resolution === 0 ? '原生' : `${s.resolution}p`;
    // 高清模式下 PS1 相关选项不生效，置灰提示（仍可预先调整）
    const ps1Dim = s.hd ? ' dim' : '';
    const ps1Note = s.hd ? ' <small>仅 PS1 模式</small>' : '';
    const keyRows = ACTIONS.map(
      (a) => `<tr><td>${a.label}</td><td><button class="mi key" data-p="p1" data-k="${a.key}">${keyLabel(s.p1[a.key])}</button></td><td><button class="mi key" data-p="p2" data-k="${a.key}">${keyLabel(s.p2[a.key])}</button></td></tr>`,
    ).join('');
    this.mount(
      'settings',
      `<div class="panel wide settings">
        <h2>设置</h2>
        <div class="scroll cols">
          <table class="keys"><thead><tr><th>键位</th><th>P1</th><th>P2</th></tr></thead><tbody>${keyRows}</tbody></table>
          <div class="toggles">
            <button class="mi" data-t="muted" data-cycle="1">声音：<b>${s.muted ? '关' : '开'}</b></button>
            <button class="mi" data-t="music" data-cycle="1">音乐音量：<b>${Math.round(s.music * 10)}</b> ◀▶</button>
            <button class="mi" data-t="voice" data-cycle="1">语音播报：<b>${s.voice ? '开' : '关'}</b></button>
            <button class="mi" data-t="hd" data-cycle="1">画面模式：<b>${s.hd ? '高清' : 'PS1 复古'}</b> ◀▶</button>
            <button class="mi${ps1Dim}" data-t="jitter" data-cycle="1">PS1 顶点抖动：<b>${s.jitter ? '开' : '关'}</b>${ps1Note}</button>
            <button class="mi${ps1Dim}" data-t="dither" data-cycle="1">PS1 色彩抖动：<b>${s.dither ? '开' : '关'}</b>${ps1Note}</button>
            <button class="mi${ps1Dim}" data-t="scanlines" data-cycle="1">扫描线 / 噪点滤镜：<b>${s.scanlines ? '开' : '关'}</b>${ps1Note}</button>
            <button class="mi${ps1Dim}" data-t="resolution" data-cycle="1">渲染分辨率：<b>${res}</b> ◀▶${ps1Note}</button>
            <button class="mi" data-t="reset">恢复默认设置</button>
          </div>
        </div>
        <div class="hint" id="capture-hint">点击键位后按下新按键（Esc 取消）</div>
        <div class="row"><button class="mi" data-act="back">返回</button></div>
      </div>`,
      back,
      focus,
    );
    const idxOf = (el: HTMLElement) => this.items.indexOf(el);
    const commit = (el: HTMLElement) => {
      saveSettings(s);
      this.host.applySettings();
      this.showSettings(back, idxOf(el));
    };
    this.on('.key', (el) => {
      const hint = this.root.querySelector('#capture-hint');
      if (hint) hint.textContent = `正在设置 ${el.dataset.p?.toUpperCase()} 的「${ACTIONS.find((a) => a.key === el.dataset.k)?.label}」：请按下新按键…`;
      el.textContent = '…';
      this.host.kb.captureNext = (code) => {
        if (code !== 'Escape') s[el.dataset.p as 'p1' | 'p2'][el.dataset.k as keyof Settings['p1']] = code;
        commit(el);
      };
    });
    const cycle = (el: HTMLElement, d: number) => {
      const t = el.dataset.t;
      if (t === 'muted') s.muted = !s.muted;
      else if (t === 'hd') s.hd = !s.hd;
      else if (t === 'voice') s.voice = !s.voice;
      else if (t === 'jitter') s.jitter = !s.jitter;
      else if (t === 'dither') s.dither = !s.dither;
      else if (t === 'scanlines') s.scanlines = !s.scanlines;
      else if (t === 'music') s.music = Math.min(1, Math.max(0, Math.round((s.music + d * 0.1) * 10) / 10));
      else if (t === 'resolution') {
        const opts = [360, 480, 0];
        s.resolution = opts[(opts.indexOf(s.resolution) + d + opts.length) % opts.length];
      } else if (t === 'reset') {
        const def = defaultSettings();
        Object.assign(s, def);
      }
      commit(el);
    };
    this.on('[data-t]', (el) => cycle(el, 1));
    this.root.querySelectorAll<HTMLElement>('[data-cycle]').forEach((el) => el.addEventListener('cycle', (e) => cycle(el, (e as CustomEvent<number>).detail)));
    this.on('[data-act="back"]', back);
  }
}
