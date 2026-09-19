import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { HitFx } from '../src/fx';
import { parseChart } from '../src/chart';
import type { FxFile } from '../src/rgAssets';

const resource = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
const emptyChart = parseChart({ Notes: [], Bpms: [{ Time: 0, Bpm: 120 }] });
const allocated: { fx: HitFx; texture: THREE.Texture }[] = [];

function createFx(layer: 'head' | 'spray', id = 'holdLoop') {
  const file = structuredClone(resource);
  file.prefabs = file.prefabs.filter(prefab => prefab.id === id);
  file.fever = [];
  for (const prefab of file.prefabs) for (const node of prefab.nodes) {
    const head = node.name === 'Core' || node.name.startsWith('Corehorizon');
    if ((layer === 'head') !== head) node.active = false;
  }
  const texture = new THREE.Texture();
  const fx = new HitFx(file, Object.fromEntries(file.mats.map(mat => [mat.tex, texture])));
  allocated.push({ fx, texture });
  return fx;
}

function vertices(fx: HitFx) {
  fx.draw();
  return fx.group.children.flatMap(child => {
    const geometry = (child as THREE.Mesh).geometry;
    const position = geometry.getAttribute('position');
    return Array.from({ length: geometry.drawRange.count }, (_, i) =>
      [position.getX(i), position.getY(i), position.getZ(i)]);
  });
}

function expectShift(before: number[][], after: number[][], dx: number) {
  expect(before.length).toBeGreaterThan(0);
  expect(after).toHaveLength(before.length);
  for (let i = 0; i < before.length; i++) {
    expect(after[i][0]).toBeCloseTo(before[i][0] + dx, 5);
    expect(after[i][1]).toBe(before[i][1]);
    expect(after[i][2]).toBe(before[i][2]);
  }
}

afterEach(() => {
  for (const { fx, texture } of allocated.splice(0)) { fx.dispose(); texture.dispose(); }
});

describe('Hold 头光效跟随', () => {
  it.each(['current', 'limited', 'full'] as const)('%s：已有核心随头横移，不留在出生位置', mode => {
    const fx = createFx('head');
    fx.setMode(mode);
    fx.spawn('holdLoop', -2, 6, true, 1);
    const before = vertices(fx);
    fx.setLoop(1, 2);
    expectShift(before, vertices(fx), 4);
    fx.setLoop(1, -3);
    expectShift(before, vertices(fx), -1);
    fx.setLoop(1, -3);
    expectShift(before, vertices(fx), -1);
  });

  it('循环生成多批核心后仍整体跟随，不产生分离残影', () => {
    const fx = createFx('head');
    fx.spawn('holdLoop', -2, 6, true, 1);
    fx.sync(emptyChart, 0, false);
    for (const time of [0.04, 0.08, 0.12]) {
      fx.sync(emptyChart, time, false);
      fx.setLoop(1, time * 10);
    }
    const before = vertices(fx);
    fx.setLoop(1, 2.2);
    expectShift(before, vertices(fx), 1);
  });

  it('飞散粒子及其拖尾保留世界坐标，不被头部平移', () => {
    const fx = createFx('spray');
    fx.spawn('holdLoop', -2, 6, true, 1);
    fx.sync(emptyChart, 0, false);
    fx.sync(emptyChart, 0.02, false);
    fx.sync(emptyChart, 0.04, false);
    const before = vertices(fx);
    fx.setLoop(1, 2);
    expectShift(before, vertices(fx), 0);
  });

  it('不存在的 UID 不影响其他 Hold', () => {
    const fx = createFx('head');
    fx.spawn('holdLoop', -2, 6, true, 1);
    const before = vertices(fx);
    fx.setLoop(2, 2);
    expectShift(before, vertices(fx), 0);
  });

  it('Hold 起始的一次性光效不跟随循环头部', () => {
    const fx = createFx('head', 'holdStart');
    fx.spawn('holdStart', -2, 6, false, 1);
    const before = vertices(fx);
    fx.setLoop(1, 2);
    expectShift(before, vertices(fx), 0);
  });

  it('清理或关闭后不再绘制核心', () => {
    const fx = createFx('head');
    fx.spawn('holdLoop', -2, 6, true, 1);
    fx.clear();
    fx.setLoop(1, 2);
    expect(vertices(fx)).toEqual([]);
    fx.spawn('holdLoop', -2, 6, true, 1);
    fx.setMode('off');
    expect(fx.spawn('holdLoop', 2, 6, true, 1)).toBeNull();
    expect(vertices(fx)).toEqual([]);
  });
});
