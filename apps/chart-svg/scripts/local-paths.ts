/**
 * 运行时路径配置：主数据、CSV 与曲绘可由环境变量或命令行覆盖。
 *
 * 读取顺序：命令行参数 → 环境变量 → 本地配置。
 * 文件形如：
 *   { "masterdataDir": "…", "musicscoreDir": "…", "jacketDir": "…" }
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LocalPaths {
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
   * 统一前端的曲绘资源位于 `apps/web/public/assets/jacket/`。
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
