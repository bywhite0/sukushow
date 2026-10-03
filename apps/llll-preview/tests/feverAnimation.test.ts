import { describe, expect, it } from 'vitest';
import { feverEntrance } from '../src/feverAnimation';

describe('Fever 原始入场动画', () => {
  it('起点左右对称，遮罩高度为零', () => {
    const s = feverEntrance(0);
    expect(s.leftCore).toEqual([-18.459999084472656, -9.399999618530273, 0]);
    expect(s.rightCore).toEqual([18.459999084472656, -9.399999618530273, 0]);
    expect(s.leftMask).toEqual([1, 0, 1]);
    expect(s.rightMask).toEqual([4, 0, 1]);
    expect(s.coreActive).toBe(true);
  });
  it('中间帧按原始三次系数而非统一线性插值', () => {
    const s = feverEntrance(0.2);
    expect(s.leftCore[0]).toBeCloseTo(-10.539998626708985, 6);
    expect(s.leftMask[0]).toBeCloseTo(18.254436, 5);
    expect(s.leftMask[1]).toBeCloseTo(31.38461608886719, 6);
  });
  it('位置和遮罩各自在自己的末帧保持，不循环', () => {
    const s = feverEntrance(1);
    expect(s.leftCore).toEqual([-1.9600000381469727, 6.900000095367432, 25.799999237060547]);
    expect(s.leftMask).toEqual([40, 68, 1]);
    expect(s.rightMask).toEqual([40, 68, 1]);
    expect(s.coreActive).toBe(false);
    expect(feverEntrance(100)).toEqual(s);
  });
  it('关闭边界采用原始 float32 时间，回跳可恢复', () => {
    expect(feverEntrance(0.6333333253860474 - 1e-8).coreActive).toBe(true);
    expect(feverEntrance(0.6333333253860474).coreActive).toBe(false);
    expect(feverEntrance(0).coreActive).toBe(true);
    expect(feverEntrance(-1)).toEqual(feverEntrance(0));
  });
});
