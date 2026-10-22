import { describe, expect, it } from 'vitest';
import { LANE_SUB_RANGE } from '@sukushow/llll-preview/judge';
import {
  DEFAULT_PLAY_KEY_LAYOUT, LANE_EDGE_LEFT, LANE_EDGE_RIGHT, PLAY_CHORD_MS_DEFAULT, PLAY_CHORD_MS_MAX, PLAY_ZONES_MAX,
  PLAY_ZONES_MIN, assignKey, clampChordMs, isBindableKey, keyLabel, lookupKey, resizeLayout, sanitizePlayKeyLayout, zoneSpan,
  type PlayKeyLayout,
} from '../src/views/llll/playKeys';

const layoutOf = (result: ReturnType<typeof assignKey>): PlayKeyLayout => {
  if ('error' in result) throw new Error(result.error);
  return result.layout;
};

describe('zoneSpan：60 轨等分', () => {
  it('任意分区数下各区等宽、首尾相接，铺满 [-0.5, 59.5]', () => {
    for (let n = PLAY_ZONES_MIN; n <= PLAY_ZONES_MAX; n++) {
      const spans = Array.from({ length: n }, (_, i) => zoneSpan(i, n));
      expect(spans[0]![0]).toBeCloseTo(LANE_EDGE_LEFT, 12);
      expect(spans[n - 1]![1]).toBeCloseTo(LANE_EDGE_RIGHT, 12);
      for (let i = 0; i < n; i++) {
        expect(spans[i]![1] - spans[i]![0]).toBeCloseTo(60 / n, 12);
        if (i > 0) expect(spans[i]![0]).toBeCloseTo(spans[i - 1]![1], 12);
      }
    }
  });

  it('任意分区数下每个音符（l..r）的可点范围都至少碰到一个分区', () => {
    for (let n = PLAY_ZONES_MIN; n <= PLAY_ZONES_MAX; n++) {
      const spans = Array.from({ length: n }, (_, i) => zoneSpan(i, n));
      for (let l = 0; l < 60; l++) {
        for (let r = l; r < 60; r++) {
          const hit = spans.some(([a, b]) => a <= r + LANE_SUB_RANGE && b >= l - LANE_SUB_RANGE);
          if (!hit) throw new Error(`${n} 区漏掉 ${l}..${r}`);
        }
      }
    }
  });
});

describe('默认布局', () => {
  it('九区 A S D F G H J K L、Air 为空格、同按合并 30 ms；区中心与原九键触点一致（29.5 ± k·20/3）', () => {
    expect(DEFAULT_PLAY_KEY_LAYOUT).toEqual({
      zones: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'], air: 'Space', chordMs: 30,
    });
    DEFAULT_PLAY_KEY_LAYOUT.zones.forEach((code, i) => {
      const target = lookupKey(DEFAULT_PLAY_KEY_LAYOUT, code);
      expect(target?.kind).toBe('zone');
      if (target?.kind === 'zone') expect(target.lane).toBeCloseTo(29.5 + (i - 4) * (20 / 3), 12);
    });
  });
});

describe('lookupKey', () => {
  it('分区键给序号、中心与区间；Air 键给 air；其它键（含对象原型键名）为 null', () => {
    const layout: PlayKeyLayout = { zones: ['KeyQ', 'KeyW'], air: 'ShiftLeft', chordMs: 30 };
    expect(lookupKey(layout, 'KeyW')).toEqual({ kind: 'zone', index: 1, lane: 44.5, span: [29.5, 59.5] });
    expect(lookupKey(layout, 'ShiftLeft')).toEqual({ kind: 'air' });
    for (const code of ['KeyA', 'Space', 'constructor', '', 'keyq']) expect(lookupKey(layout, code)).toBeNull();
    expect(lookupKey({ zones: ['KeyQ'], air: null, chordMs: 30 }, 'Space')).toBeNull();
  });
});

describe('resizeLayout', () => {
  it('减少分区：保留左侧的键', () => {
    expect(resizeLayout(DEFAULT_PLAY_KEY_LAYOUT, 4)).toEqual({ zones: ['KeyA', 'KeyS', 'KeyD', 'KeyF'], air: 'Space', chordMs: 30 });
  });

  it('增加分区：补未占用的键，不与已有分区和 Air 重复', () => {
    const layout = resizeLayout({ zones: ['KeyL', 'KeyA'], air: 'KeyS', chordMs: 30 }, 5);
    expect(layout.zones).toEqual(['KeyL', 'KeyA', 'KeyD', 'KeyF', 'KeyG']);
    const max = resizeLayout(DEFAULT_PLAY_KEY_LAYOUT, PLAY_ZONES_MAX);
    expect(max.zones).toHaveLength(PLAY_ZONES_MAX);
    expect(new Set([...max.zones, max.air]).size).toBe(PLAY_ZONES_MAX + 1);
  });

  it('分区数夹在 1..16 的整数', () => {
    expect(resizeLayout(DEFAULT_PLAY_KEY_LAYOUT, 0).zones).toHaveLength(1);
    expect(resizeLayout(DEFAULT_PLAY_KEY_LAYOUT, 99).zones).toHaveLength(16);
    expect(resizeLayout(DEFAULT_PLAY_KEY_LAYOUT, 3.7).zones).toHaveLength(3);
  });
});

