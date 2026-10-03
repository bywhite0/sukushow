/**
 * 契约校验：对同一批谱面，把 2D 解析结果与 apps/llll-preview 的实现逐项比对。
 *
 * 两种视图各自提供解析实现，口径由这张校验保持一致。apps/llll-preview 的路径
 * 固定为 workspace 内的对应包。
 *
 * 用法：pnpm cross-check
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeChart as decodeFlat } from '../src/chart';

const here = dirname(fileURLToPath(import.meta.url));
const appsRoot = resolve(here, '..', '..');
const peer = join(appsRoot, 'llll-preview');
const charts = join(appsRoot, 'web', 'public', 'assets', 'chart');

if (!existsSync(join(peer, 'src', 'chart.ts'))) {
  throw new Error(`workspace 中没有 apps/llll-preview：${peer}`);
}
if (!existsSync(charts)) {
  throw new Error(`统一前端谱面目录不存在：${charts}`);
}

if (!readdirSync(charts).some(f => /^rhythmgame_chart_.*\.bytes$/i.test(f))) {
  throw new Error(`统一前端谱面目录没有谱面：${charts}`);
}

const peerUrl = pathToFileURL(join(peer, 'src', 'chart.ts')).href;
const peerMod = (await import(peerUrl)) as { decodeChart: (b: Uint8Array) => { notes: unknown[]; roots: unknown[]; lines: unknown[] } };

const names = readdirSync(charts).filter(f => /^rhythmgame_chart_.*\.bytes$/i.test(f)).sort();
let checked = 0;
const diffs: string[] = [];

for (const name of names) {
  const bytes = new Uint8Array(readFileSync(join(charts, name)));
  const [flat, ref] = await Promise.all([decodeFlat(bytes), Promise.resolve(peerMod.decodeChart(bytes))]);
  checked++;
  if (flat.notes.length !== ref.notes.length) diffs.push(`${name}: 音符数 ${flat.notes.length} vs ${ref.notes.length}`);
  if (flat.roots.length !== ref.roots.length) diffs.push(`${name}: 链首数 ${flat.roots.length} vs ${ref.roots.length}`);
  if (flat.lines.length !== ref.lines.length) diffs.push(`${name}: 同时押组 ${flat.lines.length} vs ${ref.lines.length}`);
}

console.log(`比对谱面：${checked}`);
console.log(`契约差异：${diffs.length}`);
for (const d of diffs.slice(0, 30)) console.log('  ' + d);
if (diffs.length) process.exitCode = 1;
