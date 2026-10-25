"""从 4.12.0 level57 授权导出生成结算界面数据 src/resultScreenClip.ts。

用法：python scripts/gen-result-screen-data.py <resultui.json> <level57.json> <level57_assets.json> [输出路径]

resultui.json：结算界面（RhythmGameResultScene）导出，提供 UI 树、三段 AnimationClip 曲线与
              粒子路径 / 贴图索引；来源于 4.12.0 level57 的 ResultUI 子树。
level57.json：场景序列化全量导出；用于补 HorizontalLayoutGroup 参数，并复核 UI 子树节点数、
              DFS 子节点顺序、RectTransform 值与 active 状态，以及 TMP 布局和 ParticleSystem 启用模块。
level57_assets.json：场景引用资产导出，用于读取 TMP 字体的 FaceInfo。
输出：默认 packages/llll-preview/src/resultScreenClip.ts。

自检不通过（节点数 / 顺序 / transform 不一致，曲线或贴图解析不了）就直接报错退出，
不静默丢弃数据。
"""
import json
import math
import os
import sys

if len(sys.argv) < 4:
    sys.exit(__doc__)

RESULTUI = sys.argv[1]
LEVEL = sys.argv[2]
ASSETS = sys.argv[3]
OUT = sys.argv[4] if len(sys.argv) > 4 else os.path.join(os.path.dirname(__file__), '..', 'src', 'resultScreenClip.ts')

# clip 名 → 曲线根节点（host）。曲线 path 相对 host；灯位四个控制器共用一份 clip，
# 节点名带圆括号，故 host 记作 `ClearLampRoot ({n})`，播放时把 {n} 换成 1..4。
CLIP_HOSTS = {
    'sc2_ResultTitleAnimation': 'ResultTitle',
    'sc2_ResultClearLampRoot_01': 'TitleContent/ClearLampRoot/ClearLampRoot ({n})',
    'sc2_ResultAllComboPerfect': 'UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot',
}
# ResultCurveProp 里除 attr 之外可直出的属性。
CURVE_PROPS = {'active', 'x', 'y', 'scale.x', 'scale.y', 'r', 'g', 'b', 'a'}
# 设计像素单位只允许 Unity scalingMode 的两种折算（Local = 100，其余 = 1）。
EMITTER_UNITS = (1.0, 100.0)
LAMP_COUNT = 4


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def num(v):
    v = float(v)
    if v == 0:
        return '0'
    if v == int(v) and abs(v) < 1e9:
        return str(int(v))
    return repr(v)


def arr(values):
    return '[' + ', '.join(num(v) for v in values) + ']'


def quote(text):
    return json.dumps(text, ensure_ascii=False)


def close(actual, expected, what):
    assert abs(float(actual) - float(expected)) <= 1e-4, '%s: %r != %r' % (what, actual, expected)


resultui = load(RESULTUI)
level = load(LEVEL)
gos = level['gameobjects']
comps = level['components']
assets = load(ASSETS)
font_metrics = {}
for asset in assets['resources.assets'].values():
    if asset['name'] not in ('FOT-RODINPRO-B SDF', 'FOT-RODINPRO-EB SDF'):
        continue
    face = asset['data']['m_FaceInfo']
    font_metrics[face['m_StyleName']] = {
        'pointSize': face['m_PointSize'],
        'ascent': face['m_AscentLine'],
        'descent': face['m_DescentLine'],
        'lineHeight': face['m_LineHeight'],
    }
assert set(font_metrics) == {'B', 'EB'}, ('缺少结算字体 FaceInfo', font_metrics)


# ── level57：按相对路径建树（子节点顺序取 Transform 的 m_Children）───────────
def components_of(go_id):
    return dict((t, cid) for t, cid in gos[go_id]['components'])


def transform_data(go_id):
    """RectTransform 或普通 Transform 的序列化数据（UI 子树里个别效果节点只有 Transform）。"""
    for comp_type, cid in gos[go_id]['components']:
        if comp_type in ('RectTransform', 'Transform'):
            return comps[cid]['data']
    return None


def rt_data(go_id):
    cid = components_of(go_id).get('RectTransform')
    return None if cid is None else comps[cid]['data']


# Transform 组件 id → GameObject：m_Children 记的是 Transform 组件 id，不是 GameObject id。
tr_to_go = {}
for go_id, go in gos.items():
    for comp_type, cid in go['components']:
        if comp_type in ('RectTransform', 'Transform'):
            tr_to_go[str(cid)] = go_id


