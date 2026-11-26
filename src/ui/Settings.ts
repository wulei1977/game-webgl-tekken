// 用户设置（本地持久化）：键位、音量、PS1 画面效果
import { gameConfig, type KeyBindings } from '../core/config';

export interface Settings {
  p1: KeyBindings;
  p2: KeyBindings;
  muted: boolean;
  music: number;
  voice: boolean;
  jitter: boolean;
  dither: boolean;
  scanlines: boolean;
  /** 内部渲染高度：360 / 480 / 0（原生分辨率） */
  resolution: number;
  /** 高清模式：原生分辨率 + 抗锯齿 + 透视校正贴图，关闭全部 PS1 复古效果 */
  hd: boolean;
}

const KEY = 'webtekken.settings.v1';

export function defaultSettings(): Settings {
  return {
    p1: { ...gameConfig.keyboard.p1 },
    p2: { ...gameConfig.keyboard.p2 },
    muted: false,
    music: 0.55,
    voice: true,
    jitter: gameConfig.render.vertexSnap,
    dither: gameConfig.render.dither,
    scanlines: gameConfig.render.scanlines,
    resolution: gameConfig.render.internalHeight,
    hd: false,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...d, ...s, p1: { ...d.p1, ...(s.p1 ?? {}) }, p2: { ...d.p2, ...(s.p2 ?? {}) } };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 隐私模式等情况下忽略
  }
}

/** 按键代码的友好显示 */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `小键盘${code.slice(6)}`;
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: '空格', Enter: '回车',
    ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl', Comma: ',', Period: '.', Slash: '/',
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
  };
  return map[code] ?? code;
}
