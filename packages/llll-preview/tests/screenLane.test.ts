import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { arcFrame, arcPoint } from '../src/arcView';
import { flatFrame } from '../src/flatView';
import { BORDER, Y, lanePitch, worldX } from '../src/geometry';
import { LANE_CENTER, laneFromArcAngle, laneFromFlatX, laneFromProjectedX } from '../src/screenLane';
import { PITCH, pushSlicedNote, worldDepth, worldWidthOf } from '../src/slice';

const W = 1920, H = 1080;

describe('screenLane：屏幕 x → lane（受控数值）', () => {
  // 1920×1080、3D 判定线处的实测每 lane 像素宽（judge.ts 注释：24.08）。
  const PX = 24.08;
  const screenX = (lane: number) => W / 2 + (lane - LANE_CENTER) * PX;

  it('1920 宽：lane 0 / 29.5 / 59 的屏幕 x 与反算往返一致', () => {
    expect(screenX(0)).toBeCloseTo(249.64, 9);
    expect(screenX(29.5)).toBeCloseTo(960, 9);
    expect(screenX(59)).toBeCloseTo(1670.36, 9);
    for (const lane of [0, 29.5, 59]) {
      expect(laneFromProjectedX(screenX(lane), W, screenX(29.5), screenX(30.5))).toBeCloseTo(lane, 9);
      expect(laneFromFlatX(screenX(lane), W, PX)).toBeCloseTo(lane, 9);
    }
  });

  it('不 clamp：轨道外按同一比例外推', () => {
    expect(laneFromFlatX(screenX(59.5), W, PX)).toBeCloseTo(59.5, 9);
    expect(laneFromProjectedX(screenX(-1.5), W, screenX(29.5), screenX(30.5))).toBeCloseTo(-1.5, 9);
    expect(laneFromFlatX(screenX(29.5) - 40 * PX, W, PX)).toBeCloseTo(-10.5, 9);
  });

  it('每 lane 宽度退化时返回 NaN，不产生 Infinity', () => {
    expect(laneFromFlatX(0, W, 0)).toBeNaN();
    expect(laneFromProjectedX(0, W, 100, 100)).toBeNaN();
  });

  it('SIF：角度折成 lane，超出 ±π/2 夹住', () => {
    expect(laneFromArcAngle(0)).toBe(29.5);
    // ±90° 是轨道边缘（arcView 的 arcAngle 把世界 x 夹到 ±LANE_HALF_WIDTH），
    // 比 lane 0 / 59 的中心各多半个 lane。
    expect(laneFromArcAngle(Math.PI / 2)).toBeCloseTo(59.5, 9);
    expect(laneFromArcAngle(-Math.PI / 2)).toBeCloseTo(-0.5, 9);
    expect(laneFromArcAngle(Math.PI / 4)).toBeCloseTo(44.5, 9);
    expect(laneFromArcAngle(-Math.PI / 4)).toBeCloseTo(14.5, 9);
    expect(laneFromArcAngle(Math.PI)).toBeCloseTo(59.5, 9);
    expect(laneFromArcAngle(-Math.PI)).toBeCloseTo(-0.5, 9);
    // lane 0 / 29.5 / 59 的解析角度往返
    for (const lane of [0, 29.5, 59]) {
      const angle = ((lane - LANE_CENTER) / 30) * (Math.PI / 2);
      expect(laneFromArcAngle(angle)).toBeCloseTo(lane, 9);
    }
  });
});

/**
 * 与渲染器绘制同口径：用 renderer.applyCameraFrame 的同一组机位投影，确认
 * screenToLane 反算用的「每 lane 像素宽 / 判定弧圆心」就是音符实际绘制的位置。
 */
