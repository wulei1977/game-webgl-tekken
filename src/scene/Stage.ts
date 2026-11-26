// 格斗擂台场景：水泥擂台 + 红白边界线 + 低矮铁丝网围栏 + 观众席 + 场馆立柱 + 横幅 + 聚光灯 + 远景天幕
// 低模 + 小尺寸平铺贴图 + 固定顶点光照（无实时阴影），保持 PS1 风格与 60FPS
import * as THREE from 'three';
import { ps1Material } from '../render/PS1Material';
import {
  bannerTexture,
  beamTexture,
  concreteTexture,
  crowdTexture,
  emblemTexture,
  fenceTexture,
  metalTexture,
  pillarTexture,
  registerTexture,
  ringFloorTexture,
  skylineTexture,
  stripeTexture,
} from '../render/TextureFactory';

export interface Stage {
  group: THREE.Group;
  update(time: number, camera: THREE.Camera, focus: THREE.Vector3): void;
}

const RING_R = 6.2;
const FENCE_R = 6.55;

export function buildStage(scene: THREE.Scene): Stage {
  const group = new THREE.Group();
  group.name = 'stage';
  scene.add(group);
  scene.background = new THREE.Color(0x07080f);

  // 远景天幕（夜空 + 山 + 城市剪影）
  const sky = skylineTexture();
  sky.wrapS = THREE.RepeatWrapping;
  sky.repeat.set(3, 1);
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(70, 70, 46, 18, 1, true),
    ps1Material({ map: sky, unlit: true, fog: false, side: THREE.BackSide }),
  );
  dome.position.y = 17;
  group.add(dome);

  // 外场地面
  const concrete = concreteTexture();
  concrete.repeat.set(30, 30);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 8, 8), ps1Material({ map: concrete }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.35;
  group.add(ground);

  // 擂台：16 边形水泥台
  const floor = ringFloorTexture();
  floor.repeat.set(3, 3);
  const metal = metalTexture();
  const stripes = stripeTexture();
  stripes.repeat.set(24, 1);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(RING_R, RING_R + 0.25, 0.35, 16, 1), [
    ps1Material({ map: stripes }),
    ps1Material({ map: floor }),
    ps1Material({ map: metal }),
  ]);
  ring.position.y = -0.175;
  group.add(ring);

  // 红色边界线 + 中心徽标
  const line = new THREE.Mesh(new THREE.RingGeometry(5.55, 5.75, 32), ps1Material({ color: 0xc0262e }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.006;
  group.add(line);
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 2.8),
    ps1Material({ map: emblemTexture(), transparent: true, alphaTest: 0.05, depthWrite: false }),
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = 0.008;
  group.add(emblem);

  // 围栏：立柱 + 横梁 + 铁丝网
  const fence = fenceTexture();
  fence.repeat.set(3, 1.4);
  const fenceMat = ps1Material({ map: fence, alphaTest: 0.5, side: THREE.DoubleSide });
  const postMat = ps1Material({ map: metal });
  const posts = 16;
  const panels: THREE.Object3D[] = [];
  for (let i = 0; i < posts; i++) {
    const a0 = (i / posts) * Math.PI * 2;
    const a1 = ((i + 1) / posts) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.sin(a0) * FENCE_R, 0, Math.cos(a0) * FENCE_R);
    const p1 = new THREE.Vector3(Math.sin(a1) * FENCE_R, 0, Math.cos(a1) * FENCE_R);
    const seg = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.35, 0.14), postMat);
    post.position.set(p0.x, 0.675, p0.z);
    seg.add(post);
    const mid = p0.clone().lerp(p1, 0.5);
    const len = p0.distanceTo(p1);
    const ang = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.15), fenceMat);
    panel.position.set(mid.x, 0.62, mid.z);
    panel.rotation.y = ang + Math.PI / 2;
    seg.add(panel);
    for (const h of [0.08, 1.24]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), postMat);
      rail.position.set(mid.x, h, mid.z);
      rail.rotation.y = ang + Math.PI / 2;
      seg.add(rail);
    }
    seg.userData.center = new THREE.Vector3(mid.x, 0.6, mid.z);
    group.add(seg);
    panels.push(seg);
  }

  // 观众席：三层看台环绕
  const crowdA = crowdTexture(21);
  const crowdB = crowdTexture(77);
  const standMat = ps1Material({ map: metal, color: 0x8890a0 });
  const sections = 14;
  const crowdTex: THREE.Texture[] = [crowdA, crowdB];
  for (let i = 0; i < sections; i++) {
    const a = (i / sections) * Math.PI * 2;
    for (let tier = 0; tier < 3; tier++) {
      const r = 10 + tier * 1.8;
      const w = (2 * Math.PI * r) / sections + 0.05;
      const h = 1.8;
      const y = tier * 1.3 + 0.4;
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, 1.6), standMat);
      step.position.set(Math.sin(a) * (r + 0.3), y - 0.2, Math.cos(a) * (r + 0.3));
      step.rotation.y = a;
      group.add(step);
      const t = registerTexture(crowdTex[(i + tier) % 2].clone());
      t.needsUpdate = true;
      t.repeat.set(1, 0.5);
      t.offset.set((i * 0.37) % 1, tier === 0 ? 0.5 : 0);
      const crowd = new THREE.Mesh(new THREE.PlaneGeometry(w, h), ps1Material({ map: t, color: tier === 0 ? 0xffffff : 0xb0b0c0 }));
      crowd.position.set(Math.sin(a) * r, y + h / 2, Math.cos(a) * r);
      crowd.rotation.y = a + Math.PI;
      crowd.userData.bob = i * 1.3 + tier;
      crowd.userData.baseY = crowd.position.y;
      group.add(crowd);
      panels.push(crowd);
      crowd.userData.crowd = true;
    }
  }

  // 场馆立柱 + 横幅
  const pillarMat = ps1Material({ map: pillarTexture() });
  const banners = [
    bannerTexture('WEB TEKKEN', 0x8a1a1e, ['#ffe08a', '#e08a1c']),
    bannerTexture('IRON ARENA', 0x1a2a5a, ['#e0f0ff', '#7ab0ff']),
  ];
  const pillars = 8;
  for (let i = 0; i < pillars; i++) {
    const a = (i / pillars) * Math.PI * 2 + 0.2;
    const r = 16;
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), pillarMat);
    p.position.set(Math.sin(a) * r, 5.6, Math.cos(a) * r);
    p.rotation.y = a;
    group.add(p);
    const an = a + Math.PI / pillars;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), ps1Material({ map: banners[i % 2], fog: true }));
    b.position.set(Math.sin(an) * (r - 0.3), 7.5, Math.cos(an) * (r - 0.3));
    b.rotation.y = an + Math.PI;
    group.add(b);
  }

  // 顶棚灯架 + 聚光灯光柱
  const truss = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.12, 4, 16), postMat);
  truss.rotation.x = Math.PI / 2;
  truss.position.y = 12;
  group.add(truss);
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.5 });
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 12, 8, 1, true), beamMat);
    beam.geometry.translate(0, -6, 0);
    beam.position.set(Math.sin(a) * 7.5, 12, Math.cos(a) * 7.5);
    beam.userData.a = a;
    group.add(beam);
    beams.push(beam);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), ps1Material({ color: 0xfff2c0, unlit: true }));
    lamp.position.copy(beam.position);
    group.add(lamp);
  }

  const tmp = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  return {
    group,
    update(time: number, camera: THREE.Camera, focus: THREE.Vector3) {
      // 聚光灯缓慢摆动
      for (const b of beams) {
        const a = b.userData.a as number;
        b.rotation.set(Math.sin(time * 0.4 + a) * 0.25 + 0.45 * Math.cos(a), 0, Math.cos(time * 0.33 + a) * 0.25 - 0.45 * Math.sin(a));
      }
      // 遮挡镜头的近侧围栏 / 观众面片隐藏
      camera.getWorldDirection(camDir);
      const camDist = camera.position.distanceTo(focus);
      for (const p of panels) {
        if (p.userData.crowd) {
          const t = Math.floor(time * 4 + (p.userData.bob as number)) % 2;
          p.position.y = (p.userData.baseY as number) + t * 0.04;
          continue;
        }
        tmp.copy(p.userData.center as THREE.Vector3).sub(camera.position);
        p.visible = !(tmp.length() < camDist && tmp.dot(camDir) > 0);
      }
    },
  };
}
