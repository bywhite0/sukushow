import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HitFx } from '../src/fx';
import { parseChart } from '../src/chart';
import type { FxFile } from '../src/rgAssets';

it('Fever 拖尾宽度按原始双常量范围采样', () => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  const ps = prefab.nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.trail!.sizeWidth = false;
  ps.trail!.minVertexDist = 0;
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    random.mockReturnValue(0);
    fx.draw();
    const mesh = fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(60);
    const p = mesh.geometry.getAttribute('position');
    const width = Math.hypot(p.getX(61) - p.getX(60), p.getY(61) - p.getY(60), p.getZ(61) - p.getZ(60));
    // 固定随机输入 .5 生成 seed=0x80000000，原生宽度因子为 .6413573622703552。
    expect(width).toBeCloseTo(0.06651855849354957, 5);
  } finally { random.mockRestore(); fx.dispose(); texture.dispose(); }
});

it.each([true, false])('Fever 拖尾宽度继承当前尺寸=%s', inherit => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  const ps = prefab.nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.life = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  ps.size = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  ps.sizeol = { en: true, curve: { k: 1, v: 1, lo: 1, hi: 1, mult: 1,
    keys: [{ t: 0, v: 0.5 }, { t: 1, v: 0.5 }],
  } };
  ps.trail!.sizeWidth = inherit;
  ps.trail!.minVertexDist = 0;
  ps.trail!.width = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    fx.draw();
    const mesh = fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(60);
    const pos = mesh.geometry.getAttribute('position');
    const width = Math.hypot(pos.getX(61) - pos.getX(60), pos.getY(61) - pos.getY(60), pos.getZ(61) - pos.getZ(60));
    expect(width).toBeCloseTo(inherit ? 0.075 : 0.15, 5);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever 尺寸曲线使用原始关键帧切线', () => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  const ps = prefab.nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.life = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  ps.size = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  ps.size3d = false;
  ps.rot = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.rotol = undefined;
  ps.trail = undefined;
  ps.sizeol = { en: true, curve: { k: 1, v: 1, lo: 1, hi: 1, mult: 1,
    keys: [{ t: 0, v: 1, o: 0 }, { t: 1, v: 0, i: 0 }],
  } };
  ps.bursts = [{ ...ps.bursts![0], cycles: 1 }];
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.25 + 1 / 60, false);
    fx.draw();
    const mesh = fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position');
    // 零切线 Hermite：u=.25 时尺寸为 .84375，而非直线的 .75。
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 6; i++) { min = Math.min(min, pos.getX(i)); max = Math.max(max, pos.getX(i)); }
    expect(max - min).toBeCloseTo(0.84375, 5);
  } finally { fx.dispose(); texture.dispose(); }
});

it.each([true, false])('Fever 拖尾颜色继承开关=%s', inherit => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  const ps = prefab.nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.col = { en: true, mode: 1,
    max: { rgb: [{ t: 0, r: 0, g: 1, b: 0 }], a: [{ t: 0, v: 0.5 }] },
  };
  ps.trail!.inheritColor = inherit;
  ps.trail!.colMode = 1;
  ps.trail!.minVertexDist = 0;
  ps.trail!.colMax = { rgb: [{ t: 0, r: 1, g: 1, b: 1 }], a: [{ t: 0, v: 1 }] };
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    fx.draw();
    const mesh = fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    const geometry = mesh.geometry;
    expect(geometry.drawRange.count).toBeGreaterThan(60);
    const tint = geometry.getAttribute('tint');
    for (let i = 0; i < geometry.drawRange.count; i++) {
      const colored = i < 60 || inherit;
      expect(tint.getX(i)).toBeCloseTo(colored ? 0 : 1);
      expect(tint.getY(i)).toBeCloseTo(1);
      expect(tint.getZ(i)).toBeCloseTo(colored ? 0 : 1);
      expect(tint.getW(i)).toBeCloseTo(colored ? 0.5 : 1);
    }
  } finally { fx.dispose(); texture.dispose(); }
});

it.each([
  [1, 0.2, 0, 1], [1, 0.3, 0, 1],
  [3, 0.2, 0.5362125039100647, 0.4637874960899353],
  [3, 0.3, 0.5362125039100647, 0.4637874960899353],
])('Fever 拖尾寿命颜色 mode=%s age=%s 按粒子年龄与固定 seed 采样', (mode, age, red, blue) => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  data.fever[0].nodes = [data.fever[0].nodes[0]];
  const ps = data.fever[0].nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.life = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
  ps.bursts = [{ ...ps.bursts![0], cycles: 1 }];
  ps.trail!.minVertexDist = 0;
  ps.trail!.inheritColor = false;
  ps.trail!.colMode = mode;
  ps.trail!.colMin = { rgb: [{ t: 0, r: 1, g: 0, b: 0 }], a: [{ t: 0, v: 0 }, { t: 1, v: 1 }] };
  ps.trail!.colMax = { rgb: [{ t: 0, r: 0, g: 0, b: 1 }], a: [{ t: 0, v: 0 }, { t: 1, v: 1 }] };
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.1 + 1 / 60, false);
    fx.sync(chart, age + 1 / 60, false);
    random.mockReturnValue(0);
    fx.draw();
    const geometry = (fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBeGreaterThan(60);
    const tint = geometry.getAttribute('tint');
    for (let i = 60; i < geometry.drawRange.count; i++) {
      expect(tint.getX(i)).toBeCloseTo(red, 6);
      expect(tint.getZ(i)).toBeCloseTo(blue, 6);
      expect(tint.getW(i)).toBeCloseTo(age, 6);
    }
  } finally { random.mockRestore(); fx.dispose(); texture.dispose(); }
});

