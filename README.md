# sukushow

LLLL 谱面预览工作区。统一前端提供 LLLL 舞台（3D/2D 相机切换）与 PJSK 渲染两种模式，另有静态 SVG 图片导出。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端 | 源码 MIT；构建产物 AGPL-3.0-only |
| `packages/llll-preview` | LLLL 解析、WebGL 渲染、HUD 与音频 | MIT |
| `packages/pjsk-preview` | PJSK WASM 渲染与谱面适配 | AGPL-3.0-only |
| `packages/export` | 视频导出核心：逐帧编码、离线混音与封装 | MIT |
| `packages/flat-preview` | 2D 解析与几何，供 SVG 导出交叉校验 | MIT |
| `packages/chart-svg` | 静态 SVG 图片导出 | MIT |

```powershell
pnpm install
pnpm dev                 # 统一前端，?view=llll|pjsk 切换模式；LLLL 舞台内切换 2D/3D
pnpm preview             # 预览构建产物
pnpm render:svg          # SVG CLI
pnpm verify:shared-assets
pnpm build
pnpm test
pnpm test:browser        # 先执行 pnpm --filter @sukushow/web exec playwright install chromium
```

许可按目录区分，见上表：MIT 部分的全文为 [LICENSE-MIT](LICENSE-MIT)，AGPL 部分的全文为 [LICENSE-AGPL](LICENSE-AGPL)，各目录另附自己的 LICENSE。依赖与许可边界见 [工作区说明](docs/workspace.md)，第三方来源与附带素材见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
