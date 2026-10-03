/**
 * 全量语料验证：把 617 张谱面全部渲染一遍，确认不抛错、统计自洽。
 *
 * 用法：pnpm verify:corpus
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeChartBytes } from '../src/chart';
import { defaultLayout } from '../src/layout';
import { loadSprites } from '../src/assets';
import { renderSvg } from '../src/svg';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..', '..', 'web', 'public', 'assets', 'chart');
const files = readdirSync(dir).filter(f => f.startsWith('rhythmgame_chart_') && f.endsWith('.bytes'));

if (!files.length) {
  console.error(`目录里没有谱面：${dir}`);
  process.exit(2);
}

const { lib, missing } = loadSprites();
if (missing.length) console.error(`警告：缺贴图 ${missing.join(', ')}`);

const totals = { notes: 0, holds: 0, bars: 0, simul: 0, svg: 0, chains: 0 };
let maxChain = 0, maxNotes = 0, maxChainId = '', maxNotesId = '';
const failures: { file: string; error: string }[] = [];
let n = 0;

for (const file of files) {
  const id = file.replace('rhythmgame_chart_', '').replace('.bytes', '');
  try {
    const chart = decodeChartBytes(new Uint8Array(readFileSync(join(dir, file))));
    const lay = { ...defaultLayout(), duration: chart.duration };
    const common = {
      layout: lay,
      showMeasures: true,
      showBeats: true,
      showSimultaneous: true,
      showGrid: true,
      showBarNumbers: false,
      background: null,
      allowFallback: true,
    };
    // 几何自检跑单列版：切列会把跨列的长带重复绘制，绘制次数不再是几何量。
    const { stats } = renderSvg(chart, lib, { ...common, aspect: 0 });
    // 出图版（默认横版）只查不抛错与统计不翻倍。
    const wide = renderSvg(chart, lib, common);

    if (stats.notes > chart.notes.length) throw new Error(`音符统计 ${stats.notes} > ${chart.notes.length}`);
    if (stats.holds > chart.notes.length * 2) throw new Error(`Hold 半边统计 ${stats.holds} 异常`);
    // 切列不改变「谱面里有多少音符」。
    if (wide.stats.notes !== stats.notes) throw new Error(`切列后音符数变了：${stats.notes} → ${wide.stats.notes}`);
    if (wide.stats.instants !== stats.instants) throw new Error(`切列后瞬时音符数变了：${stats.instants} → ${wide.stats.instants}`);
    for (const [name, s] of [['单列', stats], ['横版', wide.stats]] as const) {
      if (!s.columns || !Number.isFinite(s.columnHeight)) throw new Error(`${name}版式统计异常`);
    }

    const svg = wide.svg;
    if (!svg.startsWith('<svg') || !svg.endsWith('</svg>')) throw new Error('SVG 首尾标签不完整');
    // 括号配平（粗检，防字符串拼装漏闭合）。
    const open = (svg.match(/<svg[\s>]/g) ?? []).length;
    const close = (svg.match(/<\/svg>/g) ?? []).length;
    if (open !== close) throw new Error(`<svg> 开闭不配平：${open} vs ${close}`);

    totals.notes += stats.notes;
    totals.holds += stats.holds;
    totals.bars += stats.bars;
    totals.simul += stats.simultaneous;
    totals.svg += svg.length;
    if (chart.notes.length > maxNotes) { maxNotes = chart.notes.length; maxNotesId = id; }

    // 最长链。
    for (const root of chart.roots) {
      if (root.type !== 1) continue;
      let len = 0;
      let node: typeof root | undefined = root;
      while (node) { len++; node = node.next; }
      if (len > maxChain) { maxChain = len; maxChainId = id; }
    }
    totals.chains += chart.roots.filter(r => r.type === 1).length;
  } catch (e) {
    failures.push({ file, error: (e as Error).message });
  }
  n++;
  if (n % 100 === 0) console.log(`  … ${n}/${files.length}`);
}

console.log(`\n谱面：${files.length} 张，成功 ${files.length - failures.length}，失败 ${failures.length}`);
console.log(`音符：${totals.notes}，Hold 半边：${totals.holds}，Hold 链：${totals.chains}`);
console.log(`小节线：${totals.bars}，同时押连线：${totals.simul}`);
console.log(`最长链：${maxChain} 节点（${maxChainId}）`);
console.log(`单谱最大音符数：${maxNotes}（${maxNotesId}）`);
console.log(`SVG 总产出：${(totals.svg / 1024 / 1024).toFixed(1)} MiB，均 ${(totals.svg / files.length / 1024).toFixed(1)} KiB/张`);

if (failures.length) {
  console.error('\n失败明细（前 20）：');
  for (const f of failures.slice(0, 20)) console.error(`  ${f.file}: ${f.error}`);
  process.exit(1);
}
