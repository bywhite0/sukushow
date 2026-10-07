import * as THREE from 'three';
import type { SpriteMeta } from './slice';
import { feverCorePrefab } from './feverCore';
import { readResponseBytes, type DownloadProgress } from './resourceDownload';

export interface FxKey { t: number; v: number; i?: number; o?: number }
export interface FxMM { k: number; v: number; lo: number; hi: number; mult: number; keys?: FxKey[]; minKeys?: FxKey[] }
export interface FxGrad { rgb?: { t: number; r: number; g: number; b: number }[]; a?: { t: number; v: number }[] }
export interface FxNode {
  name: string; parent: number;
  px: number; py: number; pz: number; rx: number; ry: number; rz: number; rw: number;
  sx: number; sy: number; sz: number; active: boolean;
  ps?: {
    en: boolean; dur: number; loop: boolean; maxp: number; local: boolean; grav: number;
    /** 序列化 `moveWithTransform`（`int`，Unity 保留的旧名）＝ `ParticleSystemSimulationSpace`：0=Local 1=World 2=Custom。 */
    world?: boolean;
    col0R: number; col0G: number; col0B: number; col0A: number; size3d?: boolean;
    delay?: FxMM; life?: FxMM; speed?: FxMM; size?: FxMM; sizeY?: FxMM; rot?: FxMM;
    rate?: FxMM; rateDist?: FxMM; bursts?: { t: number; count: FxMM; cycles: number; interval: number; prob: number }[];
    shape?: {
      en: boolean; type: number; angle: number; radius: number; sx: number; sy: number; sz: number;
      px?: number; py?: number; pz?: number; rotx?: number; roty?: number; rotz?: number; randDir: number;
    };
    col?: { en: boolean; mode: number; max?: FxGrad; min?: FxGrad };
    vel?: { en: boolean; world: boolean; x: FxMM; y: FxMM; z: FxMM };
    /**
     * `ForceOverLifetimeModule`：**加速度**（单位/秒²），不是速度——积分时按 `v += F·dt`。
     * `world` 即 `inWorldSpace`；为 `false` 时按节点旋转把力转到世界系。
     */
    force?: { en: boolean; world: boolean; x: FxMM; y: FxMM; z: FxMM };
    sizeol?: { en: boolean; curve?: FxMM; y?: FxMM; sep?: boolean };
    /** LimitVelocityOverLifetime — clamps |v| toward speed with dampen. */
    limit?: { en: boolean; dampen: number; speed?: FxMM };
    /** Rotation over Lifetime (rad/s); `curve` is Z / billboard spin when not sep. */
    rotol?: { en: boolean; curve?: FxMM; sep?: boolean; x?: FxMM; y?: FxMM };
    trail?: {
      en: boolean; ratio: number; life?: FxMM; minVertexDist: number;
      sizeWidth?: boolean; inheritColor?: boolean; width?: FxMM;
      colMode?: number; colMax?: FxGrad; colMin?: FxGrad; colMaxA?: number;
      colorOverTrail?: FxGrad;
    };
  };
  rend?: { off?: boolean; mode: number; align: number; mat?: string; trailMat?: string; mesh?: string; sortOrder?: number };
}
export interface FxPrefab {
  id: string; nodes: FxNode[]; root: number;
  coreUnits?: { node: number; baseSize: number }[];
  pArr?: number[]; pArr2?: number[]; impact: number; p00: number;
}
export interface FxMat { id: string; name: string; shader: string; tex: string; additive: boolean; tintR: number; tintG: number; tintB: number; tintA: number }
export interface FxFile { prefabs: FxPrefab[]; fever?: FxPrefab[]; mats: FxMat[] }

export interface RgLibrary {
  meta: Record<string, SpriteMeta>;
  sprites: Record<string, THREE.Texture>;
  fx: FxFile | null;
  fxTex: Record<string, THREE.Texture>;
}

const NOTE_SPRITES = [
  'ui_sc2_ingame_notes_tap',
  'ui_sc2_ingame_notes_hold',
  'ui_sc2_ingame_notes_flick',
  'ui_sc2_ingame_notes_trace',
  'sc2_ingame_tap_line',
];

