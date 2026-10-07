/** Node 下的贴图来源：读包内 `public/rg/` 的贴图与 `sprite_meta.json`。 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SpriteSource } from '../src/assets';

const RG = fileURLToPath(new URL('../public/rg/', import.meta.url));

export function fileSpriteSource(spriteDir = join(RG, 'sprites'), metaPath = join(RG, 'sprite_meta.json')): SpriteSource {
  if (!existsSync(metaPath)) throw new Error(`找不到贴图元数据：${metaPath}`);
  return {
    meta: JSON.parse(readFileSync(metaPath, 'utf8')),
    read: name => {
      const file = join(spriteDir, `${name}.png`);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
    },
  };
}
