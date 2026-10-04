# sukushow

LLLL 谱面预览工作区，包含统一前端、LLLL 舞台（可切换 3D/2D）、PJSK 渲染和图片导出后端：

- `apps/web`：唯一浏览器前端，包含统一导航、LLLL 舞台与 PJSK 渲染；LLLL 舞台右上角可切换 3D/2D。
- `apps/llll-preview`：LLLL 解析、渲染、音频和导出后端，MIT。
- `apps/pjsk-preview`：PJSK 解析、WASM 渲染和导出后端，AGPL-3.0-only。
- `apps/flat-preview`：2D 解析、几何与 Canvas 契约校验后端，MIT。
- `apps/chart-svg`：静态 SVG 图片导出后端，MIT。

根级 pnpm workspace 负责组织项目和共享脚本；浏览器页面统一从 `apps/web` 构建。

```powershell
pnpm install
pnpm dev                 # 统一前端，?view=llll|pjsk 切换工作台；LLLL 舞台内切换 2D/3D
pnpm render:svg          # SVG CLI
pnpm verify:shared-assets
pnpm build
pnpm test
```

目录、许可和 2D 贴图边界见 [工作区说明](docs/workspace.md)。
