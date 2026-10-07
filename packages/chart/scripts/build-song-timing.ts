/**
 * 生成曲目时间索引 `src/songTiming.json`。
 *
 * 用法：pnpm metadata:timing <masterdata 目录> <cache/plain 目录> [输出 JSON]
 *   masterdata 目录：读 `Musics.yaml` 的 Id / FeverSectionNo / PlayTime；
 *   cache/plain 目录：读 `musicscore_<Id>.csv`，没有 CSV 的曲目跳过并列出。
 */
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feverFromMusicScore } from '../src/fever';
import { parseMusics } from '../src/masterdata';
import type { SongTimingIndex } from '../src/songTiming';

const here = dirname(fileURLToPath(import.meta.url));
const [masterdata, plain, output = resolve(here, '../src/songTiming.json')] = process.argv.slice(2);
if (!masterdata || !plain) throw new Error('用法：pnpm metadata:timing <masterdata 目录> <cache/plain 目录> [输出 JSON]');
if (!(await stat(plain)).isDirectory()) throw new Error('cache/plain 必须是可读取的目录');

const musics = parseMusics(await readFile(join(masterdata, 'Musics.yaml'), 'utf8'));
const index: SongTimingIndex = {};
const missing: string[] = [];
for (const [id, music] of [...musics].sort(([a], [b]) => a - b)) {
  const csvPath = join(plain, `musicscore_${id}.csv`);
  if (!existsSync(csvPath)) { missing.push(String(id)); continue; }
  const { feverSectionNo: n, playTime } = music;
  try {
    if (n === undefined) throw new Error('缺 FeverSectionNo');
    if (!(playTime !== undefined && playTime > 0)) throw new Error('PlayTime 必须为正');
    const csv = await readFile(csvPath, 'utf8');
    const fever = feverFromMusicScore(csv, n);
    // FeverChance 的代理窗口 = Fever 前一段。
    const chance = n > 1 ? feverFromMusicScore(csv, n - 1) : null;
    index[id] = { ...fever, chanceStart: chance?.start ?? null, chanceEnd: chance?.end ?? null, finishTime: playTime / 1000 };
  } catch (error) {
    throw new Error(`曲目 ${id}：${String(error)}`);
  }
}
await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ songs: Object.keys(index).length, missingCsv: missing, output }));
