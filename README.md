# sukushow

LLLL 谱面预览工作区。统一前端提供 LLLL 舞台（3D/2D 相机切换）与 PJSK 渲染两种模式，另有静态 SVG 图片导出。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端 | 自有代码 MIT；与 `pjsk-preview` 组合后整体 AGPL-3.0-only |
| `packages/chart` | LLLL 原格式谱面解析；曲目的 Fever 时段与曲终时刻 | MIT |
| `packages/llll-preview` | LLLL WebGL 渲染、HUD 与音频 | MIT |
| `packages/pjsk-preview` | PJSK WASM 渲染、LLLL 谱面适配与 PJSK 素材 | AGPL-3.0-only |
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
pnpm --filter @sukushow/web test:pwa # 构建后验证安装、离线与更新
# 可选：从本地 4L/cache/plain 的 USM 无损重封装 MV（需 ffmpeg；源目录取 chart 配置或 LLLL_MV_DIR）
python packages/llll-preview/scripts/link-assets.py --only mv
```

## 安装与离线使用

生产站点支持 PWA，可通过浏览器菜单安装；iPhone / iPad 可在 Safari 分享菜单中选择「添加到主屏幕」。部署需要 HTTPS，本地可通过 `pnpm preview` 检查。开发服务器不注册 Service Worker。

- 首次联网打开后会缓存应用界面、两种模式的代码、WASM 和曲库索引。渲染贴图、字体、短音效在使用时缓存。安装后联网刷新一次页面，并进入需要离线使用的模式，等待资源加载完成；之后离线仍可打开该模式并选择本地谱面与媒体。
- 歌曲音频、MV、谱面和曲绘不自动缓存，不会在安装时下载整套资源库。离线播放需自己提供本地文件；刷新后需重新选择本地文件。
- 有新版本时会提示「更新并刷新」，可以选择「稍后」。更新不会自动刷新正在播放或导出的页面，其他标签页更新也不会强制刷新当前页。

## 选曲与本地文件

- 右上角「设置」或 `Ctrl/Cmd + ,` 打开全局设置。支持浅色、深色、跟随系统，以及默认粉和 12 位成员主题色；即时应用并在当前浏览器保存，LLLL / PJSK 共用。`Esc` 关闭窗口，恢复默认会回到深色与默认粉。
- 曲目档案展示曲绘、演唱与谱面统计，词曲制作信息在演唱信息下方直接展开；难度按钮支持方向键及 Home/End 切换。
- 按 `/` 或点击右上角「曲库」打开独立选曲面板，可搜索、筛选分类，按收录顺序、曲名或最高等级排序。选曲后保留筛选条件，并回到原入口。
- 「专注」收起曲目栏、顶栏和页脚，最大化谱面；点击预览上方的曲名仍可切歌。设置按需展开，播放控制始终保留。窄屏通过「曲目 / 难度」展开曲目档案，面板支持 Escape 关闭。

- 无显式来源时打开フォーチュンムービー（`103103`）的最高可用难度。显式歌曲、难度或谱面 URL 加载失败会显示错误，不自动换歌或打开演示谱。
- 打开选曲列表并勾选“含无谱面”，选定歌曲后再“打开谱面”，即可将自制谱绑定该歌曲并继承其媒体与资料。没有绑定歌曲时也可独立打开 JSON 或压缩 bytes 谱面；谱面上限为 16 MiB。
- Another Vocal 通过“演唱版本”下拉菜单选择，仅显示已确认兼容的版本；支持方向键、Home/End、Enter/Space 选择，Escape 关闭。谱面与等级取自谱面来源，音频、曲绘和演唱资料使用当前版本；SAKURA 不借谱。自制谱可保留版本选择，但不显示官方难度。
- “媒体”菜单可分别替换、清除音频、曲绘和 MV，或恢复歌曲资源。“编辑元数据”可调整自制谱标题、谱师、词曲资料、音频偏移、Fever 与曲终时间，不写回原文件或官方曲库。本地 MV 静音并从 0 秒开始。
- 切换 LLLL/PJSK 保留当前谱面、编辑资料和本地媒体，并暂停播放；切歌清除覆盖。本地文件只在当前页面中保留，不会写进分享 URL，刷新后需重新打开。浏览器页面缓存恢复保留当前状态。
- 文件验证失败保留此前有效来源；连续打开谱面以最后选择为准。谱面上限为 16 MiB，本地音频上限为 128 MiB，超限文件在读取前拒绝。媒体验证 30 秒无响应会提示重试；下载大小未知时不显示不完整的总量。
- 历史切换到加载失败的谱面 URL 时停止旧谱预览，不沿用此前可播放来源。预览控件与元数据编辑器共用音频偏移，媒体更新和模式往返保留调整。失效来源的网络等待不阻塞新来源或模式切换；播放器应用仍串行完成。

许可按目录区分，见上表：MIT 部分的全文为 [LICENSE-MIT](LICENSE-MIT)，AGPL 部分的全文为 [LICENSE-AGPL](LICENSE-AGPL)，各目录另附自己的 LICENSE。`apps/web` 静态引用 `packages/pjsk-preview`，组合后的源码与构建产物整体按 AGPL-3.0-only 分发；MIT 只适用于各目录自有代码。`apps/web/public/` 与 `packages/pjsk-preview/public/` 内附带的游戏素材不随上述代码许可授权，权利与使用限制见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。依赖与许可边界见 [工作区说明](docs/workspace.md)。
