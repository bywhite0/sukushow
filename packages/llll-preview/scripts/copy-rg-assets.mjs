/**
 * 把本地 RhythmGame 贴图、九宫格边框数据、特效贴图与结算界面美术资源拷进 apps/web/public/rg/。
 *
 * 在仓库根目录运行，源目录由参数给出（脚本内不写本机路径）：
 *   node packages/llll-preview/scripts/copy-rg-assets.mjs --unity <RhythmGameAssetsDir> --meta <sprite_meta.json>
 *   # 也可用环境变量 RG_UNITY_ROOT / RG_SPRITE_META
 * 幂等：已存在的贴图（sprites / banner / fx/tex）一律跳过并报告，只补缺失文件；重复运行不改动已入库字节。
 * 缺 PNG 只记录跳过，不做任何合成。
 *
 * 输出契约：
 *   apps/web/public/rg/sprites/<name>.png
 *   apps/web/public/rg/fx/fx.json
 *   apps/web/public/rg/fx/tex/<texture>.png
 *   apps/web/public/rg/sprite_meta.json   { [name]: { name, border, rect, ppu } }
 *   apps/web/public/rg/fonts/<file>.otf
 *   apps/web/public/rg/banner/<texture>.png
 */
import { access, copyFile, mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const outRoot = join(repoRoot, 'apps', 'web', 'public', 'rg');
const outSprites = join(outRoot, 'sprites');
const outFxJson = join(outRoot, 'fx', 'fx.json');
const outFxTex = join(outRoot, 'fx', 'tex');
const outMeta = join(outRoot, 'sprite_meta.json');
const outBanner = join(outRoot, 'banner');
const outFonts = join(outRoot, 'fonts');

/** 解析源目录：命令行参数优先，其次环境变量。 */
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

/** fx.json 的 `mats[]` 之外、仍须随预览分发的贴图（Fever 与 HUD 特效直接按文件名引用）。 */
const FX_TEX_EXTRA = [
  'fever_mask',
  'sc2_NotesEffectCircle_007',
  'sc2_feverLine01',
  'APRate_OutlineEffect',
  'Default-Particle',
  'sc2_outgameLvUp_glitter_lyric_01',
  'sc2_effect_combo_glow_002_alpha',
];

const numbered = (prefix, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

/** 预览 HUD / 音符区实际加载的贴图（Mental 条在 Unity HUD 里是程序化胶囊，没有 GameUI PNG）。 */
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
  'ui_sc2_result_base_01',
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

/** 曲终横幅 RhythmGameComboResult 四档用到的贴图（UI Image + 粒子材质 _MainTex），与 src/comboResultClip.ts 的 COMBO_RESULT_TEXTURES 一致。 */
const BANNER_TEX = [
  'sc2_Result_Particle_light03',
  'sc2_Result_effect_glow_02',
  'sc2_Result_effect_impact01',
  'sc2_ingameStartEnd_glitter_lyric_01',
  'sc2_result_effect_glitter_lyric_01',
  'ui_sc2_ingame_end_AllperfectTitle',
  'ui_sc2_ingame_end_ClearTitle',
  'ui_sc2_ingame_end_FnishTitle',
  'ui_sc2_ingame_end_FullcomboTitle',
  'ui_sc2_ingame_end_allperfect',
  'ui_sc2_ingame_end_clear',
  'ui_sc2_ingame_end_finish',
  'ui_sc2_ingame_end_fullcombo',
  'ui_sc2_ingame_end_line',
  'ui_sc2_ingame_end_star01',
  'ui_sc2_ingame_end_star02',
];

/**
 * 结算界面（RhythmGameResultScene）用到的 UI 贴图：src/resultScreenClip.ts 的 RESULT_SPRITES 全量，
 * 外加渲染器按运行时状态换用的清曲灯 ui_sc2_ic_note_none / _02（数据里只出现 _01 / _03）与
 * 曲目类型图标 icon_song_type_0…3（SongType 取自 Musics masterdata）。目标路径与 HUD 贴图同目录：apps/web/public/rg/sprites/。
 */
const RESULT_SPRITES = [
  'ui_sc2_button_rank',
  'ui_sc2_button_rank_deco_01',
  'ui_sc2_button_rank_deco_02',
  'ui_sc2_button_rank_shine',
  'ui_sc2_ic_note_01',
  'ui_sc2_ic_note_02',
  'ui_sc2_ic_note_03',
  'ui_sc2_ic_note_none',
  'ui_sc2_ingame_hantei_bad',
  'ui_sc2_ingame_hantei_good',
  'ui_sc2_ingame_hantei_great',
  'ui_sc2_ingame_hantei_miss',
  'ui_sc2_ingame_hantei_perfect',
  'ui_sc2_ingame_hantei_perfect_plus',
  'ui_sc2_result_arrow',
  'ui_sc2_result_base_01',
  'ui_sc2_result_base_03',
  'ui_sc2_result_title_a',
  'ui_sc2_result_title_c',
  'ui_sc2_result_title_e',
  'ui_sc2_result_title_i',
  'ui_sc2_result_title_l',
  'ui_sc2_result_title_r',
  'ui_sc2_result_title_star',
  'ui_sc2_result_title_v',
  'ui_sukusute_icon_smile',
  'icon_song_type_0',
  'icon_song_type_1',
  'icon_song_type_2',
  'icon_song_type_3',
];

/** 结算界面粒子贴图（4.12.0 BannerTex）；与曲终横幅纹理同目录 apps/web/public/rg/banner/。 */
const RESULT_BANNER_TEX = [
  'sc2_Result_effect_glow_01',
  'sc2_Result_effect_star_00_texture',
  'rhythmgame_scorerankicon',
];

/** sprites 拷贝清单：HUD 与结算界面合并去重（同名只拷一次）。 */
const spritePlan = [...new Set([...SPRITES, ...RESULT_SPRITES])];

/** banner 拷贝清单：曲终横幅与结算粒子贴图合并去重。 */
const bannerPlan = [...new Set([...BANNER_TEX, ...RESULT_BANNER_TEX])];

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
    // AssetStudio 扁平导出目录（导出产物常见形态）。
    join(unityRoot, 'Texture2D'),
    join(unityRoot, 'Assets', 'Texture2D'),
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
    console.error('缺少源目录：请传 --unity <RhythmGameAssetsDir> --meta <sprite_meta.json>，或设置 RG_UNITY_ROOT / RG_SPRITE_META。');
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

  const kept = [];
  for (const name of spritePlan) {
    const dest = join(outSprites, `${name}.png`);
    // 已入库的贴图不覆盖（仓库文件可能来自另一版导出）；只补缺失文件。
    if (await exists(dest)) {
      kept.push(rel(dest));
      continue;
    }
    const src = await findPng(spriteDirs, name);
    if (!src) {
      missing.push(`sprite ${name}.png（GameUI / SelectUI 里没有）`);
      continue;
    }
    if (!(await isPng(src))) {
      missing.push(`sprite ${name}.png（存在但不是 PNG：${src}）`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  for (const file of FONTS) {
    const src = join(fontRoot, file);
    const dest = join(outFonts, file);
    if (!(await exists(src))) {
      missing.push(`font ${file}（RhythmGame/Fonts 里没有）`);
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
    for (const name of FX_TEX_EXTRA) {
      if (seen.has(name)) continue;
      seen.add(name);
      textures.push(name);
    }
  }

  const fxDirs = await fxSearchDirs(unityRoot);
  for (const name of textures) {
    const dest = join(outFxTex, `${name}.png`);
    if (await exists(dest)) {
      kept.push(rel(dest));
      continue;
    }
    const src = await findPng(fxDirs, name);
    if (!src) {
      missing.push(`fx tex ${name}.png（mats.tex 引用；已搜索 GameUI、RhythmFx、FxTex）`);
      continue;
    }
    if (!(await isPng(src))) {
      missing.push(`fx tex ${name}.png（存在但不是 PNG：${src}）`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  await mkdir(outBanner, { recursive: true });
  const bannerDirs = [join(unityRoot, 'Art', 'Resources', 'BannerTex')];
  for (const name of bannerPlan) {
    const dest = join(outBanner, `${name}.png`);
    if (await exists(dest)) {
      kept.push(rel(dest));
      continue;
    }
    const src = await findPng(bannerDirs, name);
    if (!src) {
      missing.push(`banner tex ${name}.png（BannerTex 里没有）`);
      continue;
    }
    if (!(await isPng(src))) {
      missing.push(`banner tex ${name}.png（存在但不是 PNG：${src}）`);
      continue;
    }
    await copyFile(src, dest);
    copied.push(rel(dest));
  }

  let metaCount = 0;
  if (!(await exists(spriteMetaSrc))) {
    missing.push(`sprite_meta.json（${spriteMetaSrc} 不存在）`);
  } else {
    const source = JSON.parse(await readFile(spriteMetaSrc, 'utf8'));
    // 先保留既有输出条目，再从源 meta 覆盖 / 追加：清单增删不会挤掉历史 sprite 的边框数据。
    // 结算界面贴图都是纯贴图、不需要九宫格数据，只按 HUD 清单写 meta。
    const slim = (await exists(outMeta)) ? JSON.parse(await readFile(outMeta, 'utf8')) : {};
    for (const name of SPRITES) {
      const entry = source[name];
      if (!entry || !Array.isArray(entry.border) || !Array.isArray(entry.rect)) {
        missing.push(`sprite border ${name}（sprite_meta.json 里没有）`);
        continue;
      }
      slim[name] = {
        name,
        border: entry.border,
        rect: entry.rect,
        ppu: entry.ppu,
      };
    }
    metaCount = Object.keys(slim).length;
    await writeFile(outMeta, `${JSON.stringify(slim, null, 2)}\n`);
    copied.push(rel(outMeta));
  }

  console.log(`已拷贝 ${copied.length}`);
  console.log(`kept ${kept.length}（结算界面贴图已存在，未覆盖）`);
  console.log(`缺失 ${missing.length}`);
  console.log('已拷贝：');
  for (const path of copied) console.log(`  ${path}`);
  console.log('已存在（未覆盖）：');
  if (kept.length === 0) console.log('  （无）');
  else for (const path of kept) console.log(`  ${path}`);
  console.log('缺失来源：');
  if (missing.length === 0) console.log('  （无）');
  else for (const item of missing) console.log(`  ${item}`);
  console.log('契约：');
  console.log('  public/rg/sprites/<name>.png');
  console.log('  public/rg/fx/fx.json');
  console.log('  public/rg/fx/tex/<texture>.png');
  console.log('  public/rg/sprite_meta.json');
  console.log('  public/rg/fonts/<file>.otf');
  console.log('  public/rg/banner/<texture>.png');
  console.log(`sprite_meta 条目 ${metaCount}`);
  console.log(`fx 搜索目录 ${fxDirs.length}：${fxDirs.join(' | ') || '（无）'}`);
  console.log('mental：Unity HUD 的 Mental 条是程序化胶囊，没有 GameUI PNG，不臆造。');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
