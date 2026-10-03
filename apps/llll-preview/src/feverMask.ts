import { feverEntrance } from './feverAnimation';

/**
 * 边线帧，**原始 Unity 四元数**（level56 `LineMask_L/R` 的 m_LocalRotation 原值）。
 * +Y 的投影恰好落在 OutLine-L/R 上：实测长轴与画布边线同为 39.890°，条带两端垂距 ≤1px。
 * 该帧与「相机俯角 33.2° × 边线画布角 ∓39.89°」等价，故遮罩网格与 LineBase/LineMove
 * 条带共用同一帧，保证揭示与条带同轴。渲染层统一做 Z 镜像（-z 位置、(-x,-y,z,w) 旋转）。
 */
export const FEVER_EDGE_ROTATION = {
  left: [0.2685529291629791, 0.09745344519615173, -0.32690104842185974, 0.9008429050445557],
  right: [0.2685529291629791, -0.09745341539382935, 0.32690098881721497, 0.9008429050445557],
} as const;

/**
 * LineMask_L/R 的 RectTransform：anchor (0.5,1)、anchoredPosition (∓18,−9)、pivot (0.5,0)。
 * 原始 `LineParticle` 链（WorldRoot > Fever > FeverEffectSet_001 > LineParticle）逐级均为
 * 单位变换，故 anchoredPosition 即世界位置；文档中 (-3.98, 4.88, -5.99) 属于同级的
 * `sc2_ingeame_feverEffect_L/R_001`（屏幕两侧大特效），不是边线层的父级。
 * 该锚点与入场动画的彗星起点（`LineCoreMove` 的 t=0 位置 ∓18.46,−9.4）重合，
 * 揭示因此从近端（判定线一侧）沿线向远端展开。
 */
export const FEVER_MASK_ANCHOR: Record<'left' | 'right', readonly [number, number, number]> = {
  left: [-18, -9, 0], right: [18, -9, 0],
};

/** resources #1958 Sprite 网格半高（单位）。 */
export const FEVER_MASK_HALF_HEIGHT = 0.395;

/** v' = v + 2q.w·(q×v) + 2·q×(q×v)；避免为一处偏移引入 three 依赖。 */
export function rotateByQuaternion(q: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Unity → Three 的 Z 镜像：位置取 -z，旋转取 (-x,-y,z,w)。渲染层与测试共用此换算。 */
export function mirrorRotationToThree(q: readonly number[]): [number, number, number, number] {
  return [-q[0], -q[1], q[2], q[3]];
}

/**
 * resources #1958 的 Sprite 顶点与索引；网格居中，原始底部 pivot 由 `position` 还原。
 * 输出均为 Unity 世界坐标。
 */
export function feverMaskGeometry(side: 'left' | 'right', age: number) {
  const animation = feverEntrance(age);
  const rotation = FEVER_EDGE_ROTATION[side];
  const scale = side === 'left' ? animation.leftMask : animation.rightMask;
  const anchor = FEVER_MASK_ANCHOR[side];
  // 底部 pivot ⇒ 网格中心沿帧 +Y 抬升半个缩放后高度。
  const up = rotateByQuaternion(rotation, [0, 1, 0]);
  const grow = FEVER_MASK_HALF_HEIGHT * scale[1];
  return {
    positions: [
      0.5299999713897705, 0.26499998569488525, 0,
      0.47999998927116394, -0.39500001072883606, 0,
      0.5299999713897705, -0.20499999821186066, 0,
      0.38999998569488525, 0.39500001072883606, 0,
      -0.3700000047683716, 0.39500001072883606, 0,
      -0.38999998569488525, -0.39500001072883606, 0,
      -0.5299999713897705, 0.2549999952316284, 0,
      -0.5299999713897705, -0.23499999940395355, 0,
    ],
    indices: [7, 6, 5, 4, 5, 6, 1, 5, 4, 3, 1, 4, 0, 1, 3, 2, 1, 0],
    position: [
      anchor[0] + up[0] * grow,
      anchor[1] + up[1] * grow,
      anchor[2] + up[2] * grow,
    ],
    rotation: [rotation[0], rotation[1], rotation[2], rotation[3]],
    scale,
  };
}
