"""从曲终横幅导出生成 src/comboResultClip.ts（RhythmGameComboResult，AllPerfect）。

用法：python scripts/gen-combo-result-clip.py <banners.json> <level56.json> [输出路径]

banners.json：横幅导出（UI 树 + sharedassets56 AnimationClip #99/#102/#100/#101 的 StreamedClip 解码）。
level56.json：level56 场景序列化全量导出；粒子发射器参数直接从 ParticleSystem /
ParticleSystemRenderer 取（burst 循环次数与间隔、ClampVelocity 随机区间、Circle 半径厚度、
排序层与 maxParticleSize），不用 banners.json 里简化过的 fx[]。
"""
import json, math, os, sys

if len(sys.argv) < 3:
    sys.exit(__doc__)
banners = json.load(open(sys.argv[1], encoding='utf-8'))
lvl = json.load(open(sys.argv[2], encoding='utf-8'))
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', 'src', 'comboResultClip.ts')
gos, comps = lvl['gameobjects'], lvl['components']
INDEX = 0  # GetResultIndex：0=AllPerfect（自动演奏恒为 AP）
ROOT_NAME = 'Root-AllPerfect'

def num(v):
    v = float(v)
    if v == 0:
        return '0'
    if v == int(v) and abs(v) < 1e9:
        return str(int(v))
    return repr(v)

# ── UI 树（Root-AllPerfect）──────────────────────────────────────────
root = next(r for r in banners['roots'] if r['name'] == ROOT_NAME)
nodes = []
def flat(n, parent):
    idx = len(nodes)
    q = math.degrees(2 * math.atan2(n.get('rz', 0.0), n.get('rw', 1.0)))
    im = n.get('image') or {}
    g = n.get('grad') or {}
    e = {'path': n['path'], 'parent': parent, 'active': bool(n['active']),
         'x': n['px'], 'y': n['py'], 'w': n['sw'], 'h': n['sh'],
         'sx': n.get('sx', 1.0), 'sy': n.get('sy', 1.0), 'rot': q}
    for k in ('aminx', 'aminy', 'amaxx', 'amaxy'):
        assert n.get(k, 0.5) == 0.5, (n['path'], k)  # 全部中心锚点
    if im.get('sprite'):
        e['sprite'] = im['sprite']
        e['rgba'] = [im.get('r', 1), im.get('g', 1), im.get('b', 1), im.get('a', 1)]
        if g.get('left'):
            # GradientColor：top/bottom 全白 ⇒ 只有 left/right 生效（横向渐变，逐顶点相乘）
            assert g['top'] == [1, 1, 1, 1] and g['bottom'] == [1, 1, 1, 1], n['path']
            e['gradL'] = g['left']; e['gradR'] = g['right']
    nodes.append(e)
    for ch in n.get('children') or []:
        flat(ch, idx)
flat(root, -1)

# ── 动画曲线 ───────────────────────────────────────────────────────
clip = next(c for c in banners['anim'] if c['idx'] == INDEX)
paths = {n['path'] for n in nodes}
curves = []
for c in clip['curves']:
    if c['prop'] == 'scale.z':
        continue  # 2D 画布不用
    assert c['path'] in paths, c['path']
    if c.get('isConst'):
        keys = [(0.0, 0.0, 0.0, 0.0, c['constV'])]
    else:
        keys = []
        for k in c['keys']:
            # t=-1 为原 -inf 初始帧：常值 c3，合并到 t=0 之前（片段从 0 开始采样，不会用到）
            if k['t'] < 0:
                continue
            keys.append((k['t'], k['c0'], k['c1'], k['c2'], k['c3']))
    curves.append((c['path'], c['prop'], keys))

# ── 粒子发射器（level56 原值）───────────────────────────────────────
def walk(k, prefix, out):
    g = gos[str(k)]
    p = (prefix + '/' + g['name']) if prefix else g['name']
    out[p] = g
    for ch in g['children']:
        walk(ch, p, out)
by_path = {}
walk(next(k for k, g in gos.items() if g['name'] == 'RhythmGameComboResult'), '', by_path)
PREFIX = 'RhythmGameComboResult/Root/'

def mm(c):
    st = c.get('minMaxState', 0)
    if st == 0:
        return (c['scalar'], c['scalar'])
    if st == 3:
        return (c['minScalar'], c['scalar'])
    if st == 1:
        return (c['scalar'], c['scalar'])  # 曲线态：乘数，曲线另取
    raise ValueError(st)

def curve_keys(c):
    # AnimationCurve 关键帧 (time, value, inSlope, outSlope)，段内三次 Hermite；值与斜率乘 scalar
    ks = c['maxCurve']['m_Curve']
    for k in ks:
        assert k.get('weightedMode', 0) == 0, k
    s = c['scalar']
    return [(k['time'], k['value'] * s, k['inSlope'] * s, k['outSlope'] * s) for k in ks]