def transform_children(go_id):
    """Transform 的 m_Children 顺序 = 布局与绘制顺序。"""
    transform = transform_data(go_id)
    assert transform is not None, (go_id, ' GameObject 缺少 Transform')
    kids = [tr_to_go[str(ref['m_PathID'])] for ref in (transform.get('m_Children') or [])]
    assert kids == gos[go_id]['children'], (go_id, 'Transform 子节点顺序与导出列表不一致')
    return kids


root_names = [root['path'] for root in resultui['roots']]
assert len(root_names) == len(set(root_names)), root_names
for name in root_names:
    assert '/' not in name, ('根节点 path 应为单名', name)
by_name = {}
for go_id, go in gos.items():
    by_name.setdefault(go['name'], []).append(go_id)

level_trees = []
for name in root_names:
    ids = by_name.get(name) or []
    assert len(ids) == 1, ('level57 里根节点名应唯一', name, ids)
    rows = []

    def walk(go_id, path):
        rows.append((path, go_id))
        for child in transform_children(go_id):
            walk(child, path + '/' + gos[child]['name'])

    walk(ids[0], name)
    level_trees.append((name, rows))
level_paths = set(path for _, rows in level_trees for path, _ in rows)
level_go_by_path = dict(row for _, rows in level_trees for row in rows)


def component_data(path, kind):
    cid = components_of(level_go_by_path[path])[kind]
    return comps[cid]['data']


# ── HorizontalLayoutGroup（resultui.json 不含，按 level57 的 GameObject 路径匹配）──
layouts = {}
for _, rows in level_trees:
    for path, go_id in rows:
        for comp_type, cid in gos[go_id]['components']:
            if 'LayoutGroup' not in comp_type:
                continue
            assert comp_type == 'MonoBehaviour:HorizontalLayoutGroup', (path, comp_type)
            data = comps[cid]['data']
            assert data.get('m_Enabled', 1) == 1, (path, '布局组件已禁用')
            assert data['m_ChildForceExpandWidth'] == data['m_ChildForceExpandHeight'], (path, 'forceExpand 宽高不一致')
            assert data['m_ChildScaleWidth'] == 0 and data['m_ChildScaleHeight'] == 0, (path, 'ChildScale 未支持')
            assert data.get('m_ReverseArrangement', 0) == 0, (path, 'ReverseArrangement 未支持')
            assert path not in layouts, ('重复的 HorizontalLayoutGroup', path)
            padding = data['m_Padding']
            layouts[path] = {
                'spacing': data['m_Spacing'],
                'align': data['m_ChildAlignment'],
                'padding': [padding['m_Left'], padding['m_Right'], padding['m_Top'], padding['m_Bottom']],
                'controlWidth': bool(data['m_ChildControlWidth']),
                'controlHeight': bool(data['m_ChildControlHeight']),
                'forceExpand': bool(data['m_ChildForceExpandWidth']),
            }
assert layouts, 'level57 里没有找到 HorizontalLayoutGroup'


# ── resultui：DFS 先序铺平 UI 树 ─────────────────────────────────────────────
nodes = []
node_has_rt = []
node_has_ps = []
plain_images = []


def make_image(node):
    image = node.get('image')
    if image is None:
        return None
    assert image.get('enabled', 1) == 1, (node['path'], 'Image 已禁用')
    rgba = [image.get('r', 1.0), image.get('g', 1.0), image.get('b', 1.0), image.get('a', 1.0)]
    role = node.get('role')
    assert role in (None, 'raw'), (node['path'], '未知 role', role)
    if role == 'raw':
        assert not image.get('sprite') and not image.get('rounded'), (node['path'], 'runtime 贴图不应带 sprite / rounded')
        return {'kind': 'raw', 'rgba': rgba}
    if image.get('rounded'):
        return {
            'kind': 'rounded',
            'rgba': rgba,
            'radius': image['radius'],
            'border': image['border'],
            'falloff': image['falloff'],
        }
    sprite = image.get('sprite') or ''
    if sprite:
        data = component_data(node['path'], 'MonoBehaviour:Image')
        assert data['m_Type'] == 0, (node['path'], '只支持 Simple Image')
        return {'kind': 'sprite', 'sprite': sprite, 'preserveAspect': bool(data['m_PreserveAspect']), 'rgba': rgba}
    # 普通 Image（m_Sprite 为空、非 ProceduralImage）：Unity 按纯色矩形绘制。契约没有纯色类型，
    # 写成 radius = 0 的圆角块，几何与纯色矩形一致。
    plain_images.append(node['path'])
    return {'kind': 'rounded', 'rgba': rgba, 'radius': 0.0, 'border': 0.0, 'falloff': 0.0}


