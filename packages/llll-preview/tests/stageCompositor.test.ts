import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let StageCompositor: typeof import('../src/stageCompositor')['StageCompositor'];
let images: Map<string, { naturalWidth: number; naturalHeight: number }>;
let created: FakeCanvas[];

type FakeCanvas = HTMLCanvasElement & { calls: { fill: number; draw: unknown[][]; pattern: number } };

vi.mock('../src/canvasKit', () => ({
  image: (url: string) => images.get(url) ?? null,
  preloadImages: () => Promise.resolve(),
}));

function canvas(): FakeCanvas {
  const calls = { fill: 0, draw: [] as unknown[][], pattern: 0 };
  const element = { width: 0, height: 0, calls } as FakeCanvas;
  const ctx = {
    canvas: element,
    fillStyle: '' as string | CanvasPattern,
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    filter: 'none',
    setTransform() {},
    fillRect() { calls.fill++; },
    drawImage(...args: unknown[]) { calls.draw.push(args); },
    createPattern() { calls.pattern++; return { setTransform() {} } as unknown as CanvasPattern; },
  } as unknown as CanvasRenderingContext2D;
  element.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  return element;
}

const layers = { gl: null, hud: null, startAnim: null, comboResult: null };
const view = { cssW: 320, cssH: 180, dpr: 1 };

describe('StageCompositor background cache', () => {
  const originalDocument = globalThis.document;
  const originalDOMMatrix = globalThis.DOMMatrix;

  beforeEach(async () => {
    vi.resetModules();
    images = new Map();
    created = [];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
      const item = canvas(); created.push(item); return item;
    } } });
    Object.defineProperty(globalThis, 'DOMMatrix', { configurable: true, value: class { scale() { return this; } } });
    ({ StageCompositor } = await import('../src/stageCompositor'));
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'DOMMatrix', { configurable: true, value: originalDOMMatrix });
  });

  it('reuses a composed background without repainting an unchanged view', () => {
    const target = canvas();
    const compositor = new StageCompositor(target);
    compositor.draw(view, layers);
    compositor.draw(view, layers);
    expect(created).toHaveLength(1);
    expect(created[0].calls.fill).toBe(1);
    expect(target.calls.draw).toHaveLength(2);
    expect(target.calls.draw[0][0]).toBe(created[0]);
  });

  it('rebuilds when CSS dimensions, DPR or darkness change', () => {
    const target = canvas();
    const compositor = new StageCompositor(target);
    compositor.draw(view, layers);
    compositor.draw({ ...view, cssW: 300 }, layers);
    compositor.draw({ ...view, cssW: 300, dpr: 2 }, layers);
    compositor.setBackgroundDim(.35);
    compositor.draw({ ...view, cssW: 300, dpr: 2 }, layers);
    expect(created).toHaveLength(1);
    expect(created[0].calls.fill).toBe(5);
    expect([created[0].width, created[0].height]).toEqual([600, 360]);
  });

  it('rebuilds after the background or dot texture becomes ready', () => {
    const target = canvas();
    const compositor = new StageCompositor(target);
    compositor.draw(view, layers);
    images.set('/in_game_difficulty_bg_101.png', { naturalWidth: 32, naturalHeight: 32 });
    compositor.draw(view, layers);
    images.set('/sc2_ingame_bg_pattern_dot.png', { naturalWidth: 16, naturalHeight: 16 });
    compositor.draw(view, layers);
    compositor.draw(view, layers);
    expect(created).toHaveLength(1);
    expect(created[0].calls.fill).toBe(4);
    expect(created[0].calls.pattern).toBe(1);
    expect(created[0].calls.draw).toHaveLength(2);
  });

  it('rebuilds the preview background after a fixed-size export frame', () => {
    const target = canvas();
    const compositor = new StageCompositor(target);
    compositor.draw(view, layers);
    compositor.draw({ cssW: 1280, cssH: 720, dpr: 1 }, layers);
    compositor.draw(view, layers);
    expect(created).toHaveLength(1);
    expect(created[0].calls.fill).toBe(3);
    expect([created[0].width, created[0].height]).toEqual([320, 180]);
  });

  it('keeps WebGL, HUD, intro and result on every draw after the cached background', () => {
    const target = canvas();
    const compositor = new StageCompositor(target);
    const gl = canvas();
    gl.width = 320; gl.height = 180;
    const order: string[] = [];
    const original = target.getContext('2d')!.drawImage.bind(target.getContext('2d'));
    target.getContext('2d')!.drawImage = ((...args: unknown[]) => {
      order.push(args[0] === gl ? 'gl' : 'background');
      (original as (...values: unknown[]) => void)(...args);
    }) as CanvasRenderingContext2D['drawImage'];
    const overlay = (name: string) => ({ draw: () => { order.push(name); } });
    const fullLayers = { gl, hud: overlay('hud'), startAnim: overlay('intro'), comboResult: overlay('result') };
    compositor.draw(view, fullLayers);
    compositor.draw(view, fullLayers);
    expect(order).toEqual(['background', 'gl', 'hud', 'intro', 'result', 'background', 'gl', 'hud', 'intro', 'result']);
  });
});
