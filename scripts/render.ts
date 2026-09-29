/**
 * 渲染入口：读谱面 → 出 SVG。
 *
 * 用法：
 *   pnpm render <谱面.bytes|.json> -o <输出.svg> [选项]
 *
 * 选项：
 *   --lane-px <n>      每格轨道宽度（默认 16）
 *   --px-per-sec <n>   每秒纵向像素（默认 220）
 *   --pad <n>          上下左右留白（默认 16）
 *   --mirror           左右镜像
 *   --no-grid          不画轨道格线
 *   --no-measures      不画小节线
 *   --no-beats         不画拍线
 *   --no-simul         不画同时押连线
 *   --bar-numbers      标小节号
 *   --from <秒>        只渲染该时刻起（与 --to 搭配出局部图）
 *   --to <秒>          只渲染到该时刻
 *   --transparent      透明背景
 *   --link-assets      贴图用链接而非内嵌（SVG 更小）
 *   --css <file>       追加样式表
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeChartBytes } from '../src/chart';
import { defaultLayout } from '../src/layout';
import { loadSprites } from '../src/assets';
import { renderSvg } from '../src/svg';

function arg(name: string, fallback?: string): string | undefined {
  for (const flag of [`--${name}`, `-${name}`]) {
    const i = process.argv.indexOf(flag);
    if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  }
  return fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const input = process.argv[2];
if (!input || input.startsWith('-')) {
  console.error('用法：pnpm render <谱面.bytes|.json> -o <输出.svg> [选项]');
  process.exit(2);
}
const out = arg('o', arg('output', 'out/chart.svg'))!;

const chart = decodeChartBytes(new Uint8Array(readFileSync(input)));
const lay = {
  ...defaultLayout(),
  lanePx: Number(arg('lane-px', '16')),
  pxPerSec: Number(arg('px-per-sec', '220')),
  padX: Number(arg('pad', '16')),
  padY: Number(arg('pad', '16')),
  mirror: has('mirror'),
  duration: chart.duration,
};

const { lib, missing } = loadSprites({ mode: has('link-assets') ? 'link' : 'embed' });
if (missing.length) console.error(`警告：缺贴图 ${missing.join(', ')}（对应层退化为纯色或跳过）`);

const cssFile = arg('css');
const from = arg('from'), to = arg('to');
const range = from !== undefined || to !== undefined
  ? { from: from !== undefined ? Number(from) : 0, to: to !== undefined ? Number(to) : chart.duration }
  : undefined;
if (range && !(range.to > range.from)) {
  console.error(`时间段无效：${range.from} → ${range.to}（to 必须大于 from）`);
  process.exit(2);
}

const { svg, stats } = renderSvg(chart, lib, {
  layout: lay,
  showMeasures: !has('no-measures'),
  showBeats: !has('no-beats'),
  showSimultaneous: !has('no-simul'),
  showGrid: !has('no-grid'),
  showBarNumbers: has('bar-numbers'),
  background: has('transparent') ? null : '#0d1220',
  extraCss: cssFile ? readFileSync(cssFile, 'utf8') : undefined,
  allowFallback: true,
  range,
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);

const kb = (svg.length / 1024).toFixed(1);
console.log(`谱面：${input}`);
console.log(`音符 ${chart.notes.length}（链首 ${chart.roots.length}）／时长 ${chart.duration.toFixed(2)}s／BPM ${chart.bpms.length} 段`);
const w = Math.round(lay.padX * 2 + 60 * lay.lanePx);
const h = range
  ? Math.round((range.to - range.from) * lay.pxPerSec + lay.padY * 2)
  : Math.round(lay.padY * 2 + chart.duration * lay.pxPerSec);
console.log(`画布：${w} × ${h} px${range ? `（${range.from}s → ${range.to}s）` : '（整谱）'}`);
console.log(`绘制：音符 ${stats.notes}（瞬时 ${stats.instants}）／Hold 半边 ${stats.holds}／小节线 ${stats.bars}／拍线 ${stats.beats}／同时押 ${stats.simultaneous}${stats.fallback ? `／兜底 ${stats.fallback}` : ''}`);
console.log(`输出：${out}（${kb} KiB）`);
