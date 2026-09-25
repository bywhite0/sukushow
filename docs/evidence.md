# 实现依据与限制

## 格式与空间

- 直接读取 JSON 或 raw-deflate 谱面，不经过 SUS 转换。
- just 和 holds 使用绝对秒；Flags 保留类型及四个 6-bit 轨道字段。
- 保留 60 格坐标、Hold 原始端点、共享后继与同时押分组。
- 三次下落曲线为 `borderZ + 3.9*d + 0.072*d³`；相机俯角 33.2°，垂直 FOV 60°。
- 求根收敛返回新迭代值；非法速度和求根失败不会送入 GPU。
- 音符世界宽 `((Width-6)*0.2+1.15)*0.75`，深度 0.45（Trace 0.35）；来自 NoteSilhouette / 二进制 dump，而非猜测。

## 权威来源

- 行为与布局以客户端二进制与场景序列化为准；与重建工程冲突时以二进制为准。
- 不修改上游 Unity 工程。预览用贴图 / FX / 字体放在 public/rg/（权利见 README 免责声明），不作为对原权利人的授权声明。

## 预览皮肤 / FX

- 预览侧栏「击中特效」`hitEffect`（非原版 RhythmGameOption）：`current`=直冲天上（不限速，但带 rotol+软拖尾），`limited`=限速，`full`=加深（限速+rotol+拖尾），`off`=关闭。
- HitFx：`limited`/`full` 接 LimitVelocity（授权 dampen≈0.55–0.65、lim≈1、startSpeed 40–80）；`v=lim+(v0−lim)e^(−κt)`、`κ=−ln(1−dampen)×50`；每帧约 40% 路程先积分再限速、余下再积分（略冲、无出生强刹）；`current` 不限速。`current`/`full` 接 rotol/拖尾。


- 仓库跟踪 public/rg/（sprites / fx / fonts / sprite_meta）。可用 scripts/copy-rg-assets.mjs --unity … --meta …（或 RG_UNITY_ROOT / RG_SPRITE_META）从本机资源树刷新。
- 有资源时：9-slice note / 判定线、Plane Fade、Sprites/Default HoldMesh、hit FX（节点 TRS / SetWidth / bursts、Local·billboard；仍非完整 ParticleSystem）、SafeArea HUD 贴图。
- **纹理颜色空间**：sprite / FX 自定义 shader 直接在显示颜色上运算，不做线性空间输出转换，因此对应贴图使用 `NoColorSpace`，避免额外 sRGB 解码造成偏暗；不将此规则泛化到其他材质。
- **Hold 头部光效**：`holdLoop` 的 `core` 角色与名为 `Core` 的节点跟随当前 Hold 头部，`setLoop` 同步平移已有核心粒子；飞散粒子保留世界坐标，不随头部一起横移。
- 无资源时：程序化色块回退，页面仍可打开与播放。
- HUD：计分 / 段位 / combo / 判定等为预览实现，非完整对局客户端。

## 工作台与设置

- 顶部工具栏导入谱面与本地音乐；预览区下方集中放置时间轴、播放、重播、倍率和全屏。
- 设置分为「播放与轨道」「显示与特效」「音量」「计分」四类，标签支持方向键及 Home / End；击中特效位于「显示与特效」，技术分位于「计分」。
- `src/settingsPersist.ts` 使用 localStorage 保存预览设置；不会修改源谱面。Voice、技能与 MV 开关保留配置入口，尚未接入对应语音、技能演出或视频播放。

## 参考

