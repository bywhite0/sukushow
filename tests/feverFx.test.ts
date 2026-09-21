import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { HitFx } from '../src/fx';
import { feverCorePrefab } from '../src/feverCore';
import { parseChart } from '../src/chart';
import type { FxFile } from '../src/rgAssets';

function loadFeverFixture(): FxFile {
  const data = JSON.parse(readFileSync(new URL('../public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
  // 数值测试合并主体和拖尾批次；独立材质行为另行测试。
  for (const prefab of data.fever || []) for (const node of prefab.nodes) {
    if (node.rend) delete (node.rend as { trailMat?: string }).trailMat;
  }
  return data;
}

it.each(['独立材质', '缺失贴图', '旧数据'] as const)('Fever 拖尾材质：%s', mode => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  if (mode !== '旧数据') Object.assign(node.rend!, { trailMat: 'resources.assets:204' });
  node.ps!.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  node.ps!.trail!.minVertexDist = 0;
  const body = new THREE.Texture(), trail = new THREE.Texture();
  const textures = Object.fromEntries(data.mats.map(m => [m.tex, body]));
  textures.sc2_Particle_light02 = trail;
  if (mode === '缺失贴图') delete textures.sc2_Particle_light02;
  const fx = new HitFx(data, textures);
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    fx.draw();
    const drawn = fx.group.children.filter(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    expect(drawn).toHaveLength(mode === '独立材质' ? 2 : 1);
    const bodyMesh = drawn.find(m => m.material.uniforms.map.value === body)!;
    expect(bodyMesh.geometry.drawRange.count).toBe(mode === '旧数据' ? 120 : 60);
    if (mode === '独立材质') {
      const trailMesh = drawn.find(m => m.material.uniforms.map.value === trail)!;
      expect(trailMesh.geometry.drawRange.count).toBe(60);
      expect(trailMesh.renderOrder).toBe(bodyMesh.renderOrder);
    }
  } finally { fx.dispose(); body.dispose(); trail.dispose(); }
});

it('Fever 拖尾头部跟随当前位置，未达到采样距离也不滞后', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.delay = constant(0);
  ps.life = constant(2);
  ps.speed = constant(1);
  ps.size = constant(1);
  ps.size3d = false;
  ps.shape = undefined;
  ps.limit = undefined;
  ps.grav = 0;
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  ps.trail!.minVertexDist = 1;
  ps.trail!.life = constant(2);
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  const chart = parseChart({ Notes: [], Bpms: [] });
  const positions = () => {
    fx.draw();
    return (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
  };
  try {
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.1 + 1 / 60, false);
    expect(positions().drawRange.count).toBe(6);
    fx.sync(chart, 0.2 + 1 / 60, false);
    const geometry = positions();
    expect(geometry.drawRange.count).toBe(12);
    const p = geometry.getAttribute('position');
    // 顶点 0/2 是粒子对角，拖尾后端截面的两个顶点为 8/11。
    const centerZ = (p.getZ(0) + p.getZ(2)) / 2;
    expect((p.getZ(8) + p.getZ(11)) / 2).toBeCloseTo(centerZ, 6);
    expect(positions().drawRange.count).toBe(12);
    fx.sync(chart, 0.3 + 1 / 60, false);
    expect(positions().drawRange.count).toBe(12);
    fx.setFever(false);
    fx.draw();
    expect(fx.group.children.every(c => (c as THREE.Mesh).geometry.drawRange.count === 0)).toBe(true);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever 拖尾过期端点按寿命边界插值，不整段跳删', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  node.rx = node.ry = node.rz = 0;
  node.rw = 1;
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.delay = constant(0);
  ps.life = constant(2);
  ps.speed = constant(1);
  ps.shape = undefined;
  ps.limit = undefined;
  ps.grav = 0;
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  ps.trail!.minVertexDist = 0;
  ps.trail!.life = constant(0.15);
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    for (const age of [0.1, 0.2, 0.3]) fx.sync(chart, age + 1 / 60, false);
    fx.draw();
    const geometry = (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBe(18);
    const p = geometry.getAttribute('position');
    const headZ = (p.getZ(14) + p.getZ(17)) / 2;
    const tailZ = (p.getZ(6) + p.getZ(7)) / 2;
    expect(tailZ - headZ).toBeCloseTo(0.15, 6);
  } finally { fx.dispose(); texture.dispose(); }
});

it.each([[1, 1, 0.15, 0.3], [2, 1, 0.19810180217027665, 0.3962036043405533], [1, 0, 0, 0]])(
  'Fever 拖尾宽度曲线 mode=%s mult=%s 沿轨迹逐点采样', (mode, mult, middleWidth, headWidth) => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.delay = constant(0);
  ps.life = constant(2);
  ps.speed = constant(1);
  ps.shape = undefined;
  ps.limit = undefined;
  ps.grav = 0;
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  ps.trail!.minVertexDist = 0;
  ps.trail!.life = constant(2);
  ps.trail!.sizeWidth = false;
  ps.trail!.width = { ...constant(1), k: mode, mult,
    keys: [{ t: 0, v: mode === 2 ? 3 : 2 }, { t: 1, v: 0 }],
    minKeys: [{ t: 0, v: 2 }, { t: 1, v: 0 }],
  };
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    for (const age of [0.1, 0.2, 0.3]) fx.sync(chart, age + 1 / 60, false);
    fx.draw();
    const geometry = (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBe(mult === 0 ? 6 : 18);
    if (mult === 0) return;
    const p = geometry.getAttribute('position');
    const width = (a: number, b: number) => Math.hypot(p.getX(a) - p.getX(b), p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b));
    expect(width(6, 7)).toBeCloseTo(0, 6);
    expect(width(8, 11)).toBeCloseTo(middleWidth, 6);
    expect(width(14, 17)).toBeCloseTo(headWidth, 6);
  } finally { random.mockRestore(); fx.dispose(); texture.dispose(); }
});

