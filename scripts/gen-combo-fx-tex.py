"""由原包贴图派生 AP 継続特效需要的两张图（需要 Pillow + numpy）。

1. ui_sc2_ingame_num_combo_Effect_1.png
   着色器 `RhythmGame/Num Combo Effect` 对窄字形 `1`（列宽 ≤ 0.1）的采样：
     s = min(max(uv.x - 0.111111097, 0.0199999996) * 1.28571427, 1)
     u = ImmCB[1] + (ImmCB[2] - ImmCB[1]) * s
   整块 85×109 面片都采样，左侧夹在 s=0.0257 那一列，右侧落在列边界 u=0.181818（双线性，
   与 `2` 的首列各半）。这里按双线性逐像素算出面片上的 alpha（横向 4× 超采样）。
2. sc2_effect_combo_glow_002_alpha_lower.png
   下层底光材质 `Mobile/Particles/Alpha Blended`：片元 = 贴图 × 顶点色。
   预乘 startColor rgb (0.4575, 0.7675, 1)，alpha 保持贴图原值，运行时只调不透明度。
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
tex_dir = root / 'public' / 'rg' / 'fx' / 'tex'

sheet = np.asarray(Image.open(tex_dir / 'ui_sc2_ingame_num_combo_Effect.png').convert('RGBA')).astype(np.float64)
H, W = sheet.shape[:2]
imm1, imm2 = np.float32(0.102272697), np.float32(0.181818202)
OW = 85 * 4
uvx = (np.arange(OW) + 0.5) / OW
s = np.minimum(np.maximum(uvx - 0.111111097, 0.0199999996) * 1.28571427, 1.0)
u = imm1 + (imm2 - imm1) * s
tx = u * W - 0.5
x0 = np.clip(np.floor(tx).astype(int), 0, W - 1)
x1 = np.clip(x0 + 1, 0, W - 1)
f = tx - np.floor(tx)
col = sheet[:, x0, :] * (1 - f)[None, :, None] + sheet[:, x1, :] * f[None, :, None]
out = np.empty((H, OW, 4), dtype=np.uint8)
out[..., :3] = 255
out[..., 3] = np.clip(np.rint(col[..., 3]), 0, 255).astype(np.uint8)
Image.fromarray(out).save(tex_dir / 'ui_sc2_ingame_num_combo_Effect_1.png', optimize=True)
print('sheet', W, H, 'rgb min', sheet[..., :3][sheet[..., 3] > 0].min(axis=0) if (sheet[..., 3] > 0).any() else None)
print('digit1 alpha: left col', out[:, 0, 3].max(), 'right col', out[:, -1, 3].max())

glow = np.asarray(Image.open(tex_dir / 'sc2_effect_combo_glow_002_alpha.png').convert('RGBA')).astype(np.float64)
tint = np.array([0.4575, 0.7675, 1.0])
g = np.empty(glow.shape, dtype=np.uint8)
g[..., :3] = np.clip(np.rint(glow[..., :3] * tint), 0, 255).astype(np.uint8)
g[..., 3] = glow[..., 3].astype(np.uint8)
Image.fromarray(g).save(tex_dir / 'sc2_effect_combo_glow_002_alpha_lower.png', optimize=True)
print('glow', glow.shape, 'rgb range', glow[..., :3].min(axis=(0, 1)), glow[..., :3].max(axis=(0, 1)))
