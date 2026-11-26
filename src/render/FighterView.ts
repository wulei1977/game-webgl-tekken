// 角色渲染：模型 + 动作 + 受击闪白 + 警棍显隐 + 圆形影子 + 浮空残影
import * as THREE from 'three';
import type { Fighter } from '../actor/Fighter';
import type { Game } from '../core/Game';
import { Animator } from './Animator';
import { buildCharacterModel, type CharacterModel } from './CharacterArt';

interface Ghost {
  obj: THREE.Object3D;
  mat: THREE.MeshBasicMaterial;
  life: number;
}

export class FighterView {
  readonly model: CharacterModel;
  readonly animator: Animator;
  private shadow: THREE.Mesh;
  private ghosts: Ghost[] = [];
  private ghostMat: THREE.MeshBasicMaterial;
  private lastGhost = 0;

  constructor(
    private scene: THREE.Scene,
    readonly fighter: Fighter,
    alt: boolean,
  ) {
    this.model = buildCharacterModel(fighter.def, alt);
    this.animator = new Animator(this.model, fighter.def.id);
    scene.add(this.model.root);
    const sm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42 * this.model.scale, 10), sm);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 1;
    scene.add(this.shadow);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ffd0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  }

  update(game: Game, dt: number, impactShake: boolean): void {
    const f = this.fighter;
    const off = this.animator.rootOffset;
    off.set(0, 0, 0);
    if (impactShake) off.set((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.05);
    this.animator.update(f, game, dt);

    const u = this.model.material.uniforms;
    u.uFlash.value = f.flash > 2 ? ((f.flash - 2) / 4) * 0.45 : 0;
    if (this.model.batonHand && this.model.batonHolster) {
      this.model.batonHand.visible = f.weaponDrawn;
      this.model.batonHolster.visible = !f.weaponDrawn;
    }

    // 影子跟随髋部投影，高度越高越淡
    const hips = this.model.joints.hips;
    const hp = hips.getWorldPosition(new THREE.Vector3());
    this.shadow.position.set(hp.x, 0.012, hp.z);
    const h = Math.max(0, this.model.root.position.y);
    const k = Math.max(0.35, 1 - h * 0.35);
    this.shadow.scale.setScalar(k);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * k;

    // 浮空残影
    if ((f.state === 'juggle' || (f.state === 'attack' && f.move?.anim.type === 'flykick')) && game.simFrame - this.lastGhost >= 3) {
      this.lastGhost = game.simFrame;
      this.spawnGhost();
    }
    for (const g of this.ghosts) {
      g.life -= dt;
      g.mat.opacity = Math.max(0, (g.life / 12) * 0.35);
    }
    for (const g of this.ghosts.filter((x) => x.life <= 0)) {
      this.scene.remove(g.obj);
      g.mat.dispose();
    }
    this.ghosts = this.ghosts.filter((x) => x.life > 0);
  }

  private spawnGhost(): void {
    if (this.ghosts.length >= 6) return;
    const obj = this.model.root.clone(true);
    const mat = this.ghostMat.clone();
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = mat;
    });
    this.scene.add(obj);
    this.ghosts.push({ obj, mat, life: 12 });
  }

  dispose(): void {
    this.scene.remove(this.model.root);
    this.scene.remove(this.shadow);
    for (const g of this.ghosts) this.scene.remove(g.obj);
    this.ghosts = [];
    this.model.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.model.material.dispose();
  }
}
