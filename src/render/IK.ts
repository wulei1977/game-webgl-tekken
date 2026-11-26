// 两骨骼解析 IK（手臂 / 腿）：让出拳、出腿的末端精确到达逻辑攻击盒位置，动作与帧数据对齐
import * as THREE from 'three';

const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _T = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

export interface Chain {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  lenA: number;
  lenB: number;
}

/** 让骨骼的 -Y 轴指向 dirWorld（以当前朝向做最小旋转，保留扭转） */
export function aimBone(bone: THREE.Object3D, dirWorld: THREE.Vector3, weight: number): void {
  bone.getWorldQuaternion(_q);
  _axis.copy(DOWN).applyQuaternion(_q);
  _qd.setFromUnitVectors(_axis, dirWorld);
  _q.premultiply(_qd);
  bone.parent!.getWorldQuaternion(_qp).invert();
  _q.premultiply(_qp);
  bone.quaternion.slerp(_q, weight);
  bone.updateMatrixWorld(true);
}

export function setWorldQuaternion(bone: THREE.Object3D, worldQ: THREE.Quaternion, weight = 1): void {
  bone.parent!.getWorldQuaternion(_qp).invert();
  _q.copy(_qp).multiply(worldQ);
  bone.quaternion.slerp(_q, weight);
  bone.updateMatrixWorld(true);
}

export function solveTwoBone(c: Chain, target: THREE.Vector3, pole: THREE.Vector3, weight: number): void {
  if (weight <= 0.001) return;
  c.upper.getWorldPosition(_S);
  _u.subVectors(target, _S);
  const len = _u.length();
  if (len < 1e-5) return;
  _u.divideScalar(len);
  const a = c.lenA;
  const b = c.lenB;
  const d = Math.min(Math.max(len, Math.abs(a - b) + 1e-3), (a + b) * 0.999);
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u));
  if (_w.lengthSq() < 1e-8) _w.set(0, 0, 1).addScaledVector(_u, -_u.z);
  _w.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_w, a * sinA);
  _d.subVectors(_E, _S).normalize();
  aimBone(c.upper, _d, weight);
  c.lower.getWorldPosition(_E);
  _T.copy(_S).addScaledVector(_u, d);
  _d.subVectors(_T, _E);
  if (_d.lengthSq() < 1e-8) return;
  _d.normalize();
  aimBone(c.lower, _d, weight);
}
