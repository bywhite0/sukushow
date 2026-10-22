import { describe, expect, it } from 'vitest';
import { parseChart } from '@sukushow/chart/chart';
import { JudgeEngine, type JudgeEvent } from '@sukushow/llll-preview/judge';
import {
  clampPlayOffset,
  isWideStage,
  laneToScreenX,
  PlayInput,
  playJudgeTime,
  screenXToLane,
} from '../src/views/llll/playInput';
import { DEFAULT_PLAY_KEY_LAYOUT, lookupKey, type PlayKeyLayout } from '../src/views/llll/playKeys';

type Listener = (event: unknown) => void;

/** 最小事件发射器：PlayInput 只用 addEventListener / removeEventListener / dispatch。 */
class FakeEmitter {
  readonly listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type);
    if (list) this.listeners.set(type, list.filter((item) => item !== listener));
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

/** 假舞台画布：只实现 PlayInput 用到的 DOM 表面。 */
class FakeCanvas extends FakeEmitter {
  readonly style: Record<string, string> = { touchAction: '', userSelect: '' };
  readonly captured: number[] = [];
  rect = { left: 0, top: 0, width: 1920, height: 1080 };

  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number } {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }

  hasPointerCapture(): boolean {
    return true;
  }

  releasePointerCapture(): void {
    /* no-op */
  }
}

type PointerLike = { pointerId: number; clientX: number; clientY: number; target?: unknown };

function pointerEvent(pointerId: number, clientX: number, clientY: number, target?: unknown): PointerLike {
  return { pointerId, clientX, clientY, target };
}

/** 舞台里叠着的按钮：`closest(控件选择器)` 命中自身。 */
const controlTarget = { closest: () => ({}) as unknown as Element };
/** 画布本身：不在任何控件里。 */
const canvasTarget = { closest: () => null };

type KeyOptions = { repeat?: boolean; ctrlKey?: boolean; target?: unknown; timeStamp?: number };

function keyEvent(code: string, options: KeyOptions = {}): { event: Record<string, unknown>; prevented: () => number } {
  let prevented = 0;
  return {
    event: {
      code,
      repeat: options.repeat ?? false,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: false,
      altKey: false,
      target: options.target ?? null,
      timeStamp: options.timeStamp ?? 0,
      preventDefault() {
        prevented += 1;
      },
    },
    prevented: () => prevented,
  };
}

function setup(options: {
  clock?: () => number;
  wide?: boolean;
  size?: { width: number; height: number };
  rect?: { left: number; top: number; width: number; height: number };
  toLane?: (x: number, y: number) => number;
  keyLayout?: PlayKeyLayout;
  controlOwnsKey?: (target: EventTarget | null, code: string) => boolean;
} = {}) {
  const canvas = new FakeCanvas();
  if (options.rect) canvas.rect = options.rect;
  const size = options.size ?? { width: canvas.rect.width, height: canvas.rect.height };
  const keyboard = new FakeEmitter();
  const input = new PlayInput(canvas as unknown as HTMLElement, {
    clock: options.clock ?? (() => 0),
    toLane: options.toLane,
    getSize: () => size,
    isWide: () => options.wide ?? true,
    keyboardTarget: keyboard as unknown as EventTarget,
    keyLayout: options.keyLayout,
    controlOwnsKey: options.controlOwnsKey,
  });
  return { canvas, keyboard, input, size };
}

