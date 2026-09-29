/** SVG 输出结构测试：形状、层级、转义、贴图引用。 */

import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { decodeChartBytes } from '../src/chart';
import { defaultLayout, timeY } from '../src/layout';
import { type SpriteLibrary, renderSvg } from '../src/svg';

/** 与渲染器同一口径的数字格式（去掉浮点噪声、最多三位小数）。 */
const n3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const chartOf = (notes: unknown[]) => {
  const json = JSON.stringify({ Notes: notes, Bpms: [{ Time: 0, Bpm: 120 }] });
  return decodeChartBytes(new Uint8Array(deflateRawSync(Buffer.from(json))));
};

/** 带全部七张贴图的贴图库（URI 用占位串，只验证引用结构）。 */
const lib = (): SpriteLibrary => {
  const names = ['tap', 'hold', 'flick', 'trace'];
  const extra = ['arrow', 'icon', 'sign'];
  const rects: [number, number][] = [[128, 68], [128, 68], [128, 68], [128, 48]];
  const extraRects: [number, number][] = [[52, 50], [120, 90], [323, 250]];
  return {
    notes: names.map(n => `data:image/png;base64,${n}`),
    meta: names.map((n, i) => ({ name: n, border: [60, 0, 60, 0], rect: [0, 0, ...rects[i]], ppu: 100 })),
    extra: {
      uri: extra.map(n => `data:image/png;base64,${n}`),
      meta: extra.map((n, i) => ({ name: n, border: [0, 0, 0, 0], rect: [0, 0, ...extraRects[i]], ppu: 100 })),
    },
  };
};

const opts = (over: Record<string, unknown> = {}) => ({
  layout: { ...defaultLayout(), duration: 6 },
  showMeasures: true,
  showBeats: true,
  showSimultaneous: true,
  showGrid: true,
  showBarNumbers: false,
  background: '#0d1220',
  allowFallback: true,
  ...over,
});

/** 取某一层类名在正文里出现的次数。 */
const count = (svg: string, cls: string) => (svg.match(new RegExp(`class="${cls}"`, 'g')) ?? []).length;

