/**
 * SVG 生成：把一份谱面画成矢量图。
 *
 * 结构照参考仓库 pjsekai-scores-rs 的做法——`defs` 里放一次 CSS 与贴图，正文按层铺开。
 * 时间轴向上（0 秒在内容底部），与游戏下落式朝向一致。
 *
 * 分层（自下而上）：
 *   背景 → 轨道栏 → 轨道格线 → 小节线 → 拍线 → 同时押连线
 *   → Hold 宽带 → Hold 端头 → 音符本体 → Flick 附加元素
 *
 * 长曲不出一张超长图：按**小节边界**切成多列，各列是嵌套 `<svg>`，横向并排、**底边对齐**
 * （参考仓库同此做法）。切列只改版式不改坐标：每列的 `viewBox` 各自开窗，
 * 跨列的长 Hold 在两侧各自被裁一次，并排看起来仍是连续的。
 */

import type { Chart, Note } from '@sukushow/chart/chart';
import type { FeverWindow } from '@sukushow/chart/fever';
import {
  type Layout, LANES, canvasWidth, edgeX, measures, noteSpan, timeY, trackWidth,
} from './layout';
import {
  type BandHalf, type FlickOverlay, type SpriteMeta,
  FLICK_ARROW, FLICK_ICON, FLICK_SIGN, NOTE_SPRITE, SPRITE_SCALE_X,
  bandHalves, cssRgba, flickOverlays, laneX, noteDepthWorld, noteWidthWorld, pxPerWorld, sliceCaps,
} from './geometry';

/** 未提供贴图时的兜底配色，沿用原版四类音符的观感。 */
const FALLBACK: readonly string[] = ['#ff5eab', '#2ec6ff', '#ff5eab', '#54d6ef'];

/** Flick 附加元素的顺序：箭头、Symbol、Sign。 */
export const FLICK_EXTRA = [FLICK_ARROW, FLICK_ICON, FLICK_SIGN] as const;

/** 贴图库：音符四类 + Flick 附加三层。`uri` 是 data URI（自包含）或外部路径。 */
export interface SpriteLibrary {
  /** 索引 = Note.type 的贴图 URI。 */
  notes: (string | undefined)[];
  /** 索引 = Note.type 的九宫格元数据。 */
  meta: (SpriteMeta | undefined)[];
  /** Flick 附加元素，顺序 = FLICK_EXTRA。 */
  extra: { uri: (string | undefined)[]; meta: (SpriteMeta | undefined)[] };
}

export const emptyLibrary = (): SpriteLibrary => ({
  notes: [], meta: [], extra: { uri: [], meta: [] },
});

export interface SvgOptions {
  layout: Layout;
  /** 是否画小节线。 */
  showMeasures: boolean;
  /** 是否画拍线（小节内的细分）。 */
  showBeats: boolean;
  /** 是否画同时押连线。 */
  showSimultaneous: boolean;
  /** 是否画轨道格线。 */
  showGrid: boolean;
  /** 是否标小节号。 */
  showBarNumbers: boolean;
  /** 背景色；`null` 表示透明。 */
  background: string | null;
  /** 外部样式表内容，追加在内置样式之后。 */
  extraCss?: string;
  /** 音符贴图缺失时是否退回纯色矩形。 */
  allowFallback: boolean;
  /**
   * 只渲染这段时间（秒）。坐标口径不变，只是窗口落在这一段上。
   */
  range?: { from: number; to: number };
  /**
   * 每列最大像素高；超过就切列并排。
   *
   * 0 或省略 = 按 `aspect` 定列数（默认）。切列只改版式不改坐标。
   */
  maxColumnHeight?: number;
  /**
   * 目标长宽比（宽 / 高），按它反推列数。
   *
   * 默认 2.4——参考仓库 `pjsekai-scores-rs` 的输出是 5520×2337，就是这个比例。
   * 长曲横铺成横版才像它；只切几列会得到一张竖长条。`maxColumnHeight` 有值时以它为准。
   */
  aspect?: number;
  /** 列间距（像素）。 */
  columnGap?: number;
  /**
   * 切列时是否给每列标上序号与时间范围。
   *
   * 切列必然会在列边界切断长 Hold——同一根带子左列顶端一截、右列底端一截，
   * 不标出来读谱时会误以为是两个音符。默认开。
   */
  showColumnLabels?: boolean;
  /**
   * 轨道左侧的侧栏：小节号、BPM、拍号、Fever 区。
   *
   * 参考仓库 `pjsekai-scores-rs` 就把这些竖排在轨道两侧。侧栏宽由 `sideWidth` 定，
   * 关掉时成图宽度不变（侧栏本来就画在留白里），所以默认开。
   */
  side?: SidePanel;
  /**
   * 底部信息区（封面 + 曲名 + 难度）。
   *
   * 参考仓库把它放在图片**底部**，不是侧栏里——见 `MetaPanel`。
   */
  meta?: MetaPanel;
}

