/**
 * 对本地谱面语料跑解析与几何有限性校验，输出实际统计。
 *
 * 目录按优先级取：命令行参数、环境变量 LLLL_CHART_DIR、
 * scripts/link-assets.local.json 的 chart 字段。
 *
 * 用法：pnpm verify:corpus [谱面目录]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Chart, decodeChart } from '../src/chart';
import { chainEnd, chainQuads, defaultLayout, instantRect, measures, noteSpan } from '../src/view';

function chartDir(): string {
  const fromArgv = process.argv[2];
  if (fromArgv) return resolve(fromArgv);
  const fromEnv = process.env.LLLL_CHART_DIR;
  if (fromEnv) return resolve(fromEnv);
  const local = join(process.cwd(), 'scripts', 'link-assets.local.json');
  if (existsSync(local)) {
    const cfg = JSON.parse(readFileSync(local, 'utf8')) as { chart?: string };
    if (cfg.chart) return resolve(cfg.chart);
  }
  throw new Error('未指定谱面目录：给出参数、设置 LLLL_CHART_DIR，或写 scripts/link-assets.local.json');
}

interface Totals {
  files: number; failed: number; notes: number; holds: number; multiWaypoint: number;
  roots: number; lines: number; links: number; maxChain: number; maxNotes: number;
}

function inspect(c: Chart, t: Totals, name: string, problems: string[]) {
  const lay = { ...defaultLayout(), duration: c.duration };
  t.notes += c.notes.length;
  t.roots += c.roots.length;
  t.lines += c.lines.length;
  t.maxNotes = Math.max(t.maxNotes, c.notes.length);
  for (const n of c.notes) {
    if (n.type === 1) {
      t.holds++;
      if (n.holds.length > 1) t.multiWaypoint++;
      if (n.next) t.links++;
    }
    if (n.time < 0 || !Number.isFinite(n.time)) problems.push(`${name}: #${n.uid} 时刻非有限`);
    const [a, b] = noteSpan(n, lay, false);
    if (!(b > a)) problems.push(`${name}: #${n.uid} 横向范围非正`);
  }
  for (const root of c.roots) {
    if (root.type !== 1) continue;
    let count = 0;
    let node: typeof root | undefined = root;
    while (node) {
      count++;
      const quads = chainQuads(node, lay);
      for (const q of quads) {
        for (const [x, y] of q.p) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) problems.push(`${name}: #${root.uid} 四边形坐标非有限`);
        }
      }
      node = node.next;
    }
    t.maxChain = Math.max(t.maxChain, count);
  }
  for (const n of c.notes) {
    if (n.type === 1) continue;
    const r = instantRect(n, lay, 6);
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !(r.w > 0) || !(r.h > 0)) problems.push(`${name}: #${n.uid} 矩形非法`);
  }
  if (!Number.isFinite(chainEnd(c.roots[0] ?? c.notes[0]))) problems.push(`${name}: 链尾非有限`);
  const ms = measures(c);
  if (ms.length && !ms.every(m => Number.isFinite(m.time))) problems.push(`${name}: 小节线时间非有限`);
}

const dir = chartDir();
const names = readdirSync(dir).filter(f => /\.(bytes|json)$/i.test(f)).filter(f => statSync(join(dir, f)).isFile()).sort();
if (!names.length) throw new Error(`${dir} 下没有 .bytes / .json`);

const t: Totals = { files: 0, failed: 0, notes: 0, holds: 0, multiWaypoint: 0, roots: 0, lines: 0, links: 0, maxChain: 0, maxNotes: 0 };
const problems: string[] = [];
const failures: string[] = [];

for (const name of names) {
  try {
    const c = await decodeChart(new Uint8Array(readFileSync(join(dir, name))));
    t.files++;
    inspect(c, t, name, problems);
  } catch (error) {
    t.failed++;
    failures.push(`${name}: ${String(error)}`);
  }
}

console.log(`目录：${dir}`);
console.log(`文件：${names.length}（解析成功 ${t.files}，失败 ${t.failed}）`);
console.log(`音符：${t.notes}`);
console.log(`Hold 节点：${t.holds}（多航点 ${t.multiWaypoint}）`);
console.log(`链首：${t.roots}，串链连接：${t.links}`);
console.log(`同时押组：${t.lines}`);
console.log(`最长链节点数：${t.maxChain}`);
console.log(`单谱最大音符数：${t.maxNotes}`);
if (failures.length) {
  console.log(`\n失败明细（${failures.length}）：`);
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
}
if (problems.length) {
  console.log(`\n几何问题（${problems.length}）：`);
  for (const p of problems.slice(0, 20)) console.log('  ' + p);
  process.exitCode = 1;
}
if (t.failed) process.exitCode = 1;