describe('SVG 结构', () => {
  it('输出可被 XML 解析且根节点尺寸正确', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const { svg } = renderSvg(chart, lib(), opts());
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // 画布 60×16 + 32 = 992 宽。
    expect(svg).toContain('width="992"');
    expect(svg).toContain('viewBox="0 0 992 ');
  });

  it('defs 里每张贴图只内嵌一次，正文用 use 引用', () => {
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '2.0', holds: [], Flags: flags(0, 20, 22) },
      { Uid: 3, just: '3.0', holds: [], Flags: flags(2, 30, 32) },
    ]);
    const { svg } = renderSvg(chart, lib(), opts());
    // 四类音符 + 三层附加 = 七张，各出现一次。
    expect(svg.match(/<image id="/g) ?? []).toHaveLength(7);
    // 三次 tap 引用（两条 Single + 一次... 实际是两条）+ 一条 flick。
    expect((svg.match(/xlink:href="#sp-ui_sc2_ingame_notes_tap"/g) ?? []).length).toBeGreaterThan(0);
    // 贴图 data URI 只出现一次（在 defs 里）。
    expect((svg.match(/data:image\/png;base64,tap/g) ?? []).length).toBe(1);
  });

  it('三类线各按开关出现', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const all = renderSvg(chart, lib(), opts()).svg;
    expect(count(all, 'bar-line')).toBeGreaterThan(0);
    expect(count(all, 'beat-line')).toBeGreaterThan(0);
    expect(count(all, 'lane-line')).toBeGreaterThan(0);
    const none = renderSvg(chart, lib(), opts({ showMeasures: false, showBeats: false, showGrid: false })).svg;
    expect(count(none, 'bar-line')).toBe(0);
    expect(count(none, 'beat-line')).toBe(0);
    expect(count(none, 'lane-line')).toBe(0);
    expect(count(none, 'lane-line-major')).toBe(0);
  });

  it('轨道格线：每 5 格一条加粗线', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const { svg } = renderSvg(chart, lib(), opts());
    // 1…59 共 59 条格线，其中 5 的倍数是 11 条（5,10,…,55）。
    expect(count(svg, 'lane-line')).toBe(59 - 11);
    expect(count(svg, 'lane-line-major')).toBe(11);
    expect(count(svg, 'edge')).toBe(2);
  });

  it('Hold 每个节点两条半边，各带独立渐变', () => {
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 10, 20, 12, 22) },
    ]);
    const { svg, stats } = renderSvg(chart, lib(), opts({ aspect: 0 }));
    expect(stats.holds).toBe(4);
    expect((svg.match(/<path fill="url\(#bg/g) ?? [])).toHaveLength(4);
    expect((svg.match(/<linearGradient id="bg/g) ?? [])).toHaveLength(4);
    // 渐变用 userSpaceOnUse，端点随几何走。
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
  });

  it('Hold 端头与本体都用九宫格三段', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) }]);
    const { svg } = renderSvg(chart, lib(), opts());
    // 一条链：头、尾两个端头，加本体是宽带（path），端头用 hold 贴图。
    expect((svg.match(/xlink:href="#sp-ui_sc2_ingame_notes_hold"/g) ?? []).length).toBeGreaterThan(0);
    // 九宫格用嵌套 svg + viewBox 裁剪。
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('viewBox="0 0 60 68"');
  });

  it('Flick 画箭头、Symbol、Sign 三层', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]);
    const { svg } = renderSvg(chart, lib(), opts());
    expect(svg).toContain('#sp-ui_sc2_ingame_notes_texture_arrow');
    expect(svg).toContain('#sp-ui_sc2_ingame_notes_icon_flick');
    expect(svg).toContain('#sp-ui_sc2_ingame_flick_sign');
  });

  it('Flick 箭头右侧那块水平翻转', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]);
    const { svg } = renderSvg(chart, lib(), opts());
    // 镜像用 translate(2cx,0) scale(-1,1)。
    expect(svg).toMatch(/transform="translate\([-\d.]+,\s*0\) scale\(-1,1\)"/);
  });

  it('同时押连线连到最左与最右', () => {
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '1.0', holds: [], Flags: flags(0, 40, 42) },
    ]);
    const { svg, stats } = renderSvg(chart, lib(), opts());
    expect(stats.simultaneous).toBe(1);
    expect(count(svg, 'simul')).toBe(1);
    // 关闭后不出现。
    expect(count(renderSvg(chart, lib(), opts({ showSimultaneous: false })).svg, 'simul')).toBe(0);
  });

  it('透明背景时不画底色', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    expect(count(renderSvg(chart, lib(), opts({ background: null })).svg, 'bg')).toBe(0);
    expect(count(renderSvg(chart, lib(), opts()).svg, 'bg')).toBe(1);
  });

  it('缺贴图时退回纯色矩形并可关闭', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const bare: SpriteLibrary = { notes: [], meta: [], extra: { uri: [], meta: [] } };
    const withFallback = renderSvg(chart, bare, opts()).svg;
    expect(withFallback).toContain('#ff5eab');
    const noFallback = renderSvg(chart, bare, opts({ allowFallback: false })).svg;
    expect(noFallback).not.toContain('#ff5eab');
  });

  it('统计数对上谱面', () => {
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 20, 25, 20, 25) },
      { Uid: 3, just: '4.0', holds: [], Flags: flags(2, 30, 32) },
      { Uid: 4, just: '5.0', holds: [], Flags: flags(3, 40, 50) },
    ]);
    const { stats } = renderSvg(chart, lib(), opts());
    expect(stats.notes).toBe(4);
    expect(stats.instants).toBe(3);
    expect(stats.holds).toBe(2);
    expect(stats.fallback).toBe(0);
  });

  it('画布高度随谱面时长走，时长以谱面为准', () => {
    const chart = chartOf([{ Uid: 1, just: '100.0', holds: [], Flags: flags(0, 10, 12) }]);
    // 传入的 duration 故意写错，渲染器应以谱面为准。
    const { svg, stats } = renderSvg(chart, lib(), opts({ aspect: 0, layout: { ...defaultLayout(), duration: 2 } }));
    expect(stats.instants).toBe(1);
    const h = 16 * 2 + chart.duration * defaultLayout().pxPerSec;
    expect(svg).toContain(`height="${Math.round(h)}"`);
  });

  it('追加样式表排在内置样式之后', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const { svg } = renderSvg(chart, lib(), opts({ extraCss: '.bg{fill:#123456}' }));
    const builtin = svg.indexOf('.bg{fill:#0d1220}');
    const extra = svg.indexOf('.bg{fill:#123456}');
    expect(builtin).toBeGreaterThan(-1);
    expect(extra).toBeGreaterThan(builtin);
  });

  it('背景色可改', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const { svg } = renderSvg(chart, lib(), opts({ extraCss: '.bg{fill:#222}' }));
    expect(svg).toContain('.bg{fill:#222}');
  });

  it('小节号标注在轨道栏左侧', () => {
    const chart = chartOf([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    const { svg } = renderSvg(chart, lib(), opts({ showBarNumbers: true }));
    expect(count(svg, 'bar-text')).toBeGreaterThan(0);
    expect(svg).toContain('>1</text>');
    expect(count(renderSvg(chart, lib(), opts()).svg, 'bar-text')).toBe(0);
  });

  it('时间段渲染：画布裁到该段，窗外元素被剔除', () => {
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '40.0', holds: [], Flags: flags(0, 20, 22) },
    ]);
    const full = renderSvg(chart, lib(), opts()).svg;
    const range = { from: 38, to: 41 };
    const part = renderSvg(chart, lib(), opts({ range })).svg;
    // 画布高 = 段长 × pxPerSec + 上下留白。
    const h = (range.to - range.from) * defaultLayout().pxPerSec + 16 * 2;
    expect(part).toContain(`height="${Math.round(h)}"`);
    // 窗口内的音符留下，窗口外的去掉。
    expect(part).toContain('#sp-ui_sc2_ingame_notes_tap');
    expect(part).not.toContain('#sp-ui_sc2_ingame_notes_flick');
    // 局部图必须比整谱图小得多。
    expect(part.length).toBeLessThan(full.length);
    // 坐标口径不变：窗口上沿就是「to 时刻再往上留一个 padY」。
    const lay = { ...defaultLayout(), duration: chart.duration };
    expect(part).toContain(`viewBox="0 ${n3(timeY(range.to, lay) - 16)} `);
  });

  it('横穿窗口的长 Hold 不被剔除', () => {
    // 一条从 1 秒到 39 秒的 Hold，窗口只取中间 20–22 秒。
    const chart = chartOf([
      { Uid: 1, just: '1.0', holds: ['39.0'], Flags: flags(1, 10, 20, 10, 20) },
    ]);
    const part = renderSvg(chart, lib(), opts({ range: { from: 20, to: 22 } })).svg;
    expect(part).toContain('<path fill="url(#bg0)"');
  });
});

