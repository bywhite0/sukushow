"""从曲终横幅导出生成 src/comboResultClip.ts（RhythmGameComboResult：AllPerfect / FullCombo / Clear / Finish）。

用法：python scripts/gen-combo-result-clip.py <banners.json> <level56.json> [输出路径]

banners.json：横幅导出（四个 root 的 UI 树 + sharedassets56 AnimationClip #99/#102/#100/#101 的 StreamedClip 解码）。
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
# GetResultIndex：AP→0，FC→1，Clear→2，Finish→3；roots[idx] 与 anim idx 一一对应
RESULTS = [(0, 'AP', 'Root-AllPerfect'), (1, 'FC', 'Root-FullCombo'), (2, 'CLEAR', 'Root-Clear'), (3, 'FINISH', 'Root-Finish')]

def num(v):
    v = float(v)
    if v == 0:
        return '0'
    if v == int(v) and abs(v) < 1e9:
        return str(int(v))
    return repr(v)

def build(INDEX, ROOT_NAME):
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
    skipped = []
    for p, g in by_path.items():
        rel = p[len(PREFIX):] if p.startswith(PREFIX) else None
        if not rel or not rel.startswith(ROOT_NAME + '/'):
            continue
        cm = dict((t, cid) for t, cid in g['components'])
        if 'ParticleSystem' not in cm:
            continue
        d = comps[cm['ParticleSystem']]['data']
        r = comps[cm['ParticleSystemRenderer']]['data']
        # 原包 Clear / Finish 里大量发射器是关着的：GameObject inactive（含祖先），或 Renderer.m_Enabled=false
        # （仍模拟但不绘制）。两者都不出画面，直接跳过，免得把 Ring / Glow 光球等画出来。
        chain, q = [], p
        while q != PREFIX + ROOT_NAME:
            chain.append(by_path[q]['active'])
            q = q.rsplit('/', 1)[0]
        if not all(chain) or not r.get('m_Enabled', 1):
            skipped.append(rel)
            continue
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
        # 0 Sphere(半径 0) / 10 Circle：沿半径向外；5 Box：体积内均匀，发射方向沿形状局部 Z（视线方向）
        assert shp['enabled'] and shp['type'] in (0, 5, 10), (rel, shp['type'])
        v3 = lambda k: (shp[k]['x'], shp[k]['y'], shp[k]['z'])
        assert shp.get('randomDirectionAmount', 0) == 0 and shp.get('sphericalDirectionAmount', 0) == 0, rel
        if shp['type'] == 5:
            assert v3('boxThickness') == (0, 0, 0), rel  # 整个体积发射
            rx, ry, rz = v3('m_Rotation')
            assert ry == 0 and rz == 0 and rx in (0, 180), rel  # 只绕 X 翻转：方向仍在 ±Z，平面内分布对称
            assert v3('m_Position')[:2] == (0, 0), rel
        else:
            # 位置只可能有 Z 偏移（沿视线，平面投影下不影响）
            # 绕 X 转 180° 只把圆镜像（角度取负），均匀角分布下统计上不变
            assert v3('m_Position')[:2] == (0, 0) and v3('m_Rotation')[1:] == (0, 0) and v3('m_Rotation')[0] in (0, 180) and v3('m_Scale') == (1, 1, 1), (rel, v3('m_Position'), v3('m_Rotation'), v3('m_Scale'))
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
            'shape': 'box' if shp['type'] == 5 else 'circle',
            'box': (shp['m_Scale']['x'], shp['m_Scale']['y']) if shp['type'] == 5 else None,
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
    print('%s: %d emitters, skipped (inactive / renderer off): %s' % (ROOT_NAME, len(emitters), ', '.join(x.split('/')[-1] for x in skipped) or '-'))
    return nodes, curves, emitters, clip

# ── 输出 ───────────────────────────────────────────────────────────
def arr(xs):
    return '[' + ', '.join(num(x) for x in xs) + ']'
def pair(t):
    return 'null' if t is None else arr(t)
o = []
o.append('/**\n * 曲终横幅 RhythmGameComboResult（level56 GO 370 下 Root/Root-AllPerfect、Root-FullCombo、Root-Clear、Root-Finish）。\n'
         ' * 动画 = sharedassets56 AnimationClip #99/#102/#100/#101（各 4 s）StreamedClip 逐键解码：\n'
         ' * 段内 v = a·u³ + b·u² + c·u + d，u = t − 键时刻；常量绑定写成 t=0 单键。\n'
         ' * UI 树取 RectTransform / Image / GradientColor 序列化值（1920×1080，全部中心锚点）。\n'
         ' * 发射器取 level56 ParticleSystem / ParticleSystemRenderer 原值。\n'
         ' * 由 scripts/gen-combo-result-clip.py 生成，勿手改。\n */')
o.append('export type BannerKey = readonly [t: number, a: number, b: number, c: number, d: number];')
o.append('export type Range = readonly [min: number, max: number];')
o.append('export interface BannerNode {\n  path: string; parent: number; active: boolean;\n  x: number; y: number; w: number; h: number; sx: number; sy: number; rot: number;\n  sprite?: string; rgba?: readonly [number, number, number, number];\n  gradL?: readonly [number, number, number, number]; gradR?: readonly [number, number, number, number];\n}')
o.append('export interface BannerCurve { path: string; prop: string; keys: readonly BannerKey[] }')
o.append('export interface BannerEmitter {\n  path: string; tex: string; delay: Range; count: number; burstT: number; cycles: number; interval: number;\n  life: Range; speed: Range; size: Range; sizeY: Range | null; color: readonly [number, number, number, number];\n  shape: \'circle\' | \'box\'; box: Range | null;\n  radius: number; thickness: number; rotSpeed: Range | null; limit: Range | null; dampen: number;\n  sizeKeys: readonly (readonly [t: number, v: number, inSlope: number, outSlope: number])[] | null;\n  grad: readonly [cols: readonly (readonly [t: number, r: number, g: number, b: number])[], alps: readonly (readonly [t: number, a: number])[]] | null;\n  underCanvas: boolean; sort: number; maxSize: number;\n}')
built = [(idx, key, rn) + build(idx, rn) for idx, key, rn in RESULTS]
durs = {c['dur'] for *_, c in built}
assert len(durs) == 1, durs
o.append('export const COMBO_RESULT_CLIP_DURATION = %s;' % num(durs.pop()))
o.append('/** 全屏黑罩 Bg 的 Image.color（四档共用）。 */')
o.append('export const COMBO_RESULT_BG = %s as const;' % arr(banners['bg']))
o.append('export interface BannerClip { index: number; root: string; clip: string; nodes: readonly BannerNode[]; curves: readonly BannerCurve[]; emitters: readonly BannerEmitter[] }')
tex_all = set()
for idx, key, rn, nodes, curves, emitters, clip in built:
    o.append('// ── %s（roots[%d] = %s，clip `%s`）' % (key, idx, rn, clip['name']))
    o.append('export const %s_BANNER_NODES: readonly BannerNode[] = [' % key)
    for n in nodes:
        parts = ['path: %s' % json.dumps(n['path']), 'parent: %d' % n['parent'], 'active: %s' % ('true' if n['active'] else 'false')]
        for k in ('x', 'y', 'w', 'h', 'sx', 'sy', 'rot'):
            parts.append('%s: %s' % (k, num(n[k])))
        if 'sprite' in n:
            parts.append('sprite: %s' % json.dumps(n['sprite']))
            parts.append('rgba: %s' % arr(n['rgba']))
            tex_all.add(n['sprite'])
        if 'gradL' in n:
            parts.append('gradL: %s, gradR: %s' % (arr(n['gradL']), arr(n['gradR'])))
        o.append('  { ' + ', '.join(parts) + ' },')
    o.append('];')
    o.append('export const %s_BANNER_CURVES: readonly BannerCurve[] = [' % key)
    for p, prop, keys in curves:
        o.append('  { path: %s, prop: %s, keys: [%s] },' % (json.dumps(p), json.dumps(prop), ', '.join(arr(k) for k in keys)))
    o.append('];')
    o.append('export const %s_BANNER_EMITTERS: readonly BannerEmitter[] = [' % key)
    for e in emitters:
        tex_all.add(e['tex'])
        g = 'null' if e['grad'] is None else '[[%s], [%s]]' % (', '.join(arr(c) for c in e['grad'][0]), ', '.join(arr(a) for a in e['grad'][1]))
        sk = 'null' if e['sizeKeys'] is None else '[%s]' % ', '.join(arr(k) for k in e['sizeKeys'])
        o.append('  {\n    path: %s, tex: %s,\n    delay: %s, count: %d, burstT: %s, cycles: %d, interval: %s,\n    life: %s, speed: %s, size: %s, sizeY: %s, color: %s,\n    shape: %s, box: %s,\n    radius: %s, thickness: %s, rotSpeed: %s, limit: %s, dampen: %s,\n    sizeKeys: %s,\n    grad: %s,\n    underCanvas: %s, sort: %d, maxSize: %s,\n  },' % (
            json.dumps(e['path']), json.dumps(e['tex']), pair(e['delay']), e['count'], num(e['burstT']), e['cycles'], num(e['interval']),
            pair(e['life']), pair(e['speed']), pair(e['size']), pair(e['sizeY']), arr(e['color']),
            json.dumps(e['shape']), pair(e['box']),
            num(e['radius']), num(e['thickness']), pair(e['rotSpeed']), pair(e['limit']), num(e['dampen']),
            sk, g, 'true' if e['underCanvas'] else 'false', e['sort'], num(e['maxSize'])))
    o.append('];')
o.append('/** 按 GetResultIndex 排列：0 AP、1 FC、2 Clear、3 Finish。 */')
o.append('export const COMBO_RESULT_BANNERS: readonly BannerClip[] = [')
for idx, key, rn, nodes, curves, emitters, clip in built:
    o.append('  { index: %d, root: %s, clip: %s, nodes: %s_BANNER_NODES, curves: %s_BANNER_CURVES, emitters: %s_BANNER_EMITTERS },' % (idx, json.dumps(rn), json.dumps(clip['name']), key, key, key))
o.append('];')
o.append('/** 四档用到的全部贴图（public/rg/banner/*.png）。 */')
o.append('export const COMBO_RESULT_TEXTURES = %s as const;' % json.dumps(sorted(tex_all)))
open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(o) + '\n')
print('wrote', OUT)
for idx, key, rn, nodes, curves, emitters, clip in built:
    print(key, 'nodes', len(nodes), 'curves', len(curves), 'emitters', len(emitters))
print('textures', sorted(tex_all))
