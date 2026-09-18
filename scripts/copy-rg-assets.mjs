/**
 * Copy local RhythmGame sprites, 9-slice borders, and FX textures into gitignored public/rg/.
 *
 * Run from the repo root with source roots (no machine-local defaults):
 *   node scripts/copy-rg-assets.mjs --unity <RhythmGameAssetsDir> --meta <sprite_meta.json>
 *   # or RG_UNITY_ROOT / RG_SPRITE_META
 * Idempotent. Missing PNGs are skipped and listed; nothing is synthesized.
 *
 * Contract:
 *   public/rg/sprites/<name>.png
 *   public/rg/fx/fx.json
 *   public/rg/fx/tex/<texture>.png
 *   public/rg/sprite_meta.json   { [name]: { name, border, rect, ppu } }
 *   public/rg/fonts/<file>.otf
 */
import { access, copyFile, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const outRoot = join(repoRoot, 'public', 'rg');
const outSprites = join(outRoot, 'sprites');
const outFxJson = join(outRoot, 'fx', 'fx.json');
const outFxTex = join(outRoot, 'fx', 'tex');
const outMeta = join(outRoot, 'sprite_meta.json');
const outFonts = join(outRoot, 'fonts');

/** @returns {{ unityRoot: string, spriteMetaSrc: string }} */
function resolveSources(argv = process.argv, env = process.env) {
  let unityRoot = env.RG_UNITY_ROOT?.trim() || '';
  let spriteMetaSrc = env.RG_SPRITE_META?.trim() || '';
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--unity') unityRoot = String(argv[++i] ?? '').trim();
    else if (a === '--meta') spriteMetaSrc = String(argv[++i] ?? '').trim();
  }
  return { unityRoot, spriteMetaSrc };
}
const FONTS = [
  'FOT-RODINPRO-B.otf',
  'FOT-RODINPRO-EB.otf',
];