describe('screenXToLane', () => {
  it('1920 宽屏：屏幕正中 29.5，每 24px 一条轨道', () => {
    expect(screenXToLane(960, 1920, true)).toBeCloseTo(29.5, 12);
    expect(screenXToLane(984, 1920, true)).toBeCloseTo(30.5, 12);
    expect(screenXToLane(936, 1920, true)).toBeCloseTo(28.5, 12);
    expect(screenXToLane(0, 1920, true)).toBeCloseTo(-10.5, 12);
  });

  it('4:3（1280×960）不算宽屏，WidthRate < 1 时 scale 仍为 1，间距仍是 24px', () => {
    expect(isWideStage(1280, 960)).toBe(false);
    expect(screenXToLane(640, 1280, false)).toBeCloseTo(29.5, 12);
    expect(screenXToLane(664, 1280, false)).toBeCloseTo(30.5, 12);
  });

  it('2560 宽屏：scale 固定 1，间距 24px', () => {
    expect(screenXToLane(1280, 2560, true)).toBeCloseTo(29.5, 12);
    expect(screenXToLane(1304, 2560, true)).toBeCloseTo(30.5, 12);
  });

  it('非宽屏且宽于 1920 时 scale = WidthRate（2560×1600 → 间距 32px）', () => {
    expect(isWideStage(2560, 1600)).toBe(false);
    expect(screenXToLane(1280, 2560, false)).toBeCloseTo(29.5, 12);
    expect(screenXToLane(1312, 2560, false)).toBeCloseTo(30.5, 12);
  });

  it('中心取 width/2（画布宽不取整）', () => {
    expect(screenXToLane(960.45, 1920.9, true)).toBeCloseTo(29.5, 12);
  });
});

describe('isWideStage', () => {
  it('按 16:9 判定，非法尺寸不算宽屏', () => {
    expect(isWideStage(1920, 1080)).toBe(true);
    expect(isWideStage(2560, 1080)).toBe(true);
    expect(isWideStage(1280, 960)).toBe(false);
    expect(isWideStage(0, 0)).toBe(false);
  });
});

describe('laneToScreenX', () => {
  it('与 screenXToLane 互为逆运算', () => {
    for (const [width, wide] of [
      [1920, true],
      [1280, false],
      [2560, true],
      [2560, false],
      [390, false],
    ] as const) {
      for (const lane of [0, 5, 29.5, 42.25, 59]) {
        const x = laneToScreenX(lane, width, wide);
        expect(screenXToLane(x, width, wide)).toBeCloseTo(lane, 12);
      }
    }
  });

  it('键盘轨道中心：1920 宽屏下 lane 5 → x=372、lane 15 → x=612', () => {
    expect(laneToScreenX(5, 1920, true)).toBeCloseTo(372, 12);
    expect(laneToScreenX(15, 1920, true)).toBeCloseTo(612, 12);
    expect(laneToScreenX(55, 1920, true)).toBeCloseTo(1572, 12);
    expect(laneToScreenX(5, 1280, false)).toBeCloseTo(52, 12);
  });
});

