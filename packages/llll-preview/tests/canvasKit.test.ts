import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let drawGroup: typeof import('../src/canvasKit')['drawGroup'];

type ClearCall = [number, number, number, number];
type TransformCall = [number, number, number, number, number, number];
type DrawCall = unknown[];

function fakeCanvas(width: number, height: number, transform: TransformCall = [1, 0, 0, 1, 0, 0]) {
  const clearCalls: ClearCall[] = [];
  const transformCalls: TransformCall[] = [];
  const drawCalls: DrawCall[] = [];
  let current: TransformCall = [...transform];
  const saved: TransformCall[] = [];
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const context = {
    canvas,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high' as ImageSmoothingQuality,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    filter: 'none',
    save() { saved.push([...current]); },
    restore() { current = saved.pop()!; },
    setTransform: (...args: TransformCall | [{ a: number; b: number; c: number; d: number; e: number; f: number }]) => {
      const next: TransformCall = args.length === 1
        ? [args[0].a, args[0].b, args[0].c, args[0].d, args[0].e, args[0].f]
        : args as TransformCall;
      current = next;
      transformCalls.push(next);
    },
    getTransform: () => ({ a: current[0], b: current[1], c: current[2], d: current[3], e: current[4], f: current[5] }),
    clearRect: (...args: ClearCall) => clearCalls.push(args),
    beginPath() {},
    rect() {},
    clip() {},
    drawImage: (...args: DrawCall) => drawCalls.push(args),
  } as unknown as CanvasRenderingContext2D;
  return { canvas, context, clearCalls, transformCalls, drawCalls };
}

describe('drawGroup scratch isolation', () => {
  const oldDocument = globalThis.document;
  const created: ReturnType<typeof fakeCanvas>[] = [];

  beforeEach(async () => {
    vi.resetModules();
    ({ drawGroup } = await import('../src/canvasKit'));
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => {
        const scratch = fakeCanvas(100, 100);
        created.push(scratch);
        return scratch.canvas;
      } },
    });
  });

  afterEach(() => {
    created.length = 0;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument });
  });

  it('uses the clipped device bounds for a bounded group', () => {
    const host = fakeCanvas(100, 100).context;
    drawGroup(host, { bounds: { x: 10, y: 20, w: 20, h: 10 } }, () => {});
    const scratch = created.at(-1)!;
    expect([scratch.canvas.width, scratch.canvas.height]).toEqual([24, 14]);
    expect(scratch.clearCalls.at(-1)).toEqual([0, 0, 24, 14]);
  });

  it('preserves the group transform and destination when shifted and clipped', () => {
    const host = fakeCanvas(100, 80, [1.5, 0, 0, 1.5, 4, 6]);
    drawGroup(host.context, { bounds: { x: 10, y: 20, w: 20, h: 10 } }, () => {});
    const scratch = created.at(-1)!;
    expect([scratch.canvas.width, scratch.canvas.height]).toEqual([34, 19]);
    expect(scratch.transformCalls.at(-1)).toEqual([1.5, 0, 0, 1.5, -13, -28]);
    expect(host.drawCalls.at(-1)).toEqual([scratch.canvas, 0, 0, 34, 19, 17, 34, 34, 19]);
  });

  it('keeps mask coordinates aligned inside a bounded group', () => {
    const host = fakeCanvas(100, 100, [1, 0, 0, 1, 10, 20]);
    let maskContext: CanvasRenderingContext2D | null = null;
    drawGroup(host.context, { bounds: { x: 20, y: 30, w: 10, h: 10 }, mask: (g) => { maskContext = g; } }, () => {});
    const scratch = created.at(-1)!;
    expect(maskContext).toBe(scratch.context);
    expect(scratch.transformCalls.at(-1)).toEqual([1, 0, 0, 1, -18, -28]);
  });

  it('supports a bounded group nested inside another bounded group', () => {
    const host = fakeCanvas(100, 100).context;
    drawGroup(host, { bounds: { x: 20, y: 20, w: 40, h: 40 } }, (outer) => {
      drawGroup(outer, { bounds: { x: 30, y: 30, w: 10, h: 10 } }, () => {});
    });
    expect(created).toHaveLength(2);
    const [outer, inner] = created;
    expect([outer!.canvas.width, outer!.canvas.height]).toEqual([44, 44]);
    expect([inner!.canvas.width, inner!.canvas.height]).toEqual([14, 14]);
    expect(outer!.drawCalls.at(-1)).toEqual([inner!.canvas, 0, 0, 14, 14, 10, 10, 14, 14]);
  });

  it('clears the whole pooled scratch before a filtered group', () => {
    const host = fakeCanvas(100, 100).context;
    drawGroup(host, { bounds: { x: 10, y: 10, w: 20, h: 20 } }, () => {});
    drawGroup(host, {
      bounds: { x: 10, y: 10, w: 20, h: 20 },
      filter: 'drop-shadow(0 0 10px rgba(10,150,255,.55))',
    }, () => {});
    const scratch = created.at(-1)!;
    expect([scratch.canvas.width, scratch.canvas.height]).toEqual([100, 100]);
    expect(scratch.clearCalls.at(-1)).toEqual([0, 0, 100, 100]);
  });

  it('reuses each scratch size when differently sized groups alternate', () => {
    const host = fakeCanvas(100, 100).context;
    const small = { bounds: { x: 10, y: 10, w: 20, h: 20 } };
    const large = { bounds: { x: 40, y: 40, w: 30, h: 30 } };
    drawGroup(host, small, () => {});
    drawGroup(host, large, () => {});
    drawGroup(host, small, () => {});
    drawGroup(host, large, () => {});
    expect(created).toHaveLength(2);
    expect([created[0]!.canvas.width, created[1]!.canvas.width]).toEqual([24, 34]);
  });

  it('does not retain unbounded scratch sizes as bounds change', () => {
    const host = fakeCanvas(100, 100).context;
    for (let width = 1; width <= 40; width++) {
      drawGroup(host, { bounds: { x: 0, y: 0, w: width, h: 10 } }, () => {});
    }
    expect(created.length).toBeLessThanOrEqual(16);
  });

  it('bounds the idle pool after deeply nested groups finish', () => {
    const host = fakeCanvas(100, 100).context;
    const nest = (ctx: CanvasRenderingContext2D, depth: number): void => {
      if (!depth) return;
      drawGroup(ctx, {}, (g) => nest(g, depth - 1));
    };
    nest(host, 20);
    const allocated = created.length;
    nest(host, 20);
    expect(created.length - allocated).toBeGreaterThanOrEqual(4);
  });

  it('evicts old large canvases when export sizes exceed the idle pixel budget', () => {
    for (const width of [3840, 3841, 3842]) {
      drawGroup(fakeCanvas(width, 2160).context, {}, () => {});
    }
    expect(created).toHaveLength(3);
    drawGroup(fakeCanvas(3840, 2160).context, {}, () => {});
    expect(created).toHaveLength(4);
  });

  it('keeps full-stage scratch for groups without bounds', () => {
    const host = fakeCanvas(120, 80).context;
    drawGroup(host, {}, () => {});
    const scratch = created.at(-1)!;
    expect([scratch.canvas.width, scratch.canvas.height]).toEqual([120, 80]);
  });

  it('does not allocate a scratch for an invisible group', () => {
    drawGroup(fakeCanvas(100, 100).context, { alpha: 0 }, () => {});
    expect(created).toHaveLength(0);
  });
});
