"""从本地 Unity TimelineAsset 提取节奏游戏 MV 片段起点和时长。

用法：python scripts/gen-mv-timing.py <4L/cache/plain> [输出 JSON 路径]
需要 UnityPy；只写数值，不复制或提交游戏视频。
"""
import glob
import json
import os
import re
import sys

import UnityPy

DEFAULT_OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src', 'mv-timing.json'))


def extract_timing(source_dir):
    timings = {}
    movies = sorted(glob.glob(os.path.join(source_dir, 'music_lyric_video_*.usm')))
    if not movies:
        raise ValueError('未找到 music_lyric_video_*.usm')
    for movie in movies:
        song_id = re.fullmatch(r'music_lyric_video_(\d+)\.usm', os.path.basename(movie)).group(1)
        bundles = glob.glob(os.path.join(source_dir, f'__live_{song_id}*_timeline.playable.assetbundle'))
        if len(bundles) != 1:
            raise ValueError(f'{song_id}: 应有且仅有一个 timeline playable，实际 {len(bundles)} 个')
        env = UnityPy.load(bundles[0])
        tracks = [obj.read_typetree() for obj in env.objects if obj.type.name == 'MonoBehaviour']
        mana = [track for track in tracks if track.get('m_Name') == 'Cri Mana Track']
        if len(mana) != 1 or len(mana[0].get('m_Clips', [])) != 1:
            raise ValueError(f'{song_id}: Cri Mana Track 应有且仅有一个片段')
        clip = mana[0]['m_Clips'][0]
        if clip['m_ClipIn'] != 0 or clip['m_TimeScale'] != 1:
            raise ValueError(f'{song_id}: 未支持的电影片段入点或速度')
        if song_id not in clip['m_DisplayName']:
            raise ValueError(f'{song_id}: 电影片段名称与曲目不符')
        timings[song_id] = [clip['m_Start'], clip['m_Duration']]
    return timings


def main():
    if len(sys.argv) < 2:
        sys.exit('用法：python scripts/gen-mv-timing.py <4L/cache/plain> [输出 JSON 路径]')
    timings = extract_timing(sys.argv[1])
    target = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump(timings, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(f'已写入 {len(timings)} 条 MV 时间线：{target}')


if __name__ == '__main__':
    main()