describe('分列', () => {
  /** 造一段够长的谱面：每 0.5 秒一个音符，共 60 秒。 */
  const longChart = (seconds = 60) => {
    const notes: unknown[] = [];
    for (let i = 0; i < seconds * 2; i++) {
      notes.push({ Uid: i + 1, just: String(i * 0.5), holds: [], Flags: flags(0, 10, 12) });
    }
    const json = JSON.stringify({ Notes: notes, Bpms: [{ Time: 0, Bpm: 120 }] });
    return decodeChartBytes(new Uint8Array(deflateRawSync(Buffer.from(json))));
  };

  it('默认按长宽比切列，出横版', () => {
    const chart = longChart(60);
    const { svg, stats } = renderSvg(chart, lib(), opts());
    // 参考仓库的输出是 5520×2337 ≈ 2.36:1 横版。
    expect(stats.columns).toBeGreaterThan(1);
    const w = Number(svg.match(/width="([\d.]+)"/)![1]);
    const h = Number(svg.match(/height="([\d.]+)"/)![1]);
    expect(w / h).toBeGreaterThan(2.0);
    expect(w / h).toBeLessThan(3.0);
  });

  it('aspect 为 0 时出一张单列长图', () => {
    const chart = longChart(20);
    const { svg, stats } = renderSvg(chart, lib(), opts({ aspect: 0 }));
    expect(stats.columns).toBe(1);
    // 单列时不标列号。
    expect(count(svg, 'col-text')).toBe(0);
  });

  it('指定每列上限时按上限切，横向并排、底边对齐', () => {
    const chart = longChart(60);
    const lay = { ...defaultLayout(), duration: chart.duration };
    // 上限 = 10 秒高；列数 = ceil(总时长 / 每列上限)。
    const maxH = 10 * lay.pxPerSec;
    const expectCols = Math.ceil(chart.duration / 10);
    const { svg, stats } = renderSvg(chart, lib(), opts({ maxColumnHeight: maxH, showColumnLabels: false }));
    expect(stats.columns).toBe(expectCols);
    // 根画布宽 = 列数 × 列宽 + 列间距。
    expect(svg).toContain(`width="${expectCols * 992 + (expectCols - 1) * 8}"`);
    // 每列一条左边界线、一条右边界线。
    expect(count(svg, 'edge')).toBe(expectCols * 2);
    // 各列底边对齐：顶层列 svg 的 y + height 都等于根画布高。
    const rootH = Number(svg.match(/height="([\d.]+)"/)![1]);
    const cols = [...svg.matchAll(/<svg class="col" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="0 /g)];
    expect(cols.length).toBe(expectCols);
    for (const c of cols) {
      expect(Number(c[2]) + Number(c[4])).toBeCloseTo(rootH, 0);
    }
  });

  it('切列后每列都不超过上限', () => {
    const chart = longChart(60);
    const lay = { ...defaultLayout(), duration: chart.duration };
    const maxH = 10 * lay.pxPerSec;
    const { svg } = renderSvg(chart, lib(), opts({ maxColumnHeight: maxH, showColumnLabels: false }));
    const cols = [...svg.matchAll(/<svg class="col" x="[\d.]+" y="[\d.]+" width="[\d.]+" height="([\d.]+)" viewBox="0 /g)];
    for (const c of cols) expect(Number(c[1])).toBeLessThanOrEqual(maxH + 1);
  });

  it('音符总数不因切列而翻倍', () => {
    const chart = longChart(60);
    const one = renderSvg(chart, lib(), opts({ aspect: 0 })).stats;
    const many = renderSvg(chart, lib(), opts()).stats;
    expect(many.notes).toBe(one.notes);
    expect(many.instants).toBe(one.instants);
  });

  it('切列后标出列号与时间范围', () => {
    const chart = longChart(60);
    const { svg, stats } = renderSvg(chart, lib(), opts());
    const cols = stats.columns;
    expect(count(svg, 'col-text')).toBe(cols);
    expect(svg).toContain(`>1 / ${cols}</text>`);
    expect(svg).toContain(`>${cols} / ${cols}</text>`);
    // 标签在独立表头横带里，位于各列之上（不与列重叠）。
    const labelY = Number(svg.match(/<text class="col-text"[^>]*y="([\d.]+)"/)![1]);
    const colY = Number(svg.match(/<svg class="col"[^>]*y="([\d.]+)"/)![1]);
    expect(labelY).toBeLessThan(colY);
    // 时间范围标注。
    expect(svg).toContain('0s – ');
    expect(svg).toContain(`– ${n3(chart.duration)}s`);
  });
});
