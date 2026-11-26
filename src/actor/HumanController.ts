// 玩家控制器：读取键盘 / 手柄的屏幕方向输入，按角色所在屏幕一侧转换为“前 / 后”
import type { Game, InputController } from '../core/Game';
import { rawToFrame } from '../core/InputSystem';
import type { InputFrame, RawInput } from '../core/types';
import type { Fighter } from './Fighter';

export class HumanController implements InputController {
  constructor(private read: () => RawInput) {}

  poll(_game: Game, self: Fighter): InputFrame {
    return rawToFrame(this.read(), self.opponentOnRight());
  }
}
