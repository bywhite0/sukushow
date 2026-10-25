"""从原始音频包导出结算音乐与音效。

用法：python scripts/export-result-audio.py --plain <资源目录> --ui <ui.acb>
依赖 PATH 中的 vgmstream-cli 与 ffmpeg。音乐写入不入库的 assets/audio，短音效写入 se。
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def metadata(path, index=1):
    return json.loads(subprocess.check_output([
        'vgmstream-cli', '-I', '-m', '-s', str(index), str(path)
    ], text=True, encoding='utf-8'))


def export_cues(path, names, dest):
    remaining = set(names)
    total = metadata(path)['streamInfo']['total']
    for index in range(1, total + 1):
        info = metadata(path, index)
        name = info['streamInfo']['name']
        if name not in remaining:
            continue
        if name == 'se_ui_gaugeup_0001':
            assert info['loopingInfo'] == {'start': 0, 'end': 3600} and info['sampleRate'] == 48000, info
        subprocess.run(['vgmstream-cli', '-i', '-s', str(index), '-o', str(dest / (name + '.wav')), str(path)], check=True, capture_output=True)
        remaining.remove(name)
        print(name, json.dumps(info, ensure_ascii=False))
    if remaining:
        raise ValueError('音频包缺少 cue：' + ', '.join(sorted(remaining)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plain', type=Path, required=True)
    parser.add_argument('--ui', type=Path, required=True)
    parser.add_argument('--dest', type=Path, default=Path(__file__).resolve().parents[3] / 'apps/web/public')
    args = parser.parse_args()
    se = args.dest / 'se'
    audio = args.dest / 'assets/audio'
    se.mkdir(parents=True, exist_ok=True)
    audio.mkdir(parents=True, exist_ok=True)
    export_cues(args.plain / 'rhythm.acb', ['se_rhythm_result_0001', 'se_rhythm_result_0002', 'se_rhythm_result_0003'], se)
    export_cues(args.ui, ['se_ui_gaugeup_0001'], se)
    bgm = args.plain / 'bgm_rhythm_result_0001.awb'
    info = metadata(bgm)
    assert info['loopingInfo'] == {'start': 165924, 'end': 3491628} and info['sampleRate'] == 48000, info
    # ACB 只有预读片段；完整音乐及循环点来自外置 AWB。
    with tempfile.TemporaryDirectory(prefix='result-audio-') as temp:
        wav = Path(temp) / 'result.wav'
        subprocess.run(['vgmstream-cli', '-i', '-o', str(wav), str(bgm)], check=True, capture_output=True)
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', str(wav),
                        '-c:a', 'libvorbis', '-q:a', '8', str(audio / 'bgm_rhythm_result_0001.ogg')], check=True)
    print('bgm_rhythm_result_0001', json.dumps(info, ensure_ascii=False))


if __name__ == '__main__':
    main()