/** 侧栏内容。全部为可选——缺哪项就不画哪项。 */
export interface SidePanel {
  /** 侧栏宽度（像素）。默认 96。 */
  width?: number;
  /** 每小节标 `#序号`（1 起）。 */
  barNumbers?: boolean;
  /** BPM 变化处标 `BPM n`。 */
  bpm?: boolean;
  /** 拍号变化处标 `n/4`。 */
  beats?: boolean;
  /** Fever 时段：底色带 + `FEVER` 文字。 */
  fever?: FeverWindow | null;
  /** 谱面标题等信息，画在侧栏顶部的信息块里。 */
  info?: string[];
}

/**
 * 底部信息区——照参考仓库 `pjsekai-scores-rs` 的做法：**图片底部一条横带**，
 * 左边一张方形封面，右边两行文字（曲名 / 难度与等级）。
 *
 * 参考仓库的算法（`drawing.rs`）：画布总高 = 谱面段高 + `time_padding×2` + `meta_size`
 * + `time_padding×2`，其中 `meta_size = 192`；封面是 `meta_size` 见方，左上角落在
 * `(lane_padding×2, max_height + time_padding×3)`。
 */
export interface MetaPanel {
  /** 曲名（第一行）。 */
  title?: string;
  /** 副标题（第二行，通常放难度与等级）。 */
  subtitle?: string;
  /**
   * 封面图（data URI 或链接）。
   *
   * 曲绘源包是 `image_music_thumbnail_<id>.assetbundle`，需解包后取 PNG。
   */
  jacket?: string;
  /** 封面边长（像素），默认 192（同参考仓库的 `meta_size`）。 */
  size?: number;
}

/** 渲染统计，便于脚本与测试自检。 */
export interface RenderStats {
  /** 画出的音符数（去重，含 Hold 链节点；不出面的零长节点也计入）。 */
  notes: number;
  /** 瞬时音符数（去重）。 */
  instants: number;
  /** Hold 宽带半边数（**绘制次数**，跨列的长带会在两侧各计一次）。 */
  holds: number;
  /** 小节线数（绘制次数）。 */
  bars: number;
  /** 拍线数（绘制次数）。 */
  beats: number;
  /** 同时押连线数（绘制次数）。 */
  simultaneous: number;
  /** 用了兜底配色的音符数（贴图缺失）。 */
  fallback: number;
  /** 是否画出了 Fever 区。 */
  fever: boolean;
  /** 列数。 */
  columns: number;
  /** 列宽（像素）。 */
  columnWidth: number;
  /** 列高（像素，取各列最大者）。 */
  columnHeight: number;
}

/** XML 文本转义。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 数字格式化：去掉浮点噪声，最多三位小数。 */
function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * 内置样式表。类名沿用参考仓库那一套（`bar-line` / `beat-line` / `lane-line` …），
 * 配色按本仓库的平面图定。
 */
const DEFAULT_CSS = [
  '.bg{fill:#0d1220}',
  '.lane{fill:#111a2b}',
  '.edge{stroke:#54d6ef;stroke-opacity:.55;stroke-width:1.5}',
  '.lane-line{stroke:#dbe1ec;stroke-opacity:.10;stroke-width:1}',
  '.lane-line-major{stroke:#dbe1ec;stroke-opacity:.24;stroke-width:1}',
  '.bar-line{stroke:#ed5eaa;stroke-opacity:.55;stroke-width:1.5}',
  '.beat-line{stroke:#dbe1ec;stroke-opacity:.20;stroke-width:1}',
  '.simul{stroke:#d8f0ff;stroke-opacity:.55;stroke-width:1.5}',
  '.bar-text{font:11px/1 "Segoe UI",system-ui,sans-serif;fill:#ed5eaa;fill-opacity:.8}',
  '.col-text{font:bold 15px/1 "Segoe UI",system-ui,sans-serif;fill:#dbe1ec;fill-opacity:.85}',
  '.col-sub{font:11px/1 "Segoe UI",system-ui,sans-serif;fill:#dbe1ec;fill-opacity:.5}',
  // 侧栏
  '.side-bg{fill:#121a2c}',
  '.side-bar{font:10px/1 "Segoe UI",system-ui,sans-serif;fill:#8fa3c0}',
  '.side-bpm{font:bold 11px/1 "Segoe UI",system-ui,sans-serif;fill:#ffd166}',
  '.side-beat{font:10px/1 "Segoe UI",system-ui,sans-serif;fill:#8fa3c0;fill-opacity:.75}',
  '.side-fever{font:bold 11px/1 "Segoe UI",system-ui,sans-serif;fill:#ff6bd6}',
  '.fever-band{fill:#ff3fb4;fill-opacity:.16}',
  '.fever-edge{stroke:#ff6bd6;stroke-opacity:.75;stroke-width:1.5;stroke-dasharray:4 3}',
  '.side-tick{stroke:#8fa3c0;stroke-opacity:.5;stroke-width:1}',
  // 底部信息区（照参考仓库：meta 底色 + 分隔线 + 曲名 / 副标题）
  // 字号不写死在类里——它由封面边长派生（标题 = size/2、副标题 = size/4，
  // 见 metaPanel），这样 `--meta-size` 一改，文字跟着封面一起缩放。
  '.meta{fill:#0f1626}',
  '.meta-line{stroke:#2a3a55;stroke-width:1}',
  '.meta-title{font-family:"Segoe UI",system-ui,sans-serif;font-weight:900;fill:#e8eefc}',
  '.meta-sub{font-family:"Segoe UI",system-ui,sans-serif;font-weight:700;fill:#9fb0cc}',
  '.meta-frame{fill:none;stroke:#2a3a55;stroke-width:1}',
].join('\n');

