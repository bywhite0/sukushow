import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const apps = [resolve(root, 'apps/web'), resolve(root, 'packages/chart-svg')];
const spriteNames = [
  'ui_sc2_ingame_flick_sign',
  'ui_sc2_ingame_notes_flick',
  'ui_sc2_ingame_notes_hold',
  'ui_sc2_ingame_notes_icon_flick',
  'ui_sc2_ingame_notes_tap',
  'ui_sc2_ingame_notes_texture_arrow',
  'ui_sc2_ingame_notes_trace',
];
const bundles = apps;
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const readMeta = path => JSON.parse(readFileSync(path, 'utf8'));
const reference = resolve(root, 'apps/web/public/rg');
const referenceMeta = readMeta(resolve(reference, 'sprite_meta.json'));
const errors = [];

for (const name of spriteNames) {
  const expected = hash(resolve(reference, 'sprites', `${name}.png`));
  for (const app of apps) {
    const actual = resolve(app, 'public/rg/sprites', `${name}.png`);
    if (hash(actual) !== expected) errors.push(`${app}: ${name}.png 与 LLLL 资源不一致`);
  }
}
for (const app of apps) {
  const meta = readMeta(resolve(app, 'public/rg/sprite_meta.json'));
  for (const name of spriteNames) {
    if (JSON.stringify(meta[name]) !== JSON.stringify(referenceMeta[name])) {
      errors.push(`${app}: sprite_meta.json 中 ${name} 元数据与 LLLL 资源不一致`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`shared 2D sprite set verified: ${spriteNames.length} sprites, ${bundles.length} bundles`);
}
