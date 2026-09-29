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
