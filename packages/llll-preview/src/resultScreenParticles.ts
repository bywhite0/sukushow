/** 结算粒子：原始模块参数的解析求值；随机序列与正交投影属于预览口径。 */
import { dampedDistance, evalGradient, evalGradientPair, evalHermite } from './comboResult';
import { fnv1a, lcg } from './rng';
import { sampleCurve } from './startAnim';
import type { ResultClip, ResultEmitter, ResultNode } from './resultScreenTypes';

type Vec3 = readonly [number, number, number];
const range = (v: readonly [number, number], u: number) => v[0] + (v[1] - v[0]) * u;

/** 从宿主到发射器的 active 曲线精确求首个激活时刻，与 tick 步长无关。 */
export function resultActivationTime(clip: ResultClip, host: string, path: string, nodes: readonly ResultNode[]): number {
  const chain = nodes.filter((n) => n.path.startsWith(`${host}/`) && (n.path === path || path.startsWith(`${n.path}/`)));
  const curves = chain.map((n) => clip.curves.find((c) => c.prop === 'active' && `${host}/${c.path}` === n.path));
  const times = [...new Set([0, ...curves.flatMap((c) => c?.keys.map((k) => k[0]) ?? [])])].sort((a, b) => a - b);
  return times.find((t) => chain.every((n, i) => curves[i] ? sampleCurve(curves[i]!.keys, t) > 0.5 : n.active)) ?? Infinity;
}

export type ResultParticle = {
  spawn: number;
  life: number;
  speed: number;
  position: Vec3;
  direction: Vec3;
  size: number;
  sizeY: number;
  rotation: number;
  rotationSpeed: number;
  gradientMix: number;
};

/** Unity Euler：按 Z、X、Y 依次旋转（角度）。 */
function rotate(v: Vec3, angles: Vec3): Vec3 {
  const [rx, ry, rz] = angles.map((a) => a * Math.PI / 180);
  const x = v[0] * Math.cos(rz!) - v[1] * Math.sin(rz!);
  const y = v[0] * Math.sin(rz!) + v[1] * Math.cos(rz!);
  const y1 = y * Math.cos(rx!) - v[2] * Math.sin(rx!);
  const z1 = y * Math.sin(rx!) + v[2] * Math.cos(rx!);
  return [x * Math.cos(ry!) + z1 * Math.sin(ry!), y1, -x * Math.sin(ry!) + z1 * Math.cos(ry!)];
}

function shapePoint(e: ResultEmitter, rnd: () => number): { position: Vec3; direction: Vec3 } {
  const shape = e.shape;
  const angle = rnd() * 2 * Math.PI;
  const inner = 1 - shape.thickness;
  let direction: Vec3;
  let point: Vec3;
  if (shape.type === 10) {
    point = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    direction = [0, 0, 1];
  } else if (shape.type === 0) {
    const z = rnd() * 2 - 1;
    const rxy = Math.sqrt(1 - z * z);
    direction = [Math.cos(angle) * rxy, Math.sin(angle) * rxy, z];
    const r = e.shapeR * Math.cbrt(inner ** 3 + rnd() * (1 - inner ** 3));
    point = [direction[0] * r, direction[1] * r, direction[2] * r];
  } else {
    const r = e.shapeR * Math.sqrt(inner * inner + rnd() * (1 - inner * inner));
    point = [Math.cos(angle) * r, Math.sin(angle) * r, 0];
    const cone = shape.angle * Math.PI / 180;
    direction = shape.type === 2
      ? [Math.cos(angle) * Math.sin(cone), Math.sin(angle) * Math.sin(cone), Math.cos(cone)]
      : [Math.cos(angle), Math.sin(angle), 0];
  }
  const scaled: Vec3 = [point[0] * shape.scale[0], point[1] * shape.scale[1], point[2] * shape.scale[2]];
  const pos = rotate(scaled, shape.rotation);
  return {
    position: [pos[0] + shape.position[0], pos[1] + shape.position[1], pos[2] + shape.position[2]],
    direction: rotate(direction, shape.rotation),
  };
}

/** 一次 Play：系统延迟只抽样一次；每轮 burst 的出生时刻保留原始间隔。 */
export function spawnResultEmitter(e: ResultEmitter, start: number): ResultParticle[] {
  if (!Number.isFinite(start)) return [];
  const rnd = lcg(fnv1a(e.path));
  const delay = range(e.delay, rnd());
  const out: ResultParticle[] = [];
  for (let cycle = 0; cycle < e.cycles; cycle++) {
    for (let i = 0; i < e.count; i++) {
      const life = range(e.life, rnd());
      const speed = range(e.speed, rnd());
      const shape = shapePoint(e, rnd);
      const size = range(e.size, rnd());
      out.push({
        spawn: start + delay + e.btime + cycle * e.interval,
        life, speed, ...shape, size,
        sizeY: e.size3D ? range(e.sizeY, rnd()) : size,
        rotation: range(e.startRot, rnd()),
        rotationSpeed: range(e.rot, rnd()),
        gradientMix: lcg(fnv1a(`${e.path}/gradient/${cycle}/${i}`))(),
      });
    }
  }
  return out;
}

/** 在固定绝对时刻求帧；尺寸保留原始 Hermite 切线，双色渐变因子固定于出生时。 */
export function resultParticleAt(e: ResultEmitter, p: ResultParticle, t: number) {
  const age = t - p.spawn;
  if (age < 0 || age >= p.life) return null;
  const u = age / p.life;
  const distance = e.limit === null ? p.speed * age : dampedDistance(p.speed, e.limit, e.dampen, age);
  const size = Math.max(0, evalHermite(e.sizeKeys, u)) * e.unit;
  const g = [e.grad.cols, e.grad.alps] as const;
  const color = e.grad2
    ? evalGradientPair([e.grad2.cols, e.grad2.alps], g, p.gradientMix, u)
    : evalGradient(g, u);
  return {
    x: (p.position[0] + p.direction[0] * distance) * e.unit,
    y: (p.position[1] + p.direction[1] * distance) * e.unit,
    w: p.size * size,
    h: p.sizeY * size * (e.renderMode === 1 ? e.lengthScale : 1),
    rotation: e.renderMode === 1 ? Math.atan2(-p.direction[0] * p.speed, p.direction[1] * p.speed) : p.rotation + p.rotationSpeed * age,
    r: e.start[0] * color[0], g: e.start[1] * color[1], b: e.start[2] * color[2], a: e.start[3] * color[3],
  };
}

/** 主 Canvas 的排序为 layer 0 / order 1。 */
export const resultParticleAboveUi = (e: ResultEmitter) => e.sortLayer > 0 || e.sort > 1;
