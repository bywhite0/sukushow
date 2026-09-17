# llll 谱面放映室

面向 Link! Like! LoveLive! 原格式谱面的本地优先 WebGL 3D 预览器。非官方研究工具，不是游戏客户端。

## 运行

要求 Node.js 22.12+、pnpm 10.26.2 与支持 WebGL 2 的浏览器。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

打开终端显示的本地地址。默认提供原创演示谱；选择本地 JSON 或已解密的 raw-deflate `.bytes`，可另选浏览器支持的音频文件。文件不上传。

```powershell
pnpm test
pnpm exec playwright install chromium
pnpm test:browser
pnpm build
pnpm preview
pnpm verify:corpus "本地谱面目录"
```

## 已实现

- 原始 60 格连续坐标、Single / Hold / Flick / Trace、原始端点串链、共享后继与同时押线。
- 原包相机位置、俯角与三次下落曲线；三列渐变 Hold 网格。
- 播放、暂停、跳转、倍速、左右镜像、下落速度、音量、音频偏移、全屏。
- 本地音频解码，错误文件保留已有谱面，中文界面及移动端布局。
- 空格播放／暂停，方向键跳转 5 秒；焦点在表单控件时不拦截快捷键。

音符时间单位为秒。音频偏移为毫秒，正值使音频晚开始；这是预览器的附加功能，不把源 JSON 的 Offset 当作原游戏已消费的字段。

## 依据与限制

参见 [实现依据与限制](docs/evidence.md)。Unity 重建工程仅辅助定位，原包二进制与序列化资源优先。参考 sekai-mmw-preview-web 的本地文件与播放交互设计，不转换为 SUS，不移植其 WASM 渲染器。

**当前使用程序化皮肤，不是原版贴图的像素级还原。** Flick 装饰、过线反馈、Hold 激活透明度为近似；不实现完整粒子、HUD、计分及游戏判定。浮点计算使用 JavaScript double，并非逐指令 float32 仿真。移动端扩大垂直视角属于预览器适配。

默认不包含游戏谱面、音频、原包或提取贴图；只能导入已解密谱面，不提供解密入口。16 MiB 谱面、128 MiB 音频、50,000 音符为加载上限。极端密集自制谱可能达到绘制批容量，当前未实现分页渲染。

测试覆盖格式解析、几何边界、播放状态和浏览器交互。语料校验不等价于逐帧视觉一致性验证。

## 目录

- `src/chart.ts`：源格式、校验、串链、同时押。
- `src/geometry.ts`：空间数学。
- `src/transport.ts`、`src/audio.ts`：播放时基与音频适配。
- `src/renderer.ts`：WebGL 批量几何。
- `src/main.ts`、`src/style.css`：中文工作台。
- `tests/`、`scripts/`：回归测试与本地语料校验。

## 许可

本仓库原创代码采用 MIT，见 LICENSE。第三方依赖及参考说明见 THIRD_PARTY_NOTICES.md。游戏及相关资产的权利归各自权利人所有；本工具与其无隶属或背书关系。
