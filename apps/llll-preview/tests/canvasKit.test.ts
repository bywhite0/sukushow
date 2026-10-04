import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drawGroup } from '../src/canvasKit';

type ClearCall = [number, number, number, number];

function fakeCanvas(width: number, height: number) {
  const clearCalls: ClearCall[] = [];
  const transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
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
    save() {},
    restore() {},
    setTransform() {},
    getTransform: () => transform,
    clearRect: (...args: ClearCall) => clearCalls.push(args),
    beginPath() {},
    rect() {},
    clip() {},
    drawImage() {},
  } as unknown as CanvasRenderingContext2D;
  return { canvas, context, clearCalls };
}

describe('drawGroup scratch isolation', () => {
  const oldDocument = globalThis.document;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => fakeCanvas(100, 100).canvas },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: oldDocument });
  });

  it('clears the whole pooled scratch before a filtered group', () => {
    const scratch = fakeCanvas(100, 100);
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: () => scratch.canvas },
    });
    const host = fakeCanvas(100, 100).context;

    // The first group uses the cheaper bounds-only clear and returns this
    // canvas to the pool.
    drawGroup(host, { bounds: { x: 10, y: 10, w: 20, h: 20 } }, () => {});
    expect(scratch.clearCalls.at(-1)).toEqual([8, 8, 24, 24]);
    // Combo's cross-100 flash uses a filter and composites the whole scratch.
    drawGroup(host, {
      bounds: { x: 10, y: 10, w: 20, h: 20 },
      filter: 'drop-shadow(0 0 10px rgba(10,150,255,.55))',
    }, () => {});

    expect(scratch.clearCalls.at(-1)).toEqual([0, 0, 100, 100]);
  });
});
