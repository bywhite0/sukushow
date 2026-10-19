/**
 * 应用内「导出 SVG」：把当前谱面画成一张自包含的 SVG，再用 blob URL 在新标签页里直接查看。
 *
 * 渲染由 `@sukushow/chart-svg` 负责，这里只做三件事：
 * 1. 按 URL 取回 7 张音符 / Flick 贴图与 `sprite_meta.json`（与 CLI 同一份，`pnpm verify:shared-assets` 保证一致）；
 * 2. 把舞台当前的镜像、Fever 与曲终折算成 SVG 选项；
 * 3. 把结果包成 blob URL 打开——不落盘、不经过服务端，刷新页面后即失效。
 */

import type { Chart } from '@sukushow/chart/chart';
import type { FeverWindow } from '@sukushow/chart/fever';
import { SPRITE_NAMES, loadSprites } from '@sukushow/chart-svg/assets';
import { axisDuration, defaultLayout } from '@sukushow/chart-svg/layout';
import { renderSvg, type RenderStats, type SpriteLibrary } from '@sukushow/chart-svg/svg';

/** 音符与 Flick 贴图所在的 public 目录。 */
const SPRITE_DIR = '/rg/sprites';
const SPRITE_META_URL = '/rg/sprite_meta.json';

/**
 * 生成的 blob URL 保留多久。
 *
 * 新标签页打开后浏览器已经拿到内容，但用户可能在那页刷新——撤销太早会白屏，
 * 一直不撤销又会把整张图留在内存里。十分钟是折中；离开页面时统一撤销。
 */
const BLOB_LIFETIME_MS = 10 * 60_000;

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 读取失败（HTTP ${response.status}）`);
  return response;
}

async function fetchSpriteLibrary(): Promise<SpriteLibrary> {
  const [meta, entries] = await Promise.all([
    fetchOk(SPRITE_META_URL).then(response => response.json() as Promise<unknown>),
    Promise.all(SPRITE_NAMES.map(async name => {
      const bytes = new Uint8Array(await (await fetchOk(`${SPRITE_DIR}/${name}.png`)).arrayBuffer());
      return [name, bytes] as const;
    })),
  ]);
  const files = new Map(entries);
  // embed 模式：贴图转 data URI 内嵌，导出的单张 SVG 离开本页也能看。
  const { lib, missing } = loadSprites({ meta, read: name => files.get(name) }, { mode: 'embed' });
  if (missing.length) throw new Error(`缺少贴图：${missing.join('、')}`);
  return lib;
}

/**
 * 曲绘也内嵌成 data URI：blob 页里的相对路径虽然能加载，但存下来的 SVG 会掉图。
 * 跨域图取不回来（缺 CORS）时退回原链接——图仍能显示，只是不再是自包含文件。
 */
async function embedJacket(url: string | null | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) return url;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(binary)}`;
  } catch {
    return url;
  }
}

let libraryRequest: Promise<SpriteLibrary> | null = null;

/** 贴图只取一次；失败时清掉缓存，下次点击重试。 */
function spriteLibrary(): Promise<SpriteLibrary> {
  libraryRequest ??= fetchSpriteLibrary().catch((error: unknown) => {
    libraryRequest = null;
    throw error;
  });
  return libraryRequest;
}

export type SvgExportInput = {
  chart: Chart;
  /** 曲终（秒）：时间轴画到这里；null 时用谱面自带的兜底时长。 */
  finishTime: number | null;
  /** 与舞台一致的左右镜像。 */
  mirror: boolean;
  /** 当前生效的 Fever 时段；null 表示不画。 */
  fever: FeverWindow | null;
  title?: string;
  difficulty?: string | null;
  /** 定数（`MusicScores` 的 Level）；曲库缺该字段时留空，只写难度名。 */
  level?: number | null;
  /** 演唱署名，接在底部信息区的曲名右侧。 */
  artist?: string | null;
  /** 底部信息区的封面（data URI 或链接）。 */
  jacket?: string | null;
};

/** 生成 SVG 文本与渲染统计（不碰 DOM，便于单独验证）。 */
export async function buildChartSvg(input: SvgExportInput): Promise<{ svg: string; stats: RenderStats }> {
  const [lib, jacket] = await Promise.all([spriteLibrary(), embedJacket(input.jacket)]);
  // renderSvg 用 chart.duration 定时间轴，晚于它的 hold 尾会被截掉；先按曲终写进副本。
  const chart: Chart = { ...input.chart, duration: axisDuration(input.chart, input.finishTime) };
  // 底部信息区：标题上方一行「难度 + 定数 + 谱面预览」，演唱者接在标题右侧同一基线上。
  const level = input.level == null ? '' : `Lv.${input.level}`;
  const eyebrow = [input.difficulty, level, '谱面预览'].filter(Boolean).join(' ');
  return renderSvg(chart, lib, {
    layout: { ...defaultLayout(), mirror: input.mirror },
    showMeasures: true,
    showBeats: true,
    showSimultaneous: true,
    showGrid: true,
    // 小节号画在左侧栏，轨道内的重复标号会挡住音符。
    showBarNumbers: false,
    background: '#0d1220',
    allowFallback: true,
    // 曲名与难度只出现在底部信息区；侧栏照 CLI 的口径只留一行 Combo，免得重复又压到轨道上。
    side: { barNumbers: true, bpm: true, beats: true, fever: input.fever, info: [`Combo ${chart.maxCombo}`] },
    meta: input.title || jacket
      ? { eyebrow, title: input.title, aside: input.artist ?? undefined, jacket }
      : undefined,
  });
}

const liveBlobUrls = new Set<string>();

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 给根 `<svg>` 插一个 `<title>`：新标签页的标题栏与书签都读它，
 * 否则 blob URL 在标签上只剩一串 `blob:http://…` 的 UUID。
 */
function withDocumentTitle(svg: string, title: string): string {
  const rootEnd = svg.indexOf('>');
  if (rootEnd < 0 || !title) return svg;
  return `${svg.slice(0, rootEnd + 1)}<title>${escapeXml(title)}</title>${svg.slice(rootEnd + 1)}`;
}

/**
 * 把 SVG 包成 blob URL 并在新标签页打开。
 *
 * 弹窗被拦截时 `opened` 为 false，调用方应把 `url` 当普通链接交给用户点开——
 * 那一下点击是新的用户手势，不会再被拦。
 */
export function openSvgInNewTab(svg: string, title = ''): { url: string; opened: boolean } {
  const url = URL.createObjectURL(new Blob([withDocumentTitle(svg, title)], { type: 'image/svg+xml;charset=utf-8' }));
  liveBlobUrls.add(url);
  setTimeout(() => releaseSvgUrl(url), BLOB_LIFETIME_MS);
  const tab = window.open(url, '_blank');
  if (tab) tab.opener = null;
  return { url, opened: tab !== null };
}

/** 撤销单个 blob URL（重复调用无害）。 */
export function releaseSvgUrl(url: string): void {
  if (liveBlobUrls.delete(url)) URL.revokeObjectURL(url);
}

/** 撤销所有仍在有效期内的 blob URL；视图卸载时调用。 */
export function releaseSvgUrls(): void {
  for (const url of [...liveBlobUrls]) releaseSvgUrl(url);
}
