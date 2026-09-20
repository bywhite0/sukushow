import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { feverFromMusicScore, type FeverIndex } from '../src/feverMetadata';

const [masterdata, plain, output = 'src/feverMetadata.json'] = process.argv.slice(2);
if (!masterdata || !plain) throw new Error('用法：pnpm metadata:fever <Musics.yaml.json> <cache/plain目录> [输出JSON]');
if (!(await stat(plain)).isDirectory()) throw new Error('cache/plain 必须是可读取的目录');
const rows: unknown = JSON.parse(await readFile(masterdata, 'utf8'));
if (!Array.isArray(rows)) throw new Error('Musics 主数据必须为数组');
const index: FeverIndex = {};
const missing: string[] = [];
for (const row of rows) {
  if (!row || !Number.isInteger(row.Id) || row.Id <= 0) throw new Error('歌曲 Id 无效');
  let csv: string;
  try { csv = await readFile(join(plain, `musicscore_${row.Id}.csv`), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    missing.push(String(row.Id));
    continue;
  }
  if (index[row.Id]) throw new Error(`重复歌曲 Id：${row.Id}`);
  try { index[row.Id] = feverFromMusicScore(csv, row.FeverSectionNo); }
  catch (error) { throw new Error(`歌曲 ${row.Id}：${String(error)}`); }
}
await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ songs: Object.keys(index).length, missingCsv: missing, output }));
