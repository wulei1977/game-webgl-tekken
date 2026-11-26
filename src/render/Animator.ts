// 程序化动作系统：根据角色逻辑状态 + 帧号生成姿势（FK 关节角 + IK 末端目标），并在状态切换时做短时间交叉淡入。
// 攻击动作的末端轨迹终点就是招式帧表里的攻击盒中心，保证“看到打中”与“判定打中”一致。
import * as THREE from 'three';
import type { Fighter } from '../actor/Fighter';
import type { Game } from '../core/Game';
import { clamp, DEG, forwardOf, lerp, smoothstep } from '../core/math';
import type { Limb, MoveDef, ThrowType } from '../core/types';
import { JOINTS, type CharacterModel, type JointName } from './CharacterArt';
import { setWorldQuaternion, solveTwoBone, type Chain } from './IK';

type V3 = [number, number, number];

interface LimbIK {
  pos: V3;
  pole: V3;
  w?: number;
  plant?: boolean;
  footYaw?: number;
}

export interface PoseOut {
  hips: V3;
  rot: Partial<Record<JointName, V3>>;
  ik: Partial<Record<Limb, LimbIK>>;
}

interface Style {
  hipsY: number;
  yaw: number;
  lean: number;
  footF: [number, number];
  footB: [number, number];
  handF: V3;
  handB: V3;
  bob: number;
  bobRate: number;
  crouch: number;
}

const STYLES: Record<string, Style> = {
  heishi: { hipsY: -0.07, yaw: -25, lean: 6, footF: [0.07, 0.24], footB: [-0.12, -0.2], handF: [0.08, 1.48, 0.3], handB: [-0.05, 1.42, 0.14], bob: 0.012, bobRate: 0.09, crouch: -0.42 },
  golem: { hipsY: -0.09, yaw: -15, lean: 12, footF: [0.13, 0.22], footB: [-0.17, -0.2], handF: [0.16, 1.34, 0.3], handB: [-0.17, 1.3, 0.2], bob: 0.008, bobRate: 0.06, crouch: -0.4 },
  rina: { hipsY: -0.06, yaw: -30, lean: 4, footF: [0.05, 0.21], footB: [-0.1, -0.18], handF: [0.07, 1.44, 0.26], handB: [-0.05, 1.38, 0.12], bob: 0.02, bobRate: 0.16, crouch: -0.4 },
};

const ease = smoothstep;
const easeIn = (t: number) => clamp(t, 0, 1) ** 2;
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 2;
const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function addRot(p: PoseOut, j: JointName, r: V3): void {
  const cur = p.rot[j] ?? [0, 0, 0];
  p.rot[j] = [cur[0] + r[0], cur[1] + r[1], cur[2] + r[2]];
}

const LIMBS: Limb[] = ['footL', 'footR', 'handL', 'handR'];

export class Animator {
  private chains: Record<Limb, Chain>;
  private snap = new Map<JointName, THREE.Quaternion>();
  private snapHips = new THREE.Vector3();
  private blend = 1;
  private blendDur = 1;
  private lastKey = '';
  private st: Style;
  private s: number;
  private ankle: number;
  private v = new THREE.Vector3();
  private pv = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private yq = new THREE.Quaternion();
  private eu = new THREE.Euler();
  private up = new THREE.Vector3(0, 1, 0);
  /** 渲染层额外的根节点偏移（被投时的抛物线轨迹） */
  readonly rootOffset = new THREE.Vector3();

  constructor(
    private model: CharacterModel,
    private id: string,
  ) {
    const j = model.joints;
    const L = model.lengths;
    this.chains = {
      handL: { upper: j.shoulderL, lower: j.elbowL, end: j.handL, lenA: L.upperArm, lenB: L.forearm },
      handR: { upper: j.shoulderR, lower: j.elbowR, end: j.handR, lenA: L.upperArm, lenB: L.forearm },
      footL: { upper: j.thighL, lower: j.kneeL, end: j.footL, lenA: L.thigh, lenB: L.shin },
      footR: { upper: j.thighR, lower: j.kneeR, end: j.footR, lenA: L.thigh, lenB: L.shin },
    };
    this.st = STYLES[id] ?? STYLES.heishi;
    this.s = model.scale;
    this.ankle = model.ankleHeight;
    for (const n of JOINTS) this.snap.set(n, new THREE.Quaternion());
  }

  // ------------------------------------------------------------------ 主流程

  update(f: Fighter, game: Game, dt: number): void {
    const root = this.model.root;
    this.placeRoot(f, root);
    root.updateMatrixWorld(true);

    const key = `${f.sm.serial}|${f.throwInfo?.landed ? 1 : 0}`;
    if (key !== this.lastKey) {
      this.takeSnapshot();
      this.blend = 0;
      this.blendDur = this.blendFrames(f);
      this.lastKey = key;
    }

    const pose = this.sample(f, game);
    this.applyFK(pose);
    root.updateMatrixWorld(true);
    this.applyIK(pose);
    if (this.blend < 1) {
      this.applyBlend(ease(this.blend));
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
    }
  }

  private placeRoot(f: Fighter, root: THREE.Object3D): void {
    root.position.copy(f.pos);
    let yaw = f.facing;
    const t = f.throwInfo;
    if (f.sm.is('thrown') && t && !t.landed) {
      const pos = this.thrownPosition(f);
      root.position.copy(pos);
      yaw = t.back ? t.attackerFacing : t.attackerFacing + Math.PI;
    }
    root.position.add(this.rootOffset);
    root.rotation.set(0, yaw, 0);
  }

  private blendFrames(f: Fighter): number {
    switch (f.state) {
      case 'attack':
        return 2.5;
      case 'hit':
      case 'block':
      case 'stagger':
        return 2;
      case 'juggle':
        return 4;
      case 'thrown':
      case 'throwing':
        return 3;
      case 'grounded':
      case 'ko':
        return 5;
      default:
        return 5;
    }
  }

  private takeSnapshot(): void {
    for (const n of JOINTS) this.snap.get(n)!.copy(this.model.joints[n].quaternion);
    this.snapHips.copy(this.model.joints.hips.position);
  }