/** fx.json 当前引用的贴图；与 public/rg/fx/tex 保持同一命名。 */
const FX_TEXTURES = [
  'circle_002', 'Ripples_02', 'Sc2_NotesEffectCircle_009', 'Sc2_NotesEffectCircle_010',
  'glow_06', 'gradation_texture02', 'sc2_Effect_circle03', 'sc2_Effect_cube02',
  'sc2_Particle_CrosGlow', 'sc2_Particle_light02', 'sc2_bg_effect_star_001',
  'sc2_effect_star_00_texture_for_note', 'sc2_cutin_Effect_Particle02',
  'sc2_result_effect_glitter_lyrics_01', 'sc2_Result_effect_glow_02', 'sc2_Effect_Arrow04',
  'sc2_Effect_Particle02', 'sc2_Effect_ParticleA001', 'sc2_Effect_star01',
  'sc2_Particle_CrosGlow_set01', 'sc2_Particle_light01', 'sc2_Particle_light03',
  'sc2_effect_combo_glow_002', 'ui_sc2_ingame_num_combo_Effect',
  'sc2_feverLine01', 'sc2_NotesEffectCircle_007', 'fever_mask',
] as const;

export const RG_RESOURCE_URLS = [
  '/rg/sprite_meta.json',
  ...NOTE_SPRITES.map((name) => `/rg/sprites/${name}.png`),
  ...['ui_sc2_ingame_notes_texture_arrow', 'ui_sc2_ingame_flick_sign', 'ui_sc2_ingame_notes_icon_flick']
    .map((name) => `/rg/sprites/${name}.png`),
  '/rg/fx/fx.json',
  ...FX_TEXTURES.map((name) => `/rg/fx/tex/${name}.png`),
];

export type RgLoadProgress = DownloadProgress & { url: string };
type RgProgressListener = (progress: RgLoadProgress) => void;

function loadTexture(url: string, repeat = false, onProgress?: RgProgressListener) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    onProgress?.({ url, phase: 'download', downloadedBytes: 0 });
    new THREE.TextureLoader().load(url, tex => {
      // 自定义 sprite/FX shader 直接在显示颜色上运算，不做线性空间输出转换。
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      onProgress?.({ url, phase: 'ready', downloadedBytes: 0 });
      resolve(tex);
    }, undefined, () => {
      onProgress?.({ url, phase: 'ready', downloadedBytes: 0 });
      reject(new Error(url));
    });
  });
}

async function optionalTexture(url: string, repeat = false, onProgress?: RgProgressListener) {
  try { return await loadTexture(url, repeat, onProgress); } catch { return null; }
}

/** Loads /rg/*. Missing meta or a required note sprite returns null (procedural fallback). */
export async function loadRgLibrary(onProgress?: RgProgressListener): Promise<RgLibrary | null> {
  const loadJson = async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        onProgress?.({ url, phase: 'ready', downloadedBytes: 0 });
        return null;
      }
      const bytes = await readResponseBytes(res, (progress) => onProgress?.({ url, ...progress }));
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      onProgress?.({ url, phase: 'ready', downloadedBytes: 0 });
      return null;
    }
  };
  let meta: Record<string, SpriteMeta>;
  const loadedMeta = await loadJson<Record<string, SpriteMeta>>('/rg/sprite_meta.json');
  if (!loadedMeta) return null;
  meta = loadedMeta;
  const sprites: Record<string, THREE.Texture> = {};
  try {
    await Promise.all(NOTE_SPRITES.map(async name => {
      sprites[name] = await loadTexture(`/rg/sprites/${name}.png`, false, onProgress);
    }));
  } catch { return null; }
  for (const name of ['ui_sc2_ingame_notes_texture_arrow', 'ui_sc2_ingame_flick_sign', 'ui_sc2_ingame_notes_icon_flick']) {
    const tex = await optionalTexture(`/rg/sprites/${name}.png`, name.includes('arrow'), onProgress);
    if (tex) sprites[name] = tex;
  }
  let fx: FxFile | null = null;
  const fxTex: Record<string, THREE.Texture> = {};
  try {
    fx = await loadJson<FxFile>('/rg/fx/fx.json');
    if (fx) {
      if (fx.fever) {
        fx.fever = fx.fever.map(f => ({
          ...f,
          impact: f.impact ?? -1,
          p00: f.p00 ?? -1,
          root: f.root ?? 0,
        }));
        for (const side of ['left', 'right'] as const) {
          const core = feverCorePrefab(side);
          if (!fx.fever.some(f => f.id === core.id)) fx.fever.push(core);
        }
      }
      const names = [...new Set([...(fx.mats || []).map(m => m.tex).filter(Boolean),
        'sc2_feverLine01', 'sc2_NotesEffectCircle_007', 'fever_mask'])];
      await Promise.all(names.map(async name => {
        const tex = await optionalTexture(`/rg/fx/tex/${name}.png`, false, onProgress);
        if (tex) {
          // Built-in Mobile/Particles/Additive samples without sRGB decode.
          tex.colorSpace = THREE.NoColorSpace;
          tex.needsUpdate = true;
          fxTex[name] = tex;
        }
      }));
    }
  } catch { fx = null; }
  return { meta, sprites, fx, fxTex };
}

export function whiteTexture() {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
