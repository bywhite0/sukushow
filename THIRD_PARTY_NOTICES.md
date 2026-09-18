# 第三方与参考说明

运行时依赖：

- Three.js：MIT，https://github.com/mrdoob/three.js
- fflate：MIT，https://github.com/101arrowz/fflate

构建与测试：Vite、Vitest、TypeScript、tsx（MIT）；Playwright（Apache-2.0）。完整依赖树和版本见 pnpm-lock.yaml，包内许可文件随安装提供。

参考而未复制：

- sekai-mmw-preview-web（AGPL-3.0-only），https://github.com/watagashi-uni/sekai-mmw-preview-web ，参考播放交互与职责分离，未复制源码或资产。其许可不因本项目采用 MIT 而改变。
- 原格式与空间数学的实现边界见 docs/evidence.md。

程序化回退皮肤和演示谱由本项目生成。

### 附带的游戏相关素材（public/）

本仓库 public/rg/（及部分 public/*.png 底图）包含从游戏客户端资源复制或导出的 UI 贴图、特效纹理、元数据与字体文件，**仅供本预览器本地运行与研究**。

- 这些素材的著作权、商标权及其他权利归原游戏及相关权利人（含字厂等）所有。
- 收入仓库**不授予**再分发、商用、修改后单独发布或绕过原许可的权利。
- 字体文件（FOT-Rodin Pro 等）受字厂最终用户许可约束，请勿抽出挪用于本预览器之外。
- 游戏名称与术语仅用于说明兼容对象；本项目与权利人无隶属、无赞助、无背书关系。

不包含游戏音乐与完整谱面包；用户须自行导入已解密谱面。使用或再分发本仓库中附带素材的合规风险由使用者自行承担。
