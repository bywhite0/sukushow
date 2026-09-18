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
- 原包相机位置、俯角与三次下落曲线；三列渐变 Hold 网格（HoldMesh 余弦脉冲）。
- RhythmGameMain 风格 3D 轨道：仓库内附带 note / 判定线 9-slice、Plane Fade、简化 hit FX；删除或缺失 `public/rg` 时回退程序化色块。
- 直播 HUD 覆盖层：计分 / 段位 / combo / 判定字等预览实现；非完整对局客户端。
- 播放、暂停、跳转、倍速、左右镜像、下落速度、音量、音频偏移、全屏。
- 本地音频解码，错误文件保留已有谱面，中文界面及移动端布局。
- 空格播放／暂停，方向键跳转 5 秒；焦点在表单控件时不拦截快捷键。

音符时间单位为秒。音频偏移为毫秒，正值使音频晚开始；这是预览器的附加功能，不把源 JSON 的 Offset 当作原游戏已消费的字段。

## 预览皮肤 / FX

仓库 `public/rg/` 附带一套用于预览的 UI 贴图、hit FX、`sprite_meta.json` 与 HUD 字体文件，clone 后即可直接看到皮肤态预览。缺省或删空该目录时仍可运行，走程序化色块回退。

若要从本机游戏资源树刷新这些文件：

```powershell
node scripts/copy-rg-assets.mjs --unity <RhythmGameAssetsDir> --meta <sprite_meta.json>
```

约定路径：`public/rg/sprites/<name>.png`、`public/rg/fx/fx.json`、`public/rg/fx/tex/<texture>.png`、`public/rg/sprite_meta.json`、`public/rg/fonts/<file>.otf`。

## 依据与限制

参见 [实现依据与限制](docs/evidence.md)。行为以客户端二进制与场景序列化为准；重建工程仅辅助定位逻辑。参考 sekai-mmw-preview-web 的本地文件与播放交互设计，不转换为 SUS，不移植其 WASM 渲染器。

**不宣称像素级还原。** 有 `public/rg` 时使用附带皮肤 / 简化 FX / SafeArea HUD；无资源时程序化回退。粒子为 Additive 近似（非完整 Unity ParticleSystem）。浮点计算使用 JavaScript double，并非逐指令 float32 仿真。移动端扩大垂直视角属于预览器适配。

默认不包含游戏谱面与音频；只能导入已解密谱面，不提供解密入口。16 MiB 谱面、128 MiB 音频、50,000 音符为加载上限。极端密集自制谱可能达到绘制批容量，当前未实现分页渲染。

测试覆盖格式解析、几何边界、9-slice / HUD 缩放、播放状态和浏览器交互。语料校验不等价于逐帧视觉一致性验证。

## 目录

- `src/chart.ts`：源格式、校验、串链、同时押。
- `src/geometry.ts`：空间数学。
- `src/slice.ts`、`src/shaders.ts`、`src/rgAssets.ts`、`src/fx.ts`：9-slice、着色器、资源加载、hit FX。
- `src/hud.ts`：SafeArea 覆盖层。
- `src/transport.ts`、`src/audio.ts`：播放时基与音频适配。
- `src/renderer.ts`：WebGL 批量几何。
- `src/main.ts`、`src/style.css`：中文工作台。
- `scripts/copy-rg-assets.mjs`：可选，从本机资源树刷新 `public/rg/`。
- `tests/`、`scripts/`：回归测试与本地语料校验。

## 许可与免责声明

- **本仓库原创代码**采用 MIT，见 [LICENSE](LICENSE)。
- **第三方依赖与参考**见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **`public/` 内附带的贴图、FX、字体等**来自或还原自游戏客户端资源，**权利归各原权利人所有**；收入本仓库仅供本预览器非商业研究与互操作验证，不构成授权转载、再分发或商用许可。字体（如 FOT-Rodin Pro）尤受字厂许可约束，请勿单独抽出挪作他用。
- 本工具为**非官方**研究预览器，与游戏运营方、开发商、发行商及任何关联商标**无隶属、无赞助、无背书**关系。
- 使用本仓库即表示你自行评估并承担与附带游戏素材相关的合规风险；作者不对因使用或再分发这些素材产生的后果负责。
