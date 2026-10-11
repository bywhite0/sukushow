"""将 AssetStudio Clip 多项式和 Prefab 变换生成 native 数据。
用法：python scripts/generate-fever-animation.py <clips.json> <objects.json>
对象 ID 必须保留为整数，不能经过 JavaScript Number。
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def number(value):
    text = format(float(value), '.9g')
    return text + ('f' if '.' in text or 'e' in text else '.0f')


def generate(clips, objects, namespace='fever'):
    by_id = {obj['id']: obj for obj in objects}
    transforms = {obj['data']['m_GameObject']['m_PathID']: obj for obj in objects if obj['type'] == 'Transform'}
    renderers = {obj['data']['m_GameObject']['m_PathID']: obj for obj in objects if obj['type'] == 'SpriteRenderer'}
    modes = [('Fever', 'fx_fever_v2', 'clip_fever_v2_01', 'fever'),
             ('Chance', 'fx_fever_chance_v2', 'clip_feverchance_v2_01', 'chance'),
             ('Super', 'fx_super_fever_v2', 'clip_superfever_v2_01', 'super'),
             ('Flash', 'fx_fever_gauge_flash_v2', 'clip_FeverGauge_flash_v2_01', '')]
    lines = ['// 由 generate-fever-animation.py 生成；不要手动调整曲线。', '#pragma once', 'namespace ' + namespace + ' {']
    for mode, root_name, clip_name, texture_prefix in modes:
        clip = next(c for c in clips if c['name'] == clip_name)
        curves = {}
        for frame in clip['frames']:
            for key in frame['keys']:
                curves.setdefault(key['index'], []).append((frame['time'], key['coefficients']))
        for offset, value in enumerate(clip.get('constants', [])):
            curves[clip['streamedCount'] + offset] = [(0, [0, 0, 0, value])]
        for index, keys in curves.items():
            values = ','.join('{' + number(t) + ',{' + ','.join(map(number, coeff)) + '}}' for t, coeff in keys)
            lines.append(f'inline constexpr Key {mode}Keys{index}[] = {{{values}}};')
        root_go = next(obj for obj in objects if obj['type'] == 'GameObject' and obj['data']['m_Name'] == root_name)
        root = transforms[root_go['id']]['data']
        if mode == 'Flash' and not root['m_Children']:
            lines.append(f'inline constexpr Clip FlashClip = {{{number(clip["stopTime"])}, nullptr, 0, nullptr, 0}};')
            continue
        animator = by_id[root['m_Children'][0]['m_PathID']]['data']
        text = next((by_id[c['m_PathID']]['data'] for c in animator['m_Children']
                     if by_id[by_id[c['m_PathID']]['data']['m_GameObject']['m_PathID']]['data']['m_Name'] == 'Text'),
                    {'m_LocalPosition': {'x': 0, 'y': 0}, 'm_LocalScale': {'x': 1, 'y': 1}, 'm_Children': []})
        parent_x = animator['m_LocalPosition']['x'] + text['m_LocalPosition']['x']
        parent_y = animator['m_LocalPosition']['y'] + text['m_LocalPosition']['y']
        sx, sy = text['m_LocalScale']['x'], text['m_LocalScale']['y']
        lines.append(f'inline constexpr Glyph {mode}Glyphs[] = {{')
        for child in text['m_Children']:
            transform = by_id[child['m_PathID']]['data']
            go_id = transform['m_GameObject']['m_PathID']
            name = by_id[go_id]['data']['m_Name']
            renderer = renderers[go_id]['data']
            sprite = by_id[renderer['m_Sprite']['m_PathID']]['data']
            position = next(b for b in clip['bindings'] if b['path'] == 'Text/' + name and b['type'] == 'Transform' and b['attribute'] == 1)
            alpha = next(b for b in clip['bindings'] if b['path'] == 'Text/' + name and b['type'] == 'SpriteRenderer' and b['attribute'] == 304273561)
            refs = []
            for index in [position['start'], position['start'] + 1, alpha['start']]:
                refs.append('{' + f'{mode}Keys{index}, std::size({mode}Keys{index})' + '}')
            values = [parent_x, parent_y, sx, sy, sprite['m_PixelsToUnits']]
            values += [sprite['m_Rect'][key] for key in ('x', 'y', 'width', 'height')]
            atlas = {'fever': 'fever_text_atlas', 'chance': 'fever_chance_text_atlas', 'super': 'super_fever_text_atlas'}[texture_prefix]
            lines.append('    {"' + atlas + '",' + ','.join(map(number, values)) + ',' + ','.join(refs) + '},')
        if not text['m_Children']:
            lines.append('    {},')
        lines.append('};')
        beams = []
        for child in animator['m_Children']:
            transform = by_id[child['m_PathID']]['data']
            go_id = transform['m_GameObject']['m_PathID']
            name = by_id[go_id]['data']['m_Name']
            if name not in ('over_L', 'over_R'):
                continue
            renderer = renderers[go_id]['data']
            sprite = by_id[renderer['m_Sprite']['m_PathID']]['data']
            rotation = transform['m_LocalRotation']
            values = [animator['m_LocalPosition']['x'], animator['m_LocalPosition']['y'],
                      -2 * math.atan2(rotation['z'], rotation['w']), sprite['m_PixelsToUnits']]
            values += [renderer['m_Color'][c] for c in 'rgba']
            refs = []
            for kind, attribute, offsets in [('Transform', 1, [0, 1]), ('Transform', 3, [0, 1]), ('GameObject', 2086281974, [0])]:
                binding = next(b for b in clip['bindings'] if b['path'] == name and b['type'] == kind and b['attribute'] == attribute)
                for offset in offsets:
                    index = binding['start'] + offset
                    refs.append('{' + f'{mode}Keys{index}, std::size({mode}Keys{index})' + '}')
            alpha = next((b for b in clip['bindings'] if b['path'] == name and b['type'] == 'SpriteRenderer' and b['attribute'] == 304273561), None)
            if alpha:
                values[-1] = curves[alpha['start']][0][1][3]
            beams.append('{' + ','.join(map(number, values)) + ',' + ','.join(refs) + '}')
        if beams:
            lines.append(f'inline constexpr Beam {mode}Beams[] = {{' + ','.join(beams) + '};')
        beam_ref = f'{mode}Beams, std::size({mode}Beams)' if beams else 'nullptr, 0'
        glyph_count = f'std::size({mode}Glyphs)' if text['m_Children'] else '0'
        lines.append(f'inline constexpr Clip {mode}Clip = {{{number(clip["stopTime"])}, {mode}Glyphs, {glyph_count}, {beam_ref}}};')
    if namespace.endswith('standard'):
        flow = next(c for c in clips if c['name'] == 'clip_FeverGauge_SuperFever')
        values = []
        for frame in flow['frames']:
            key = next(key for key in frame['keys'] if key['index'] == 0)
            values.append('{' + number(frame['time']) + ',{' + ','.join(map(number, key['coefficients'])) + '}}')
        lines.append('inline constexpr Key GaugeFlowKeys0[] = {' + ','.join(values) + '};')
    lines.append('}')
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    clips = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    objects = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    namespace = 'fever::standard' if len(sys.argv) > 3 and sys.argv[3] == '0' else 'fever'
    filename = 'fever_animation_standard.h' if namespace.endswith('standard') else 'fever_animation_data.h'
    (ROOT / 'native/generated' / filename).write_text(generate(clips, objects, namespace), encoding='utf-8')
