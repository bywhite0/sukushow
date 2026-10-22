import { describe, expect, it } from 'vitest';
import type { NoteViewState } from '../src/judge';
import { holdDraw } from '../src/renderer';

/**
 * `holdDraw` 的判定依据（4.12.0）：
 * - `ManualHoldNotePolicy.ProcessTouch` 顶部无条件调 `HoldMeshView.ProcessView(_firstUnit, currentTime, touched)`，
 *   每帧重建整条链的网格；`touched` 只切动态 / 静态配色。
 * - 网格只在音符进漏判池时由 `ProcessMissed` 调 `Clear()`。
 * ⇒ 断链 / 漏头都不收 ribbon，只有尾判成功或尾判 Miss 离场才停画。
 */

const SPAWN = 1;
const TAIL = 3;

const state = (patch: Partial<NoteViewState>): NoteViewState => ({
  phase: 'pending', holding: false, broken: false, judged: 0, finished: false, missed: false, ...patch,
});

describe('holdDraw：Hold 的 ribbon 只在离场后停画', () => {
  it('还没生成 / 已过链尾时间：不画', () => {
    expect(holdDraw(state({}), 0.5, SPAWN, TAIL)).toBe('skip');
    expect(holdDraw(state({}), 3, SPAWN, TAIL)).toBe('skip');
  });

  it('未起判 / 断链 / 漏头僵尸都继续画 ribbon', () => {
    expect(holdDraw(state({}), 2, SPAWN, TAIL)).toBe('ribbon');
    expect(holdDraw(state({ holding: true, broken: true, judged: 2 }), 2, SPAWN, TAIL)).toBe('ribbon');
    expect(holdDraw(state({ phase: 'missed', holding: true, broken: true, judged: 2 }), 2, SPAWN, TAIL)).toBe('ribbon');
  });

  it('尾判成功离场不画；尾判 Miss 离场只留继续下落的头部图标', () => {
    expect(holdDraw(state({ finished: true, judged: 3 }), 2.4, SPAWN, TAIL)).toBe('skip');
    expect(holdDraw(state({ finished: true, missed: true, broken: true }), 2.4, SPAWN, TAIL)).toBe('falling-head');
  });

  it('没有判定状态（AutoPlay / 预览）：按时间画', () => {
    expect(holdDraw(undefined, 2, SPAWN, TAIL)).toBe('ribbon');
  });
});
