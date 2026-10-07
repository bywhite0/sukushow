/**
 * 贴图载入：把 `sprite_meta.json` 与各贴图组装成 `SpriteLibrary`。
 *
 * 读取由调用方注入：Node 读文件，浏览器先 fetch 好 `SPRITE_NAMES` 里的贴图再传字节。
 * 两种内嵌模式：
 * - `embed`：转成 data URI 内嵌，SVG 自包含、单文件可移植（体积大）。
 * - `link`：只写相对/绝对路径，SVG 小，但需与贴图目录一同分发。
 */

import type { SpriteMeta } from './geometry';
import { NOTE_SPRITE } from './geometry';
import { type SpriteLibrary, FLICK_EXTRA, emptyLibrary } from './svg';

export type EmbedMode = 'embed' | 'link';

/** 需要载入的全部贴图名：四类音符 + Flick 附加三层。 */
export const SPRITE_NAMES: readonly string[] = [...NOTE_SPRITE, ...FLICK_EXTRA];

export interface SpriteSource {
  /** `sprite_meta.json` 的内容。 */
  meta: unknown;
  /** 按贴图名取 PNG 字节；没有这张贴图时返回 undefined。`link` 模式只用它判断贴图是否存在。 */
  read(name: string): Uint8Array | undefined;
}

export interface LoadOptions {
  mode?: EmbedMode;
  /** `link` 模式下写进 SVG 的路径前缀（相对或绝对）。 */
  linkBase?: string;
}

/** 校验元数据；缺失或损坏时抛错，不静默降级——缺条目会让整层画不出来。 */
export function parseSpriteMeta(raw: unknown): Record<string, SpriteMeta> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('贴图元数据必须是对象');
  for (const [name, m] of Object.entries(raw as Record<string, SpriteMeta>)) {
    if (!Array.isArray(m.rect) || m.rect.length < 4) throw new Error(`元数据 ${name} 缺 rect`);
    if (!Array.isArray(m.border) || m.border.length < 4) throw new Error(`元数据 ${name} 缺 border`);
    if (!(m.ppu > 0)) throw new Error(`元数据 ${name} 的 ppu 无效`);
  }
  return raw as Record<string, SpriteMeta>;
}

/** PNG 字节转 data URI，不依赖 Node 的 Buffer。 */
export function pngDataUri(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * 组装贴图库。任一贴图缺失都只让对应层退化（画兜底矩形或跳过），不整体失败——
 * 但会在 `missing` 里报出来，方便脚本自检。
 */
export function loadSprites(source: SpriteSource, opt: LoadOptions = {}): { lib: SpriteLibrary; missing: string[] } {
  const mode = opt.mode ?? 'embed';
  const linkBase = (opt.linkBase ?? './sprites').replace(/\/$/, '');
  const meta = parseSpriteMeta(source.meta);
  const missing: string[] = [];
  const lib = emptyLibrary();
  const uri = (name: string): string | undefined => {
    const bytes = source.read(name);
    if (!bytes || !meta[name]) { missing.push(name); return undefined; }
    return mode === 'link' ? `${linkBase}/${name}.png` : pngDataUri(bytes);
  };

  for (let t = 0; t < NOTE_SPRITE.length; t++) {
    lib.notes[t] = uri(NOTE_SPRITE[t]);
    lib.meta[t] = lib.notes[t] ? meta[NOTE_SPRITE[t]] : undefined;
  }
  for (let i = 0; i < FLICK_EXTRA.length; i++) {
    lib.extra.uri[i] = uri(FLICK_EXTRA[i]);
    lib.extra.meta[i] = lib.extra.uri[i] ? meta[FLICK_EXTRA[i]] : undefined;
  }
  return { lib, missing };
}
