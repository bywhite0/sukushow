import { describe, expect, it } from 'vitest';
import type { Ctx } from '../src/canvasKit';
import { RESULT_NODES } from '../src/resultScreenClip';
import { layoutResultText } from '../src/resultScreenText';
import type { ResultText } from '../src/resultScreenTypes';

/** 受控字体：advance = 0.6em，可见字形上沿 = 0.7em、下沿 = 0。 */
const context = () => ({
  font: '', letterSpacing: '',
  measureText(this: { font: string }, value: string) {
    const size = Number(/([\d.]+)px/.exec(this.font)![1]);
    return { width: value.length * size * 0.6, actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: value.length * size * 0.6,
      actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: 0 };
  },
}) as unknown as Ctx;

const textOf = (suffix: string): ResultText => RESULT_NODES.find((n) => n.path.endsWith(suffix))!.text!;

describe('结算 TMP 文本布局', () => {
  it('Middle 使用原包字体行框，Geometry 将实际数字边界居中', () => {
    const text = { ...textOf('/Number-Rate'), size: 40 };
    const geometry = layoutResultText(context(), text, '305', 200, 100);
    const middle = layoutResultText(context(), { ...text, vertical: 512 }, '305', 200, 100);
    expect(geometry.lines[0]!.y).toBeCloseTo(64);
    // FaceInfo：ascent 28.16 / descent -3.84，采样字号 32。
    expect(middle.lines[0]!.y).toBeCloseTo(65.2);
  });

  it('自动字号可放大到上限，富文本颜色标签不占宽；容器不足时保留最小字号', () => {
    const text = textOf('/Number-Score');
    const rich = '<color=#C0B8D0>000,</color>123,456,789';
    const full = layoutResultText(context(), text, rich, 800, 96);
    expect(full.size).toBe(72);
    expect(full.lines[0]!.runs.map((r) => r.text).join('')).toBe('000,123,456,789');
    expect(full.lines[0]!.runs[0]!.color).toEqual([192 / 255, 184 / 255, 208 / 255]);
    const fit = layoutResultText(context(), text, rich, 450, 96);
    expect(fit.size).toBeGreaterThan(text.size);
    expect(fit.lines[0]!.width).toBeLessThanOrEqual(450);
    expect(fit.lines[0]!.x + fit.lines[0]!.width).toBeCloseTo(450);
    expect(layoutResultText(context(), text, rich, 10, 10).size).toBe(18);
  });

  it('技术分双行标题按序列化的 -50 行距排布', () => {
    const text = textOf('/TechnicalScoreContent/ScoreBase/Text');
    const result = layoutResultText(context(), text, text.content, 150, 100);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1]!.y - result.lines[0]!.y).toBe(33);
    // 两行可见字形整体的中心应为容器中心。
    const top = result.lines[0]!.y - 15.4;
    const bottom = result.lines[1]!.y;
    expect((top + bottom) / 2).toBeCloseTo(50);
  });

  it('Geometry 水平居中计入左右侧承，不以 advance 代替字形边界', () => {
    const ctx = context();
    const measure = ctx.measureText.bind(ctx);
    ctx.measureText = (value) => ({ ...measure(value), width: 120,
      actualBoundingBoxLeft: -4, actualBoundingBoxRight: 110 }) as TextMetrics;
    const text = textOf('/TechnicalScoreContent/ScoreBase/Text');
    const line = layoutResultText(ctx, text, 'SCORE', 200, 100).lines[0]!;
    expect(line.x).toBe(43);
    expect((line.x + 4 + line.x + 110) / 2).toBe(100);
  });

  it('AP/FC 的 4% 字距参与居中，难度名保留 -1% 字距', () => {
    const text = textOf('/Text-APFC');
    const result = layoutResultText(context(), text, 'ALL PERFECT', 300, 50);
    expect(result.spacing).toBeCloseTo(0.96);
    expect(result.lines[0]!.width).toBeCloseTo(168);
    expect(result.lines[0]!.x).toBeCloseTo(66);
    const difficulty = textOf('/DifficultyName');
    expect(layoutResultText(context(), difficulty, 'MASTER', 200, 50).spacing).toBeCloseTo(-0.32);
  });
});
