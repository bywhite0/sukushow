import { describe, expect, it } from 'vitest';
import { DIFFICULTY_COLORS, START_CLIP_DURATION, sampleStartClip } from '../src/startAnim';

describe('开场过场 sc2_ingame_start_jacket', () => {
  it('时长 3.6666667 s（220 帧 @60fps）', () => {
    expect(START_CLIP_DURATION).toBeCloseTo(220 / 60, 5);
  });
  it('描边条从 (−41, 41) 滑到 (0, 0)，1.75 s 到位', () => {
    const a = sampleStartClip(0);
    expect(a.right_x).toBeCloseTo(-41, 3);
    expect(a.right_y).toBeCloseTo(41, 3);
    expect(a.btm_x).toBeCloseTo(-41, 3);
    expect(a.btm_y).toBeCloseTo(41, 3);
    const b = sampleStartClip(1.75);
    for (const k of ['right_x', 'right_y', 'btm_x', 'btm_y'] as const) expect(Math.abs(b[k])).toBeLessThan(1e-3);
  });
  it('黑底 3.0 s 前不透明，结束时全部淡出', () => {
    expect(sampleStartClip(0).bg_a).toBeCloseTo(1, 4);
    expect(sampleStartClip(3.0).bg_a).toBeCloseTo(1, 4);
    const end = sampleStartClip(START_CLIP_DURATION);
    expect(end.bg_a).toBeCloseTo(0, 4);
    expect(end.jacket_a).toBeCloseTo(0, 4);
    expect(end.scoreLabel_a).toBeCloseTo(0, 4);
  });
  it('封面 1.667 s 已完全显示', () => {
    expect(sampleStartClip(100 / 60).jacket_a).toBeCloseTo(1, 3);
  });
  it('超出区间夹取端点', () => {
    expect(sampleStartClip(-1)).toEqual(sampleStartClip(0));
    expect(sampleStartClip(99)).toEqual(sampleStartClip(START_CLIP_DURATION));
  });
  it('难度色 = ColorPreset.GetDifficultyColor', () => {
    expect(DIFFICULTY_COLORS.MASTER).toEqual([0x93, 0x70, 0xd5]);
    expect(DIFFICULTY_COLORS.NORMAL).toEqual([0x36, 0xd6, 0xe0]);
  });
});
