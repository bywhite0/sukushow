import { describe, expect, it } from 'vitest';
import { DIFFICULTY_COLORS, START_CLIP_DURATION, sampleStartClip, START_IDLE_TIME, dotOutlineRects } from '../src/startAnim';

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
  it('待机帧取 1.75 s：曲线静止段起点，与 2.9 s 同帧且全员不透明', () => {
    expect(START_IDLE_TIME).toBe(1.75);
    const a = sampleStartClip(START_IDLE_TIME), b = sampleStartClip(2.9);
    for (const k of Object.keys(a) as (keyof typeof a)[]) expect(a[k]).toBeCloseTo(b[k], 6);
    expect(a.bg_a).toBe(1);
    expect(a.jacket_a).toBeCloseTo(1, 6);
    expect(a.scoreLabel_a).toBeCloseTo(1, 6);
  });
  it('right/btm 两条 alpha 曲线逐时刻相同（可由同一父层乘 alpha）', () => {
    for (let t = 0; t <= 3.7; t += 1 / 120) expect(sampleStartClip(t).right_a).toBe(sampleStartClip(t).btm_a);
  });
  it('点缀条：0 s 全在遮罩外，待机帧恰好填满两块遮罩', () => {
    expect(dotOutlineRects(sampleStartClip(0))).toEqual([]);
    expect(dotOutlineRects(sampleStartClip(START_IDLE_TIME))).toEqual([[575, 30, 606, 606], [30, 575, 576, 606]]);
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
