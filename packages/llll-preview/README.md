# llll-preview · 谱面放映室

面向 Link! Like! LoveLive! 原格式谱面的本地优先 WebGL 3D 渲染模块。浏览器工作台位于 `apps/web`，本目录保留解析、渲染、音频、特效与导出用的音效记录；视频编码与封装由 `packages/export` 完成。

## 运行

要求 Node.js 22.12+、pnpm 10.26.2 与支持 WebGL 2 的浏览器。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sukushow/web dev
```

打开统一前端的本地地址，在导航中选择 LLLL 舞台；舞台右上角可切换 3D / 2D 相机角度。默认打开フォーチュンムービー（`103103`）的最高可用难度；选择本地 JSON 或已解密的 raw-deflate `.bytes`，可另选浏览器支持的音频文件。文件不上传。

此包属于 `sukushow` 根工作区；LLLL 的 2D 模式与 3D 模式共用同一套 WebGL 场景与批量几何，切换时同时调整相机、贴图朝向与下落曲线（见下节）。PJSK 渲染与 SVG 图片导出分别由 `packages/pjsk-preview`、`packages/chart-svg` 提供。目录、许可边界和运行时资源见 [工作区说明](../../docs/workspace.md)。

## 2D 俯视模式

`src/flatView.ts` 给出 2D 的取景与下落曲线，`renderer.setCameraMode('2d')` 一次套用：

- **机位**：垂直向下（`rotation.x = −π/2`）的透视相机，位置由「轨道宽度 = 舞台宽 × 轨道宽度设置」反解，因此世界→屏幕等比；相机高度也随画布尺寸变化，比 3D 机位更远，读谱更从容。
- **轨道宽度可配**：侧栏「2D 轨道宽度（占屏宽 %）」= `30..90`（默认 60），等价于调 2D 相机距离——值越大相机越近、轨道越宽、读谱窗口越短；随预览设置持久化（`flatTrackWidth`）。轨道宽度量的是**可玩轨道**（60 个 lane × `BASE_LANE_WIDTH` 0.15 = 9 世界宽，`LANE_HALF_WIDTH`）在音符面上的投影，所以**音符横向正好撑满轨道**——与 3D 一致：3D 的轨道侧边线（`laneOutline`）是按透视收敛的屏幕空间斜线，在判定线处压在音符外沿上（实测差 0.5%）。
- **判定点对齐**：判定点（`BORDER`）投影高度被钉在判定线贴图的中心 `judgeY`，音符判定点因此落在贴图正中。
- **判定线位置可配**：侧栏「2D 判定线位置（占屏高 %）」= `55..90`（默认 73，≈ 3D 的 `h/2 + 253·uiScale`，16:9 时 73.4%），随预览设置持久化（`flatJudgeLine`）。上下移动时 `judgeY` 变、相机 z 反解跟着变，于是**判定线贴图**（`lineUiY`）、**两侧边线近端**（`nearZ = BORDER − below`）、**下落窗口**（`field`）与**轨道平面底边**（`planeNearZ`）一起跟随；轨道宽度与判定线贴图宽度不变。
- **判定线两端在轨道外**：判定线 9-slice 贴图在 2D 下等比缩放到「轨道宽度 × 1.12」（`LINE_OVERHANG`），比两侧边线宽，两端各伸出约 6%。
- **边线贴住轨道、音符撑满**：轨道平面在 y = `PLANE_Y`（比音符面低 0.54），离相机更远，同一个世界宽度投影出来比音符面小 `planeFitX` 倍（16:9 约 1.07）。2D 把平面横向缩到 `planeScaleX = 0.9·planeFitX`（16:9 约 0.966，超宽画布会略 >1），让**平面投影宽度 = 轨道宽度 = 两侧边线跨度 = 音符外沿**；两侧边线（`railX = LANE_HALF_WIDTH`，±4.5）因此压在音符外沿上，音符横向占满轨道。`LaneLines` 是 Plane 的子节点，跟着 Plane 的 scale 走，不能再单独缩放（此前多乘了一次 `planeFitX`，分割线会伸出轨道）。
- **轨道铺满画布**：平面近端按**平面自身高度**的投影比例推到画布底边之外（`planeNearZ`，再留 2 个世界单位余量）；此前按音符面换算，平面底边会停在画布底边上方约 23 px，能直接看到轨道区域的下界。
- **贴图朝向**：`slice.ts` 的 billboard 基向量随相机俯角切换（3D 为 33.2°，2D 为 90°），音符 / Hold / Flick / 粒子 / 拖尾全部平铺在轨道面上；3D 里 `Local` 对齐的竖直粒子在 2D 改走平铺 billboard。`PlaneEffectModel01` 网格的击中光条与 Flick 箭头平铺时保留 `PLANE_UV` 子矩形与底部对齐，所以它们从音符位置朝屏幕上方（与音符下落反向）伸出。
- **粒子方向**：2D 下粒子的**竖直**位移折算成「远离相机」（unity +Z，屏幕上即向上，与音符下落反向），朝相机的深度位移丢弃，高度统一压到音符平面 `Y`；否则打击粒子会顺着音符一起往下漂、并因贴近相机被透视放大。
- **下落曲线**：`createFlatSlope` 用线性映射（屏幕位移 ∝ 时间）替代 3D 三次曲线，提前量时长仍取 3D 曲线在同样速度下的 `duration`，所以 2D 全程匀速且读谱窗口与 3D 一致；`NoteStartZ` 语义不变（只下移出生点）。
- **音符大小**：3D 是斜俯视透视，音符离相机越近越大——从出生点到判定线投影宽度放大约 9 倍（1313×1041 实测：同类音符 5.5 px → 49.4 px，同一帧内不同位置 5.5–311 px）。2D 相机垂直向下、所有音符都在同一高度 `Y`，与相机等距 ⇒ **大小恒定**（实测 35.5 px 不随下落时间变化），这是俯视取景的几何结果，不是漏做缩放。
- **Fever 边线**：3D 的 `FeverLayers` 是朝向 33.2° 相机的 billboard 长条，俯视下不可用；2D 用同一套颜色/相位数学在轨道面里重画平的彩虹边线（`LineBase`，六色轮转 1.6 s）与 `LineMove` 长条。轨道边线本身（宽 0.025 ≈2 px、恒为常色）整条常驻，Fever 的彩虹只画在它上面。**`LineMove` 不沿边线跑**——沿线跑的是入场彗星 `LineCoreMove`（`n_L/R`，只在 Fever 起点射一次、拖着彩虹由近及远揭示）。`LineMove`（#604/#570）是每 0.8 s 从轨道顶部中央 `(0.024, 9.021, 0)` 射出、向轨道外扩散的长条：尺寸恒为 `(0.11, 120)`（长轴 120 远超可见范围，两端扫出画面外），合速度 `(∓0.35, 0, 1.3)`，`looping` ⇒ 每个寿命周期重新出发。它的长轴来自边线帧的 +Y，也就是轨道边走向，所以 2D 平铺时按轨道面 z 方向画：两条贴在两侧边线上、与边线平行的长光带（宽 0.11），按原包 ∓0.35 u/s 向轨道外扩散、并沿 +Z 向上滑出，0.8 s 重生一次；长度按 `LineMask` 窗口裁剪（见下）。
- **Fever 入场彗星 `LineCoreMove`（及其 `LineCoreParticleMove` 子节点）**：3D 里它沿入场曲线 `(∓18.46, −9.4, 0)` → `(∓1.96, 6.9, 25.8)` 用 0.4167 s 从屏幕外侧斜着飞进来，俯视投影后是一条横穿轨道、直奔画面外的斜线——所以 2D 改成**沿轨道边跑**：x 钉在 `±RAIL_HALF_WIDTH`，z 从可见轨道近端（判定线一侧）线性走到远端，`rateOverDistance = 5/单位` 的拖尾因此连成一条沿边线推进的高光。可见轨道比原包边线（约 34.7 单位）短，2D 按比例放大参与发射的距离量，拖尾密度与 3D 一致（见 `flatRailPoint`）。
- **`LineMask` 揭示**：彩虹边线不是一进 Fever 就整条亮起，而是被彗星领跑、从判定线端向远端揭开（遮罩 `scale.y` 0→68，0.4333 s 走完）。3D 靠 `FeverLayers` 的 stencil 遮罩；2D 没有 stencil 通道，改成把「已揭示窗口」当裁剪区间：常色边线（2 px）整条保留，另画一条**原包宽度 0.13（≈10 px）的 `LineBase` 彩虹光带**，长度 = 揭示比例 × 可见跨度、从判定线端生长；`LineMove` 长条同样裁到该窗口内。实测（1313×1041）：判定线附近的边线在 0.15 s 时由 2 px 变成 13 px，0.34 s 时整段都是 11 px。火花 `LineParticle` 也只在已揭示段内出生。
- **Fever 边线火花 `LineParticle`（`Particle_*` / `Closs_*` 发射器，原包 `LineParticle_*` 的 renderer 关闭）**：原包发射体是沿边线方向排布的长 box（`sy` 22–23、`rotz` −45.4°/−32°），中心在 `x = ∓6.87`（轨道之外），俯视下会摊成轨道外的一条斜带。2D 改为贴住边线：x = `±RAIL_HALF_WIDTH` 加原包 `shape.sx`（0.5）的横向抖动，z 沿轨道边分布（受上面的揭示比例限制），外漂速度 ∓1.5/∓2.0 u/s 保持不变。

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

设置分为「播放与轨道」「显示与特效」「音量」「计分」四类；技术分、TotalAppeal、熟练度和段位预览位于「计分」。2D 俯视的两项取景参数（轨道宽度、判定线位置）位于「播放与轨道」，只影响 2D，3D 机位不变。分类标签支持方向键及 Home / End 切换。Voice、技能与 MV 控件保留配置入口，不代表已实现语音、技能演出或 MV 播放。

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

导入 `rhythmgame_chart_<歌曲ID>_<难度>.bytes/json` 时自动匹配。显示与特效中的“Fever 开始 / 结束（秒）”可手动覆盖，区间为 `[start,end)`；同时留空关闭，非法输入停用 Fever。手动值不写入全局设置，换谱清除；“恢复歌曲元数据”撤销覆盖。必要时延长播放时间轴以覆盖指定终点，但不修改源谱面文件。“Fever 显示”仅控制特效，不改变逻辑 Fever 状态。

## 预览皮肤 / FX

统一前端的 `apps/web/public/rg/` 提供 UI 贴图、hit FX、`sprite_meta.json` 与 HUD 字体文件；缺省时使用程序化色块回退。

约定路径：`apps/web/public/rg/sprites/<name>.png`、`apps/web/public/rg/fx/fx.json`、`apps/web/public/rg/fx/tex/<texture>.png`、`apps/web/public/rg/sprite_meta.json`、`apps/web/public/rg/fonts/<file>.otf`。

## 依据与限制

参见 [实现依据与限制](../../docs/evidence.md)。行为以客户端二进制与场景序列化为准；重建工程仅辅助定位逻辑。不转换为 SUS，也不经过 WASM 渲染。

**不宣称像素级还原。** 有 `apps/web/public/rg` 时使用附带皮肤 / 简化 FX / SafeArea HUD；无资源时程序化回退。粒子为 Additive 近似（非完整 Unity ParticleSystem）。浮点计算以 JavaScript double 为主，Hold 计数采样与串链时间比较按原包 float32 语义处理，并非全引擎逐指令 float32 仿真。移动端扩大垂直视角属于预览器适配。

只能导入已解密谱面，不提供解密入口。16 MiB 谱面、128 MiB 音频、50,000 音符为加载上限。极端密集自制谱可能达到绘制批容量，当前未实现分页渲染。

测试覆盖格式解析、几何边界、9-slice / HUD 缩放、播放状态和浏览器交互。语料校验不等价于逐帧视觉一致性验证。

## 目录

- 谱面解析与曲目时间（Fever、曲终）来自 `@sukushow/chart`。
- `src/geometry.ts`：空间数学；`src/flatView.ts`：2D 俯视取景与线性下落曲线。
- `src/slice.ts`、`src/shaders.ts`、`src/rgAssets.ts`、`src/fx.ts`：9-slice、着色器、资源加载、hit FX。
- `src/hud.ts`：SafeArea 覆盖层。
- `src/transport.ts`、`src/audio.ts`、`src/se.ts`：播放时基、本地音乐与局内音效。
- `src/score.ts`、`src/fever.ts`、`src/hudFxMath.ts`：计分、Fever 边线颜色与 HUD 动画曲线。
- `src/renderer.ts`：WebGL 批量几何。
- `src/rgOptions.ts`：游戏选项默认值；工作台和页面设置位于 `apps/web/src/views/llll/`。
- `tests/`、`scripts/`：回归测试与本地语料校验。

## 许可与免责声明

- **本仓库原创代码**采用 MIT，见 [LICENSE](LICENSE)。
- **第三方依赖与参考**见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。
- **`public/` 内附带的贴图、FX、字体、局内音效等**来自或还原自游戏客户端资源，**权利归各原权利人所有**；收入本仓库仅供本预览器非商业研究与互操作验证，不构成授权转载、再分发或商用许可。字体（如 FOT-Rodin Pro）尤受字厂许可约束，请勿单独抽出挪作他用。
- 本工具为**非官方**研究预览器，与游戏运营方、开发商、发行商及任何关联商标**无隶属、无赞助、无背书**关系。
- 使用本仓库即表示你自行评估并承担与附带游戏素材相关的合规风险；作者不对因使用或再分发这些素材产生的后果负责。
