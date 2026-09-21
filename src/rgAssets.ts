import * as THREE from 'three';
import type { SpriteMeta } from './slice';

export interface FxKey { t: number; v: number; i?: number; o?: number }
export interface FxMM { k: number; v: number; lo: number; hi: number; mult: number; keys?: FxKey[]; minKeys?: FxKey[] }
export interface FxGrad { rgb?: { t: number; r: number; g: number; b: number }[]; a?: { t: number; v: number }[] }
export interface FxNode {
  name: string; parent: number;
  px: number; py: number; pz: number; rx: number; ry: number; rz: number; rw: number;
  sx: number; sy: number; sz: number; active: boolean;
  ps?: {
    en: boolean; dur: number; loop: boolean; maxp: number; local: boolean; grav: number;
    col0R: number; col0G: number; col0B: number; col0A: number; size3d?: boolean;
    delay?: FxMM; life?: FxMM; speed?: FxMM; size?: FxMM; sizeY?: FxMM; rot?: FxMM;
    rate?: FxMM; bursts?: { t: number; count: FxMM; cycles: number; interval: number; prob: number }[];
    shape?: {
      en: boolean; type: number; angle: number; radius: number; sx: number; sy: number; sz: number;
      px?: number; py?: number; pz?: number; rotx?: number; roty?: number; rotz?: number; randDir: number;
    };
    col?: { en: boolean; mode: number; max?: FxGrad; min?: FxGrad };
    vel?: { en: boolean; world: boolean; x: FxMM; y: FxMM; z: FxMM };
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

function loadTexture(url: string, repeat = false) {
  return new Promise<THREE.Texture>((resolve, reject) => {
    new THREE.TextureLoader().load(url, tex => {
      // 自定义 sprite/FX shader 直接在显示颜色上运算，不做线性空间输出转换。
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      resolve(tex);
    }, undefined, () => reject(new Error(url)));
  });
}

async function optionalTexture(url: string, repeat = false) {
  try { return await loadTexture(url, repeat); } catch { return null; }
}

/** Loads /rg/*. Missing meta or a required note sprite returns null (procedural fallback). */
export async function loadRgLibrary(): Promise<RgLibrary | null> {
  let meta: Record<string, SpriteMeta>;
  try {
    const res = await fetch('/rg/sprite_meta.json');
    if (!res.ok) return null;
    meta = await res.json() as Record<string, SpriteMeta>;
  } catch { return null; }
  const sprites: Record<string, THREE.Texture> = {};
  try {
    await Promise.all(NOTE_SPRITES.map(async name => { sprites[name] = await loadTexture(`/rg/sprites/${name}.png`); }));
  } catch { return null; }
  for (const name of ['ui_sc2_ingame_notes_texture_arrow', 'ui_sc2_ingame_flick_sign', 'ui_sc2_ingame_notes_icon_flick']) {
    const tex = await optionalTexture(`/rg/sprites/${name}.png`, name.includes('arrow'));
    if (tex) sprites[name] = tex;
  }
  let fx: FxFile | null = null;
  const fxTex: Record<string, THREE.Texture> = {};
  try {
    const res = await fetch('/rg/fx/fx.json');
    if (res.ok) {
      fx = await res.json() as FxFile;
      if (fx.fever) {
        fx.fever = fx.fever.map(f => ({
          ...f,
          impact: f.impact ?? -1,
          p00: f.p00 ?? -1,
          root: f.root ?? 0,
        }));
      }
      const names = [...new Set((fx.mats || []).map(m => m.tex).filter(Boolean))];
      await Promise.all(names.map(async name => {
        const tex = await optionalTexture(`/rg/fx/tex/${name}.png`);
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
