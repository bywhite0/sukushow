# sukushow 工作区

根目录负责 workspace 配置、共享脚本和跨包校验；浏览器应用位于 `apps/`，可复用模块位于 `packages/`。

| 路径 | 用途 | 许可 |
| --- | --- | --- |
| `apps/web` | 唯一浏览器前端：导航、选曲、URL 参数、设置、加载提示与各模式视图 | 源码 MIT；构建产物 AGPL-3.0-only |
| `packages/llll-preview` | LLLL 解析、WebGL 渲染、HUD、音频与视频导出 | MIT |
| `packages/pjsk-preview` | PJSK WASM 渲染、LLLL 谱面适配、PJSK 素材与视频导出 | AGPL-3.0-only |
| `packages/flat-preview` | 2D 解析与几何，供 SVG 导出交叉校验 | MIT |
| `packages/chart-svg` | 静态 SVG 图片导出 | MIT |

## 依赖规则

- 各包通过 `package.json` 的 `exports` 暴露模块；`apps/web` 只按包名（`@sukushow/*`）引用，并在 `dependencies` 中声明。
- MIT 包不依赖 `@sukushow/pjsk-preview`；`@sukushow/pjsk-preview` 可以依赖 MIT 包。
- 包不引用 `apps/` 中的代码；页面模块的测试位于 `apps/web/tests`。

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

## 许可

根目录的 `LICENSE-MIT` 与 `LICENSE-AGPL` 是两种许可的全文，各目录另附自己的 LICENSE。`packages/pjsk-preview` 基于 AGPL-3.0-only 的 sekai-mmw-preview-web 改造，上游来源的代码与素材都位于该包内，按 AGPL-3.0-only 发布。根目录、`apps/web` 与其余包的自有代码按 MIT 发布。`apps/web` 的构建产物打包了 `packages/pjsk-preview`，整体按 AGPL-3.0-only 发布，页面页脚提供源码链接。第三方来源见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
