# llll-preview · 谱面放映室

面向 Link! Like! LoveLive! 原格式谱面的本地优先 WebGL 3D 渲染模块。浏览器工作台位于 `apps/web`，本目录保留解析、渲染、音频、特效与导出用的音效记录；视频编码与封装由 `packages/export` 完成。

## 运行

要求 Node.js 22.12+、pnpm 10.26.2 与支持 WebGL 2 的浏览器。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sukushow/web dev
```

打开统一前端的本地地址，在导航中选择 LLLL 舞台；舞台右上角可切换 3D / 2D 相机角度。默认提供原创演示谱；选择本地 JSON 或已解密的 raw-deflate `.bytes`，可另选浏览器支持的音频文件。文件不上传。

此包属于 `sukushow` 根工作区；LLLL 的 2D 模式与 3D 模式共用同一套 WebGL 场景，只切换相机角度。PJSK 渲染与 SVG 图片导出分别由 `packages/pjsk-preview`、`packages/chart-svg` 提供。目录、许可边界和运行时资源见 [工作区说明](../../docs/workspace.md)。

```powershell
pnpm dev
pnpm render:svg
pnpm verify:shared-assets
```

```powershell
pnpm test
pnpm --filter @sukushow/web exec playwright install chromium
pnpm test:browser
pnpm build
pnpm preview
```

## 已实现

- 原始 60 格连续坐标、Single / Hold / Flick / Trace、原始端点串链、共享后继与同时押线。
- 原包相机位置、俯角与三次下落曲线；三列渐变 Hold 网格（HoldMesh 余弦脉冲）。
- RhythmGameMain 风格 3D 轨道：统一前端资源包提供 note / 判定线 9-slice、Plane Fade、简化 hit FX；资源缺省时使用程序化色块回退。
- 直播 HUD 覆盖层：计分 / 段位 / combo / 判定字等预览实现；非完整对局客户端。
- 播放、暂停、跳转、倍速、左右镜像、下落速度、音量、音频偏移、全屏。
- 本地音频解码，错误文件保留已有谱面，中文工作台、分类设置面板及移动端布局；预览设置保存到 localStorage。
- 局内 SE：打击音、Hold 持续音、开场与曲终音效；音乐 / 打击音 / SE 独立音量。Hold 中间计分采样不重复触发按键音。
- 空格播放／暂停，方向键跳转 5 秒；焦点在表单控件时不拦截快捷键。
- Fever：按谱面文件名匹配歌曲元数据的明确起止时段；支持手动覆盖，未知歌曲不估算；LineBase 彩虹、LineMove 行进亮条、两侧 fever 粒子。
- 「显示与特效」面板中的「击中特效」：关闭 / 直冲天上 / 限速 / 加深（`HitFx`）；Hold 核心光效跟随头部，飞散粒子保留世界坐标。
- sprite / FX 自定义着色器使用 `NoColorSpace` 贴图，避免额外 sRGB 解码造成音符偏暗。

设置分为「播放与轨道」「显示与特效」「音量」「计分」四类；技术分、TotalAppeal、熟练度和段位预览位于「计分」。分类标签支持方向键及 Home / End 切换。Voice、技能与 MV 控件保留配置入口，不代表已实现语音、技能演出或 MV 播放。

音符时间单位为秒。音频偏移为毫秒，正值使音频晚开始；这是预览器的附加功能，不把源 JSON 的 Offset 当作原游戏已消费的字段。

## 视频导出

播放栏的「导出视频」在浏览器本地逐帧渲染，包含舞台、HUD、击中特效、开场及曲终横幅，并离线混合 BGM 和局内音效；不会上传文件。

- MP4（H.264 + AAC；AAC 不可用时回退 Opus）或 WebM（VP9 + Opus）。浏览器不支持的组合会禁用；无可用音频编码器时界面明确提示无音轨。
- 30 / 60 fps，12 / 20 / 45 Mbps 或自动码率；支持 720p、1080p、4K 及 19.5:9、20:9、16:10、4:3 预设。
- 可选起止秒数与开场过场。包含开场时允许负时刻，0 秒是谱面与未偏移 BGM 的起点；片长按整数帧舍入。
- 导出固定为 1 倍速，不跟随预览倍率。结束、取消或失败后恢复尺寸、倍率和原播放位置，并停在暂停状态。
- 需要安全上下文（HTTPS 或 localhost）与可用的 WebCodecs。编码支持随浏览器、系统和设备变化，支持探测不保证运行中不会失败。
- MP4 边编码边写入浏览器的源私有文件系统（OPFS），音频按 10 秒分段混音，内存占用不随片长增长；浏览器不支持 OPFS 写入时退回内存封装。WebM 在内存中完成封装，长片段建议导出 MP4。导出期间保持页面打开，后台节流可能降低速度。

## Fever 元数据

导入 `rhythmgame_chart_<歌曲ID>_<难度>.bytes/json` 时自动匹配。显示与特效中的“Fever 开始 / 结束（秒）”可手动覆盖，区间为 `[start,end)`；同时留空关闭，非法输入停用 Fever。手动值不写入全局设置，换谱清除；“恢复歌曲元数据”撤销覆盖。演示谱默认不配置 Fever。必要时延长播放时间轴以覆盖指定终点，但不修改源谱面文件。“Fever 显示”仅控制特效，不改变逻辑 Fever 状态。

## 预览皮肤 / FX

统一前端的 `apps/web/public/rg/` 提供 UI 贴图、hit FX、`sprite_meta.json` 与 HUD 字体文件；缺省时使用程序化色块回退。

约定路径：`apps/web/public/rg/sprites/<name>.png`、`apps/web/public/rg/fx/fx.json`、`apps/web/public/rg/fx/tex/<texture>.png`、`apps/web/public/rg/sprite_meta.json`、`apps/web/public/rg/fonts/<file>.otf`。

## 依据与限制

参见 [实现依据与限制](docs/evidence.md)。行为以客户端二进制与场景序列化为准；重建工程仅辅助定位逻辑。参考 sekai-mmw-preview-web 的本地文件与播放交互设计，不转换为 SUS，不移植其 WASM 渲染器。

**不宣称像素级还原。** 有 `apps/web/public/rg` 时使用附带皮肤 / 简化 FX / SafeArea HUD；无资源时程序化回退。粒子为 Additive 近似（非完整 Unity ParticleSystem）。浮点计算以 JavaScript double 为主，Hold 计数采样与串链时间比较按原包 float32 语义处理，并非全引擎逐指令 float32 仿真。移动端扩大垂直视角属于预览器适配。

只能导入已解密谱面，不提供解密入口。16 MiB 谱面、128 MiB 音频、50,000 音符为加载上限。极端密集自制谱可能达到绘制批容量，当前未实现分页渲染。

测试覆盖格式解析、几何边界、9-slice / HUD 缩放、播放状态和浏览器交互。语料校验不等价于逐帧视觉一致性验证。

## 目录

- 谱面解析与曲目时间（Fever、曲终）来自 `@sukushow/chart`。
- `src/geometry.ts`：空间数学。
- `src/slice.ts`、`src/shaders.ts`、`src/rgAssets.ts`、`src/fx.ts`：9-slice、着色器、资源加载、hit FX。
- `src/hud.ts`：SafeArea 覆盖层。
- `src/transport.ts`、`src/audio.ts`、`src/se.ts`：播放时基、本地音乐与局内音效。
- `src/score.ts`、`src/fever.ts`、`src/hudFxMath.ts`：计分、Fever 边线颜色与 HUD 动画曲线。
- `src/renderer.ts`：WebGL 批量几何。
- `src/rgOptions.ts`：游戏选项默认值；工作台和页面设置位于 `apps/web/src/views/llll/`。
- `tests/`、`scripts/`：回归测试与本地语料校验。

## 许可与免责声明

- **本仓库原创代码**采用 MIT，见 [LICENSE](LICENSE)。
- **第三方依赖与参考**见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **`public/` 内附带的贴图、FX、字体、局内音效等**来自或还原自游戏客户端资源，**权利归各原权利人所有**；收入本仓库仅供本预览器非商业研究与互操作验证，不构成授权转载、再分发或商用许可。字体（如 FOT-Rodin Pro）尤受字厂许可约束，请勿单独抽出挪作他用。
- 本工具为**非官方**研究预览器，与游戏运营方、开发商、发行商及任何关联商标**无隶属、无赞助、无背书**关系。
- 使用本仓库即表示你自行评估并承担与附带游戏素材相关的合规风险；作者不对因使用或再分发这些素材产生的后果负责。
