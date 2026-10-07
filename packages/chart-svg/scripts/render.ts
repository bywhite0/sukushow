/**
 * 渲染入口：读谱面 → 出 SVG。
 *
 * 用法：
 *   pnpm render <谱面.bytes|.json> -o <输出.svg> [选项]
 *
 * 选项：
 *   --lane-px <n>      每格轨道宽度（默认 16）
 *   --px-per-sec <n>   每秒纵向像素（默认 340，对齐参考仓库的等效密度）
 *   --pad <n>          上下左右留白（默认 16）
 *   --mirror           左右镜像
 *   --no-grid          不画轨道格线
 *   --no-measures      不画小节线
 *   --no-beats         不画拍线
 *   --no-simul         不画同时押连线
 *   --bar-numbers      标小节号
 *   --from <秒>        只渲染该时刻起（与 --to 搭配出局部图）
 *   --to <秒>          只渲染到该时刻
 *   --max-column-height <px>
 *                      每列最大像素高，超过就切列并排（0 = 不切）
 *   --aspect <n>       目标长宽比（宽/高），按它定列数（默认 2.4）
 *   --single-column    不切列，出一张长图
 *   --column-gap <px>  列间距（默认 8）
 *   --no-col-labels    不标列号与时间范围
 *   --side             画轨道左侧侧栏（小节号 / BPM / 拍号 / Fever）
 *   --side-width <px>  侧栏宽度（默认 96）
 *   --no-side-bars     侧栏不标小节号
 *   --no-side-bpm      侧栏不标 BPM
 *   --no-side-beats    侧栏不标拍号
 *   --no-fever         侧栏不标 Fever 区
 *   --masterdata <dir> masterdata 目录（读 MusicScores.yaml / Musics.yaml）
 *
 * 时长：认得出曲目时画到曲终 FinishTime（`Musics.PlayTime / 1000`，取本地主数据，
 * 缺省时查时间索引），有音符晚于它时延到末音符；认不出曲目时用谱面的末音符 + 2 秒。
 *   --jacket-dir <dir> 曲绘目录（`<曲目Id>.png`）
 *   --meta             底部信息区：封面 + 曲名 + 难度
 *   --meta-size <px>   封面边长（默认 192，同参考仓库的 meta_size）
 *   --no-meta          不画底部信息区
 *   --transparent      透明背景
 *   --link-assets      贴图用链接而非内嵌（SVG 更小）
 *   --css <file>       追加样式表
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { decodeChart } from '@sukushow/chart/chart';
import { feverFromMusicScore } from '@sukushow/chart/fever';
import { difficultyFromSuffix, parseChartName } from '@sukushow/chart/masterdata';
import { feverForSong, finishTimeForSong } from '@sukushow/chart/songTiming';
import { axisDuration, defaultLayout } from '../src/layout';
import { loadSprites } from '../src/assets';
import { renderSvg } from '../src/svg';
import { masterdataDir as resolveMasterdata, musicscoreDir as resolveMusicscore, jacketDir as resolveJacketDir } from './local-paths';
import { loadMasterData } from './masterdata';
import { fileSpriteSource } from './sprites';

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

// ── 曲目数据：MaxCombo / 曲名 / Fever 段 / 曲终 ──────────────────────────────
// 曲目与难度从文件名取；主数据缺文件时整块降级（侧栏照画，只是少几个数字）。
const named = parseChartName(basename(input));
const difficulty = named ? difficultyFromSuffix(named.suffix) : null;
const mdDir = resolveMasterdata(arg('masterdata'));
const md = loadMasterData(mdDir);
const score = named && difficulty ? md.scores.get(named.musicId)?.[difficulty] : undefined;
const music = named ? md.musics.get(named.musicId) : undefined;

let fever = null;
const csvDir = resolveMusicscore(undefined, dirname(input));
const csvPath = named && csvDir ? join(csvDir, `musicscore_${named.musicId}.csv`) : null;
if (!has('no-fever') && csvPath && existsSync(csvPath) && music?.feverSectionNo) {
  try {
    fever = feverFromMusicScore(readFileSync(csvPath, 'utf8'), music.feverSectionNo);
  } catch (e) {
    console.error(`警告：Fever 段读取失败（${(e as Error).message}）`);
  }
}
if (!has('no-fever')) fever ??= feverForSong(named?.musicId);

// 曲终：本地主数据优先，其次时间索引。
const finishTime = music?.playTime ? music.playTime / 1000 : finishTimeForSong(named?.musicId);

const decoded = decodeChart(new Uint8Array(readFileSync(input)));
const chart = { ...decoded, duration: axisDuration(decoded, finishTime) };
const base = defaultLayout();
const lay = {
  ...base,
  lanePx: Number(arg('lane-px', String(base.lanePx))),
  // 默认值一律从 defaultLayout() 取，避免这里与布局默认值各说各话。
  pxPerSec: Number(arg('px-per-sec', String(base.pxPerSec))),
  padX: Number(arg('pad', String(base.padX))),
  padY: Number(arg('pad', String(base.padY))),
  mirror: has('mirror'),
  duration: chart.duration,
};

const { lib, missing } = loadSprites(fileSpriteSource(), { mode: has('link-assets') ? 'link' : 'embed' });
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

const side = has('side')
  ? {
    width: Number(arg('side-width', '96')),
    barNumbers: !has('no-side-bars'),
    bpm: !has('no-side-bpm'),
    beats: !has('no-side-beats'),
    fever,
    // 信息块已挪到底部 meta 区，侧栏不再重复曲名——只留一行 Combo 备查。
    info: has('no-meta') ? [`Combo ${score?.maxCombo ?? chart.maxCombo}`] : [],
  }
  : undefined;

// ── 底部信息区：封面 + 曲名 + 难度（照参考仓库放在图底）────────────────
// 曲绘源包需解包；目录未配置或该曲没解出图时只画文字，不报错。
const metaOn = has('meta') && !has('no-meta');
let jacket: string | undefined;
if (metaOn && named) {
  const dir = resolveJacketDir(arg('jacket-dir'));
  const p = dir ? join(dir, `${named.musicId}.png`) : null;
  if (p && existsSync(p)) {
    jacket = `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  } else {
    console.error(`警告：没找到曲绘（${p ?? '未配置曲绘目录'}），meta 区只画文字`);
  }
}
const meta = metaOn
  ? {
    title: music?.title,
    subtitle: [difficulty?.toUpperCase(), score?.level !== undefined ? `Lv.${score.level}` : null,
      `Combo ${score?.maxCombo ?? chart.maxCombo}`].filter(Boolean).join(' · '),
    jacket,
    size: Number(arg('meta-size', '192')),
  }
  : undefined;

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
  // 默认按长宽比定列数（横版）；--max-column-height 有值时以它为准。
  // 局部图（--from/--to）默认不切列——本来就是要那一段，切了反而碎。
  maxColumnHeight: has('single-column') ? 0 : (arg('max-column-height') ? Number(arg('max-column-height')) : 0),
  aspect: has('single-column') ? 0 : Number(arg('aspect', range ? '0' : '2.4')),
  columnGap: Number(arg('column-gap', '8')),
  showColumnLabels: !has('no-col-labels'),
  side,
  meta,
});

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);

const kb = (svg.length / 1024).toFixed(1);
console.log(`谱面：${input}`);
console.log(`音符 ${chart.notes.length}（链首 ${chart.roots.length}）／时长 ${chart.duration.toFixed(2)}s（${finishTime === null ? '末音符 + 2 秒' : '曲终'}）／BPM ${chart.bpms.length} 段`);
const totalW = stats.columns * stats.columnWidth + (stats.columns - 1) * Number(arg('column-gap', '8'));
console.log(`版式：${stats.columns} 列 × ${stats.columnWidth}px，列高 ${Math.round(stats.columnHeight)}px，合计 ${Math.round(totalW)} × ${Math.round(stats.columnHeight)} px${range ? `（${range.from}s → ${range.to}s）` : ''}`);
console.log(`绘制：音符 ${stats.notes}（瞬时 ${stats.instants}）／Hold 半边 ${stats.holds}／小节线 ${stats.bars}／拍线 ${stats.beats}／同时押 ${stats.simultaneous}${stats.fallback ? `／兜底 ${stats.fallback}` : ''}`);
if (side) {
  const parts = [
    `MaxCombo ${score?.maxCombo ?? chart.maxCombo}`,
    `自算 ${chart.maxCombo}`,
    music?.title ? `曲名 ${music.title}` : null,
    difficulty ? `难度 ${difficulty}` : null,
    fever ? `Fever ${fever.start.toFixed(2)}s → ${fever.end.toFixed(2)}s` : '无 Fever 段',
  ].filter(Boolean);
  console.log(`侧栏：${parts.join('／')}`);
}
console.log(`输出：${out}（${kb} KiB）`);