export interface Column { from: number; to: number }

/**
 * 切列的最小门槛：内容高不到「列宽 × 这个系数」就不切。
 *
 * 横版的目标比例是 2.4:1，按 `N = √(aspect·H/W)` 算，`H < 2.4·W` 时 N 会落到 1.5 以下、
 * 四舍五入成 2——把一张 3 秒的短谱拆成两栏，每栏才一个音符。这种「短谱」本来就不该切，
 * 系数取 2.4 与目标比例一致。
 */
const MIN_SPLIT_FACTOR = 2.4;

/**
 * 切列方式。
 *
 * - `aspect`：按目标长宽比定列数。**默认**——参考仓库的输出是 5520×2337（约 2.4:1 横版），
 *   整谱定尺出图若只切几列会得到一张竖长条，比例上并不像它。
 * - `height`：按每列最大像素高定列数。
 * - `bars`：每列固定小节数——参考仓库 `sentence_length = 4` 的直译。
 */
export type ColumnMode =
  | { kind: 'aspect'; aspect: number }
  | { kind: 'height'; maxHeight: number }
  | { kind: 'bars'; bars: number };

/** 小节边界（含首尾）。 */
function barBounds(chart: Chart, from: number, to: number): number[] {
  const cuts: number[] = [];
  for (const m of measures(chart)) {
    if (m.time > from + 1e-6 && m.time < to - 1e-6) cuts.push(m.time);
  }
  cuts.sort((a, b) => a - b);
  return [from, ...cuts, to];
}

/**
 * 切列。
 *
 * 定列数后按**时间等分**，下刀点吸附到最近的小节边界（限幅 20% 列长）。
 *
 * 为什么不直接按边界等分：小节长度本身就不均匀（BPM 段多时尤其明显），硬在边界上
 * 凑等分会切出高矮悬殊的列（实测出现过 7384 / 700 / 14842 这种分布）。时间等分保证
 * 各列高矮相近，吸附只是让刀口落在小节线上好看一点——宁可刀口不落边界，也不要列高失衡。
 */
export function splitColumns(
  chart: Chart, lay: Layout, from: number, to: number,
  colW: number, gap: number, mode: ColumnMode,
): Column[] {
  const bounds = barBounds(chart, from, to);
  const totalTime = to - from;
  const totalH = totalTime * lay.pxPerSec;

  if (mode.kind === 'bars') {
    const n = Math.max(1, Math.round(mode.bars));
    const out: Column[] = [];
    for (let i = 0; i < bounds.length - 1; i += n) {
      out.push({ from: bounds[i], to: bounds[Math.min(i + n, bounds.length - 1)] });
    }
    return out;
  }

  if (!(totalH > 0)) return [{ from, to }];
  // 短谱不切列：单列本来就不是细高条，切了反而把 3 秒的谱拆成两栏。
  // 判据取「内容高是否达到列宽的数倍」——达不到就说明整谱一张图放得下。
  if (totalH < colW * MIN_SPLIT_FACTOR) return [{ from, to }];
  // 上限指「最终图片高」，故扣掉每列上下各一份 padY。
  const maxTime = mode.kind === 'height'
    ? Math.max(1e-6, (mode.maxHeight - lay.padY * 2) / lay.pxPerSec)
    : Infinity;
  const count = mode.kind === 'height'
    ? Math.max(1, Math.ceil(totalTime / maxTime - 1e-9))
    // 画布宽 ≈ N·(colW + gap)、高 = totalH / N；令 宽/高 = aspect 解 N。
    : Math.max(1, Math.round(Math.sqrt(Math.max(0.1, mode.aspect) * totalH / Math.max(1, colW + gap))));
  if (count <= 1) return [{ from, to }];

  const step = totalTime / count;
  const snapLimit = step * 0.2;
  const snapped: number[] = [];
  for (let c = 0; c < count - 1; c++) {
    const ideal = from + step * (c + 1);
    let best = ideal, bestDist = Infinity;
    for (const cut of bounds) {
      const dist = Math.abs(cut - ideal);
      if (dist > snapLimit || dist >= bestDist) continue;
      if ((cut - from) > step * (c + 1) + snapLimit) continue;
      bestDist = dist; best = cut;
    }
    snapped.push(best);
  }

  // 逐列校验：吸附后哪一列超限，就把那一刀退回等分位置（等分必然不超限）。
  // 每改一刀都要重算边界——否则相邻两列同时超限时，第二列的起点还是旧值。
  const cuts2 = [...snapped];
  if (Number.isFinite(maxTime)) {
    for (let pass = 0; pass < count; pass++) {
      const b = [from, ...cuts2, to];
      let bad = -1;
      for (let c = 0; c < b.length - 1; c++) {
        if ((b[c + 1] - b[c]) > maxTime) { bad = c; break; }
      }
      if (bad < 0) break;
      if (bad < cuts2.length) cuts2[bad] = from + step * (bad + 1);
      else cuts2[bad - 1] = to - step;
    }
  }

  const out: Column[] = [];
  let start = from;
  for (const cut of [...cuts2, to]) {
    out.push({ from: start, to: cut });
    start = cut;
  }
  return out;
}