  private applyFK(p: PoseOut): void {
    const J = this.model.joints;
    for (const n of JOINTS) {
      const r = p.rot[n];
      if (r) {
        this.eu.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ');
        J[n].quaternion.setFromEuler(this.eu);
      } else {
        J[n].quaternion.identity();
      }
    }
    J.hips.position.copy(this.model.rest.hips).add(this.v.set(p.hips[0], p.hips[1], p.hips[2]));
  }

  private applyIK(p: PoseOut): void {
    const root = this.model.root;
    for (const limb of LIMBS) {
      const ik = p.ik[limb];
      if (!ik) continue;
      const w = ik.w ?? 1;
      if (w <= 0.001) continue;
      this.v.set(ik.pos[0], ik.pos[1], ik.pos[2]);
      root.localToWorld(this.v);
      this.pv.set(ik.pole[0], ik.pole[1], ik.pole[2]).applyQuaternion(root.quaternion).normalize();
      solveTwoBone(this.chains[limb], this.v, this.pv, w);
      if (ik.plant) {
        this.yq.setFromAxisAngle(this.up, (ik.footYaw ?? 0) * DEG);
        this.q.copy(root.quaternion).multiply(this.yq);
        setWorldQuaternion(this.chains[limb].end, this.q, w);
      }
    }
  }

  private applyBlend(t: number): void {
    const J = this.model.joints;
    for (const n of JOINTS) {
      const target = J[n].quaternion;
      this.q.copy(this.snap.get(n)!).slerp(target, t);
      target.copy(this.q);
    }
    J.hips.position.lerpVectors(this.snapHips, J.hips.position, t);
  }

  // ------------------------------------------------------------------ 基础姿势

  private S(v: V3): V3 {
    return [v[0] * this.s, v[1] * this.s, v[2] * this.s];
  }

  private foot(x: number, z: number, lift = 0): V3 {
    return [x * this.s, this.ankle + lift * this.s, z * this.s];
  }

  private get handF(): V3 {
    return this.S(this.st.handF);
  }

  private handB(f?: Fighter): V3 {
    if (f?.weaponDrawn) return this.S([-0.1, 1.32, 0.24]);
    return this.S(this.st.handB);
  }

  /** 战斗架势（左侧在前），双脚 IK 贴地、双拳 IK 护脸 */
  private stance(f?: Fighter): PoseOut {
    const st = this.st;
    return {
      hips: [0, st.hipsY * this.s, 0],
      rot: {
        hips: [0, st.yaw, 0],
        spine: [st.lean * 0.4, -st.yaw * 0.4, 0],
        chest: [st.lean * 0.6, -st.yaw * 0.32, 0],
        neck: [0, -st.yaw * 0.28, 0],
        head: [-4, 0, 0],
        shoulderL: [-50, 0, 15],
        elbowL: [-95, 0, 0],
        shoulderR: [-35, 0, -20],
        elbowR: [-120, 0, 0],
        thighL: [-20, 0, 4],
        kneeL: [30, 0, 0],
        thighR: [15, 0, -4],
        kneeR: [25, 0, 0],
      },
      ik: {
        footL: { pos: this.foot(st.footF[0], st.footF[1]), pole: [0.25, 0, 1], plant: true, footYaw: -10 },
        footR: { pos: this.foot(st.footB[0], st.footB[1]), pole: [-0.25, 0, 1], plant: true, footYaw: 25 },
        handL: { pos: this.handF, pole: [0.7, -1, -0.4] },
        handR: { pos: this.handB(f), pole: [-0.7, -1, -0.4] },
      },
    };
  }