def grad(g):
    assert g.get('m_Mode', 0) == 0  # Blend（线性插值）
    cols = [(g['ctime%d' % i] / 65535.0, g['key%d' % i]['r'], g['key%d' % i]['g'], g['key%d' % i]['b']) for i in range(g['m_NumColorKeys'])]
    alps = [(g['atime%d' % i] / 65535.0, g['key%d' % i]['a']) for i in range(g['m_NumAlphaKeys'])]
    return cols, alps

# 贴图名 = 材质 _MainTex（banners.json 导出时已按材质解析）
tex_by_path = {e['path']: e['tex'] for e in banners['fx']}
emitters = []
for p, g in by_path.items():
    rel = p[len(PREFIX):] if p.startswith(PREFIX) else None
    if not rel or not rel.startswith(ROOT_NAME + '/'):
        continue
    cm = dict((t, cid) for t, cid in g['components'])
    if 'ParticleSystem' not in cm:
        continue
    d = comps[cm['ParticleSystem']]['data']
    r = comps[cm['ParticleSystemRenderer']]['data']
    ini, em, shp = d['InitialModule'], d['EmissionModule'], d['ShapeModule']
    szm, rot, com, cvm = d['SizeModule'], d['RotationModule'], d['ColorModule'], d['ClampVelocityModule']
    assert not d.get('looping') and ini.get('gravityModifier', {}).get('scalar', 0) == 0
    for mod in ('VelocityModule', 'ForceModule', 'NoiseModule', 'UVModule', 'TrailModule', 'RotationBySpeedModule', 'SizeBySpeedModule', 'ColorBySpeedModule'):
        assert not d.get(mod, {}).get('enabled'), (rel, mod)
    assert r['m_RenderMode'] == 0  # Billboard
    assert mm(ini['startRotation']) == (0.0, 0.0), rel
    assert em['rateOverTime']['scalar'] == 0
    assert len(em['m_Bursts']) == 1
    b = em['m_Bursts'][0]
    assert b['countCurve'].get('minMaxState', 0) == 0
    assert shp['enabled'] and shp['type'] in (0, 10), (rel, shp['type'])  # 0 Sphere(半径 0) / 10 Circle
    sc = ini['startColor']
    assert sc.get('minMaxState', 0) == 0
    mc = sc['maxColor']
    e = {
        'path': rel, 'tex': tex_by_path[rel],
        'delay': mm(d['startDelay']),
        'count': int(b['countCurve']['scalar']), 'burstT': b['time'],
        'cycles': int(b.get('cycleCount', 1)), 'interval': b.get('repeatInterval', 0.0),
        'life': mm(ini['startLifetime']), 'speed': mm(ini['startSpeed']),
        'size': mm(ini['startSize']),
        'sizeY': mm(ini['startSizeY']) if ini.get('size3D') else None,
        'color': (mc['r'], mc['g'], mc['b'], mc['a']),
        'radius': shp['radius']['value'] if shp['type'] == 10 else 0.0,
        'thickness': shp.get('radiusThickness', 1.0),
        'rotSpeed': mm(rot['curve']) if rot.get('enabled') else None,
        'limit': mm(cvm['magnitude']) if cvm.get('enabled') else None,
        'dampen': cvm.get('dampen', 0.0) if cvm.get('enabled') else 0.0,
        'sizeKeys': curve_keys(szm['curve']) if szm.get('enabled') else None,
        'grad': grad(com['gradient']['maxGradient']) if com.get('enabled') else None,
        # SortingLayer 0 (Default) 的 order 1 < 横幅 Canvas order 10 ⇒ 画在黑罩之下；
        # 其余在更高的排序层，整体压在横幅之上。
        'underCanvas': r.get('m_SortingLayerID', 0) == 0 and r.get('m_SortingOrder', 0) < 10,
        'sort': r.get('m_SortingOrder', 0),
        'maxSize': r.get('m_MaxParticleSize', 0.5),
    }
    if e['radius'] and shp['type'] == 10:
        assert shp['arc']['value'] == 360.0
    if e['speed'] == (0.0, 0.0):
        e['radius'] = 0.0 if e['radius'] == 0 else e['radius']
    emitters.append(e)

# ── 输出 ───────────────────────────────────────────────────────────
def arr(xs):
    return '[' + ', '.join(num(x) for x in xs) + ']'
def pair(t):
    return 'null' if t is None else arr(t)
