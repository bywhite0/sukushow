# sukushow 工作区

根目录负责 workspace 配置、共享脚本和跨包校验；浏览器应用位于 `apps/`，可复用模块位于 `packages/`。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端：导航、选曲、URL 参数、设置、加载提示与各模式视图 | 自有代码 MIT；与 `pjsk-preview` 组合后整体 AGPL-3.0-only |
| `packages/chart` | LLLL 原格式谱面解析；曲目的 Fever 时段与曲终时刻 | MIT |
| `packages/llll-preview` | LLLL WebGL 渲染、HUD 与音频 | MIT |
| `packages/pjsk-preview` | PJSK WASM 渲染、LLLL 谱面适配与 PJSK 素材 | AGPL-3.0-only |
| `packages/export` | 视频导出核心：逐帧编码、离线混音与封装 | MIT |
| `packages/chart-svg` | 静态 SVG 图片导出：平面布局、音符几何与 SVG 生成 | MIT |

## 依赖规则

- 各包通过 `package.json` 的 `exports` 暴露模块；`apps/web` 只按包名（`@sukushow/*`）引用，并在 `dependencies` 中声明。
- MIT 包不依赖 `@sukushow/pjsk-preview`；`@sukushow/pjsk-preview` 可以依赖 MIT 包。
- MIT 包不复制 `@sukushow/pjsk-preview` 的代码或其 `public/` 素材；需要复用时按 `exports` 引用，避免把 AGPL 部分混进 MIT 目录。
- 包不引用 `apps/` 中的代码；页面模块的测试位于 `apps/web/tests`。
- 谱面解析与曲目时间（Fever 时段、曲终）只由 `@sukushow/chart` 提供；其余包与 `apps/web` 都从这里取，不各自解析。
- `@sukushow/export` 只通过 `ExportFrameSource` 接口驱动帧源，不依赖任何渲染包。各渲染器在自己的包里写死开场区间（`EXPORT_OPENING`），导出对话框把它交给 `resolveExportRange`。

## 入口

`apps/web` 是唯一产品入口，按 `?view=llll|pjsk` 加载两个模式；LLLL 舞台内置 2D/3D 相机切换，导航位于视图容器之外。

```text
pnpm dev                 # http://127.0.0.1:5170
pnpm render:svg          # SVG CLI
```

## 运行时资源

- `apps/web/public`：LLLL 贴图、特效、字体、局内音效与曲目列表。
- `packages/pjsk-preview/public`：PJSK 素材、图标与 `pnpm build:wasm` 生成的 wasm。`apps/web` 的 Vite 插件在开发时按原 URL 提供该目录，构建时复制进产物。

`pnpm verify:shared-assets` 比较 `apps/web` 与 `packages/chart-svg` 的 7 张 2D 贴图及元数据哈希。

## 界面图标

界面只用 Lucide（ISC）一套图标，构建期从 `@iconify-json/lucide` 抽取，整套图标留在 devDependency 里。

- `apps/web/scripts/generate-ui-icons.mjs` 里的 `ICONS` 是唯一清单，生成 `apps/web/src/icons.generated.ts`；加图标就是加一个 Lucide 名字，然后跑 `pnpm --filter @sukushow/web icons`（`pnpm build` 会先自动跑一次）。
- 调用点统一走 `apps/web/src/icons.ts` 的 `icon(name, size, { strokeWidth, className })`，颜色、描边与对齐由包装层决定；图形本身是 24×24 网格，`size=16` 时 `strokeWidth` 1.75 约等于 1.2px。
- 播放按钮这类会换图标的控件用 `setIconButton()`：它只在状态真的变化时写 DOM，因此可以放在逐帧渲染里。
- 图标一律走 Lucide。字形（`▶`、`Ⅱ`、`⏭`、`✓`、`×`、`♪`、`↗`、`⌄`）依赖字体、宽度不一致，部分平台还会落进 emoji 字体；这类字符只用在 `0.5×` 这类排版文本和 `<kbd>` 的方向键里。

## 来源状态与资源所有权

`apps/web` 的共享壳层持有歌曲版本、谱面来源、元数据和媒体覆盖。`songId` 表示媒体版本，官方谱面来源可指向另一个明确兼容的歌曲 ID；`identity` 表示文件关联边界，`revision` 表示可见状态修订。

- `sourceFiles` 在验证成功后才提交文件，管理 object URL 与视图租约；替换、清除或页面离开时，最后一个在用租约归还后才撤销 URL。验证成功、失败和超时都释放临时媒体元素。
- `sourceResolver` 共享同一来源快照的谱面与资料读取，并为各消费者提供独立解析结果；当前 MV 开关决定媒体测量集合。未知资源大小不冒充完整总量。
- `sourceBinding` 串行应用来源，暂停旧播放、屏蔽过期结果并持有资源租约。LLLL/PJSK 视图只负责渲染与各自导出，不自行打开本地文件或撤销共享 URL。
- 模式切换等待在途卸载完成，再启动新视图，旧视图不能清空新容器。`pagehide` 的 `persisted=true` 保留来源和资源并暂停播放；真正离开页面先卸载视图，再释放共享文件资源。

## 许可

根目录的 `LICENSE-MIT` 与 `LICENSE-AGPL` 是两种许可的全文，各目录另附自己的 LICENSE。边界分三层：

1. **目录自有代码**：`packages/pjsk-preview` 基于 AGPL-3.0-only 的 sekai-mmw-preview-web 改造，上游来源的代码与素材都位于该包内，按 AGPL-3.0-only 发布；根目录、`apps/web` 与其余包的自有代码按 MIT 发布。
2. **组合分发**：`apps/web` 静态引用 `packages/pjsk-preview`，组合后的源码与构建产物整体按 AGPL-3.0-only 分发，设置窗口的关于页提供源码链接。仓库根目录同时存在 `LICENSE-AGPL`，GitHub 据此把整个仓库识别为 AGPL-3.0；MIT 只适用于第 1 层列出的自有代码。
3. **附带素材**：`apps/web/public/` 与 `packages/pjsk-preview/public/` 内的游戏贴图、音效、语音与字体不随代码许可授权，权利归原权利人，使用限制见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

第三方来源见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