/** 生成一张谱面 SVG。 */
export function renderSvg(chart: Chart, lib: SpriteLibrary, opt: SvgOptions): { svg: string; stats: RenderStats } {
  // 时长以谱面为准：时间轴靠它把 0 秒锚在内容底部，让调用方另行同步是个脚枪。
  const sideOn = !!opt.side;
  const lay: Layout = {
    ...opt.layout,
    duration: chart.duration,
    sideWidth: sideOn ? (opt.side?.width ?? 96) : 0,
  };
  const colW = canvasWidth(lay);

  const stats: RenderStats = {
    notes: 0, instants: 0, holds: 0, bars: 0, beats: 0, simultaneous: 0, fallback: 0, fever: false,
    columns: 0, columnWidth: colW, columnHeight: 0,
  };
  // 音符数按 Uid 去重：跨列的长带会被画两次，但「谱面里有多少音符」不该跟着翻倍。
  const countedNotes = new Set<number>();
  const countedInstants = new Set<number>();

  // ── 贴图入库：每张只内嵌一次，正文用 <use> 引用 ──────────────────────
  const symbols: string[] = [];
  const symbolId = (name: string) => `sp-${name}`;
  for (let t = 0; t < 4; t++) {
    const uri = lib.notes[t], m = lib.meta[t];
    if (!uri || !m) continue;
    symbols.push(`<image id="${symbolId(NOTE_SPRITE[t])}" xlink:href="${esc(uri)}" width="${n(m.rect[2])}" height="${n(m.rect[3])}"/>`);
  }
  for (let i = 0; i < FLICK_EXTRA.length; i++) {
    const uri = lib.extra.uri[i], m = lib.extra.meta[i];
    if (!uri || !m) continue;
    symbols.push(`<image id="${symbolId(FLICK_EXTRA[i])}" xlink:href="${esc(uri)}" width="${n(m.rect[2])}" height="${n(m.rect[3])}"/>`);
  }

  // ── 切列 ──────────────────────────────────────────────────────────────
  const winFrom = opt.range ? opt.range.from : 0;
  const winTo = opt.range ? opt.range.to : chart.duration;
  const maxCol = opt.maxColumnHeight ?? 0;
  const gap = opt.columnGap ?? 8;
  // 默认按长宽比定列数：参考仓库的输出是横版，只切几列会得到竖长条。
  const mode: ColumnMode = maxCol > 0
    ? { kind: 'height', maxHeight: maxCol }
    : opt.aspect === 0
      ? { kind: 'bars', bars: Number.POSITIVE_INFINITY }
      : { kind: 'aspect', aspect: opt.aspect ?? 2.4 };
  const columns: Column[] = mode.kind === 'bars' && !Number.isFinite(mode.bars)
    ? [{ from: winFrom, to: winTo }]
    : splitColumns(chart, lay, winFrom, winTo, colW, gap, mode);
  stats.columns = columns.length;

  const bars = measures(chart);
  const grads: string[] = [];
  const rendered: { body: string; yTop: number; h: number }[] = [];

  for (const col of columns) {
    // 这一列的 viewBox 窗口：上下各留一个 padY。
    const yTop = timeY(col.to, lay) - lay.padY;
    const yBottom = timeY(col.from, lay) + lay.padY;
    const h = yBottom - yTop;
    // 剔除窗外元素；上下各放宽 200px，免得贴在边上的装饰被误裁。
    const cullTop = yTop - 200, cullBottom = yBottom + 200;
    const visible = (y: number) => y >= cullTop && y <= cullBottom;
    const overlaps = (a: number, b: number) => Math.max(a, b) >= cullTop && Math.min(a, b) <= cullBottom;

    const body: string[] = [];
    const trackW = trackWidth(lay);

    // 背景与轨道栏。
    if (opt.background) body.push(`<rect class="bg" x="0" y="${n(yTop)}" width="${n(colW)}" height="${n(h)}"/>`);
    body.push(`<rect class="lane" x="${n(lay.padX + lay.sideWidth)}" y="${n(yTop)}" width="${n(trackW)}" height="${n(h)}"/>`);

    // Fever 底色带——画在音符之下，只铺轨道栏，免得盖住侧栏文字。
    const fv = opt.side?.fever;
    if (fv && fv.end > fv.start) {
      const yA = timeY(fv.end, lay), yB = timeY(fv.start, lay);
      if (overlaps(yA, yB)) {
        const top = Math.max(yA, yTop), bot = Math.min(yB, yBottom);
        body.push(`<rect class="fever-band" x="${n(lay.padX + lay.sideWidth)}" y="${n(top)}" width="${n(trackW)}" height="${n(bot - top)}"/>`);
        // 上下两条虚线边，让区间端点看得见。
        for (const y of [yA, yB]) {
          if (!visible(y)) continue;
          body.push(`<line class="fever-edge" x1="${n(lay.padX + lay.sideWidth)}" y1="${n(y)}" x2="${n(lay.padX + lay.sideWidth + trackW)}" y2="${n(y)}"/>`);
        }
        stats.fever = true;
      }
    }

    // 轨道格线。
    if (opt.showGrid) {
      for (let lane = 1; lane < LANES; lane++) {
        const x = edgeX(lane, lay);
        const cls = lane % 5 === 0 ? 'lane-line-major' : 'lane-line';
        body.push(`<line class="${cls}" x1="${n(x)}" y1="${n(yTop)}" x2="${n(x)}" y2="${n(yBottom)}"/>`);
      }
    }
    for (const edge of [0, LANES]) {
      const x = edgeX(edge, lay);
      body.push(`<line class="edge" x1="${n(x)}" y1="${n(yTop)}" x2="${n(x)}" y2="${n(yBottom)}"/>`);
    }

    // 小节线与拍线。
    if (opt.showMeasures) {
      for (const m of bars) {
        const y = timeY(m.time, lay);
        if (!visible(y)) continue;
        body.push(`<line class="bar-line" x1="${n(lay.padX + lay.sideWidth)}" y1="${n(y)}" x2="${n(lay.padX + lay.sideWidth + trackW)}" y2="${n(y)}"/>`);
        stats.bars++;
      }
    }
    if (opt.showBarNumbers) {
      for (let i = 0; i < bars.length; i++) {
        const y = timeY(bars[i].time, lay);
        if (!visible(y)) continue;
        body.push(`<text class="bar-text" x="${n(lay.padX + lay.sideWidth + 3)}" y="${n(y - 3)}">${i + 1}</text>`);
      }
    }
    if (opt.showBeats) {
      for (let i = 0; i < bars.length; i++) {
        const t0 = bars[i].time;
        const t1 = i + 1 < bars.length ? bars[i + 1].time : chart.duration;
        const span = t1 - t0;
        const per = beatsPerBar(chart, t0);
        if (!(span > 0) || per <= 1) continue;
        for (let b = 1; b < per; b++) {
          const y = timeY(t0 + (span / per) * b, lay);
          if (!visible(y)) continue;
          body.push(`<line class="beat-line" x1="${n(lay.padX + lay.sideWidth)}" y1="${n(y)}" x2="${n(lay.padX + lay.sideWidth + trackW)}" y2="${n(y)}"/>`);
          stats.beats++;
        }
      }
    }

    // ── 侧栏：小节号 / BPM / 拍号 / Fever ────────────────────────────────
    if (sideOn) body.push(sidePanel(opt.side!, chart, bars, lay, yTop, yBottom, rendered.length === 0));

    // 同时押连线。
    if (opt.showSimultaneous) {
      for (const line of chart.lines) {
        const y = timeY(line.time, lay);
        if (!visible(y)) continue;
        let min = Infinity, max = -Infinity;
        for (const p of line.points) {
          const [a, b] = noteSpan(p.note, lay, p.tail);
          if (a < min) min = a;
          if (b > max) max = b;
        }
        if (!(max > min)) continue;
        body.push(`<line class="simul" x1="${n(min)}" y1="${n(y)}" x2="${n(max)}" y2="${n(y)}"/>`);
        stats.simultaneous++;
      }
    }

    // ── Hold 宽带与端头 ────────────────────────────────────────────────
    // 原版 `HoldMeshView.ProcessView`（4.12.0 `0x4AECEB0`）从传入 unit 起顺 `Next` 逐段写网格、
    // 不按 Uid 去重，而视图由 `NoteResolver` 逐 unit 发放：串链允许汇合时，共用段被每条链各画一遍、
    // 端头也各按自己的链首链尾画。此处照此口径，不做去重。
    for (const root of chart.roots) {
      if (root.type !== 1) continue;
      let node: Note | undefined = root, tail: Note = root;
      while (node) {
        const y0 = timeY(node.time, lay), y1 = timeY(node.end, lay);
        // 区间重叠而非两端都在窗内——长带可能两端都在窗外却横穿画面。
        if (overlaps(y0, y1)) {
          // 零长节点没有纵向跨度，不出面，但仍是谱面里的一个音符。
          const halves = node.end > node.time ? bandHalves(node, lay) : [];
          for (const half of halves) {
            const { def, path } = bandElement(half, grads.length);
            grads.push(def);
            body.push(path);
            stats.holds++;
          }
          if (!countedNotes.has(node.uid)) { countedNotes.add(node.uid); stats.notes++; }
        }
        tail = node;
        node = node.next;
      }
      // 端头按「整条链的首尾」画；切列时两端各归自己那一列。
      if (visible(timeY(root.time, lay))) body.push(capElement(root.time, root.l, root.r, lay, lib));
      if (visible(timeY(tail.end, lay))) body.push(capElement(tail.end, tail.l2, tail.r2, lay, lib));
    }

    // ── 瞬时音符与 Flick 附加元素 ──────────────────────────────────────
    for (let type = 0; type < 4; type++) {
      if (type === 1) continue;
      const uri = lib.notes[type], m = lib.meta[type];
      for (const note of chart.notes) {
        if (note.type !== type || note.prev) continue;
        const [x0, x1] = noteSpan(note, lay, false);
        const y = timeY(note.time, lay);
        if (!visible(y)) continue;
        if (uri && m) {
          body.push(slicedImage(symbolId(NOTE_SPRITE[type]), m, (x0 + x1) / 2, y, note.r - note.l + 1, type, lay));
        } else if (opt.allowFallback) {
          const hh = Math.max(2, noteDepthWorld(type) * SPRITE_SCALE_X * pxPerWorld(lay));
          body.push(`<rect x="${n(x0)}" y="${n(y - hh / 2)}" width="${n(Math.max(1, x1 - x0))}" height="${n(hh)}" fill="${FALLBACK[type]}"/>`);
          stats.fallback++;
        } else {
          continue;
        }
        // Flick 的三层附加元素画在本体之上（原版 sortingOrder 21 / 25）。
        if (type === 2) {
          const overlays = flickOverlays(note, lay, {
            arrow: lib.extra.meta[0], icon: lib.extra.meta[1], sign: lib.extra.meta[2],
          });
          for (const o of overlays) body.push(flickElement(o, lib));
        }
        if (!countedNotes.has(note.uid)) { countedNotes.add(note.uid); stats.notes++; }
        if (!countedInstants.has(note.uid)) { countedInstants.add(note.uid); stats.instants++; }
      }
    }

    rendered.push({ body: body.join(''), yTop, h });
  }

  // ── 组装 ──────────────────────────────────────────────────────────────
  const css = opt.extraCss ? `${DEFAULT_CSS}\n${opt.extraCss}` : DEFAULT_CSS;
  const maxH = Math.max(...rendered.map(r => r.h));
  const totalW = rendered.length * colW + (rendered.length - 1) * gap;
  // 列号表头占一条独立横带——各列高矮不同，标签跟着列顶走会散落在不同高度，读起来乱。
  const label = opt.showColumnLabels !== false && rendered.length > 1;
  const headerH = label ? 26 : 0;
  const bodyTop = headerH;
  stats.columnHeight = maxH + headerH;

  const parts: string[] = [];
  if (label) {
    parts.push(`<rect class="bg" x="0" y="0" width="${n(totalW)}" height="${n(headerH)}"/>`);
  }
  for (let i = 0; i < rendered.length; i++) {
    const r = rendered[i];
    const x = i * (colW + gap);
    // 底边对齐：各列时间范围的起点落在同一条基线上（参考仓库同此）。
    const y = bodyTop + (maxH - r.h);
    if (label) {
      const c = columns[i];
      parts.push(
        `<text class="col-text" x="${n(x + lay.padX)}" y="${n(headerH - 8)}">${i + 1} / ${rendered.length}</text>`
        + `<text class="col-sub" x="${n(x + lay.padX + 52)}" y="${n(headerH - 8)}">${n(c.from)}s – ${n(c.to)}s</text>`,
      );
    }
    parts.push(
      `<svg class="col" x="${n(x)}" y="${n(y)}" width="${n(colW)}" height="${n(r.h)}"`
      + ` viewBox="0 ${n(r.yTop)} ${n(colW)} ${n(r.h)}">${r.body}</svg>`,
    );
  }

  // 底部信息区：参考仓库把它放在谱面**下方**，画布总高随之增加。
  const metaH = opt.meta ? (opt.meta.size ?? 192) + lay.padX * 2 : 0;
  if (opt.meta) parts.push(metaPanel(opt.meta, totalW, bodyTop + maxH, lay.padX));
  stats.columnHeight = maxH + headerH + metaH;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${n(totalW)}" height="${n(stats.columnHeight)}" viewBox="0 0 ${n(totalW)} ${n(stats.columnHeight)}">`,
    `<defs><style>${css}</style>${symbols.join('')}${grads.join('')}</defs>`,
    parts.join(''),
    `</svg>`,
  ].join('');

  return { svg, stats };
}

