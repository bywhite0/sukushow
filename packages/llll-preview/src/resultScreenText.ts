import { hudFont, type Ctx } from './canvasKit';
import { RESULT_FONT_METRICS } from './resultScreenClip';
import type { ResultText } from './resultScreenTypes';

type RichRun = { text: string; color: readonly number[] | null };
type TextLine = { runs: RichRun[]; width: number; x: number; y: number };

function parseRichText(source: string): RichRun[] {
  const runs: RichRun[] = [];
  const re = /<color=#([0-9a-fA-F]{6})>|<\/color>/g;
  let last = 0;
  let color: readonly number[] | null = null;
  for (const m of source.matchAll(re)) {
    if (m.index > last) runs.push({ text: source.slice(last, m.index), color });
    color = m[1] ? [0, 2, 4].map((offset) => parseInt(m[1]!.slice(offset, offset + 2), 16) / 255) : null;
    last = m.index + m[0].length;
  }
  if (last < source.length) runs.push({ text: source.slice(last), color });
  return runs;
}

/**
 * TMP 的 Middle 按字体行框居中，Geometry 按可见字形居中；二者不能共用 canvas middle 基线。
 * 字体行框来自原包 FaceInfo，字形边界由同款 OTF 的 canvas 度量提供。
 */
export function layoutResultText(ctx: Ctx, text: ResultText, value: string, w: number, h: number): {
  size: number; spacing: number; lines: TextLine[];
} {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const font = RESULT_FONT_METRICS[text.font];
  const lines = value.split('\n').map((line) => {
    const runs = parseRichText(line);
    return { runs, plain: runs.map((run) => run.text).join('') };
  });
  const measure = (size: number) => {
    ctx.font = hudFont(text.font === 'EB' ? 800 : 700, size);
    ctx.letterSpacing = '0px';
    const spacing = text.characterSpacing * size * 0.01;
    const advance = font.lineHeight * size / font.pointSize + text.lineSpacing * size * 0.01;
    const metrics = lines.map(({ plain }) => {
      const m = ctx.measureText(plain);
      const extra = Math.max(0, Array.from(plain).length - 1) * spacing;
      // 有字距时逐字绘制，与 TMP 的 glyph advance 一致，避免浏览器把尾字距计入对齐。
      const width = spacing === 0 ? m.width : Array.from(plain).reduce((sum, char) => sum + ctx.measureText(char).width, extra);
      return { width, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight + extra,
        ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    });
    return { spacing, advance, metrics,
      width: Math.max(...metrics.map((m) => m.width)),
      height: (font.ascent - font.descent) * size / font.pointSize + advance * (lines.length - 1) };
  };
  let size = text.size;
  let measured = measure(size);
  if (text.autoSize) {
    // 原包允许放大到 maxSize；字号步长为 0.05，最小字号放不下时保持溢出口径。
    let lo = text.minSize;
    let hi = text.maxSize;
    const max = measure(hi);
    if (max.width <= w && max.height <= h) lo = hi;
    while (hi - lo > 0.05) {
      const mid = (lo + hi) / 2;
      const candidate = measure(mid);
      if (candidate.width <= w && candidate.height <= h) lo = mid;
      else hi = mid;
    }
    size = Math.floor(lo * 20) / 20;
    measured = measure(size);
  }
  const { spacing, advance, metrics } = measured;
  const lastOffset = advance * (lines.length - 1);
  const ascent = text.vertical === 4096
    ? Math.max(...metrics.map((m, i) => m.ascent - i * advance))
    : font.ascent * size / font.pointSize;
  const descent = text.vertical === 4096
    ? Math.max(...metrics.map((m, i) => m.descent + i * advance))
    : -font.descent * size / font.pointSize + lastOffset;
  const baseline = h / 2 + (ascent - descent) / 2;
  return { size, spacing, lines: lines.map(({ runs }, i) => {
    const m = metrics[i]!;
    const x = text.align === 1 ? 0 : text.align === 3 ? w - m.width
      : text.align === 6 ? (w + m.left - m.right) / 2 : (w - m.width) / 2;
    return { runs, width: m.width, x, y: baseline + i * advance };
  }) };
}