def make_text(node):
    text = node.get('text')
    if text is None:
        return None
    assert text.get('enabled', 1) == 1, (node['path'], '文本已禁用')
    rgba = [text.get('r', 1.0), text.get('g', 1.0), text.get('b', 1.0), text.get('a', 1.0)]
    data = component_data(node['path'], 'MonoBehaviour:TextMeshProUGUI')
    assert data['m_VerticalAlignment'] in (512, 4096), (node['path'], '未支持的垂直对齐')
    assert data['m_HorizontalAlignment'] in (1, 2, 4, 32), (node['path'], '未支持的水平对齐')
    assert all(v == 0 for v in data['m_margin'].values()), (node['path'], '非零文本边距')
    assert data['m_wordSpacing'] == 0, (node['path'], '非零单词间距')
    assert data['m_charWidthMaxAdj'] == 0, (node['path'], '存在自动字宽压缩')
    close(text['size'], data['m_fontSize'], node['path'] + ' fontSize')
    close(text['autoSize'], data['m_enableAutoSizing'], node['path'] + ' autoSize')
    return {
        'content': text.get('content', ''),
        'size': text['size'],
        'font': text['font'],
        'material': text['mat'],
        'align': {1: 1, 2: 2, 4: 3, 32: 6}[data['m_HorizontalAlignment']],
        'vertical': data['m_VerticalAlignment'],
        'characterSpacing': data['m_characterSpacing'],
        'lineSpacing': data['m_lineSpacing'],
        'autoSize': bool(text['autoSize']),
        'minSize': data['m_fontSizeMin'],
        'maxSize': data['m_fontSizeMax'],
        'rgba': rgba,
    }


def flatten(node, parent, out):
    path = node['path']
    assert path not in path_set, ('重复节点 path', path)
    path_set.add(path)
    index = len(out)
    has_rt = 'px' in node
    if has_rt:
        transform = {
            'x': node['px'],
            'y': node['py'],
            'w': node['sw'],
            'h': node['sh'],
            'sx': node.get('sx', 1.0),
            'sy': node.get('sy', 1.0),
            'rot': 2 * math.atan2(node.get('rz', 0.0), node.get('rw', 1.0)),
            'anchor': [node['aminx'], node['aminy'], node['amaxx'], node['amaxy']],
            'pivot': [node['pvx'], node['pvy']],
        }
    else:
        # 导出里没有 RectTransform 字段的只有粒子效果子节点（hasPs）：level57 里它们是普通 Transform，
        # localPosition 0 / scale 1 / 单位旋转，挂在父 RectTransform 的 pivot（父节点均为 0.5）上。
        # 因此按「位于父矩形中心的一个点」写入，保留在树里（它们是 clip active 曲线的目标）。
        assert node.get('hasPs'), (path, '缺少 RectTransform 字段的节点不是粒子效果节点')
        transform = {
            'x': 0.0,
            'y': 0.0,
            'w': 0.0,
            'h': 0.0,
            'sx': 1.0,
            'sy': 1.0,
            'rot': 0.0,
            'anchor': [0.5, 0.5, 0.5, 0.5],
            'pivot': [0.5, 0.5],
        }
    entry = {
        'path': path,
        'parent': parent,
        'active': bool(node['active']),
        'image': make_image(node),
        'text': make_text(node),
        'mask': bool(node.get('mask')),
        'layout': layouts.get(path),
    }
    entry.update(transform)
    out.append(entry)
    node_has_rt.append(has_rt)
    node_has_ps.append(bool(node.get('hasPs')))
    has_rt_by_path[path] = has_rt
    for child in node.get('children') or []:
        flatten(child, index, out)


path_set = set()
has_rt_by_path = {}
tree_rows = []
for root in resultui['roots']:
    start = len(nodes)
    flatten(root, -1, nodes)
    tree_rows.append(nodes[start:])

node_by_path = dict((node['path'], node) for node in nodes)
assert len(node_by_path) == len(nodes)
assert set(layouts) <= set(node_by_path), sorted(set(layouts) - set(node_by_path))
assert sum(1 for node in nodes if node['layout']) == len(layouts)