/**
 * 底部信息区 —— 照参考仓库 `pjsekai-scores-rs`：封面 + 曲名 + 副标题，横带贴在图底。
 *
 * 参考仓库的排布（`drawing.rs` 的 meta 段，数值取自其 `0642_master.svg` 实测）：
 * 封面 `meta_size` 见方、左边距 `lane_padding×2`；文字块在封面右侧，
 * **标题字号 = `meta_size/2`、副标题 = `meta_size/4`**，基线分别贴在封面底边
 * 上 16px 与 `meta_size/3` 处。字号随封面一起缩放，故不写进 CSS 类。
 */
function metaPanel(meta: MetaPanel, totalW: number, yTop: number, padX: number): string {
  const size = meta.size ?? 192;
  const pad = padX * 2;
  const out: string[] = [];
  const h = size + padX * 2;
  out.push(`<rect class="meta" x="0" y="${n(yTop)}" width="${n(totalW)}" height="${n(h)}"/>`);
  out.push(`<line class="meta-line" x1="0" y1="${n(yTop)}" x2="${n(totalW)}" y2="${n(yTop)}"/>`);
  const imgY = yTop + padX;
  if (meta.jacket) {
    out.push(
      `<image xlink:href="${esc(meta.jacket)}" x="${n(pad)}" y="${n(imgY)}"`
      + ` width="${n(size)}" height="${n(size)}" preserveAspectRatio="xMidYMid slice"/>`,
    );
    out.push(`<rect class="meta-frame" x="${n(pad)}" y="${n(imgY)}" width="${n(size)}" height="${n(size)}"/>`);
  }
  const textX = pad + (meta.jacket ? size + padX * 2 : 0);
  const titleSize = size / 2;
  const subSize = size / 4;
  // 基线位置照参考仓库的比例：副标题在封面纵向三分之一处，标题贴着封面底边。
  // 两者相距 `size×0.625`——96px 的标题与 48px 的副标题才不叠在一起。
  const titleY = imgY + size - padX;
  const subY = imgY + size / 3 - 8;
  if (meta.title) {
    out.push(
      `<text class="meta-title" x="${n(textX)}" y="${n(titleY)}"`
      + ` font-size="${n(titleSize)}">${esc(meta.title)}</text>`,
    );
  }
  if (meta.subtitle) {
    out.push(
      `<text class="meta-sub" x="${n(textX)}" y="${n(subY)}"`
      + ` font-size="${n(subSize)}">${esc(meta.subtitle)}</text>`,
    );
  }
  return out.join('');
}

