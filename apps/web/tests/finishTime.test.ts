import { describe, expect, it } from 'vitest';
import { resultStartTime } from '../src/finishTime';

describe('曲终横幅开始时间', () => {
  it('不早于主数据 FinishTime，并等待较长的实际 BGM 结束', () => {
    expect(resultStartTime(104.118, 106.764583)).toBeCloseTo(106.764583, 9);
    expect(resultStartTime(104.118, null)).toBe(104.118);
    expect(resultStartTime(null, 106.764583)).toBeNull();
    expect(resultStartTime(null, null)).toBeNull();
    expect(resultStartTime(104.118, 103.9)).toBe(104.118);
  });
});
