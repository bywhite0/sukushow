"""
从 4L masterdata 生成 LLLL 曲目列表。

输入：
  masterdata/Musics.yaml          曲目主数据（236 条）
  masterdata/Units.yaml           组合名
  masterdata/MusicScores.yaml     难度等级与最大连击（154 条，与有谱面的曲目一一对应）
  cache/catalog.json              资源目录（曲绘 / 节奏游戏谱面）
  cache/plain/rhythmgame_chart_*  节奏游戏谱面本体（154 首 × 4 难度 = 617 个）

注意：`data/llll/music_charts/` **不是**节奏游戏谱面，
那是段落 / 情绪分析数据（sections / moods），与音游无关。

难度等级只认 MusicScores.yaml（游戏读它），不从谱面文件反推——
谱面里没有等级字段，从音符数估算出来的等级会与游戏内显示不一致。

输出：
  apps/web/public/song-list.json 结构化清单（前端读取）
  docs/song-list.md     可读表格

用法：
  python3 scripts/gen-song-list.py <4L 根目录>
  （或设置环境变量 LLLL_4L_ROOT）
"""
import collections
import json
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('LLLL_4L_ROOT', '')
if not ROOT:
    sys.exit('用法：python3 scripts/gen-song-list.py <4L 根目录>（或设置 LLLL_4L_ROOT）')
PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(PROJECT, 'docs')

DIFFICULTIES = {'01': 'NORMAL', '02': 'HARD', '03': 'EXPERT', '04': 'MASTER'}
# 难度代号 → MusicScores.yaml 的字段前缀
SCORE_FIELDS = {
    'NORMAL': 'Normal',
    'HARD': 'Hard',
    'EXPERT': 'Expert',
    'MASTER': 'Master',
}


def clean_text(value):
    """把游戏原文里的 NBSP 换成普通空格。

    必要性：masterdata 有 15 首曲名用 U+00A0（不换行空格）而不是 U+0020，
    例如「Daydream\\u00a0Warrior」。HUD 用的 FOT-Rodin 字体**没有 U+00A0 字形**
    （cmap 里只有 U+0020 与 U+3000），而 ImGui 按 GetGlyphRangesJapanese()
    取字形、该范围含 0x0020-0x00FF，于是取不到就画成 fallback 字符 '?'，
    开场卡标题实际渲染成「Daydream?Warrior」。

    只动这一个字符：连字符 U+2010、全角括号等都不碰，
    它们要么字体有字形，要么本来就该保留原样。
    """
    if not isinstance(value, str):
        return value
    return value.replace('\u00a0', ' ')


def parse_yaml_list(path):
    """解析 4L masterdata 的简单 YAML（`- Key: value` 平铺结构）。"""
    items = []
    current = None
    with open(path, encoding='utf-8') as handle:
        for raw in handle:
            line = raw.rstrip('\n')
            if line.startswith('- '):
                if current is not None:
                    items.append(current)
                current = {}
                line = line[2:]
            if current is None:
                continue
            match = re.match(r'^(\s*)([A-Za-z_][\w]*):\s?(.*)$', line)
            if match:
                current[match.group(2)] = match.group(3).strip()
    if current is not None:
        items.append(current)
    return items


def load_catalog_names(path):
    """收集 catalog.json 里所有资产名。"""
    names = set()
    with open(path, encoding='utf-8') as handle:
        entries = json.load(handle)
    for entry in entries:
        for key in ('StrLabelCrc', 'StrContentNameCrcs'):
            value = entry.get(key)
            if isinstance(value, str):
                names.add(value)
            elif isinstance(value, list):
                names.update(item for item in value if isinstance(item, str))
    return names


