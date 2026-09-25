import type { FxMM, FxPrefab, FxGrad } from './rgAssets';

const constant = (v: number): FxMM => ({ k: 0, v, lo: v, hi: v, mult: 1 });
/** TwoConstants：原包 scalar=max、minScalar=min。 */
const twoConstants = (lo: number, hi: number): FxMM => ({ k: 3, v: hi, lo, hi, mult: hi });
const gradient = (rgb: number[][], alpha: number[][]): FxGrad => ({
  rgb: rgb.map(([t, r, g, b]) => ({ t: t / 65535, r, g, b })),
  a: alpha.map(([t, v]) => ({ t: t / 65535, v })),
});

/** #607/#627 与 #562/#561 的 ColorModule 两色渐变完全相同，共用。 */
const CORE_COL_MAX = () => gradient([
  [0, 0, 0.44510698318481445, 1], [20971, 0.047608666121959686, 0.8511872291564941, 0.9523913264274597],
  [41942, 0.5308486819267273, 0.9749734997749329, 0], [65535, 1, 0.950401782989502, 0],
], [[0, 0], [6939, 0.5686274766921997], [29491, 0.5686274766921997], [65535, 0]]);
const CORE_COL_MIN = () => gradient([
  [0, 1, 0.019788190722465515, 0], [20971, 1, 0.950401782989502, 0],
  [41942, 1, 0, 0.8173365592956543], [65535, 1, 0.35973286628723145, 0],
], [[0, 0.16862745583057404], [13107, 0.5686274766921997], [52428, 0.5686274766921997], [65535, 0]]);

/**
 * level56 彗星两层；节点平移由 FeverEffectStartAnimation 驱动（见 `feverEntrance`）。
 * - 节点 0 = `LineCoreMove_L/R`（#607/#627）：行进高光本体，`rateOverDistance=5/单位`。
 * - 节点 1 = `LineCoreParticleMove_L/R`（#562/#561）：**不是子发射器**（`SubModule.enabled=False`），
 *   而是挂在 `LineCoreMove` 下的独立节点，随父级动画一起移动，提供彗星核心的闪烁颗粒。
 */
export function feverCorePrefab(side: 'left' | 'right'): FxPrefab {
  const moveName = side === 'left' ? 'LineCoreMove_Left' : 'LineCoreMove_Right';
  const partName = side === 'left' ? 'LineCoreParticleMove_Left' : 'LineCoreParticleMove_Right';
  return {
    id: side === 'left' ? 'feverCoreLeft' : 'feverCoreRight', root: 0, impact: -1, p00: -1,
    nodes: [
      {
        name: moveName, parent: -1,
        px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1, active: true,
        rend: { mode: 0, align: 0, sortOrder: 600, mat: 'sharedassets56.assets:17' },
        ps: {
          en: true, dur: 0.10000000149011612, loop: true, maxp: 1000, local: true, grav: -1,
          // 序列化 moveWithTransform=1 ⇒ World 模拟空间（详见 docs/evidence.md）。
          world: true,
          col0R: 1, col0G: 1, col0B: 1, col0A: 1,
          life: constant(0.10000000149011612), speed: constant(0), delay: constant(0),
          size: constant(0.8999999761581421), sizeY: constant(1), size3d: true,
          rot: constant(6.283185005187988),
          vel: { en: true, world: true, x: constant(side === 'left' ? 3.700000047683716 : -3.700000047683716), y: constant(2.5), z: constant(0) },
          // 主要发射源是 Rate over Distance（5/单位），不是 burst：根节点沿边线走完 ~34.7 单位
          // ⇒ 单趟约 174 个，配合 0.1s 寿命形成约 40 个同时在世的拖尾，才是「行进高光」。
          rate: constant(0),
          rateDist: constant(5),
          bursts: [{ t: 0, count: constant(1), cycles: 15, interval: 0.4000000059604645, prob: 1 }],
          sizeol: { en: true, curve: {
            ...constant(1), k: 1, mult: 1.2999999523162842,
            keys: [
              { t: 0, v: 0, i: 4.382617950439453, o: 0.16797490417957306 },
              { t: 0.4763453006744385, v: 0.9906271696090698, i: 0.45598846673965454, o: 0.06255905330181122 },
              { t: 1, v: 0, i: -4.609101295471191, o: -4.609101295471191 },
            ],
          } },
          col: { en: true, mode: 3, max: CORE_COL_MAX(), min: CORE_COL_MIN() },
        },
      },
      {
        // 子节点：父级动画位移动 0 ⇒ 世界位置完全由 LineCoreMove 的曲线决定。
        name: partName, parent: 0,
        px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1, active: true,
        rend: { mode: 0, align: 0, sortOrder: 600, mat: 'sharedassets56.assets:12' },
        ps: {
          // lengthInSec=0.1 且 looping ⇒ 每 0.1s 重发一轮 burst（t=0 起 5 批 × 2 个 @0.01s）。
          en: true, dur: 0.10000000149011612, loop: true, maxp: 1000, local: true, grav: -0.4000000059604645,
          world: true,
          col0R: 1, col0G: 1, col0B: 1, col0A: 1,
          // 寿命 TwoConstants 0.2–0.3s，尺寸 TwoConstants 0.4–0.6（size3D=false ⇒ 用 X 作 Y）。
          life: twoConstants(0.20000000298023224, 0.30000001192092896),
          speed: constant(0), delay: constant(0),
          size: twoConstants(0.4000000059604645, 0.6000000238418579),
          sizeY: twoConstants(1.600000023841858, 1), size3d: false,
          // 初始自转 TwoConstants ±π；RotationModule（自转速率）同样 ±π rad/s。
          rot: twoConstants(3.141592502593994, -3.141592502593994),
          rotol: { en: true, curve: twoConstants(3.141592502593994, -3.141592502593994), sep: false },
          // VelocityModule 为 disabled，不采用其中残留的 ±3.7/2.5。
          vel: { en: false, world: true, x: constant(0), y: constant(0), z: constant(0) },
          rate: constant(0), rateDist: constant(0),
          bursts: [{ t: 0, count: constant(2), cycles: 5, interval: 0.009999999776482582, prob: 1 }],
          shape: {
            en: true, type: 4, angle: 0, radius: 9.999999747378752e-05,
            sx: 1, sy: 1, sz: 1, px: 0, py: 0, pz: 0, rotx: 0, roty: 0, rotz: 0, randDir: 0,
          },
          // SizeModule.curve 线性 0→1，乘数 1.3；separateAxes=false ⇒ 其 y 曲线不求值。
          sizeol: { en: true, curve: {
            ...constant(1), k: 1, mult: 1.2999999523162842,
            keys: [
              { t: 0, v: 0, i: 1, o: 1 },
              { t: 1, v: 1, i: 1, o: 0 },
            ],
          } },
          col: { en: true, mode: 3, max: CORE_COL_MAX(), min: CORE_COL_MIN() },
        },
      },
    ],
  };
}