o = []
o.append('/**\n * 曲终横幅 RhythmGameComboResult · AllPerfect（level56 GO 370 下 Root/Root-AllPerfect）。\n'
         ' * 动画 = sharedassets56 AnimationClip #99 `sc2_ingame_end_AllPerfect`（4 s）StreamedClip 逐键解码：\n'
         ' * 段内 v = a·u³ + b·u² + c·u + d，u = t − 键时刻；常量绑定写成 t=0 单键。\n'
         ' * UI 树取 RectTransform / Image / GradientColor 序列化值（1920×1080，全部中心锚点）。\n'
         ' * 发射器取 level56 ParticleSystem / ParticleSystemRenderer 原值。\n'
         ' * 由 scripts/gen-combo-result-clip.py 生成，勿手改。\n */')
o.append('export type BannerKey = readonly [t: number, a: number, b: number, c: number, d: number];')
o.append('export type Range = readonly [min: number, max: number];')
o.append('export interface BannerNode {\n  path: string; parent: number; active: boolean;\n  x: number; y: number; w: number; h: number; sx: number; sy: number; rot: number;\n  sprite?: string; rgba?: readonly [number, number, number, number];\n  gradL?: readonly [number, number, number, number]; gradR?: readonly [number, number, number, number];\n}')
o.append('export interface BannerCurve { path: string; prop: string; keys: readonly BannerKey[] }')
o.append('export interface BannerEmitter {\n  path: string; tex: string; delay: Range; count: number; burstT: number; cycles: number; interval: number;\n  life: Range; speed: Range; size: Range; sizeY: Range | null; color: readonly [number, number, number, number];\n  radius: number; thickness: number; rotSpeed: Range | null; limit: Range | null; dampen: number;\n  sizeKeys: readonly (readonly [t: number, v: number, inSlope: number, outSlope: number])[] | null;\n  grad: readonly [cols: readonly (readonly [t: number, r: number, g: number, b: number])[], alps: readonly (readonly [t: number, a: number])[]] | null;\n  underCanvas: boolean; sort: number; maxSize: number;\n}')
o.append('export const COMBO_RESULT_CLIP_DURATION = %s;' % num(clip['dur']))
o.append('/** 全屏黑罩 Bg 的 Image.color。 */')
o.append('export const COMBO_RESULT_BG = %s as const;' % arr(banners['bg']))
o.append('export const AP_BANNER_NODES: readonly BannerNode[] = [')
for n in nodes:
    parts = ['path: %s' % json.dumps(n['path']), 'parent: %d' % n['parent'], 'active: %s' % ('true' if n['active'] else 'false')]
    for k in ('x', 'y', 'w', 'h', 'sx', 'sy', 'rot'):
        parts.append('%s: %s' % (k, num(n[k])))
    if 'sprite' in n:
        parts.append('sprite: %s' % json.dumps(n['sprite']))
        parts.append('rgba: %s' % arr(n['rgba']))
    if 'gradL' in n:
        parts.append('gradL: %s, gradR: %s' % (arr(n['gradL']), arr(n['gradR'])))
    o.append('  { ' + ', '.join(parts) + ' },')
o.append('];')
o.append('export const AP_BANNER_CURVES: readonly BannerCurve[] = [')
for p, prop, keys in curves:
    o.append('  { path: %s, prop: %s, keys: [%s] },' % (json.dumps(p), json.dumps(prop), ', '.join(arr(k) for k in keys)))
o.append('];')
o.append('export const AP_BANNER_EMITTERS: readonly BannerEmitter[] = [')
for e in emitters:
    g = 'null' if e['grad'] is None else '[[%s], [%s]]' % (', '.join(arr(c) for c in e['grad'][0]), ', '.join(arr(a) for a in e['grad'][1]))
    sk = 'null' if e['sizeKeys'] is None else '[%s]' % ', '.join(arr(k) for k in e['sizeKeys'])
    o.append('  {\n    path: %s, tex: %s,\n    delay: %s, count: %d, burstT: %s, cycles: %d, interval: %s,\n    life: %s, speed: %s, size: %s, sizeY: %s, color: %s,\n    radius: %s, thickness: %s, rotSpeed: %s, limit: %s, dampen: %s,\n    sizeKeys: %s,\n    grad: %s,\n    underCanvas: %s, sort: %d, maxSize: %s,\n  },' % (
        json.dumps(e['path']), json.dumps(e['tex']), pair(e['delay']), e['count'], num(e['burstT']), e['cycles'], num(e['interval']),
        pair(e['life']), pair(e['speed']), pair(e['size']), pair(e['sizeY']), arr(e['color']),
        num(e['radius']), num(e['thickness']), pair(e['rotSpeed']), pair(e['limit']), num(e['dampen']),
        sk, g, 'true' if e['underCanvas'] else 'false', e['sort'], num(e['maxSize'])))
o.append('];')
open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(o) + '\n')
print('wrote', OUT, 'nodes', len(nodes), 'curves', len(curves), 'emitters', len(emitters))
print('textures', sorted({n['sprite'] for n in nodes if 'sprite' in n} | {e['tex'] for e in emitters}))
