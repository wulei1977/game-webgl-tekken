// 对战渲染总控：场景、相机、角色、飞行道具、特效、判定框；消费逻辑层事件生成视觉反馈
import * as THREE from 'three';
import { CameraController } from '../core/CameraController';
import { gameConfig } from '../core/config';
import type { Game } from '../core/Game';
import type { GameEvent } from '../core/types';
import { EffectManager } from '../effect/EffectManager';
import { ProjectileView } from '../projectile/ProjectileView';
import { buildStage, type Stage } from '../scene/Stage';
import { FighterView } from './FighterView';
import { HitboxDebugView } from './HitboxDebugView';
import { ps1Uniforms } from './PS1Material';

export class GameView {
  readonly scene = new THREE.Scene();
  readonly cam: CameraController;
  readonly effects: EffectManager;
  readonly stage: Stage;
  readonly hitboxes: HitboxDebugView;
  private fighters: FighterView[] = [];
  private projectiles: ProjectileView;
  private lastSim = 0;
  private time = 0;
  private focus = new THREE.Vector3();
  game: Game | null = null;

  constructor() {
    this.cam = new CameraController(gameConfig.render.fov);
    this.stage = buildStage(this.scene);
    this.effects = new EffectManager(this.scene);
    this.projectiles = new ProjectileView(this.scene, this.effects);
    this.hitboxes = new HitboxDebugView(this.scene);
    ps1Uniforms.uFogNear.value = 16;
    ps1Uniforms.uFogFar.value = 60;
  }

  bind(game: Game): void {
    for (const f of this.fighters) f.dispose();
    this.game = game;
    const same = game.fighters[0].def.id === game.fighters[1].def.id;
    this.fighters = game.fighters.map((f, i) => new FighterView(this.scene, f, same && i === 1));
    this.projectiles.clear();
    this.effects.clear();
    this.cam.snap();
    this.lastSim = game.simFrame;
  }

  /** 每个渲染帧调用一次（逻辑帧已推进之后） */
  update(dtSeconds: number, events: GameEvent[]): void {
    const g = this.game;
    if (!g) return;
    this.time += dtSeconds;
    if (g.simFrame < this.lastSim) this.lastSim = g.simFrame;
    const dt = g.simFrame - this.lastSim;
    this.lastSim = g.simFrame;
    for (const e of events) this.handle(e, g);
    for (const fv of this.fighters) fv.update(g, dt, g.hitstop > 0 && fv.fighter.flash > 0);
    this.projectiles.sync(g);
    this.effects.update(dt);
    this.cam.update(g, dtSeconds);
    const [a, b] = g.fighters;
    this.focus.set((a.pos.x + b.pos.x) / 2, 1, (a.pos.z + b.pos.z) / 2);
    this.stage.update(this.time, this.cam.camera, this.focus);
    this.hitboxes.update(g);
  }

  private handle(e: GameEvent, g: Game): void {
    const fx = this.effects;
    switch (e.type) {
      case 'hit':
        fx.hit(e.pos, e.heavy, e.counter, e.weapon);
        if (e.level === 'low') fx.lowRing(e.pos);
        this.cam.shake(e.launch ? 0.12 : e.heavy ? 0.1 : 0.035);
        break;
      case 'block':
        fx.block(e.pos);
        this.cam.shake(0.02);
        break;
      case 'guardBreak':
        fx.guardBreak(e.pos);
        this.cam.shake(0.12);
        break;
      case 'armor':
        fx.armor(e.pos);
        break;
      case 'throwHit':
        fx.throwImpact(e.pos);
        this.cam.shake(0.18);
        break;
      case 'throwBreak':
        fx.throwBreak(e.pos);
        break;
      case 'projectileEnd':
        if (e.reason === 'clash') fx.clash(e.pos);
        else if (e.reason !== 'expire' || e.kind === 'flash') fx.projectileEnd(e.kind, e.pos);
        if (e.kind === 'cannon' && e.reason === 'hit') this.cam.shake(0.15);
        break;
      case 'land':
        if (e.heavy) {
          fx.dust(e.pos, true);
          this.cam.shake(0.06);
        } else fx.dust(e.pos, false);
        break;
      case 'ko': {
        const loser = e.loser >= 0 ? g.fighters[e.loser] : g.fighters[0];
        fx.koFlash({ x: loser.pos.x, y: loser.pos.y + 1.1, z: loser.pos.z });
        this.cam.shake(0.32);
        break;
      }
      case 'roundEnd':
        if (e.winner >= 0) fx.victoryRing(g.fighters[e.winner].pos);
        break;
      default:
        break;
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.cam.camera);
  }
}
