import { feverLineRgba, feverMoveRgba } from './fever';

/** level56 #542/#614/#604/#570；输出 Unity 世界坐标，渲染层统一转换 Z。 */
export function feverLineParticle(kind: 'base' | 'move', side: 'left' | 'right', elapsed: number) {
  const moving = kind === 'move';
  const period = moving ? 0.800000011920929 : 1.600000023841858;
  const age = Math.max(0, elapsed) % period;
  const sign = side === 'left' ? -1 : 1;
  return {
    position: moving
      ? [0.024000000208616257 + sign * 0.3499999940395355 * age, 9.020999908447266, 1.2999999523162842 * age]
      : [sign * 5.03000020980835, 3.924999952316284, 0],
    size: moving ? [0.10999999940395355, 120] : [0.12999999523162842, 80],
    rotation: [moving ? -0.546288013458252 : -0.5569345355033875, 0,
      -sign * (0.7033676505088806 + (moving ? 0.031415924429893494 * age : 0))],
    color: moving ? feverMoveRgba(age / period * 0.8, 0) : feverLineRgba(age / period * 1.6, 0),
    count: moving ? 1 : 2,
  };
}
