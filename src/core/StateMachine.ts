// 通用有限状态机：任意时刻只有一个当前状态（格斗角色状态互斥的基础）

export interface StateDef<TOwner, TId extends string> {
  id: TId;
  enter?(owner: TOwner, params: unknown): void;
  /** 每个逻辑帧调用一次；frame 为进入该状态后的帧号（首帧为 1） */
  update(owner: TOwner, frame: number): void;
  exit?(owner: TOwner, next: TId): void;
}

export class StateMachine<TOwner, TId extends string> {
  private defs = new Map<TId, StateDef<TOwner, TId>>();
  private cur!: StateDef<TOwner, TId>;
  /** 当前状态已运行的帧数（update 前自增，首帧为 1） */
  frame = 0;
  /** 状态切换次数，供渲染层检测切换以做动作过渡 */
  serial = 0;
  previous: TId | null = null;

  constructor(
    private owner: TOwner,
    defs: StateDef<TOwner, TId>[],
    initial: TId,
  ) {
    for (const d of defs) this.defs.set(d.id, d);
    const first = this.defs.get(initial);
    if (!first) throw new Error(`初始状态 ${initial} 未注册`);
    this.cur = first;
  }

  get id(): TId {
    return this.cur.id;
  }

  is(...ids: TId[]): boolean {
    return ids.includes(this.cur.id);
  }

  change(id: TId, params?: unknown): void {
    const next = this.defs.get(id);
    if (!next) throw new Error(`状态 ${id} 未注册`);
    this.cur.exit?.(this.owner, id);
    this.previous = this.cur.id;
    this.cur = next;
    this.frame = 0;
    this.serial++;
    next.enter?.(this.owner, params);
  }

  update(): void {
    this.frame++;
    this.cur.update(this.owner, this.frame);
  }
}