# ── 自检：节点数与 DFS 顺序和 level57 子树一致 ───────────────────────────────
def direct_children(prefix):
    """按 DFS 顺序返回 prefix 的直接子节点。"""
    return [node for node in nodes
            if node['parent'] >= 0 and nodes[node['parent']]['path'] == prefix]


for (name, rows), flat in zip(level_trees, tree_rows):
    assert [path for path, _ in rows] == [node['path'] for node in flat], ('子树顺序与 level57 不一致', name)
for name, expected in (
    ('TitleContent/ClearLampRoot', ['ClearLampRoot (1)', 'ClearLampRoot (2)', 'ClearLampRoot (3)', 'ClearLampRoot (4)']),
    ('UserRecordContent(A)/JudgementPanel/ComboContent/SpriteRoot', ['Sprite3', 'Sprite2', 'Sprite1', 'Sprite0']),
    ('UserRecordContent(A)/JudgementPanel/FastSlowContent/Horizontal', ['Root1', 'Root2', 'Root3']),
):
    got = [child['path'].rsplit('/', 1)[1] for child in direct_children(name)]
    assert got == expected, ('布局子节点顺序与 level57 Transform 不一致', name, got, expected)
assert len(nodes) == len(level_paths), ('节点数与 level57 子树不一致', len(nodes), len(level_paths))

# ── 自检：RectTransform / active 与 level57 一致 ────────────────────────────
for (_, rows), flat in zip(level_trees, tree_rows):
    for (path, go_id), node in zip(rows, flat):
        rt = rt_data(go_id)
        close(node['active'], gos[go_id]['active'], path + ' active')
        if not has_rt_by_path[path]:
            assert rt is None, (path, 'level57 有 RectTransform 但导出缺字段')
            # 无 RectTransform 的节点必须是普通 Transform 的零变换，居中默认值才与数据等价。
            transform = transform_data(go_id)
            assert transform is not None, (path, 'GameObject 缺少 Transform')
            position = transform['m_LocalPosition']
            close(position['x'], 0, path + ' localPosition.x')
            close(position['y'], 0, path + ' localPosition.y')
            close(position['z'], 0, path + ' localPosition.z')
            scale = transform['m_LocalScale']
            close(scale['x'], 1, path + ' localScale.x')
            close(scale['y'], 1, path + ' localScale.y')
            close(scale['z'], 1, path + ' localScale.z')
            rotation = transform['m_LocalRotation']
            close(rotation['w'], 1, path + ' localRotation.w')
            close(rotation['x'], 0, path + ' localRotation.x')
            close(rotation['y'], 0, path + ' localRotation.y')
            close(rotation['z'], 0, path + ' localRotation.z')
            continue
        assert rt is not None, (path, 'level57 缺 RectTransform')
        close(node['x'], rt['m_AnchoredPosition']['x'], path + ' x')
        close(node['y'], rt['m_AnchoredPosition']['y'], path + ' y')
        close(node['w'], rt['m_SizeDelta']['x'], path + ' w')
        close(node['h'], rt['m_SizeDelta']['y'], path + ' h')
        close(node['sx'], rt['m_LocalScale']['x'], path + ' sx')
        close(node['sy'], rt['m_LocalScale']['y'], path + ' sy')
        close(node['anchor'][0], rt['m_AnchorMin']['x'], path + ' anchorMin.x')
        close(node['anchor'][1], rt['m_AnchorMin']['y'], path + ' anchorMin.y')
        close(node['anchor'][2], rt['m_AnchorMax']['x'], path + ' anchorMax.x')
        close(node['anchor'][3], rt['m_AnchorMax']['y'], path + ' anchorMax.y')
        close(node['pivot'][0], rt['m_Pivot']['x'], path + ' pivot.x')
        close(node['pivot'][1], rt['m_Pivot']['y'], path + ' pivot.y')
        rotation = rt['m_LocalRotation']
        assert abs(rotation['x']) <= 1e-4 and abs(rotation['y']) <= 1e-4, (path, '存在 Z 轴以外的旋转')
        close(node['rot'], 2 * math.atan2(rotation['z'], rotation['w']), path + ' rot')
assert all(has_rt or has_ps for has_rt, has_ps in zip(node_has_rt, node_has_ps))


# ── clip 曲线 ───────────────────────────────────────────────────────────────
def expand_host(host):
    if '{n}' not in host:
        return [host]
    hosts = [host.replace('{n}', str(i)) for i in range(1, LAMP_COUNT + 1)]
    assert len(set(hosts)) == LAMP_COUNT
    return hosts


def resolve_path(host, relative):
    return host if not relative else host + '/' + relative


