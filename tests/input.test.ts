import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/core/FrameData';
import { detectDoubleTap, InputBuffer, matchCommand, rawToFrame } from '../src/core/InputSystem';
import { BTN } from '../src/core/types';

function feed(buf: InputBuffer, frames: [number, number][]): void {
  for (const [dir, held] of frames) buf.push({ dir, held });
}

describe('输入缓冲与指令识别', () => {
  it('屏幕方向转换为相对方向', () => {
    const raw = { up: false, down: true, left: false, right: true, LP: true, RP: false, LK: false, RK: false };
    expect(rawToFrame(raw, true)).toEqual({ dir: 3, held: BTN.LP }); // 对手在右：右 = 前
    expect(rawToFrame(raw, false).dir).toBe(1); // 对手在左：右 = 后
  });

  it('df+RP 严格匹配，d+LK 宽松接受 d/b', () => {
    const b = new InputBuffer();
    feed(b, [[5, 0], [3, 0], [3, BTN.RP]]);
    expect(matchCommand(b, parseCommand('df+RP'), 8, false)).toBe(0);
    const b2 = new InputBuffer();
    feed(b2, [[5, 0], [1, BTN.LK]]);
    expect(matchCommand(b2, parseCommand('d+LK'), 8, false)).toBe(-1);
    expect(matchCommand(b2, parseCommand('d+LK'), 8, true)).toBe(0);
  });

  it('f,f+RK 需要中间松开前', () => {
    const ok = new InputBuffer();
    feed(ok, [[5, 0], [6, 0], [6, 0], [5, 0], [6, BTN.RK]]);
    expect(matchCommand(ok, parseCommand('f,f+RK'), 8, false)).toBe(0);
    const hold = new InputBuffer();
    feed(hold, [[5, 0], [6, 0], [6, 0], [6, 0], [6, BTN.RK]]);
    expect(matchCommand(hold, parseCommand('f,f+RK'), 8, false)).toBe(-1);
  });

  it('qcf 允许省略斜向', () => {
    const b = new InputBuffer();
    feed(b, [[5, 0], [2, 0], [2, 0], [6, BTN.LP]]);
    expect(matchCommand(b, parseCommand('qcf+LP'), 8, false)).toBe(0);
    const held = new InputBuffer();
    feed(held, [[5, 0], [6, 0], [6, BTN.LP]]);
    expect(matchCommand(held, parseCommand('qcf+LP'), 8, false)).toBe(-1);
  });

  it('双键同时按下有 3 帧容差，且支持提前输入（缓冲）', () => {
    const b = new InputBuffer();
    feed(b, [[5, BTN.LP], [5, BTN.LP], [5, BTN.LP | BTN.RP], [5, 0], [5, 0]]);
    expect(matchCommand(b, parseCommand('LP+RP'), 8, false)).toBe(2);
    const late = new InputBuffer();
    feed(late, [[5, BTN.LP], [5, 0], [5, 0], [5, 0], [5, BTN.RP]]);
    expect(matchCommand(late, parseCommand('LP+RP'), 8, false)).toBe(-1);
  });

  it('双击方向识别冲刺', () => {
    const b = new InputBuffer();
    feed(b, [[5, 0], [6, 0], [5, 0], [6, 0]]);
    expect(detectDoubleTap(b, 6)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[5, 0], [6, 0], [6, 0], [6, 0]]);
    expect(detectDoubleTap(c, 6)).toBe(false);
  });
});
