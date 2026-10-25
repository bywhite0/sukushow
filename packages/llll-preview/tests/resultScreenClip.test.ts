import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ResultScreen } from '../src/resultScreen';
import {
  RESULT_CLIPS,
  RESULT_FX,
  RESULT_FX_TEXTURES,
  RESULT_NODES,
  RESULT_SPRITES,
} from '../src/resultScreenClip';

const PUBLIC_DIR = fileURLToPath(new URL('../../../apps/web/public/', import.meta.url));

const byPath = new Map(RESULT_NODES.map((node) => [node.path, node] as const));

/** host 模板里的 {n} 展开成 4 个灯位；其他 host 原样返回。 */
const expandHost = (host: string): string[] =>
  host.includes('{n}') ? [1, 2, 3, 4].map((n) => host.replace('{n}', String(n))) : [host];

/** 曲线 path 相对 host 解析成绝对节点路径（空串 = host 自身）。 */
const resolveCurve = (host: string, path: string): string => (path === '' ? host : `${host}/${path}`);

describe('结算界面节点表', () => {
  it('节点路径唯一', () => {
    expect(new Set(RESULT_NODES.map((node) => node.path)).size).toBe(RESULT_NODES.length);
  });

  it('父节点下标合法，路径与父子关系一致', () => {
    RESULT_NODES.forEach((node, i) => {
      if (node.parent === -1) return;
      expect(node.parent).toBeGreaterThanOrEqual(0);
      expect(node.parent).toBeLessThan(i);
      const parent = RESULT_NODES[node.parent]!;
      expect(node.path.startsWith(`${parent.path}/`)).toBe(true);
    });
  });

  it('缺 RectTransform 的 19 个效果子节点按父矩形中心的零尺寸点保存', () => {
    const zeroHosts = RESULT_FX.filter((emitter) => {
      const node = byPath.get(emitter.path)!;
      return node.w === 0 && node.h === 0;
    });
    expect(zeroHosts).toHaveLength(19);
    for (const emitter of zeroHosts) {
      const node = byPath.get(emitter.path)!;
      expect(node.x).toBe(0);
      expect(node.y).toBe(0);
      expect(node.anchor).toEqual([0.5, 0.5, 0.5, 0.5]);
      expect(node.pivot).toEqual([0.5, 0.5]);
      expect(node.image).toBeNull();
    }
  });

  it('sprite 节点的贴图名都在 RESULT_SPRITES 里', () => {
    for (const node of RESULT_NODES) {
      if (node.image?.kind !== 'sprite') continue;
      expect(node.image.sprite.length).toBeGreaterThan(0);
      expect(RESULT_SPRITES).toContain(node.image.sprite);
    }
  });
});

describe('结算界面 clip 曲线', () => {
  it('三段 clip：名称、时长与 host', () => {
    const clips = new Map(RESULT_CLIPS.map((clip) => [clip.name, clip] as const));
    expect([...clips.keys()].sort()).toEqual([
      'sc2_ResultAllComboPerfect',
      'sc2_ResultClearLampRoot_01',
      'sc2_ResultTitleAnimation',
    ]);
    expect(clips.get('sc2_ResultAllComboPerfect')!.host).toBe('UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot');
    expect(clips.get('sc2_ResultTitleAnimation')!.host).toBe('ResultTitle');
    expect(clips.get('sc2_ResultClearLampRoot_01')!.host).toBe('TitleContent/ClearLampRoot/ClearLampRoot ({n})');
    expect(clips.get('sc2_ResultClearLampRoot_01')!.dur).toBeCloseTo(0.7, 6);
    expect(clips.get('sc2_ResultAllComboPerfect')!.dur).toBeCloseTo(0.7, 6);
    expect(clips.get('sc2_ResultTitleAnimation')!.dur).toBeCloseTo(2.4166, 3);
  });

  it('每条曲线的相对 path 都能在 host（灯 clip 含 4 个灯位）下解析', () => {
    for (const clip of RESULT_CLIPS) {
      const hosts = expandHost(clip.host);
      expect(clip.curves.length).toBeGreaterThan(0);
      for (const host of hosts) {
        expect(byPath.has(host)).toBe(true);
        for (const curve of clip.curves) {
          expect(byPath.has(resolveCurve(host, curve.path))).toBe(true);
        }
      }
    }
  });

  it('曲线关键帧非空且按时间递增，scale.z 已剔除、attr:* 已归并为 attr', () => {
    for (const clip of RESULT_CLIPS) {
      for (const curve of clip.curves) {
        expect(['active', 'x', 'y', 'scale.x', 'scale.y', 'r', 'g', 'b', 'a', 'attr']).toContain(curve.prop);
        expect(curve.keys.length).toBeGreaterThan(0);
        for (let i = 1; i < curve.keys.length; i += 1) {
          expect(curve.keys[i]![0]).toBeGreaterThan(curve.keys[i - 1]![0]);
        }
      }
    }
  });
});

describe('结算界面贴图清单', () => {
  it('结算实际预加载的贴图全部存在，含运行时切换的图标与数字', () => {
    const urls = ResultScreen.textureUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(existsSync(join(PUBLIC_DIR, url.slice(1))), `缺少 ${url}`).toBe(true);
    }
  });

  it('发射器 path 都在节点表，tex 都在 RESULT_FX_TEXTURES，unit 只有 1 / 100', () => {
    for (const emitter of RESULT_FX) {
      expect(byPath.has(emitter.path)).toBe(true);
      expect(emitter.tex.length).toBeGreaterThan(0);
      expect(RESULT_FX_TEXTURES).toContain(emitter.tex);
      expect([1, 100]).toContain(emitter.unit);
      expect(emitter.count).toBeGreaterThan(0);
      for (const [t] of emitter.sizeKeys) {
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });
});