/** 取某时刻所在小节的拍数（拍号分子）。 */
function beatsPerBar(chart: Chart, time: number): number {
  let num = 4;
  for (const b of chart.beats) {
    if (time >= b.time) num = b.numerator;
    else break;
  }
  return Math.max(1, Math.round(num));
}

/**
 * 侧栏——轨道左侧的竖排信息条。
 *
 * 参考仓库 `pjsekai-scores-rs` 把小节号、BPM、事件名贴在轨道两侧；本仓库只留左侧，
 * 且**不占列顶表头**（表头留给列号与时间范围）。
 *
 * 各项都是「变化点才标」：BPM 与拍号只在取值改变处出现，否则整屏重复同一个数字。
 * Fever 段用底色带 + 竖排 `FEVER` 标出。
 */
function sidePanel(
  side: SidePanel, chart: Chart, bars: { time: number }[], lay: Layout,
  yTop: number, yBottom: number, showInfo: boolean,
): string {
  const w = lay.sideWidth;
  const out: string[] = [];
  const visible = (y: number) => y >= yTop - 40 && y <= yBottom + 40;
  // 侧栏底色：整列一条，压在轨道左边。
  out.push(`<rect class="side-bg" x="0" y="${n(yTop)}" width="${n(w)}" height="${n(yBottom - yTop)}"/>`);
  // 右边界线，与轨道分开。
  out.push(`<line class="edge" x1="${n(w)}" y1="${n(yTop)}" x2="${n(w)}" y2="${n(yBottom)}"/>`);

  // 小节号：每小节一条短横线 + `#序号`。
  if (side.barNumbers) {
    for (let i = 0; i < bars.length; i++) {
      const y = timeY(bars[i].time, lay);
      if (!visible(y)) continue;
      out.push(`<line class="side-tick" x1="${n(w - 8)}" y1="${n(y)}" x2="${n(w)}" y2="${n(y)}"/>`);
      out.push(`<text class="side-bar" x="${n(w - 12)}" y="${n(y - 3)}" text-anchor="end">#${i + 1}</text>`);
    }
  }

  // BPM：只在变化处标。
  if (side.bpm) {
    for (let i = 0; i < chart.bpms.length; i++) {
      const y = timeY(chart.bpms[i].time, lay);
      if (!visible(y)) continue;
      out.push(`<text class="side-bpm" x="4" y="${n(y - 3)}">BPM ${n(chart.bpms[i].bpm)}</text>`);
    }
  }

  // 拍号：只在变化处标。
  if (side.beats) {
    for (const b of chart.beats) {
      const y = timeY(b.time, lay);
      if (!visible(y)) continue;
      out.push(`<text class="side-beat" x="4" y="${n(y + 9)}">${b.numerator}/${b.denominator}</text>`);
    }
  }

  // Fever：竖排 `FEVER`，贴在段中。
  const fv = side.fever;
  if (fv && fv.end > fv.start) {
    const yMid = timeY((fv.start + fv.end) / 2, lay);
    if (visible(yMid)) {
      out.push(
        `<text class="side-fever" x="4" y="${n(yMid)}" transform="rotate(-90 4 ${n(yMid)})">FEVER</text>`,
      );
    }
  }

  // 顶部信息块：曲名 / 难度 / 等级 / MaxCombo。
  // 只画在第一列——每列都重复一遍同一行字就成了噪声。
  // 起点留 20px：第一行正好压着列顶会被裁掉半截。
  if (showInfo && side.info?.length) {
    let ty = yTop + 24;
    for (const line of side.info) {
      out.push(`<text class="side-bpm" x="4" y="${n(ty)}">${esc(line)}</text>`);
      ty += 14;
    }
  }

  return out.join('');
}

