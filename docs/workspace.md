# sukushow 工作区

根目录负责 workspace 配置、统一前端构建和跨项目校验；浏览器应用位于 `apps/`，可复用模块位于 `packages/`。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端、统一导航与 LLLL/PJSK 工作台 | MIT |
| `packages/llll-preview` | LLLL 解析、渲染、音频与视频导出后端 | MIT |
| `packages/pjsk-preview` | PJSK 解析、WASM 渲染与导出后端 | AGPL-3.0-only |
| `packages/flat-preview` | 2D 解析、几何与 Canvas 契约校验后端 | MIT |
| `packages/chart-svg` | 静态 SVG 图片导出后端 | MIT |

各项目按职责组织为 `@sukushow/*` workspace 包；页面代码和静态运行时资源集中在 `apps/web`，渲染子项目提供解析、渲染、配置和导出模块。

## 入口 shell

`apps/web` 是唯一产品入口。它在 `?view=llll|pjsk` 下加载两个工作台；LLLL 工作台的同一 WebGL 舞台内置 2D/3D 相机角度切换，导航始终位于视图容器之外。曲目选择、URL 参数、设置持久化和导出对话框等页面专属模块也归这里维护。各子项目以解析、渲染、配置和测试模块参与构建。

```text
pnpm dev                 # http://127.0.0.1:5170，统一前端
pnpm render:svg          # SVG CLI
```

## 贴图边界

统一前端的 `apps/web/public` 集中保存 LLLL、PJSK 和契约校验用 2D 运行时资源。

`pnpm verify:shared-assets` 会比较 `apps/web` 与 `packages/chart-svg` 的 7 张 2D 贴图及元数据哈希。

## 许可

根目录与 `packages/llll-preview`、`packages/flat-preview`、`packages/chart-svg` 的自有代码按 MIT 处理。`packages/pjsk-preview` 及其中的 MikuMikuWorld/AGPL 来源代码继续按 AGPL-3.0-only 处理；合并时不能把整个 workspace 改写成单一 MIT。