describe('clampPlayOffset', () => {
  it('夹到 −200..200 的整数毫秒', () => {
    expect(clampPlayOffset(0)).toBe(0);
    expect(clampPlayOffset(12.4)).toBe(12);
    expect(clampPlayOffset(-12.6)).toBe(-13);
    expect(clampPlayOffset(-500)).toBe(-200);
    expect(clampPlayOffset(500)).toBe(200);
    expect(clampPlayOffset(Number.NaN)).toBe(0);
    expect(clampPlayOffset(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('PlayInput 指针', () => {
  it('pointerdown → began：坐标相对画布左上角，lane 按屏幕 X 映射', () => {
    const { canvas, input } = setup({ clock: () => 12.5 });
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(7, 960, 540));
    const touches = input.drain();
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ id: 7, phase: 'began', x: 960, y: 540, keyboard: false });
    expect(touches[0]!.lane).toBeCloseTo(29.5, 12);
    expect(touches[0]!.time).toBeCloseTo(12.5, 12);
    expect(canvas.captured).toEqual([7]);
  });

  it('有 toLane 时 lane 完全来自渲染器映射（相对画布坐标作为参数）', () => {
    const seen: Array<[number, number]> = [];
    const { canvas, input } = setup({
      rect: { left: 100, top: 50, width: 960, height: 540 },
      toLane: (x, y) => {
        seen.push([x, y]);
        return (x + y) / 1000;
      },
    });
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(1, 580, 320));
    canvas.dispatch('pointermove', pointerEvent(1, 580, 320));
    const touches = input.drain();
    expect(seen).toEqual([
      [480, 270],
      [480, 270],
    ]);
    expect(touches.map((t) => t.lane)).toEqual([0.75, 0.75]);
  });

  it('画布被 CSS 缩放 / 偏移时按 rect 换算，不用 devicePixelRatio', () => {
    const { canvas, input } = setup({ rect: { left: 100, top: 50, width: 960, height: 540 } });
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(1, 580, 320));
    const [touch] = input.drain();
    expect(touch!.x).toBeCloseTo(480, 12);
    expect(touch!.y).toBeCloseTo(270, 12);
    // 960 宽的画布按 16:9 是宽屏：中心 480 → 29.5。
    expect(touch!.lane).toBeCloseTo(29.5, 12);
  });

  it('began / moved / ended 按发生顺序入队，drain 取走后清空', () => {
    const { canvas, input } = setup();
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(1, 960, 540));
    canvas.dispatch('pointerdown', pointerEvent(2, 984, 540));
    canvas.dispatch('pointermove', pointerEvent(2, 984, 500));
    canvas.dispatch('pointerup', pointerEvent(1, 960, 540));
    const touches = input.drain();
    expect(touches.map((t) => t.phase)).toEqual(['began', 'began', 'moved', 'ended']);
    expect(touches.map((t) => t.id)).toEqual([1, 2, 2, 1]);
    expect(touches[2]!.lane).toBeCloseTo(30.5, 12);
    expect(input.drain()).toEqual([]);
  });

  it('没有 down 过的指针 move 不上报；cancel 上报 canceled', () => {
    const { canvas, input } = setup();
    input.attach();
    canvas.dispatch('pointermove', pointerEvent(9, 960, 540));
    expect(input.drain()).toEqual([]);
    canvas.dispatch('pointerdown', pointerEvent(3, 960, 540));
    canvas.dispatch('pointercancel', pointerEvent(3, 960, 540));
    expect(input.drain().map((t) => t.phase)).toEqual(['began', 'canceled']);
    canvas.dispatch('pointermove', pointerEvent(3, 960, 540));
    expect(input.drain()).toEqual([]);
  });

  it('判定偏移：负值让 time 提前，正值延后', () => {
    const { canvas, input } = setup({ clock: () => 10 });
    input.attach();
    input.setOffsetMs(-50);
    expect(input.getOffsetMs()).toBe(-50);
    canvas.dispatch('pointerdown', pointerEvent(1, 960, 540));
    expect(input.drain()[0]!.time).toBeCloseTo(9.95, 12);
    input.setOffsetMs(120);
    canvas.dispatch('pointerup', pointerEvent(1, 960, 540));
    expect(input.drain()[0]!.time).toBeCloseTo(10.12, 12);
    // 非有限值不写进偏移。
    input.setOffsetMs(Number.NaN);
    expect(input.getOffsetMs()).toBe(120);
  });

  it('attach 设 touch-action / user-select 为 none，detach 还原并停止上报', () => {
    const { canvas, input } = setup();
    canvas.style.touchAction = 'pan-y';
    canvas.style.userSelect = 'text';
    input.attach();
    expect(canvas.style.touchAction).toBe('none');
    expect(canvas.style.userSelect).toBe('none');
    expect(canvas.listenerCount('pointerdown')).toBe(1);
    input.detach();
    expect(canvas.style.touchAction).toBe('pan-y');
    expect(canvas.style.userSelect).toBe('text');
    expect(canvas.listenerCount('pointerdown')).toBe(0);
    canvas.dispatch('pointerdown', pointerEvent(1, 960, 540));
    expect(input.drain()).toEqual([]);
  });

  it('setEnabled(false) 时不再捕获，重新启用后恢复', () => {
    const { canvas, input } = setup();
    input.attach();
    input.setEnabled(false);
    canvas.dispatch('pointerdown', pointerEvent(1, 960, 540));
    expect(input.drain()).toEqual([]);
    input.setEnabled(true);
    canvas.dispatch('pointerdown', pointerEvent(2, 960, 540));
    expect(input.drain().map((t) => t.id)).toEqual([2]);
  });
});

