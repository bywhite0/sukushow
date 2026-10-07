/**
 * 契约比对：本仓库与 `2D 谱面实现` 对同一批谱面必须给出相同的解析口径与几何量。
 *
 * SVG 导出与 2D 视图通过这个脚本校验共同的解析和几何口径。
 *
 * 用法：pnpm cross-check
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeChartBytes } from '../src/chart';
import { defaultLayout, noteSpan, timeY } from '../src/layout';
import { noteSpriteSize, pxPerWorld, sliceCaps } from '../src/geometry';

const here = dirname(fileURLToPath(import.meta.url));
const peer = resolve(here, '..', '..', 'flat-preview');
const dir = resolve(here, '..', '..', '..', 'apps', 'web', 'public', 'assets', 'chart');

if (!existsSync(dir)) {
  throw new Error(`统一前端谱面目录不存在：${dir}`);
}

// 对照仓库是浏览器向的 ESM + TS，用 tsx 直接载入其源码。
// 动态导入必须给 file:// URL（Windows 盘符路径不被 ESM 加载器接受）。
const mod = (rel: string) => import(pathToFileURL(join(peer, rel)).href);
const peerChart = await mod('src/chart.ts');
const peerLayout = await mod('src/view.ts');
// 对照仓库的几何分散在 view.ts（布局）与 slice.ts（贴图/宽带）两处。
const peerSlice = await mod('src/slice.ts');

const files = readdirSync(dir).filter(f => f.startsWith('rhythmgame_chart_') && f.endsWith('.bytes'));
if (!files.length) {
  console.error(`目录里没有谱面：${dir}`);
  process.exit(2);
}

let diff = 0, checked = 0;
const report: string[] = [];

for (const file of files) {
  const bytes = new Uint8Array(readFileSync(join(dir, file)));
  const a = decodeChartBytes(bytes);
  const b = await peerChart.decodeChart(bytes);

  const cmp = (label: string, x: number | string, y: number | string) => {
    if (x !== y) { diff++; report.push(`${file} ${label}: 本仓 ${x} vs 对照 ${y}`); }
  };
  cmp('音符数', a.notes.length, b.notes.length);
  cmp('链首数', a.roots.length, b.roots.length);
  cmp('同时押组数', a.lines.length, b.lines.length);
  cmp('BPM 段数', a.bpms.length, b.bpms.length);
  cmp('时长', a.duration.toFixed(6), b.duration.toFixed(6));

  // 逐音符比对类型与轨道。
  for (let i = 0; i < Math.min(a.notes.length, b.notes.length); i++) {
    const x = a.notes[i], y = b.notes[i];
    if (x.uid !== y.uid || x.type !== y.type || x.l !== y.l || x.r !== y.r || x.l2 !== y.l2 || x.r2 !== y.r2) {
      diff++; report.push(`${file} 音符#${i}: 本仓 ${x.uid}/${x.type}/${x.l}-${x.r}/${x.l2}-${x.r2} vs 对照 ${y.uid}/${y.type}/${y.l}-${y.r}/${y.l2}-${y.r2}`);
      break;
    }
    if (Math.abs(x.time - y.time) > 1e-9 || Math.abs(x.end - y.end) > 1e-9) {
      diff++; report.push(`${file} 音符#${i} 时刻: ${x.time}/${x.end} vs ${y.time}/${y.end}`);
      break;
    }
    // 串链拓扑。
    const nx = x.next?.uid ?? -1, ny = y.next?.uid ?? -1;
    if (nx !== ny) { diff++; report.push(`${file} 音符#${i} next: ${nx} vs ${ny}`); break; }
  }

  // 几何口径：SVG 出图与平面图交互的默认布局不同，
  // 这里强制同一组参数再比公式，比较共同口径。
  {
    const base = { lanePx: 16, pxPerSec: 220, padX: 16, padY: 16, mirror: false };
    const layA = { ...defaultLayout(), ...base, duration: a.duration };
    const layB = { ...peerLayout.defaultLayout(), ...base, duration: b.duration };
    for (const w of [1, 3, 8, 20]) {
      const sa = noteSpriteSize(w, 0, layA), sb = peerSlice.noteSpriteSize(w, 0, layB);
      if (Math.abs(sa.w - sb.w) > 1e-6 || Math.abs(sa.h - sb.h) > 1e-6) {
        diff++; report.push(`${file} 音符尺寸 w=${w}: ${sa.w}/${sa.h} vs ${sb.w}/${sb.h}`);
      }
      const ca = sliceCaps({ name: 'x', border: [60, 0, 60, 0], rect: [0, 0, 128, 68], ppu: 100 }, w);
      const cb = peerSlice.sliceCaps({ name: 'x', border: [60, 0, 60, 0], rect: [0, 0, 128, 68], ppu: 100 }, w);
      if (Math.abs(ca.left - cb.left) > 1e-9 || Math.abs(ca.mid - cb.mid) > 1e-9 || Math.abs(ca.uL - cb.uL) > 1e-9) {
        diff++; report.push(`${file} 九宫格 w=${w}: ${ca.left}/${ca.mid} vs ${cb.left}/${cb.mid}`);
      }
    }
    if (Math.abs(pxPerWorld(layA) - peerSlice.pxPerWorld(layB)) > 1e-6) {
      diff++; report.push(`${file} pxPerWorld: ${pxPerWorld(layA)} vs ${peerSlice.pxPerWorld(layB)}`);
    }
    // 时间轴朝向：同一时刻的 y 必须一致（都是时间向上、都以 duration 为锚）。
    for (const t of [0, 3, 30]) {
      const ta = timeY(t, layA), tb = peerLayout.timeY(t, layB);
      if (Math.abs(ta - tb) > 1e-6) { diff++; report.push(`${file} timeY(${t}): ${ta} vs ${tb}`); }
    }
    // 同一音符的横向跨度。
    const note = a.notes.find(x => x.type !== 1) ?? a.notes[0];
    if (note) {
      const [ax0, ax1] = noteSpan(note, layA, false);
      const [bx0, bx1] = peerLayout.noteSpan(note, layB, false);
      if (Math.abs(ax0 - bx0) > 1e-6 || Math.abs(ax1 - bx1) > 1e-6) {
        diff++; report.push(`${file} 音符跨度: ${ax0}-${ax1} vs ${bx0}-${bx1}`);
      }
    }
  }

  checked++;
  if (checked % 100 === 0) console.log(`  … ${checked}/${files.length}`);
}

console.log(`\n比对谱面：${checked}`);
console.log(`契约差异：${diff}`);
if (report.length) {
  console.error('\n差异明细（前 20）：');
  for (const line of report.slice(0, 20)) console.error('  ' + line);
  process.exit(1);
}
