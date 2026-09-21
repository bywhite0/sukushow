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

- **拖尾宽度双常量**：直接读取 4.12.0 客户端 `data.unity3d` 的 level56 #543/#544，均为 `widthOverTrail.minMaxState=3`，minScalar=0.6999999881、scalar=0.3000000119，`sizeAffectsWidth=true`。客户端 `MinMaxCurve.Evaluate(time, lerpFactor) @0x8927DB4` 在 `0x8927DCC` 判断 mode=3，`0x8927DEC–0x8927E0C` 读取 +0x18/+0x1C 两常量，执行 `min + clamp01(lerpFactor) × (max−min)`，该分支不乘 curveMultiplier，也不使用 time。预览不再固定取 scalar=0.3；原生调用链已进一步定位：`libunity.so` getter `0x6A9FE0` 取粒子系统数据 +0x1158，经 `0x109A740 → 0x104B0C8` 转换宽度曲线；序列化函数 `0x1066244` 将 TrailModule +0x98 绑定为 widthOverTrail，setter `0x6AA16C` 使用相同偏移。渲染任务 `0x12A7394–0x12A73B0` 将宽度曲线指针存入上下文 +0xC08；`0x12A7EF8` 调用 `0x12AB17C`，其经 `0x10857E8` 取粒子结构，读取栈 +0x6C（结构起点 +8，即 Particle.m_RandomSeed +0x64），在 `0x12AB270–0x12AB2BC` 由 seed 派生宽度混合因子并存入上下文 +0x10。`0x12A86D8–0x12A86F8` 广播该因子并调用原生曲线采样 `0x122959C`；mode=3 分支 `0x12295D0–0x12295E8` 使用两常量插值。因子只依赖粒子 seed，不依赖帧时间；Fever 拖尾已按该整数混合公式派生宽度因子，包含 uint32 溢出、逻辑右移及 float32 转换/乘法，双常量结果在出生时缓存。预览 seed 仍由本地 Math.random 生成，不等同于客户端发射器的 seed 序列；其他随机模块尚未共用该 seed，跨模块相关性仍未对齐。宽度沿轨迹的曲线模式尚未完整实现。

- **拖尾轨迹几何**：每段四边形现在连接实际历史位置，截面垂直于轨迹并朝向固定相机法线；不再用放在线段中点的竖直 billboard 代替斜向轨迹。零长度不绘制，沿视线方向退化时使用横向截面。尚未实现相邻段接缝、原版材质与沿长度渐变，仍非完整 Unity TrailModule。

- **拖尾尺寸继承**：原始 #544 `TrailModule.sizeAffectsWidth=true`。预览拖尾宽度现在乘当前寿命相位的尺寸曲线，不再只乘出生尺寸；关闭该开关时保持独立宽度。现有拖尾宽度的 0.15 视觉系数及 ribbon 几何仍为近似，未宣称与原版绝对宽度一致。

- **粒子数值曲线**：原始 #544 SizeModule 包含非零入／出切线。HitFx 对已导出的 `FxKey.i/o` 使用非加权三次 Hermite 插值，切线乘关键帧时间跨度；缺少切线的旧数据保持线性回退。影响共用采样器的尺寸等数值曲线，不改变 Gradient 的 RGB/alpha 线性插值；加权切线尚未支持。

- **拖尾颜色继承**：原始 #544 `TrailModule.inheritParticleColor=true`。拖尾现在使用粒子当前寿命相位的颜色（含 TwoGradients 混合与 alpha）再乘拖尾渐变，不再只继承出生颜色；关闭继承时仍只使用拖尾颜色。拖尾几何和沿长度着色仍属预览近似。

- **粒子排序**：共用贴图和 shader 不代表共用排序层。Fever 的 Particle_Height / Particle_Height_02 分别为 20/19；Particle_Start / Particle_Closs 分别为 23/20。HitFx 批次键包含 `sortingOrder`，避免后创建节点继承第一个节点的排序。预览仍保留统一的 +40 渲染层偏移。

- **双色渐变**：原始 #544 的 ColorModule 为 `minMaxState=3`（TwoGradients）。按 Unity `MinMaxGradient.Evaluate(time, lerpFactor)`，先在同一寿命相位采样两条渐变，再连续混合 RGBA；不能随机二选一。预览每个粒子出生时固定混合比例，随寿命推进采样，两条曲线的 alpha 同样参与插值。该修复适用于共用 HitFx 渲染器的所有 TwoGradients 节点。