describe('PlayInput 键盘', () => {
  /** 默认布局下键位所在分区。 */
  const zoneOf = (code: string) => {
    const target = lookupKey(DEFAULT_PLAY_KEY_LAYOUT, code);
    if (target?.kind !== 'zone') throw new Error(`${code} 不是分区键`);
    return target;
  };
  const keyToLane = (code: string): number => zoneOf(code).lane;
  /** 键位 lane → 1920 宽屏下的画布 x（与 `laneToScreenX` 同一口径）。 */
  const keyX = (code: string): number => laneToScreenX(keyToLane(code), 1920, true);

  it('keydown → began：分区中心 lane + 整个分区区间，keyboard=true', () => {
    const { keyboard, input } = setup({ clock: () => 3 });
    input.attach();
    const { event, prevented } = keyEvent('KeyF');
    keyboard.dispatch('keydown', event);
    const [touch] = input.drain();
    expect(touch).toMatchObject({ phase: 'began', keyboard: true, x: keyX('KeyF'), y: 810 });
    expect(touch!.lane).toBeCloseTo(keyToLane('KeyF'), 12);
    expect(touch!.span).toEqual(zoneOf('KeyF').span);
    expect(touch!.time).toBeCloseTo(3, 12);
    expect(prevented()).toBe(1);
  });

  it('键盘跳过 toLane：lane 直接取键位中心，x/y 只按兜底公式补全', () => {
    let toLaneCalls = 0;
    const { keyboard, input } = setup({
      toLane: () => {
        toLaneCalls += 1;
        return 99;
      },
    });
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyD').event);
    const [touch] = input.drain();
    expect(touch!.lane).toBeCloseTo(keyToLane('KeyD'), 12);
    expect(touch!.x).toBeCloseTo(keyX('KeyD'), 12);
    expect(touch!.y).toBeCloseTo(810, 12);
    expect(toLaneCalls).toBe(0);
  });

  it('长按重复 keydown 不重复 began，keyup 用同一个 id 结束', () => {
    const { keyboard, input } = setup();
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyG').event);
    keyboard.dispatch('keydown', keyEvent('KeyG', { repeat: true }).event);
    const began = input.drain();
    expect(began.map((t) => t.phase)).toEqual(['began']);
    const id = began[0]!.id;
    keyboard.dispatch('keyup', keyEvent('KeyG').event);
    const [ended] = input.drain();
    expect(ended).toMatchObject({ id, phase: 'ended', keyboard: true });
    expect(ended!.lane).toBeCloseTo(keyToLane('KeyG'), 12);
  });

  it('未按下过的键 keyup 不上报', () => {
    const { keyboard, input } = setup();
    input.attach();
    keyboard.dispatch('keyup', keyEvent('KeyH').event);
    expect(input.drain()).toEqual([]);
  });

  it('焦点在输入框 / 按钮里时不处理，也不 preventDefault', () => {
    const { keyboard, input } = setup();
    input.attach();
    const control = { closest: () => ({}) as unknown as Element };
    const { event, prevented } = keyEvent('KeyD', { target: control });
    keyboard.dispatch('keydown', event);
    expect(input.drain()).toEqual([]);
    expect(prevented()).toBe(0);
  });

  it('Ctrl / Meta / Alt 组合键不抢', () => {
    const { keyboard, input } = setup();
    input.attach();
    const { event, prevented } = keyEvent('KeyK', { ctrlKey: true });
    keyboard.dispatch('keydown', event);
    expect(input.drain()).toEqual([]);
    expect(prevented()).toBe(0);
  });

  it('按住的分区键每帧补 stationary，并带同一个区间', () => {
    const { keyboard, input } = setup();
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyA').event);
    input.drain();
    const [held] = input.frame(1).touches;
    expect(held).toMatchObject({ phase: 'stationary', keyboard: true, span: zoneOf('KeyA').span });
  });

  it('Air 键：只发一条 air 事件，不进按住表、松开不发 ended，长按重复不重发', () => {
    const { keyboard, input } = setup({ clock: () => 2 });
    input.attach();
    const { event, prevented } = keyEvent('Space');
    keyboard.dispatch('keydown', event);
    keyboard.dispatch('keydown', keyEvent('Space', { repeat: true }).event);
    const touches = input.drain();
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ phase: 'began', air: true, keyboard: true, time: 2 });
    expect(prevented()).toBe(1);
    expect(input.frame(2.1).touches).toEqual([]);
    keyboard.dispatch('keyup', keyEvent('Space').event);
    expect(input.drain()).toEqual([]);
  });

  it('自定义布局：四区 QWER、Air 为 Shift；原默认键不再响应', () => {
    const layout: PlayKeyLayout = { zones: ['KeyQ', 'KeyW', 'KeyE', 'KeyR'], air: 'ShiftLeft', chordMs: 30 };
    const { keyboard, input } = setup({ keyLayout: layout });
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyA').event);
    keyboard.dispatch('keydown', keyEvent('Space').event);
    expect(input.drain()).toEqual([]);
    keyboard.dispatch('keydown', keyEvent('KeyW').event);
    keyboard.dispatch('keydown', keyEvent('ShiftLeft').event);
    const [zone, air] = input.drain();
    expect(zone).toMatchObject({ phase: 'began', span: [14.5, 29.5] });
    expect(zone!.lane).toBeCloseTo(22, 12);
    expect(air).toMatchObject({ air: true });
    expect(input.bindsKey('KeyW')).toBe(true);
    expect(input.bindsKey('ShiftLeft')).toBe(true);
    expect(input.bindsKey('KeyA')).toBe(false);
  });

  it('按住期间换布局：松开仍按按下时的分区与 id 结束', () => {
    const { keyboard, input } = setup();
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyD').event);
    const [began] = input.drain();
    input.setKeyLayout({ zones: ['KeyQ', 'KeyW'], air: null, chordMs: 30 });
    keyboard.dispatch('keyup', keyEvent('KeyD').event);
    const [ended] = input.drain();
    expect(ended).toMatchObject({ id: began!.id, phase: 'ended', span: zoneOf('KeyD').span });
  });

  it('控件归属由 controlOwnsKey 决定：传入的判定拿到目标与键位', () => {
    const seen: Array<[unknown, string]> = [];
    const control = { closest: () => ({}) as unknown as Element };
    const { keyboard, input } = setup({ controlOwnsKey: (target, code) => { seen.push([target, code]); return code === 'Space'; } });
    input.attach();
    keyboard.dispatch('keydown', keyEvent('KeyD', { target: control }).event);
    keyboard.dispatch('keydown', keyEvent('Space', { target: control }).event);
    // 字母键归页面（即使焦点在按钮上），Space 归控件。
    expect(input.drain().map((t) => t.span ? 'zone' : 'air')).toEqual(['zone']);
    expect(seen).toEqual([[control, 'KeyD'], [control, 'Space']]);
  });

  describe('同按组（chord）', () => {
    /** 按顺序在给定时刻按下各键，返回每个 began 的 chord。 */
    const chordsOf = (presses: Array<[string, number]>, layout?: PlayKeyLayout) => {
      const { keyboard, input } = setup(layout ? { keyLayout: layout } : {});
      input.attach();
      for (const [code, timeStamp] of presses) keyboard.dispatch('keydown', keyEvent(code, { timeStamp }).event);
      return input.drain().map((t) => t.chord);
    };

    it('窗口内相邻分区键同组（含链式相邻）', () => {
      const [a, b, c] = chordsOf([['KeyD', 0], ['KeyF', 5], ['KeyG', 12]]);
      expect(a).toBeTypeOf('number');
      expect(b).toBe(a);
      expect(c).toBe(a);
    });

    it('不相邻的分区键各自成组（两只手同时按）', () => {
      const [a, b] = chordsOf([['KeyA', 0], ['KeyL', 2]]);
      expect(b).not.toBe(a);
    });

    it('超出窗口（从组首键算起）开新组；恰好等于窗口仍同组', () => {
      const [a, b] = chordsOf([['KeyD', 0], ['KeyF', 31]]);
      expect(b).not.toBe(a);
      const [c, d] = chordsOf([['KeyD', 0], ['KeyF', 30]]);
      expect(d).toBe(c);
    });

    it('窗口不随后续键顺延：滑过整排键不会连成一组', () => {
      const chords = chordsOf([['KeyA', 0], ['KeyS', 20], ['KeyD', 40], ['KeyF', 60]]);
      expect(chords[1]).toBe(chords[0]);
      expect(chords[2]).not.toBe(chords[0]);
      expect(chords[3]).toBe(chords[2]);
    });

    it('chordMs = 0 不分组：began 不带 chord', () => {
      expect(chordsOf([['KeyD', 0], ['KeyF', 1]], { ...DEFAULT_PLAY_KEY_LAYOUT, chordMs: 0 })).toEqual([undefined, undefined]);
    });

    it('Air、stationary 与 ended 不带 chord', () => {
      const { keyboard, input } = setup();
      input.attach();
      keyboard.dispatch('keydown', keyEvent('KeyD').event);
      keyboard.dispatch('keydown', keyEvent('Space').event);
      const [zone, air] = input.drain();
      expect(zone!.chord).toBeTypeOf('number');
      expect(air!.chord).toBeUndefined();
      expect(input.frame(1).touches.every((t) => t.chord === undefined)).toBe(true);
      keyboard.dispatch('keyup', keyEvent('KeyD').event);
      expect(input.drain()[0]!.chord).toBeUndefined();
    });
  });

  it('detach 后键盘不再上报', () => {
    const { keyboard, input } = setup();
    input.attach();
    input.detach();
    keyboard.dispatch('keydown', keyEvent('KeyJ').event);
    expect(input.drain()).toEqual([]);
  });
});

