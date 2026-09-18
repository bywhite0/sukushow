import { describe, expect, it } from 'vitest';
import { formatTechnicalScore, hudLayout, hudScale, scoreCommaSprite, scoreDigitSprite } from '../src/hud';

describe('HUD SafeArea 缩放', () => {
  it('1920×1080 时 scale=1，逻辑画布与 SafeArea 同宽', () => {
    expect(hudScale(1920, 1080)).toBe(1);
    const layout = hudLayout(1920, 1080);
    expect(layout.scale).toBe(1);
    expect(layout.logicW).toBe(1920);
    expect(layout.logicH).toBe(1080);
    expect(layout.safeW).toBe(1920);
    expect(layout.safeOffsetX).toBe(0);
  });

  it('2376×1080 时 scale=1，SafeArea 仍为 1920 并水平居中', () => {
    expect(hudScale(2376, 1080)).toBe(1);
    const layout = hudLayout(2376, 1080);
    expect(layout.scale).toBe(1);
    expect(layout.logicW).toBe(2376);
    expect(layout.logicH).toBe(1080);
    expect(layout.safeW).toBe(1920);
    expect(layout.safeOffsetX).toBe((2376 - 1920) / 2);
  });

  it('较矮视口按高度缩放', () => {
    expect(hudScale(1920, 540)).toBe(0.5);
    const layout = hudLayout(1920, 540);
    expect(layout.logicW).toBe(3840);
    expect(layout.logicH).toBe(1080);
    expect(layout.safeOffsetX).toBe((3840 - 1920) / 2);
  });
});

describe('UpdateScore 暗色精灵', () => {
  it('score=0 时十二位与逗号全暗', () => {
    for (let i = 0; i < 12; i++) {
      expect(scoreDigitSprite(0, i)).toBe('ui_sc2_ingame_num_score_11');
    }
    for (let c = 0; c < 3; c++) {
      expect(scoreCommaSprite(0, c)).toBe('ui_sc2_ingame_num_score_12');
    }
  });

  it('非零分数按位换精灵', () => {
    expect(scoreDigitSprite(123, 0)).toBe('ui_sc2_ingame_num_score_3');
    expect(scoreDigitSprite(123, 1)).toBe('ui_sc2_ingame_num_score_2');
    expect(scoreDigitSprite(123, 2)).toBe('ui_sc2_ingame_num_score_1');
    expect(scoreDigitSprite(123, 3)).toBe('ui_sc2_ingame_num_score_11');
    expect(scoreCommaSprite(123, 0)).toBe('ui_sc2_ingame_num_score_12');
  });
});

describe('TechnicalScore 文案', () => {
  it('0 → 0 + .0000 %（不是场景模板 99.9999）', () => {
    expect(formatTechnicalScore(0)).toEqual({ whole: '0', frac: '.0000 %' });
  });

  it('101 → 101 + .0000 %（全 PP 上界）', () => {
    expect(formatTechnicalScore(101)).toEqual({ whole: '101', frac: '.0000 %' });
  });

  it('按小数拆分', () => {
    expect(formatTechnicalScore(12.34567)).toEqual({ whole: '12', frac: '.3457 %' });
  });
});
