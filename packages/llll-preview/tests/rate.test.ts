import { describe, expect, it } from 'vitest';
import { playerRate, rateByScore } from '../src/rate';

/**
 * 4.12.0 MusicInformation.GetRateByScore（@0x449BBF0）与
 * UserDataRepository.CalculatePlayerRate（@0x44A39E8）的固定样例。
 * t = technical * 10000 / MaxCombo；这里取 MaxCombo = 10000，于是 t = technical，便于直接喂边界。
 */
const LEVEL = 27;
const MAX_COMBO = 10_000;
const rateAt = (t: number) => rateByScore(t, LEVEL, MAX_COMBO);

describe('GetRateByScore', () => {
  it('Level / MaxCombo 非正返回 0', () => {
    expect(rateByScore(1_000_000, 0, MAX_COMBO)).toBe(0);
    expect(rateByScore(1_000_000, LEVEL, 0)).toBe(0);
    expect(rateByScore(Number.NaN, LEVEL, MAX_COMBO)).toBe(0);
  });

  it('浮点段三档（trunc）', () => {
    expect(rateAt(500_000)).toBe(75);
    expect(rateAt(800_000)).toBe(120);
    expect(rateAt(899_999)).toBe(134); // 269.9997 → trunc
    // 运算顺序：二进制先 r/180 再乘 Level*10；864/1248 的极端低分是 0 而不是 1。
    expect(rateByScore(864, 26, 1248)).toBe(0);
    expect(rateAt(900_000)).toBe(135); // r>=90：(90-90)/20+0.5 = 0.5
    expect(rateAt(949_999)).toBe(202); // 接近 r=95：(94.9999-90)/20+0.5 ≈ 0.749995
    expect(rateAt(950_000)).toBe(202); // r>=95：0.75
    expect(rateAt(980_000)).toBe(270);
  });

  it('整数阶梯：980000 之后每档 +1，AP 附近封顶 +25', () => {
    expect(rateAt(981_999)).toBe(270);
    expect(rateAt(982_000)).toBe(271);
    expect(rateAt(983_999)).toBe(271);
    expect(rateAt(984_000)).toBe(272);
    expect(rateAt(987_999)).toBe(272);
    expect(rateAt(988_000)).toBe(273);
    expect(rateAt(991_999)).toBe(273);
    expect(rateAt(992_000)).toBe(274);
    expect(rateAt(995_999)).toBe(274);
    expect(rateAt(996_000)).toBe(275);
    expect(rateAt(999_999)).toBe(275);
    expect(rateAt(1_000_000)).toBe(276);
    expect(rateAt(1_004_999)).toBe(280);
    expect(rateAt(1_005_000)).toBe(281);
    expect(rateAt(1_007_999)).toBe(285);
    expect(rateAt(1_008_000)).toBe(286);
    expect(rateAt(1_009_499)).toBe(290);
    expect(rateAt(1_009_500)).toBe(291);
    expect(rateAt(1_010_000)).toBe(295);
    expect(rateAt(1_020_000)).toBe(295); // Math.Min(25, …) 封顶
  });
});

describe('CalculatePlayerRate', () => {
  it('空列表为 0', () => {
    expect(playerRate([])).toBe(0);
  });

  it('取前 30 个最高 Rate 求和，不是平均', () => {
    expect(playerRate([1, 2, 3])).toBe(6);
    const rates = Array.from({ length: 40 }, (_, i) => 40 - i); // 40..1
    expect(playerRate(rates)).toBe((40 + 11) * 30 / 2);
    expect(playerRate([5, 4, 3, 2, 1, 0, -1])).toBe(15);
  });
});
