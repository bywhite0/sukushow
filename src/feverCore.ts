import type { FxMM, FxPrefab, FxGrad } from './rgAssets';

const constant = (v: number): FxMM => ({ k: 0, v, lo: v, hi: v, mult: 1 });
const gradient = (rgb: number[][], alpha: number[][]): FxGrad => ({
  rgb: rgb.map(([t, r, g, b]) => ({ t: t / 65535, r, g, b })),
  a: alpha.map(([t, v]) => ({ t: t / 65535, v })),
});

/** level56 #607/#627；节点平移由 FeverEffectStartAnimation 驱动。 */
export function feverCorePrefab(side: 'left' | 'right'): FxPrefab {
  return {
    id: side === 'left' ? 'feverCoreLeft' : 'feverCoreRight', root: 0, impact: -1, p00: -1,
    nodes: [{
      name: side === 'left' ? 'LineCoreMove_Left' : 'LineCoreMove_Right', parent: -1,
      px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1, active: true,
      rend: { mode: 0, align: 0, sortOrder: 600, mat: 'sharedassets56.assets:17' },
      ps: {
        en: true, dur: 0.10000000149011612, loop: true, maxp: 1000, local: true, grav: -1,
        col0R: 1, col0G: 1, col0B: 1, col0A: 1,
        life: constant(0.10000000149011612), speed: constant(0), delay: constant(0),
        size: constant(0.8999999761581421), sizeY: constant(1), size3d: true,
        rot: constant(6.283185005187988),
        vel: { en: true, world: true, x: constant(side === 'left' ? 3.700000047683716 : -3.700000047683716), y: constant(2.5), z: constant(0) },
        bursts: [{ t: 0, count: constant(1), cycles: 15, interval: 0.4000000059604645, prob: 1 }],
        sizeol: { en: true, curve: {
          ...constant(1), k: 1, mult: 1.2999999523162842,
          keys: [
            { t: 0, v: 0, i: 4.382617950439453, o: 0.16797490417957306 },
            { t: 0.4763453006744385, v: 0.9906271696090698, i: 0.45598846673965454, o: 0.06255905330181122 },
            { t: 1, v: 0, i: -4.609101295471191, o: -4.609101295471191 },
          ],
        } },
        col: { en: true, mode: 3,
          max: gradient([
            [0, 0, 0.44510698318481445, 1], [20971, 0.047608666121959686, 0.8511872291564941, 0.9523913264274597],
            [41942, 0.5308486819267273, 0.9749734997749329, 0], [65535, 1, 0.950401782989502, 0],
          ], [[0, 0], [6939, 0.5686274766921997], [29491, 0.5686274766921997], [65535, 0]]),
          min: gradient([
            [0, 1, 0.019788190722465515, 0], [20971, 1, 0.950401782989502, 0],
            [41942, 1, 0, 0.8173365592956543], [65535, 1, 0.35973286628723145, 0],
          ], [[0, 0.16862745583057404], [13107, 0.5686274766921997], [52428, 0.5686274766921997], [65535, 0]]),
        },
      },
    }],
  };
}
