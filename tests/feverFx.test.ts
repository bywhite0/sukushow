import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HitFx } from '../src/fx';
import { parseChart } from '../src/chart';
import type { FxFile } from '../src/rgAssets';

describe('Fever 原始非循环入场爆发', () => {
  it.each([['feverLeft', 10, 20, 30, 45, 55, 70], ['feverRight', 7, 14, 21, 33, 40, 52]] as const)(
    '%s 按原始时间表发出全部六批，不重复第零批', (id, ...counts) => {
      const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
      const prefab = data.fever!.find(p => p.id === id)!;
      // 隔离根发射器；关闭拖尾，绘制顶点数直接对应存活粒子数。
      prefab.nodes = [prefab.nodes[0]];
      prefab.nodes[0].ps!.trail = undefined;
      data.prefabs = [];
      data.fever = [prefab];
      const texture = new THREE.Texture();
      const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
      const chart = parseChart({ Notes: [], Bpms: [] });
      const count = () => {
        fx.draw();
        return fx.group.children.reduce((n, child) => n + (child as THREE.Mesh).geometry.drawRange.count / 6, 0);
      };
      try {
        fx.setMode('off');
        fx.sync(chart, 0, false);
        fx.setFever(true);
        expect(count()).toBe(0);
        fx.setFever(false);
        fx.sync(chart, 1 / 120, false);
        expect(count()).toBe(0);
        fx.sync(chart, 0, false);
        fx.setFever(true);
        fx.sync(chart, 1 / 120, false);
        expect(count()).toBe(0);
        const times = [1 / 60, 0.051 + 1 / 60, 0.081 + 1 / 60, 0.101 + 1 / 60, 0.131 + 1 / 60, 0.181 + 1 / 60];
        times.forEach((time, i) => {
          fx.sync(chart, time, false);
          expect(count()).toBe(counts[i]);
          fx.setFever(true);
          fx.sync(chart, time, false);
          expect(count()).toBe(counts[i]);
        });
        fx.sync(chart, 0.2, false);
        expect(count()).toBe(counts[5]);
        fx.setFever(false);
        expect(count()).toBe(0);
        fx.setFever(true);
        expect(count()).toBe(0);
        for (let frame = 1; frame <= 720; frame++) {
          fx.sync(chart, 0.2 + frame / 60, false);
          fx.setFever(true);
        }
        expect(count()).toBe(0);
      } finally { fx.dispose(); texture.dispose(); }
    },
  );
});

it.each(['跳转', '关闭击中特效'] as const)('%s后 Fever 粒子继续绘制', action => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const chart = parseChart({ Notes: [], Bpms: [] });
  const count = () => { fx.draw(); return fx.group.children.reduce((n, child) => n + (child as THREE.Mesh).geometry.drawRange.count, 0); };
  try {
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.1, false);
    expect(count()).toBeGreaterThan(0);
    if (action === '跳转') fx.sync(chart, 10, false);
    else fx.setMode('off');
    fx.setFever(true);
    fx.sync(chart, action === '跳转' ? 10.1 : 0.2, false);
    expect(count()).toBeGreaterThan(0);
    fx.setFever(false);
    expect(count()).toBe(0);
  } finally { fx.dispose(); texture.dispose(); }
});