it('Fever 共用贴图的节点保留各自 sortingOrder', () => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  data.fever[0].nodes.forEach(n => {
    n.active = ['Particle_Height_Left', 'Particle_Height_Left_02'].includes(n.name);
  });
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.2, false);
    fx.draw();
    const orders = fx.group.children.filter(child => (child as THREE.Mesh).geometry.drawRange.count > 0)
      .map(child => child.renderOrder).sort((a, b) => a - b);
    expect(orders).toEqual([59, 60]);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever TwoGradients 在两条渐变之间插值而非二选一', () => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  const ps = prefab.nodes[0].ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.trail = undefined;
  ps.col = { en: true, mode: 3,
    min: { rgb: [{ t: 0, r: 1, g: 0, b: 0 }], a: [{ t: 0, v: 1 }] },
    max: { rgb: [{ t: 0, r: 0, g: 0, b: 1 }], a: [{ t: 0, v: 1 }] },
  };
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.02, false);
    fx.draw();
    const mesh = fx.group.children.find(child => (child as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    expect(mesh).toBeDefined();
    const color = mesh.geometry.getAttribute('tint');
    expect(color.getX(0)).toBeCloseTo(0.5);
    expect(color.getY(0)).toBeCloseTo(0);
    expect(color.getZ(0)).toBeCloseTo(0.5);
  } finally { random.mockRestore(); fx.dispose(); texture.dispose(); }
});

it('Fever 发射器延迟叠加在 Animator 激活之后', () => {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const prefab = data.fever[0];
  prefab.nodes = [prefab.nodes[0]];
  prefab.nodes[0].ps!.delay = { k: 0, v: 0.1, lo: 0.1, hi: 0.1, mult: 1 };
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const chart = parseChart({ Notes: [], Bpms: [] });
  const count = () => {
    fx.draw();
    return fx.group.children.reduce((n, child) => n + (child as THREE.Mesh).geometry.drawRange.count, 0);
  };
  try {
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.11, false);
    expect(count()).toBe(0);
    fx.sync(chart, 0.12, false);
    expect(count()).toBeGreaterThan(0);
  } finally { fx.dispose(); texture.dispose(); }
});

describe('Fever 出生时间', () => {
  it('同一时刻的粒子位置不随跨越出生点的帧步长变化', () => {
    const positions = (times: number[]) => {
      const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
      const prefab = data.fever![0];
      prefab.nodes = [prefab.nodes[0]];
      const ps = prefab.nodes[0].ps!;
      ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
      ps.trail = undefined;
      ps.limit = undefined;
      ps.shape = undefined;
      ps.rotol = undefined;
      ps.grav = 0;
      ps.rot = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
      ps.size = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
      ps.size3d = false;
      ps.speed = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
      ps.life = { k: 0, v: 1, lo: 1, hi: 1, mult: 1 };
      ps.bursts = [{ ...ps.bursts![0], cycles: 1 }];
      data.prefabs = [];
      data.fever = [prefab];
      const texture = new THREE.Texture();
      const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
      try {
        fx.setMode('off');
        fx.sync(parseChart({ Notes: [], Bpms: [] }), 0, false);
        fx.setFever(true);
        for (const t of times) fx.sync(parseChart({ Notes: [], Bpms: [] }), t, false);
        fx.draw();
        return fx.group.children.flatMap(child => {
          const g = (child as THREE.Mesh).geometry;
          return Array.from(g.getAttribute('position').array).slice(0, g.drawRange.count * 3);
        });
      } finally { fx.dispose(); texture.dispose(); }
    };
    const coarse = positions([0.1]);
    const fine = positions([0.01, 1 / 60, 0.1]);
    expect(coarse.length).toBeGreaterThan(0);
    expect(coarse.length).toBe(fine.length);
    coarse.forEach((v, i) => expect(v).toBeCloseTo(fine[i], 5));
  });
});

describe('Fever 原始非循环入场爆发', () => {
  it.each([['feverLeft', 10, 20, 30, 45, 55, 70], ['feverRight', 7, 14, 21, 33, 40, 52]] as const)(
    '%s 按原始时间表发出全部六批，不重复第零批', (id, ...counts) => {
      const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
      const prefab = data.fever!.find(p => p.id === id)!;
      // 隔离根发射器；关闭拖尾，绘制顶点数直接对应存活粒子数。
      prefab.nodes = [prefab.nodes[0]];
      prefab.nodes[0].ps!.trail = undefined;
      prefab.nodes[0].ps!.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
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