describe('assignKey', () => {
  const base: PlayKeyLayout = { zones: ['KeyA', 'KeyS', 'KeyD'], air: 'Space', chordMs: 30 };

  it('绑空闲键：只改这个槽', () => {
    expect(layoutOf(assignKey(base, 1, 'KeyQ'))).toEqual({ zones: ['KeyA', 'KeyQ', 'KeyD'], air: 'Space', chordMs: 30 });
    expect(layoutOf(assignKey(base, 'air', 'ShiftLeft'))).toEqual({ zones: ['KeyA', 'KeyS', 'KeyD'], air: 'ShiftLeft', chordMs: 30 });
  });

  it('绑别的分区占用的键：两个分区互换', () => {
    expect(layoutOf(assignKey(base, 0, 'KeyD'))).toEqual({ zones: ['KeyD', 'KeyS', 'KeyA'], air: 'Space', chordMs: 30 });
  });

  it('分区与 Air 互换：分区抢 Air 的键，Air 得到分区原来的键；反过来同理', () => {
    expect(layoutOf(assignKey(base, 2, 'Space'))).toEqual({ zones: ['KeyA', 'KeyS', 'Space'], air: 'KeyD', chordMs: 30 });
    expect(layoutOf(assignKey(base, 'air', 'KeyS'))).toEqual({ zones: ['KeyA', 'Space', 'KeyD'], air: 'KeyS', chordMs: 30 });
  });

  it('同一个键：原样返回', () => {
    expect(layoutOf(assignKey(base, 0, 'KeyA'))).toBe(base);
  });

  it('Air 为空时抢分区的键：换不了，报错且不改布局', () => {
    const result = assignKey({ zones: ['KeyA', 'KeyS'], air: null, chordMs: 30 }, 'air', 'KeyS');
    expect(result).toEqual({ error: expect.stringContaining('分区 2') });
  });

  it('保留键与非法键位拒绝绑定', () => {
    for (const code of ['Escape', 'Tab', 'ControlLeft', 'AltRight', 'MetaLeft', '', 'Key A']) {
      expect(isBindableKey(code)).toBe(false);
      expect(assignKey(base, 0, code)).toHaveProperty('error');
    }
    for (const code of ['KeyZ', 'Digit1', 'Semicolon', 'ShiftLeft', 'ArrowUp', 'Space']) expect(isBindableKey(code)).toBe(true);
  });
});

describe('sanitizePlayKeyLayout', () => {
  it('合法布局原样保留（含不用 Air）', () => {
    const layout = { zones: ['KeyQ', 'KeyW', 'KeyE', 'KeyR'], air: null, chordMs: 0 };
    expect(sanitizePlayKeyLayout(layout)).toEqual(layout);
    expect(sanitizePlayKeyLayout({ zones: ['KeyQ'], air: 'Space', chordMs: 45 })).toEqual({ zones: ['KeyQ'], air: 'Space', chordMs: 45 });
  });

  it('旧存档没有 chordMs：键位保留，窗口取默认；窗口越界夹到 0..80，非数取默认', () => {
    expect(sanitizePlayKeyLayout({ zones: ['KeyQ'], air: 'Space' })).toEqual({ zones: ['KeyQ'], air: 'Space', chordMs: PLAY_CHORD_MS_DEFAULT });
    expect(sanitizePlayKeyLayout({ zones: ['KeyQ'], air: null, chordMs: 500 }).chordMs).toBe(PLAY_CHORD_MS_MAX);
    expect(sanitizePlayKeyLayout({ zones: ['KeyQ'], air: null, chordMs: -3 }).chordMs).toBe(0);
    expect(sanitizePlayKeyLayout({ zones: ['KeyQ'], air: null, chordMs: '20' }).chordMs).toBe(PLAY_CHORD_MS_DEFAULT);
  });

  it('键位损坏但窗口合法：键位回默认，窗口保留', () => {
    expect(sanitizePlayKeyLayout({ zones: ['KeyA', 'KeyA'], air: null, chordMs: 12 })).toEqual({ ...DEFAULT_PLAY_KEY_LAYOUT, chordMs: 12 });
  });

  it('结构不对、键不可绑、重复、数量越界：整体回默认', () => {
    const junk: unknown[] = [
      null, 'x', 1, {}, { zones: 'KeyA' }, { zones: [] }, { zones: Array(17).fill('KeyA') },
      { zones: ['KeyA', 'KeyA'], air: null }, { zones: ['KeyA'], air: 'KeyA' }, { zones: ['KeyA', 3], air: null },
      { zones: ['Escape'], air: null }, { zones: ['KeyA'], air: 5 }, { zones: ['KeyA'] },
    ];
    for (const raw of junk) expect(sanitizePlayKeyLayout(raw)).toEqual(DEFAULT_PLAY_KEY_LAYOUT);
  });
});

describe('clampChordMs', () => {
  it('取整并夹到 0..80；缺省、NaN、Infinity 与非数字取默认', () => {
    expect(clampChordMs(12.6)).toBe(13);
    expect(clampChordMs(0)).toBe(0);
    expect(clampChordMs(80)).toBe(80);
    expect(clampChordMs(81)).toBe(80);
    expect(clampChordMs(-1)).toBe(0);
    for (const raw of [undefined, null, NaN, Infinity, '30']) expect(clampChordMs(raw)).toBe(PLAY_CHORD_MS_DEFAULT);
  });
});

describe('keyLabel', () => {
  it('字母、数字、小键盘、符号与空格给可读名，其余原样', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('Numpad3')).toBe('Num 3');
    expect(keyLabel('Space')).toBe('空格');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('ShiftLeft')).toBe('左 Shift');
    expect(keyLabel('F5')).toBe('F5');
  });
});