clips = []
for clip in resultui['anim']:
    name = clip['name']
    assert name in CLIP_HOSTS, ('未知 clip', name)
    host = CLIP_HOSTS[name]
    hosts = expand_host(host)
    for h in hosts:
        assert h in node_by_path, ('clip host 不存在', h)
        assert h in level_paths, ('clip host 不在 level57 子树', h)
    curves = []
    for curve in clip['curves']:
        prop = curve['prop']
        if prop == 'scale.z':
            continue
        if prop.startswith('attr:'):
            out_prop = 'attr'
        else:
            assert prop in CURVE_PROPS, (name, '未知曲线属性', prop)
            out_prop = prop
        if curve.get('isConst') or 'constV' in curve:
            assert curve.get('isConst'), (name, curve['path'], 'constV 缺少 isConst')
            assert not curve['keys'], (name, curve['path'], '常量曲线仍带关键帧')
            keys = [[0.0, 0.0, 0.0, 0.0, float(curve['constV'])]]
        else:
            keys = [[k['t'], k['c0'], k['c1'], k['c2'], k['c3']] for k in curve['keys'] if k['t'] >= 0]
            assert keys, (name, curve['path'], 't < 0 关键帧过滤后为空')
            assert all(keys[i][0] < keys[i + 1][0] for i in range(len(keys) - 1)), (name, curve['path'], '关键帧时间非递增')
        for h in hosts:
            full = resolve_path(h, curve['path'])
            assert full in node_by_path, (name, '曲线路径解析不了', full)
            assert full in level_paths, (name, '曲线路径不在 level57 子树', full)
        curves.append({'path': curve['path'], 'prop': out_prop, 'keys': keys})
    assert curves, (name, '没有可用曲线')
    clips.append({'name': name, 'dur': clip['dur'], 'host': host, 'curves': curves})
assert len(clips) == len(CLIP_HOSTS), ('clip 数量与契约不符', [clip['name'] for clip in clips])


# ── 粒子发射器：以场景原始模块为准，resultui 只提供路径与贴图索引 ───────────
def scalar_range(curve):
    mode = curve['minMaxState']
    assert mode in (0, 3), ('需要曲线采样的标量模式', mode)
    return [curve['minScalar'], curve['scalar']] if mode == 3 else [curve['scalar']] * 2


def gradient_data(gradient):
    assert gradient['m_Mode'] == 0, ('非 Blend 渐变', gradient['m_Mode'])
    cols = [[gradient['ctime%d' % i] / 65535, *[gradient['key%d' % i][c] for c in 'rgb']]
            for i in range(gradient['m_NumColorKeys'])]
    alps = [[gradient['atime%d' % i] / 65535, gradient['key%d' % i]['a']]
            for i in range(gradient['m_NumAlphaKeys'])]
    assert cols and alps
    return {'cols': cols, 'alps': alps}


def vec3(value):
    return [value[c] for c in 'xyz']