- 离线核对 4.12.0 `libil2cpp.so`：`FeverResolver.Process @0x4990098` 在开始边界设置逻辑状态，并由 `_isFeverEnabled` 门控 root 激活；结束边界无条件关闭 root。显示开关不改变逻辑 Fever。
- `src/fever.ts` 的颜色改用原始 `level56` ParticleSystem #542（LineBase_Left）/#604（LineMove_Left）的 `ColorModule.gradient.maxGradient`，不再把重建工程 Play-mode 的屏幕 hue 当作源颜色。
- 两层共用六个 RGB 色键，ctime 为 `[0,13107,26214,39321,52428,65535]`；RGB 与 alpha 独立线性插值。LineBase alpha 时间为 `[0,6554,33731,58982,65535]/65535`、值为 `[0,0.7058823704719543,1,0.7058823704719543,0]`；LineMove 时间为 `[0,13107,32768,52428,65535]/65535`、值为 `[0,0.47058823704719543,1,0.47058823704719543,0]`。
- **两侧入场爆发**：原始 `level56` #544/#543 均为 `looping=false`。根发射器按 0、0.05、0.08、0.10、0.13、0.18 秒发射六批，左侧累计 70、右侧累计 52 个粒子（不含子发射器）。预览此前以循环容器包裹非循环节点，导致只发出零时刻一批；现按非循环入场推进所有批次，并修正首个更新帧重复发射零时刻 burst。粒子自然消亡后不自动重播，关闭 Fever 立即清空。
- **范围限制**：以上对齐的是渐变与入场发射调度，不是完整 ParticleSystem。现有 LineMove 往返、4.4% 长度和屏幕边线投影仍是几何近似，不是二进制确认的运动规律。FeverEffectStartAnimation 入场、LineCoreMove 等层仍未完整复现；预览动画相位继续锚定歌曲 Fever 起点。

- **LineMove 几何依据纠正**：#604/#570 的 `InitialModule.size3D=true`，X=0.1099999994、Y=120、Z=0.1000000015，`rotation3D=true`；Renderer 的 `m_RenderMode=0`，不是拉伸模式。不能仅以 X×`m_LengthScale`÷Shape.length 推导屏幕亮条长度。`ShapeModule.type=4` 的语义也不能沿用重建文档的 Edge 注释，须结合 Unity 序列化枚举核对。
- **运动**：两侧 `startSpeed=1.2999999523`、寿命 0.8000000119；启用世界空间 VelocityModule，左 X=-0.3499999940、右 X=+0.3499999940，Y/Z=0。父级静态变换均为单位变换；没有从这些参数得到屏幕空间往返的依据。LineBase 的 VelocityModule 则为 disabled，不能采用其中残留的 +12/-20 值。
- **入场状态机**：sharedassets56 #104 `FeverEffectAnimatorController` 只有一个默认非循环状态，引用 #92 `FeverEffectStartAnimation`。将绑定路径 CRC32 与 level56 层级对应后，曲线 18/19 控制左右爆发根节点：t=0 关闭、t=1/60 秒开启；预览将 Animator 的 1/60 秒激活延迟与每个发射器的 `startDelay` 相加；原始根发射器 #543/#544 为 0–0.1000000015 秒随机延迟，每次启动独立采样一次，所有批次共享该偏移。上述六批时间为发射器开始后的相对时间，不是 Fever 起点的绝对偏移。延迟期间关闭 Fever 会取消待发射批次，暂停不推进计时；跨过出生点的首帧仅推进出生后的实际时间。
- **尚未接入的动画**：曲线 0–5 使 LineCoreMove 左右从 `(±18.46,-9.4,0)` 在 25/60 秒内移至 `(±1.96,6.9,25.8)`，38/60 秒关闭；曲线 12–17 将 LineMask 左右从 `(1,0,1)` / `(4,0,1)` 缩放至 `(40,68,1)`，26/60 秒结束。原始边线 Renderer `m_MaskInteraction=1`，后续需一起核对遮罩、材质与投影，不能只替换一条坐标公式。

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

