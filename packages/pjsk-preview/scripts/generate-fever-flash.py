"""从 AssetStudio 对象和 Clip 导出生成闪光遮罩层；参数：clips.json objects.json。"""
import json
import math
import pathlib
import sys
from importlib.util import spec_from_file_location, module_from_spec

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = spec_from_file_location('animation', pathlib.Path(__file__).with_name('generate-fever-animation.py'))
module = module_from_spec(spec)
spec.loader.exec_module(module)
number = module.number


def generate(clips, objects):
    ids = {obj['id']: obj['data'] for obj in objects}
    transforms = {obj['data']['m_GameObject']['m_PathID']: obj['data'] for obj in objects if obj['type'] == 'Transform'}
    clip = next(c for c in clips if c['name'] == 'clip_FeverGauge_flash_v2_01')
    def name(transform):
        return ids[transform['m_GameObject']['m_PathID']]['m_Name']
    def curve(path, kind, attribute, offset=0):
        binding = next((b for b in clip['bindings'] if b['path'] == path and b['type'] == kind and b['attribute'] == attribute), None)
        if binding is None:
            return '{nullptr, 0}'
        index = binding['start'] + offset
        return '{standard::FlashKeys' + str(index) + ', std::size(standard::FlashKeys' + str(index) + ')}'
    rows = []
    for obj in objects:
        if obj['type'] != 'SpriteRenderer':
            continue
        renderer = obj['data']
        child = transforms[renderer['m_GameObject']['m_PathID']]
        if not name(child).startswith('lane_light'):
            continue
        mask = ids[child['m_Father']['m_PathID']]
        lane = ids[mask['m_Father']['m_PathID']]
        root = ids[lane['m_Father']['m_PathID']]
        path = name(lane) + '/' + name(mask)
        rotation = mask['m_LocalRotation']
        values = [root['m_LocalPosition']['y'], lane['m_LocalScale']['x'],
                  mask['m_LocalPosition']['x'], mask['m_LocalPosition']['y'],
                  mask['m_LocalScale']['x'], mask['m_LocalScale']['y'],
                  2 * math.atan2(rotation['z'], rotation['w'])]
        refs = [curve(path, 'Transform', 1), curve(path, 'Transform', 1, 1),
                curve(path + '/' + name(child), 'Transform', 1),
                curve(path + '/' + name(child), 'Transform', 1, 1),
                curve(path + '/' + name(child), 'SpriteRenderer', 304273561),
                curve(name(lane), 'GameObject', 2086281974)]
        rows.append('    {' + ','.join(map(number, values)) + ',' + ','.join(refs) + '},')
    if len(rows) != 4:
        raise ValueError('闪光应有四个经过 SpriteMask 裁剪的光层')
    return '// 从原包生成；不要手改。\n#pragma once\nnamespace fever {\ninline constexpr FlashLayer FlashLayers[] = {\n' + '\n'.join(rows) + '\n};\n}\n'


if __name__ == '__main__':
    clips = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    objects = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    (ROOT / 'native/generated/fever_flash_data.h').write_text(generate(clips, objects), encoding='utf-8')
