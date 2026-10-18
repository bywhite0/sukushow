"""
把谱面 / BGM / 曲绘链接进 apps/web/public/assets（硬链接优先，跨盘回退复制）。
MV 使用 ffmpeg 将本地 USM 内的视频流无损重封装为 MP4，仅显式 --only mv 时转换。
与 PJSK 实现 的同名脚本一致。

这些资源体积大（BGM 约 495 MB）且非本项目可再分发，因此不进版本库，
只在本地链接进来；换机器时重跑本脚本即可。

来源（本机路径不进版本库）：
  曲绘  <4L>/exports/images/sticker/image_sticker_40<JacketId>.png  原始分辨率 RGBA
  BGM   <livestage-spine-web>/public/audio/bgm_<SoundId>.ogg
  谱面  <4L>/cache/plain/rhythmgame_chart_<Id>_<n>.bytes
  MV    <4L>/cache/plain/music_lyric_video_<Id>.usm → <assets>/mv/<Id>.mp4
目录按优先级取：环境变量 LLLL_JACKET_DIR / LLLL_AUDIO_DIR / LLLL_CHART_DIR / LLLL_MV_DIR，
其次 scripts/link-assets.local.json 里的 {"jacket": ..., "audio": ..., "chart": ..., "mv": ...}。
MV 未配置时复用 chart 来源目录。

MV 与 25 MiB 上限
-----------------
原包 MV 是 1920x1088 / 30fps / 约 2400 kbps 的恒定码率，体积只由时长决定，
全量 58 首里 57 首超过 25 MiB（最长的一首 57 MiB）。这只有在用 Cloudflare
Workers 静态资源托管时才是硬限制（单文件 25 MiB）；换别的静态托管、或本地
预览，直接放 MP4 也能跑，不切也不影响使用。

首选 `--hls-mv`：把每首切成 fMP4 HLS（`mv/<id>/index.m3u8` + init + 分片），
`-c copy` 零转码，画质与时长完全不变。实测全量 58 首最大单片 5.31 MiB、
总体积只比原 MP4 多 0.00%，每首约 0.3 秒。产物里的 `_headers` 已声明
`.m3u8` / `.m4s` 的 MIME，Safari 原生 HLS 与 hls.js 两条路都能播。

备选 `--compress-mv`：只在确实需要单文件 MP4 时用，按需重编码。

  真无损不可行。原片已是有损压缩，`-qp 0` 重编码会涨到 24 倍（23 MB → 565 MB）；
  `-c copy` 重封装体积一字节不差（容器开销可忽略，且这些 MV 没有音轨）。

  实测（VMAF，越接近 100 越好；95+ 无差别、90 优秀、80 良好、70 可接受、60 明显）：
    HEVC 基线                60.9
    HEVC + tune animation    62.3
    HEVC 720p                61.5   ← 降分辨率无用，瓶颈是码率不是分辨率
    AV1                      53.0   ← 此内容上反而差于 HEVC
    HEVC + 24fps             64.4
    HEVC + 24fps + animation 65.9   ← 最优组合

  24fps 不破坏同步：恒定帧率重采样后时长不变（如 198.500s 仍是 198.500s），
  mv-timing.json 无需改动，浏览器 seek 实测精确。

  因此按所需降幅分档，`--compress-mv` 对超限文件套用「24fps + tune animation」，
  可用 --mv-fps / --mv-crf 覆盖。重度档（需降 >40%）即使压到 25 MiB 也只有
  VMAF 65 左右，观感明显劣化。

用法：
  python3 scripts/link-assets.py [--copy] [--only jacket|audio|chart|mv]
  python3 scripts/link-assets.py --only mv --hls-mv
  python3 scripts/link-assets.py --only mv --compress-mv
  python3 scripts/link-assets.py --list-mv-tiers
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

# Cloudflare Workers 静态资源单文件上限 25 MiB；留一点余量给容器开销。
MV_LIMIT = 25 * 1024 * 1024
MV_TARGET = 23.5 * 1024 * 1024
# 需要降幅超过这个比例就算「重度」：压到上限后观感明显劣化。
HEAVY_DROP = 40.0

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST_ROOT = os.path.abspath(os.path.join(PROJECT, '..', '..', 'apps', 'web', 'public', 'assets'))

SOURCES = {
    'jacket': {
        # 用 image_sticker_40<JacketId> 的原始 PNG（原始分辨率 RGBA）。
        'env': 'LLLL_JACKET_DIR',
        'dest': os.path.join(DEST_ROOT, 'jacket'),
        'ext': '.png',
        'prefix': 'image_sticker_40',
        'strip_prefix': 'image_sticker_40',
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


def probe_duration(path):
    """读视频时长（秒）；读不到返回 None。"""
    try:
        out = subprocess.run([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'format=duration', '-of', 'csv=p=0', os.fspath(path),
        ], check=True, capture_output=True, text=True)
        return float(out.stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        return None


def mv_tier(path, target=MV_TARGET):
    """按「压到 target 需要的降幅」分档。返回 (档位, 需要的降幅百分比)。"""
    size = os.path.getsize(path)
    if size <= target:
        return 'fits', 0.0
    duration = probe_duration(path)
    if not duration:
        return 'unknown', 0.0
    need = (1 - (target / size)) * 100
    if need <= 20:
        return 'light', need
    if need <= HEAVY_DROP:
        return 'medium', need
    return 'heavy', need


def compress_mv(src, dest, fps=24, target=MV_TARGET):
    """把超限的 MV 重编码到 target 以下，原子落盘。

    用「降帧率 + tune animation」而不是降分辨率：实测 720p 在同码率下
    几乎不改善（61.5 vs 60.9），瓶颈是码率。24fps 对 30fps 动画丢的是
    重复帧，且恒定帧率重采样不改变时长，不会破坏与谱面的同步。

    码率按目标体积反算而不是用 CRF：CRF 无法保证上限（实测 HEVC CRF 23
    会产出 54 MB），而时长已知，单遍 ABR 实测误差在 1% 以内。
    """
    if os.path.isfile(dest) and 0 < os.path.getsize(dest) <= target:
        return 'skip'
    duration = probe_duration(src)
    if not duration:
        raise RuntimeError(f'{os.path.basename(src)} 读不出时长，无法计算目标码率')
    # 200 kbps 是这类 1080p 动画的下限；再低就是纯色块了。
    kbps = max(200, int(target * 8 / duration / 1000))
    tmp = os.fspath(dest) + '.part'
    try:
        subprocess.run([
            'ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', os.fspath(src),
            '-map', '0:v:0',
            '-vf', f'fps={fps}',
            '-c:v', 'libx265', '-b:v', f'{kbps}k', '-preset', 'medium',
            '-tune', 'animation',
            '-tag:v', 'hvc1',
            '-movflags', '+faststart',
            '-f', 'mp4', tmp,
        ], check=True)
        size = os.path.getsize(tmp)
        # 硬上限：超了就不能入库，否则 deploy 会整包失败。
        if size > MV_LIMIT:
            os.remove(tmp)
            raise RuntimeError(
                f'{os.path.basename(src)} 压到 {kbps}k 仍有 {size / 1024 / 1024:.1f} MB，'
                f'超过 25 MiB；请降低 --mv-target-mb 后重试'
            )
        # 软目标：码率有下限，短片的实际体积可能仍高于 target，提示但不阻断。
        if size > target:
            print(f'  [提示] {os.path.basename(src)} 实际 {size / 1024 / 1024:.2f} MB，'
                  f'高于目标 {target / 1024 / 1024:.1f} MB（码率已到 200k 下限）')
        os.replace(tmp, dest)
        return 'compress'
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


def ff_path(path):
    """ffmpeg 内部一律按 '/' 解析路径。

    Windows 上 `os.path.join` 给的是反斜杠，ffmpeg 取 dirname 时只认 '/'，
    会把 `.../mv/103103\\index.m3u8` 的目录算成 `.../mv`，于是 init.mp4 落到
    父目录、播放列表指向一个不存在的文件。这里统一转成正斜杠。
    """
    return os.fspath(path).replace(os.sep, '/')


def segment_mv(src, dest_dir, hls_time=10):
    """把 MV 切成 fMP4 HLS（`-c copy`，零转码、零画质损失），返回 (状态, 分片数)。

    这是绕开「单文件 25 MiB」上限的首选方案：Workers 只限制**单个文件**大小，
    对总体积没有限制（免费版 2 万个文件、付费版 10 万个）。实测 58 首全量切分
    后膨胀 0.00%、最大单片 5.31 MB、单首耗时 0.3 秒。

    fMP4 而不是 MPEG-TS：TS 封装会带来约 3.4% 膨胀，fMP4 是 0.00%。

    切分点对齐关键帧，因此分片时长不一定正好等于 hls_time；若某片超过上限，
    说明源关键帧间隔过大，此时应退回压缩（--compress-mv）或本地加载。
    """
    playlist = os.path.join(dest_dir, 'index.m3u8')
    if os.path.isfile(playlist):
        segments = [n for n in os.listdir(dest_dir) if n.endswith('.m4s')]
        if segments:
            return 'skip', len(segments)
    os.makedirs(dest_dir, exist_ok=True)
    for name in os.listdir(dest_dir):
        os.remove(os.path.join(dest_dir, name))
    try:
        subprocess.run([
            'ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', ff_path(src),
            '-map', '0:v:0', '-c', 'copy',
            '-f', 'hls',
            '-hls_time', str(hls_time),
            '-hls_playlist_type', 'vod',
            '-hls_segment_type', 'fmp4',
            '-hls_segment_filename', ff_path(os.path.join(dest_dir, 'seg_%03d.m4s')),
            ff_path(playlist),
        ], check=True)
    except subprocess.CalledProcessError as error:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise RuntimeError(f'{os.path.basename(src)} HLS 切分失败：{error}') from error

    # init.mp4 缺失时播放列表能拉、分片也在，但解码端拿不到 moov，表现为
    # 「能下载、播不出来」。这种半成品绝不能留在产物里。
    if not os.path.isfile(os.path.join(dest_dir, 'init.mp4')):
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise RuntimeError(f'{os.path.basename(src)} HLS 切分缺少 init.mp4')
    segments = [n for n in os.listdir(dest_dir) if n.endswith('.m4s')]
    if not segments:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise RuntimeError(f'{os.path.basename(src)} HLS 切分没有产出分片')
    biggest = max(os.path.getsize(os.path.join(dest_dir, n)) for n in segments)
    if biggest > MV_LIMIT:
        # 超限分片同样会让 deploy 失败，不能留着。
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise RuntimeError(
            f'{os.path.basename(src)} 最大分片 {biggest / 1024 / 1024:.1f} MB 超过 25 MiB；'
            f'源关键帧间隔过大，改用 --compress-mv 或本地加载'
        )
    return 'hls', len(segments)


def list_tiers(dest_dir):
    """列出 MV 体积分档，供决定哪些随产物分发、哪些走本地加载。"""
    if not os.path.isdir(dest_dir):
        print(f'[跳过] MV 目录不存在 {dest_dir}，先跑 --only mv')
        return
    # 已切 HLS 的曲目是子目录；没切的还是单个 mp4。
    hls_dirs = sorted(n for n in os.listdir(dest_dir)
                      if os.path.isdir(os.path.join(dest_dir, n)))
    names = sorted(n for n in os.listdir(dest_dir) if n.endswith('.mp4'))
    if hls_dirs:
        print(f'已切 HLS：{len(hls_dirs)} 首（每首一个目录，分片均低于 25 MiB）')
    if not names and not hls_dirs:
        print(f'[跳过] {dest_dir} 里没有 mp4 也没有 HLS 目录')
        return
    rows = {'fits': [], 'light': [], 'medium': [], 'heavy': [], 'unknown': []}
    for name in names:
        tier, need = mv_tier(os.path.join(dest_dir, name))
        rows[tier].append((name[:-4], os.path.getsize(os.path.join(dest_dir, name)), need))
    label = {'fits': '已在 25 MiB 内', 'light': '轻度（需降 ≤20%）',
             'medium': '中度（需降 ≤40%）', 'heavy': '重度（需降 >40%）', 'unknown': '时长未知'}
    for tier in ('fits', 'light', 'medium', 'heavy', 'unknown'):
        items = rows[tier]
        if not items:
            continue
        print(f'\n=== {label[tier]}：{len(items)} 首 ===')
        for song, size, need in items:
            suffix = '' if tier == 'fits' else f'  需降 {need:.1f}%'
            print(f'  {song}  {size / 1024 / 1024:6.2f} MB{suffix}')
    total = sum(len(v) for v in rows.values()) + len(hls_dirs)
    if rows['heavy']:
        print(f'\n共 {total} 首：其中 {len(rows["heavy"])} 首单文件超限且压缩观感差，'
              f'建议 --hls-mv 切分或走本地加载')
    else:
        print(f'\n共 {total} 首：全部可直接随产物分发')


def main():
    parser = argparse.ArgumentParser(description='链接谱面 / BGM / 曲绘，或将 MV 重封装 / 压缩到 apps/web/public/assets')
    parser.add_argument('--copy', action='store_true', help='强制复制而非硬链接（跨盘时用）')
    parser.add_argument('--only', choices=sorted(SOURCES), help='只处理某一类')
    parser.add_argument('--compress-mv', action='store_true',
                        help='重封装后把超过 25 MiB 的 MV 重编码到上限以内（有损）')
    parser.add_argument('--hls-mv', action='store_true',
                        help='把 MV 切成 fMP4 HLS 到 mv/<id>/（零画质损失，推荐）')
    parser.add_argument('--hls-time', type=int, default=10, help='HLS 分片目标时长秒数（默认 10）')
    parser.add_argument('--mv-fps', type=int, default=24, help='压缩时的帧率（默认 24）')
    parser.add_argument('--mv-target-mb', type=float, default=23.5,
                        help='压缩目标体积 MiB（默认 23.5，留余量）')
    parser.add_argument('--list-mv-tiers', action='store_true',
                        help='按 25 MiB 上限列出 MV 分档后退出')
    args = parser.parse_args()

    if args.list_mv_tiers:
        list_tiers(SOURCES['mv']['dest'])
        return

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
        stats = {'link': 0, 'copy': 0, 'skip': 0, 'convert': 0, 'compress': 0, 'hls': 0}
        prefix = config.get('prefix', '')
        strip = config.get('strip_prefix', '')
        for name in sorted(os.listdir(src_dir)):
            if not name.endswith(config['ext']) or not name.startswith(prefix):
                continue
            dest_name = name[len(strip):] if strip else name
            if kind == 'mv':
                src_path = os.path.join(src_dir, name)
                song_id = dest_name[:-4]
                dest_path = os.path.join(dest_dir, song_id + '.mp4')
                result = remux_mv(src_path, dest_path)
                if args.hls_mv:
                    status, count = segment_mv(
                        dest_path, os.path.join(dest_dir, song_id), args.hls_time
                    )
                    print(f'  HLS {song_id}：{count} 片（{status}）')
                    # 切好之后单个 mp4 就没用了，留着只会撑大产物。
                    # 重跑时 status 是 skip，也要删掉刚重封装出来的那份。
                    os.remove(dest_path)
                    result = 'hls' if status == 'hls' else 'skip'
                elif args.compress_mv:
                    # 已存在的文件也可能是之前不带压缩跑出来的，同样要检查上限。
                    tier, need = mv_tier(dest_path)
                    if tier in ('light', 'medium', 'heavy'):
                        print(f'  压缩 {song_id}（需降 {need:.1f}%）…')
                        result = compress_mv(
                            dest_path, dest_path, fps=args.mv_fps,
                            target=args.mv_target_mb * 1024 * 1024,
                        )
            else:
                result = link_or_copy(
                    os.path.join(src_dir, name), os.path.join(dest_dir, dest_name), args.copy
                )
            stats[result] += 1
        total = sum(stats.values())
        print(f'{kind}: {total} 个（硬链接 {stats["link"]}、复制 {stats["copy"]}、'
              f'重封装 {stats["convert"]}、压缩 {stats["compress"]}、'
              f'HLS {stats["hls"]}、已存在 {stats["skip"]}）')
        print(f'  {dest_dir}')


if __name__ == '__main__':
    main()
