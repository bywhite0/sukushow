import { feverLineRgba, feverMoveRgba } from './fever';

/** 边线全长（世界单位，彗星路径 `LineCoreMove` 的起止距离），供其他层参考。 */
export const FEVER_EDGE_LENGTH = Math.hypot(16.5, 16.3, 25.799999237060547);

/**
 * level56 #542/#614（LineBase）与 #604/#570（LineMove）。
 * 输出 Unity 世界坐标；渲染层按 Three 约定取 -z。
 *
 * 两层都用**原包位置运动**，不沿边线推进：
 * - `LineBase` 发射点固定在边线上 `(∓5.03, 3.925, 0)`，`startSpeed=0` ⇒ 粒子不动；
 *   尺寸恒为 `startSize=(0.13, 80, 0.1)`，随时间变的只有**颜色**（6 色渐变轮转，周期 1.6s）。
 * - `LineMove` 发射点在 `(0.024, 9.021, 0)`（轨道顶部中央，屏幕 y≈−47，在可见区之上）；
 *   `ShapeModule.type=4`（Cone）`angle=0` ⇒ 沿锥轴局部 +Z 射出 × `startSpeed=1.3`，
 *   叠加世界空间 `VelocityModule.x=∓0.35` ⇒ 合速度 `(∓0.35, 0, 1.3)`；
 *   尺寸恒为 `startSize=(0.11, 120, 0.1)`（半长 60，远超可见范围 ⇒ 两端扫出画面外）。
 *
 * **尺寸不随时间变化**：`SizeModule.curve`（`separateAxes=false` 下唯一生效的字段）两层都是
 * `[(0,1),(1,1)]` ⇒ 恒定 1。`SizeModule.y`（`[(0,0),(1,1)]`）与 `.z` 是**未被求值的样板**：
 * level56 全部 111 个 ParticleSystem 的 `separateAxes` 均为 `False`，无一处为真。
 * 若把 `y` 当作统一尺寸乘数，会让两层都从尺寸 0 长出，并误推出「边线随时间伸缩」的结论。
 *
 * 长轴朝向不在这里给出：两层都是相机朝向的 billboard，其屏幕朝向由同侧 `LineMask`
 * 的旋转定义（见 `feverMask`），渲染层统一使用该帧。
 */
export function feverLineParticle(kind: 'base' | 'move', side: 'left' | 'right', elapsed: number) {
  const moving = kind === 'move';
  const period = moving ? 0.800000011920929 : 1.600000023841858;
  const age = Math.max(0, elapsed) % period;
  const phase = age / period;
  const sign = side === 'left' ? -1 : 1;
  if (!moving) {
    return {
      position: [sign * 5.03000020980835, 3.924999952316284, 0],
      size: [0.12999999523162842, 80],
      color: feverLineRgba(phase * 1.6, 0),
      count: 2,
    };
  }
  // 原始 burst 的 repeatInterval = 寿命 = 0.8s，且 looping=true
  // ⇒ 每个寿命周期从发射点重新出发。
  return {
    position: [
      0.024000000208616257 + sign * 0.3499999940395355 * age,
      9.020999908447266,
      1.2999999523162842 * age,
    ],
    size: [0.10999999940395355, 120],
    color: feverMoveRgba(phase * 0.8, 0),
    count: 1,
  };
}