it.each([
  ['Particle_Height_Left', 0.3843137323856354],
  ['Particle_Start_Left', 0.2549019753932953],
  ['Particle_Star_Left', 0.5607843399047852],
])('Fever %s 消费原始 colorOverTrail 常量 alpha', (name, alpha) => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes.find(n => n.name === name)!;
  node.parent = -1;
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.trail!.inheritColor = false;
  ps.trail!.minVertexDist = 0;
  ps.trail!.colMode = 1;
  ps.trail!.colMax = { rgb: [{ t: 0, r: 1, g: 1, b: 1 }], a: [{ t: 0, v: 1 }] };
  ps.bursts = [{ t: 0, count: { k: 0, v: 1, lo: 1, hi: 1, mult: 1 }, cycles: 1, interval: 0, prob: 1 }];
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    fx.draw();
    const geometry = (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBe(12);
    expect(geometry.getAttribute('tint').getW(6)).toBeCloseTo(alpha, 6);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever 沿长度颜色分别作用于头尾，不替代寿命颜色', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  ps.delay = { k: 0, v: 0, lo: 0, hi: 0, mult: 1 };
  ps.trail!.minVertexDist = 0;
  ps.trail!.inheritColor = false;
  ps.trail!.colMode = 1;
  ps.trail!.colMax = { rgb: [{ t: 0, r: 1, g: 1, b: 1 }], a: [{ t: 0, v: 0.5 }] };
  Object.assign(ps.trail!, { colorOverTrail: {
    rgb: [{ t: 0, r: 1, g: 0, b: 0 }, { t: 1, r: 0, g: 0, b: 1 }],
    a: [{ t: 0, v: 1 }, { t: 1, v: 0.25 }],
  } });
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.setFever(true);
    fx.sync(chart, 0.03, false);
    fx.sync(chart, 0.04, false);
    fx.draw();
    const geometry = (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    const tint = geometry.getAttribute('tint');
    expect(tint.getX(60)).toBeCloseTo(0);
    expect(tint.getZ(60)).toBeCloseTo(1);
    expect(tint.getW(60)).toBeCloseTo(0.125);
    expect(tint.getX(62)).toBeCloseTo(1);
    expect(tint.getZ(62)).toBeCloseTo(0);
    expect(tint.getW(62)).toBeCloseTo(0.5);
  } finally { fx.dispose(); texture.dispose(); }
});

it('循环发射跨过多个周期不漏发，也不重复边界批次', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.loop = true;
  ps.dur = 0.1;
  ps.life = constant(2);
  ps.trail = undefined;
  ps.limit = undefined;
  ps.rate = constant(0);
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false);
    fx.spawn('feverLeft', 0, 1, true);
    const count = () => { fx.draw(); return fx.group.children.reduce((n, c) => n + (c as THREE.Mesh).geometry.drawRange.count / 6, 0); };
    expect(count()).toBe(1);
    fx.sync(chart, 0.35, false);
    expect(count()).toBe(4);
    fx.sync(chart, 0.4, false);
    expect(count()).toBe(5);
    fx.sync(chart, 0.4, false);
    expect(count()).toBe(5);
  } finally { fx.dispose(); texture.dispose(); }
});