emitters = []
for emitter in resultui['fx']:
    path = emitter['path']
    assert path and path in node_by_path, ('发射器节点不存在', path)
    assert node_by_path[path]['path'] in level_paths
    assert emitter['tex'], (path, '发射器贴图名为空')
    assert float(emitter['unit']) in EMITTER_UNITS, (path, '未知单位', emitter['unit'])
    ps = component_data(path, 'ParticleSystem')
    renderer = component_data(path, 'ParticleSystemRenderer')
    initial, shape, emission = ps['InitialModule'], ps['ShapeModule'], ps['EmissionModule']
    assert not ps['looping'] and ps['simulationSpeed'] == 1 and ps['moveWithTransform'] == 0, path
    assert ps['scalingMode'] in (0, 1), path
    supported = {'InitialModule', 'ShapeModule', 'EmissionModule', 'SizeModule', 'RotationModule', 'ColorModule', 'ClampVelocityModule'}
    assert all(k in supported for k, v in ps.items() if 'Module' in k and v.get('enabled')), path
    assert shape['enabled'] and shape['type'] in (0, 2, 4, 10), (path, shape['type'])
    assert shape['arc']['value'] == 360 and shape['randomDirectionAmount'] == 0 and not shape['alignToDirection'], path
    assert emission['rateOverTime']['scalar'] == 0 and emission['rateOverDistance']['scalar'] == 0, path
    assert len(emission['m_Bursts']) == 1, (path, '多个 burst')
    burst = emission['m_Bursts'][0]
    assert burst['probability'] == 1, path
    count = scalar_range(burst['countCurve'])
    assert count[0] == count[1] == int(count[0]), path
    size = ps['SizeModule']
    assert not size['enabled'] or (not size['separateAxes'] and size['curve']['minMaxState'] == 1), path
    size_keys = []
    for key in size['curve']['maxCurve']['m_Curve'] if size['enabled'] else []:
        assert key['weightedMode'] == 0, (path, '加权切线')
        size_keys.append([key['time'], *[key[k] * size['curve']['scalar'] for k in ('value', 'inSlope', 'outSlope')]])
    color = ps['ColorModule']['gradient']
    assert ps['ColorModule']['enabled'] and color['minMaxState'] in (1, 3), path
    gradient = gradient_data(color['maxGradient'])
    gradient2 = gradient_data(color['minGradient']) if color['minMaxState'] == 3 else None
    start = initial['startColor']
    assert start['minMaxState'] == 0 and not initial['rotation3D'], path
    rotation = ps['RotationModule']
    assert not rotation['enabled'] or not rotation['separateAxes'], path
    clamp = ps['ClampVelocityModule']
    if clamp['enabled']:
        assert not clamp['separateAxis'] and clamp['drag']['scalar'] == 0, path
        limit = scalar_range(clamp['magnitude'])
        assert limit[0] == limit[1], path
    assert renderer['m_RenderMode'] in (0, 1) and renderer['m_RenderAlignment'] == 0, path
    assert renderer['m_CameraVelocityScale'] == renderer['m_VelocityScale'] == 0, path
    assert renderer['m_SortingLayer'] in (0, 2, 4), path
    unit = 100.0 if ps['scalingMode'] == 1 else 1.0
    close(unit, emitter['unit'], path + ' unit')
    emitters.append({
        'path': path,
        'count': int(count[0]),
        'btime': burst['time'],
        'cycles': burst['cycleCount'],
        'interval': burst['repeatInterval'],
        'delay': scalar_range(ps['startDelay']),
        'life': scalar_range(initial['startLifetime']),
        'speed': scalar_range(initial['startSpeed']),
        'size': scalar_range(initial['startSize']),
        'sizeY': scalar_range(initial['startSizeY'] if initial['size3D'] else initial['startSize']),
        'size3D': bool(initial['size3D']),
        'shapeR': shape['radius']['value'],
        'shape': {'type': shape['type'], 'thickness': shape['radiusThickness'], 'angle': shape['angle'],
                  'position': vec3(shape['m_Position']), 'rotation': vec3(shape['m_Rotation']), 'scale': vec3(shape['m_Scale'])},
        'startRot': scalar_range(initial['startRotation']),
        'rot': scalar_range(rotation['curve']) if rotation['enabled'] else [0, 0],
        'limit': limit[0] if clamp['enabled'] else None,
        'dampen': clamp['dampen'] if clamp['enabled'] else 0,
        'start': [start['maxColor'][c] for c in 'rgba'],
        'sizeKeys': size_keys,
        'tex': emitter['tex'],
        'sort': renderer['m_SortingOrder'],
        'sortLayer': renderer['m_SortingLayer'],
        'renderMode': renderer['m_RenderMode'],
        'lengthScale': renderer['m_LengthScale'],
        'unit': unit,
        'grad': gradient,
        'grad2': gradient2,
    })
assert set(emitter['path'] for emitter in emitters) == set(node['path'] for node, has_ps in zip(nodes, node_has_ps) if has_ps)


# ── 贴图清单 ────────────────────────────────────────────────────────────────
sprites = sorted(set(node['image']['sprite'] for node in nodes if node['image'] and node['image']['kind'] == 'sprite'))
for node in nodes:
    if node['image'] and node['image']['kind'] == 'sprite':
        assert node['image']['sprite'], (node['path'], 'sprite 名为空')
fx_textures = sorted(set(emitter['tex'] for emitter in emitters))


# ── 输出 TypeScript ─────────────────────────────────────────────────────────
def image_src(image):
    if image is None:
        return 'null'
    if image['kind'] == 'sprite':
        return '{ kind: "sprite", sprite: %s, preserveAspect: %s, rgba: %s }' % (
            quote(image['sprite']), 'true' if image['preserveAspect'] else 'false', arr(image['rgba']))
    if image['kind'] == 'raw':
        return '{ kind: "raw", rgba: %s }' % arr(image['rgba'])
    return '{ kind: "rounded", rgba: %s, radius: %s, border: %s, falloff: %s }' % (
        arr(image['rgba']), num(image['radius']), num(image['border']), num(image['falloff']))


