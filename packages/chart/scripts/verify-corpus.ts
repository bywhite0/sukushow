/**
 * 全量语料校验：解析本地谱面目录里的每一张谱面，核对
 * - 解析不抛错、音符时刻与 Hold 端点都是有限数；
 * - 自算最大连击（`chartAllNoteSize`）与 `Chart.maxCombo` 相等，且与曲目列表里主数据的 MaxCombo 一致；
 * - 收录了曲终的曲目，曲终不早于末音符终点（容差 1 ms，主数据是整毫秒）。
 *
 * 用法：pnpm verify:corpus [谱面目录]
 * 默认读统一前端的 `apps/web/public/assets/chart`，主数据 MaxCombo 取同级的 `song-list.json`。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chartAllNoteSize, decodeChart } from '../src/chart';
import { parseChartName } from '../src/masterdata';
import { finishTimeForSong } from '../src/songTiming';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../../../apps/web/public');
const dir = resolve(process.argv[2] ?? join(publicDir, 'assets/chart'));
const names = existsSync(dir) ? readdirSync(dir).filter(f => /^rhythmgame_chart_.*\.(bytes|json)$/i.test(f)).sort() : [];
if (!names.length) throw new Error(`${dir} 下没有 rhythmgame_chart_*.bytes / .json`);

type SongEntry = { charts: Record<string, string>; maxCombos: Record<string, number> };
const songListPath = join(publicDir, 'song-list.json');
const expectedCombo = new Map<string, number>();
if (existsSync(songListPath)) {
  for (const song of (JSON.parse(readFileSync(songListPath, 'utf8')) as { songs: SongEntry[] }).songs) {
    for (const [difficulty, file] of Object.entries(song.charts)) {
      const combo = song.maxCombos[difficulty];
      if (combo !== undefined) expectedCombo.set(file, combo);
    }
  }
}

const problems: string[] = [];
let notes = 0, comboChecked = 0, finishChecked = 0, minTail = Infinity;
for (const name of names) {
  try {
    const chart = decodeChart(new Uint8Array(readFileSync(join(dir, name))));
    notes += chart.notes.length;
    for (const n of chart.notes) {
      if (!Number.isFinite(n.time) || !n.holds.every(Number.isFinite)) problems.push(`${name}: #${n.uid} 时刻非有限`);
    }
    const combo = chartAllNoteSize(chart);
    if (chart.notes.length && combo !== chart.maxCombo) problems.push(`${name}: 最大连击 ${combo} ≠ Chart.maxCombo ${chart.maxCombo}`);
    const expected = expectedCombo.get(name);
    if (expected !== undefined) {
      comboChecked++;
      if (combo !== expected) problems.push(`${name}: 最大连击 ${combo} ≠ 主数据 ${expected}`);
    }
    const finish = finishTimeForSong(parseChartName(name)?.musicId);
    if (finish !== null && chart.notes.length) {
      finishChecked++;
      const tail = finish - chart.notes.reduce((t, n) => Math.max(t, n.end), 0);
      minTail = Math.min(minTail, tail);
      if (tail < -0.001) problems.push(`${name}: 曲终 ${finish}s 早于末音符 ${(-tail).toFixed(4)}s`);
    }
  } catch (error) {
    problems.push(`${name}: ${String(error)}`);
  }
}

console.log(`目录：${dir}`);
console.log(`谱面：${names.length}，音符：${notes}`);
console.log(`最大连击与主数据核对：${comboChecked} 张`);
console.log(`曲终核对：${finishChecked} 张，曲终减末音符最小 ${minTail.toFixed(4)} 秒`);
console.log(`问题：${problems.length}`);
for (const p of problems.slice(0, 30)) console.log('  ' + p);
if (problems.length) process.exitCode = 1;
