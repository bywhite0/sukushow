/**
 * 贴图载入：把 `public/rg/sprites/*.png` 与 `sprite_meta.json` 读成 `SpriteLibrary`。
 *
 * 两种内嵌模式：
 * - `embed`：转成 data URI 内嵌，SVG 自包含、单文件可移植（体积大）。
 * - `link`：只写相对/绝对路径，SVG 小，但需与贴图目录一同分发。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SpriteMeta } from './geometry';
import { FLICK_ARROW, FLICK_ICON, FLICK_SIGN, NOTE_SPRITE } from './geometry';
import { type SpriteLibrary, FLICK_EXTRA, emptyLibrary } from './svg';

export type EmbedMode = 'embed' | 'link';

export interface LoadOptions {
  /** 贴图目录，默认仓库内 `public/rg/sprites`。 */
  spriteDir?: string;
  /** 元数据文件，默认仓库内 `public/rg/sprite_meta.json`。 */
  metaPath?: string;
  mode?: EmbedMode;
  /** `link` 模式下写进 SVG 的路径前缀（相对或绝对）。 */
  linkBase?: string;
}

/** 仓库内默认贴图目录（相对本文件所在包根）。 */
export function defaultSpriteDir(): string {
  return resolve(new URL('../public/rg/sprites', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}

export function defaultMetaPath(): string {
  return resolve(new URL('../public/rg/sprite_meta.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}

/** 读元数据；缺失或损坏时抛错，不静默降级——缺条目会让整层画不出来。 */
export function loadMeta(path = defaultMetaPath()): Record<string, SpriteMeta> {
  if (!existsSync(path)) throw new Error(`找不到贴图元数据：${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, SpriteMeta>;
  for (const [name, m] of Object.entries(raw)) {
    if (!Array.isArray(m.rect) || m.rect.length < 4) throw new Error(`元数据 ${name} 缺 rect`);
    if (!Array.isArray(m.border) || m.border.length < 4) throw new Error(`元数据 ${name} 缺 border`);
    if (!(m.ppu > 0)) throw new Error(`元数据 ${name} 的 ppu 无效`);
  }
  return raw;
}

/** 读一张贴图并转成 data URI（或返回链接路径）。 */
function spriteUri(dir: string, name: string, mode: EmbedMode, linkBase: string): string | undefined {
  const file = join(dir, `${name}.png`);
  if (!existsSync(file)) return undefined;
  if (mode === 'link') return `${linkBase.replace(/\/$/, '')}/${name}.png`;
  return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

/**
 * 组装贴图库。任一贴图缺失都只让对应层退化（画兜底矩形或跳过），不整体失败——
 * 但会在 `missing` 里报出来，方便脚本自检。
 */
export function loadSprites(opt: LoadOptions = {}): { lib: SpriteLibrary; missing: string[] } {
  const dir = opt.spriteDir ?? defaultSpriteDir();
  const mode = opt.mode ?? 'embed';
  const linkBase = opt.linkBase ?? './sprites';
  const meta = loadMeta(opt.metaPath ?? defaultMetaPath());
  const missing: string[] = [];
  const lib = emptyLibrary();

  for (let t = 0; t < NOTE_SPRITE.length; t++) {
    const name = NOTE_SPRITE[t];
    const uri = spriteUri(dir, name, mode, linkBase);
    if (!uri || !meta[name]) { missing.push(name); lib.notes[t] = undefined; lib.meta[t] = undefined; continue; }
    lib.notes[t] = uri;
    lib.meta[t] = meta[name];
  }

  const extras = [FLICK_ARROW, FLICK_ICON, FLICK_SIGN];
  for (let i = 0; i < extras.length; i++) {
    const name = extras[i];
    const uri = spriteUri(dir, name, mode, linkBase);
    if (!uri || !meta[name]) { missing.push(name); lib.extra.uri[i] = undefined; lib.extra.meta[i] = undefined; continue; }
    lib.extra.uri[i] = uri;
    lib.extra.meta[i] = meta[name];
  }

  void FLICK_EXTRA;
  return { lib, missing };
}