[sekai-mmw-preview-web](https://github.com/watagashi-uni/sekai-mmw-preview-web) 提供文件导入和播放交互参考；未移植其源码、WASM 或资产。

## 兼容边界

允许零时长 Hold、负时间 BPM 段和多个前段共享后继；拒绝倒序端点、非有限数、越界轨道和重复 UID。UID 严格递增约束防止串链环路。

## 非原版一致部分

不宣称像素级还原。有本地 `public/rg` 时的贴图 / FX / HUD 仍是浏览器近似（粒子非完整 Unity ParticleSystem；9-slice 仅水平；自定义粒子 shader 降级为 Additive）。无资源时的程序化贴片同为近似。已接入 AutoPlay 计分、AP / Fever 与局内 SE；未实现完整手动判定状态机、结算、角色技能、语音和 MV，不能视为完整对局客户端。

JavaScript double 运算没有逐指令模拟 float32。音频偏移、移动端扩大视角和输入大小限制属于预览器行为。

## HUD 实现要点

本仓库内 HUD / 计分相关实现的约定与已知口径。

- **暗色分数**：`UpdateScore` 用 `num_score_11` / `num_score_12` 换精灵，不是 opacity；开局 `Clear()` 时 12 位与逗号全暗。
- **Combo 阈值 10**：`UpdateCombo` 在 combo < 10 时不显示数字；COMBO 标签与 APRate 徽章由 `UpdateApRate`（apRate >= 1）显隐。
- **判定字**：寿命 0.7 s 硬切（无淡出）；缩放 `JudgementRectTween` 0.5->1 / 0.1 s；combo >= 10 时 `ComboRectTween` 0.8->1 / 0.1 s。
- **AP/Voltage 环**：level56 Image Filled / Radial360 / fillOrigin Top / fillClockwise=false；fillAmount=ApResolver 小数部（Voltage 为 CalcGauge）；CSS 对 gage img 做 from 0deg（正上方）逆时针 conic mask（度单位）。
- **isAuto 死码**：4.12.0 `ScoreResolver.isAuto` 无置 true 写入，`autoSprite` 运行时不出现；AutoPlay 仍走常规判定精灵。
- **P2 chrome**：GaugeRoot + RankLabels + RankRoot（开局 SetRankNotActive / D）；PauseButton 包含遮罩内 Pattern；TechnicalScoreRoot 默认隐藏，由技术分三态设置控制。
- **TechnicalScoreDisplay**：「计分」面板中的「技术分显示」映射；默认关闭。
- **TechnicalScoreDisplay 三态**：0 关闭 / 1 实时 / 2 预估剩余全 PP；推送值 raw/N×10000，面板文案 percent=value/10000（全 PP ⇒ 101.0000%）。场景 TMP 模板 `99.9999%` 仅占位，开局 Clear 为 `0.0000%`。预览由 `ScoreEngine.technicalPush` 按已判定结果计算实时值，并以剩余判定全 PP 计算预估值。
- **Pause Pattern**：`ui_sc2_button_shine` / `ui_sc2_button_dot` 在 `Art/Resources/SelectUI`（非 GameUI）；α .349 / .298，挂在 ColorImage Mask 内。
- **RankRoot shine/deco **: White->Gray/RankColor; Shine a.2, Deco01/02 a.8; setRank(none|D|C|B|A|S); inactive=SetRankNotActive. Material tints D/C/B/A solid, S gradient. Sidebar rank preview.
- **Rank hex clip**: icon + fill layers mask to ui_sc2_button_rank so shine/deco stay inside hex.
- **用户设置默认值（4.12.0）**：`RhythmGameOptionValue..ctor` @0x44A2C2C 取各 `OptionRange.First`——`EnablePerfectPlus=false`；`EnableFastSlow/FastSlowThreshold=0`(Off, range 0..2)；`JudgementOutput=0`(All, range 0..6)；`TechnicalScoreDisplayType=0`(Off, range 0..2)。侧栏「Perfect+ / 判定字输出 / FAST·SLOW」已接；判定显示门控 `type < 6-opt`；AutoPlay 在 PP 开启时用 `hantei_perfect_plus`。
- **计分/段位**：`src/score.ts` 按 ScoreResolver——`halfwayScore=Appeal×(1+熟练度等级×0.01)/AllNoteSize`，`CalcAdd=ceil(halfway×factor×(1+VL×0.1))`，factor Bad5…PP35；`GetScoreRank` 降序 [S,A,B,C]；槽位填充 (0,0)/(C,.409)/(B,.587)/(A,.773)/(S,.912)/(1.5S,1)；RankLabels dump xs [17,76,137,183]（相对比例约偏 2px，按 dump）。预览 AllNoteSize=`chartAllNoteSize(chart)`，按 `noteJudgementTimes` 累计判定点（与 countHeads 一致），不是 `notes.length`。默认 Appeal 350000、界值 1千万/500万/150万/50万。技术分权重 20/50/90/100/101，侧栏三态推送 raw/N×10000。
- **侧栏计分配置**：TotalAppeal + 熟练度等级（MusicMasteryLevel，默认 0）。
- **Rank/gauge fix**: score>0 且未达 C → 显示 D（Clear 仍 none）；槽位填充结 S=0.912（非 1.0），与 RankLabels 对齐。
- **TMP SDF 描边**：双层 .hud-ol / .hud-face 同尺寸对齐；**整层** scale(0.92)（避免字面单独缩放造成描边双侧偏移）；underlayer stroke 2×outlinePx。
- **JudgeRoot/Condition**：(0, FastSlowY→−210±) 180×64；精灵 hantei_fast/slow/flick；与判定字同 0.7 s 硬切 + 0.5→1 缓出。ToCondition(diff==0)⇒Slow；shouldShowFastSlow 门控（Off 永不；UnderGreat type≤3；UnderPerfect type≤4）。AutoPlay 精确过线在 UnderPerfect 下显示 SLOW。
- **Combo 固定槽**：按 `UpdateCombo` 四槽 Sprite0..3（[0]=个位、row-reverse）；`<10` 全隐；`setSprite` 原地换图，未激活槽不参与 HLG 排布。
- **Combo 计数 / AllNoteSize**：Prepare Pass2 语义——多段 Hold 链头判定点 = `GetHolds(Just, tailEnd)` 半拍网格（不改写渲染用 holds）；`countHeads` / `chartAllNoteSize` 只计根节点 Just+采样；103119_04 = 1404。COMBO 数字行锚点与标签同为 x=−40；槽间距 `column-gap:−13px`。
- **Mental 开局满血**：value=maxValue=TotalMental；预览永生无扣血，显示 1000/1000（预览默认 TotalMental）+ 条满。 Fill 为青渐变 (29,235,199)→(118,240,224)；`value ≤ ceil(max×0.2)` 时切红 (235,37,78)→(255,114,143)（预览满血不触发）。
- **AP / Voltage / Fever 实况**：ApResolver 驱动 AP 环；Voltage 点仅技能产（预览恒 0）。原始谱面不提供分段，不再读取 `Sections` 或按曲长估算。Fever 由歌曲元数据索引或当前谱面的手动起止秒数驱动：索引使用 `Musics.FeverSectionNo` 选择 `musicscore_<Id>.csv` 中四个 `key_type=20` 边界所划分的段，第五段终点采用 CSV 原始顺序中最后一个 `key_type=99`（MusicEnd）的时间，统一从毫秒转秒；分段事件按时间升序排列，不使用 `Musics.PlayTime` 或“末音符 + 2 秒”作为 Fever 终点。4.12.0 二进制已核实：`FeverResolver.Inject @0x4990388` 在 `0x4990540` 取 `QuestLiveMusicScore +0x34`（MusicEndTime）；`LoadCsv @0x41A537C` 在 `0x41A5C44–0x41A5C54` 将最后一个 MusicEnd 的 SongTime 写入该字段，谓词 `0x41A5FC0` 比较 `KeyType==99`；分段谓词 `0x41A5F88` 比较 `KeyType==20`，`0x41A5B94` 按 SongTime 排序。四个边界的严格校验是预览器策略，不是客户端强制校验。无元数据或输入无效时不启用 Fever。`EnableFeverDisplay` 仅门控 LineBase 彩虹、LineMove 单程 0.8s / 往返 1.6s 亮条（长 4.4% 边线）与两侧粒子，不改变逻辑 `IsFever`（VL 翻倍）；跳转后恢复粒子，关闭击中特效保留 Fever 粒子。

## Fever 特效核对

- **拖尾宽度双常量**：直接读取 4.12.0 客户端 `data.unity3d` 的 level56 #543/#544，均为 `widthOverTrail.minMaxState=3`，minScalar=0.6999999881、scalar=0.3000000119，`sizeAffectsWidth=true`。客户端 `MinMaxCurve.Evaluate(time, lerpFactor) @0x8927DB4` 在 `0x8927DCC` 判断 mode=3，`0x8927DEC–0x8927E0C` 读取 +0x18/+0x1C 两常量，执行 `min + clamp01(lerpFactor) × (max−min)`，该分支不乘 curveMultiplier，也不使用 time。预览不再固定取 scalar=0.3；原生调用链已进一步定位：`libunity.so` getter `0x6A9FE0` 取粒子系统数据 +0x1158，经 `0x109A740 → 0x104B0C8` 转换宽度曲线；序列化函数 `0x1066244` 将 TrailModule +0x98 绑定为 widthOverTrail，setter `0x6AA16C` 使用相同偏移。渲染任务 `0x12A7394–0x12A73B0` 将宽度曲线指针存入上下文 +0xC08；`0x12A7EF8` 调用 `0x12AB17C`，其经 `0x10857E8` 取粒子结构，读取栈 +0x6C（结构起点 +8，即 Particle.m_RandomSeed +0x64），在 `0x12AB270–0x12AB2BC` 由 seed 派生宽度混合因子并存入上下文 +0x10。`0x12A86D8–0x12A86F8` 广播该因子并调用原生曲线采样 `0x122959C`；mode=3 分支 `0x12295D0–0x12295E8` 使用两常量插值。因子只依赖粒子 seed，不依赖帧时间；Fever 拖尾已按该整数混合公式派生宽度因子，包含 uint32 溢出、逻辑右移及 float32 转换/乘法，双常量结果在出生时缓存。预览 seed 仍由本地 Math.random 生成，不等同于客户端发射器的 seed 序列；其他随机模块尚未共用该 seed，跨模块相关性仍未对齐。宽度曲线模式现已支持按头部 0、尾部 1 逐端点采样，双曲线沿用出生时固定的宽度因子，零乘数和零宽端点不会被抬成可见宽度。此步覆盖 Fever 现有 textureMode=2 的均匀段参数：`libunity.so 0x12A8120–0x12A8138` 计算顶点索引／段数，`0x12A81E4–0x12A81FC` 限制到 [0,1]，`0x12A86D8–0x12A86F8` 传入宽度采样器；其他纹理模式的长度参数尚未接入。

- **拖尾轨迹几何**：每段四边形现在连接实际历史位置，截面垂直于轨迹并朝向固定相机法线；不再用放在线段中点的竖直 billboard 代替斜向轨迹。零长度不绘制，沿视线方向退化时使用横向截面。已进一步复核原 APK 的 `libunity.so 0x12A7DBC–0x12A7E18`：构建历史轨迹后读取粒子当前 XYZ，并在必要的空间变换后写入轨迹头部。预览绘制时追加当前位置作为临时头部，即使未达到 minVertexDistance 也连接最新历史点；临时头部不写回历史，保持距离采样规则，重合端点不增加几何。`0x12A7E2C–0x12A7ED8` 进一步按历史点时间、当前系统时间与拖尾寿命计算截断比例，clamp01 后插值最旧端点；预览保留跨越寿命边界的一段，并在绘制时裁剪到精确边界，不再整段跳删。尚未实现相邻段接缝，仍非完整 Unity TrailModule。拖尾独立材质槽已接入，shader 仍为预览近似，见下项。

- **拖尾独立材质槽**：现有离线 `_rg_dis.py` 核对 `ParticleSystemRenderer.get_trailMaterial @0x8928CCC` 的原生绑定；从原 APK `libunity.so` 重定位表定位 getter `0x6ADB98`，`0x6ADC24–0x6ADC58` 检查材质数量至少为 2，并以索引 1 读取材质；不足两个槽或空引用返回 null。序列化引用交叉核对：两侧根发射器主体为 sharedassets56 #11，拖尾为 resources #204（sc2_Particle_light02）；Height 系列拖尾为 resources #200。预览现在消费已导出的 `rend.trailMat`，按该材质的贴图、shader 和节点排序层建立批次，不再直接复用主体贴图。显式材质/贴图缺失时跳过拖尾但保留主体；未提供该字段的旧导出继续复用主体，属于兼容策略，不是客户端空槽行为。当前仍共用近似 FX shader，未宣称还原全部原版混合、UV 和渲染状态。

- **拖尾尺寸继承**：原始 #544 `TrailModule.sizeAffectsWidth=true`。预览拖尾宽度现在乘当前寿命相位的尺寸曲线，不再只乘出生尺寸；关闭该开关时保持独立宽度。现有拖尾宽度的 0.15 视觉系数及 ribbon 几何仍为近似，未宣称与原版绝对宽度一致。

- **粒子数值曲线**：原始 #544 SizeModule 包含非零入／出切线。HitFx 对已导出的 `FxKey.i/o` 使用非加权三次 Hermite 插值，切线乘关键帧时间跨度；缺少切线的旧数据保持线性回退。影响共用采样器的尺寸等数值曲线，不改变 Gradient 的 RGB/alpha 线性插值；加权切线尚未支持。

- **拖尾颜色继承与寿命采样**：原始 #544 `TrailModule.inheritParticleColor=true`。拖尾使用粒子当前寿命相位的颜色（含 TwoGradients 混合与 alpha）再乘拖尾寿命颜色，关闭继承时仍保留拖尾寿命颜色。已用现有 `_rg_dis.py` 与原 APK 的 ELF/Capstone 链路交叉核验，UnityPy 导出仅用于字段值与对象引用定位，不作为运行时语义的唯一证据：`libunity.so 0x1066208–0x1066238` 将 TrailModule +0x58 绑定为 colorOverLifetime（粒子系统数据 +0x1118）；`0x12AB318–0x12AB388` 从粒子剩余/初始寿命计算归一化年龄，并由同一粒子 seed 加 `0x591BC05C` 派生独立颜色因子；`0x12AB38C–0x12AB468` 按模式采样渐变，`0x12AB46C–0x12AB4D0` 乘继承颜色。预览已修复将 colorOverLifetime 错按历史顶点年龄采样的问题，TwoGradients 使用固定 seed 因子混合；宽度与拖尾寿命颜色共用本地粒子 seed。原生随后在 `0x12A81CC–0x12A82CC` 独立采样 colorOverTrail，预览现已按逐端点参数独立采样 colorOverTrail 并乘寿命颜色；支持单渐变及归一化为单键渐变的常量。原始 Fever 节点均为常量模式，根节点 alpha=1，Height/HeightCloss=0.3843137324、Start=0.2549019754、Star/Closs=0.5607843399；旧导出遗漏的常量由 `src/feverTrailColors.json` 补足，仅作用于 feverLeft/Right，并允许新导出显式字段覆盖。数值来自原场景，与 `0x1066298–0x10662D0` 的独立 colorOverTrail 绑定和 `0x12A82D0–0x12A8330` 的乘色路径交叉核验。沿长度 TwoGradients 与原生 Color32 量化乘色尚未逐指令复现。

- **粒子排序**：共用贴图和 shader 不代表共用排序层。Fever 的 Particle_Height / Particle_Height_02 分别为 20/19；Particle_Start / Particle_Closs 分别为 23/20。HitFx 批次键包含 `sortingOrder`，避免后创建节点继承第一个节点的排序。预览仍保留统一的 +40 渲染层偏移。

- **双色渐变**：原始 #544 的 ColorModule 为 `minMaxState=3`（TwoGradients）。按 Unity `MinMaxGradient.Evaluate(time, lerpFactor)`，先在同一寿命相位采样两条渐变，再连续混合 RGBA；不能随机二选一。预览每个粒子出生时固定混合比例，随寿命推进采样，两条曲线的 alpha 同样参与插值。该修复适用于共用 HitFx 渲染器的所有 TwoGradients 节点。

- 离线核对 4.12.0 `libil2cpp.so`：`FeverResolver.Process @0x4990098` 在开始边界设置逻辑状态，并由 `_isFeverEnabled` 门控 root 激活；结束边界无条件关闭 root。显示开关不改变逻辑 Fever。
- `src/fever.ts` 的颜色改用原始 `level56` ParticleSystem #542（LineBase_Left）/#604（LineMove_Left）的 `ColorModule.gradient.maxGradient`，不再把重建工程 Play-mode 的屏幕 hue 当作源颜色。
- 两层共用六个 RGB 色键，ctime 为 `[0,13107,26214,39321,52428,65535]`；RGB 与 alpha 独立线性插值。LineBase alpha 时间为 `[0,6554,33731,58982,65535]/65535`、值为 `[0,0.7058823704719543,1,0.7058823704719543,0]`；LineMove 时间为 `[0,13107,32768,52428,65535]/65535`、值为 `[0,0.47058823704719543,1,0.47058823704719543,0]`。
- **两侧入场爆发**：原始 `level56` #544/#543 均为 `looping=false`。根发射器按 0、0.05、0.08、0.10、0.13、0.18 秒发射六批，左侧累计 70、右侧累计 52 个粒子（不含子发射器）。预览此前以循环容器包裹非循环节点，导致只发出零时刻一批；现按非循环入场推进所有批次，并修正首个更新帧重复发射零时刻 burst。粒子自然消亡后不自动重播，关闭 Fever 立即清空。
- **范围限制**：以上对齐的是渐变与入场发射调度，不是完整 ParticleSystem。LineMove 已改用原包位置运动（尺寸恒定、位置随 0.8s 周期射出）；`LineBase` 位置恒定、尺寸恒定，仅颜色按 1.6s 轮转。FeverEffectStartAnimation 入场、LineCoreMove 等层仍未完整复现；预览动画相位继续锚定歌曲 Fever 起点。

- **LineMove 几何依据纠正**：#604/#570 的 `InitialModule.size3D=true`，X=0.1099999994、Y=120、Z=0.1000000015，`rotation3D=true`；Renderer 的 `m_RenderMode=0`，不是拉伸模式。不能仅以 X×`m_LengthScale`÷Shape.length 推导屏幕亮条长度。`ShapeModule.type=4` 的语义也不能沿用重建文档的 Edge 注释，须结合 Unity 序列化枚举核对。**行进方向（已定）**：亮条自**判定线一侧**沿轨道边**射向远处**（屏幕上方/轨道收窄处），单程约 0.8s——依据实机录像逐帧观察（全黑背景 + 103119_03）。入场初期该亮条会与 Fever 同时发射的两侧粒子混在一起，需等粒子散开后才看得清。原包 `ShapeModule.type=4`（Cone）`angle=0` ⇒ 粒子沿锥轴局部 +Z 射出，`startSpeed=1.3`；叠加世界空间 `VelocityModule.x=∓0.35` 后合速度 `(∓0.35,0,1.3)`，寿命 0.8s 位移仅 `(∓0.28,0,1.04)`，投影后中心只漂移边线约 1.5% 且垂距由 0.6px 增至 16px（逐渐离开边线）⇒ **单靠静态数据无法定出可见行程**，故方向取录像观察。预览按边线参数轴单向推进（行程 0.94→0.17，自判定线端射向远端），`repeatInterval`=`startLifetime`=0.8s 且 `looping=true` ⇒ 每个寿命周期从同一端重生，是**单向扫过而非往返**。
- **Fever 三个「会动」的层不要混为一谈**（用户纠正后厘清）：
  1. **行进高光（彗星）= `LineCoreMove_L/R`（#607/#627）+ `LineMask` 揭示**：**只在 Fever 起点射一次**（`coreActive` 在 38/60s 关闭；`LineCoreMove` burst `repeatInterval=0.4` 但 `loop`+`sizeOverLife` 使可见彗星只在入场出现一次）。它**领跑**着把彩虹边线从近端（判定线侧）沿轨道「带」到远端 —— 所以**不是一进 Fever 整条边就变彩虹**，而是近端→远端扩散（实测遮罩 `scale.y` 0→68，揭示范围 t 1.018→−1.057，0.4333s 完成）。预览 `feverMaskGeometry` 的 `scale.y` + `feverEntrance` 的 `leftCore` 已实现此机制。
  2. **`LineMove_L/R`（#604/#570）= 向轨道外扩散的线状粒子**，`loop`+`repeatInterval`=`startLifetime`=0.8s ⇒ 每 0.8s 一趟。⚠ **它不是「沿边线跑的行进高光」**（此前预览把它当成边线上的行进条，方向改过两轮都不对，根因在此）。预览已改为**原包位置运动**：发射点 `(0.024, 9.021, 0)` = 轨道**顶部中央**（屏幕 y≈−47，在可见区之上），合速度 `(∓0.35, 0, 1.3)`（Cone `angle=0` 沿 +Z × `startSpeed=1.3`，叠加世界空间 `VelocityModule.x=∓0.35`）；条带恒长 `startSizeY=120`（半长 60，远超可见范围）⇒ 两端一路扫出画面外，观感即「向外扩散」。这也解释了为何沿边线剖面测不到 0.8s 周期性（实测 1.24 Hz 幅值仅 0.036，且与外推的 ~0.87 Hz 不符）。
  3. **`LineBase_L/R`（#542/#614）= 边线本身随时间变色**（见下条）。
- **彩虹是「边线随时间变色」，不是「边线同时呈彩虹色」**：`LineBase` 的 `ColorModule` 是 6 色等距渐变，整条边在**同一时刻是单一颜色**，该颜色随粒子寿命相位轮转（周期 = `startLifetime` = 1.6s）。因此沿边线横截面测色相多样性无法定位 Fever（实测圆离散度全程 ≈3–30，无区分度）；正确判据是**同一位置的色相随时间变化**。预览 `feverLineRgba(time, feverStart)` 即按时间采样，与此一致。
- **`SizeModule` 只有 `curve` 生效（修正）**：`separateAxes=false` 时求值的是 `curve`；`y`/`z` 是**未被求值的样板**。level56 全部 **111 个** `ParticleSystem` 的 `separateAxes` 均为 `False`，**无一处为真**。`LineBase`/`LineMove` 的 `curve` 都是 `[(0,1),(1,1)]` ⇒ **尺寸恒定**；其 `y=[(0,0),(1,1)]` 曾被误当作「统一尺寸乘数」，从而错误推出「两层从尺寸 0 长出、边线随时间伸缩」。对照：同文件里 `curve` 真的会动的层（如 #528 `ComboEffectBG_01` `[(0,0.773),(1,0.869)]`、#530 `Bg_core` `[(0,0),(0.261,0.938)]`）才是有尺寸动画的层。**结论**：`LineBase` 随时间变的只有**颜色**（6 色渐变轮转，1.6s），`LineMove` 随时间变的只有**位置**（0.8s 射出）。
- **运动**：两侧 `startSpeed=1.2999999523`、寿命 0.8000000119；启用世界空间 VelocityModule，左 X=-0.3499999940、右 X=+0.3499999940，Y/Z=0。父级静态变换均为单位变换。`RotationModule` 为 LineMove **enabled**（z=∓0.0314159244 rad/s）、LineBase **disabled**。HitFx 已支持启用的常量 VelocityModule：世界空间直接使用 XYZ，局部空间先应用发射器旋转，再叠加初始速度；仅接入三轴均为常量的情况，曲线速度和与限速模块的完整组合仍待核验。LineBase 的 VelocityModule 则为 disabled，不能采用其中残留的 +12/-20 值。
- **入场状态机**：sharedassets56 #104 `FeverEffectAnimatorController` 只有一个默认非循环状态，引用 #92 `FeverEffectStartAnimation`。将绑定路径 CRC32 与 level56 层级对应后，曲线 18/19 控制左右爆发根节点：t=0 关闭、t=1/60 秒开启；预览将 Animator 的 1/60 秒激活延迟与每个发射器的 `startDelay` 相加；原始根发射器 #543/#544 为 0–0.1000000015 秒随机延迟，每次启动独立采样一次，所有批次共享该偏移。上述六批时间为发射器开始后的相对时间，不是 Fever 起点的绝对偏移。延迟期间关闭 Fever 会取消待发射批次，暂停不推进计时；跨过出生点的首帧仅推进出生后的实际时间。
- **世界空间边线与遮罩（已接入）**：原始 `LineParticle` 链 `WorldRoot > Fever > FeverEffectSet_001 > LineParticle` 逐级均为**单位变换**，故边线层位于世界原点；文档旧稿把同级兄弟节点 `sc2_ingeame_feverEffect_L/R_001` 的 `(±3.98, 4.88, -5.99)`（屏幕两侧大特效）当成父级，导致整组特效沿 Z 偏移 5.99。`LineMask_L/R` 的 RectTransform 为 anchor (0.5,1)、anchoredPosition `(∓18,−9)`、pivot (0.5,0)、size (20,106)，其原始四元数 `(0.2685529291629791, ±0.09745344519615173, ∓0.32690104842185974, 0.9008429050445557)` 与「相机俯角 33.2° × 边线画布角 ∓39.89°」等价，是**边线唯一朝向帧**：+Y 的投影长轴与 `OutLine` 的 `rotZ` 同为 39.890°，条带两端垂距 ≤1px；该锚点同时与入场动画彗星起点（`LineCoreMove` t=0 的 `∓18.46,−9.4`）重合，揭示因此从近端沿线向远端展开。预览用 `FeverLayers` 采用独立 `fever_mask` 网格、遮罩 stencil `NotEqual`、`colorWrite=false`，LineBase/LineMove 消费原始贴图。原始 `ParticleSystemRenderer.m_MaskInteraction=1` 的 getter `libunity.so 0x6AD964–0x6AD9F4` 读取结构字段 +0x840；枚举初始化 `0x10771BC–0x10771E4` 建立 0/1/2 模式资源。LineBase/LineMove 为 `m_RenderAlignment=1`（View）的相机朝向 billboard，其屏幕朝向不由 `startRotation` 单独决定（实测以 `Rx*Rz` 投影斜率 3.2588、以 View 模型 0.8481，均偏离 0.8358），故预览统一改用遮罩帧。**实测复核**：Fever 开/关差分隔离纯特效像素后拟合，左侧 x=−0.8345y+580.0（rms 2.34）、右侧 x=+0.8345y+651.0（rms 2.35），对 `OutLine` 斜率偏差 0.16%、截距 0.3/1.3px。

- **行进高光（彗星）的主要发射源是 `rateOverDistance`，不是 burst（已接入）**：`LineCoreMove_L/R`（#607/#627）的 `EmissionModule` 为 `rateOverTime=0`、`rateOverDistance=5/单位`、burst `count=1 × cycles=15 @repeatInterval=0.4`。单趟路径长 `hypot(16.5, 16.3, 25.8) ≈ 34.69` 单位 ⇒ 沿路径约 **174 个**，burst 只贡献 15 个。稳态存活数自洽校验：`5/单位 × 83 单位/秒 × 0.1 秒寿命 ≈ 42`，实测 43。此前预览**完全未实现 `rateOverDistance`**（源码无该字段），彗星只剩 15 个 burst 粒子且全部黏在节点上 —— 这是「行进高光看不清」的根因。AB 实测（同谱面、仅切换 `rateDist`）：`5` ⇒ 稳定 22 个粒子 / 沿边展开 3.59；`0` ⇒ 0.5 个 / 展开 0.00。
- **`moveWithTransform` 是 `simulationSpace` 的旧序列化名（字段级纠正）**：TypeTree 为 `int moveWithTransform // ByteSize{4}`，紧随 `PPtr<Transform> moveWithCustomTransform // ByteSize{C}`；而同在 `ParticleSystem Base` 顶部的 `looping`/`prewarm`/`playOnAwake`/`useUnscaledTime` 均为 `bool // ByteSize{1}`。4 字节 int + 配套的 Custom Transform 指针 ⇒ 该字段即 `ParticleSystemSimulationSpace`（`Local=0 / World=1 / Custom=2`，IL2CPP dump 的枚举定义同此）。全工程取值分布 `0→1491`、`1→341`，**无值 2**；Unity 默认 Local，故 0=Local、**1=World**。`LineCoreMove`/`LineCoreParticleMove`/`LineMove`/`LineBase` 均为 **1（World）**，`LineParticle`/`LineParticle_Closs`/`Particle_Start_*_02` 为 0（Local）。**World 的观感后果**：粒子出生时把发射器当时的入场位移烘进世界坐标，此后不随节点移动 ⇒ 沿轨迹沉积成一条拖尾；若按 Local 处理，粒子全部黏在节点上，永远只是一个亮点。预览因此按 `world` 标志区分两种行为（`fx.ts` 的 `spec.world` / `Spark.off`）。
- **按路径细分发射**：`rateOverDistance` 在一帧内的 N 个粒子必须按位移等分铺开、各带自己的出生时刻与已存活时长。整帧一次性发射会让粒子全堆在帧末位置，且以整帧时长推进年龄而当场过期（首次实现即此错，靠逐粒子对账定位）。出生时刻还须钳在 `[prevAge, age] ∩ [0, CORE_MOVE_END]`：节点在 0.4166s 走完入场路径后不再位移，若仍把粒子铺到帧末，长帧跳转会在终点凭空堆出一簇。
- **遮罩与彗星的比例是原包写死的同步关系**：沿边线实测遮罩揭示前沿 ≈124 单位/秒（总行程 53.72）、彗星节点 ≈77–83 单位/秒（总行程 34.69），比值在 t=0.1–0.4166 全程恒定 **1.51–1.56**（不是「越跑越远」）。两者同由 clip #92 驱动：遮罩走 scale 曲线（`y: 0→68`）、彗星走 position 曲线（曲线 0–2）。遮罩收尾仅晚 0.017s（0.4333 vs 0.4166）。彗星路径与遮罩 +Y 的 3D 方向相差 23.20°，但投影屏幕斜率几乎相同（彗星 −0.8436 vs 遮罩 −0.8358），故两者投影后同轴贴边。彗星起点 `(∓18.46, −9.40, 0)` 与遮罩锚点 `(∓18, −9, 0)` 相距 0.610。
- **`LineCoreParticleMove_L/R`（#562/#561）已接入（不是子发射器）**：`SubModule.enabled=False` ⇒ 它**不是** `LineCoreMove` 的子发射器，而是挂在 `LineCoreMove` 下的**独立节点**（父级动画位移动 0，世界位置完全由 `feverEntrance` 的 `leftCore/rightCore` 曲线决定），随父级一起移动、提供彗星核心的闪烁颗粒。字段：`moveWithTransform=1`（World）、`lengthInSec=0.1` 且 `looping` ⇒ 每 0.1s 重发一轮 burst（`t=0` 起 `count=2 × cycles=5 @repeatInterval=0.01` ⇒ 单轮 10 个）；`startLifetime` TwoConstants **0.2–0.3s**、`startSize` TwoConstants **0.4–0.6**、`size3D=false`（Y 沿用 X）、初始自转与 `RotationModule` 均为 TwoConstants **±π**；`VelocityModule.enabled=False`（其中残留的 ±3.7/2.5 不生效）；`ShapeModule` 为 Cone `angle=0`、`radius=1e-4`（锥角为零 ⇒ 发射方向即局部 +Z）；贴图 `sharedassets56.assets:12`（`sc2_Effect_ParticleA001`），`sortOrder=600` 与本体一致；`ColorModule` 的两色渐变与 `LineCoreMove` **逐键相同**。AB 实测（仅切换是否含该节点）：峰值粒子数 `22 → 36.5`（子节点贡献 ~15 个，占 ~41%），且节点停走后核心颗粒仍在（14 vs 0.5）。
- **`cycleCount=0` 是「无限重复」，不是「不发射」（已修正）**：Unity `ParticleSystem.Burst.cycleCount` 的语义为 "Set this to **0** to make it play **indefinitely**"，源码里构造器做 `m_RepeatCount = _cycleCount - 1` ⇒ **-1 是无限哨兵**。预览原先把 `b.cycles || 1` 写成 `Math.max(1, ...)`，把 0 错映射成 1（只发一轮），现改为映射为 `Infinity` 并在 `emitBursts` 里按周期截断。注意 `m_Bursts` 是**固定大小数组**，有效条数由 `m_BurstCount` 决定（level56 里 `m_BurstCount=1/数组长度=1` 有 108 处，两者一致），故这些层的 burst 槽位**是有效的**，不能以「cycles=0 ⇒ 不发射」排除。该修正影响全局所有 `cycles=0` 的层（全工程 29 处）。
- **`FeverEffectSet_001/LineParticle` 下 6 层未建模，其中 2 层可确定不参与渲染**：
  - `LineParticle_L/R`（#603/#569）：**`ParticleSystemRenderer.m_Enabled = False`** ⇒ 不渲染。字段本身完整（`burst count=10`、`cycles=0`⇒无限、`interval=0.01`、寿命 0.2–0.5、`Shape` type=5 Box `pos=(∓6.87, 2.58, 0)` `scale=(0.5, 22, 1)` `rotz=∓45.41`、`Velocity.x=∓2.0`、贴图 `ComboInduceFrameEffect01`），但渲染器关闭。⚠ 预览当前**未读取 renderer enabled**，会把它当成有效层——目前侥幸不出问题，仅因 `fx.json` 里缺 `ComboInduceFrameEffect01` 贴图而跳过；建议后续显式支持该字段。
  - `Closs_L/R`（#537/#568）、`Particle_L/R`（#584/#571）：renderer enabled，且 `Shape` 内自带位置（`Closs` 用 `sc2_Particle_CrosGlow`、`Particle` 用 `ComboInduceFrameEffect01`），但**贴图不在 `public/rg/fx/tex/`**，预览无法渲染。
- **判定这些层不会被运行时改写的依据（三条）**：① `dump.cs` 里按名字引用 `LineParticle`/`Closs`/`Particle_Left`/`Particle_Right`/`FeverEffectSet`/`LineCoreMove`/`LineMask`/`LineBase`/`LineMove` 的次数**全为 0**；② 全工程无 `GetComponentsInChildren<ParticleSystem>` 之类的泛化粒子操作；③ clip #92 的 26 条曲线经 CRC32 反查只驱动 **6 个节点**（`LineCoreMove_L/R`、`LineMask_L/R`、`sc2_ingeame_feverEffect_L/R_001`），这 6 层均不在其中（其 Transform 全为单位变换，而 `LineCoreMove` 的局部位置是 `(∓18.46, −9.4, 0)` ⇒ 这 6 层不随彗星移动）。三者合起来表明它们是静态作者数据、运行时不改写。
- **顺带修掉两个周期相关的错**（均由 `cycles=0` 修正暴露）：① `spawn()` 里发射器周期用 `specs.reduce((m, s) => Math.max(m, s.dur), 1)` 兜底成 **1s**，会把 `lengthInSec=0.1` 的彗星层撑成 1s、整条时间轴都错（现兜底改为 0.05，即 `Spec.dur` 自身的下限）；② `emitBursts` 补发粒子时用**周期相对量** `t` 反推存活时长，周期一重启（`dur=0.1`）补发粒子就按错误时长被立即判死，现改用**绝对**出生时刻 `absT`。修正后子节点稳态存活 20–30 个，与 `10 个/0.1s × 0.25s 寿命 ≈ 25` 相符。
- **`ForceModule` 未接入（待办）**：`Closs_L/R` 与 `Particle_L/R` 的 `ForceModule.enabled=True`，三轴均 TwoConstants **±0.3**、`inWorldSpace=False`。预览未实现该模块；若将来接入这 4 层需一并实现（其余已建模层无启用的 Force）。
- **入场曲线与核心光点（遮罩已接入）**：`src/feverAnimation.ts` 已逐项使用 #92 streamed 原始系数与 float32 关键帧时间，覆盖起点、中间帧、终点保持、关闭边界和回跳；通过 `_rg_q.py` 核对层级，并以路径 CRC32 对应 genericBindings。曲线 0–5 使 LineCoreMove 左右从 `(±18.46,-9.4,0)` 在 25/60 秒内移至 `(±1.96,6.9,25.8)`，38/60 秒关闭；`src/feverCore.ts` 已补充左右核心节点原始短周期、尺寸 Hermite、TwoGradients、速度与贴图，HitFx 使用动画位置驱动局部粒子，并在关闭边界清空。核心入场以歌曲 Fever 起点为时基；跳转到入场之后不重播，跳入入场期间按已过时间恢复存活粒子。渲染器先同步时间再激活 Fever，避免 seek 清理吞掉当帧激活。零时刻出生粒子不再跳过第一帧积分；已接入 `rateOverDistance`、World 沉积与 `LineCoreParticleMove` 子节点。曲线 12–17 将 LineMask 左右从 `(1,0,1)` / `(4,0,1)` 缩放至 `(40,68,1)`，26/60 秒结束。

## HUD FX：两个环 + Combo/AP増加

- **两个环**：AP/Voltage `hud-gage` 用 CSS `conic-gradient` mask 模拟 Unity Image Filled / Radial360 / fillOrigin Top / `fillClockwise=false`；`--fill` = `radialFillAmount(value)`（小数部分）。基地 138×138，环 90×90。AP 环由 ApResolver 累加驱动；Voltage 点仅技能产（预览恒 0）。
- **Combo**：`paintComboBounce`（≥10，ComboRectTween）保留；跨 100/200/… 触发 `DoEffectCombo`（ComboAnimation #96，0.7833s）：scale 1→1.6@0.7→1.7；**color.a** 0→1@1/30 持平至 1/6 再多项式 (8.5286,−7.889,0,1)→0；上层数字行 + outline burst（AP-continue 时 burst 更强）。
- **AP増加**：`apRate` 变化且 ≥1 时 `APIncreaseAnimation` 0.75s（scale smoothstep→1.5，alpha 1→0）；粉徽章 `(1,0.2275,0.6)`；UI 近似 burst（Root/Bg_core/particles/glitter）。`apRate<1` 只清文本、不重启动画。
- 纯函数：`src/hudFxMath.ts` + `tests/hudFxMath.test.ts`。Skill/粒子技能 FX 仍不在范围。

- **AP/Voltage 环数值**：每帧 `paintApVoltage`；整数变化时底座使用 JudgementRectTween，上层使用独立数值闪光（详见下节），不是 ComboRectTween。Voltage 预览恒 0（未实现技能加点）。
- **AP増加**：底座徽章常显；`APRateUpper` 独立闪光副本（0.75s scale→1.5 + α→0）；`APRateEffect` 贴图爆发（glow/light02/glitter，@1/60s，寿命 1s，Local 缩放）。

## AddScore 加分飘字

- **布局**：level56 `AddScore` (305.8, −52) 200×40 pivot (0.5,0.5)；TMP 24、**左对齐**、`characterSpacing` 4、材质 IngameScorePink（面白 / 描边 RGB(255,58,153) width 0.4）。
- **文案**：判定 `Add(type,…)` 与技能 `Add(long,t)` 均 `SetCharArray` → `scoreAddText`（"+"N）；`scoreAddHideTime = t+0.7`（技能路径字面量 `@0x1aa10b8`；判定路径复用 `judgementHideTime`）。预览用 `ScoreEngine.lastAdd`。
- **ScoreAddTween @0x486177C**：寿命显示至 0.7s；缓动段 **0.2s**，`u=min(age,0.2)×5`；`anchoredPosition.x = -48·u·(u−2)+256`（0→304），**y 钉 −52**；`color.a = -0.4·u·(u−2)+0.6`（0.6→1）；0.2–0.7s 保持终态，超时清文本。预览另加 `SCORE_ADD_X_NUDGE = -40` 整体略左；DOM/z-index 在 `CurrentScoreRoot` 分数带之下。

## AP/Voltage 数值闪光

- **ParamViewResolver.UpdateAp @0x499E284**：`prevAp != value` 时 upper `SetCharArray` + `Animator.CrossFade(apUpperEffect)` + `JudgementRectTween(apRect=底座 APValue, hide=t+0.1)`。Voltage 同构。
- **Animator**：`APEffectBase`→`ApGageIncreaseAnimation`（sharedassets56 #107/#95）；`VoltageEffectBase`→`VoltageIncreaseAnimation`（#109/#97）。时长 **0.6s**。
  - scale.xyz：t≤0.1 保持 1；t∈[0.1,0.6] Hermite 1→1.8（outSlope=9.6, inSlope=0）
  - fontColor.a：t<0.1 为 0；key@0.1 起多项式 (16,−12,0,1) →0@0.6s；rgb 常量 AP (0,0.518,1) / Voltage (1,0.341,0.298)
- 预览：底座 JudgementRectTween；上层 `apGageFlashScale/Alpha`；数值嵌在环 disc 内居中；预览 Y+2 光学基线上移（Rodin 字重）。

## SE（SeResolver）

- 资产：`public/se/*.wav` 自 `rhythm.acb`（vgmstream）；cue id 与 `SE_SYSTEM.md` 一致（flick=4 hold=5 bad/good/great/perfect=6–9 trace=10 touch=22 start=21 finish=11–14）。
- 逻辑：`src/se.ts` 移植 `Process` 三帧窗 ×1.5、`AddSingle`/`AddFlick`/`AddHold`/`ApplyHold`；AutoPlay 路径 Single/Hold 首尾/Trace→`AddSingle`（Hold 中间计分采样不发按键音，持续音由 `AddHold`/`ApplyHold` 维护），Flick→`AddFlick`（AutoTrace 不用 `AddTrace`）。
- 同时押：`buildLineHashTables`（|Δ|<0.004 且 Count≥2 → trunc(t×1e7)）。
- 音量：打击音走 NoteTap（`vol-tap`），开场/曲终走 SE（`vol-se`）；与原版 CRI category 出口乘子对应。