def main():
    musics = parse_yaml_list(os.path.join(ROOT, 'masterdata/Musics.yaml'))
    units = {u['Id']: u['UnitName'] for u in parse_yaml_list(os.path.join(ROOT, 'masterdata/Units.yaml'))}
    scores = {s['Id']: s for s in parse_yaml_list(os.path.join(ROOT, 'masterdata/MusicScores.yaml'))}
    catalog = load_catalog_names(os.path.join(ROOT, 'cache/catalog.json'))

    # 节奏游戏谱面：rhythmgame_chart_<曲目Id>_<难度>.bytes
    charts_by_song = collections.defaultdict(set)
    for name in catalog:
        match = re.match(r'^rhythmgame_chart_(\d+)_(\d+)\.bytes$', name)
        if match:
            charts_by_song[match.group(1)].add(match.group(2))

    # 曲绘本图：image_music_thumbnail_<JacketId>
    jackets = {name.rsplit('_', 1)[-1] for name in catalog if name.startswith('image_music_thumbnail_')}

    songs = []
    for music in musics:
        music_id = music['Id']
        jacket_id = music.get('JacketId', music_id)
        difficulties = sorted(charts_by_song.get(music_id, ()))
        score = scores.get(music_id, {})

        def score_int(field):
            try:
                return int(score.get(field) or 0)
            except ValueError:
                return 0

        levels = {}
        max_combos = {}
        for code, name in DIFFICULTIES.items():
            if code not in difficulties:
                continue
            prefix = SCORE_FIELDS[name]
            levels[name] = score_int(f'{prefix}Level')
            max_combos[name] = score_int(f'{prefix}MaxCombo')

        songs.append({
            'id': music_id,
            'orderId': int(music.get('OrderId') or 0),
            'title': clean_text(music.get('Title', '')),
            'furigana': clean_text(music.get('TitleFurigana', '')),
            'category': clean_text(music.get('Description', '')),
            'unitId': music.get('UnitId', ''),
            'unitName': clean_text(units.get(music.get('UnitId', ''), '')),
            'generationsId': music.get('GenerationsId', ''),
            'jacketId': jacket_id,
            'jacketAsset': f'image_music_thumbnail_{jacket_id}',
            'jacketPath': f'/assets/jacket/{jacket_id}.png',
            'hasJacket': jacket_id in jackets,
            'charts': {DIFFICULTIES[d]: f'rhythmgame_chart_{music_id}_{d}.bytes' for d in difficulties},
            'difficulties': [DIFFICULTIES[d] for d in difficulties],
            'levels': levels,
            'maxCombos': max_combos,
            'hasChart': bool(difficulties),
            'soundId': music.get('SoundId', ''),
            'songTime': int(music.get('SongTime') or 0),
            'playTime': int(music.get('PlayTime') or 0),
            'feverSectionNo': int(music.get('FeverSectionNo') or 0),
            'centerCharacterId': music.get('CenterCharacterId', ''),
            'singerCharacterId': music.get('SingerCharacterId', ''),
            'supportCharacterId': music.get('SupportCharacterId', ''),
            'startTime': music.get('StartTime', ''),
            'isVideoMode': music.get('IsVideoMode', '0') == '1',
        })

    songs.sort(key=lambda s: s['orderId'])

    os.makedirs(OUT_DIR, exist_ok=True)
    public_dir = os.path.abspath(os.path.join(PROJECT, '..', 'web', 'public'))
    os.makedirs(public_dir, exist_ok=True)
    with_chart = sum(1 for s in songs if s['hasChart'])
    with_jacket = sum(1 for s in songs if s['hasJacket'])
    payload = {
        'source': '4L masterdata/Musics.yaml + masterdata/MusicScores.yaml + cache/catalog.json + cache/plain/rhythmgame_chart_*',
        'total': len(songs),
        'withChart': with_chart,
        'withJacket': with_jacket,
        'units': units,
        'songs': songs,
    }
    for target in [os.path.join(public_dir, 'song-list.json')]:
        with open(target, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)

    lines = [
        '# LLLL 曲目列表',
        '',
        f'共 **{len(songs)}** 首；其中有节奏游戏谱面 **{with_chart}** 首（各 4 难度），'
        f'有曲绘 **{with_jacket}** 首。',
        '',
        '来源：`4L/masterdata/Musics.yaml`、`4L/masterdata/MusicScores.yaml`、'
        '`4L/cache/catalog.json`、`4L/cache/plain/rhythmgame_chart_*.bytes`。',
        '',
        '> 注：`4L/data/llll/music_charts/` 不是节奏游戏谱面，那是段落/情绪分析数据。',
        '> 难度等级取自 `MusicScores.yaml`（游戏读它），不是从音符数推算的。',
        '',
        '| # | 曲目 Id | 曲名 | 分类 | 组合 | 难度等级 | 曲绘 | 时长 |',
        '|---|---|---|---|---|---|---|---|',
    ]
    for index, song in enumerate(songs, 1):
        duration = f'{song["playTime"] / 1000:.0f}s' if song['playTime'] else '-'
        if song['difficulties']:
            chart = ' '.join(
                f'{name[:1]}{song["levels"].get(name) or "-"}' for name in song['difficulties']
            )
        else:
            chart = '—'
        jacket = '✓' if song['hasJacket'] else '—'
        title = song['title'].replace('|', '\\|')
        lines.append(
            f'| {index} | {song["id"]} | {title} | {song["category"]} '
            f'| {song["unitName"]} | {chart} | {jacket} | {duration} |'
        )
    lines.append('')
    lines.append('难度等级写法：`N`ORMAL / `H`ARD / `E`XPERT / `M`ASTER。')
    lines.append('')
    with open(os.path.join(OUT_DIR, 'song-list.md'), 'w', encoding='utf-8') as handle:
        handle.write('\n'.join(lines))

    missing_levels = [s['id'] for s in songs if s['hasChart'] and not all(s['levels'].values())]
    print(f'曲目 {len(songs)} 首')
    print(f'  有节奏游戏谱面：{with_chart} 首（{with_chart * 4} 个谱面文件）')
    print(f'  有曲绘：{with_jacket} 首')
    print(f'  难度等级缺失：{len(missing_levels)} 首 {missing_levels[:10]}')
    print('输出：apps/web/public/song-list.json、docs/song-list.md')
    missing = [s['id'] for s in songs if not s['hasChart']]
    if missing:
        print(f'  无谱面的曲目（{len(missing)}）：{missing}')


if __name__ == '__main__':
    main()
