"""
把谱面 / BGM / 曲绘链接进 apps/web/public/assets（硬链接优先，跨盘回退复制）。
MV 使用 ffmpeg 将本地 USM 内的视频流无损重封装为 MP4，仅显式 --only mv 时转换。
与 PJSK 实现 的同名脚本一致。

这些资源体积大（BGM 约 495 MB）且非本项目可再分发，因此不进版本库，
只在本地链接进来；换机器时重跑本脚本即可。

来源（本机路径不进版本库）：
  曲绘  <4L>/exports/images/music/thumbnail/image_music_thumbnail_<JacketId>.png  288x288 RGBA
  BGM   <livestage-spine-web>/public/audio/bgm_<SoundId>.ogg
  谱面  <4L>/cache/plain/rhythmgame_chart_<Id>_<n>.bytes
  MV    <4L>/cache/plain/music_lyric_video_<Id>.usm → <assets>/mv/<Id>.mp4
目录按优先级取：环境变量 LLLL_JACKET_DIR / LLLL_AUDIO_DIR / LLLL_CHART_DIR / LLLL_MV_DIR，
其次 scripts/link-assets.local.json 里的 {"jacket": ..., "audio": ..., "chart": ..., "mv": ...}。
MV 未配置时复用 chart 来源目录。

用法：
  python3 scripts/link-assets.py [--copy] [--only jacket|audio|chart|mv]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_ROOT = os.path.abspath(os.path.join(PROJECT, '..', '..', 'apps', 'web', 'public', 'assets'))

SOURCES = {
    'jacket': {
        # 用 4L 的原始 PNG（288x288 RGBA），而非 livestage 的有损 WebP。
        'env': 'LLLL_JACKET_DIR',
        'dest': os.path.join(DEST_ROOT, 'jacket'),
        'ext': '.png',
        'prefix': 'image_music_thumbnail_',
        'strip_prefix': 'image_music_thumbnail_',
    },
    'audio': {
        'env': 'LLLL_AUDIO_DIR',
        'dest': os.path.join(DEST_ROOT, 'audio'),
        'ext': '.ogg',
    },
    'chart': {
        'env': 'LLLL_CHART_DIR',
        'dest': os.path.join(DEST_ROOT, 'chart'),
        'ext': '.bytes',
        'prefix': 'rhythmgame_chart_',
    },
    'mv': {
        'env': 'LLLL_MV_DIR',
        'dest': os.path.join(DEST_ROOT, 'mv'),
        'ext': '.usm',
        'prefix': 'music_lyric_video_',
        'strip_prefix': 'music_lyric_video_',
    },
}


LOCAL_CONFIG = os.path.join(PROJECT, 'scripts', 'link-assets.local.json')


def source_dir(kind):
    value = os.environ.get(SOURCES[kind]['env'])
    if not value and os.path.isfile(LOCAL_CONFIG):
        with open(LOCAL_CONFIG, encoding='utf-8') as handle:
            value = json.load(handle).get(kind)
    return value or (source_dir('chart') if kind == 'mv' else '')


def remux_mv(src, dest):
    """只换容器，原子落盘；USM 视频流原样保留。"""
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return 'skip'
    tmp = os.fspath(dest) + '.part'
    try:
        subprocess.run([
            'ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', os.fspath(src),
            '-map', '0:v:0', '-c:v', 'copy', '-movflags', '+faststart',
            '-f', 'mp4', tmp,
        ], check=True)
        os.replace(tmp, dest)
        return 'convert'
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def link_or_copy(src, dest, force_copy=False):
    """硬链接优先（同盘零占用）；失败则复制。返回 'link' / 'copy' / 'skip'。"""
    if os.path.exists(dest):
        try:
            if os.path.samefile(src, dest):
                return 'skip'
        except OSError:
            pass
    if not force_copy:
        try:
            os.link(src, dest)
            return 'link'
        except OSError:
            pass
    shutil.copy2(src, dest)
    return 'copy'


def main():
    parser = argparse.ArgumentParser(description='链接谱面 / BGM / 曲绘，或将 MV 无损重封装到 apps/web/public/assets')
    parser.add_argument('--copy', action='store_true', help='强制复制而非硬链接（跨盘时用）')
    parser.add_argument('--only', choices=sorted(SOURCES), help='只处理某一类')
    args = parser.parse_args()

    targets = [args.only] if args.only else sorted(kind for kind in SOURCES if kind != 'mv')
    for kind in targets:
        config = SOURCES[kind]
        src_dir, dest_dir = source_dir(kind), config['dest']
        if not src_dir:
            print(f'[跳过] {kind}：未配置来源（{config["env"]} 或 scripts/link-assets.local.json）')
            continue
        if not os.path.isdir(src_dir):
            print(f'[跳过] {kind}：来源目录不存在 {src_dir}')
            continue
        os.makedirs(dest_dir, exist_ok=True)
        stats = {'link': 0, 'copy': 0, 'skip': 0, 'convert': 0}
        prefix = config.get('prefix', '')
        strip = config.get('strip_prefix', '')
        for name in sorted(os.listdir(src_dir)):
            if not name.endswith(config['ext']) or not name.startswith(prefix):
                continue
            dest_name = name[len(strip):] if strip else name
            if kind == 'mv':
                result = remux_mv(
                    os.path.join(src_dir, name), os.path.join(dest_dir, dest_name[:-4] + '.mp4')
                )
            else:
                result = link_or_copy(
                    os.path.join(src_dir, name), os.path.join(dest_dir, dest_name), args.copy
                )
            stats[result] += 1
        total = sum(stats.values())
        print(f'{kind}: {total} 个（硬链接 {stats["link"]}、复制 {stats["copy"]}、重封装 {stats["convert"]}、已存在 {stats["skip"]}）')
        print(f'  {dest_dir}')


if __name__ == '__main__':
    main()
