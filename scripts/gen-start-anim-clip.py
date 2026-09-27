"""从 RhythmGameStart 动画导出 JSON 生成 src/startAnimClip.ts。

用法：python scripts/gen-start-anim-clip.py <startanim.json> [输出路径]
"""
import json, sys, os
if len(sys.argv) < 2:
    sys.exit(__doc__)
d = json.load(open(sys.argv[1], encoding="utf-8"))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "src", "startAnimClip.ts")
clip = d['anim'][0]
names = {
 'Jacket/DotOutlineMask/MaskRight/Right':'right','Jacket/DotOutlineMask/MaskBtm/Btm':'btm','Bg':'bg',
 'Jacket/Image-Jacket':'jacket','DifficultyRoot/White/DifficultyColor/Base01':'base01',
 'DifficultyRoot/White/DifficultyColor':'difficultyColor','DifficultyRoot/White':'white',
 'DifficultyRoot/White/DifficultyColor/DifficultyName':'difficultyName','DifficultyRoot':'difficultyRoot','ScoreLabel':'scoreLabel'}
def num(v):
    v = float(v)
    if v == 0: return '0'
    s = repr(v)
    return s
out = []
out.append("/**\n * 开场过场 `sc2_ingame_start_jacket`（sharedassets56 AnimationClip #103，60 fps，3.6666667 s，不循环）。\n * 由原包 StreamedClip 逐键解码：每键 (a,b,c,d)，段内 v = a·u³ + b·u² + c·u + d，u = t − 键时刻。\n * 系数为 float32 原值；仅合并了 1.75 s 之后逐帧烘焙、系数全为 0 的重复键（取值不变）。\n * 自动生成，勿手改。\n */")
out.append("export type ClipKey = readonly [t: number, a: number, b: number, c: number, d: number];")
out.append("export const START_CLIP_DURATION = %s;" % num(clip['dur']))
out.append("export const START_CLIP_CURVES = {")
for c in clip['curves']:
    if c.get('isConst'): continue
    key = names[c['path']] + '_' + c['prop']
    ks = []
    for k in c['keys']:
        if k['t'] < 0: continue
        row = (k['t'], k['c0'], k['c1'], k['c2'], k['c3'])
        if ks and ks[-1][1:4] == (0,0,0) and row[1:] == ks[-1][1:] : continue
        ks.append(row)
    out.append("  %s: [" % key)
    for r in ks:
        out.append("    [%s]," % ', '.join(num(x) for x in r))
    out.append("  ],")
out.append("} as const satisfies Record<string, readonly ClipKey[]>;")
out.append("export type StartCurveName = keyof typeof START_CLIP_CURVES;")
open(OUT, 'w', encoding='utf-8', newline='\n').write('\n'.join(out)+'\n')
print('wrote', OUT)