def text_src(text):
    if text is None:
        return 'null'
    return '{ content: %s, size: %s, font: %s, material: %s, align: %d, vertical: %d, characterSpacing: %s, lineSpacing: %s, autoSize: %s, minSize: %s, maxSize: %s, rgba: %s }' % (
        quote(text['content']), num(text['size']), quote(text['font']), quote(text['material']),
        text['align'], text['vertical'], num(text['characterSpacing']), num(text['lineSpacing']),
        'true' if text['autoSize'] else 'false', num(text['minSize']), num(text['maxSize']), arr(text['rgba']))


def layout_src(layout):
    if layout is None:
        return 'null'
    return '{ spacing: %s, align: %d, padding: %s, controlWidth: %s, controlHeight: %s, forceExpand: %s }' % (
        num(layout['spacing']), layout['align'], arr(layout['padding']),
        'true' if layout['controlWidth'] else 'false',
        'true' if layout['controlHeight'] else 'false',
        'true' if layout['forceExpand'] else 'false')


lines = []
lines.append('/**')
lines.append(' * 由 scripts/gen-result-screen-data.py 从 4.12.0 level57 导出生成，勿手改。')
lines.append(' *')
lines.append(' * 结算界面 RhythmGameResultScene（level57）：UI 树、三段 AnimationClip 曲线与粒子发射器。')
lines.append(' * 数据 = 4.12.0 level57 授权导出的 resultui.json（UI 树 / 曲线 / 发射器）+ level57.json')
lines.append(' * （HorizontalLayoutGroup / TMP 布局字段 / ParticleSystem 启用模块，并复核子树与变换），')
lines.append(' * 以及 level57_assets.json（TMP 字体 FaceInfo）。')
lines.append(' *')
lines.append(' * 记录：')
missing_rt = sum(1 for has_rt in has_rt_by_path.values() if not has_rt)
lines.append(' * - 节点按 DFS 先序铺平，parent 为父下标（根 -1）；%d 个节点、%d 段 clip、%d 个发射器。' % (len(nodes), len(clips), len(emitters)))
lines.append(' * - 导出的 %d 个粒子效果子节点在 level57 里是普通 Transform（localPosition 0 / scale 1），' % missing_rt)
lines.append(' *   按挂在本节点矩形中心、零尺寸处理（anchor/pivot 0.5、w/h 0），保留在树里作为 active 曲线目标。')
lines.append(' * - %d 个普通 Image（m_Sprite 为空、非 ProceduralImage，例如分隔线与 Blocker）按 radius = 0' % len(plain_images))
lines.append(' *   的圆角块写入：契约没有纯色矩形类型，radius = 0 的几何与纯色矩形一致。')
lines.append(' * - clip 的 host 是曲线路径的根；ClearLampRoot 的四个灯位共用一份 clip，')
lines.append(' *   host 记作 `TitleContent/ClearLampRoot/ClearLampRoot ({n})`，播放时把 {n} 换成 1..4。')
lines.append(' * - 曲线 scale.z 不导出；attr:<材质属性哈希> 统一记作 attr；t < 0 的关键帧丢弃；')
lines.append(' *   常量绑定（isConst / constV）写成 t = 0 的单键。')
lines.append(' */')
lines.append("import type { ResultClip, ResultEmitter, ResultFontMetrics, ResultNode } from './resultScreenTypes';")
lines.append('')
lines.append('/** 原包 TMP_FontAsset 的行框度量。 */')
lines.append('export const RESULT_FONT_METRICS: Readonly<Record<"B" | "EB", ResultFontMetrics>> = {')
for style in ('B', 'EB'):
    face = font_metrics[style]
    lines.append('  %s: { %s },' % (style, ', '.join('%s: %s' % (k, num(v)) for k, v in face.items())))
lines.append('};')
lines.append('')
lines.append('/** 全部 UI 节点（DFS 先序，parent 为父下标，根为 -1）。 */')
lines.append('export const RESULT_NODES: readonly ResultNode[] = [')
for node in nodes:
    lines.append('  { path: %s, parent: %d, active: %s, x: %s, y: %s, w: %s, h: %s, sx: %s, sy: %s, rot: %s,' % (
        quote(node['path']), node['parent'], 'true' if node['active'] else 'false',
        num(node['x']), num(node['y']), num(node['w']), num(node['h']),
        num(node['sx']), num(node['sy']), num(node['rot'])))
    lines.append('    anchor: %s, pivot: %s,' % (arr(node['anchor']), arr(node['pivot'])))
    lines.append('    image: %s, text: %s, mask: %s, layout: %s },' % (
        image_src(node['image']), text_src(node['text']),
        'true' if node['mask'] else 'false', layout_src(node['layout'])))
