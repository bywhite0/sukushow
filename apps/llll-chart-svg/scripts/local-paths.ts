/**
 * 本地路径配置：谱面目录与对照仓库位置因机器而异，不入库。
 *
 * 读取顺序：`scripts/link-assets.local.json` → 命令行参数 → 环境变量。
 * 文件形如：
 *   { "chartDir": "…/cache/plain", "peerRepo": "…/llll-flat-preview" }
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LocalPaths {
  /** 存放 `rhythmgame_chart_*.bytes` 的目录。 */
  chartDir?: string;
  /** 对照仓库（llll-flat-preview）的路径。 */
  peerRepo?: string;
  /**
   * 主数据目录（`MusicScores.yaml` / `Musics.yaml`）。
   *
   * 侧栏的 MaxCombo 取 `MusicScores.yaml` 的每难度 `MaxCombo`（权威值，比从谱面自算可靠）；
   * Fever 段号取 `Musics.yaml` 的 `FeverSectionNo`。
   */
  masterdataDir?: string;
  /** `musicscore_*.csv` 所在目录（与谱面同目录，即 `cache/plain`）。 */
  musicscoreDir?: string;
  /**
   * 已解包的曲绘目录（`<曲目Id>.png`）。
   *
   * 曲绘源包是 `cache/plain/image_music_thumbnail_<id>.assetbundle`，需解包才可用；
   * 对照仓库 llll-preview-web 已解好一批在 `public/assets/jacket/`。
   */
  jacketDir?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'link-assets.local.json');

export function loadLocalPaths(): LocalPaths {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as LocalPaths;
  } catch (e) {
    throw new Error(`读取 ${configPath} 失败：${(e as Error).message}`);
  }
}

/** 谱面目录：命令行 > 配置 > 报错。 */
export function chartDir(cliValue?: string): string {
  const dir = cliValue ?? process.env.LLLL_CHART_DIR ?? loadLocalPaths().chartDir;
  if (!dir) {
    throw new Error(
      '没有指定谱面目录。用法：pnpm verify:corpus <目录>，'
      + `或在 ${configPath} 里写 {"chartDir": "…"}，或设环境变量 LLLL_CHART_DIR。`,
    );
  }
  return dir;
}

/** 对照仓库：命令行 > 配置 > 报错。 */
export function peerRepo(cliValue?: string): string {
  const dir = cliValue ?? process.env.LLLL_PEER_REPO ?? loadLocalPaths().peerRepo;
  if (!dir) {
    throw new Error(
      '没有指定对照仓库。用法：pnpm cross-check <仓库路径>，'
      + `或在 ${configPath} 里写 {"peerRepo": "…"}，或设环境变量 LLLL_PEER_REPO。`,
    );
  }
  return dir;
}

/** 主数据目录：命令行 > 配置 > 环境变量。未配置时返回 undefined（侧栏信息降级）。 */
export function masterdataDir(cliValue?: string): string | undefined {
  return cliValue ?? process.env.LLLL_MASTERDATA_DIR ?? loadLocalPaths().masterdataDir;
}

/** `musicscore_*.csv` 目录：命令行 > 配置 > 与谱面同目录。 */
export function musicscoreDir(cliValue?: string, fallback?: string): string | undefined {
  return cliValue ?? process.env.LLLL_MUSICSCORE_DIR ?? loadLocalPaths().musicscoreDir ?? fallback;
}

/** 曲绘目录：命令行 > 配置 > 环境变量。未配置时 meta 区不画封面。 */
export function jacketDir(cliValue?: string): string | undefined {
  return cliValue ?? process.env.LLLL_JACKET_DIR ?? loadLocalPaths().jacketDir;
}