it.each([[true, 0.2, 0], [false, 0, 0.2]])('Fever VelocityModule world=%s 使用正确坐标空间', (world, x, y) => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [data.fever![0]];
  const node = data.fever[0].nodes[0];
  data.fever[0].nodes = [node];
  node.px = node.py = node.pz = 0;
  node.rx = node.ry = 0;
  node.rz = Math.SQRT1_2; node.rw = Math.SQRT1_2;
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.delay = constant(0); ps.life = constant(2); ps.speed = constant(0);
  ps.shape = undefined; ps.limit = undefined; ps.trail = undefined; ps.grav = 0;
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  Object.assign(ps, { vel: { en: true, world, x: constant(1), y: constant(0), z: constant(0) } });
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false); fx.setFever(true);
    fx.sync(chart, 0.2 + 1 / 60, false); fx.draw();
    const geometry = (fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh).geometry;
    const p = geometry.getAttribute('position');
    expect((p.getX(0) + p.getX(2)) / 2).toBeCloseTo(x, 6);
    expect((p.getY(0) + p.getY(2)) / 2).toBeCloseTo(y, 6);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever 局部入场粒子跟随动画节点并按关闭边界消失', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  const prefab = data.fever![0];
  prefab.id = 'feverCoreLeft';
  prefab.nodes = [prefab.nodes[0]];
  const node = prefab.nodes[0];
  node.px = node.py = node.pz = 0;
  node.rx = node.ry = node.rz = 0; node.rw = 1;
  const ps = node.ps!;
  const constant = (v: number) => ({ k: 0, v, lo: v, hi: v, mult: 1 });
  ps.local = true; ps.loop = false; ps.life = constant(2); ps.speed = constant(0);
  ps.delay = constant(0); ps.shape = undefined; ps.limit = undefined; ps.trail = undefined; ps.grav = 0;
  ps.bursts = [{ t: 0, count: constant(1), cycles: 1, interval: 0, prob: 1 }];
  data.fever = [prefab];
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false); fx.setFever(true);
    fx.sync(chart, 0.2, false); fx.draw();
    const mesh = fx.group.children.find(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh;
    expect(mesh).toBeDefined();
    const p = mesh.geometry.getAttribute('position');
    expect((p.getX(0) + p.getX(2)) / 2).toBeCloseTo(-10.539998626708985, 5);
    fx.sync(chart, 0.6333333253860474, false); fx.draw();
    expect(fx.group.children.every(c => (c as THREE.Mesh).geometry.drawRange.count === 0)).toBe(true);
  } finally { fx.dispose(); texture.dispose(); }
});

it('原始核心入场 prefab 在短周期中持续发射，并在关闭时清空', () => {
  const data = loadFeverFixture();
  data.prefabs = [];
  data.fever = [feverCorePrefab('left'), feverCorePrefab('right')];
  const texture = new THREE.Texture();
  const fx = new HitFx(data, Object.fromEntries(data.mats.map(m => [m.tex, texture])));
  try {
    const chart = parseChart({ Notes: [], Bpms: [] });
    fx.sync(chart, 0, false); fx.setFever(true);
    for (const time of [0.05, 0.15, 0.35, 0.55]) {
      fx.sync(chart, time, false); fx.draw();
      const drawn = fx.group.children.filter(c => (c as THREE.Mesh).geometry.drawRange.count > 0) as THREE.Mesh[];
      expect(drawn).toHaveLength(1);
      expect(drawn[0].geometry.drawRange.count).toBe(12);
      expect(drawn[0].renderOrder).toBe(640);
      const p = drawn[0].geometry.getAttribute('position');
      expect((p.getX(0) + p.getX(2)) / 2).toBeLessThan(0);
      expect((p.getX(6) + p.getX(8)) / 2).toBeGreaterThan(0);
    }
    fx.sync(chart, 0.64, false); fx.draw();
    expect(fx.group.children.every(c => (c as THREE.Mesh).geometry.drawRange.count === 0)).toBe(true);
  } finally { fx.dispose(); texture.dispose(); }
});

it('Fever 拖尾宽度按原始双常量范围采样', () => {
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
      const data = loadFeverFixture();
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
      const data = loadFeverFixture();
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
  const data = loadFeverFixture();
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