lines.append('];')
lines.append('')
lines.append('/** 三段原版 AnimationClip（ResultTitle / ClearLampRoot / ComboEffectRoot）。 */')
lines.append('export const RESULT_CLIPS: readonly ResultClip[] = [')
for clip in clips:
    lines.append('  {')
    lines.append('    name: %s, dur: %s, host: %s,' % (quote(clip['name']), num(clip['dur']), quote(clip['host'])))
    lines.append('    curves: [')
    for curve in clip['curves']:
        lines.append('      { path: %s, prop: %s, keys: [%s] },' % (
            quote(curve['path']), quote(curve['prop']),
            ', '.join(arr(key) for key in curve['keys'])))
    lines.append('    ],')
    lines.append('  },')
lines.append('];')
lines.append('')
lines.append('/** 全部粒子发射器（path 为绝对节点路径，宿主激活后按 clip 的 active 曲线开播）。 */')
lines.append('export const RESULT_FX: readonly ResultEmitter[] = [')
def gradient_src(gradient):
    if gradient is None:
        return 'null'
    return '{ cols: [%s], alps: [%s] }' % (
        ', '.join(arr(col) for col in gradient['cols']),
        ', '.join(arr(alp) for alp in gradient['alps']))


for emitter in emitters:
    lines.append('  {')
    lines.append('    path: %s, count: %d, btime: %s, delay: %s, life: %s,' % (
        quote(emitter['path']), emitter['count'], num(emitter['btime']),
        arr(emitter['delay']), arr(emitter['life'])))
    lines.append('    cycles: %d, interval: %s, startRot: %s,' % (emitter['cycles'], num(emitter['interval']), arr(emitter['startRot'])))
    lines.append('    speed: %s, size: %s, sizeY: %s, shapeR: %s, rot: %s,' % (
        arr(emitter['speed']), arr(emitter['size']), arr(emitter['sizeY']),
        num(emitter['shapeR']), arr(emitter['rot'])))
    lines.append('    shape: %s,' % json.dumps(emitter['shape'], ensure_ascii=False))
    lines.append('    size3D: %s,' % ('true' if emitter['size3D'] else 'false'))
    lines.append('    limit: %s, dampen: %s, start: %s, sizeKeys: [%s],' % (
        'null' if emitter['limit'] is None else num(emitter['limit']), num(emitter['dampen']), arr(emitter['start']),
        ', '.join(arr(key) for key in emitter['sizeKeys'])))
    lines.append('    tex: %s, sort: %d, sortLayer: %d, unit: %s,' % (quote(emitter['tex']), emitter['sort'], emitter['sortLayer'], num(emitter['unit'])))
    lines.append('    renderMode: %d, lengthScale: %s,' % (emitter['renderMode'], num(emitter['lengthScale'])))
    lines.append('    grad: %s, grad2: %s,' % (gradient_src(emitter['grad']), gradient_src(emitter['grad2'])))
    lines.append('  },')
lines.append('];')
lines.append('')
lines.append('/** 结算界面全部 UI 贴图（apps/web/public/rg/sprites/<name>.png）。 */')
lines.append('export const RESULT_SPRITES = %s as const;' % json.dumps(sprites, ensure_ascii=False))
lines.append('')
lines.append('/** 结算界面全部粒子贴图（apps/web/public/rg/banner/<name>.png）。 */')
lines.append('export const RESULT_FX_TEXTURES = %s as const;' % json.dumps(fx_textures, ensure_ascii=False))

with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(lines) + '\n')

print('写出', OUT)
print('nodes %d（其中粒子效果节点 %d、普通无贴图 Image %d）' % (len(nodes), sum(node_has_ps), len(plain_images)))
print('clips %d：%s' % (len(clips), ', '.join('%s（%d 曲线，%s s）' % (clip['name'], len(clip['curves']), num(clip['dur'])) for clip in clips)))
print('emitters %d' % len(emitters))
print('layout %d：%s' % (len(layouts), ', '.join(sorted(layouts))))
print('sprites %d：%s' % (len(sprites), ', '.join(sprites)))
print('fx textures %d：%s' % (len(fx_textures), ', '.join(fx_textures)))