  private crouchPose(f?: Fighter, depth = 1): PoseOut {
    const p = this.stance(f);
    const s = this.s;
    p.hips[1] = lerp(this.st.hipsY, this.st.crouch, depth) * s;
    addRot(p, 'spine', [24 * depth, 0, 0]);
    addRot(p, 'chest', [14 * depth, 0, 0]);
    addRot(p, 'head', [-22 * depth, 0, 0]);
    addRot(p, 'thighL', [-50 * depth, 0, 0]);
    addRot(p, 'kneeL', [70 * depth, 0, 0]);
    addRot(p, 'thighR', [-50 * depth, 0, 0]);
    addRot(p, 'kneeR', [70 * depth, 0, 0]);
    p.ik.footL!.pos = this.foot(this.st.footF[0] + 0.05 * depth, this.st.footF[1]);
    p.ik.footR!.pos = this.foot(this.st.footB[0] - 0.05 * depth, this.st.footB[1]);
    p.ik.handL!.pos = lerpV(this.handF, this.S([0.1, 1.06, 0.34]), depth);
    p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.06, 1.02, 0.24]), depth);
    return p;
  }

  private lying(f: Fighter): PoseOut {
    const s = this.s;
    const hipH = this.model.hipsHeight;
    const bounce = f.groundBounce > 0 ? Math.sin((1 - f.groundBounce / 10) * Math.PI) * 0.08 : 0;
    return {
      hips: [0, -(hipH - 0.15 * s) + bounce * s, 0],
      rot: {
        hips: [-90, 0, 0],
        spine: [-4, 0, 0],
        head: [12, f.dead ? 35 : 0, 0],
        shoulderL: [-15, 0, 42],
        elbowL: [-30, 0, 0],
        shoulderR: [-15, 0, -42],
        elbowR: [-30, 0, 0],
        thighL: [-8, 0, 10],
        kneeL: [14, 0, 0],
        thighR: [-16, 0, -8],
        kneeR: [24, 0, 0],
        footL: [-10, 0, 0],
        footR: [-10, 0, 0],
      },
      ik: {},
    };
  }

  // ------------------------------------------------------------------ 状态 → 姿势

  private sample(f: Fighter, game: Game): PoseOut {
    const t = game.simFrame;
    const fr = f.sm.frame;
    const s = this.s;
    const st = this.st;
    switch (f.state) {
      case 'intro':
        return this.intro(f, fr);
      case 'idle': {
        const p = this.stance(f);
        const b = Math.sin(t * st.bobRate + f.index * 1.7);
        p.hips[1] += b * st.bob * s;
        addRot(p, 'chest', [1.5 * Math.sin(t * st.bobRate * 0.5), 0, 0]);
        return p;
      }
      case 'walkF':
      case 'walkB': {
        const p = this.stance(f);
        const speed = f.state === 'walkF' ? f.stats.walkSpeed : -f.stats.backWalkSpeed;
        const ph = (fr * speed) / (0.32 * s) * Math.PI * 2;
        const a = 0.07;
        p.ik.footL!.pos = this.foot(st.footF[0], st.footF[1] + a * Math.sin(ph), 0.05 * Math.max(0, Math.cos(ph)));
        p.ik.footR!.pos = this.foot(st.footB[0], st.footB[1] - a * Math.sin(ph), 0.05 * Math.max(0, -Math.cos(ph)));
        p.hips[1] += 0.012 * s * Math.abs(Math.sin(ph));
        return p;
      }
      case 'crouch':
        return this.crouchPose(f, 1);
      case 'prejump':
        return this.crouchPose(f, 0.35);
      case 'land':
        return this.crouchPose(f, 0.4 * (1 - fr / 4));
      case 'jump':
        return this.airPose(f);
      case 'dash': {
        const p = this.stance(f);
        addRot(p, 'spine', [10, 0, 0]);
        addRot(p, 'chest', [6, 0, 0]);
        p.hips[2] += 0.06 * s;
        const k = Math.sin(clamp(fr / f.stats.dashFrames, 0, 1) * Math.PI);
        p.ik.footL!.pos = this.foot(st.footF[0], st.footF[1] + 0.12 * k, 0.06 * k);
        return p;
      }
      case 'run': {
        const p = this.stance(f);
        const ph = fr * 0.36;
        addRot(p, 'hips', [0, 15, 0]);
        addRot(p, 'spine', [14, 0, 0]);
        addRot(p, 'chest', [10, 0, 0]);
        p.hips[1] += 0.02 * s * Math.abs(Math.sin(ph));
        p.ik.footL!.pos = this.foot(0.09, 0.05 + 0.3 * Math.sin(ph), 0.15 * Math.max(0, Math.cos(ph)));
        p.ik.footR!.pos = this.foot(-0.09, 0.05 - 0.3 * Math.sin(ph), 0.15 * Math.max(0, -Math.cos(ph)));
        p.ik.handL!.pos = this.S([0.16, 1.22, 0.15 - 0.18 * Math.sin(ph)]);
        p.ik.handR!.pos = this.S([-0.16, 1.22, 0.15 + 0.18 * Math.sin(ph)]);
        return p;
      }
      case 'runStop': {
        const p = this.stance(f);
        addRot(p, 'spine', [-12, 0, 0]);
        p.hips[1] -= 0.1 * s;
        p.ik.footL!.pos = this.foot(st.footF[0], 0.42);
        return p;
      }
      case 'backdash': {
        const p = this.stance(f);
        const k = Math.sin(clamp(fr / f.stats.backdashFrames, 0, 1) * Math.PI);
        addRot(p, 'spine', [-8 * k, 0, 0]);
        p.hips[1] += 0.03 * s * k;
        p.ik.footL!.pos = this.foot(st.footF[0], st.footF[1] - 0.1 * k, 0.07 * k);
        p.ik.footR!.pos = this.foot(st.footB[0], st.footB[1] - 0.05 * k, 0.05 * k);
        return p;
      }
      case 'sidestep': {
        const p = this.stance(f);
        const k = Math.sin(clamp(fr / f.stats.sidestepFrames, 0, 1) * Math.PI);
        const side = this.sideLocal(f, game);
        p.ik.footL!.pos = this.foot(st.footF[0] + side * 0.14 * k, st.footF[1], 0.05 * k);
        p.ik.footR!.pos = this.foot(st.footB[0] + side * 0.06 * k, st.footB[1]);
        addRot(p, 'hips', [0, 0, -side * 9 * k]);
        p.hips[1] -= 0.05 * s * k;
        p.hips[0] += side * 0.06 * s * k;
        return p;
      }
      case 'attack':
        return f.move ? this.attackPose(f, f.move) : this.stance(f);
      case 'block': {
        const crouch = f.hitCrouch;
        const p = crouch ? this.crouchPose(f, 1) : this.stance(f);
        const k = clamp(1 - fr / 6, 0, 1);
        if (crouch) {
          p.ik.handL!.pos = this.S([0.12, 1.12, 0.26]);
          p.ik.handR!.pos = this.S([-0.06, 1.08, 0.22]);
        } else {
          p.ik.handL!.pos = this.S([0.11, 1.6, 0.2]);
          p.ik.handR!.pos = this.S([-0.06, 1.56, 0.16]);
          p.ik.handL!.pole = [1, -0.6, -0.2];
          p.ik.handR!.pole = [-1, -0.6, -0.2];
        }
        addRot(p, 'chest', [-7 * k, 0, 0]);
        p.hips[2] -= 0.04 * s * k;
        return p;
      }
      case 'hit':
        return this.hitPose(f);
      case 'stagger':
        return this.staggerPose(f, fr);
      case 'juggle':
        return this.jugglePose(f, fr);
      case 'grounded':
      case 'ko':
        return this.lying(f);
      case 'getup':
        return this.getupPose(f, fr);
      case 'roll':
        return this.rollPose(f, fr, game);
      case 'throwing':
        return this.throwerPose(f, fr);
      case 'thrown':
        return this.thrownPose(f, fr);
      case 'throwBreak': {
        const p = this.stance(f);
        const k = clamp(1 - fr / 20, 0, 1);
        addRot(p, 'spine', [-10 * k, 0, 0]);
        p.ik.handL!.pos = lerpV(this.handF, this.S([0.3, 1.4, 0.1]), k);
        p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.3, 1.38, 0.05]), k);
        return p;
      }
      case 'victory':
        return this.victoryPose(f, fr, t);
      default:
        return this.stance(f);
    }
  }

  /** 侧移方向在角色局部坐标中的左右（+1 = 角色左侧） */
  private sideLocal(f: Fighter, game: Game): number {
    const vn = game.viewNormal;
    const dx = -vn.x * f.sideDir;
    const dz = -vn.z * f.sideDir;
    const lx = Math.cos(f.facing);
    const lz = -Math.sin(f.facing);
    return dx * lx + dz * lz >= 0 ? 1 : -1;
  }

  private airPose(f: Fighter): PoseOut {
    const p = this.stance(f);
    const up = clamp(f.vel.y / Math.max(0.01, f.stats.jumpVelocity), -1, 1);
    const k = 1 - Math.abs(up) * 0.5;
    delete p.ik.footL;
    delete p.ik.footR;
    p.rot.thighL = [-45 - 35 * k, 0, 6];
    p.rot.kneeL = [60 + 50 * k, 0, 0];
    p.rot.thighR = [-25 - 30 * k, 0, -6];
    p.rot.kneeR = [70 + 40 * k, 0, 0];
    p.rot.footL = [25, 0, 0];
    p.rot.footR = [25, 0, 0];
    addRot(p, 'hips', [-6 * k, 0, 0]);
    return p;
  }

  private intro(f: Fighter, fr: number): PoseOut {
    const p = this.stance(f);
    const k = fr < 70 ? Math.sin(clamp((fr - 8) / 55, 0, 1) * Math.PI) : 0;
    if (k <= 0) return p;
    if (this.id === 'heishi') {
      addRot(p, 'spine', [30 * k, 0, 0]);
      addRot(p, 'chest', [12 * k, 0, 0]);
      p.ik.handL!.pos = lerpV(this.handF, this.S([0.18, 0.95, 0.12]), k);
      p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.18, 0.95, 0.12]), k);
    } else if (this.id === 'golem') {
      p.ik.handL!.pos = lerpV(this.handF, this.S([0.12, 1.38, 0.2]), k);
      p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.12, 1.38 + 0.08 * Math.sin(fr * 0.8), 0.2]), k);
      addRot(p, 'head', [-15 * k, 0, 0]);
    } else {
      p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.06, 1.7, 0.14]), k);
      p.ik.handR!.pole = [-1, 0, 0];
    }
    return p;
  }

  private hitPose(f: Fighter): PoseOut {
    const s = this.s;
    const k = f.stunTotal > 0 ? (f.stun / f.stunTotal) ** 0.6 : 0;
    const p = f.hitCrouch ? this.crouchPose(f, 1) : this.stance(f);
    if (f.hitCrouch || f.hitZone === 'high') {
      addRot(p, 'neck', [-22 * k, 0, 0]);
      addRot(p, 'head', [-18 * k, 8 * k, 0]);
      addRot(p, 'chest', [-14 * k, 0, 0]);
      addRot(p, 'spine', [-6 * k, 0, 0]);
      p.hips[2] -= 0.05 * s * k;
      p.ik.handL!.pos = lerpV(p.ik.handL!.pos, this.S([0.24, 1.42, 0.06]), k);
      p.ik.handR!.pos = lerpV(p.ik.handR!.pos, this.S([-0.24, 1.38, 0.0]), k);
    } else if (f.hitZone === 'mid') {
      addRot(p, 'spine', [22 * k, 0, 0]);
      addRot(p, 'chest', [16 * k, 0, 0]);
      addRot(p, 'head', [10 * k, 0, 0]);
      p.hips[2] -= 0.06 * s * k;
      p.hips[1] -= 0.04 * s * k;
      p.ik.handL!.pos = lerpV(p.ik.handL!.pos, this.S([0.1, 1.1, 0.22]), k);
      p.ik.handR!.pos = lerpV(p.ik.handR!.pos, this.S([-0.1, 1.06, 0.2]), k);
    } else {
      p.hips[1] -= 0.12 * s * k;
      addRot(p, 'spine', [10 * k, 0, 0]);
      addRot(p, 'hips', [0, 0, 7 * k]);
    }
    return p;
  }

  private staggerPose(f: Fighter, fr: number): PoseOut {
    const s = this.s;
    const p = this.stance(f);
    const k = f.stunTotal > 0 ? Math.min(1, (f.stun / f.stunTotal) * 1.5) : 0;
    const osc = Math.sin(fr * 0.35);
    addRot(p, 'hips', [0, 14 * osc * k, 0]);
    p.hips[2] += (-0.05 + 0.03 * osc) * s * k;
    if (f.guardBroken) {
      addRot(p, 'spine', [-18 * k, 0, 0]);
      addRot(p, 'head', [-20 * k, 0, 0]);
      p.ik.handL!.pos = lerpV(this.handF, this.S([0.45, 1.5, -0.05]), k);
      p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.45, 1.48, -0.05]), k);
    } else {
      addRot(p, 'spine', [-10 * k, 0, 0]);
      addRot(p, 'head', [-10 * k + 8 * osc * k, 0, 0]);
      p.ik.handL!.pos = lerpV(this.handF, this.S([0.3, 1.2, 0.1]), k);
      p.ik.handR!.pos = lerpV(this.handB(f), this.S([-0.3, 1.18, 0.05]), k);
      p.ik.footL!.pos = this.foot(this.st.footF[0], this.st.footF[1] - 0.08 * k * (1 + osc) * 0.5);
    }
    return p;
  }

  private jugglePose(f: Fighter, fr: number): PoseOut {
    const s = this.s;
    const hipH = this.model.hipsHeight;
    const fall = clamp((-f.vel.y + 0.05) / 0.12, 0, 1);
    const pitch = lerp(-22, -85, fall);
    const flail = Math.sin(fr * 0.3);
    const yaw = f.knockKind === 'launch' ? Math.sin(fr * 0.07) * 18 : 0;
    return {
      hips: [0, -(hipH - 0.42 * s), 0],
      rot: {
        hips: [pitch, yaw, 0],
        spine: [-8, 0, 0],
        head: [16 + 6 * flail, 0, 0],
        shoulderL: [-120 + 15 * flail, 0, 38],
        elbowL: [-35, 0, 0],
        shoulderR: [-110 - 15 * flail, 0, -38],
        elbowR: [-40, 0, 0],
        thighL: [-35 + 10 * flail, 0, 12],
        kneeL: [45, 0, 0],
        thighR: [-20 - 10 * flail, 0, -10],
        kneeR: [55, 0, 0],
      },
      ik: {},
    };
  }

  private getupPose(f: Fighter, fr: number): PoseOut {
    const s = this.s;
    const t = clamp(fr / f.getupTotal, 0, 1);
    if (t < 0.45) {
      const k = ease(t / 0.45);
      const p = this.lying(f);
      const hipH = this.model.hipsHeight;
      p.hips[1] = lerp(-(hipH - 0.15 * s), -0.5 * s, k);
      p.rot.hips = [lerp(-90, -12, k), 0, 0];
      p.rot.spine = [lerp(-4, 22, k), 0, 0];
      p.rot.thighL = [lerp(-8, -100, k), 0, 10];
      p.rot.kneeL = [lerp(14, 130, k), 0, 0];
      p.rot.thighR = [lerp(-16, -80, k), 0, -10];
      p.rot.kneeR = [lerp(24, 120, k), 0, 0];
      p.rot.shoulderL = [lerp(-15, 25, k), 0, 30];
      p.rot.shoulderR = [lerp(-15, 25, k), 0, -30];
      return p;
    }
    const k = ease((t - 0.45) / 0.55);
    const p = this.crouchPose(f, 1 - k);
    const w = ease((t - 0.45) / 0.12);
    for (const l of LIMBS) if (p.ik[l]) p.ik[l]!.w = w;
    return p;
  }

  private rollPose(f: Fighter, fr: number, game: Game): PoseOut {
    const s = this.s;
    const hipH = this.model.hipsHeight;
    const t = clamp(fr / game.config.ground.rollFrames, 0, 1);
    const p = this.lying(f);
    p.hips[1] = -(hipH - 0.28 * s);
    if (f.rollKind === 'back') {
      p.rot.hips = [-90 - 360 * ease(t), 0, 0];
      p.rot.thighL = [-110, 0, 6];
      p.rot.kneeL = [135, 0, 0];
      p.rot.thighR = [-110, 0, -6];
      p.rot.kneeR = [135, 0, 0];
      p.rot.shoulderL = [-70, 0, 20];
      p.rot.shoulderR = [-70, 0, -20];
      p.rot.elbowL = [-120, 0, 0];
      p.rot.elbowR = [-120, 0, 0];
    } else {
      p.hips[1] = -(hipH - 0.18 * s);
      p.rot.hips = [-90, 360 * ease(t) * (f.sideDir >= 0 ? 1 : -1), 0];
    }
    return p;
  }

  private victoryPose(f: Fighter, fr: number, t: number): PoseOut {
    const p = this.stance(f);
    const k = ease(clamp(fr / 20, 0, 1));
    const bob = Math.sin(t * 0.08) * 0.01 * this.s;
    p.hips[1] += bob;
    p.ik.footL!.pos = this.foot(0.12, 0.08);
    p.ik.footR!.pos = this.foot(-0.12, -0.08);
    p.rot.hips = [0, -5, 0];
    p.rot.spine = [0, 0, 0];
    p.rot.chest = [-4 * k, 0, 0];
    p.rot.neck = [0, 0, 0];
    if (this.id === 'heishi') {
      p.ik.handR = { pos: lerpV(this.handB(f), this.S([-0.14, 2.05, 0.12]), k), pole: [-1, 0, 0] };
      p.ik.handL = { pos: lerpV(this.handF, this.S([0.27, 1.0, 0.02]), k), pole: [1, 0, -0.5] };
    } else if (this.id === 'golem') {
      p.ik.handL = { pos: lerpV(this.handF, this.S([0.44, 1.78, 0.06]), k), pole: [1, -0.6, 0] };
      p.ik.handR = { pos: lerpV(this.handB(f), this.S([-0.44, 1.78, 0.06]), k), pole: [-1, -0.6, 0] };
      addRot(p, 'head', [-16 * k, 0, 0]);
      addRot(p, 'chest', [-6 * k, 0, 0]);
    } else {
      p.ik.handR = { pos: lerpV(this.handB(f), this.S(f.weaponDrawn ? [-0.16, 1.62, 0.3] : [-0.07, 1.64, 0.13]), k), pole: [-1, 0, 0] };
      p.ik.handL = { pos: lerpV(this.handF, this.S([0.24, 1.0, 0.0]), k), pole: [1, 0, -0.5] };
    }
    return p;
  }

  // ------------------------------------------------------------------ 投技

  private throwProgress(f: Fighter, fr: number): { p: number; pd: number; type: ThrowType } {
    const t = f.throwInfo!;
    return { p: clamp(fr / t.throwDef.duration, 0, 1), pd: t.throwDef.damageFrame / t.throwDef.duration, type: t.throwDef.type };
  }

  private thrownPosition(f: Fighter): THREE.Vector3 {
    const t = f.throwInfo!;
    const { p, pd, type } = this.throwProgress(f, f.sm.frame);
    const F = forwardOf(t.attackerFacing);
    const peaks: Record<ThrowType, [number, number]> = {
      over: [1.6, 0.05],
      lift: [0.7, 0.55],
      suplex: [2.1, -0.1],
      takedown: [0.35, 0.8],
      backslam: [0.9, 0.6],
    };
    const [py, pz] = peaks[type];
    const peak = new THREE.Vector3(t.attackerPos.x + F.x * pz, py * this.s, t.attackerPos.z + F.z * pz);
    if (p < 0.15) return t.victimStart.clone();
    const q = clamp((p - 0.15) / Math.max(0.01, pd - 0.15), 0, 1);
    const k = type === 'lift' ? easeIn(q) : ease(q);
    const a = t.victimStart;
    const b = t.landPos;
    const ab = a.clone().lerp(peak, k);
    const bc = peak.clone().lerp(b, k);
    return ab.lerp(bc, k);
  }

  private thrownPose(f: Fighter, fr: number): PoseOut {
    const t = f.throwInfo;
    if (!t || t.landed) return this.lying(f);
    const { p, pd, type } = this.throwProgress(f, fr);
    const q = clamp((p - 0.15) / Math.max(0.01, pd - 0.15), 0, 1);
    const hipH = this.model.hipsHeight;
    const flip: Record<ThrowType, number> = { over: -200, lift: -40, suplex: -220, takedown: 50, backslam: -70 };
    const pose = this.stance(f);
    if (p >= 0.15) {
      delete pose.ik.footL;
      delete pose.ik.footR;
      pose.hips = [0, -hipH * 0.5 * ease(q), 0];
      pose.rot.hips = [flip[type] * ease(q), 0, 0];
      pose.rot.thighL = [-20, 0, 10];
      pose.rot.thighR = [-30, 0, -10];
      pose.rot.kneeL = [30, 0, 0];
      pose.rot.kneeR = [40, 0, 0];
    }
    const wob = Math.sin(fr * 0.6);
    pose.ik.handL = { pos: this.S([0.3, 1.5 + 0.1 * wob, 0.05]), pole: [1, -0.4, 0] };
    pose.ik.handR = { pos: this.S([-0.3, 1.45 - 0.1 * wob, 0.05]), pole: [-1, -0.4, 0] };
    addRot(pose, 'head', [-15, 0, 0]);
    return pose;
  }

  private throwerPose(f: Fighter, fr: number): PoseOut {
    const t = f.throwInfo;
    const p0 = this.stance(f);
    if (!t) return p0;
    const s = this.s;
    const { p, pd, type } = this.throwProgress(f, fr);
    const grab = ease(clamp(p / 0.15, 0, 1));
    const q = clamp((p - 0.15) / Math.max(0.01, pd - 0.15), 0, 1);
    const rec = p > pd ? ease((p - pd) / (1 - pd)) : 0;
    const k = (1 - rec) * grab;
    const hands = (l: V3, r: V3, w = k) => {
      p0.ik.handL = { pos: lerpV(this.handF, this.S(l), w), pole: [0.8, -0.6, -0.2] };
      p0.ik.handR = { pos: lerpV(this.handB(f), this.S(r), w), pole: [-0.8, -0.6, -0.2] };
    };
    switch (type) {
      case 'over': {
        hands([0.14, 1.5, 0.3], [-0.12, 1.45, 0.25]);
        addRot(p0, 'hips', [0, 150 * ease(q) * (1 - rec), 0]);
        addRot(p0, 'spine', [40 * ease(q) * (1 - rec), 0, 0]);
        p0.hips[1] -= 0.12 * s * ease(q) * (1 - rec);
        break;
      }
      case 'lift': {
        hands([0.17, 1.05 + 0.35 * q, 0.4], [-0.17, 1.05 + 0.35 * q, 0.4]);
        addRot(p0, 'spine', [(-20 * ease(q) + (p > pd ? 25 : 0)) * (1 - rec), 0, 0]);
        break;
      }
      case 'suplex': {
        hands([0.15, 1.15 + 0.6 * q, 0.35 - 0.3 * q], [-0.15, 1.15 + 0.6 * q, 0.35 - 0.3 * q]);
        addRot(p0, 'spine', [-55 * ease(q) * (1 - rec), 0, 0]);
        addRot(p0, 'chest', [-30 * ease(q) * (1 - rec), 0, 0]);
        p0.hips[1] -= 0.15 * s * ease(q) * (1 - rec);
        break;
      }
      case 'takedown': {
        hands([0.1, 1.3 - 0.8 * q, 0.55], [-0.1, 1.25 - 0.8 * q, 0.6]);
        p0.hips[1] -= 0.32 * s * ease(q) * (1 - rec);
        addRot(p0, 'spine', [30 * ease(q) * (1 - rec), 0, 0]);
        break;
      }
      default: {
        hands([0.15, 1.2 + 0.4 * q, 0.45], [-0.15, 1.2 + 0.4 * q, 0.45]);
        addRot(p0, 'spine', [(-15 * q + (p > pd ? 30 : 0)) * (1 - rec), 0, 0]);
      }
    }
    return p0;
  }

  // ------------------------------------------------------------------ 攻击动作

  /** 末端轨迹：起点 → 蓄力点（前 60% 前摇）→ 加速到攻击盒中心 → 收招回起点 */
  private strikePath(start: V3, chamber: V3, impact: V3, fr: number, m: MoveDef, chamberAt = 0.6): V3 {
    const S0 = m.startup;
    if (fr < S0) {
      const u = fr / S0;
      if (u < chamberAt) return lerpV(start, chamber, ease(u / chamberAt));
      return lerpV(chamber, impact, easeIn((u - chamberAt) / (1 - chamberAt)) * 0.85 + ((u - chamberAt) / (1 - chamberAt)) * 0.15);
    }
    if (fr <= m.activeEnd) return impact;
    const r = (fr - m.activeEnd) / Math.max(1, m.total - m.activeEnd);
    if (r < 0.35) return lerpV(impact, chamber, ease(r / 0.35));
    return lerpV(chamber, start, ease((r - 0.35) / 0.65));
  }

  private attackPose(f: Fighter, m: MoveDef): PoseOut {
    const s = this.s;
    const st = this.st;
    const fr = Math.max(1, f.moveFrame);
    const ext = fr < m.startup ? easeIn(fr / m.startup) : fr <= m.activeEnd ? 1 : 1 - easeOut((fr - m.activeEnd) / Math.max(1, m.total - m.activeEnd));
    const hb = m.hitbox;
    const T: V3 = hb ? [hb.lateral, hb.height, hb.reach] : [0, 1.3 * s, 0.6 * s];
    const limb: Limb = m.anim.limb ?? 'handR';
    const side = limb.endsWith('L') ? 1 : -1;
    const isHand = limb.startsWith('hand');
    const startHand = side > 0 ? this.handF : this.handB(f);
    const startFoot = side > 0 ? this.foot(st.footF[0], st.footF[1]) : this.foot(st.footB[0], st.footB[1]);
    const type = m.anim.type;
    const crouchy = m.crouching || type === 'lowkick' || type === 'sweep' || type === 'batonSweep';
    const p = crouchy ? this.crouchPose(f, ext * (type === 'sweep' ? 1.1 : 0.8)) : this.stance(f);
    const twist = (deg: number, k = ext) => {
      addRot(p, 'hips', [0, deg * k, 0]);
      addRot(p, 'chest', [0, deg * 0.35 * k, 0]);
      addRot(p, 'neck', [0, -deg * 0.9 * k, 0]);
    };
    const setLimb = (pos: V3, pole: V3, w = 1) => {
      p.ik[limb] = { pos, pole, w, plant: false };
    };

    switch (type) {
      case 'punch': {
        setLimb(this.strikePath(startHand, [startHand[0], startHand[1] + 0.02 * s, startHand[2] - 0.06 * s], [T[0], T[1], T[2] - 0.03], fr, m), side > 0 ? [0.6, -1, -0.2] : [-0.6, -1, -0.2]);
        twist(side > 0 ? -12 : 26);
        addRot(p, 'spine', [5 * ext, 0, 0]);
        p.hips[2] += 0.07 * s * ext;
        p.hips[1] -= 0.02 * s * ext;
        break;
      }
      case 'uppercut': {
        const dip = fr < m.startup ? Math.sin((fr / m.startup) * Math.PI) : 0;
        setLimb(this.strikePath(startHand, [side * 0.12 * s, 0.95 * s, 0.16 * s], T, fr, m, 0.55), [side * 0.9, -0.6, -0.5]);
        p.hips[1] += (-0.14 * dip + 0.03 * ext) * s;
        addRot(p, 'spine', [14 * dip - (fr >= m.startup ? 8 * ext : 0), 0, 0]);
        twist(side > 0 ? -10 : 22);
        break;
      }
      case 'hook': {
        setLimb(this.strikePath(startHand, [side * 0.44 * s, 1.45 * s, 0.02 * s], T, fr, m), [side * 0.3, -0.3, -1]);
        twist(side > 0 ? -18 : 38);
        p.hips[2] += 0.06 * s * ext;
        break;
      }
      case 'elbow': {
        setLimb(this.strikePath(startHand, [side * 0.2 * s, 1.35 * s, 0.05 * s], [side * -0.04 * s, T[1] + 0.04, T[2] * 0.42], fr, m), [side * 0.35, 0, 1]);
        twist(side > 0 ? -25 : 40);
        p.hips[2] += 0.12 * s * ext;
        break;
      }
      case 'kick': {
        setLimb(this.strikePath(startFoot, [startFoot[0], 0.56 * s, 0.22 * s], [T[0], T[1], T[2] - 0.07], fr, m), [0, 0.5, 1]);
        addRot(p, 'spine', [-10 * ext, 0, 0]);
        addRot(p, 'chest', [-6 * ext, 0, 0]);
        addRot(p, 'hips', [0, (side < 0 ? 28 : -6) * ext, 0]);
        p.hips[1] += 0.03 * s * ext;
        p.hips[2] += 0.05 * s * ext;
        break;
      }
      case 'roundkick':
      case 'spinkick': {
        let w = 1;
        if (type === 'spinkick' && fr < m.startup) {
          const u = fr / m.startup;
          addRot(p, 'hips', [0, -360 * ease(u) * (side < 0 ? 1 : -1), 0]);
          w = u < 0.55 ? 0 : ease((u - 0.55) / 0.45);
        }
        setLimb(this.strikePath(startFoot, [side * 0.3 * s, 0.8 * s, 0.05 * s], T, fr, m), [side, 0.7, 0.2], w);
        addRot(p, 'hips', [0, (side < 0 ? 55 : -45) * ext, side * 12 * ext]);
        addRot(p, 'spine', [-8 * ext, 0, 0]);
        p.hips[1] += 0.04 * s * ext;
        p.hips[2] += 0.08 * s * ext;
        break;
      }
      case 'lowkick': {
        setLimb(this.strikePath(startFoot, [startFoot[0], 0.25 * s, 0.18 * s], [T[0], Math.max(T[1], this.ankle), T[2] - 0.05], fr, m), [side * 0.5, 0.3, 1]);
        addRot(p, 'spine', [8 * ext, 0, 0]);
        break;
      }
      case 'sweep': {
        setLimb(this.strikePath(startFoot, [side * 0.35 * s, 0.15 * s, 0.1 * s], [T[0], 0.12 * s, T[2]], fr, m, 0.45), [side * 0.6, 1, 0.3]);
        addRot(p, 'hips', [0, (side < 0 ? 110 : -110) * ext, 0]);
        p.ik.handL = { pos: this.S([0.22, 0.1, 0.34]), pole: [0.6, -1, 0], w: ext };
        break;
      }
      case 'stomp': {
        setLimb(this.strikePath(startFoot, [startFoot[0], 0.8 * s, 0.28 * s], [T[0], this.ankle, T[2] - 0.05], fr, m, 0.75), [0, 0.6, 1]);
        const u = fr / m.startup;
        addRot(p, 'spine', [fr < m.startup ? -10 * ease(u / 0.75) : 12 * ext, 0, 0]);
        if (fr >= m.startup) p.hips[1] -= 0.08 * s * ext;
        break;
      }
      case 'hammer': {
        const u = fr / m.startup;
        const ch: V3 = [0, 2.15 * s, -0.05 * s];
        const L = this.strikePath(this.handF, [ch[0] + 0.06 * s, ch[1], ch[2]], [T[0] + 0.07 * s, T[1], T[2] - 0.05], fr, m, 0.75);
        const R = this.strikePath(this.handB(f), [ch[0] - 0.06 * s, ch[1], ch[2]], [T[0] - 0.07 * s, T[1], T[2] - 0.05], fr, m, 0.75);
        p.ik.handL = { pos: L, pole: [0.6, -0.4, -0.6] };
        p.ik.handR = { pos: R, pole: [-0.6, -0.4, -0.6] };
        const back = fr < m.startup ? ease(Math.min(1, u / 0.75)) : 0;
        addRot(p, 'spine', [-18 * back + (fr >= m.startup ? 26 * ext : 0), 0, 0]);
        p.hips[1] += (0.03 * back - (fr >= m.startup ? 0.12 * ext : 0)) * s;
        if (f.isArmored()) p.hips[0] += Math.sin(fr * 2.7) * 0.012 * s;
        break;
      }
      case 'cast': {
        if (this.id === 'heishi') {
          const L = this.strikePath(this.handF, [-0.12 * s, 1.0 * s, -0.08 * s], [0.07 * s, 1.18 * s, 0.62 * s], fr, m);
          const R = this.strikePath(this.handB(f), [-0.22 * s, 0.98 * s, -0.12 * s], [-0.07 * s, 1.14 * s, 0.6 * s], fr, m);
          p.ik.handL = { pos: L, pole: [0.6, -1, -0.3] };
          p.ik.handR = { pos: R, pole: [-0.6, -1, -0.3] };
          const u = fr / m.startup;
          twist(fr < m.startup ? 30 * Math.sin(u * Math.PI) - 10 * u : -10 * ext, 1);
        } else if (this.id === 'golem') {
          setLimb(this.strikePath(startHand, [-0.34 * s, 1.36 * s, -0.3 * s], [0, 1.28 * s, 0.72 * s], fr, m, 0.7), [-0.6, -1, -0.2]);
          twist(40);
          p.hips[2] += 0.1 * s * ext;
        } else {
          setLimb(this.strikePath(startHand, [-0.22 * s, 1.75 * s, -0.22 * s], [0.02 * s, 1.36 * s, 0.6 * s], fr, m), [-0.6, -0.8, -0.3]);
          twist(30);
        }
        break;
      }
      case 'toss': {
        setLimb(this.strikePath(startHand, [-0.2 * s, 0.8 * s, -0.26 * s], [0, 1.26 * s, 0.5 * s], fr, m), [-0.6, -1, 0]);
        twist(25);
        break;
      }
      case 'grab': {
        p.ik.handL = { pos: lerpV(this.handF, this.S([0.13, 1.36, 0.56]), ext), pole: [0.8, -0.6, -0.2] };
        p.ik.handR = { pos: lerpV(this.handB(f), this.S([-0.13, 1.34, 0.56]), ext), pole: [-0.8, -0.6, -0.2] };
        addRot(p, 'spine', [10 * ext, 0, 0]);
        p.hips[2] += 0.08 * s * ext;
        break;
      }
      case 'baton': {
        setLimb(this.strikePath(startHand, [-0.3 * s, 1.8 * s, -0.12 * s], [-0.05 * s, T[1] - 0.15, T[2] - 0.45], fr, m), [-0.5, -0.6, -0.6]);
        twist(30);
        break;
      }
      case 'batonThrust': {
        setLimb(this.strikePath(startHand, [-0.2 * s, 1.15 * s, -0.15 * s], [0, T[1] + 0.02, T[2] - 0.5], fr, m), [-0.6, -1, -0.2]);
        twist(22);
        addRot(p, 'spine', [10 * ext, 0, 0]);
        p.hips[2] += 0.1 * s * ext;
        break;
      }
      case 'batonSweep': {
        setLimb(this.strikePath(startHand, [-0.38 * s, 0.75 * s, -0.05 * s], [0.1 * s, Math.max(0.3 * s, T[1] + 0.1), T[2] - 0.45], fr, m), [-0.6, -0.8, -0.3]);
        twist(35);
        break;
      }
      case 'batonUpper': {
        const dip = fr < m.startup ? Math.sin((fr / m.startup) * Math.PI) : 0;
        setLimb(this.strikePath(startHand, [-0.18 * s, 0.62 * s, 0.1 * s], [0, T[1] + 0.25, T[2] - 0.35], fr, m, 0.55), [-0.9, -0.6, -0.4]);
        p.hips[1] -= 0.12 * dip * s;
        twist(18);
        break;
      }
      case 'draw':
      case 'sheathe': {
        const t = fr / m.total;
        const holster = this.S([0.2, 0.92, 0.06]);
        const raised = this.S([-0.12, 1.55, 0.28]);
        let pos: V3;
        if (t < 0.45) pos = lerpV(this.handB(f), holster, ease(t / 0.45));
        else if (t < 0.75) pos = lerpV(holster, raised, ease((t - 0.45) / 0.3));
        else pos = lerpV(raised, this.handB(f), ease((t - 0.75) / 0.25));
        p.ik.handR = { pos, pole: [-0.7, -1, -0.2] };
        twist(-18 * Math.sin(clamp(t / 0.6, 0, 1) * Math.PI), 1);
        break;
      }
      case 'tackle': {
        addRot(p, 'spine', [22 * ext, 0, 0]);
        addRot(p, 'chest', [10 * ext, 0, 0]);
        twist(-35);
        p.ik.handL = { pos: this.S([0.06, 1.24, 0.16]), pole: [1, -0.5, 0] };
        p.ik.handR = { pos: this.S([-0.12, 1.2, 0.04]), pole: [-1, -0.5, 0] };
        p.hips[2] += 0.12 * s * ext;
        break;
      }
      case 'flykick': {
        const hop = Math.sin(clamp(fr / (m.activeEnd + 4), 0, 1) * Math.PI);
        p.hips[1] += 0.35 * s * hop;
        if (hop > 0.05) {
          const other: Limb = side > 0 ? 'footR' : 'footL';
          delete p.ik[other];
          p.rot[side > 0 ? 'thighR' : 'thighL'] = [-70, 0, 0];
          p.rot[side > 0 ? 'kneeR' : 'kneeL'] = [110, 0, 0];
        }
        setLimb(this.strikePath(startFoot, [startFoot[0], 0.7 * s, 0.25 * s], [T[0], T[1], T[2] - 0.05], fr, m, 0.5), [0, 0.6, 1]);
        addRot(p, 'spine', [-14 * ext, 0, 0]);
        break;
      }
      case 'jumpkick': {
        const air = this.airPose(f);
        air.ik[limb] = { pos: this.strikePath([side * 0.1 * s, 0.4 * s, 0.1 * s], [side * 0.1 * s, 0.45 * s, 0.3 * s], [T[0], T[1], T[2] - 0.05], fr, m, 0.3), pole: [0, 0.4, 1] };
        addRot(air, 'spine', [-12 * ext, 0, 0]);
        return air;
      }
      case 'wakelow': {
        const lp = this.lying(f);
        lp.ik[limb] = { pos: this.strikePath([side * 0.1 * s, 0.15 * s, 0.85 * s], [side * 0.1 * s, 0.35 * s, 0.6 * s], [T[0], 0.18 * s, T[2]], fr, m), pole: [0, 1, 0.3], w: ext };
        return lp;
      }
      case 'wakekick': {
        const u = fr / m.startup;
        if (fr < m.startup && u < 0.55) {
          const k = ease(u / 0.55);
          const lp = this.lying(f);
          const hipH = this.model.hipsHeight;
          lp.hips[1] = lerp(-(hipH - 0.15 * s), -0.45 * s, k);
          lp.rot.hips = [lerp(-90, -20, k), 0, 0];
          lp.rot.thighL = [lerp(-8, -95, k), 0, 10];
          lp.rot.kneeL = [lerp(14, 120, k), 0, 0];
          lp.rot.thighR = [lerp(-16, -90, k), 0, -10];
          lp.rot.kneeR = [lerp(24, 120, k), 0, 0];
          return lp;
        }
        setLimb(this.strikePath(startFoot, [startFoot[0], 0.55 * s, 0.2 * s], [T[0], T[1], T[2] - 0.06], fr, m, 0.75), [0, 0.5, 1]);
        addRot(p, 'spine', [-10 * ext, 0, 0]);
        break;
      }
      default: {
        if (isHand) setLimb(this.strikePath(startHand, startHand, T, fr, m), [side * 0.6, -1, -0.2]);
        else setLimb(this.strikePath(startFoot, [startFoot[0], 0.5 * s, 0.2 * s], T, fr, m), [0, 0.5, 1]);
      }
    }
    return p;
  }
}
