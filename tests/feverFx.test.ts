import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HitFx } from '../src/fx';
import { parseChart } from '../src/chart';
import type { FxFile } from '../src/rgAssets';

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
