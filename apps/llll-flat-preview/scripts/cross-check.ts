/**
 * 契约校验：对同一批谱面，把本仓库的解析结果与 llll-preview-web 的实现逐项比对。
 *
 * 两个仓库各自持有一份解析实现，口径靠这张校验兜底。llll-preview-web 的路径
 * 按参数 / 环境变量 LLLL_PREVIEW_WEB 取，缺省时跳过。
 *
 * 用法：pnpm exec tsx scripts/cross-check.ts [llll-preview-web 目录] [谱面目录]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeChart as decodeFlat } from '../src/chart';

function resolveDir(): { peer: string | null; charts: string } {
  const peerArg = process.argv[2] ?? process.env.LLLL_PREVIEW_WEB;
  const peer = peerArg && existsSync(join(resolve(peerArg), 'src', 'chart.ts')) ? resolve(peerArg) : null;
  const chartArg = process.argv[3] ?? process.env.LLLL_CHART_DIR;
  if (chartArg) return { peer, charts: resolve(chartArg) };
  const local = join(process.cwd(), 'scripts', 'link-assets.local.json');
  if (existsSync(local)) {
    const cfg = JSON.parse(readFileSync(local, 'utf8')) as { chart?: string };
    if (cfg.chart) return { peer, charts: resolve(cfg.chart) };
  }
  throw new Error('未指定谱面目录');
}

const { peer, charts } = resolveDir();
if (!peer) {
  console.log('未提供 llll-preview-web 目录，跳过契约校验。');
  process.exit(0);
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