/**
 * Hold 宽带半边 → 渐变定义 + path。
 *
 * 渐变用 `userSpaceOnUse`，端点取几何上的两列中点投影——即垂直于带轴的方向。
 * 每个半边一条独立渐变（带轴各不相同），定义收集进根 `defs`。
 */
function bandElement(half: BandHalf, index: number): { def: string; path: string } {
  const [a, b, c, d] = half.corners;
  const id = `bg${index}`;
  const def = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`
    + ` x1="${n(half.gradFrom[0])}" y1="${n(half.gradFrom[1])}" x2="${n(half.gradTo[0])}" y2="${n(half.gradTo[1])}">`
    + `<stop offset="0" stop-color="${cssRgba(half.fromColor)}"/>`
    + `<stop offset="1" stop-color="${cssRgba(half.toColor)}"/></linearGradient>`;
  const path = `<path fill="url(#${id})" d="M ${n(a[0])} ${n(a[1])} L ${n(b[0])} ${n(b[1])} L ${n(c[0])} ${n(c[1])} L ${n(d[0])} ${n(d[1])} Z"/>`;
  return { def, path };
}

/**
 * 九宫格横向拉伸：左右端头保持原生尺寸（圆角不变形），仅中段拉伸。
 *
 * 用嵌套 `<svg>` + `viewBox` 裁源图、`preserveAspectRatio="none"` 按目标尺寸铺开。
 * 三段首尾相接；端头之和超过目标宽时 `sliceCaps` 已等比缩小，中段为 0。
 */
function slicedImage(
  symbol: string, meta: SpriteMeta, centerX: number, yCenter: number,
  widthUnits: number, type: number, lay: Layout,
): string {
  const k = pxPerWorld(lay);
  const worldW = noteWidthWorld(widthUnits) * SPRITE_SCALE_X;
  const w = worldW * k;
  const h = Math.max(2, noteDepthWorld(type) * SPRITE_SCALE_X * k);
  const sw = meta.rect[2] || 1, sh = meta.rect[3] || 1;
  const caps = sliceCaps(meta, worldW);
  const left = caps.left * k, right = caps.right * k;
  const mid = Math.max(0, w - left - right);
  const x = centerX - w / 2;
  const y = yCenter - h / 2;
  const sL = sw * caps.uL, sMid = sw * (1 - caps.uL - caps.uR), sR = sw * caps.uR;
  const out: string[] = [];
  const piece = (dx: number, dw: number, sx: number, sWidth: number) => {
    if (dw <= 0.01 || sWidth <= 0.01) return;
    out.push(`<svg x="${n(dx)}" y="${n(y)}" width="${n(dw)}" height="${n(h)}"`
      + ` viewBox="${n(sx)} 0 ${n(sWidth)} ${n(sh)}" preserveAspectRatio="none">`
      + `<use xlink:href="#${symbol}"/></svg>`);
  };
  piece(x, left, 0, sL);
  piece(x + left, mid, sL, sMid);
  piece(x + left + mid, right, sL + sMid, sR);
  return out.join('');
}

/** Hold 头 / 尾的端头贴图，与瞬时音符同款九宫格。 */
function capElement(time: number, l: number, r: number, lay: Layout, lib: SpriteLibrary): string {
  const meta = lib.meta[1];
  if (!lib.notes[1] || !meta) return '';
  const x0 = laneX(l, lay), x1 = laneX(r + 1, lay);
  return slicedImage(`sp-${NOTE_SPRITE[1]}`, meta, (x0 + x1) / 2, timeY(time, lay), r - l + 1, 1, lay);
}

/**
 * Flick 的一层附加元素 → SVG。
 *
 * 箭头走横向平铺（单块宽 `tile`，末块按剩余宽度裁源图，不取整）；其余直接拉伸。
 * 镜像一律以元素自身中心为轴，用 `translate(2·cx, 0) scale(-1, 1)` 实现。
 */
function flickElement(o: FlickOverlay, lib: SpriteLibrary): string {
  const idx = o.kind === 'arrow' ? 0 : o.kind === 'icon' ? 1 : 2;
  const meta = lib.extra.meta[idx];
  if (!lib.extra.uri[idx] || !meta || o.w <= 0.01 || o.h <= 0.01) return '';
  const name = FLICK_EXTRA[idx];
  const sw = meta.rect[2] || 1, sh = meta.rect[3] || 1;
  const y = o.cy - o.h / 2;
  const parts: string[] = [];

  if (o.kind === 'arrow' && o.tile > 0.5) {
    let dx = -o.w / 2;
    while (dx < o.w / 2 - 0.5) {
      const remain = Math.min(o.tile, o.w / 2 - dx);
      parts.push(`<svg x="${n(o.cx + dx)}" y="${n(y)}" width="${n(remain)}" height="${n(o.h)}"`
        + ` viewBox="0 0 ${n(sw * (remain / o.tile))} ${n(sh)}" preserveAspectRatio="none">`
        + `<use xlink:href="#sp-${name}"/></svg>`);
      dx += o.tile;
    }
  } else {
    parts.push(`<svg x="${n(o.cx - o.w / 2)}" y="${n(y)}" width="${n(o.w)}" height="${n(o.h)}"`
      + ` viewBox="0 0 ${n(sw)} ${n(sh)}" preserveAspectRatio="none">`
      + `<use xlink:href="#sp-${name}"/></svg>`);
  }

  const inner = parts.join('');
  return o.flip ? `<g transform="translate(${n(o.cx * 2)},0) scale(-1,1)">${inner}</g>` : inner;
}