describe('screenLane 与渲染器绘制同口径', () => {
  const project = (camera: THREE.Camera, p: THREE.Vector3) => {
    const q = p.clone().project(camera);
    return { x: ((q.x + 1) / 2) * W, y: ((1 - q.y) / 2) * H };
  };

  const camera3d = () => {
    const camera = new THREE.PerspectiveCamera(60, W / H, .3, 1000);
    camera.position.set(0, 9, 8.65);
    camera.rotation.set(-PITCH, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  };
  const cameraTopDown = (y: number, z: number) => {
    const camera = new THREE.PerspectiveCamera(60, W / H, .3, 1000);
    camera.position.set(0, y, z);
    camera.rotation.set(-Math.PI / 2, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  };

  it('3D：判定线处每 lane ≈24.08 px，音符判定点绘制在 Three z = −BORDER', () => {
    const camera = camera3d();
    const judgeX = (lane: number) => project(camera, new THREE.Vector3(worldX(lane), Y, -BORDER)).x;
    const px = judgeX(30.5) - judgeX(29.5);
    expect(px).toBeCloseTo(24.08, 1);
    // pushSlicedNote 对 unityZ 取负（billboardCorners: z = −unityZ）⇒ 判定点 unityZ = BORDER
    // 画在 Three z = −BORDER；这里用同一函数确认符号，screenToLane 必须与绘制同号。
    const pos = new Float32Array(18), uv = new Float32Array(12), col = new Float32Array(24);
    const n = pushSlicedNote(pos, uv, col, 0, 18, 0, Y, BORDER, worldWidthOf(1), worldDepth(0), undefined);
    // 无 SpriteMeta 时两端端帽宽度为 0，只出中段补丁（6 顶点）；竖轴对称 ⇒ 顶点 z 平均 = −BORDER。
    expect(n).toBe(6);
    let z = 0;
    for (let i = 0; i < n; i++) z += pos[i * 3 + 2];
    expect(z / n).toBeCloseTo(-BORDER, 5);
    // 往返：lane 0 / 29.5 / 59 反算误差为 0
    for (const lane of [0, 29.5, 59]) {
      expect(laneFromProjectedX(judgeX(lane), W, judgeX(29.5), judgeX(30.5))).toBeCloseTo(lane, 9);
    }
  });

  it('2D：pxPerLane = frame.scale × lanePitch，与投影实测一致', () => {
    const frame = flatFrame(W, H, 60);
    const camera = cameraTopDown(frame.camY, frame.camZ);
    const judgeX = (lane: number) => project(camera, new THREE.Vector3(worldX(lane), Y, -BORDER)).x;
    const px = frame.scale * lanePitch(100);
    expect(px).toBeCloseTo(19.2, 9);
    expect(judgeX(30.5) - judgeX(29.5)).toBeCloseTo(px, 9);
    expect(judgeX(29.5)).toBeCloseTo(W / 2, 9);
    for (const lane of [0, 29.5, 59]) {
      expect(laneFromFlatX(judgeX(lane), W, px)).toBeCloseTo(lane, 9);
    }
  });

  it('SIF：圆心 = 判定弧的圆心 (0, Y, −centerZ)，各 lane 都在同一半径上', () => {
    const arc = arcFrame(W, H, 60);
    const camera = cameraTopDown(arc.camY, arc.camZ);
    // 与 renderer.applyCameraFrame 的 arcCenter.position / arcPoint 同一口径（Unity z 取负）。
    const center = project(camera, new THREE.Vector3(0, Y, -arc.centerZ));
    expect(center.x).toBeCloseTo(W / 2, 6);
    expect(center.y).toBeCloseTo(arc.centerScreenY, 6);
    for (const lane of [0, 29.5, 59]) {
      const p = arcPoint(arc, worldX(lane), BORDER, 0);
      const screen = project(camera, new THREE.Vector3(p.x, Y, -p.z));
      // 判定弧上所有 lane 与圆心的屏幕距离都等于 radiusPx（圆心选择与绘制一致）
      expect(Math.hypot(screen.x - center.x, screen.y - center.y)).toBeCloseTo(arc.radiusPx, 2);
      const angle = Math.atan2(screen.x - center.x, screen.y - center.y);
      expect(laneFromArcAngle(angle)).toBeCloseTo(lane, 9);
    }
  });
});
