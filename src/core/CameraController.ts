// 格斗相机：始终保持与两名角色连线垂直的侧视角（铁拳式），只随双方中点平移/缩放，不允许玩家自由旋转。
// 浮空时略微抬高，重击 / KO 时震动；回合开场有一段环绕运镜。
import * as THREE from 'three';
import type { Game } from './Game';

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3(0, 1.6, 6);
  private look = new THREE.Vector3(0, 1, 0);
  private desired = new THREE.Vector3();
  private target = new THREE.Vector3();
  private shakeAmp = 0;
  private initialized = false;

  constructor(fov: number) {
    this.camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 200);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  snap(): void {
    this.initialized = false;
  }

  /** 对战机位；dt 单位：秒 */
  update(game: Game, dt: number): void {
    const [a, b] = game.fighters;
    const midX = (a.pos.x + b.pos.x) / 2;
    const midZ = (a.pos.z + b.pos.z) / 2;
    const sep = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    const maxY = Math.max(a.pos.y, b.pos.y, 0);
    this.target.set(midX, 1.05 + maxY * 0.35, midZ);
    let dist = THREE.MathUtils.clamp(3.3 + sep * 0.8, 4.3, 9.5);
    const n = game.viewNormal;
    let nx = n.x;
    let nz = n.z;
    // 回合开场环绕
    if (game.phase === 'intro' && !game.practice) {
      const t = Math.min(1, game.phaseFrame / game.config.round.introFrames);
      const ang = (1 - t) * (1 - t) * 1.1;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      nx = n.x * c - n.z * s;
      nz = n.x * s + n.z * c;
      dist += (1 - t) * 2.5;
    }
    if (game.phase === 'roundEnd' && game.roundWinner >= 0) {
      const w = game.fighters[game.roundWinner];
      const t = Math.min(1, game.phaseFrame / 60);
      this.target.lerp(new THREE.Vector3(w.pos.x, 1.3, w.pos.z), t * 0.6);
      dist = THREE.MathUtils.lerp(dist, 3.6, t * 0.7);
    }
    this.desired.set(this.target.x + nx * dist, this.target.y + 0.5 + maxY * 0.2, this.target.z + nz * dist);
    if (!this.initialized) {
      this.pos.copy(this.desired);
      this.look.copy(this.target);
      this.initialized = true;
    }
    this.pos.lerp(this.desired, 1 - Math.exp(-dt * 6));
    this.look.lerp(this.target, 1 - Math.exp(-dt * 9));
    this.apply(dt);
  }

  /** 菜单背景：绕擂台缓慢环绕 */
  attract(time: number, dt: number): void {
    const ang = time * 0.12;
    this.desired.set(Math.sin(ang) * 8.5, 2.6, Math.cos(ang) * 8.5);
    this.target.set(0, 1.0, 0);
    if (!this.initialized) {
      this.pos.copy(this.desired);
      this.look.copy(this.target);
      this.initialized = true;
    }
    this.pos.lerp(this.desired, 1 - Math.exp(-dt * 3));
    this.look.lerp(this.target, 1 - Math.exp(-dt * 3));
    this.apply(dt);
  }

  private apply(dt: number): void {
    this.camera.position.copy(this.pos);
    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    this.camera.lookAt(this.look);
  }
}
