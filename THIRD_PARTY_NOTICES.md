# 第三方与参考说明

## 运行时依赖

- Three.js：MIT，https://github.com/mrdoob/three.js
- fflate：MIT，https://github.com/101arrowz/fflate
- Mediabunny：MPL-2.0，https://github.com/Vanilagy/mediabunny ，用于视频封装；其代码适用 MPL-2.0。

构建与测试：Vite、Vitest、TypeScript、tsx（MIT）；Playwright（Apache-2.0）。完整依赖树和版本见 pnpm-lock.yaml，包内许可文件随安装提供。

## packages/pjsk-preview 的上游

`packages/pjsk-preview` 基于 [sekai-mmw-preview-web](https://github.com/watagashi-uni/sekai-mmw-preview-web)（watagashi-uni，AGPL-3.0-only）改造，按 AGPL-3.0-only 发布，许可全文见该包的 LICENSE。来自上游或由上游文件改造的部分：

- `native/mmw_port/`、`native/src/`、`native/generated/`：预览引擎与 overlay 播放器。上游使用并改造了 [MikuMikuWorld](https://github.com/crash5band/MikuMikuWorld)（MIT）与 [pjsekai-overlay-APPEND](https://github.com/TootieJin/pjsekai-overlay-APPEND)（AGPL）。
- `src/lib/`：WASM 播放器封装、音频与 overlay 辅助模块、URL 参数解析。
- `scripts/build-wasm.mjs`。
- `public/assets/mmw/`、`public/pwa/`：渲染素材与图标。

`native/vendor/` 中的第三方库：Dear ImGui（MIT）、DirectXMath（MIT，Microsoft）、nlohmann/json（MIT）、stb_image（MIT 或公有领域）。

`apps/web` 的构建产物打包了 `packages/pjsk-preview`，整体按 AGPL-3.0-only 发布；页面页脚提供对应源码的链接。

## 原格式实现

原格式与空间数学的实现边界见 docs/evidence.md。程序化回退皮肤和演示谱由本项目生成。

## 附带的游戏相关素材

- `apps/web/public/rg/`、`apps/web/public/se/` 与 `apps/web/public/*.png` 底图包含从 LLLL 客户端资源复制或导出的 UI 贴图、特效纹理、元数据、字体文件与局内音效；`se/*.wav` 由 rhythm.acb 经 vgmstream 解码导出。`packages/chart-svg/public/rg/` 是其中 2D 贴图的副本。
- `packages/pjsk-preview/public/assets/mmw/` 由上游从 MikuMikuWorld、OpenSekai 与 pjsekai-overlay 等资源整理而来，含 PJSK 相关的贴图、音效与字体；其中 `overlay/fever-native/` 的 5 张 Fever 贴图取自 PJSK 客户端。

以上素材**仅供本预览器本地运行与研究**：

- 这些素材的著作权、商标权及其他权利归原游戏及相关权利人（含字厂等）所有。
- 收入仓库**不授予**再分发、商用、修改后单独发布或绕过原许可的权利。
- 字体文件中的 FOT-Rodin Pro 与 FOT-RodinNTLG Pro 受字厂最终用户许可约束，请勿抽出挪用于本预览器之外；Noto Sans CJK 适用 SIL Open Font License 1.1。
- 游戏名称与术语仅用于说明兼容对象；本项目与权利人无隶属、无赞助、无背书关系。

不包含游戏音乐与完整谱面包；用户须自行导入已解密谱面。使用或再分发本仓库中附带素材的合规风险由使用者自行承担。
