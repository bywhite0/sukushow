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
- 不修改上游 Unity 工程；不把原版 PNG / FX 纹理提交进本仓库。

## 可选本地皮肤 / FX

- `node scripts/copy-rg-assets.mjs` 可将本机游戏 UI / FX 资源复制到 gitignored 的 `public/rg/`（需 `--unity` / `--meta` 或环境变量）。
- 有资源时：9-slice note / 判定线、Plane Fade、Sprites/Default HoldMesh、hit FX（dump 节点 TRS / SetWidth / bursts、Local·billboard、NoColorSpace 纹理；仍非完整 ParticleSystem）、SafeArea HUD 贴图。
- 无资源时：程序化色块回退，页面仍可打开与播放。
- HUD：直播 combo + PERFECT（过线 AutoPlay）；分数 / AP / Mental 为 chrome 占位，非计分引擎。

## 参考

[sekai-mmw-preview-web](https://github.com/watagashi-uni/sekai-mmw-preview-web) 提供文件导入和播放交互参考；未移植其源码、WASM 或资产。

## 兼容边界

允许零时长 Hold、负时间 BPM 段和多个前段共享后继；拒绝倒序端点、非有限数、越界轨道和重复 UID。UID 严格递增约束防止串链环路。

## 非原版一致部分

不宣称像素级还原。有本地 `public/rg` 时的贴图 / FX / HUD 仍是浏览器近似（粒子非完整 Unity ParticleSystem；9-slice 仅水平；自定义粒子 shader 降级为 Additive）。无资源时的程序化贴片同为近似。未实现完整计分、判定状态机、SE、结算、角色技能和 MV。

JavaScript double 运算没有逐指令模拟 float32。音频偏移、移动端扩大视角和输入大小限制属于预览器行为。

## HUD 实现要点

本仓库内 HUD / 计分相关实现的约定与已知口径。

- **暗色分数**：`UpdateScore` 用 `num_score_11` / `num_score_12` 换精灵，不是 opacity；开局 `Clear()` 时 12 位与逗号全暗。
- **Combo 阈值 10**：`UpdateCombo` 在 combo < 10 时不显示数字；COMBO 标签与 APRate 徽章由 `UpdateApRate`（apRate >= 1）显隐。
- **判定字**：寿命 0.7 s 硬切（无淡出）；缩放 `JudgementRectTween` 0.5->1 / 0.1 s；combo >= 10 时 `ComboRectTween` 0.8->1 / 0.1 s。
- **AP/Voltage 环**：Scene Image 已证实为 Filled / Radial360 / fillOrigin Top / 逆时针；`ui_sc2_ingame_gage_base_02` 已补进复制清单。
- **isAuto 死码**：4.12.0 `ScoreResolver.isAuto` 无置 true 写入，`autoSprite` 运行时不出现；AutoPlay 仍走常规判定精灵。
- **P2 chrome**：GaugeRoot + RankLabels + RankRoot（开局 SetRankNotActive / D）；PauseButton（无 Pattern 花纹）；TechnicalScoreRoot 默认 `hidden`（TechnicalScoreDisplay 未提取）。
- **TechnicalScoreDisplay**：侧栏「显示技术分」开关映射；默认关。
- **TechnicalScoreDisplay 三态**：0 关闭 / 1 实时 / 2 预估剩余全 PP；推送值 raw/N×10000，面板文案 percent=value/10000（全 PP ⇒ 101.0000%）。场景 TMP 模板 `99.9999%` 仅占位，开局 Clear 为 `0.0000%`。预览无计分引擎时：实时固定 0、预估固定 101。
- **Pause Pattern**：`ui_sc2_button_shine` / `ui_sc2_button_dot` 在 `Art/Resources/SelectUI`（非 GameUI）；α .349 / .298，挂在 ColorImage Mask 内。
- **RankRoot shine/deco **: White->Gray/RankColor; Shine a.2, Deco01/02 a.8; setRank(none|D|C|B|A|S); inactive=SetRankNotActive. Material tints D/C/B/A solid, S gradient. Sidebar rank preview.
- **Rank hex clip**: icon + fill layers mask to ui_sc2_button_rank so shine/deco stay inside hex.
- **用户设置默认值（4.12.0）**：`RhythmGameOptionValue..ctor` @0x44A2C2C 取各 `OptionRange.First`——`EnablePerfectPlus=false`；`EnableFastSlow/FastSlowThreshold=0`(Off, range 0..2)；`JudgementOutput=0`(All, range 0..6)；`TechnicalScoreDisplayType=0`(Off, range 0..2)。侧栏「Perfect+ / 判定字输出 / FAST·SLOW」已接；判定显示门控 `type < 6-opt`；AutoPlay 在 PP 开启时用 `hantei_perfect_plus`。