const numbered = (prefix, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

/** Sprites the preview HUD / note field actually loads. Mental bar chrome is procedural in the Unity HUD (no GameUI PNG). */
const SPRITES = [
  'ui_sc2_ingame_notes_tap',
  'ui_sc2_ingame_notes_hold',
  'ui_sc2_ingame_notes_flick',
  'ui_sc2_ingame_notes_trace',
  'ui_sc2_ingame_notes_texture_arrow',
  'ui_sc2_ingame_notes_icon_flick',
  'ui_sc2_ingame_flick_sign',
  'sc2_ingame_tap_line',
  'ui_sc2_ingame_combo',
  ...numbered('ui_sc2_ingame_num_combo_', 0, 9),
  'ui_sc2_ingame_hantei_perfect',
  'ui_sc2_ingame_hantei_perfect_plus',
  'ui_sc2_ingame_hantei_great',
  'ui_sc2_ingame_hantei_good',
  'ui_sc2_ingame_hantei_bad',
  'ui_sc2_ingame_hantei_miss',
  'ui_sc2_ingame_hantei_auto',
  'ui_sc2_ingame_hantei_fast',
  'ui_sc2_ingame_hantei_slow',
  'ui_sc2_ingame_hantei_flick',
  ...numbered('ui_sc2_ingame_num_score_', 0, 12),
  'ui_sc2_ingame_ap_base',
  'ui_sc2_ingame_voltage_base',
  'ui_sc2_ingame_gage_ap',
  'ui_sc2_ingame_gage_voltage',
  'ui_sc2_ingame_gage_base_02',
  'ui_sc2_button_rank_deco_02',
  'ui_sc2_button_shine',
  'ui_sc2_button_dot',
  'ui_sc2_button_rank_deco_01',
  'ui_sc2_button_rank_shine',
  'ui_sc2_button_rank',
  'ui_sc2_ingame_rank_base',
];

const rel = (abs) => abs.slice(repoRoot.length + 1).replaceAll('\\', '/');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isPng(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const buf = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buf, 0, 8, 0);
    return bytesRead === 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

async function childDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function fxSearchDirs(unityRoot) {
  const art = join(unityRoot, 'Art', 'Resources');
  const runtime = join(unityRoot, 'Runtime', 'Resources');
  const candidates = [
    join(art, 'FxTex'),
    join(art, 'RhythmFx'),
    join(art, 'GameUI'),
    join(runtime, 'FxTex'),
  ];
  for (const root of [art, runtime, join(art, 'RhythmFx')]) {
    for (const child of await childDirs(root)) {
      if (/^fxtex$/i.test(basename(child))) candidates.push(child);
      for (const grand of await childDirs(child)) {
        if (/^fxtex$/i.test(basename(grand))) candidates.push(grand);
      }
    }
  }
  const seen = new Set();
  const dirs = [];
  for (const dir of candidates) {
    const key = dir.toLowerCase();
    if (seen.has(key) || !(await exists(dir))) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

async function findPng(dirs, name) {
  const file = `${name}.png`;
  for (const dir of dirs) {
    const path = join(dir, file);
    if (await exists(path)) return path;
  }
  return null;
}

function texName(raw) {
  const base = String(raw).replaceAll('\\', '/').split('/').pop() ?? '';
  return base.replace(/\.png$/i, '');
}

async function main() {
  const { unityRoot, spriteMetaSrc } = resolveSources();
  if (!unityRoot || !spriteMetaSrc) {
    console.error('Missing source roots. Pass --unity <RhythmGameAssetsDir> --meta <sprite_meta.json>, or set RG_UNITY_ROOT and RG_SPRITE_META.');
    process.exitCode = 1;
    return;
  }
  const fontRoot = join(unityRoot, 'Fonts');
  const copied = [];
  const missing = [];
  const spriteDirs = [
    join(unityRoot, 'Runtime', 'Resources', 'GameUI'),
    join(unityRoot, 'Art', 'Resources', 'GameUI'),
    join(unityRoot, 'Art', 'Resources', 'SelectUI'),
  ];

  await mkdir(outSprites, { recursive: true });
  await mkdir(outFxTex, { recursive: true });
  await mkdir(outFonts, { recursive: true });

  for (const name of SPRITES) {
    const src = await findPng(spriteDirs, name);
    const dest = join(outSprites, `${name}.png`);
    if (!src) {
      missing.push(`sprite ${name}.png (not in GameUI)`);
      continue;
    }
    if (!(await isPng(src))) {
      missing.push(`sprite ${name}.png (present but not a PNG: ${src})`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  for (const file of FONTS) {
    const src = join(fontRoot, file);
    const dest = join(outFonts, file);
    if (!(await exists(src))) {
      missing.push(`font ${file} (not in RhythmGame/Fonts)`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  const fxSrc = join(unityRoot, 'Art', 'Resources', 'RhythmFx', 'fx.json');
  let textures = [];
  if (!(await exists(fxSrc))) {
    missing.push(`fx.json (${fxSrc})`);
  } else {
    await copyFile(fxSrc, outFxJson);
    copied.push(rel(outFxJson));
    const data = JSON.parse(await readFile(fxSrc, 'utf8'));
    const seen = new Set();
    for (const mat of data.mats ?? []) {
      if (!mat?.tex) continue;
      const name = texName(mat.tex);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      textures.push(name);
    }
  }

  const fxDirs = await fxSearchDirs(unityRoot);
  for (const name of textures) {
    const src = await findPng(fxDirs, name);
    const dest = join(outFxTex, `${name}.png`);
    if (!src) {
      missing.push(`fx tex ${name}.png (mats.tex; searched GameUI, RhythmFx, FxTex)`);
      continue;
    }
    if (!(await isPng(src))) {
      missing.push(`fx tex ${name}.png (present but not a PNG: ${src})`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  let metaCount = 0;
  if (!(await exists(spriteMetaSrc))) {
    missing.push(`sprite_meta.json (${spriteMetaSrc})`);
  } else {
    const source = JSON.parse(await readFile(spriteMetaSrc, 'utf8'));
    const slim = {};
    for (const name of SPRITES) {
      const entry = source[name];
      if (!entry || !Array.isArray(entry.border) || !Array.isArray(entry.rect)) {
        missing.push(`sprite border ${name} (not in sprite_meta.json)`);
        continue;
      }
      slim[name] = {
        name,
        border: entry.border,
        rect: entry.rect,
        ppu: entry.ppu,
      };
      metaCount += 1;
    }
    await writeFile(outMeta, `${JSON.stringify(slim, null, 2)}\n`);
    copied.push(rel(outMeta));
  }

  console.log(`copied ${copied.length}`);
  console.log(`missing ${missing.length}`);
  console.log('paths:');
  for (const path of copied) console.log(`  ${path}`);
  console.log('missing sources:');
  if (missing.length === 0) console.log('  (none)');
  else for (const item of missing) console.log(`  ${item}`);
  console.log('contract:');
  console.log('  public/rg/sprites/<name>.png');
  console.log('  public/rg/fx/fx.json');
  console.log('  public/rg/fx/tex/<texture>.png');
  console.log('  public/rg/sprite_meta.json');
  console.log('  public/rg/fonts/<file>.otf');
  console.log(`sprite_meta entries ${metaCount}`);
  console.log(`fx search dirs ${fxDirs.length}: ${fxDirs.join(' | ') || '(none)'}`);
  console.log('mental: no GameUI PNG (Unity mental bar is a procedural capsule); not invented');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