describe('PlayInput 控件上的指针', () => {
  it('在舞台里的按钮上按下：不上报、不捕获，后续 move / up 也不上报', () => {
    const { canvas, input } = setup();
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(4, 1800, 40, controlTarget));
    canvas.dispatch('pointermove', pointerEvent(4, 1805, 40, controlTarget));
    canvas.dispatch('pointerup', pointerEvent(4, 1805, 40, controlTarget));
    expect(input.drain()).toEqual([]);
    expect(canvas.captured).toEqual([]);
    expect(input.frame(0).touches).toEqual([]);
  });

  it('在画布上按下照常上报并捕获', () => {
    const { canvas, input } = setup();
    input.attach();
    canvas.dispatch('pointerdown', pointerEvent(5, 960, 540, canvasTarget));
    expect(input.drain().map((t) => t.phase)).toEqual(['began']);
    expect(canvas.captured).toEqual([5]);
  });
});

describe('判定时钟', () => {
  it('playJudgeTime = 歌曲时间 + 偏移；0 偏移不变，负值提前，正值延后', () => {
    expect(playJudgeTime(10, 0)).toBe(10);
    expect(playJudgeTime(10, -150)).toBeCloseTo(9.85, 12);
    expect(playJudgeTime(10, 200)).toBeCloseTo(10.2, 12);
  });

  it('frame：time 取该帧判定时钟；先给累积事件，再给仍按住指针在同一时钟上的 stationary', () => {
    let now = 5;
    const { canvas, input } = setup({ clock: () => now });
    input.attach();
    input.setOffsetMs(-50);
    canvas.dispatch('pointerdown', pointerEvent(1, 960, 540));
    canvas.dispatch('pointerdown', pointerEvent(2, 100, 540));
    canvas.dispatch('pointerup', pointerEvent(2, 100, 540));
    now = 5.01;
    const { time, touches } = input.frame(5.02);
    expect(time).toBeCloseTo(4.97, 12);
    expect(touches.map((t) => [t.id, t.phase])).toEqual([[1, 'began'], [2, 'began'], [2, 'ended'], [1, 'stationary']]);
    expect(touches[3]!.time).toBe(time);
    // 队列已取走：下一帧只剩按住的指针。
    expect(input.frame(5.03).touches.map((t) => [t.id, t.phase])).toEqual([[1, 'stationary']]);
  });

  it('什么都没按：没有触摸', () => {
    const { input } = setup();
    input.attach();
    expect(input.frame(1)).toEqual({ time: 1, touches: [] });
  });
});

