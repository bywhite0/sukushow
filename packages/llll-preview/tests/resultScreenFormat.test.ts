import { describe, expect, it } from 'vitest';
import {
  DIM_TAG_CLOSE,
  DIM_TAG_OPEN,
  clearLampOf,
  countupValue,
  easeInQuad,
  formatScore,
  formatTechnical,
  rankText,
  slideOffset,
  slideTotalWait,
  technicalGoal,
} from '../src/resultScreenFormat';

const DIM = (s: string) => `${DIM_TAG_OPEN}${s}${DIM_TAG_CLOSE}`;

describe('formatScore（CountupScore @0x46E8C18）', () => {
  it('0：前 14 字符（含分组逗号）淡色，末位 0 本色', () => {
    expect(formatScore(0)).toBe(DIM('000,000,000,00') + '0');
  });

  it('1 位 / 2 位：有效数字前的零与逗号都归淡色段', () => {
    expect(formatScore(5)).toBe(DIM('000,000,000,00') + '5');
    expect(formatScore(12)).toBe(DIM('000,000,000,0') + '12');
    expect(formatScore(999)).toBe(DIM('000,000,000,') + '999');
  });

  it('7 位：000,00 淡色 + 1,234,567 本色', () => {
    expect(formatScore(1234567)).toBe(DIM('000,00') + '1,234,567');
  });

  it('前缀内的分组逗号随前缀一起淡色', () => {
    expect(formatScore(1000)).toBe(DIM('000,000,00') + '1,000');
    expect(formatScore(123456)).toBe(DIM('000,000,') + '123,456');
    expect(formatScore(10_000_000)).toBe(DIM('000,0') + '10,000,000');
    expect(formatScore(1_000_000_000)).toBe(DIM('00') + '1,000,000,000');
  });

  it('12 位满：前缀为空串，仍保留空的淡色标签对（反汇编无条件拼接）', () => {
    expect(formatScore(100_000_000_000)).toBe(DIM('') + '100,000,000,000');
    expect(formatScore(999_999_999_999)).toBe(DIM('') + '999,999,999,999');
  });
});

describe('formatTechnical（CountupTechnicalScore @0x46EA5BC）', () => {
  it('0：000.0000% 的整数部两个 0 淡色', () => {
    expect(formatTechnical(0)).toBe(DIM('00') + '0.0000%');
  });

  it('低于 100% 时只淡化整数部前导零', () => {
    expect(formatTechnical(123456)).toBe(DIM('0') + '12.3456%');
    expect(formatTechnical(10000)).toBe(DIM('00') + '1.0000%');
    expect(formatTechnical(1)).toBe(DIM('00') + '0.0001%');
    expect(formatTechnical(99_999)).toBe(DIM('00') + '9.9999%');
    expect(formatTechnical(100_000)).toBe(DIM('0') + '10.0000%');
  });

  it('整百及以上：不淡色，前缀为空（保留空标签对）', () => {
    expect(formatTechnical(1_000_000)).toBe(DIM('') + '100.0000%');
    expect(formatTechnical(1_010_000)).toBe(DIM('') + '101.0000%');
  });
});

describe('technicalGoal（b__0 @0x46F4868）', () => {
  it('全 PerfectPlus：raw/N×10000 = 1010000', () => {
    expect(technicalGoal(2443 * 101, 2443)).toBe(1_010_000);
  });

  it('向零截断（非四舍五入）', () => {
    expect(technicalGoal(1000, 3)).toBe(3_333_333);
    expect(technicalGoal(2, 3)).toBe(6666);
    expect(technicalGoal(1, 3)).toBe(3333);
  });

  it('分母 <= 0：防御性返回 0（原版分母恒为正，反汇编未判零）', () => {
    expect(technicalGoal(1000, 0)).toBe(0);
    expect(technicalGoal(1000, -3)).toBe(0);
  });
});

describe('countupValue（CountupText d__13 @0x46EAFD8）', () => {
  it('线性 0→goal，到点返回 goal', () => {
    expect(countupValue(1000, 0, 0.5)).toBe(0);
    expect(countupValue(1000, 0.25, 0.5)).toBe(500);
    expect(countupValue(1000, 0.5, 0.5)).toBe(1000);
    expect(countupValue(1000, 9, 0.5)).toBe(1000);
  });

  it('按 decimal 相乘后向零截断，不四舍五入', () => {
    expect(countupValue(3, 0.25, 0.5)).toBe(1);
    expect(countupValue(999, 0.999, 1)).toBe(998);
  });

  it('比例按 float32 除法（elapsed/duration 是 C# float 除法）', () => {
    // float32 比例得到 33333334；直接使用 double 比例会得到 33333333。
    expect(countupValue(100_000_000, 0.1, 0.3)).toBe(33_333_334);
  });
});

describe('缓动与滑入（SlideContent.DoSlide @0x46E033C）', () => {
  it('easeInQuad = u²，入参钳到 0..1', () => {
    expect(easeInQuad(0)).toBe(0);
    expect(easeInQuad(0.5)).toBe(0.25);
    expect(easeInQuad(0.25)).toBe(0.0625);
    expect(easeInQuad(1)).toBe(1);
    expect(easeInQuad(-1)).toBe(0);
    expect(easeInQuad(2)).toBe(1);
  });

  it('slideOffset 端值与中点：u=0 → distance，u=0.5 → 37.5，u=1 → 0', () => {
    expect(slideOffset(0)).toBe(150);
    expect(slideOffset(0.5)).toBe(37.5);
    expect(slideOffset(1)).toBe(0);
    expect(slideOffset(0, 60)).toBe(60);
    expect(slideOffset(1, 60)).toBe(0);
  });

  it('slideTotalWait = 0.6 + 0.1n', () => {
    expect(slideTotalWait(0)).toBeCloseTo(0.6, 10);
    expect(slideTotalWait(1)).toBeCloseTo(0.7, 10);
    expect(slideTotalWait(12)).toBeCloseTo(1.8, 10);
  });
});

describe('rankText（ChangeAchievementStatusToText @0x4233258）', () => {
  it('0..4 → D/C/B/A/S', () => {
    expect([0, 1, 2, 3, 4].map(rankText)).toEqual(['D', 'C', 'B', 'A', 'S']);
  });
});

describe('clearLampOf（预览推断口径）', () => {
  it('AP / FC / 存活清曲 / 死亡', () => {
    expect(clearLampOf(1, 0)).toBe(3);
    expect(clearLampOf(1 | 2, 0)).toBe(3);
    expect(clearLampOf(2, 500)).toBe(2);
    expect(clearLampOf(0, 1)).toBe(1);
    expect(clearLampOf(0, 0)).toBe(0);
  });
});
