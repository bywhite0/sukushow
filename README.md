# sukushow

LLLL 谱面预览工作区。统一前端提供 LLLL 舞台（3D/2D 相机切换）与 PJSK 渲染两种模式，另有静态 SVG 图片导出。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端 | 源码 MIT；构建产物 AGPL-3.0-only |
| `packages/chart` | LLLL 原格式谱面解析；曲目的 Fever 时段与曲终时刻 | MIT |
| `packages/llll-preview` | LLLL WebGL 渲染、HUD 与音频 | MIT |
| `packages/pjsk-preview` | PJSK WASM 渲染与谱面适配 | AGPL-3.0-only |
| `packages/export` | 视频导出核心：逐帧编码、离线混音与封装 | MIT |
| `packages/chart-svg` | 静态 SVG 图片导出：平面布局、音符几何与 SVG 生成 | MIT |

```powershell
pnpm install
pnpm dev                 # 统一前端，?view=llll|pjsk 切换模式；LLLL 舞台内切换 2D/3D
pnpm preview             # 预览构建产物
pnpm render:svg          # SVG CLI
pnpm verify:shared-assets
pnpm build
pnpm test
pnpm test:browser        # 先执行 pnpm --filter @sukushow/web exec playwright install chromium
# 可选：从本地 4L/cache/plain 的 USM 无损重封装 MV（需 ffmpeg；源目录取 chart 配置或 LLLL_MV_DIR）
python packages/llll-preview/scripts/link-assets.py --only mv
```

## 选曲与本地文件

- 无显式来源时打开フォーチュンムービー（`103103`）的最高可用难度。显式歌曲、难度或谱面 URL 加载失败会显示错误，不自动换歌或打开演示谱。
- 打开选曲列表并勾选“含无谱面”，选定歌曲后再“打开谱面”，即可将自制谱绑定该歌曲并继承其媒体与资料。没有绑定歌曲时也可独立打开 JSON 或压缩 bytes 谱面；谱面上限为 16 MiB。
- Another Vocal 只显示已确认兼容的版本，谱面与等级取自谱面来源，音频、曲绘和演唱资料使用当前版本；SAKURA 不借谱。自制谱可保留版本选择，但不显示官方难度。
- “媒体”菜单可分别替换、清除音频、曲绘和 MV，或恢复歌曲资源。“编辑元数据”可调整自制谱标题、谱师、词曲资料、音频偏移、Fever 与曲终时间，不写回原文件或官方曲库。本地 MV 静音并从 0 秒开始。
- 切换 LLLL/PJSK 保留当前谱面、编辑资料和本地媒体，并暂停播放；切歌清除覆盖。本地文件只在当前页面中保留，不会写进分享 URL，刷新后需重新打开。浏览器页面缓存恢复保留当前状态。
- 文件验证失败保留此前有效来源；连续打开谱面以最后选择为准。谱面上限为 16 MiB，本地音频上限为 128 MiB，超限文件在读取前拒绝。媒体验证 30 秒无响应会提示重试；下载大小未知时不显示不完整的总量。
- 历史切换到加载失败的谱面 URL 时停止旧谱预览，不沿用此前可播放来源。预览控件与元数据编辑器共用音频偏移，媒体更新和模式往返保留调整。失效来源的网络等待不阻塞新来源或模式切换；播放器应用仍串行完成。

许可按目录区分，见上表：MIT 部分的全文为 [LICENSE-MIT](LICENSE-MIT)，AGPL 部分的全文为 [LICENSE-AGPL](LICENSE-AGPL)，各目录另附自己的 LICENSE。依赖与许可边界见 [工作区说明](docs/workspace.md)，第三方来源与附带素材见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
