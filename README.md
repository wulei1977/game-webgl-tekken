# WebTekken · WebGL 复古 3D 网页格斗

基于 Three.js（WebGL2）+ TypeScript + Vite 的 PS1 低多边形风格 3D 格斗游戏，按 `AI驱动开发策划方案.md` 与 `WebGL格斗游戏美术素材方案.md` 实现。浏览器直接游玩，无需任何外部美术 / 音频文件：角色模型、贴图、特效、BGM 与音效全部由代码程序化生成。

## 运行

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产打包到 dist/（相对路径，可直接部署到 GitHub Pages / Vercel / 任意静态目录）
npm run preview    # 本地预览打包结果
npm test           # 逻辑层单元测试（Node 环境，无需浏览器）
```

需要支持 WebGL2 的桌面浏览器（Chrome / Edge / Firefox / Safari 新版）。

## 操作

| 动作 | P1 | P2 |
|---|---|---|
| 方向 | W A S D | 方向键 |
| 左拳 LP / 右拳 RP | U / I | 小键盘 7 / 8 |
| 左脚 LK / 右脚 RK | J / K | 小键盘 4 / 5 |
| 暂停 | Esc / P | |

- 键位可在「设置」中修改（保存在 localStorage）。没有小键盘的笔记本请先给 P2 改键。
- 手柄（标准映射）：□/X=LP，△/Y=RP，×/A=LK，○/B=RK，R1=LP+RP，R2=LK+RK。1 号手柄 = P1，2 号 = P2。
- 单人 / 练习模式下，P1 同时接受两套键位和任意手柄。
- 系统操作：站立不动或按后 = 防上/中段；按下 / 下后 = 防下段；轻点上 / 下 = 侧移；按住上 = 跳；→→ 冲刺（按住继续奔跑，贴近对手自动冲撞）；←← 后撤步；倒地时 → 或拳键起身、← 后滚、↑↓ 侧滚、LK 躺地踢、RK 起身踢；下蹲后松开 ↓ 的瞬间可出起身技。
- 练习模式快捷键：H 判定框、F 帧数据面板、R 重置位置、1~4 切换假人（静止 / 自动格挡 / 下蹲 / CPU）。
- 画面模式：主菜单「画面模式」（设置里也有）可在两种画面之间切换，选择会保存。
  - PS1 复古（默认）：低分辨率、顶点抖动、仿射贴图、色彩抖动、扫描线。
  - 高清：原生分辨率（按设备像素比，最高 2 倍）、抗锯齿、透视校正贴图、mipmap 与各向异性过滤，关闭全部复古效果。
- 完整出招表在游戏内「出招表」，由招式 JSON 自动生成。

## 已实现内容（对照策划方案的开发阶段）

| 阶段 | 内容 |
|---|---|
| 0 脚手架 | Vite + TS + Three.js；60Hz 固定逻辑帧 + 每帧渲染；键盘 / 手柄输入与输入缓冲 |
| 1 状态机 + 移动 | 26 个互斥状态（待机、前后走、冲刺、奔跑、后撤、侧移、下蹲、预跳 / 跳跃 / 落地、攻击、格挡、受击、踉跄、浮空、倒地、起身、滚动、投 / 被投 / 挣脱、KO、胜利）；擂台边界约束、推挤盒 |
| 2 帧系统 + 判定 | 招式帧表 JSON 驱动（发生 / 判定 / 收招、被防与命中帧优势）；独立攻击盒（球）与分段受击盒（上/中/下段胶囊）；上段可蹲避、中段需站防、下段需蹲防；Counter Hit；打击停顿；崩防 |
| 3 浮空 / 倒地 / 投技 | 浮空技、空中追击、浮空衰减（重力递增 + 弹起衰减 + 伤害衰减）、8 段后落地保护；倒地追击；原地起身 / 后滚 / 侧滚 / 躺地踢 / 起身踢；投技、指定键挣脱窗口、背后投不可挣脱、互投抵消；戈勒姆蓄力锤击霸体 |
| 4 美术接入 | 三名分段式低模角色（840–1070 三角面，符合 800–1500 规格）+ 256×256 贴图图集 + 换色版；程序化动作（FK 姿势 + 两骨骼 IK，攻击末端精确落在攻击盒上）；擂台场景；PS1 渲染（顶点抖动、逐顶点光照、仿射贴图、15 位色 + 有序抖动、低内部分辨率最近邻放大、雾） |
| 5 UI / 回合 | 血条（红血闪烁、掉血残影）、头像、名字、回合标记、计时器、连击数、COUNTER / GUARD BREAK 等提示、ROUND / READY / FIGHT / K.O. / WINNER 播报、KO 爆闪与慢动作、回合间黑屏、三局两胜、时间到判定、平局处理、结算界面 |
| 6 AI | 简单（乱出招、很少防）/ 普通（读招格挡高低段、基础浮空连、后撤、投技、挣脱）/ 困难（记录玩家段位习惯、确反大硬直、侧移规避直线招、压起身）；练习假人 4 种模式 |
| 7 飞行道具 / 特效 / 音效 | 冲击波、电击弹、闪光弹（到点爆炸）、重炮拳；可格挡、可侧移躲开、互相抵消、可被特定招式打掉；命中火花、重击闪光、格挡火花、浮空残影、下段地面光圈、拖尾、KO 爆闪、胜利光环、相机震动；Web Audio 合成音效 + 芯片风 BGM + 语音播报 |
| 8 调优 / 打包 | 单元测试覆盖规则与 AI 自对战；生产打包 |

## 目录结构

```
config/
  gameConfig.json          全局参数：血量、回合、输入窗口、浮空衰减、崩防、打击停顿、渲染、默认键位
  movesets/*.json          招式帧表（common 为通用招式，角色同名 id 覆盖）
src/
  main.ts                  入口：渲染器、主循环、模式切换
  core/
    types.ts               共享类型与事件
    Game.ts                逻辑主循环、回合 / 胜负、事件派发（可无渲染运行）
    StateMachine.ts        通用互斥状态机
    FrameData.ts           招式 JSON 解析与校验、指令解析
    InputSystem.ts         输入缓冲、指令识别（方向序列 / 双键容差 / 宽松方向）、键盘与手柄
    CollisionSystem.ts     攻击盒 / 受击盒 / 推挤 / 边界
    Combat.ts              命中、格挡、Counter、浮空、倒地追击、霸体、崩防、投技
    CameraController.ts    铁拳式侧视相机
  actor/
    Fighter.ts             角色逻辑：位置、朝向、血量、出招查找
    FighterStates.ts       全部状态的帧逻辑
    AIFighter.ts           AI 控制器（三档难度）+ 练习假人
    HumanController.ts     玩家控制器
    MoveSet/index.ts       招式表注册
  projectile/              飞行道具逻辑与渲染
  scene/Stage.ts           擂台场景
  effect/EffectManager.ts  面片特效
  render/                  PS1 材质、程序化贴图、角色模型、动作 / IK、判定框可视化、渲染总控
  audio/AudioSystem.ts     合成音效与 BGM
  ui/                      HUD、像素字体、菜单、出招表、练习面板、设置
tests/                     Vitest 测试
scripts/shot.mjs           浏览器截图验收脚本；scripts/export-art.mjs 导出贴图
docs/art-preview/          导出的贴图预览（运行时不读取）
```

逻辑层（`core/`、`actor/`、`projectile/ProjectileManager.ts`）不依赖渲染，渲染层只读取逻辑状态。判定完全由逻辑体积决定，与模型无关。

## 招式帧表 JSON 字段

帧号从 1 开始：`startup` 是第一个判定帧（与铁拳 i 帧一致），总帧数 = `startup + active - 1 + recovery`。被防 / 命中后的硬直由帧优势反推，所以改 `advantage` 就能直接调手感。

| 字段 | 说明 |
|---|---|
| `name` / `command` | 招式名；指令如 `LP`、`df+RP`、`f,f+RK`、`qcf+LP`（↓↘→）、`qcb+LP`、`LP+RP`、`f+LP+RP`；`chain`（只能连段触发）、`auto`（系统触发） |
| `context` | `normal`（默认）/ `ws` 起身中 / `air` 跳跃中 / `ground` 倒地 / `run` 奔跑 |
| `startup` `active` `recovery` | 发生 / 判定 / 收招帧 |
| `level` `damage` | `high` / `mid` / `low` / `throw` / `none`；伤害 |
| `hitbox` | `{ reach, height, radius, lateral? }` 攻击盒中心相对脚底（米） |
| `onHit` | `{ advantage, type: normal/stagger/launch/knockdown, launch, knockback }` |
| `onCounter` | Counter Hit 时覆盖 `onHit` 的字段 |
| `onBlock` | `{ advantage, pushback }` |
| `chain` | `[{ input, move, window: [from, to], cancel? }]` 连段 |
| `tracking` `advance` | 前摇追踪角速度（度/帧）；前冲距离（米） |
| `crouching` `hitsGrounded` `armor` `clashesProjectiles` `endsGrounded` | 低姿态 / 可追击倒地 / 霸体帧区间 / 可打消飞行道具 / 招式结束仍倒地 |
| `weapon` `requiresWeapon` `toggleWeapon` | 武器招式（伤害 × 角色 `weapon.damageMultiplier`）/ 持械或徒手限定 / 第几帧拔收武器 |
| `throw` | `{ range, breakInput: LP+RP / LK+RK / none, duration, damageFrame, type: over/lift/suplex/takedown/backslam, swap }` |
| `projectile` | `{ kind, spawnFrame, speed, lifetime, radius, height, damage, level, hitStun, blockStun, pushback, onHit, explodeRadius? }` |
| `anim` | `{ type, limb }` 程序化动作模板（punch / uppercut / hook / elbow / kick / roundkick / spinkick / lowkick / sweep / stomp / hammer / cast / toss / grab / baton…） |

修改 JSON 后刷新页面即可生效；`npm test` 会校验所有招式表。

## 美术实现说明

- 角色：头、躯干、上臂、前臂、手、大腿、小腿、脚分段刚体（与初代铁拳同类做法），每个角色一张 256×256 图集，15 位色量化，最近邻采样；同角色对战时 P2 使用换色版。莉娜的警棍挂在右手挂点，拔棍 / 收棍只切换手上与腰间警棍的显隐。
- 动作：每个状态由代码生成姿势，攻击动作的手 / 脚轨迹终点就是 JSON 中的攻击盒中心，改帧数或攻击距离后动作会自动对齐。
- 场景：16 边形水泥擂台、红白边界、铁丝网围栏（遮挡镜头时自动隐藏近侧）、三层观众席（像素人群会晃动）、立柱、横幅、聚光灯、夜景天幕。
- `npm run dev` 后执行 `node scripts/export-art.mjs` 可把全部贴图导出到 `docs/art-preview/`，用于审阅或交给美术按同尺寸重绘。
- 后续换成 AI 生成的 GLB 模型时，保持骨骼命名与 `src/render/CharacterArt.ts` 的 `JOINTS` 一致即可复用现有动作与 IK；判定不受模型影响。

## 验收方式

- `npm test`：35 个测试，覆盖指令识别、三种段位规则、帧优势实测值等于帧表、浮空连与落地保护、起身、投技与挣脱、背后投、侧移躲招、冲刺 / 后撤、飞行道具命中与抵消、崩防、霸体、警棍倍率、三局两胜流程，以及三档 AI 各 6 万帧自对战无卡死，困难 AI 对简单 AI 胜率。
- `node scripts/shot.mjs <url> basic|flow|poses|states|fx|screens`：用本机 Chrome 无头打开游戏，按场景截图到 `.screenshots/` 并输出控制台错误。

## 与策划方案的差异

- 未引入 Cannon-es 与 Tween.js：角色位移按方案要求完全由逻辑控制，落地检测用简单的高度判断即可；补间用自写缓动函数。
- 动作没有使用 AnimationMixer 播放剪辑，而是按逻辑帧号直接采样程序化姿势，保证动作与帧数据逐帧一致（AnimationMixer 按时间播放，打击停顿、慢动作下会与判定错位）。
- 相机不锁死世界 Z 轴，而是始终垂直于两名角色的连线：侧移会改变双方连线方向，锁死 Z 轴会让画面逐渐变成纵深视角，PS 版铁拳也是这样处理的。玩家仍不能手动旋转镜头。
- 没有外部资源文件，所以没有 LoadingManager 进度条，启动时程序化生成全部资源（毫秒级）。
- 网络联机、剧情模式、移动端触控按方案排除在首期之外。