/**
 * 按 `views/llll.ts` 的 `processPlay` 接法逐帧推进：`PlayInput.frame(歌曲时间)` → `JudgeEngine.process`。
 * 需求：判定偏移平移的是整条判定时钟，按偏移后的节奏输入，判定与 0 偏移完全一致。
 */
describe('判定偏移 × 判定引擎', () => {
  const FRAME = 1 / 60;
  const flags = (t: number, l: number, r: number, l2 = 0, r2 = 0) =>
    t + r * 16 + r2 * 1024 + l * 65536 + l2 * 4194304;
  const chartOf = (Notes: unknown[]) => parseChart({ Notes, Bpms: [{ Time: 0, Bpm: 120 }] } as never);
  const single = () => chartOf([{ Uid: 1, just: '1.0', Flags: flags(0, 20, 30), holds: [] }]);
  const hold = () => chartOf([{ Uid: 1, just: '1.0', Flags: flags(1, 20, 30, 20, 30), holds: ['2.0'] }]);
  const OFFSETS = [-200, -150, -50, 0, 50, 150, 200];

  function play(
    chart: ReturnType<typeof chartOf>, offsetMs: number,
    act: (songTime: number, canvas: FakeCanvas) => void,
  ): JudgeEvent[] {
    let now = 0.5;
    const { canvas, input } = setup({ clock: () => now, toLane: () => 25 });
    input.setOffsetMs(offsetMs);
    input.attach();
    const engine = new JudgeEngine(chart);
    const events: JudgeEvent[] = [];
    for (; now <= 2.6; now += FRAME) {
      act(now, canvas);
      const { time, touches } = input.frame(now);
      events.push(...engine.process(time, touches));
    }
    return events.filter((e) => e.kind === 'judge');
  }

  it.each(OFFSETS)('Single：偏移 %i ms，按偏移后的节奏按下判 Perfect+', (offsetMs) => {
    let step = 0;
    const events = play(single(), offsetMs, (now, canvas) => {
      if (step === 0 && playJudgeTime(now, offsetMs) >= 1) { step = 1; canvas.dispatch('pointerdown', pointerEvent(1, 960, 900)); }
      else if (step === 1) { step = 2; canvas.dispatch('pointerup', pointerEvent(1, 960, 900)); }
    });
    expect(events.map((e) => e.type)).toEqual([5]);
  });

  it.each(OFFSETS)('Hold：偏移 %i ms，按偏移后的节奏从头按到尾，头尾都是 Perfect+、没有 Miss', (offsetMs) => {
    let step = 0;
    const events = play(hold(), offsetMs, (now, canvas) => {
      const judged = playJudgeTime(now, offsetMs);
      if (step === 0 && judged >= 1) { step = 1; canvas.dispatch('pointerdown', pointerEvent(1, 960, 900)); }
      else if (step === 1 && judged >= 2.05) { step = 2; canvas.dispatch('pointerup', pointerEvent(1, 960, 900)); }
    });
    expect(events.map((e) => [e.holdIndex, e.type])).toEqual([[0, 5], [1, 5]]);
  });

  it('偏移 −150 ms 却按未偏移的节奏按下：判定时刻早 0.15 s，落在窗口外判 Miss', () => {
    let step = 0;
    const events = play(single(), -150, (now, canvas) => {
      if (step === 0 && now >= 1) { step = 1; canvas.dispatch('pointerdown', pointerEvent(1, 960, 900)); }
    });
    expect(events.map((e) => e.type)).toEqual([0]);
  });
});
